// v3 routes: field reports, real venue map (floor plan / photo + AI zoning, blank canvas grid, zone replace), camera calibration,
// staff assistant turn and TTS. Mounted inside apiRouter() before its 404/error handlers.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ZONE_TYPES, REPORT_CATEGORIES, URGENCIES, type ZoneSuggestion } from '../shared/contracts.ts';
import { AiError, aiInfo } from './ai.ts';
import { speak, zonesFromImage } from './ai3.ts';
import { assistantTurn } from './assistant.ts';
import { regionsOf, saveRegions, saveSnapshot } from './camera.ts';
import { q, tx } from './db.ts';
import { log } from './log.ts';
import { MEDIA_ROOT, parseDataUrl } from './media.ts';
import { createReport, listReports, reportDetail, ReportError } from './reports.ts';
import {
  aiErrToHttp, bad, forbidden, h, HttpErr, notFound, parse, participantFor, rateLimit, requireDevice, requireRole, sessionParticipants,
} from './routes.ts';
import { boxesToSuggestions, getMap, imageSize, mapSpace, replaceZones, setGrid, setMap, storePlanImage } from './venueMap.ts';
import { getDeviceRow, getEvent, listZoneRows, publishAll, toDevice, toEvent, type EventRow } from './world.ts';
import { presetById } from '../shared/templates.ts';
import { presetMap, seedPresetCrew, slotFor } from './presets.ts';

const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
const mapBody = express.raw({ type: imageTypes, limit: '10mb' });
const snapBody = express.raw({ type: imageTypes, limit: '3mb' });
const json8 = express.json({ limit: '8mb' });
const json16 = express.json({ limit: '12mb' });
const json = express.json({ limit: '64kb' });

const eventOr404 = (id: string) => { const ev = getEvent(id); if (!ev) throw notFound('Event not found.'); return ev; };
const wrapErr = (e: unknown): never => {
  if (e instanceof ReportError) throw new HttpErr(e.status, e.code, e.message);
  if (e instanceof AiError) throw aiErrToHttp(e);
  throw e;
};

async function suggestFor(eventId: string, image: { mime: string; buf: Buffer }, kind: 'floorplan' | 'photo'): Promise<{ suggestions: ZoneSuggestion[]; aiError?: string }> {
  if (!aiInfo().enabled) return { suggestions: [], aiError: 'AI is off — draw zones by hand.' };
  try {
    const { boxes } = await zonesFromImage(image, kind);
    return { suggestions: boxesToSuggestions(boxes, mapSpace(eventId)) };
  } catch (e) {
    log.warn('v3.zoning_failed', { err: (e as Error).message });
    return { suggestions: [], aiError: "The AI couldn't read this plan. Draw zones by hand." };
  }
}

