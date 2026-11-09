// Calibrated multi-zone cameras: regions drawn on the camera's own view (normalized 0..1) map to zones. Each frame (with the
// numbered outlines already drawn by the phone) gets ONE vision call that reports per region → one observation per zone.
import { agentFocus } from './crew.ts';
import type { Request, Response } from 'express';
import {
  CAPTURE_INTERVAL_MS, CERTAINTY_WEIGHT, VIEW_WEIGHT, ZONE_TYPE_PROFILE,
  type CameraRegion, type Certainty, type CrowdLevel, type FrameResult, type Modality, type ObservationPayload, type ObservationResult,
  type VisionPayload, type ZoneType,
} from '../shared/contracts.ts';
import { AiError, aiInfo } from './ai.ts';
import { analyzeRegions, type RegionResult } from './ai3.ts';
import { q } from './db.ts';
import { deleteMedia, mediaUrl, saveMedia } from './media.ts';
import { aiErrToHttp, HttpErr, markDeviceError } from './routes.ts';
import { getDeviceRow, getZoneRow, publishAll, toDevice, type DeviceRow, type ParticipantRow, type ZoneRow } from './world.ts';

export type CommitFn = (args: {
  device: DeviceRow; participant: ParticipantRow; zone: ZoneRow; modality: Modality; payload: ObservationPayload;
  confidence: number; model: string | null; latencyMs: number | null;
}) => ObservationResult;

export const regionsOf = (d: DeviceRow): CameraRegion[] => {
  try { return d.regions_json ? (JSON.parse(d.regions_json) as CameraRegion[]) : []; } catch { return []; }
};

export function saveSnapshot(device: DeviceRow, buf: Buffer, mime: string): string {
  const rel = saveMedia('snapshots', buf, mime);
  q.run('UPDATE devices SET snapshot_path = ?, last_seen_at = ? WHERE id = ?', rel, Date.now(), device.id);
  if (device.snapshot_path) deleteMedia(device.snapshot_path);
  publishAll(device.event_id, [['device', toDevice(getDeviceRow(device.id)!)]]);
  return mediaUrl(rel)!;
}

export function saveRegions(device: DeviceRow, regions: CameraRegion[]): void {
  q.run('UPDATE devices SET regions_json = ? WHERE id = ?', regions.length ? JSON.stringify(regions) : null, device.id);
  // A calibrated camera's own zone = the first region's zone (keeps the single-zone views sensible).
  if (regions[0]) q.run('UPDATE devices SET zone_id = ? WHERE id = ?', regions[0].zoneId, device.id);
  publishAll(device.event_id, [['device', toDevice(getDeviceRow(device.id)!)]]);
}

const STEP_DOWN: Record<Certainty, Certainty> = { high: 'medium', medium: 'low', low: 'low' };

/** THE single place a per-region vision result becomes an observation payload (VisionPayload v2; legacy fields kept filled
 *  so MIN_STATE_CONFIDENCE / MIN_INCIDENT_CONFIDENCE keep their meaning). Used by single-zone AND calibrated cameras. */
export function regionToObservation(r0: RegionResult, zoneType: ZoneType): { payload: VisionPayload; confidence: number } {
  const r = { ...r0 };
  const mask = ZONE_TYPE_PROFILE[zoneType].vision;
  if (!mask.includes('queue')) { r.queue_people = 0; r.queue_spills = false; }
  if (!mask.includes('seating')) r.seating = 'na';
  if (!mask.includes('walkway')) r.walkway = 'na';
  const queue = Math.max(0, Math.min(200, Math.round(r.queue_people)));
  const people = Math.max(Math.max(0, Math.min(5000, Math.round(r.people_count))), queue);
  let crowd: CrowdLevel = r.crowd_level;
  if (people === 0) crowd = 'empty'; else if (crowd === 'empty') crowd = 'low';
  let cert = r.certainty;
  if ((crowd === 'high' || crowd === 'critical') && people < 4) cert = STEP_DOWN[cert]; // self-contradiction
  const c = Math.round(CERTAINTY_WEIGHT[cert] * VIEW_WEIGHT[r.view] * 100) / 100;
  const payload: VisionPayload = {
    kind: 'vision', v: 2, scene_ok: r.view === 'good' || r.view === 'partial', people_count: people, crowd_level: crowd,
    queue_present: queue >= 2, summary: r.seen,
    hazards: r.hazards.map((h) => ({ type: h.type, confidence: Math.round(CERTAINTY_WEIGHT[h.certainty] * VIEW_WEIGHT[r.view] * 100) / 100, detail: h.where })),
    confidence: c, view: r.view, certainty: cert, queue_people: queue, queue_spills: r.queue_spills, seating: r.seating, walkway: r.walkway,
  };
  return { payload, confidence: c };
}

