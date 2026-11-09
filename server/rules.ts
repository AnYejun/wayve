// Deterministic world rules. The model only PROPOSES structured observations; everything here decides:
//   observation (immutable) → zone state → incident candidates → dedupe (event, zone, type, window) → task + assignee.
// Call applyObservation() inside tx(); publish the returned frames after commit.
import {
  CROWD_LABEL, DEDUPE_WINDOW_MS, DEVICE_OFFLINE_MS, INCIDENT_LABEL, MIN_INCIDENT_CONFIDENCE, MIN_STATE_CONFIDENCE, SEVERITIES,
  type CrowdLevel, type HazardType, type Incident, type IncidentType, type Modality, type ObservationPayload, type Severity,
  type Task, type TrackSource, type ZoneStatus, type ZoneType, TIER_STATUS, ZONE_TRACK, ZONE_TYPE_PROFILE,
} from '../shared/contracts.ts';
import { q } from './db.ts';
import { onZoneTrackChange } from './crew.ts';
import { deriveZone, parseState, sampleOf, type Candidate, type Sibling } from './zoneTrack.ts';
import {
  addActivity, getZoneRow, listZoneRows, newId, toIncident, toObservation, toTask, toZone,
  type DeviceRow, type Frame, type IncidentRow, type ParticipantRow, type TaskRow, type ZoneRow,
} from './world.ts';

/** Severity is decided by type — never by the model. */
export const SEVERITY_BY_TYPE: Record<IncidentType, Severity> = {
  fire_smoke: 'critical', medical: 'critical', fight: 'high', overcrowding: 'high', suspicious_item: 'high',
  spill: 'medium', obstruction: 'medium', long_queue: 'low', other: 'low',
};

const HAZARD_TO_INCIDENT: Record<HazardType, IncidentType> = {
  fire_smoke: 'fire_smoke', spill: 'spill', obstruction: 'obstruction', fall_injury: 'medical', fight: 'fight', medical: 'medical',
  crowd_crush: 'overcrowding', suspicious_item: 'suspicious_item', other: 'other',
};

const CROWD_TO_STATUS: Record<CrowdLevel, ZoneStatus> = { empty: 'clear', low: 'clear', moderate: 'busy', high: 'crowded', critical: 'critical' };

export const TASK_TITLE: Record<IncidentType, string> = {
  overcrowding: 'Ease the crowd · hold entry', fire_smoke: 'Check fire / smoke · decide on evacuation', spill: 'Check and clean the spill',
  obstruction: 'Clear the blocked path', medical: 'Check on the person · call medical', fight: 'Check the altercation · call security',
  suspicious_item: 'Check the item · keep people away', long_queue: 'Manage the queue · redirect people', other: 'Check on site',
};

/** Fallback action steps when the agent is off or fails (labelled "Standard steps", source 'rule'). */
export const RULE_STEPS: Record<IncidentType, string[]> = {
  overcrowding: ['Pause entry at the zone entrance', 'Direct the flow to the next zone', 'Mark done once the crowd eases'],
  fire_smoke: ['Alert the safety team and HQ now', 'Guide people near the smoke to the exits', "Don't approach if it isn't safe to"],
  spill: ['Warn people about the slippery floor', 'Clean it up with the spill kit', 'Mark done once the floor is clear'],
  obstruction: ['Check what is blocking the path', 'Move it aside or ask for help', 'Mark done once the path is open'],
  medical: ['Call the medical team right away', 'Give the person some space', 'Stay with them until medics arrive'],
  fight: ['Call security', "Don't step in alone; move bystanders back", 'Mark done once it has calmed down'],
  suspicious_item: ["Don't touch it; keep people away", 'Tell HQ exactly where it is', 'Follow HQ instructions'],
  long_queue: ['Put someone at the end of the line', 'Open another desk or reroute people', 'Mark done once the line is short'],
  other: ['Check the spot in person', 'Tell HQ if you need help', 'Mark done once it is sorted'],
};

const sevRank = (s: Severity) => SEVERITIES.indexOf(s);
const maxSev = (a: Severity, b: Severity) => (sevRank(a) >= sevRank(b) ? a : b);
/** Type severity, raised (never lowered) by the zone type (a blocked entrance/corridor is an egress problem). */
export const severityFor = (t: IncidentType, zt: ZoneType): Severity => maxSev(SEVERITY_BY_TYPE[t], ZONE_TYPE_PROFILE[zt]?.severity[t] ?? 'low');

