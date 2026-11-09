// World state: DB rows → wire shapes (shared/contracts.ts), the per-viewer snapshot, and publishing over SSE.
import { createHash, randomBytes } from 'node:crypto';
import type {
  AgentPost, CrewAgent,
  Activity, ActivityKind, AiInfo, OpsState, AttendeeStats, Report, Issue, IssueEvent, Notify, Proposal, TalkMessage, Team, Utterance, Device, EventInfo, Incident, Me, Modality, Observation, ObservationPayload,
  Participant, Snapshot, Task, Zone,
} from '../shared/contracts.ts';
import { q } from './db.ts';
import { presetInfoMark, presetKnowledge } from './eventInfo.ts';
import { eventChannel, publish } from './sse.ts';
import { reportsState } from './reports.ts';
import { crewState } from './crew.ts';

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`;

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type EventRow = { id: string; name: string; join_code: string; admin_key: string; created_at: number; map_json?: string | null; owner_user_id?: string | null };
export type ZoneRow = {
  id: string; event_id: string; name: string; polygon_json: string; current_status: string; status_reason: string | null;
  crowd_level: string | null; people_estimate: number | null; last_observed_at: number | null; version: number; sort: number; deleted_at: number | null;
  zone_type?: string | null; queue_rate?: number | null; track_json?: string | null; last_service_at?: number | null;
};
export type ParticipantRow = { id: string; event_id: string; display_name: string; role: string; token_hash: string; created_at: number; last_seen_at: number; zone_id?: string | null; team_id?: string | null };
export type DeviceRow = {
  id: string; event_id: string; participant_id: string; zone_id: string | null; device_type: string; status: string; label: string;
  last_seen_at: number; last_frame_at: number | null; last_error: string | null; created_at: number; regions_json?: string | null; snapshot_path?: string | null; position_json?: string | null;
};
export type ObservationRow = {
  id: string; event_id: string; zone_id: string; device_id: string; participant_id: string; modality: string; payload_json: string;
  confidence: number; model: string | null; latency_ms: number | null; observed_at: number;
};
export type IncidentRow = {
  id: string; event_id: string; zone_id: string; incident_type: string; severity: string; status: string; description: string;
  created_at: number; updated_at: number; last_evidence_at: number; resolved_at: number | null; resolved_by: string | null;
};
export type TaskRow = {
  id: string; event_id: string; incident_id: string; assignee_id: string | null; title: string; steps_json: string; steps_source: string;
  status: string; created_at: number; updated_at: number;
};
export type ActivityRow = { id: number; event_id: string; kind: string; text: string; ref: string | null; at: number };

// ── Mappers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const toEvent = (r: EventRow): EventInfo => ({ id: r.id, name: r.name, joinCode: r.join_code, createdAt: r.created_at, map: r.map_json ? JSON.parse(r.map_json) : null });

export const toZone = (r: ZoneRow): Zone => ({
  id: r.id, eventId: r.event_id, name: r.name, polygon: JSON.parse(r.polygon_json), status: r.current_status as Zone['status'],
  statusReason: r.status_reason, crowdLevel: r.crowd_level as Zone['crowdLevel'], peopleEstimate: r.people_estimate,
  lastObservedAt: r.last_observed_at, version: r.version,
  zoneType: (r.zone_type ?? 'general') as Zone['zoneType'], queueRate: r.queue_rate ?? null, lastServiceAt: r.last_service_at ?? null,
  track: trackOf(r.track_json),
});

/** zones.track_json holds the server-only ZoneTrackState; only its `track` goes on the wire. */
function trackOf(json: string | null | undefined): Zone['track'] {
  if (!json) return null;
  try { return (JSON.parse(json) as { track?: Zone['track'] }).track ?? null; } catch { return null; }
}

export const toParticipant = (r: ParticipantRow): Participant => ({
  id: r.id, eventId: r.event_id, displayName: r.display_name, role: r.role as Participant['role'], lastSeenAt: r.last_seen_at, teamId: r.team_id ?? null,
});

export const toDevice = (r: DeviceRow): Device => ({
  id: r.id, eventId: r.event_id, participantId: r.participant_id, zoneId: r.zone_id, deviceType: r.device_type as Device['deviceType'],
  mode: r.status as Device['mode'], label: r.label, lastSeenAt: r.last_seen_at, lastFrameAt: r.last_frame_at, lastError: r.last_error,
  regions: r.regions_json ? JSON.parse(r.regions_json) : [], snapshotUrl: r.snapshot_path ? `/media/${r.snapshot_path}` : null,
  position: r.position_json ? JSON.parse(r.position_json) : null,
});

export function toObservation(r: ObservationRow): Observation {
  const inc = q.all<{ incident_id: string }>('SELECT incident_id FROM incident_observations WHERE observation_id = ?', r.id);
  return {
    id: r.id, eventId: r.event_id, zoneId: r.zone_id, deviceId: r.device_id, participantId: r.participant_id,
    modality: r.modality as Modality, payload: JSON.parse(r.payload_json) as ObservationPayload, confidence: r.confidence,
    model: r.model, latencyMs: r.latency_ms, observedAt: r.observed_at, incidentIds: inc.map((x) => x.incident_id),
  };
}

export function toIncident(r: IncidentRow): Incident {
  const ev = q.all<{ observation_id: string; modality: string }>(
    `SELECT io.observation_id, o.modality FROM incident_observations io JOIN observations o ON o.id = io.observation_id
     WHERE io.incident_id = ? ORDER BY o.observed_at DESC`, r.id);
  return {
    id: r.id, eventId: r.event_id, zoneId: r.zone_id, incidentType: r.incident_type as Incident['incidentType'],
    severity: r.severity as Incident['severity'], status: r.status as Incident['status'], description: r.description,
    createdAt: r.created_at, updatedAt: r.updated_at, lastEvidenceAt: r.last_evidence_at, resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by, evidenceCount: ev.length, observationIds: ev.slice(0, 20).map((e) => e.observation_id),
    modalities: [...new Set(ev.map((e) => e.modality as Modality))],
  };
}

export const toTask = (r: TaskRow): Task => ({
  id: r.id, eventId: r.event_id, incidentId: r.incident_id, assigneeId: r.assignee_id, title: r.title,
  steps: JSON.parse(r.steps_json), stepsSource: r.steps_source as Task['stepsSource'], status: r.status as Task['status'],
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export const toActivity = (r: ActivityRow): Activity => ({ id: r.id, eventId: r.event_id, kind: r.kind as ActivityKind, text: r.text, ref: r.ref, at: r.at });

// ── Loaders ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const getEvent = (id: string) => q.get<EventRow>('SELECT * FROM events WHERE id = ?', id);
export const getZoneRow = (id: string) => q.get<ZoneRow>('SELECT * FROM zones WHERE id = ? AND deleted_at IS NULL', id);
export const getDeviceRow = (id: string) => q.get<DeviceRow>('SELECT * FROM devices WHERE id = ?', id);
export const getIncidentRow = (id: string) => q.get<IncidentRow>('SELECT * FROM incidents WHERE id = ?', id);
export const getTaskRow = (id: string) => q.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
export const getParticipantRow = (id: string) => q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', id);
export const listZoneRows = (eventId: string) =>
  q.all<ZoneRow>('SELECT * FROM zones WHERE event_id = ? AND deleted_at IS NULL ORDER BY sort, rowid', eventId);

export function addActivity(eventId: string, kind: ActivityKind, text: string, ref: string | null = null, at = Date.now()): Activity {
  const r = q.run('INSERT INTO activity (event_id, kind, text, ref, at) VALUES (?, ?, ?, ?, ?)', eventId, kind, text, ref, at);
  return { id: Number(r.lastInsertRowid), eventId, kind, text, ref, at };
}

/** The device a participant last joined with (camera or reporter). */
export function primaryDevice(participantId: string): DeviceRow | undefined {
  return q.get<DeviceRow>('SELECT * FROM devices WHERE participant_id = ? ORDER BY last_seen_at DESC, created_at DESC LIMIT 1', participantId);
}

export function toMe(p: ParticipantRow, deviceId?: string | null): Me {
  return {
    participantId: p.id, eventId: p.event_id, role: p.role as Me['role'], displayName: p.display_name,
    deviceId: deviceId !== undefined ? deviceId : (primaryDevice(p.id)?.id ?? null),
  };
}

const SNAPSHOT_INCIDENT_WINDOW_MS = 6 * 3600_000;

/** What assistants know about the event: the organizer's text (run-of-show, FAQ, contacts) plus the preset venue's event info.
 *  An event that never had knowledge adopts the preset info (so organizers see and edit it in Settings); otherwise the preset
 *  info is appended unless the organizer's text already contains it. '' when none. */
export function getKnowledge(eventId: string): string {
  const row = q.get<{ knowledge: string | null; knowledge_updated_at: number | null; map_json: string | null }>(
    'SELECT knowledge, knowledge_updated_at, map_json FROM events WHERE id = ?', eventId);
  const own = row?.knowledge?.trim() ?? '';
  let presetId: string | null = null;
  try { presetId = row?.map_json ? ((JSON.parse(row.map_json) as { presetId?: string }).presetId ?? null) : null; } catch { /* no preset */ }
  const info = presetKnowledge(presetId);
  if (!info) return own;
  if (!own && row?.knowledge_updated_at == null) {
    q.run('UPDATE events SET knowledge = ?, knowledge_updated_at = ? WHERE id = ?', info, Date.now(), eventId);
    return info;
  }
  const mark = presetInfoMark(presetId!);
  return mark && own.includes(mark) ? own : [own, info].filter(Boolean).join('\n\n');
}

export function attendeeStats(eventId: string): AttendeeStats {
  const count = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM participants WHERE event_id = ? AND role = 'attendee'`, eventId)?.n ?? 0;
  const messages = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM chat_messages WHERE event_id = ? AND role = 'user'`, eventId)?.n ?? 0;
  const reports = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM observations WHERE event_id = ? AND modality = 'chat'`, eventId)?.n ?? 0;
  return { count, messages, reports };
}

