// REST + SSE API (contract: shared/contracts.ts). Auth = httpOnly cookie `wv` holding up to 6 session tokens (newest first),
// one per event this browser joined; the server stores only sha256(token). Role checks happen per route against the
// participant for the route's event. The LLM never sees SQL: it returns structured proposals that server/rules.ts applies.
import express, { type NextFunction, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  ZONE_TYPES, inferZoneType, type ZoneSeriesBatch,
  CAPTURE_INTERVAL_MS, CROWD_LABEL, CROWD_LEVELS, DEVICE_OFFLINE_MS, INCIDENT_LABEL, INCIDENT_STATUS_LABEL, INCIDENT_TYPES, MAP_H, MAP_W,
  SEVERITY_LABEL, TASK_STATUS_LABEL, ZONE_STATUS_LABEL,
  type AttendeeTicket, type ChatMessage, type ChatReply, type ChatState, type FrameResult, type IncidentType, type Modality, type ObservationPayload,
  type ObservationResult, type PublicZone, type Role,
} from '../shared/contracts.ts';
import { TEMPLATES } from '../shared/templates.ts';
import { applySlot, presetMap, seedPresetCrew, slotFor } from './presets.ts';
import { AiError, aiInfo, analyzeFrame, askAssistant, attendeeChat, structureReport, suggestSteps, transcribe } from './ai.ts';
import { config } from './config.ts';
import { q, tx } from './db.ts';
import { log } from './log.ts';
import { RULE_STEPS, acknowledgeIncident, applyObservation, resolveIncident } from './rules.ts';
import { changeIssue, closeIssueForIncident, createIssue, getIssueRow, insertUtterance, issueKey, mirrorIncident, opsState, listTeams, toUtterance, type IssueRow } from './ops.ts';
import { opsRouter } from './opsRoutes.ts';
import { emitPulse } from './pulse.ts';
import { authRouter, currentUser } from './auth.ts';
import { dataRouter } from './dataRoutes.ts';
import { v3Router } from './v3Routes.ts';
import { inviteRouter } from './inviteRoutes.ts';
import { crewRouter } from './crewRoutes.ts';
import { agentFocus, conciergeInstructions } from './crew.ts';
import { analyzeWholeFrame, handleRegionFrame } from './camera.ts';
import { eventChannel, openStream } from './sse.ts';
import {
  addActivity, buildSnapshot, getKnowledge, getDeviceRow, getEvent, getIncidentRow, getTaskRow, getZoneRow, listZoneRows, newId,
  publishAll, toDevice, toEvent, toIncident, toMe, toParticipant, toTask, toZone,
  type DeviceRow, type EventRow, type Frame, type IncidentRow, type ParticipantRow, type TaskRow, type ZoneRow,
} from './world.ts';