/** After an incident is resolved, the same camera-only signal may not reopen it for this long (avoid flapping). */
const VISION_COOLDOWN_MS = 90_000;



export function candidatesFor(modality: Modality, payload: ObservationPayload, confidence: number): Candidate[] {
  const out: Candidate[] = [];
  const push = (c: Candidate) => { if (!out.some((x) => x.type === c.type)) out.push(c); };
  if (payload.kind === 'vision') {
    if (!payload.scene_ok) return out;
    for (const h of payload.hazards) {
      if (h.confidence >= MIN_INCIDENT_CONFIDENCE) push({ type: HAZARD_TO_INCIDENT[h.type], detail: h.detail, confidence: h.confidence });
    }
    if (payload.crowd_level === 'critical' && confidence >= MIN_INCIDENT_CONFIDENCE) {
      push({ type: 'overcrowding', detail: `~${payload.people_count} people · packed`, confidence });
    }
  } else if (payload.kind === 'report') {
    // Attendee chat is less reliable than staff reports: it needs the full incident threshold.
    const min = modality === 'chat' ? MIN_INCIDENT_CONFIDENCE : 0.5;
    if (payload.issue_type !== 'none' && confidence >= min) push({ type: payload.issue_type, detail: payload.summary, confidence });
    if (payload.crowd_level === 'critical' && confidence >= min) push({ type: 'overcrowding', detail: payload.summary, confidence });
  } else {
    if (payload.issue_type) push({ type: payload.issue_type, detail: payload.note || INCIDENT_LABEL[payload.issue_type], confidence: 1 });
    if (payload.crowd_level === 'critical') push({ type: 'overcrowding', detail: payload.note || 'Packed (manual)', confidence: 1 });
  }
  void modality;
  return out;
}

/** Recompute a zone's derived status from its crowd level + open severe incidents. Returns the row if it changed. */
export function recomputeZone(zoneId: string, now = Date.now()): ZoneRow | null {
  const z = getZoneRow(zoneId);
  if (!z) return null;
  const severe = q.get<{ incident_type: string; severity: string }>(
    `SELECT incident_type, severity FROM incidents WHERE zone_id = ? AND status != 'resolved' AND severity IN ('high','critical')
     ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`, zoneId);
  const track = z.track_json ? parseState(z.track_json, now).track : null;
  const base: ZoneStatus = track && (track.nUsable > 0 || track.lastHumanAt != null || track.hold)
    ? TIER_STATUS[track.tier]
    : z.crowd_level ? CROWD_TO_STATUS[z.crowd_level as CrowdLevel] : z.last_observed_at ? 'clear' : 'unknown';
  const status: ZoneStatus = severe ? 'alert' : base;
  let reason = z.status_reason;
  if (severe) reason = `${severe.severity === 'critical' ? 'Critical' : 'High'} · ${INCIDENT_LABEL[severe.incident_type as IncidentType]}`;
  else if (z.current_status === 'alert') reason = z.crowd_level ? `${CROWD_LABEL[z.crowd_level as CrowdLevel]}${z.people_estimate != null ? ` · ~${z.people_estimate} people` : ''}` : null;
  if (status === z.current_status && reason === z.status_reason) return null;
  q.run('UPDATE zones SET current_status = ?, status_reason = ?, version = version + 1 WHERE id = ?', status, reason, zoneId);
  return getZoneRow(zoneId)!;
}

/** Staff to assign: prefer online staff standing in the zone, then online staff with the fewest open tasks, then anyone. */
export function pickAssignee(eventId: string, zoneId: string, now = Date.now()): ParticipantRow | null {
  const staff = q.all<ParticipantRow & { zone_id: string | null; dev_seen: number | null; load: number }>(
    `SELECT p.*, d.zone_id AS zone_id, d.last_seen_at AS dev_seen,
       (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = p.id AND t.status != 'done') AS load
     FROM participants p LEFT JOIN devices d ON d.participant_id = p.id AND d.device_type = 'reporter'
     WHERE p.event_id = ? AND p.role = 'staff'`, eventId);
  if (!staff.length) return null;
  const online = (s: (typeof staff)[number]) => Math.max(s.last_seen_at, s.dev_seen ?? 0) > now - DEVICE_OFFLINE_MS;
  staff.sort((a, b) =>
    Number(online(b)) - Number(online(a))
    || Number(b.zone_id === zoneId) - Number(a.zone_id === zoneId)
    || a.load - b.load
    || a.created_at - b.created_at);
  return staff[0];
}