/** Secret for staff/camera/scribe join links (`&k=`). It is not on the attendee poster and only organizers see it. */
export function joinKeyFor(ev: { admin_key: string }): string {
  return createHash('sha256').update(`${ev.admin_key}:join`).digest('base64url').slice(0, 12);
}

/** Camera/scribe phones (no login) get a device view: their own data, not HQ radio, reports, people or agent prompts. */
function deviceView(snap: Snapshot): Snapshot {
  const mine = new Set(snap.devices.filter((d) => d.participantId === snap.me.participantId).map((d) => d.id));
  const utterances = snap.utterances.filter((u) => mine.has(u.deviceId) || u.participantId === snap.me.participantId);
  const keys = new Set(utterances.flatMap((u) => u.issueKeys ?? []));
  const issues = snap.issues.filter((i) => keys.has(i.key));
  const people = new Set([snap.me.participantId, ...issues.map((i) => i.assigneeId).filter(Boolean) as string[]]);
  return {
    ...snap,
    participants: snap.participants.filter((p) => people.has(p.id)),
    observations: snap.observations.filter((o) => mine.has(o.deviceId)),
    activity: [], utterances, issues, issueEvents: [], proposals: [], messages: [], reports: [], crewPosts: [],
    crew: snap.crew.map((a) => ({ ...a, instructions: '' })),
  };
}