// ── errors ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export class HttpErr extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export const bad = (code: string, msg: string) => new HttpErr(400, code, msg);
export const forbidden = (msg = "You don't have permission.") => new HttpErr(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found.') => new HttpErr(404, 'NOT_FOUND', msg);

type H = (req: Request, res: Response) => Promise<unknown> | unknown;
export const h = (fn: H) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

// ── session (cookie) ─────────────────────────────────────────────────────────────────────────────────────────────────

const COOKIE = 'wv';
const MAX_TOKENS = 6;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function cookieTokens(req: Request): string[] {
  const raw = req.headers.cookie ?? '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!m) return [];
  return decodeURIComponent(m.slice(COOKIE.length + 1)).split('.').filter((t) => /^[A-Za-z0-9_-]{20,64}$/.test(t)).slice(0, MAX_TOKENS);
}

export function setTokens(res: Response, tokens: string[]) {
  const v = tokens.slice(0, MAX_TOKENS).join('.');
  res.append('Set-Cookie', `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${config.isProd ? '; Secure' : ''}`);
}

/** Participants for this browser: device/attendee token cookies + the signed-in user's participants. Most recently active first. */
export function sessionParticipants(req: Request): ParticipantRow[] {
  const out = new Map<string, ParticipantRow>();
  for (const t of cookieTokens(req)) {
    const p = q.get<ParticipantRow>('SELECT * FROM participants WHERE token_hash = ?', sha(t));
    if (p) out.set(p.id, p);
  }
  const user = currentUser(req);
  if (user) for (const p of q.all<ParticipantRow>('SELECT * FROM participants WHERE user_id = ?', user.id)) out.set(p.id, p);
  return [...out.values()].sort((a, b) => b.last_seen_at - a.last_seen_at);
}

export const ROLE_RANK: Record<Role, number> = { attendee: 0, camera: 1, staff: 2, admin: 3 };

/** All of this browser's participants in one event (a signed-in organizer may also hold a camera token there). */
export function participantsFor(req: Request, eventId: string): ParticipantRow[] {
  return sessionParticipants(req).filter((p) => p.event_id === eventId);
}

/** The highest-ranked participant this browser has in the event. */
export function participantFor(req: Request, eventId: string): ParticipantRow | null {
  const ps = participantsFor(req, eventId);
  if (!ps.length) return null;
  return ps.reduce((best, p) => (ROLE_RANK[p.role as Role] > ROLE_RANK[best.role as Role] ? p : best));
}

export function requireRole(req: Request, eventId: string, min: Role): ParticipantRow {
  const p = participantFor(req, eventId);
  if (!p) throw new HttpErr(401, 'NO_SESSION', "You're not connected to this event. Scan the QR code again.");
  if (ROLE_RANK[p.role as Role] < ROLE_RANK[min]) throw forbidden(min === 'admin' ? 'Only organizers of this event can do that.' : 'Only staff can do that.');
  touchParticipant(p);
  return p;
}

const lastTouch = new Map<string, number>();
export function touchParticipant(p: ParticipantRow) {
  const now = Date.now();
  if (now - (lastTouch.get(p.id) ?? 0) < 5000) return;
  lastTouch.set(p.id, now);
  q.run('UPDATE participants SET last_seen_at = ? WHERE id = ?', now, p.id);
}

/** Own device only (or admin of its event). */
export function requireDevice(req: Request, deviceId: string): { device: DeviceRow; participant: ParticipantRow } {
  const device = getDeviceRow(String(deviceId));
  if (!device) throw notFound('Device not found. Scan the QR code again.');
  const ps = participantsFor(req, device.event_id);
  if (!ps.length) throw new HttpErr(401, 'NO_SESSION', 'This device was disconnected. Scan the QR code again.');
  const p = ps.find((x) => x.id === device.participant_id) ?? ps.find((x) => x.role === 'admin');
  if (!p) throw forbidden("You can't control another device.");
  touchParticipant(p);
  return { device, participant: p };
}

const newToken = () => randomBytes(24).toString('base64url');
const JOIN_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newJoinCode(): string {
  for (;;) {
    const b = randomBytes(6);
    const code = [...b].map((x) => JOIN_ALPHABET[x % JOIN_ALPHABET.length]).join('');
    if (!q.get('SELECT 1 FROM events WHERE join_code = ?', code)) return code;
  }
}

function createParticipant(eventId: string, role: Role, name: string, userId: string | null = null): { p: ParticipantRow; token: string } {
  const token = newToken();
  const id = newId('pt');
  const now = Date.now();
  q.run('INSERT INTO participants (id, event_id, display_name, role, token_hash, created_at, last_seen_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, eventId, name, role, sha(token), now, now, userId);
  return { p: q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', id)!, token };
}

function nextLabel(eventId: string, type: 'camera' | 'reporter' | 'scribe'): string {
  const n = (q.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices WHERE event_id = ? AND device_type = ?', eventId, type)?.n ?? 0) + 1;
  return `${type === 'camera' ? 'Camera' : type === 'scribe' ? 'Scribe' : 'Staff'} ${n}`;
}

function createDevice(eventId: string, participantId: string, type: 'camera' | 'reporter' | 'scribe', zoneId: string | null, label: string): DeviceRow {
  const id = newId('dv');
  const now = Date.now();
  q.run(`INSERT INTO devices (id, event_id, participant_id, zone_id, device_type, status, label, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?)`, id, eventId, participantId, zoneId, type, label, now, now);
  return getDeviceRow(id)!;
}

// ── validation ───────────────────────────────────────────────────────────────────────────────────────────────────────

const Point = z.tuple([z.number().min(0).max(MAP_W), z.number().min(0).max(MAP_H)]);
const Polygon = z.array(Point).min(3).max(32);
export const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw bad('INVALID_INPUT', 'Please check your input.');
  return r.data;
};

// simple per-key rate limit
const rl = new Map<string, number>();
export function rateLimit(key: string, minGapMs: number) {
  const now = Date.now();
  if (now - (rl.get(key) ?? 0) < minGapMs) throw new HttpErr(429, 'TOO_FAST', 'Slow down a little and try again.');
  rl.set(key, now);
}

// ── observation pipeline (shared by frame / manual / report / voice) ────────────────────────────────────────────────

const framesInFlight = new Set<string>();

function commitObservation(args: {
  device: DeviceRow; participant: ParticipantRow; zone: ZoneRow; modality: Modality; payload: ObservationPayload;
  confidence: number; model: string | null; latencyMs: number | null;
}): ObservationResult {
  const now = Date.now();
  const out = tx(() => {
    const r = applyObservation({
      eventId: args.device.event_id, zone: args.zone, device: args.device, participant: args.participant,
      modality: args.modality, payload: args.payload, confidence: args.confidence, model: args.model, latencyMs: args.latencyMs, now,
    });
    q.run('UPDATE devices SET last_seen_at = ?, last_error = NULL WHERE id = ?', now, args.device.id);
    for (const inc of r.incidents) {
      const t = r.tasks.find((x) => x.incidentId === inc.id);
      r.frames.push(...mirrorIncident(inc, args.zone.name, t?.assigneeId ?? null, [r.observationId], now));
    }
    return r;
  });
  const dev = toDevice(getDeviceRow(args.device.id)!);
  publishAll(args.device.event_id, [...out.frames, ['device', dev]]);
  for (const t of out.newTasks) void runAgent(args.device.event_id, t.taskId, t.incidentId);
  const obsFrame = out.frames.find((f) => f[0] === 'observation')!;
  const zoneFrame = out.frames.find((f) => f[0] === 'zone')!;
  return {
    observation: obsFrame[1] as ObservationResult['observation'],
    zone: zoneFrame[1] as ObservationResult['zone'],
    incidents: out.incidents,
    tasks: out.tasks,
  };
}

/** Staff agent: proposes action steps for a new task. Proposal only; falls back to the rule template on failure. */
async function runAgent(eventId: string, taskId: string, incidentId: string) {
  const inc = getIncidentRow(incidentId);
  const task = getTaskRow(taskId);
  if (!inc || !task) return;
  const zone = getZoneRow(inc.zone_id);
  const type = inc.incident_type as IncidentType;
  let steps: string[] = RULE_STEPS[type];
  let source: 'ai' | 'rule' = 'rule';
  let model: string | null = null;
  if (aiInfo().enabled) {
    try {
      const ev = q.all<{ payload_json: string; modality: string }>(
        `SELECT o.payload_json, o.modality FROM incident_observations io JOIN observations o ON o.id = io.observation_id
         WHERE io.incident_id = ? ORDER BY o.observed_at DESC LIMIT 5`, incidentId);
      const evidence = ev.map((e) => {
        const p = JSON.parse(e.payload_json) as ObservationPayload;
        return p.kind === 'vision' ? `Camera: ${p.summary}` : p.kind === 'report' ? `Report: ${p.transcript}` : `Manual: ${p.note ?? ''}`;
      });
      const r = await suggestSteps({ typeLabel: INCIDENT_LABEL[type], zoneName: zone?.name ?? '', description: inc.description, evidence });
      steps = r.steps; source = 'ai'; model = r.model;
    } catch (e) {
      log.warn('agent.steps_fallback', { err: (e as Error).message });
    }
  }
  const now = Date.now();
  const frames: Frame[] = tx(() => {
    q.run('UPDATE tasks SET steps_json = ?, steps_source = ?, updated_at = ? WHERE id = ? AND steps_source = ?', JSON.stringify(steps), source, now, taskId, 'pending');
    return [
      ['task', toTask(getTaskRow(taskId)!)],
      ['activity', addActivity(eventId, 'agent', source === 'ai' ? `Agent suggested ${steps.length} steps · ${INCIDENT_LABEL[type]} in ${zone?.name ?? 'a zone'}${model ? ` (${model})` : ''}` : `Standard steps attached · ${INCIDENT_LABEL[type]} in ${zone?.name ?? 'a zone'}`, taskId, now)],
    ];
  });
  publishAll(eventId, frames);
}

function deviceZone(device: DeviceRow, zoneId?: string | null): ZoneRow {
  const id = zoneId || device.zone_id;
  if (!id) throw bad('NO_ZONE', 'Pick a zone first.');
  const zone = getZoneRow(id);
  if (!zone || zone.event_id !== device.event_id) throw bad('NO_ZONE', 'Zone not found.');
  return zone;
}

export function aiErrToHttp(e: unknown): HttpErr {
  if (e instanceof AiError) {
    if (e.code === 'AI_DISABLED') return new HttpErr(503, 'AI_DISABLED', 'AI is off. Log it manually instead.');
    if (e.code === 'AI_BUSY') return new HttpErr(429, 'BUSY', e.message);
    return new HttpErr(502, 'AI_FAILED', `${e.message} You can log it manually.`);
  }
  return e instanceof HttpErr ? e : new HttpErr(500, 'INTERNAL', 'Server error. Try again.');
}

export function markDeviceError(device: DeviceRow, msg: string | null) {
  q.run('UPDATE devices SET last_error = ?, last_seen_at = ? WHERE id = ?', msg, Date.now(), device.id);
  publishAll(device.event_id, [['device', toDevice(getDeviceRow(device.id)!)]]);
}

/** Deterministic zone matching for a spoken/typed zone name. */
export function matchZone(eventId: string, hint: string | null): ZoneRow | null {
  if (!hint) return null;
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const h0 = norm(hint);
  const zones = listZoneRows(eventId);
  return zones.find((z) => norm(z.name) === h0) ?? zones.find((z) => h0.includes(norm(z.name)) || norm(z.name).includes(h0)) ?? null;
}

// ── router ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function apiRouter() {
  const r = express.Router();
  const json = express.json({ limit: '64kb' });
  const imageBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '1.5mb' });
  const audioBody = express.raw({ type: (req) => /^audio\//.test(String(req.headers['content-type'] ?? '')) || /^video\/(mp4|webm)/.test(String(req.headers['content-type'] ?? '')), limit: '8mb' });

  r.get('/me', h((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const p = sessionParticipants(req)[0];
    if (!p) return res.json({ me: null, event: null });
    const ev = getEvent(p.event_id);
    res.json({ me: toMe(p), event: ev ? toEvent(ev) : null });
  }));

  r.get('/templates', (_req, res) => { res.json({ templates: TEMPLATES }); });

  r.post('/events', json, h((req, res) => {
    const user = currentUser(req);
    if (!user) throw new HttpErr(401, 'NEEDS_LOGIN', 'Sign in to create an event.');
    const b = parse(z.object({ name: z.string().trim().min(1).max(60), templateId: z.string() }), req.body);
    const tpl = TEMPLATES.find((t) => t.id === b.templateId) ?? TEMPLATES[0];
    const now = Date.now();
    const out = tx(() => {
      const id = newId('ev');
      q.run('INSERT INTO events (id, name, join_code, admin_key, created_at, owner_user_id) VALUES (?, ?, ?, ?, ?, ?)', id, b.name, newJoinCode(), newToken(), now, user.id);
      // Presets ship their real floor plan: zones are already in its pixel space, so set map_json directly (no rescale).
      const pmap = presetMap(tpl, now);
      if (pmap) q.run('UPDATE events SET map_json = ? WHERE id = ?', JSON.stringify(pmap), id);
      tpl.zones.forEach((zt, i) => {
        q.run('INSERT INTO zones (id, event_id, name, polygon_json, sort, zone_type) VALUES (?, ?, ?, ?, ?, ?)', newId('zn'), id, zt.name, JSON.stringify(zt.polygon), i, zt.zoneType ?? inferZoneType(zt.name));
      });
      (tpl.teams ?? ['HQ', 'Registration', 'Stage', 'Safety']).forEach((name, i) => q.run('INSERT INTO teams (id, event_id, name, sort) VALUES (?, ?, ?, ?)', newId('tm'), id, name, i));
      if (tpl.crew?.length) seedPresetCrew(id, tpl, now);
      const { p } = createParticipant(id, 'admin', user.display_name, user.id);
      addActivity(id, 'system', `Created ${b.name} · ${tpl.zones.length} zones`, null, now);
      return { ev: getEvent(id)!, p };
    });
    res.json({ event: toEvent(out.ev), me: toMe(out.p, null) });
  }));

  r.get('/join/:code', h((req, res) => {
    const ev = q.get<EventRow>('SELECT * FROM events WHERE join_code = ?', String(req.params.code).toUpperCase());
    if (!ev) throw notFound('This QR code is invalid or expired.');
    res.json({ event: toEvent(ev), zones: listZoneRows(ev.id).map((z) => ({ id: z.id, name: z.name })) });
  }));

  r.post('/join', json, h((req, res) => {
    const b = parse(z.object({
      code: z.string().trim().min(4).max(12), as: z.enum(['camera', 'staff', 'attendee', 'scribe']),
      zoneId: z.string().nullish(), name: z.string().trim().max(30).nullish(), teamId: z.string().nullish(), slot: z.string().max(40).nullish(),
    }), req.body);
    const ev = q.get<EventRow>('SELECT * FROM events WHERE join_code = ?', b.code.toUpperCase());
    if (!ev) throw notFound('This QR code is invalid or expired.');
    if (b.as === 'attendee') {
      let tok: string | null = null;
      const p = tx(() => {
        const cur = participantFor(req, ev.id);
        if (cur) return cur; // staff/admin testing the chat keep their role
        const n = (q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM participants WHERE event_id = ? AND role = 'attendee'`, ev.id)?.n ?? 0) + 1;
        const c = createParticipant(ev.id, 'attendee', `Attendee ${n}`);
        tok = c.token;
        return c.p;
      });
      if (tok) setTokens(res, [tok, ...cookieTokens(req)]);
      if (tok) publishAll(ev.id, [['participant', toParticipant(p)]]);
      return res.json({ me: toMe(p, null), device: null });
    }
    const zone = b.zoneId ? getZoneRow(b.zoneId) : undefined;
    const zoneId = zone && zone.event_id === ev.id ? zone.id : null;
    const team = b.teamId ? listTeams(ev.id).find((t) => t.id === b.teamId) ?? null : null;
    const role: Role = b.as === 'staff' ? 'staff' : 'camera';
    const type = b.as === 'staff' ? 'reporter' : b.as === 'scribe' ? 'scribe' : 'camera';
    const now = Date.now();
    const user = currentUser(req);
    // Staff join with a QR scan alone. Signed in → the participant is the account (same identity on every device);
    // signed out → a cookie-token participant on this phone (like cameras/scribes), named by the person.
    const staffName = b.as === 'staff' && b.name ? b.name.trim().slice(0, 20) : null;
    let token: string | null = null;
    const frames: Frame[] = [];
    const out = tx(() => {
      let p = b.as === 'staff' && user
        ? q.get<ParticipantRow>('SELECT * FROM participants WHERE user_id = ? AND event_id = ?', user.id, ev.id) ?? null
        : participantFor(req, ev.id);
      if (!p) {
        const created = b.as === 'staff' && user
          ? createParticipant(ev.id, role, user.display_name, user.id)
          : createParticipant(ev.id, role, (b.as === 'staff' && staffName) || nextLabel(ev.id, type));
        p = created.p;
        if (!(b.as === 'staff' && user)) token = created.token;
        frames.push(['activity', addActivity(ev.id, 'device', `${p.display_name} ${b.as === 'staff' ? 'joined as staff' : 'connected'}${zone ? ` · ${zone.name}` : ''}`, p.id, now)]);
      } else if (ROLE_RANK[role] > ROLE_RANK[p.role as Role]) {
        q.run('UPDATE participants SET role = ? WHERE id = ?', role, p.id);
        p = { ...p, role };
      }
      // A QR (cookie) staff member can rename themself by re-joining; account names come from the account.
      if (b.as === 'staff' && staffName && !(p as ParticipantRow & { user_id?: string | null }).user_id && staffName !== p.display_name) {
        q.run('UPDATE participants SET display_name = ? WHERE id = ?', staffName, p.id);
        q.run(`UPDATE devices SET label = ? WHERE participant_id = ? AND device_type = 'reporter'`, staffName, p.id);
        p = { ...p, display_name: staffName };
      }
      if (team && (b.as === 'staff' || b.as === 'scribe' || !p.team_id)) q.run('UPDATE participants SET team_id = ? WHERE id = ?', team.id, p.id);
      let device = q.get<DeviceRow>('SELECT * FROM devices WHERE participant_id = ? AND device_type = ? ORDER BY created_at DESC LIMIT 1', p.id, type);
      const scribeLabel = () => (team ? `${team.name} team scribe` : nextLabel(ev.id, 'scribe'));
      if (!device) device = createDevice(ev.id, p.id, type, zoneId, type === 'scribe' ? scribeLabel() : p.role === 'admin' || type !== (role === 'staff' ? 'reporter' : 'camera') ? nextLabel(ev.id, type) : (b.name || p.display_name));
      else q.run('UPDATE devices SET zone_id = COALESCE(?, zone_id), last_seen_at = ? WHERE id = ?', zoneId, now, device.id);
      q.run('UPDATE participants SET last_seen_at = ? WHERE id = ?', now, p.id);
      // One-scan install slot (preset venues): label, zone, map position, team and crew persona — no login.
      const slot = b.as === 'camera' || b.as === 'scribe' ? slotFor(ev.id, b.slot, b.as) : null;
      if (slot) frames.push(...applySlot(ev.id, device.id, p, slot, now));
      const pRow = q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', p.id)!;
      const dRow = getDeviceRow(device.id)!;
      frames.push(['participant', toParticipant(pRow)], ['device', toDevice(dRow)]);
      return { p: pRow, d: dRow };
    });
    if (token) setTokens(res, [token, ...cookieTokens(req)]);
    publishAll(ev.id, frames);
    res.json({ me: toMe(out.p, out.d.id), device: toDevice(out.d) });
  }));

  r.post('/admin-claim', json, h((req, res) => {
    const b = parse(z.object({ eventId: z.string(), key: z.string().min(10) }), req.body);
    const ev = getEvent(b.eventId);
    if (!ev || ev.admin_key !== b.key) throw forbidden("This organizer link isn't valid.");
    let token: string | null = null;
    const user = currentUser(req);
    const p = tx(() => {
      // Signed in → the organizer role goes to the account; otherwise to this browser.
      const cur = user
        ? q.get<ParticipantRow>('SELECT * FROM participants WHERE user_id = ? AND event_id = ?', user.id, ev.id) ?? null
        : participantFor(req, ev.id);
      if (cur) { q.run(`UPDATE participants SET role = 'admin', last_seen_at = ? WHERE id = ?`, Date.now(), cur.id); return q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', cur.id)!; }
      const c = createParticipant(ev.id, 'admin', user?.display_name ?? 'Organizer', user?.id ?? null);
      if (!user) token = c.token;
      return c.p;
    });
    if (token) setTokens(res, [token, ...cookieTokens(req)]);
    res.json({ me: toMe(p) });
  }));

  r.get('/events/:eventId/snapshot', h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound('Event not found.');
    const p = requireRole(req, ev.id, 'camera');
    res.json(buildSnapshot(ev.id, toMe(p), aiInfo(), opsState(ev.id)));
  }));

  r.get('/events/:eventId/stream', h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound('Event not found.');
    const p = requireRole(req, ev.id, 'camera');
    openStream(req, res, eventChannel(ev.id), [{ event: 'snapshot', data: buildSnapshot(ev.id, toMe(p), aiInfo(), opsState(ev.id)) }]);
  }));

  r.get('/events/:eventId/admin-link', h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound();
    requireRole(req, ev.id, 'admin');
    const origin = config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${origin}/a/${ev.id}?k=${ev.admin_key}` });
  }));

  // zones (admin)
  r.post('/events/:eventId/zones', json, h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound();
    requireRole(req, ev.id, 'admin');
    const b = parse(z.object({ name: z.string().trim().min(1).max(30), polygon: Polygon, zoneType: z.enum(ZONE_TYPES).optional() }), req.body);
    const id = newId('zn');
    const sort = (q.get<{ m: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS m FROM zones WHERE event_id = ?', ev.id)?.m ?? 0);
    q.run('INSERT INTO zones (id, event_id, name, polygon_json, sort, zone_type) VALUES (?, ?, ?, ?, ?, ?)', id, ev.id, b.name, JSON.stringify(b.polygon), sort, b.zoneType ?? inferZoneType(b.name));
    const zone = toZone(getZoneRow(id)!);
    publishAll(ev.id, [['zone', zone], ['activity', addActivity(ev.id, 'zone', `Zone added · ${b.name}`, id)]]);
    res.json({ zone });
  }));

  r.patch('/zones/:zoneId', json, h((req, res) => {
    const zr = getZoneRow(String(req.params.zoneId));
    if (!zr) throw notFound('Zone not found.');
    requireRole(req, zr.event_id, 'admin');
    const b = parse(z.object({
      name: z.string().trim().min(1).max(30).optional(), polygon: Polygon.optional(), version: z.number().int().optional(),
      zoneType: z.enum(ZONE_TYPES).optional(), queueRate: z.number().min(0.1).max(60).nullable().optional(),
    }), req.body);
    // A type / queue-rate change alone needs no version (it doesn't fight geometry edits); geometry edits still do.
    if ((b.name !== undefined || b.polygon !== undefined) && b.version === undefined) throw bad('INVALID_INPUT', 'version is required.');
    const typeChanged = b.zoneType !== undefined && b.zoneType !== (zr.zone_type ?? 'general');
    const changed = q.run(
      `UPDATE zones SET name = COALESCE(?, name), polygon_json = COALESCE(?, polygon_json), zone_type = COALESCE(?, zone_type),
         queue_rate = CASE WHEN ? THEN ? ELSE queue_rate END, track_json = CASE WHEN ? THEN NULL ELSE track_json END,
         version = version + 1 WHERE id = ? AND (? IS NULL OR version = ?)`,
      b.name ?? null, b.polygon ? JSON.stringify(b.polygon) : null, b.zoneType ?? null,
      b.queueRate !== undefined ? 1 : 0, b.queueRate ?? null, typeChanged ? 1 : 0, zr.id, b.version ?? null, b.version ?? null);
    if (!Number(changed.changes)) throw new HttpErr(409, 'VERSION_CONFLICT', 'Someone else changed this first.');
    const zone = toZone(getZoneRow(zr.id)!);
    publishAll(zr.event_id, [['zone', zone]]);
    res.json({ zone });
  }));

  // Zone metric series for sparklines / trend (zone_metrics 30-s buckets, rolled up at read time).
  r.get('/events/:eventId/zone-series', h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound();
    requireRole(req, ev.id, 'staff');
    const mins = Math.max(1, Math.min(720, Number(req.query.mins ?? req.query.minutes ?? 30) || 30));
    const resMs = mins <= 30 ? 30_000 : mins <= 120 ? 120_000 : 300_000;
    const to = Date.now();
    const from = to - mins * 60_000;
    const rows = q.all<{ zone_id: string; t: number; n: number; crowd: number | null; people: number | null; queue: number | null; wait: number | null; seats: number | null; walkway: number | null; hazard: number | null; tier: number | null; conf: number | null }>(
      `SELECT zone_id, bucket - bucket % ? AS t, SUM(n_ok) AS n, AVG(crowd) AS crowd, AVG(people) AS people, AVG(queue) AS queue, AVG(wait_min) AS wait,
              AVG(seats_free) AS seats, MAX(walkway) AS walkway, MAX(hazard) AS hazard, MAX(tier) AS tier, AVG(conf) AS conf
       FROM zone_metrics WHERE event_id = ? AND bucket >= ? GROUP BY zone_id, t ORDER BY zone_id, t`, resMs, ev.id, from);
    const r1 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
    const series: ZoneSeriesBatch['series'] = {};
    for (const r of rows) (series[r.zone_id] ??= []).push({ t: r.t, n: r.n, crowd: r1(r.crowd), people: r1(r.people), queue: r1(r.queue), wait: r1(r.wait), seats: r1(r.seats), walkway: r.walkway, hazard: r1(r.hazard), tier: r.tier, conf: r1(r.conf) });
    const body: ZoneSeriesBatch = { resMs, from, to, series };
    res.json(body);
  }));

  r.delete('/zones/:zoneId', h((req, res) => {
    const zr = getZoneRow(String(req.params.zoneId));
    if (!zr) throw notFound('Zone not found.');
    requireRole(req, zr.event_id, 'admin');
    q.run('UPDATE zones SET deleted_at = ? WHERE id = ?', Date.now(), zr.id);
    q.run('UPDATE devices SET zone_id = NULL WHERE zone_id = ?', zr.id);
    const devs = q.all<DeviceRow>('SELECT * FROM devices WHERE event_id = ?', zr.event_id).map(toDevice);
    publishAll(zr.event_id, [['zone_removed', { id: zr.id }], ...devs.map((d) => ['device', d] as Frame), ['activity', addActivity(zr.event_id, 'zone', `Zone removed · ${zr.name}`, zr.id)]]);
    res.json({ ok: true });
  }));

  // devices (own)
  r.patch('/devices/:deviceId', json, h((req, res) => {
    const { device } = requireDevice(req, String(req.params.deviceId));
    const b = parse(z.object({ zoneId: z.string().nullish(), mode: z.enum(['idle', 'observing', 'paused']).optional(), label: z.string().trim().min(1).max(30).optional() }), req.body);
    if (b.zoneId) {
      const zr = getZoneRow(b.zoneId);
      if (!zr || zr.event_id !== device.event_id) throw bad('NO_ZONE', 'Zone not found.');
    }
    const now = Date.now();
    q.run(`UPDATE devices SET zone_id = CASE WHEN ? THEN ? ELSE zone_id END, status = COALESCE(?, status), label = COALESCE(?, label), last_seen_at = ? WHERE id = ?`,
      b.zoneId !== undefined ? 1 : 0, b.zoneId ?? null, b.mode ?? null, b.label ?? null, now, device.id);
    const d = toDevice(getDeviceRow(device.id)!);
    const frames: Frame[] = [['device', d]];
    if (b.zoneId && b.zoneId !== device.zone_id) frames.push(['activity', addActivity(device.event_id, 'device', `${d.label} → ${getZoneRow(b.zoneId)?.name ?? ''}`, d.id, now)]);
    if (b.mode && b.mode !== device.status) frames.push(['activity', addActivity(device.event_id, 'device', `${d.label} ${b.mode === 'observing' ? 'started observing' : b.mode === 'paused' ? 'paused' : 'is idle'}`, d.id, now)]);
    publishAll(device.event_id, frames);
    res.json({ device: d });
  }));

  r.put('/devices/:deviceId/position', json, h((req, res) => {
    const { device } = requireDevice(req, String(req.params.deviceId));
    const b = parse(z.object({ position: z.tuple([z.number().finite(), z.number().finite()]).nullable() }), req.body);
    if (b.position) {
      const ev = getEvent(device.event_id);
      const map = ev?.map_json ? (JSON.parse(ev.map_json) as { width: number; height: number }) : null;
      const w = map?.width ?? MAP_W, hgt = map?.height ?? MAP_H;
      if (b.position[0] < 0 || b.position[1] < 0 || b.position[0] > w || b.position[1] > hgt) throw bad('OUT_OF_MAP', 'That spot is outside the map.');
    }
    q.run('UPDATE devices SET position_json = ? WHERE id = ?', b.position ? JSON.stringify(b.position.map((n) => Math.round(n * 10) / 10)) : null, device.id);
    const d = toDevice(getDeviceRow(device.id)!);
    publishAll(device.event_id, [['device', d], ['activity', addActivity(device.event_id, 'device', b.position ? `${d.label} placed on the map` : `${d.label} removed from the map`, d.id)]]);
    res.json({ device: d });
  }));

  r.post('/devices/:deviceId/heartbeat', json, h((req, res) => {
    const { device } = requireDevice(req, String(req.params.deviceId));
    const mode = z.enum(['idle', 'observing', 'paused']).catch(device.status as 'idle').parse(req.body?.mode);
    const now = Date.now();
    const wasOffline = now - device.last_seen_at > DEVICE_OFFLINE_MS;
    q.run('UPDATE devices SET last_seen_at = ?, status = ? WHERE id = ?', now, mode, device.id);
    const d = toDevice(getDeviceRow(device.id)!);
    const frames: Frame[] = [['device', d]];
    if (wasOffline) frames.push(['activity', addActivity(device.event_id, 'device', `${d.label} reconnected`, d.id, now)]);
    publishAll(device.event_id, frames);
    emitPulse(device.event_id, device.id, 'heartbeat');
    res.json({ device: d, serverTime: now });
  }));

  r.post('/devices/:deviceId/frames', imageBody, h(async (req, res) => {
    const { device, participant } = requireDevice(req, String(req.params.deviceId));
    if (Buffer.isBuffer(req.body) && req.body.length >= 1000) emitPulse(device.event_id, device.id, 'frame');
    // Calibrated multi-zone camera → per-region analysis (server/camera.ts).
    if (device.regions_json && device.regions_json !== '[]') return handleRegionFrame(req, res, device, participant, commitObservation);
    const zone = deviceZone(device);
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw bad('NO_IMAGE', 'The photo is empty.');
    if (!aiInfo().enabled) throw aiErrToHttp(new AiError('AI_DISABLED', ''));
    if (framesInFlight.has(device.id)) throw new HttpErr(429, 'BUSY', 'Still analysing the previous frame.');
    framesInFlight.add(device.id);
    const t0 = Date.now();
    try {
      q.run(`UPDATE devices SET last_frame_at = ?, last_seen_at = ?, status = 'observing' WHERE id = ?`, Date.now(), Date.now(), device.id);
      let result;
      try {
        result = await analyzeWholeFrame(req.body, String(req.headers['content-type']).split(';')[0], zone, agentFocus(device.id)?.instructions);
      } catch (e) {
        markDeviceError(device, e instanceof AiError && e.code === 'AI_TIMEOUT' ? 'AI slow to respond' : 'AI unavailable');
        throw aiErrToHttp(e);
      }
      // Image buffer is dropped here; only the structured result is stored.
      const zoneNow = getZoneRow(zone.id) ?? zone;
      const out = commitObservation({
        device: getDeviceRow(device.id)!, participant, zone: zoneNow, modality: 'vision', payload: result.payload,
        confidence: result.confidence, model: result.model, latencyMs: result.latencyMs,
      });
      const body: FrameResult = { ...out, nextInMs: Math.max(0, CAPTURE_INTERVAL_MS - (Date.now() - t0)) };
      res.json(body);
    } finally {
      framesInFlight.delete(device.id);
    }
  }));

  r.post('/devices/:deviceId/manual', json, h((req, res) => {
    const { device, participant } = requireDevice(req, String(req.params.deviceId));
    const b = parse(z.object({
      zoneId: z.string().nullish(), crowdLevel: z.enum(CROWD_LEVELS).nullish(), issueType: z.enum(INCIDENT_TYPES).nullish(), note: z.string().trim().max(200).nullish(),
    }), req.body);
    if (!b.crowdLevel && !b.issueType && !b.note) throw bad('EMPTY', 'Pick a crowd level or an issue.');
    rateLimit(`manual:${device.id}`, 800);
    const zone = deviceZone(device, b.zoneId);
    res.json(commitObservation({
      device, participant, zone, modality: 'manual',
      payload: { kind: 'manual', crowd_level: b.crowdLevel ?? null, issue_type: b.issueType ?? null, note: b.note || null },
      confidence: 1, model: null, latencyMs: null,
    }));
  }));

  const handleReport = async (device: DeviceRow, participant: ParticipantRow, text: string, modality: 'text' | 'voice', zoneId: string | null | undefined, extraLatency: number) => {
    const fallbackZone = zoneId || device.zone_id;
    const zones = listZoneRows(device.event_id);
    const current = fallbackZone ? zones.find((z) => z.id === fallbackZone) ?? null : null;
    let structured;
    try {
      structured = await structureReport(text, zones.map((z) => z.name), current?.name ?? null);
    } catch (e) {
      markDeviceError(device, 'AI unavailable');
      throw aiErrToHttp(e);
    }
    // Zone: explicit pick from the UI wins; else the zone named in the report (deterministic match); else the device zone.
    const zone = (zoneId ? getZoneRow(zoneId) : null) ?? matchZone(device.event_id, structured.payload.zone_hint) ?? current;
    if (!zone || zone.event_id !== device.event_id) throw bad('NO_ZONE', 'Which zone is this? Pick one.');
    return commitObservation({
      device, participant, zone, modality, payload: structured.payload, confidence: structured.payload.confidence,
      model: structured.model, latencyMs: structured.latencyMs + extraLatency,
    });
  };

  r.post('/devices/:deviceId/report', json, h(async (req, res) => {
    const { device, participant } = requireDevice(req, String(req.params.deviceId));
    const b = parse(z.object({ text: z.string().trim().min(2).max(1000), zoneId: z.string().nullish() }), req.body);
    rateLimit(`report:${device.id}`, 1500);
    res.json(await handleReport(device, participant, b.text, 'text', b.zoneId, 0));
  }));

  r.post('/devices/:deviceId/voice', audioBody, h(async (req, res) => {
    const { device, participant } = requireDevice(req, String(req.params.deviceId));
    if (!Buffer.isBuffer(req.body) || req.body.length < 800) throw bad('NO_AUDIO', 'That recording is too short.');
    rateLimit(`voice:${device.id}`, 1500);
    let tr;
    try {
      tr = await transcribe(req.body, String(req.headers['content-type'] ?? 'audio/webm'), listZoneRows(device.event_id).map((z) => z.name));
    } catch (e) {
      markDeviceError(device, 'Transcription failed');
      throw aiErrToHttp(e);
    }
    // Audio buffer is dropped here; only the transcript + structured result are stored.
    if (tr.text.length < 2) throw bad('EMPTY_TRANSCRIPT', "Couldn't make out any speech. Try again.");
    const zoneId = typeof req.query.zoneId === 'string' ? req.query.zoneId : null;
    res.json(await handleReport(device, participant, tr.text, 'voice', zoneId, tr.latencyMs));
  }));

  // incidents & tasks (staff+)
  r.patch('/incidents/:incidentId', json, h((req, res) => {
    const inc = getIncidentRow(String(req.params.incidentId));
    if (!inc) throw notFound('Incident not found.');
    const p = requireRole(req, inc.event_id, 'staff');
    const b = parse(z.object({ status: z.enum(['acknowledged', 'resolved']) }), req.body);
    const frames = tx(() => (b.status === 'resolved'
      ? [...resolveIncident(inc.id, p), ...closeIssueForIncident(inc.id, { kind: 'human', id: p.id, name: p.display_name })]
      : acknowledgeIncident(inc.id, p)));
    publishAll(inc.event_id, frames);
    res.json({ incident: toIncident(getIncidentRow(inc.id)!) });
  }));

  r.patch('/tasks/:taskId', json, h((req, res) => {
    const t = getTaskRow(String(req.params.taskId));
    if (!t) throw notFound('Task not found.');
    const p = requireRole(req, t.event_id, 'staff');
    const b = parse(z.object({ status: z.enum(['open', 'accepted', 'done']).optional(), assigneeId: z.string().nullish() }), req.body);
    if (b.assigneeId !== undefined && p.role !== 'admin' && b.assigneeId !== p.id) throw forbidden('Only organizers can assign work to someone else.');
    if (b.assigneeId) {
      const a = q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ? AND event_id = ?', b.assigneeId, t.event_id);
      if (!a) throw bad('NO_ASSIGNEE', 'That person was not found.');
    }
    const now = Date.now();
    const frames: Frame[] = tx(() => {
      const out: Frame[] = [];
      if (b.assigneeId !== undefined) {
        q.run('UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE id = ?', b.assigneeId ?? null, now, t.id);
        const who = b.assigneeId ? q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', b.assigneeId)?.display_name : null;
        out.push(['activity', addActivity(t.event_id, 'task', who ? `Assigned to ${who} · ${t.title}` : `Unassigned · ${t.title}`, t.id, now)]);
      }
      if (b.status && b.status !== t.status) {
        q.run('UPDATE tasks SET status = ?, updated_at = ?, assignee_id = COALESCE(assignee_id, ?) WHERE id = ?', b.status, now, p.id, t.id);
        out.push(['activity', addActivity(t.event_id, 'task', `${p.display_name} · ${t.title} → ${TASK_STATUS_LABEL[b.status]}`, t.id, now)]);
        if (b.status === 'accepted') out.push(...acknowledgeIncident(t.incident_id, p, now));
        if (b.status === 'done') {
          const others = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE incident_id = ? AND id != ? AND status != 'done'`, t.incident_id, t.id)?.n ?? 0;
          if (!others) out.push(...resolveIncident(t.incident_id, p, now), ...closeIssueForIncident(t.incident_id, { kind: 'human', id: p.id, name: p.display_name }, now));
        }
      }
      out.unshift(['task', toTask(getTaskRow(t.id)!)]);
      return out;
    });
    publishAll(t.event_id, frames);
    res.json({ task: toTask(getTaskRow(t.id)!) });
  }));

  r.post('/assistant', json, h(async (req, res) => {
    const b = parse(z.object({ question: z.string().trim().min(1).max(500), eventId: z.string().optional() }), req.body);
    const p = b.eventId ? participantFor(req, b.eventId) : sessionParticipants(req).find((x) => x.role !== 'camera') ?? null;
    if (!p) throw new HttpErr(401, 'NO_SESSION', 'Scan the staff QR code first.');
    requireRole(req, p.event_id, 'staff');
    rateLimit(`assist:${p.id}`, 1500);
    try {
      res.json(await askAssistant(b.question, assistantContext(p)));
    } catch (e) {
      throw aiErrToHttp(e);
    }
  }));

  // ── attendee chatbot ──────────────────────────────────────────────────────────────────────────────────────────────
  const chatParticipant = (req: Request, eventId?: string | null): ParticipantRow => {
    const ps = sessionParticipants(req);
    const p = eventId ? ps.find((x) => x.event_id === eventId) : ps.find((x) => x.role === 'attendee') ?? ps[0];
    if (!p) throw new HttpErr(401, 'NO_SESSION', 'Scan the event QR code to start chatting.');
    touchParticipant(p);
    return q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', p.id)!;
  };
  const publicZones = (eventId: string): PublicZone[] => listZoneRows(eventId).map((z) => ({
    id: z.id, name: z.name, status: z.current_status === 'alert' ? (z.crowd_level ? ({ empty: 'clear', low: 'clear', moderate: 'busy', high: 'crowded', critical: 'critical' } as const)[z.crowd_level as 'low'] : 'busy') : z.current_status as PublicZone['status'],
    crowdLevel: z.crowd_level as PublicZone['crowdLevel'], peopleEstimate: z.people_estimate, lastObservedAt: z.last_observed_at,
  }));
  const toChat = (m: { id: string; role: string; text: string; at: number; zone_id: string | null; observation_id: string | null; model: string | null }): ChatMessage =>
    ({ id: m.id, role: m.role as ChatMessage['role'], text: m.text, at: m.at, zoneId: m.zone_id, observationId: m.observation_id, model: m.model });

  /** Attendee tickets: the issue each of their messages became (via issue_evidence on the message's observation /
   *  utterance ref — `chat_messages.observation_id` holds an `ob_…` observation id for problems or an `ut_…` utterance id
   *  for requests). Status is the live issue status. */
  const ticketFor = (m: { id: string; observation_id: string | null; at: number }): AttendeeTicket | null => {
    if (!m.observation_id) return null;
    const i = q.get<IssueRow>(`SELECT i.* FROM issue_evidence e JOIN issues i ON i.id = e.issue_id WHERE e.ref_id = ? ORDER BY i.created_at LIMIT 1`, m.observation_id);
    if (!i) return null;
    return {
      messageId: m.id, kind: m.observation_id.startsWith('ut_') ? 'request' : 'problem', issueId: i.id, issueKey: issueKey(i.number), title: i.title,
      zoneId: i.zone_id, status: i.status as AttendeeTicket['status'], joinedExisting: i.created_at < m.at - 1500, createdAt: m.at, updatedAt: i.updated_at,
    };
  };
  const ticketsOf = (participantId: string): AttendeeTicket[] =>
    q.all<{ id: string; observation_id: string | null; at: number }>(
      `SELECT id, observation_id, at FROM chat_messages WHERE participant_id = ? AND role = 'user' AND observation_id IS NOT NULL ORDER BY at DESC LIMIT 30`, participantId)
      .map(ticketFor).filter((t): t is AttendeeTicket => !!t);
  /** Character-bigram Dice similarity (short request titles; dedupe across attendees). */
  const similarTitle = (a: string, b: string) => {
    const bg = (s: string) => { const t = s.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ''); const o: string[] = []; for (let i = 0; i < t.length - 1; i++) o.push(t.slice(i, i + 2)); return o; };
    const A = bg(a), B = bg(b); if (!A.length || !B.length) return 0;
    const pool = [...B]; let hit = 0;
    for (const x of A) { const k = pool.indexOf(x); if (k >= 0) { hit++; pool.splice(k, 1); } }
    return (2 * hit) / (A.length + B.length);
  };

  r.get('/chat', h((req, res) => {
    const p = chatParticipant(req, typeof req.query.eventId === 'string' ? req.query.eventId : null);
    const ev = getEvent(p.event_id)!;
    const msgs = q.all<Parameters<typeof toChat>[0]>('SELECT * FROM chat_messages WHERE participant_id = ? ORDER BY at DESC LIMIT 60', p.id).reverse();
    const body: ChatState = { event: toEvent(ev), me: toMe(p, null), zones: publicZones(ev.id), myZoneId: p.zone_id ?? null, messages: msgs.map(toChat), ai: aiInfo(), tickets: ticketsOf(p.id) };
    res.json(body);
  }));

  r.get('/chat/tickets', h((req, res) => {
    const p = chatParticipant(req, typeof req.query.eventId === 'string' ? req.query.eventId : null);
    res.json({ tickets: ticketsOf(p.id) });
  }));

  r.patch('/chat/zone', json, h((req, res) => {
    const b = parse(z.object({ zoneId: z.string().nullable(), eventId: z.string().nullish() }), req.body);
    const p = chatParticipant(req, b.eventId);
    if (b.zoneId) { const zr = getZoneRow(b.zoneId); if (!zr || zr.event_id !== p.event_id) throw bad('NO_ZONE', 'Zone not found.'); }
    q.run('UPDATE participants SET zone_id = ? WHERE id = ?', b.zoneId, p.id);
    res.json({ myZoneId: b.zoneId });
  }));

  r.post('/chat', json, h(async (req, res) => {
    const b = parse(z.object({ message: z.string().trim().min(1).max(500), zoneId: z.string().nullish(), eventId: z.string().nullish() }), req.body);
    const p = chatParticipant(req, b.eventId);
    rateLimit(`chat:${p.id}`, 1500);
    if (b.zoneId) {
      const zr = getZoneRow(b.zoneId);
      if (zr && zr.event_id === p.event_id) { q.run('UPDATE participants SET zone_id = ? WHERE id = ?', zr.id, p.id); p.zone_id = zr.id; }
    }
    const ev = getEvent(p.event_id)!;
    const zones = listZoneRows(ev.id);
    const myZone = p.zone_id ? zones.find((z) => z.id === p.zone_id) ?? null : null;
    const history = q.all<{ role: 'user' | 'assistant'; text: string }>('SELECT role, text FROM chat_messages WHERE participant_id = ? ORDER BY at DESC LIMIT 8', p.id).reverse();
    const now0 = Date.now();
    const mins = (t: number | null) => (t ? `${Math.max(0, Math.round((now0 - t) / 60000))} min ago` : 'no data');
    const context = [
      `Event: ${ev.name}`,
      `Attendee's current location: ${myZone?.name ?? 'unknown'}`,
      'Current crowd level per zone (from staff cameras):',
      ...publicZones(ev.id).map((z) => `- ${z.name}: ${z.crowdLevel ? CROWD_LABEL[z.crowdLevel] : 'no data'}${z.peopleEstimate != null ? ` · ~${z.peopleEstimate} people` : ''} · last seen ${mins(z.lastObservedAt)}`),
      ...(getKnowledge(ev.id) ? ['Event info from the organizers (answer from this when relevant):', getKnowledge(ev.id).slice(0, 4000)] : []),
      ...(conciergeInstructions(ev.id) ? [`Your persona (set by the organizers): ${conciergeInstructions(ev.id)!.slice(0, 600)}`] : []),
    ].join('\n');
    let out;
    try { out = await attendeeChat(b.message, history, context); } catch (e) { throw aiErrToHttp(e); }

    const now = Date.now();
    let report: ChatReply['report'] = null;
    let frames: Frame[] = [];
    let newTasks: Array<{ taskId: string; incidentId: string }> = [];
    const result = tx(() => {
      let obsId: string | null = null;
      let zoneForMsg = myZone?.id ?? null;
      if (out.intent === 'request') {
        // A request becomes a task on the ops board (merged into a near-identical open request at the same place).
        // Place: the zone the model named, else a zone named in the task title, else where the attendee is.
        const zone = matchZone(ev.id, out.report.payload.zone_hint) ?? matchZone(ev.id, out.ticketTitle || null) ?? myZone;
        zoneForMsg = zone?.id ?? null;
        const title = (out.ticketTitle || out.report.payload.summary || b.message).slice(0, 80);
        const u = insertUtterance({
          event_id: ev.id, team_id: null, device_id: p.id, participant_id: p.id, speaker: p.display_name, source: 'chat',
          text: b.message, started_at: now, ended_at: now, model: out.model, latency_ms: out.latencyMs,
        });
        obsId = u.id;
        const evidence = [{ type: 'utterance' as const, id: u.id }];
        const actor = { kind: 'human' as const, id: p.id, name: p.display_name };
        const dupe = q.all<IssueRow>(`SELECT * FROM issues WHERE event_id = ? AND status != 'done' AND updated_at >= ? ORDER BY updated_at DESC LIMIT 60`, ev.id, now - 45 * 60_000)
          .find((i) => (!i.zone_id || !zoneForMsg || i.zone_id === zoneForMsg) && similarTitle(i.title, title) >= 0.55);
        if (dupe) frames.push(...changeIssue(dupe.id, {}, actor, evidence, null, now));
        else frames.push(...createIssue({
          eventId: ev.id, title, kind: 'task', priority: out.urgent ? 'p1' : 'p2', teamId: null, assigneeId: null, assigneeHint: null,
          dueAt: null, zoneId: zoneForMsg, actor, evidence, confidence: null, now,
        }).frames);
        frames.push(['utterance', toUtterance(q.get('SELECT * FROM utterances WHERE id = ?', u.id)!)]);
      } else if (out.report.isReport) {
        const zone = matchZone(ev.id, out.report.payload.zone_hint) ?? myZone;
        if (zone) {
          zoneForMsg = zone.id;
          // Attendees have no device row: the participant id stands in as the observation's device id.
          const pseudo: DeviceRow = { id: p.id, event_id: ev.id, participant_id: p.id, zone_id: zone.id, device_type: 'reporter', status: 'idle', label: p.display_name, last_seen_at: now, last_frame_at: null, last_error: null, created_at: p.created_at };
          const r = applyObservation({ eventId: ev.id, zone, device: pseudo, participant: p, modality: 'chat', payload: out.report.payload, confidence: out.report.payload.confidence, model: out.model, latencyMs: out.latencyMs, now });
          obsId = r.observationId;
          frames = r.frames;
          for (const inc of r.incidents) {
            const t = r.tasks.find((x) => x.incidentId === inc.id);
            frames.push(...mirrorIncident(inc, zone.name, t?.assigneeId ?? null, [r.observationId], now));
          }
          newTasks = r.newTasks;
          const inc = r.incidents[0];
          report = { issueType: out.report.payload.issue_type, zoneId: zone.id, observationId: obsId, incidentOpened: !!inc && inc.createdAt === now, joinedExisting: !!inc && inc.createdAt !== now };
        }
      }
      const uid = newId('cm'), aid = newId('cm');
      q.run('INSERT INTO chat_messages (id, event_id, participant_id, role, text, zone_id, observation_id, model, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', uid, ev.id, p.id, 'user', b.message, zoneForMsg, obsId, null, now);
      q.run('INSERT INTO chat_messages (id, event_id, participant_id, role, text, zone_id, observation_id, model, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', aid, ev.id, p.id, 'assistant', out.reply, zoneForMsg, null, out.model, now + 1);
      return {
        user: toChat({ id: uid, role: 'user', text: b.message, at: now, zone_id: zoneForMsg, observation_id: obsId, model: null }),
        reply: toChat({ id: aid, role: 'assistant', text: out.reply, at: now + 1, zone_id: zoneForMsg, observation_id: null, model: out.model }),
      };
    });
    publishAll(ev.id, frames);
    for (const t of newTasks) void runAgent(ev.id, t.taskId, t.incidentId);
    const ticket = result.user.observationId ? ticketFor({ id: result.user.id, observation_id: result.user.observationId, at: result.user.at }) : null;
    const body: ChatReply = { ...result, report, myZoneId: p.zone_id ?? null, zones: publicZones(ev.id), ticket };
    res.json(body);
  }));

  r.use(authRouter());
  r.use(dataRouter());
  r.use(opsRouter());
  r.use(v3Router());
  r.use(crewRouter());
  r.use(inviteRouter());
  r.use((_req, _res, next) => next(notFound('Unknown API.')));
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as HttpErr & { type?: string; status?: number };
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'That file is too large.' } });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed request.' } });
    if (e instanceof HttpErr) return res.status(e.status).json({ error: { code: e.code, message: e.message } });
    log.error('api.unhandled', { err: e });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Server error. Try again.' } });
  });
  return r;
}