export interface ApplyInput {
  eventId: string;
  zone: ZoneRow;
  device: DeviceRow;
  participant: ParticipantRow;
  modality: Modality;
  payload: ObservationPayload;
  confidence: number;
  model: string | null;
  latencyMs: number | null;
  now?: number;
}

export interface ApplyOutput {
  observationId: string;
  frames: Frame[];
  incidents: Incident[];
  tasks: Task[];
  newTasks: Array<{ taskId: string; incidentId: string }>;
}

export function applyObservation(inp: ApplyInput): ApplyOutput {
  const now = inp.now ?? Date.now();
  const { eventId, zone, device, participant, modality, payload } = inp;
  const confidence = Math.max(0, Math.min(1, inp.confidence));
  const frames: Frame[] = [];

  // 1. Immutable observation.
  const obsId = newId('ob');
  q.run(
    `INSERT INTO observations (id, event_id, zone_id, device_id, participant_id, modality, payload_json, confidence, model, latency_ms, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    obsId, eventId, zone.id, device.id, participant.id, modality, JSON.stringify(payload), confidence, inp.model, inp.latencyMs, now);

  // 2. Zone tracking (server/zoneTrack.ts): window smoothing, multi-camera fusion, k-of-n flags, hysteresis, human floor.
  //    Low-confidence / unusable frames are recorded (observation + bucket count) but never move values.
  const zt = (zone.zone_type ?? 'general') as ZoneType;
  const sample = sampleOf({ payload, modality, confidence, deviceId: device.id, at: now, label: device.label });
  let trackCandidates: Candidate[] | null = null;
  if (sample) {
    const then = q.all<{ crowd: number | null; people: number | null }>(
      'SELECT crowd, people FROM zone_metrics WHERE zone_id = ? AND bucket BETWEEN ? AND ? AND n_ok >= 2', zone.id, now - 150_000, now - 90_000);
    const siblings: Sibling[] = listZoneRows(eventId).filter((z) => z.id !== zone.id)
      .map((z) => ({ id: z.id, name: z.name, zoneType: (z.zone_type ?? 'general') as ZoneType, track: parseState(z.track_json, now).track }));
    const kind: TrackSource['kind'] = 'cam' in sample ? 'camera' : sample.human.src;
    const prevTrack = parseState(zone.track_json, now).track;
    const out = deriveZone(parseState(zone.track_json, now), sample, {
      now, type: zt, queueRate: zone.queue_rate ?? null, then, siblings, source: { kind, id: device.id, label: device.label, at: now },
    });
    const observed = 'cam' in sample ? sample.cam.ok : true;
    q.run(
      `UPDATE zones SET track_json = ?, crowd_level = COALESCE(?, crowd_level), people_estimate = COALESCE(?, people_estimate),
         status_reason = COALESCE(?, status_reason), last_observed_at = CASE WHEN ? THEN ? ELSE last_observed_at END, version = version + 1 WHERE id = ?`,
      JSON.stringify(out.state), out.crowdLevel, out.people, out.reason, observed ? 1 : 0, now, zone.id);
    const b = out.bucket;
    q.run(
      `INSERT INTO zone_metrics (zone_id, bucket, event_id, n_obs, n_ok, crowd, people, queue, wait_min, seats_free, walkway, hazard, tier, status, conf)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(zone_id, bucket) DO UPDATE SET
         n_obs = n_obs + 1, n_ok = n_ok + excluded.n_ok,
         crowd = COALESCE(excluded.crowd, crowd), people = COALESCE(excluded.people, people), queue = COALESCE(excluded.queue, queue),
         wait_min = COALESCE(excluded.wait_min, wait_min), seats_free = COALESCE(excluded.seats_free, seats_free),
         walkway = NULLIF(max(COALESCE(walkway, -1), COALESCE(excluded.walkway, -1)), -1),
         hazard = max(COALESCE(hazard, 0), COALESCE(excluded.hazard, 0)), tier = max(COALESCE(tier, 0), COALESCE(excluded.tier, 0)),
         status = excluded.status, conf = COALESCE(excluded.conf, conf)`,
      zone.id, Math.floor(now / ZONE_TRACK.BUCKET_MS) * ZONE_TRACK.BUCKET_MS, eventId, b.nOk, b.crowd, b.people, b.queue, b.wait, b.seats,
      b.walkway, b.hazard, b.tier, TIER_STATUS[out.state.track.tier], b.conf);
    if ('cam' in sample && payload.kind === 'vision') trackCandidates = out.candidates;
    // AI crew: a camera agent covering this zone speaks up on the radio when the tracked action changes.
    frames.push(...onZoneTrackChange({ ...zone, people_estimate: out.people ?? zone.people_estimate, crowd_level: out.crowdLevel ?? zone.crowd_level }, prevTrack, out.state.track, now));
  }

  // 3. Incident candidates → dedupe → create/merge.
  const touched = new Map<string, IncidentRow>();
  const newTasks: ApplyOutput['newTasks'] = [];
  const createdTasks: TaskRow[] = [];
  // Camera frames open incidents only from the windowed tracker (persistence, k-of-n); reports/manual keep the direct rules.
  for (const c of trackCandidates ?? candidatesFor(modality, payload, confidence)) {
    const sev = severityFor(c.type, zt);
    const existing = q.get<IncidentRow>(
      `SELECT * FROM incidents WHERE event_id = ? AND zone_id = ? AND incident_type = ? AND status != 'resolved' AND last_evidence_at >= ?
       ORDER BY last_evidence_at DESC LIMIT 1`, eventId, zone.id, c.type, now - DEDUPE_WINDOW_MS);
    if (existing) {
      q.run('INSERT OR IGNORE INTO incident_observations (incident_id, observation_id, linked_at) VALUES (?, ?, ?)', existing.id, obsId, now);
      q.run('UPDATE incidents SET last_evidence_at = ?, updated_at = ?, severity = ? WHERE id = ?',
        now, now, maxSev(existing.severity as Severity, sev), existing.id);
      touched.set(existing.id, q.get<IncidentRow>('SELECT * FROM incidents WHERE id = ?', existing.id)!);
      continue;
    }
    if (modality === 'vision') {
      const recent = q.get<{ id: string }>(
        `SELECT id FROM incidents WHERE event_id = ? AND zone_id = ? AND incident_type = ? AND status = 'resolved' AND resolved_at >= ? LIMIT 1`,
        eventId, zone.id, c.type, now - VISION_COOLDOWN_MS);
      if (recent) continue;
    }
    const incId = newId('in');
    const desc = `${INCIDENT_LABEL[c.type]} — ${c.detail}`.slice(0, 200);
    q.run(
      `INSERT INTO incidents (id, event_id, zone_id, incident_type, severity, status, description, created_at, updated_at, last_evidence_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`, incId, eventId, zone.id, c.type, sev, desc, now, now, now);
    q.run('INSERT INTO incident_observations (incident_id, observation_id, linked_at) VALUES (?, ?, ?)', incId, obsId, now);
    touched.set(incId, q.get<IncidentRow>('SELECT * FROM incidents WHERE id = ?', incId)!);

    const assignee = pickAssignee(eventId, zone.id, now);
    const taskId = newId('tk');
    q.run(
      `INSERT INTO tasks (id, event_id, incident_id, assignee_id, title, steps_json, steps_source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 'open', ?, ?)`,
      taskId, eventId, incId, assignee?.id ?? null, `${zone.name} · ${TASK_TITLE[c.type]}`, '[]', now, now);
    createdTasks.push(q.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', taskId)!);
    newTasks.push({ taskId, incidentId: incId });
    frames.push(['activity', addActivity(eventId, 'incident', `${INCIDENT_LABEL[c.type]} detected in ${zone.name} (${modalityText(modality)})`, incId, now)]);
    frames.push(['activity', addActivity(eventId, 'task', assignee ? `Assigned to ${assignee.display_name} · ${TASK_TITLE[c.type]}` : `No staff available to assign · ${TASK_TITLE[c.type]}`, taskId, now)]);
  }
  for (const inc of touched.values()) {
    if (inc.created_at !== now) { // merged into an existing incident (dedupe), not newly opened
      frames.push(['activity', addActivity(eventId, 'incident', `More evidence for ${INCIDENT_LABEL[inc.incident_type as IncidentType]} in ${zone.name} (${modalityText(modality)})`, inc.id, now)]);
    }
  }

  // 4. Derived status after incidents.
  recomputeZone(zone.id, now);

  const obs = toObservation(q.get('SELECT * FROM observations WHERE id = ?', obsId)!);
  const zoneWire = toZone(getZoneRow(zone.id)!);
  const incidents = [...touched.values()].map(toIncident);
  const tasks = createdTasks.map(toTask);
  frames.unshift(['observation', obs], ['zone', zoneWire]);
  for (const i of incidents) frames.push(['incident', i]);
  for (const t of tasks) frames.push(['task', t]);
  frames.push(['activity', addActivity(eventId, 'observation', observationLine(device.label, zone.name, modality, payload), obsId, now)]);
  return { observationId: obsId, frames, incidents, tasks, newTasks };
}

const modalityText = (m: Modality) => ({ vision: 'camera', voice: 'voice report', text: 'text report', manual: 'manual', chat: 'attendee chat' })[m];

function observationLine(label: string, zoneName: string, modality: Modality, p: ObservationPayload): string {
  if (p.kind === 'vision') {
    if (!p.scene_ok) return `${label} · ${zoneName} — can't see clearly`;
    return `${label} · ${zoneName} — ${p.summary}`;
  }
  if (p.kind === 'report') return `${label} · ${zoneName} — ${modality === 'voice' ? 'Voice report' : modality === 'chat' ? 'Attendee report' : 'Text report'}: ${p.summary}`;
  const bits = [p.crowd_level ? CROWD_LABEL[p.crowd_level] : null, p.issue_type ? INCIDENT_LABEL[p.issue_type] : null, p.note].filter(Boolean);
  return `${label} · ${zoneName} — Manual: ${bits.join(' · ') || 'note'}`;
}

/** Resolve an incident (and close its open tasks). Returns frames to publish. */
export function resolveIncident(incidentId: string, byParticipant: ParticipantRow, now = Date.now()): Frame[] {
  const inc = q.get<IncidentRow>('SELECT * FROM incidents WHERE id = ?', incidentId);
  if (!inc || inc.status === 'resolved') return [];
  q.run(`UPDATE incidents SET status = 'resolved', resolved_at = ?, resolved_by = ?, updated_at = ? WHERE id = ?`, now, byParticipant.id, now, incidentId);
  const open = q.all<TaskRow>(`SELECT * FROM tasks WHERE incident_id = ? AND status != 'done'`, incidentId);
  q.run(`UPDATE tasks SET status = 'done', updated_at = ? WHERE incident_id = ? AND status != 'done'`, now, incidentId);
  const frames: Frame[] = [['incident', toIncident(q.get<IncidentRow>('SELECT * FROM incidents WHERE id = ?', incidentId)!)]];
  for (const t of open) frames.push(['task', toTask(q.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', t.id)!)]);
  const z = recomputeZone(inc.zone_id, now);
  const zoneRow = z ?? getZoneRow(inc.zone_id);
  if (zoneRow) frames.push(['zone', toZone(zoneRow)]);
  frames.push(['activity', addActivity(inc.event_id, 'incident', `${byParticipant.display_name} resolved ${INCIDENT_LABEL[inc.incident_type as IncidentType]} in ${zoneRow?.name ?? 'a zone'}`, incidentId, now)]);
  return frames;
}

export function acknowledgeIncident(incidentId: string, by: ParticipantRow, now = Date.now()): Frame[] {
  const inc = q.get<IncidentRow>('SELECT * FROM incidents WHERE id = ?', incidentId);
  if (!inc || inc.status !== 'open') return [];
  q.run(`UPDATE incidents SET status = 'acknowledged', updated_at = ? WHERE id = ?`, now, incidentId);
  const zoneRow = getZoneRow(inc.zone_id);
  return [
    ['incident', toIncident(q.get<IncidentRow>('SELECT * FROM incidents WHERE id = ?', incidentId)!)],
    ['activity', addActivity(inc.event_id, 'incident', `${by.display_name} is responding to ${INCIDENT_LABEL[inc.incident_type as IncidentType]} in ${zoneRow?.name ?? 'a zone'}`, incidentId, now)],
  ];
}