/** SSE filter for a camera/scribe client (same rules as deviceView). Returns undefined to skip a frame. */
export function deviceFrameFilter(participantId: string, eventId: string) {
  const mine = new Set(q.all<{ id: string }>('SELECT id FROM devices WHERE event_id = ? AND participant_id = ?', eventId, participantId).map((d) => d.id));
  const HIDDEN = new Set(['message', 'notify', 'report', 'proposal', 'issue_event', 'agent_post', 'activity']);
  return (event: string, data: unknown): unknown => {
    if (HIDDEN.has(event)) return undefined;
    const d = data as { id?: string; deviceId?: string; participantId?: string };
    if (event === 'device' && d.participantId === participantId && d.id) mine.add(d.id);
    if (event === 'participant') return d.id === participantId ? data : undefined;
    if (event === 'observation') return d.deviceId && mine.has(d.deviceId) ? data : undefined;
    if (event === 'utterance') return (d.deviceId && mine.has(d.deviceId)) || d.participantId === participantId ? data : undefined;
    if (event === 'agent') return { ...(data as CrewAgent), instructions: '' };
    return data;
  };
}

export function buildSnapshot(eventId: string, me: Me, ai: AiInfo, ops: OpsState): Snapshot {
  const snap = buildFullSnapshot(eventId, me, ai, ops);
  if (me.role === 'camera') return deviceView(snap);
  if (me.role === 'admin') return { ...snap, joinKey: joinKeyFor(getEvent(eventId)!) };
  return snap;
}