/** Single-zone camera: the whole frame is one region of the zone's type. */
export async function analyzeWholeFrame(buf: Buffer, mime: string, zone: ZoneRow, focus?: string | null): Promise<{ payload: VisionPayload; confidence: number; model: string; latencyMs: number }> {
  const type = (zone.zone_type ?? 'general') as ZoneType;
  const out = await analyzeRegions({ mime, buf }, [{ name: zone.name, type, wholeFrame: true }], 'low', focus);
  const r = out.results[0];
  if (!r) throw new AiError('AI_FAILED', 'The AI could not read the frame.');
  return { ...regionToObservation(r, type), model: out.model, latencyMs: out.latencyMs };
}

const inFlight = new Set<string>();

export async function handleRegionFrame(req: Request, res: Response, device: DeviceRow, participant: ParticipantRow, commit: CommitFn) {
  const regions = regionsOf(device);
  const zones = regions.map((r) => getZoneRow(r.zoneId)).filter((z): z is ZoneRow => !!z && z.event_id === device.event_id);
  if (!zones.length) throw new HttpErr(400, 'NO_ZONE', 'This camera has no valid regions. Recalibrate it.');
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new HttpErr(400, 'NO_IMAGE', 'The photo is empty.');
  if (!aiInfo().enabled) throw aiErrToHttp(new AiError('AI_DISABLED', ''));
  if (inFlight.has(device.id)) throw new HttpErr(429, 'BUSY', 'Still analysing the previous frame.');
  inFlight.add(device.id);
  const t0 = Date.now();
  try {
    q.run(`UPDATE devices SET last_frame_at = ?, last_seen_at = ?, status = 'observing' WHERE id = ?`, t0, t0, device.id);
    const specs = regions.map((r) => { const z = getZoneRow(r.zoneId); return { name: z?.name ?? 'Zone', type: ((z?.zone_type ?? 'general') as ZoneType) }; });
    let out;
    try {
      out = await analyzeRegions({ mime: String(req.headers['content-type'] ?? 'image/jpeg').split(';')[0], buf: req.body }, specs, 'high', agentFocus(device.id)?.instructions);
    } catch (e) {
      markDeviceError(device, e instanceof AiError && e.code === 'AI_TIMEOUT' ? 'AI slow to respond' : 'AI unavailable');
      throw aiErrToHttp(e);
    }
    const results: ObservationResult[] = [];
    for (const r of out.results) {
      const region = regions[r.region - 1];
      const zone = region ? getZoneRow(region.zoneId) : undefined;
      if (!zone || zone.event_id !== device.event_id) continue;
      const obs = regionToObservation(r, (zone.zone_type ?? 'general') as ZoneType);
      results.push(commit({
        device: getDeviceRow(device.id)!, participant, zone, modality: 'vision', payload: obs.payload, confidence: obs.confidence,
        model: out.model, latencyMs: out.latencyMs,
      }));
    }
    if (!results.length) throw new HttpErr(502, 'AI_FAILED', 'The AI could not read any region. Check the camera angle.');
    const body: FrameResult = { ...results[0], results, nextInMs: Math.max(0, CAPTURE_INTERVAL_MS - (Date.now() - t0)) };
    res.json(body);
  } finally {
    inFlight.delete(device.id);
  }
}