/** Read-only text view of the venue for the staff assistant (no SQL, no write path). */
function assistantContext(p: ParticipantRow): string {
  const now = Date.now();
  const ev = getEvent(p.event_id)!;
  const zones = listZoneRows(ev.id);
  const zoneName = new Map(zones.map((z) => [z.id, z.name]));
  const myDevice = q.get<DeviceRow>(`SELECT * FROM devices WHERE participant_id = ? ORDER BY last_seen_at DESC LIMIT 1`, p.id);
  const incidents = q.all<IncidentRow>(`SELECT * FROM incidents WHERE event_id = ? AND status != 'resolved' ORDER BY created_at DESC LIMIT 20`, ev.id);
  const tasks = q.all<TaskRow>(`SELECT * FROM tasks WHERE event_id = ? AND status != 'done' ORDER BY created_at DESC LIMIT 30`, ev.id);
  const mins = (t: number | null) => (t ? `${Math.max(0, Math.round((now - t) / 60000))} min ago` : 'no data');
  const lines = [
    `Event: ${ev.name} · now ${new Date(now).toLocaleTimeString('en-US', { timeZone: config.EVENT_TZ, hour: 'numeric', minute: '2-digit' })}`,
    `Me: ${p.display_name} (${p.role}) · my location: ${myDevice?.zone_id ? zoneName.get(myDevice.zone_id) : 'not set'}`,
    'Zones:',
    ...zones.map((z) => `- ${z.name}: ${ZONE_STATUS_LABEL[z.current_status as keyof typeof ZONE_STATUS_LABEL]}${z.crowd_level ? ` (${CROWD_LABEL[z.crowd_level as keyof typeof CROWD_LABEL]})` : ''}${z.people_estimate != null ? ` · ~${z.people_estimate} people` : ''} · last seen ${mins(z.last_observed_at)}`),
    'Open incidents:',
    ...(incidents.length ? incidents.map((i) => `- ${zoneName.get(i.zone_id) ?? ''} ${INCIDENT_LABEL[i.incident_type as IncidentType]} · severity ${SEVERITY_LABEL[i.severity as keyof typeof SEVERITY_LABEL]} · ${INCIDENT_STATUS_LABEL[i.status as keyof typeof INCIDENT_STATUS_LABEL]} · ${mins(i.created_at)} · ${i.description}`) : ['- none']),
    'Tasks:',
    ...(tasks.length ? tasks.map((t) => `- ${t.title} · ${TASK_STATUS_LABEL[t.status as keyof typeof TASK_STATUS_LABEL]} · ${t.assignee_id === p.id ? 'mine' : t.assignee_id ? 'someone else' : 'unassigned'}`) : ['- none']),
  ];
  return lines.join('\n');
}