function buildFullSnapshot(eventId: string, me: Me, ai: AiInfo, ops: OpsState): Snapshot {
  const ev = getEvent(eventId)!;
  const since = Date.now() - SNAPSHOT_INCIDENT_WINDOW_MS;
  const incidents = q.all<IncidentRow>(
    `SELECT * FROM incidents WHERE event_id = ? AND (status != 'resolved' OR resolved_at >= ?) ORDER BY created_at DESC LIMIT 200`, eventId, since);
  const incidentIds = new Set(incidents.map((i) => i.id));
  const tasks = q.all<TaskRow>('SELECT * FROM tasks WHERE event_id = ? ORDER BY created_at DESC LIMIT 400', eventId).filter((t) => incidentIds.has(t.incident_id));
  return {
    event: toEvent(ev),
    me,
    zones: listZoneRows(eventId).map(toZone),
    devices: q.all<DeviceRow>('SELECT * FROM devices WHERE event_id = ? ORDER BY created_at', eventId).map(toDevice),
    participants: q.all<ParticipantRow>('SELECT * FROM participants WHERE event_id = ? ORDER BY created_at', eventId).map(toParticipant),
    incidents: incidents.map(toIncident),
    tasks: tasks.map(toTask),
    observations: q.all<ObservationRow>('SELECT * FROM observations WHERE event_id = ? ORDER BY observed_at DESC LIMIT 60', eventId).map(toObservation),
    activity: q.all<ActivityRow>('SELECT * FROM activity WHERE event_id = ? ORDER BY id DESC LIMIT 100', eventId).map(toActivity),
    attendees: attendeeStats(eventId),
    ...ops,
    ...reportsState(eventId),
    ...crewState(eventId),
    ai,
    serverTime: Date.now(),
  };
}

// ── Publishing (always AFTER the transaction commits) ───────────────────────────────────────────────────────────────

export type Frame =
  | ['zone', Zone] | ['device', Device] | ['participant', Participant] | ['incident', Incident] | ['task', Task]
  | ['observation', Observation] | ['activity', Activity] | ['zone_removed', { id: string }]
  | ['team', Team] | ['team_removed', { id: string }] | ['issue', Issue] | ['issue_event', IssueEvent] | ['proposal', Proposal]
  | ['utterance', Utterance] | ['message', TalkMessage] | ['notify', Notify] | ['report', Report] | ['event', EventInfo]
  | ['agent', CrewAgent] | ['agent_post', AgentPost] | ['agent_removed', { id: string }];

export function publishAll(eventId: string, frames: Frame[]) {
  const ch = eventChannel(eventId);
  for (const [event, data] of frames) publish(ch, event, data);
}