export function v3Router() {
  const r = express.Router();

  // ── field reports ─────────────────────────────────────────────────────────────────────────────────────────────────
  r.post('/reports', json8, h(async (req, res) => {
    const b = parse(z.object({
      eventId: z.string(), zoneId: z.string().nullish(), category: z.enum(REPORT_CATEGORIES), urgency: z.enum(URGENCIES),
      text: z.string().trim().max(2000).nullish(), photo: z.string().nullish(), audio: z.string().nullish(), parentReportId: z.string().nullish(),
    }), req.body);
    const p = requireRole(req, eventOr404(b.eventId).id, 'staff');
    rateLimit(`report:${p.id}`, 1200);
    const photo = b.photo ? parseDataUrl(b.photo, 3 * 1024 * 1024) : null;
    if (b.photo && (!photo || !imageTypes.includes(photo.mime))) throw bad('BAD_PHOTO', 'The photo must be a JPEG, PNG or WebP under 3 MB.');
    const audio = b.audio ? parseDataUrl(b.audio, 8 * 1024 * 1024) : null;
    if (b.audio && (!audio || !/^(audio\/|video\/(mp4|webm))/.test(audio.mime))) throw bad('BAD_AUDIO', 'The voice note could not be read.');
    if (!b.text?.trim() && !photo && !audio) throw bad('EMPTY', 'Add a photo, a voice note or a short description.');
    try {
      res.json(await createReport({
        participant: p, zoneId: b.zoneId ?? null, category: b.category, urgency: b.urgency, text: b.text?.trim() || null, photo, audio,
        parentReportId: b.parentReportId ?? null,
      }));
    } catch (e) { wrapErr(e); }
  }));

  r.get('/reports', h((req, res) => {
    const eventId = String(req.query.eventId ?? '');
    const p = requireRole(req, eventOr404(eventId).id, 'staff');
    res.json({ reports: listReports(eventId, req.query.mine === '1' ? p.id : null) });
  }));

  r.get('/reports/:id', h((req, res) => {
    const d = reportDetail(String(req.params.id));
    if (!d) throw notFound('Report not found.');
    requireRole(req, d.report.eventId, 'staff');
    res.json(d);
  }));

  // ── venue map ─────────────────────────────────────────────────────────────────────────────────────────────────────
  r.post('/events/:eventId/map', mapBody, h(async (req, res) => {
    const ev = eventOr404(String(req.params.eventId));
    requireRole(req, ev.id, 'admin');
    if (!Buffer.isBuffer(req.body) || req.body.length < 200) throw bad('NO_IMAGE', 'Upload a PNG, JPEG or WebP image.');
    const kind = req.query.kind === 'photo' ? 'photo' : 'floorplan';
    const out = tx(() => storePlanImage(ev.id, req.body, kind));
    if ('error' in out) throw bad('BAD_IMAGE', out.error);
    publishAll(ev.id, out.frames);
    const size = imageSize(req.body)!;
    const s = await suggestFor(ev.id, { mime: size.mime, buf: req.body }, kind);
    res.json({ map: out.map, ...s });
  }));

  r.post('/events/:eventId/map/suggest', json, h(async (req, res) => {
    const ev = eventOr404(String(req.params.eventId));
    requireRole(req, ev.id, 'admin');
    const map = getMap(ev.id);
    if (!map?.imageUrl) throw bad('NO_MAP', 'Upload a floor plan or overview photo first.');
    const file = path.join(MEDIA_ROOT, map.imageUrl.replace(/^\/media\//, ''));
    if (!file.startsWith(MEDIA_ROOT) || !fs.existsSync(file)) throw notFound('The map image is missing. Upload it again.');
    const buf = fs.readFileSync(file);
    res.json(await suggestFor(ev.id, { mime: imageSize(buf)?.mime ?? 'image/png', buf }, map.kind === 'photo' ? 'photo' : 'floorplan'));
  }));

  r.patch('/events/:eventId/map', json, h((req, res) => {
    const ev = eventOr404(String(req.params.eventId));
    requireRole(req, ev.id, 'admin');
    const b = parse(z.object({ grid: z.object({ cols: z.number().int().min(2).max(60), rows: z.number().int().min(2).max(40) }).nullable() }), req.body);
    res.json({ map: setGrid(ev.id, b.grid) });
  }));

  r.delete('/events/:eventId/map', h((req, res) => {
    const ev = eventOr404(String(req.params.eventId));
    requireRole(req, ev.id, 'admin');
    const frames = tx(() => setMap(ev.id, null));
    publishAll(ev.id, frames);
    res.json({ ok: true });
  }));

  // ── venue presets (real floor plan + typed zones + install plan) ─────────────────────────────────────────────────
  r.post('/events/:eventId/map/preset', json, h((req, res) => {
    const ev = eventOr404(String(req.params.eventId));
    requireRole(req, ev.id, 'admin');
    const b = parse(z.object({ presetId: z.string().max(40) }), req.body);
    const tpl = presetById(b.presetId);
    if (!tpl?.map) throw notFound('Preset not found.');
    const now = Date.now();
    const out = tx(() => {
      const frames = setMap(ev.id, presetMap(tpl, now));          // map first, so zones are validated in the preset's space
      const z2 = replaceZones(ev.id, tpl.zones.map((zt) => ({ name: zt.name, polygon: zt.polygon, zoneType: zt.zoneType })));
      frames.push(...z2.frames, ...seedPresetCrew(ev.id, tpl, now));
      return { frames, zones: z2.zones };
    });
    publishAll(ev.id, out.frames);
    res.json({ map: getMap(ev.id), zones: out.zones });
  }));

  /** Public: what a slot QR sets up (shown on the one-scan setup screen before the device joins). */
  r.get('/presets/slot/:code/:slotId', h((req, res) => {
    const ev = q.get<EventRow>('SELECT * FROM events WHERE join_code = ?', String(req.params.code).toUpperCase());
    if (!ev) throw notFound('This QR code is invalid or expired.');
    const slot = slotFor(ev.id, String(req.params.slotId));
    if (!slot) throw notFound('This install spot is not part of the venue plan.');
    res.json({ event: toEvent(ev), slot });
  }));

  r.put('/events/:eventId/zones', json, h((req, res) => {
    const ev = eventOr404(String(req.params.eventId));
    requireRole(req, ev.id, 'admin');
    const b = parse(z.object({
      zones: z.array(z.object({
        id: z.string().optional(), name: z.string().trim().min(1).max(40),
        polygon: z.array(z.tuple([z.number(), z.number()])).min(3).max(64), zoneType: z.enum(ZONE_TYPES).optional(),
      })).max(64),
    }), req.body);
    const { w, hgt } = (() => { const s = mapSpace(ev.id); return { w: s.w, hgt: s.h }; })();
    for (const zn of b.zones) {
      for (const [x, y] of zn.polygon) if (x < -0.02 * w || y < -0.02 * hgt || x > w * 1.02 || y > hgt * 1.02) throw bad('OUT_OF_MAP', `"${zn.name}" is outside the map.`);
    }
    const clamped = b.zones.map((zn) => ({ ...zn, polygon: zn.polygon.map(([x, y]) => [Math.min(w, Math.max(0, x)), Math.min(hgt, Math.max(0, y))] as [number, number]) }));
    const out = tx(() => replaceZones(ev.id, clamped));
    publishAll(ev.id, out.frames);
    res.json({ zones: out.zones });
  }));

  // ── camera calibration ────────────────────────────────────────────────────────────────────────────────────────────
  r.post('/devices/:deviceId/snapshot', snapBody, h((req, res) => {
    const { device } = requireDevice(req, String(req.params.deviceId));
    if (!Buffer.isBuffer(req.body) || req.body.length < 500) throw bad('NO_IMAGE', 'The snapshot is empty.');
    const size = imageSize(req.body);
    if (!size) throw bad('BAD_IMAGE', 'Use a JPEG, PNG or WebP snapshot.');
    res.json({ snapshotUrl: saveSnapshot(device, req.body, size.mime) });
  }));

  r.put('/devices/:deviceId/regions', json, h((req, res) => {
    const { device } = requireDevice(req, String(req.params.deviceId));
    requireRole(req, device.event_id, 'admin');
    const b = parse(z.object({
      regions: z.array(z.object({
        zoneId: z.string(), polygon: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3).max(32),
      })).max(12),
    }), req.body);
    const zoneIds = new Set(listZoneRows(device.event_id).map((zn) => zn.id));
    for (const rg of b.regions) if (!zoneIds.has(rg.zoneId)) throw bad('NO_ZONE', 'A region points at a zone that no longer exists.');
    saveRegions(device, b.regions);
    res.json({ device: toDevice(getDeviceRow(device.id)!), regions: regionsOf(getDeviceRow(device.id)!).length });
  }));

  // ── staff assistant + TTS ─────────────────────────────────────────────────────────────────────────────────────────
  r.post('/assistant/turn', json16, h(async (req, res) => {
    const b = parse(z.object({
      eventId: z.string(), text: z.string().trim().max(800).nullish(), audio: z.string().nullish(), speak: z.boolean().optional(),
    }), req.body);
    const p = requireRole(req, eventOr404(b.eventId).id, 'staff');
    rateLimit(`assistant:${p.id}`, 1200);
    if (!aiInfo().enabled) throw aiErrToHttp(new AiError('AI_DISABLED', ''));
    const audio = b.audio ? parseDataUrl(b.audio, 8 * 1024 * 1024) : null;
    if (b.audio && !audio) throw bad('BAD_AUDIO', 'The voice clip could not be read.');
    if (!b.text && !audio) throw bad('EMPTY', 'Ask something first.');
    try {
      res.json(await assistantTurn(p, { text: b.text ?? null, audio, speak: !!b.speak }));
    } catch (e) { wrapErr(e); }
  }));

  r.post('/tts', json, h(async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(1).max(600), eventId: z.string().nullish() }), req.body);
    const p = b.eventId ? participantFor(req, b.eventId) : sessionParticipants(req)[0] ?? null;
    if (!p) throw new HttpErr(401, 'NO_SESSION', 'Join the event first.');
    rateLimit(`tts:${p.id}`, 800);
    if (!aiInfo().enabled) throw aiErrToHttp(new AiError('AI_DISABLED', ''));
    let audio: Buffer;
    try { audio = await speak(b.text); } catch (e) { throw aiErrToHttp(e); }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.end(audio);
  }));

  void forbidden;
  return r;
}
