// WAYVE shared contract — the ONLY types the server and the web app exchange.
// Server: server/*.ts imports these. Web: import from '@shared/contracts'.
// Rule: observations are immutable facts; zones/incidents/tasks are mutable world state derived by deterministic rules.

// ── Enums ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** attendee = event visitor in the chatbot (lowest rank: no map/stream access, only /api/chat). */
export const ROLES = ['admin', 'staff', 'camera', 'attendee'] as const;
export type Role = (typeof ROLES)[number];

export const CROWD_LEVELS = ['empty', 'low', 'moderate', 'high', 'critical'] as const;
export type CrowdLevel = (typeof CROWD_LEVELS)[number];

/** Zone status is derived on the server (server/rules.ts). 'unknown' = never observed. 'alert' = open high/critical incident. */
export const ZONE_STATUSES = ['unknown', 'clear', 'busy', 'crowded', 'critical', 'alert'] as const;
export type ZoneStatus = (typeof ZONE_STATUSES)[number];

export const INCIDENT_TYPES = [
  'overcrowding', 'fire_smoke', 'spill', 'obstruction', 'medical', 'fight', 'suspicious_item', 'long_queue', 'other',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const TASK_STATUSES = ['open', 'accepted', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** chat = something an attendee told the event chatbot (structured into a report). */
export const MODALITIES = ['vision', 'voice', 'text', 'manual', 'chat'] as const;
export type Modality = (typeof MODALITIES)[number];

/** scribe = a phone left on to transcribe a meeting / desk (ops tracker input). */
export type DeviceType = 'camera' | 'reporter' | 'scribe';
/** Set by the device itself. Online/offline is derived from lastSeenAt (see DEVICE_OFFLINE_MS). */
export type DeviceMode = 'idle' | 'observing' | 'paused';

// ── Timing constants (shared so UI and server agree) ─────────────────────────────────────────────────────────────────

/** A zone whose last observation is older than this is shown as stale. */
export const ZONE_STALE_MS = 180_000;
/** A device not seen for this long is shown as disconnected. Devices heartbeat every 10 s. */
export const DEVICE_OFFLINE_MS = 25_000;
export const HEARTBEAT_MS = 10_000;
/** Camera capture cadence (brief: every 3–5 s). The next capture waits for the previous upload to finish. */
export const CAPTURE_INTERVAL_MS = 4_000;
/** Max long edge of an uploaded frame (px). JPEG quality 0.72. */
export const CAPTURE_MAX_EDGE = 768;
/** Incidents with the same event + zone + type within this window are merged (dedupe). */
export const DEDUPE_WINDOW_MS = 10 * 60_000;
/** Below this model confidence an observation is recorded but does not change zone state. */
export const MIN_STATE_CONFIDENCE = 0.4;
/** Below this confidence a hazard / report does not open an incident. */
export const MIN_INCIDENT_CONFIDENCE = 0.6;

/** Map coordinate space for zone polygons (SVG viewBox "0 0 1000 640"). */
export const MAP_W = 1000;
export const MAP_H = 640;

// ── UI labels (English) ─────────────────────────────────────────────────────────────────────────

export const CROWD_LABEL: Record<CrowdLevel, string> = {
  empty: 'Empty', low: 'Light', moderate: 'Moderate', high: 'Busy', critical: 'Packed',
};
export const ZONE_STATUS_LABEL: Record<ZoneStatus, string> = {
  unknown: 'No data', clear: 'Clear', busy: 'Moderate', crowded: 'Busy', critical: 'Packed', alert: 'Alert',
};
export const INCIDENT_LABEL: Record<IncidentType, string> = {
  overcrowding: 'Overcrowding', fire_smoke: 'Fire / smoke', spill: 'Spill', obstruction: 'Blocked path', medical: 'Medical',
  fight: 'Altercation', suspicious_item: 'Suspicious item', long_queue: 'Long queue', other: 'Other',
};
export const SEVERITY_LABEL: Record<Severity, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = { open: 'New', acknowledged: 'Responding', resolved: 'Resolved' };
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { open: 'New', accepted: 'In progress', done: 'Done' };
export const MODALITY_LABEL: Record<Modality, string> = { vision: 'Camera', voice: 'Voice', text: 'Text', manual: 'Manual', chat: 'Attendee chat' };

// ── Observation payloads (immutable) ─────────────────────────────────────────────────────────────────────────────────

export const HAZARD_TYPES = [
  'fire_smoke', 'spill', 'obstruction', 'fall_injury', 'fight', 'medical', 'crowd_crush', 'suspicious_item', 'other',
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

/** What the vision model returns for one frame (validated with zod on the server). */
export interface VisionPayload {
  kind: 'vision';
  scene_ok: boolean;          // false = too dark / blurry / lens covered
  people_count: number;       // estimate
  crowd_level: CrowdLevel;
  queue_present: boolean;
  hazards: Array<{ type: HazardType; confidence: number; detail: string }>;
  summary: string;            // Korean, one sentence
  confidence: number;         // 0..1 overall
}

/** Voice or text report, structured by the text model. `transcript` = what the person said/typed (audio is never stored). */
export interface ReportPayload {
  kind: 'report';
  transcript: string;
  issue_type: IncidentType | 'none';
  crowd_level: CrowdLevel | null;
  summary: string;
  zone_hint: string | null;   // zone name the person mentioned, if any (matched deterministically on the server)
  confidence: number;
}

/** Manual fallback (human-entered, confidence 1). */
export interface ManualPayload {
  kind: 'manual';
  crowd_level: CrowdLevel | null;
  issue_type: IncidentType | null;
  note: string | null;
}

export type ObservationPayload = VisionPayload | ReportPayload | ManualPayload;

// ── World entities (wire shapes; times are epoch ms) ─────────────────────────────────────────────────────────────────

export interface EventInfo { id: string; name: string; joinCode: string; createdAt: number; map: VenueMapInfo | null }

export interface Zone {
  id: string;
  eventId: string;
  name: string;
  polygon: Array<[number, number]>;   // map coordinates (MAP_W × MAP_H)
  status: ZoneStatus;
  statusReason: string | null;        // short reason, e.g. "Camera 2 · ~34 people"
  crowdLevel: CrowdLevel | null;
  peopleEstimate: number | null;
  lastObservedAt: number | null;
  version: number;
}

export interface Participant {
  id: string;
  eventId: string;
  displayName: string;
  role: Role;
  lastSeenAt: number;
  teamId: string | null;
}

export interface Device {
  id: string;
  eventId: string;
  participantId: string;
  zoneId: string | null;
  deviceType: DeviceType;
  mode: DeviceMode;
  label: string;                      // "Camera 1", "Staff 2"
  lastSeenAt: number;
  lastFrameAt: number | null;
  lastError: string | null;           // last AI/upload error shown to the dashboard (e.g. "AI unavailable")
  regions: CameraRegion[];            // calibrated multi-zone camera ([] = single-zone)
  snapshotUrl: string | null;         // calibration still
  /** Where the phone physically is, in map coordinates (dragged onto the map by an admin or the owner). null → drawn at its zone's centroid. */
  position: [number, number] | null;
}
// PUT /api/devices/:deviceId/position {position: [x, y] | null} → { device }   (admin or the device owner; map coordinates)

export interface Observation {
  id: string;
  eventId: string;
  zoneId: string;
  deviceId: string;
  participantId: string;
  modality: Modality;
  payload: ObservationPayload;
  confidence: number;
  model: string | null;               // e.g. "gpt-6-luna"; null for manual
  latencyMs: number | null;
  observedAt: number;
  incidentIds: string[];              // incidents this observation is evidence for
}

export interface Incident {
  id: string;
  eventId: string;
  zoneId: string;
  incidentType: IncidentType;
  severity: Severity;
  status: IncidentStatus;
  description: string;
  createdAt: number;
  updatedAt: number;
  lastEvidenceAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;          // participant id
  evidenceCount: number;
  observationIds: string[];           // newest first, up to 20
  modalities: Modality[];             // distinct modalities of the evidence
}

export interface Task {
  id: string;
  eventId: string;
  incidentId: string;
  assigneeId: string | null;
  title: string;
  /** Agent proposal: short action steps. Source 'ai' = model output (labelled "AI suggestion"), 'rule' = deterministic template. */
  steps: string[];
  stepsSource: 'ai' | 'rule' | 'pending';
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}

export type ActivityKind = 'observation' | 'incident' | 'task' | 'device' | 'zone' | 'agent' | 'system';
export interface Activity { id: number; eventId: string; kind: ActivityKind; text: string; ref: string | null; at: number }

export interface Me {
  participantId: string;
  eventId: string;
  role: Role;
  displayName: string;
  deviceId: string | null;
}

export interface AiInfo { enabled: boolean; visionModel: string | null; textModel: string | null; transcribe: boolean }

export interface Snapshot extends OpsState, ReportsState, CrewState {
  event: EventInfo;
  me: Me;
  zones: Zone[];
  devices: Device[];
  participants: Participant[];
  incidents: Incident[];              // open + acknowledged + resolved in the last 6 h
  tasks: Task[];
  observations: Observation[];        // newest first, last 60
  activity: Activity[];               // newest first, last 100
  attendees: AttendeeStats;
  ai: AiInfo;
  serverTime: number;
  /** Organizers only: the `k` secret for staff/camera/scribe join links (not on the attendee poster). */
  joinKey?: string;
}

// ── SSE: GET /api/events/:eventId/stream (cookie auth). Frames are `event: <name>\ndata: <json>` ─────────────────────

export type StreamFrame =
  | { event: 'snapshot'; data: Snapshot }
  | { event: 'zone'; data: Zone }
  | { event: 'device'; data: Device }
  | { event: 'participant'; data: Participant }
  | { event: 'incident'; data: Incident }
  | { event: 'task'; data: Task }
  | { event: 'observation'; data: Observation }
  | { event: 'activity'; data: Activity }
  | { event: 'zone_removed'; data: { id: string } }
  | { event: 'event'; data: EventInfo }   // event-level change (name, map, grid)
  | { event: 'pulse'; data: DevicePulse } // ephemeral live signal (never stored)
  | { event: 'agent'; data: CrewAgent } | { event: 'agent_post'; data: AgentPost } | { event: 'agent_removed'; data: { id: string } }
  | { event: 'hb'; data: { t: number } };

export const sseFrame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// ── REST API (all JSON unless noted; errors are { error: { code, message } } with a Korean message) ──────────────────
//
// Session: httpOnly cookie `wv` (one participant per browser). All /api routes except POST /api/events, POST /api/join,
// GET /api/me and GET /api/join/:code need it.
//
// GET    /api/me                         → { me: Me | null, event: EventInfo | null }
// GET    /api/templates                  → { templates: VenueTemplate[] }
// POST   /api/events                     body CreateEventBody → { event: EventInfo, me: Me }  (caller becomes admin)
// GET    /api/join/:code                 → { event: EventInfo, zones: Array<{ id, name }> }   (public preview for the join page)
// POST   /api/join                       body JoinBody → { me: Me, device: Device }           (QR scan → camera or staff)
// POST   /api/admin-claim                body { eventId, key } → { me: Me }                   (dashboard share link)
// GET    /api/events/:eventId/snapshot   → Snapshot
// GET    /api/events/:eventId/stream     → SSE (StreamFrame)
// GET    /api/events/:eventId/admin-link → { url }                                            (admin only)
//
// Zones (admin):
// POST   /api/events/:eventId/zones      body { name, polygon } → { zone }
// PATCH  /api/zones/:zoneId              body { name?, polygon?, version } → { zone }         (409 VERSION_CONFLICT on stale version)
// DELETE /api/zones/:zoneId              → { ok: true }
//
// Devices (own device only):
// PATCH  /api/devices/:deviceId          body { zoneId?, mode?, label? } → { device }
// POST   /api/devices/:deviceId/heartbeat body { mode } → { device, serverTime }
// POST   /api/devices/:deviceId/frames   body = raw JPEG (Content-Type: image/jpeg, ≤1.5 MB) → FrameResult
//                                         429 BUSY if a frame is still being analysed; 503 AI_DISABLED / 502 AI_FAILED → use manual fallback
// POST   /api/devices/:deviceId/manual   body ManualBody → ObservationResult
// POST   /api/devices/:deviceId/report   body { text, zoneId? } → ObservationResult                     (text report)
// POST   /api/devices/:deviceId/voice    body = raw audio (Content-Type: audio/webm | audio/mp4 | audio/mpeg | audio/wav, ≤8 MB)
//                                         query ?zoneId= → ObservationResult (payload.transcript has the transcription)
//
// Incidents & tasks (staff + admin):
// PATCH  /api/incidents/:incidentId      body { status: 'acknowledged' | 'resolved' } → { incident }
// PATCH  /api/tasks/:taskId              body { status?: TaskStatus, assigneeId?: string | null } → { task }
//                                         (status 'done' also resolves the incident when no other task is open)
// POST   /api/assistant                  body { question } → { answer: string, model: string }  (staff/admin, read-only context)

export interface VenueTemplate {
  id: string; name: string; description: string;
  zones: Array<{ name: string; polygon: Array<[number, number]>; zoneType?: ZoneType }>;
  /** Preset venues ship their real floor plan (zone polygons are in its pixel space) and an install plan. */
  map?: { imageUrl: string; thumbUrl?: string; width: number; height: number; kind: 'floorplan'; grid?: MapGrid };
  teams?: string[];
  install?: InstallSlot[];
  /** Event-level crew created with the preset (device-bound agents are created when a slot's device joins). */
  crew?: Array<{ name: string; role: AgentRole; team?: string | null }>;
}

/** One recommended device placement in a preset venue. Scanning its QR (/s/:joinCode/:slotId) sets the phone up with no login:
 *  label, zone, map position, team and its AI crew persona. Positions/range are in the preset map's pixel space;
 *  facing is degrees clockwise from north (up). */
export interface InstallSlot {
  id: string;
  kind: 'camera' | 'scribe' | 'poster';
  label: string;
  position: [number, number];
  facing: number;
  fov: number;
  range: number;
  zones: string[];                // zone names it should cover (multi-zone cameras calibrate regions for these)
  primaryZone: string | null;     // the device's own zone
  mount: string;
  height: string;
  tips: string[];
  persona: AgentRole | null;
  agentName?: string;             // crew agent bound to this slot (idempotent per slot)
  team?: string | null;           // team the agent radios / the scribe belongs to
  /** Multi-zone cameras: default regions on the camera's own view (normalized 0..1, primary zone first). Applied when the
   *  phone takes the slot, so every zone it covers gets readings without calibration; recalibrate any time. */
  regions?: Array<{ zone: string; polygon: Array<[number, number]> }>;
}

export interface CreateEventBody { name: string; templateId: string }
/** as 'attendee' → POST /api/join returns { me, device: null } and the phone goes to /chat. */
/** key: the organizer's join secret (`k` in staff/camera/scribe links). Required for every role except attendee, unless this
 *  browser/account already holds that role (or higher) in the event. */
export interface JoinBody { code: string; as: 'camera' | 'staff' | 'attendee' | 'scribe'; key?: string | null; zoneId?: string | null; name?: string | null; teamId?: string | null; slot?: string | null }
export interface ManualBody { zoneId?: string | null; crowdLevel?: CrowdLevel | null; issueType?: IncidentType | null; note?: string | null }

/** Result of any observation write: the immutable observation + every world change it caused. */
export interface ObservationResult {
  observation: Observation;
  zone: Zone;
  incidents: Incident[];   // created or updated by this observation
  tasks: Task[];           // created by this observation
}
export interface FrameResult extends ObservationResult { nextInMs: number; results?: ObservationResult[] }

export interface ApiError { error: { code: string; message: string } }

// ── Attendee chatbot (every attendee message is stored; reports flow into the same observation → incident pipeline) ──
//
// QR: /j/:code?as=guest → POST /api/join { as: 'attendee' } → /chat
// GET   /api/chat?eventId=            → ChatState      (attendee's own conversation + public zone crowd levels)
// POST  /api/chat                     body { message, eventId?, zoneId? } → ChatReply
// PATCH /api/chat/zone                body { zoneId: string | null, eventId? } → { myZoneId }

export interface AttendeeStats { count: number; messages: number; reports: number }

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  zoneId: string | null;
  observationId: string | null;   // set on the user message when it became an observation
  model: string | null;           // set on assistant messages
}

/** What attendees may see about a zone (no incidents, no staff). */
export interface PublicZone { id: string; name: string; status: ZoneStatus; crowdLevel: CrowdLevel | null; peopleEstimate: number | null; lastObservedAt: number | null }

export interface ChatState { event: EventInfo; me: Me; zones: PublicZone[]; myZoneId: string | null; messages: ChatMessage[]; ai: AiInfo; tickets?: AttendeeTicket[] }

export interface ChatReply {
  user: ChatMessage;
  reply: ChatMessage;
  /** Non-null when the message was recognised as a field report and recorded as an observation. */
  report: { issueType: IncidentType | 'none'; zoneId: string; observationId: string; incidentOpened: boolean; joinedExisting: boolean } | null;
  myZoneId: string | null;
  zones: PublicZone[];
  /** Set when the message became a tracked request/problem on the ops board (live status via GET /api/chat/tickets). */
  ticket?: AttendeeTicket | null;
}

/** An attendee's request or problem as it lives on the ops board. Status follows the linked issue:
 *  open → received · in_progress/blocked → on it · done → done. GET /api/chat/tickets?eventId= → { tickets } (newest first). */
export interface AttendeeTicket {
  messageId: string;              // the attendee's chat message
  kind: 'request' | 'problem';
  issueId: string;
  issueKey: string;
  title: string;
  zoneId: string | null;
  status: IssueStatus;
  joinedExisting: boolean;        // merged into a ticket someone else already opened
  createdAt: number;
  updatedAt: number;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// OPS TRACKER (v2 core): phones transcribe meetings (scribe), carry push-to-talk messages (talk), see (camera) and hear
// attendees (chat). Every utterance is an immutable record; the AI only PROPOSES issue changes from them; server rules
// apply them (auto above a confidence bar, else into the Suggestions inbox). Every change keeps its evidence and can be undone.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const ISSUE_KINDS = ['task', 'problem', 'decision', 'question'] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const ISSUE_STATUSES = ['open', 'in_progress', 'blocked', 'done'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const UTTERANCE_SOURCES = ['scribe', 'talk', 'chat', 'report'] as const;
export type UtteranceSource = (typeof UTTERANCE_SOURCES)[number];

export const ISSUE_KIND_LABEL: Record<IssueKind, string> = { task: 'Task', problem: 'Problem', decision: 'Decision', question: 'Question' };
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
export const PRIORITY_LABEL: Record<Priority, string> = { p0: 'Urgent', p1: 'High', p2: 'Medium', p3: 'Low' };
export const SOURCE_LABEL: Record<UtteranceSource, string> = { scribe: 'Meeting', talk: 'Radio', chat: 'Attendee chat', report: 'Report' };

/** Scribe audio: the phone cuts on silence; a chunk is at most this long. */
export const SCRIBE_MAX_CHUNK_MS = 20_000;
/** Below this the AI's proposal waits in the Suggestions inbox instead of being applied. */
export const AUTO_APPLY_CONFIDENCE = 0.7;
/** Marking an issue done from speech needs this much confidence (else it becomes a proposal). */
export const AUTO_DONE_CONFIDENCE = 0.8;
/** A p0 issue nobody picked up (still open) for this long is escalated to HQ. Unacked talk messages show as overdue. */
export const ESCALATE_AFTER_MS = 2 * 60_000;

export interface Team { id: string; eventId: string; name: string; sort: number }

export interface EvidenceRef {
  type: 'utterance' | 'observation';
  id: string;
  text: string;                 // utterance text or observation summary
  at: number;
  source: UtteranceSource | Modality;
  speaker: string | null;       // person or device label
  teamId: string | null;
}

export interface Issue {
  id: string;
  eventId: string;
  number: number;
  key: string;                  // "WV-12"
  title: string;
  kind: IssueKind;
  status: IssueStatus;
  priority: Priority;
  teamId: string | null;
  assigneeId: string | null;
  assigneeHint: string | null;  // a name heard in speech that matched nobody ("mentioned: Minsu")
  dueAt: number | null;
  zoneId: string | null;
  createdBy: 'ai' | 'human' | 'rule';
  incidentId: string | null;    // camera/chat incident this issue mirrors (resolving one resolves the other)
  escalated: boolean;
  createdAt: number;
  updatedAt: number;
  version: number;
  evidenceCount: number;
  lastEvidence: EvidenceRef | null;
}

export type IssueEventKind = 'created' | 'status' | 'assignee' | 'priority' | 'due' | 'title' | 'team' | 'evidence' | 'escalated' | 'undo';
export interface IssueEvent {
  id: number;
  issueId: string;
  issueKey: string;
  eventId: string;
  kind: IssueEventKind;
  from: string | null;          // display values (Korean labels / names), not ids
  to: string | null;
  actor: 'ai' | 'rule' | 'human';
  actorName: string;            // "AI", "Rule", or the person's name
  evidence: EvidenceRef[];
  confidence: number | null;
  undoable: boolean;            // AI/rule changes that are the latest of their field and not yet undone
  undone: boolean;
  at: number;
}

export interface Utterance {
  id: string;
  eventId: string;
  teamId: string | null;
  deviceId: string;
  participantId: string;
  speaker: string;              // person name (talk) or device label ("Stage meeting")
  source: UtteranceSource;
  text: string;
  startedAt: number;
  endedAt: number;
  model: string | null;
  latencyMs: number | null;
  issueKeys: string[];          // issues this utterance created / updated / is evidence for
}

export interface ProposedAction {
  type: 'create' | 'update' | 'decision';
  issueNumber: number | null;
  title: string | null;
  kind: IssueKind | null;
  priority: Priority | null;
  team: string | null;          // team name as heard
  zone?: string | null;         // zone name (venue map) the action is about
  assignee: string | null;      // person name as heard
  due: string | null;           // "HH:MM" (event local time, KST)
  status: IssueStatus | null;
  note: string | null;
}

export interface Proposal {
  id: string;
  eventId: string;
  status: 'pending' | 'accepted' | 'rejected';
  action: ProposedAction;
  summary: string;              // one line, e.g. "WV-7 → Done" or "New task: Print 200 badges · Jimin"
  confidence: number;
  evidence: EvidenceRef[];
  issueId: string | null;       // target issue (update) or the issue created on accept
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;     // participant name
}

export interface TalkTarget { type: 'hq' | 'team' | 'person' | 'all'; id: string | null; label: string }
export interface TalkMessage {
  id: string;
  eventId: string;
  fromId: string;
  fromName: string;
  to: TalkTarget;
  text: string;
  utteranceId: string;
  issueKeys: string[];
  createdAt: number;
  expected: string[];           // participant ids who should ack
  acks: Array<{ participantId: string; at: number }>;
  audioUrl: string | null;      // walkie-talkie clip (expires), null for text
  durationMs: number | null;
}

/** Targeted nudge (assignment, message, escalation). Clients show it only when participantId === me.participantId (or 'hq' for admins). */
export interface Notify {
  id: string; participantId: string | 'hq'; title: string; body: string; issueId: string | null; messageId: string | null; at: number;
  /** Dispatch details (optional): WHERE to go and WHAT to fix, so the phone can show a "Go to Entrance · WV-12" card. */
  kind?: 'assigned' | 'radio' | 'escalation' | 'blocked' | 'info';
  zoneId?: string | null; zoneName?: string | null; issueKey?: string | null; issueTitle?: string | null;
  priority?: Priority | null; action?: string | null;   // first step / next action, e.g. "Open a second desk"
}

export interface Citation { type: 'issue' | 'utterance'; id: string; label: string; text: string; at: number | null }

/** Ops state is part of every Snapshot (see Snapshot). */
export interface OpsState {
  teams: Team[];
  issues: Issue[];              // all not-done + done in the last 12 h
  issueEvents: IssueEvent[];    // newest first, last 200
  proposals: Proposal[];        // pending + last 30 decided
  utterances: Utterance[];      // newest first, last 150
  messages: TalkMessage[];      // newest first, last 80
}

// SSE frames added for ops (same stream): team, team_removed, issue, issue_event, proposal, utterance, message, notify.
export type OpsFrame =
  | { event: 'team'; data: Team } | { event: 'team_removed'; data: { id: string } } | { event: 'issue'; data: Issue }
  | { event: 'issue_event'; data: IssueEvent } | { event: 'proposal'; data: Proposal } | { event: 'utterance'; data: Utterance }
  | { event: 'message'; data: TalkMessage } | { event: 'notify'; data: Notify };

// ── Ops REST API ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Teams (admin):  POST /api/events/:eventId/teams {name} → {team} · PATCH /api/teams/:id {name} → {team} · DELETE /api/teams/:id
// Me:             PATCH /api/me {eventId, displayName?, teamId?} → {me, participant}
// Join:           JoinBody.as 'scribe' (+ teamId) → camera-role participant with a 'scribe' device → /scribe/:deviceId
//                 JoinBody.teamId / name for staff ("the name people call you in meetings" so speech can assign work to them)
// Scribe audio:   POST /api/devices/:deviceId/audio  body = raw audio (audio/wav | audio/webm | audio/mp4, ≤ 4 MB)
//                 query ?startedAt=&endedAt=&seq= → { utterance: Utterance | null }   (null = silence / nothing intelligible)
// Talk (PTT):     POST /api/talk  body = raw audio, query ?to=hq|all|team:<id>|person:<id>&eventId= → { message, utterance }
//                 POST /api/talk/text {text, to, eventId?} → { message, utterance }
//                 POST /api/messages/:id/ack → { message }
// Issues:         POST /api/events/:eventId/issues {title, kind?, priority?, teamId?, assigneeId?, dueAt?} → { issue }   (human)
//                 PATCH /api/issues/:id {status?, priority?, assigneeId?, teamId?, title?, dueAt?} → { issue }
//                 GET /api/issues/:id/timeline → { issue, events: IssueEvent[] }
//                 POST /api/issue-events/:id/undo → { issue }
// Proposals:      POST /api/proposals/:id {decision: 'accept' | 'reject'} → { proposal, issue: Issue | null }
// Ask:            POST /api/ask {question, eventId?, teamId?} → { answer, model, citations: Citation[] }  (staff+, read-only)

export interface AskResult { answer: string; model: string; citations: Citation[] }
export interface IssueTimeline { issue: Issue; events: IssueEvent[] }

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// v3: ACCOUNTS (ID login) · FIELD REPORTS (photo + voice + text) · REAL VENUE MAP (floor plan + AI zoning). English-only UI.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

// ── Accounts ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Organizers and staff sign in with a username + password (scrypt-hashed). Session = httpOnly cookie `wv_u`.
// Devices (camera, scribe) and attendees still join by QR without an account.
// POST /api/auth/signup {username, password, displayName} → AuthState   (username: 3–24 of [a-z0-9._-], password ≥ 8)
// POST /api/auth/login  {username, password} → AuthState                (401 BAD_CREDENTIALS)
// POST /api/auth/logout → { ok: true }
// GET  /api/auth/me → AuthState                                         (user null when signed out)
// POST /api/events requires a signed-in user (the creator becomes admin). Staff join (as 'staff') requires a signed-in user:
//   the participant is linked to the user and takes the user's displayName (409 NEEDS_LOGIN when signed out).
export interface User { id: string; username: string; displayName: string; createdAt: number }
export type EventStatus = 'live' | 'upcoming' | 'ended';
export interface MyEvent { event: EventInfo; role: Role; status: EventStatus }
export interface AuthState { user: User | null; events: MyEvent[] }

// ── Real venue map ───────────────────────────────────────────────────────────────────────────────────────────────────
// An event may have a floor plan image. When it does, ALL zone polygons are in that image's pixel space (0..width, 0..height);
// otherwise in the MAP_W × MAP_H default space. EventInfo.map carries it.
// POST /api/events/:eventId/map   body = raw image (image/png | image/jpeg | image/webp, ≤ 10 MB) → { map: VenueMapInfo, suggestions: ZoneSuggestion[] }
//      Stores the plan (DATA_DIR/media) and asks the vision model for labelled areas. Suggestions are NOT applied.
// POST /api/events/:eventId/map/suggest → { suggestions }    (re-run AI zoning on the stored plan)
// DELETE /api/events/:eventId/map → { ok: true }
// PUT  /api/events/:eventId/zones   {zones: Array<{id?: string; name: string; polygon: Array<[number, number]>}>} → { zones: Zone[] }
//      Replace the whole zone set at once (admin; zones without id are created, missing ones are removed).
// GET  /media/<path> serves stored plans and report photos (unguessable names).
export interface VenueMapInfo { imageUrl: string | null; width: number; height: number; updatedAt: number; kind: MapKind; grid: MapGrid | null; presetId?: string | null }
export interface ZoneSuggestion { name: string; polygon: Array<[number, number]>; confidence: number }

// ── Field reports (staff) ────────────────────────────────────────────────────────────────────────────────────────────
// A staff report = any of photo / voice / text + category + urgency + location. The AI writes a short structured summary;
// rules attach it to an existing issue at the same spot (dedupe) or open a new one. Status follows the linked issue.
export const REPORT_CATEGORIES = ['crowd', 'facility', 'supplies', 'safety', 'medical', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export const URGENCIES = ['normal', 'caution', 'urgent'] as const;
export type Urgency = (typeof URGENCIES)[number];
export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = { crowd: 'Crowd', facility: 'Facility', supplies: 'Supplies', safety: 'Safety', medical: 'Medical', other: 'Other' };
export const URGENCY_LABEL: Record<Urgency, string> = { normal: 'Normal', caution: 'Caution', urgent: 'Urgent' };
export type ReportStatus = 'received' | 'reviewing' | 'resolved';
export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = { received: 'Received', reviewing: 'Under review', resolved: 'Resolved' };

export interface Report {
  id: string;
  eventId: string;
  authorId: string;
  authorName: string;
  zoneId: string | null;
  category: ReportCategory;
  urgency: Urgency;
  text: string | null;            // typed
  transcript: string | null;      // from the voice note (audio itself is never stored)
  photoUrl: string | null;        // stored photo (staff took it on purpose for this report)
  ai: { title: string; location: string | null; situation: string; summary: string; confidence: number; model: string } | null;
  issueId: string | null;
  issueKey: string | null;
  issueTitle: string | null;
  linkedReports: number;          // reports on the same issue (incl. this one)
  status: ReportStatus;           // issue open → received · in_progress/blocked → reviewing · done → resolved
  statusAt: { received: number; reviewing: number | null; resolved: number | null };
  parentReportId: string | null;  // "Add update" follow-ups
  createdAt: number;
}
// POST /api/reports  JSON {eventId, zoneId?, hereZoneId? (where the reporter is; used only when the report names no zone), category ('auto' = AI decides), urgency ('auto' = AI decides), text?, photo? (data:image/jpeg;base64,… ≤ 1600px),
//      photos? (≤ 4 data URLs — e.g. key frames of a chat video; the first is stored), audio? (data:audio/…;base64,…), parentReportId?}
//      → { report: Report, issue: Issue | null }          (≤ 8 MB body; at least one of text / photo / audio)
// GET  /api/reports?eventId=&mine=1 → { reports: Report[] }  (newest first)
// GET  /api/reports/:id → { report, issue: Issue | null, related: Report[] }
// Snapshot gets `reports: Report[]` (newest 100) and SSE frame `report`.
export interface ReportsState { reports: Report[] }

// ── Walkie-talkie ────────────────────────────────────────────────────────────────────────────────────────────────────
// Radio messages keep a short-lived audio clip so recipients can HEAR them (auto-play in Walkie mode), next to the transcript.
// Clips are deleted after RADIO_AUDIO_TTL_MS. TalkMessage.audioUrl is null for text messages or expired clips.
export const RADIO_AUDIO_TTL_MS = 6 * 3600_000;
export interface TalkAudio { audioUrl: string | null; durationMs: number | null }

// ── Staff assistant (chat + voice) ───────────────────────────────────────────────────────────────────────────────────
// One turn = typed text OR a voice clip. The assistant answers from the live DB and, for clear commands from the speaker
// ("mark WV-3 done", "give the badge printing to Jimin", "report a spill at Zone B"), acts through the same rules as radio.
// POST /api/assistant/turn {eventId, text?, audio? (data:audio/…;base64), speak?: boolean} → AssistantTurn
// POST /api/tts {text} → audio/mpeg   (clients fall back to speechSynthesis when this fails)
export interface AssistantAction { summary: string; issueKey: string | null; applied: boolean } // applied false = filed as a suggestion
export interface AssistantTurn {
  transcript: string | null;
  answer: string;
  model: string;
  citations: Citation[];
  actions: AssistantAction[];
  speech: string | null;          // data:audio/mpeg;base64,… when speak = true and TTS succeeded
  /** What to SHOW inline with the answer: zones to highlight on a mini map, issues/devices to render as cards.
   *  Empty arrays = nothing to show. Optional for older clients. */
  focus?: { zoneIds: string[]; issueIds: string[]; deviceIds: string[] };
}

// ── Live data (observable DB + CSV) ──────────────────────────────────────────────────────────────────────────────────
export const DATA_TABLES = ['issues', 'reports', 'utterances', 'messages', 'observations', 'issue_events', 'proposals', 'zones', 'participants', 'devices', 'incidents'] as const;
export type DataTable = (typeof DATA_TABLES)[number];
export const DATA_TABLE_LABEL: Record<DataTable, string> = {
  issues: 'Issues', reports: 'Field reports', utterances: 'Transcripts', messages: 'Radio', observations: 'Observations', issue_events: 'Issue history',
  proposals: 'Suggestions', zones: 'Zones', participants: 'People', devices: 'Devices', incidents: 'Incidents',
};
// GET /api/events/:eventId/data/:table?limit=200&offset=0&q= → DataPage   (admin; read-only; secrets/hashes never included)
// GET /api/events/:eventId/data/:table.csv → text/csv (UTF-8 BOM, all rows)
// The UI re-fetches the open table when a related SSE frame arrives (issue, report, utterance, message, observation, issue_event, …).
export interface DataPage { table: DataTable; columns: string[]; rows: Array<Record<string, string | number | null>>; total: number }

// ── Map from a camera scan · grid zoning · camera calibration · event knowledge ──────────────────────────────────────
// Map kinds: 'floorplan' (uploaded plan image), 'photo' (one wide overview photo), 'schematic' (AI layout from a walk-through
// scan; no image — zones are drawn on a clean grid). `grid` = optional cols×rows overlay used by the zone editor.
export type MapKind = 'floorplan' | 'photo' | 'schematic';
export interface MapGrid { cols: number; rows: number }
// VenueMapInfo (above) is extended by these fields:
export interface VenueMapExtra { kind: MapKind; grid: MapGrid | null }

// POST  /api/events/:eventId/map/scan {frames: string[] (≤ 10 × data:image/jpeg ≤ 1024px), note?: string}
//       → { map: VenueMapInfo, suggestions: ZoneSuggestion[] }   (schematic map 1000×640 space; suggestions = laid-out areas)
// PATCH /api/events/:eventId/map {grid: MapGrid | null} → { map }
// (POST /api/events/:eventId/map with an image accepts ?kind=floorplan|photo, default floorplan.)

// A fixed camera that overlooks several zones: an admin draws regions on that camera's own snapshot (normalized 0..1 coords of
// the camera frame) and links each region to a zone. Then the phone outlines + numbers the regions (1..n, array order) on every
// frame before upload, and the server asks the vision model for a per-region assessment → one observation per zone.
export interface CameraRegion { zoneId: string; polygon: Array<[number, number]> }
// Device (above) is extended: `regions: CameraRegion[]` ([] = classic single-zone camera) and `snapshotUrl: string | null`.
// POST /api/devices/:deviceId/snapshot   raw image/jpeg → { snapshotUrl }       (device owner; the calibration still)
// PUT  /api/devices/:deviceId/regions    {regions: CameraRegion[]} → { device } (admin)
// FrameResult gains `results?: ObservationResult[]` (one per region) when the device has regions.

// Organizer-provided context the staff assistant always reads (run-of-show, FAQ, contacts, venue notes).
// GET /api/events/:eventId/knowledge → { text, updatedAt } (staff+) · PUT {text ≤ 20000} → { ok: true } (admin)
export interface EventKnowledge { text: string; updatedAt: number | null }

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// v4: ZONE TRACKING — what each zone measures, per zone TYPE. Inputs: single camera frames (vision LLM, one assessment per
// numbered region) + staff/manual reports. Deterministic rules in server/zoneTrack.ts (pure) turn them into Zone.track (live
// state, SSE 'zone' frame) and zone_metrics (30-s buckets → sparklines). The model only PROPOSES per-frame facts.
// Existing shapes are EXTENDED by interface merging (Zone, VisionPayload, ManualPayload, ManualBody) — nothing is removed.
// Zone.status / crowdLevel / peopleEstimate keep their meaning; they are now written from the SMOOTHED values.
// Never measured from a frame: identities, faces, emotions/mood, motion/flow, speed, dwell, wait time, small objects.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

// ── Zone types ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const ZONE_TYPES = ['stage', 'entrance', 'food', 'restroom', 'workspace', 'lounge', 'corridor', 'general'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];
export const ZONE_TYPE_LABEL: Record<ZoneType, string> = {
  stage: 'Stage / audience', entrance: 'Entrance / registration', food: 'Food & drinks', restroom: 'Restrooms',
  workspace: 'Workspace', lounge: 'Lounge', corridor: 'Corridor / exit', general: 'General',
};

/** Name → type guess at zone creation (first match wins; the admin can change it). Order matters: restroom before lounge
 *  ('rest area'), corridor before stage ('hallway' vs 'main hall'), entrance before workspace ('check-in desk'). */
export const ZONE_TYPE_PATTERNS: ReadonlyArray<readonly [ZoneType, RegExp]> = [
  ['restroom', /rest ?room|toilet|\bwc\b|bathroom|lavator/i],
  ['corridor', /corridor|hall ?way|lobby|aisle|\bexit|stair|passage/i],
  ['entrance', /entran|entry|\bgate|regist|check.?in|badge|\bdoor/i],
  ['food', /food|\bbar\b|drink|\bcaf|coffee|snack|cater|buffet|kitchen|breakfast|lunch|dinner/i],
  ['stage', /stage|\bhall\b|audience|keynote|theat|auditorium/i],
  ['lounge', /lounge|rest area|chill|relax|break|sofa/i],
  ['workspace', /hack|work|table|desk|\blab\b|booth|team/i],
];
export const inferZoneType = (name: string): ZoneType => ZONE_TYPE_PATTERNS.find(([, re]) => re.test(name))?.[0] ?? 'general';

// ── Per-region vision vocabulary (strict schema enums; every optional field can abstain with 'na') ─────────────────────

export const VIEW_QUALITIES = ['good', 'partial', 'poor', 'none'] as const;   // how well the camera sees this region
export type ViewQuality = (typeof VIEW_QUALITIES)[number];
export const CERTAINTIES = ['low', 'medium', 'high'] as const;               // verbal, snapped to fixed numbers below
export type Certainty = (typeof CERTAINTIES)[number];
export const SEATINGS = ['na', 'empty', 'mostly_free', 'half', 'mostly_taken', 'full'] as const;
export type Seating = (typeof SEATINGS)[number];
export const WALKWAYS = ['na', 'clear', 'narrowed', 'blocked'] as const;
export type Walkway = (typeof WALKWAYS)[number];
/** Optional fields the model is asked for only where the zone type needs them (others must come back neutral). */
export const OPTIONAL_VISION_FIELDS = ['queue', 'seating', 'walkway'] as const;
export type OptionalVisionField = (typeof OPTIONAL_VISION_FIELDS)[number];

/** A VLM's free-float confidence is overconfident → frame confidence = CERTAINTY_WEIGHT[certainty] × VIEW_WEIGHT[view]. */
export const CERTAINTY_WEIGHT: Record<Certainty, number> = { low: 0.35, medium: 0.6, high: 0.85 };
export const VIEW_WEIGHT: Record<ViewQuality, number> = { good: 1, partial: 0.75, poor: 0.4, none: 0 };
export const SEAT_FREE_SHARE: Record<Seating, number | null> = { na: null, empty: 1, mostly_free: 0.75, half: 0.5, mostly_taken: 0.2, full: 0 };
export const WALKWAY_RANK: Record<Walkway, 0 | 1 | 2 | null> = { na: null, clear: 0, narrowed: 1, blocked: 2 };
/** These open an incident on ONE frame when hazard confidence ≥ ZONE_TRACK.FAST_LANE_H (high certainty + good view). */
export const LIFE_SAFETY_HAZARDS: readonly HazardType[] = ['fire_smoke', 'medical', 'fall_injury', 'crowd_crush'];

/** What the vision model returns for ONE numbered region (server/ai3.ts REGIONS_SCHEMA v2). A single-zone camera sends one
 *  region = the whole frame. Keys are emitted in this order ('seen' first = grounding). A region missing from the output
 *  produces NO observation (never read as empty). */
export interface RegionAssessment {
  region: number;                     // outline number 1..n
  seen: string;                       // ≤ 15 words: what is inside this outline
  view: ViewQuality;                  // partial = ≥ 1/3 hidden/out of frame · poor = too dark/blurred/stage-lit · none = can't see
  crowd_level: CrowdLevel;            // vs. this region's own floor area (visual anchors in the prompt)
  people_count: number;               // feet inside the outline; > 30 rounded to the nearest 10
  queue_people: number;               // people standing in a line for a desk/counter/door; 0 = no line / not asked
  queue_spills: boolean;              // the line continues past the outline or the frame edge
  seating: Seating;                   // free share of visible seats/desks; 'na' = none visible / not asked
  walkway: Walkway;                   // main aisle/door/exit path inside the region; 'na' = none visible / not asked
  hazards: Array<{ type: HazardType; certainty: Certainty; where: string }>; // where ≤ 8 words
  certainty: Certainty;               // about crowd_level + people_count
}

/** VisionPayload v2 additions (server/camera.ts regionToObservation fills them; v1 rows simply lack them).
 *  Legacy fields stay populated: scene_ok = view ∈ {good, partial} · confidence = CERTAINTY_WEIGHT × VIEW_WEIGHT ·
 *  hazards[].confidence = CERTAINTY_WEIGHT[h.certainty] × VIEW_WEIGHT[view] · hazards[].detail = where · summary = seen ·
 *  queue_present = queue_people ≥ 2. So MIN_STATE_CONFIDENCE / MIN_INCIDENT_CONFIDENCE keep their meaning. */
export interface VisionPayload {
  v?: 2;
  view?: ViewQuality;
  certainty?: Certainty;
  queue_people?: number;
  queue_spills?: boolean;
  seating?: Seating;
  walkway?: Walkway;
}

// ── Metrics ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const METRIC_KEYS = ['crowd', 'people', 'trend', 'queue', 'wait', 'seats', 'walkway', 'hazard', 'issues', 'signal', 'serviced'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface ZoneMetricDef {
  key: MetricKey;
  label: string;                      // zone table column header
  unit: string;
  source: 'camera' | 'derived' | 'db' | 'clock';
  series: boolean;                    // has a zone_metrics column → sparkline
  approx: boolean;                    // UI prefixes '~' / suffixes 'est.'
  help: string;                       // tooltip: how it is measured
}
export const ZONE_METRICS: Record<MetricKey, ZoneMetricDef> = {
  crowd: { key: 'crowd', label: 'Crowd', unit: 'level 0–4', source: 'camera', series: true, approx: false,
    help: 'Model crowd level per frame (0 empty … 4 critical) → median of the last ≤5 usable frames within 60 s, each clamped to median ± 1, averaged. Drives status.' },
  people: { key: 'people', label: 'People', unit: 'people (approx.)', source: 'camera', series: true, approx: true,
    help: 'Median model count (feet inside the outline). Undercounts dense crowds: shown as ≥n at high/critical, banded above 50. Never alarms on its own.' },
  trend: { key: 'trend', label: 'Trend', unit: '2-min change', source: 'derived', series: false, approx: false,
    help: 'Crowd score now vs. the 30-s buckets 90–150 s ago: ±0.5 level (or people ×1.3 and ±5) → rising / falling. Early warning only.' },
  queue: { key: 'queue', label: 'Queue', unit: 'people in line', source: 'camera', series: true, approx: true,
    help: 'Median people standing in a line; ⚠ when the line spills past the outline in 2 of the last 3 frames.' },
  wait: { key: 'wait', label: 'Est. wait', unit: 'min (est.)', source: 'derived', series: true, approx: true,
    help: 'queue ÷ service rate (people/min, type default or zone override). Never asked of the model.' },
  seats: { key: 'seats', label: 'Seats free', unit: 'share of visible seats', source: 'camera', series: true, approx: true,
    help: 'Coarse seating band per frame (empty … full) → free share, median. ≤ 20% for 60 s → "Almost full → send to …".' },
  walkway: { key: 'walkway', label: 'Walkway', unit: 'clear · narrowed · blocked', source: 'camera', series: true, approx: false,
    help: 'Aisle / door / exit path state: mode of usable frames (ties → worse); blocked in 2 of the last 3 frames → obstruction.' },
  hazard: { key: 'hazard', label: 'Hazard', unit: 'confidence 0–1', source: 'camera', series: true, approx: false,
    help: 'Strongest hazard seen in ≥ 2 of the last 3 frames (life-safety types: 1 frame at high certainty).' },
  issues: { key: 'issues', label: 'Issues', unit: 'open items', source: 'db', series: false, approx: false,
    help: 'Open incidents + open ops issues in this zone (someone may already be on it). Covers what cameras cannot see.' },
  signal: { key: 'signal', label: 'Signal', unit: 'age · confidence', source: 'derived', series: false, approx: false,
    help: 'live ≤ 15 s with ≥ 3 usable frames · weak · stale > 45 s · blind = 3 unusable frames in a row · none = never seen.' },
  serviced: { key: 'serviced', label: 'Serviced', unit: 'min since cleaned', source: 'clock', series: false, approx: false,
    help: 'Stretch: minutes since the last Cleaned / Restocked tap, vs. the zone type SLA. No camera needed (restrooms).' },
};

// ── Per-type profiles = thresholds ───────────────────────────────────────────────────────────────────────────────────

/** [enter, exit] thresholds on the 0–4 crowd score. Escalate at enter (with ≥ 3 usable frames); drop ONE tier when below exit
 *  and ≥ DEMOTE_DWELL_MS since the last change. The critical threshold is never relaxed by type. */
export interface CrowdBands { busy: readonly [number, number]; crowded: readonly [number, number]; critical: readonly [number, number] }
export const DEFAULT_CROWD_BANDS: CrowdBands = { busy: [1.5, 1.2], crowded: [2.5, 2.2], critical: [3.4, 3.0] };

export interface ZoneTypeProfile {
  primary: readonly MetricKey[];      // drive tier + actions; other shown columns render dimmed
  columns: readonly MetricKey[];      // zone table cells for this type (anything else renders '—')
  vision: readonly OptionalVisionField[]; // optional model fields asked in this type (rest forced neutral)
  crowd: CrowdBands;
  queueRate: number | null;           // people served per minute (zones.queue_rate overrides); null = queue not tracked
  waitAlertMin: number | null;        // wait ≥ A → tier ≥ crowded; held 60 s & not falling → long_queue + 'open_desk'; ≥ A/2 → busy
  seatsWatch: number | null;          // seats free ≤ this for 60 s → 'seats_full' (clears at ≥ 0.5)
  serviceSlaMin: number | null;       // stretch: cleaning clock ('cleaning_due' at SLA, act at 1.5×)
  severity: Partial<Record<IncidentType, Severity>>; // raises SEVERITY_BY_TYPE in this zone type (never lowers)
}
const ALWAYS: readonly MetricKey[] = ['issues', 'signal'];
export const ZONE_TYPE_PROFILE: Record<ZoneType, ZoneTypeProfile> = {
  stage: {
    primary: ['crowd', 'trend', 'walkway', 'hazard'], columns: ['crowd', 'people', 'trend', 'seats', 'walkway', 'hazard', ...ALWAYS],
    vision: ['seating', 'walkway'], crowd: { busy: [1.5, 1.2], crowded: [3.0, 2.7], critical: [3.4, 3.0] }, // dense = normal mid-session
    queueRate: null, waitAlertMin: null, seatsWatch: 0.2, serviceSlaMin: null, severity: {},
  },
  entrance: {
    primary: ['queue', 'wait', 'crowd', 'walkway'], columns: ['crowd', 'people', 'trend', 'queue', 'wait', 'walkway', 'hazard', ...ALWAYS],
    vision: ['queue', 'walkway'], crowd: DEFAULT_CROWD_BANDS,
    queueRate: 3, waitAlertMin: 10, seatsWatch: null, serviceSlaMin: null, severity: { obstruction: 'high' }, // a blocked door is egress
  },
  food: {
    primary: ['queue', 'wait', 'seats', 'crowd'], columns: ['crowd', 'people', 'trend', 'queue', 'wait', 'seats', 'hazard', 'serviced', ...ALWAYS],
    vision: ['queue', 'seating'], crowd: DEFAULT_CROWD_BANDS,
    queueRate: 1.5, waitAlertMin: 12, seatsWatch: 0.2, serviceSlaMin: 60, severity: {},
  },
  restroom: { // camera may only watch the approach / line OUTSIDE the door (setup copy enforces it)
    primary: ['queue', 'wait', 'serviced', 'walkway'], columns: ['crowd', 'people', 'queue', 'wait', 'walkway', 'hazard', 'serviced', ...ALWAYS],
    vision: ['queue', 'walkway'], crowd: DEFAULT_CROWD_BANDS,
    queueRate: 2, waitAlertMin: 8, seatsWatch: null, serviceSlaMin: 45, severity: {},
  },
  workspace: {
    primary: ['seats', 'crowd', 'walkway'], columns: ['crowd', 'people', 'trend', 'seats', 'walkway', 'hazard', 'serviced', ...ALWAYS],
    vision: ['seating', 'walkway'], crowd: DEFAULT_CROWD_BANDS,
    queueRate: null, waitAlertMin: null, seatsWatch: 0.2, serviceSlaMin: 120, severity: {},
  },
  lounge: {
    primary: ['seats', 'crowd'], columns: ['crowd', 'people', 'seats', 'hazard', 'serviced', ...ALWAYS],
    vision: ['seating'], crowd: DEFAULT_CROWD_BANDS,
    queueRate: null, waitAlertMin: null, seatsWatch: 0.2, serviceSlaMin: 90, severity: {},
  },
  corridor: { // people should flow: stricter bands; blocked path → tier ≥ crowded + obstruction high
    primary: ['walkway', 'crowd', 'trend', 'hazard'], columns: ['crowd', 'people', 'trend', 'walkway', 'hazard', ...ALWAYS],
    vision: ['walkway'], crowd: { busy: [1.5, 1.2], crowded: [2.2, 1.9], critical: [3.0, 2.7] },
    queueRate: null, waitAlertMin: null, seatsWatch: null, serviceSlaMin: null, severity: { obstruction: 'high' },
  },
  general: {
    primary: ['crowd', 'queue', 'walkway', 'hazard'], columns: ['crowd', 'people', 'trend', 'queue', 'wait', 'seats', 'walkway', 'hazard', ...ALWAYS],
    vision: ['queue', 'seating', 'walkway'], crowd: DEFAULT_CROWD_BANDS,
    queueRate: 2, waitAlertMin: 10, seatsWatch: null, serviceSlaMin: null, severity: {},
  },
};

/** Tracking constants (shared so UI and server agree). All windows are on observed_at, never frame counts alone. */
export const ZONE_TRACK = {
  WINDOW_MS: 60_000,        // camera window age bound
  WINDOW_N: 5,              // usable frames used for smoothing
  KEEP_N: 8,                // camera samples kept in state (usable or not)
  MIN_USABLE: 3,            // camera can change tier only with ≥ 3 usable frames in the window
  DEMOTE_DWELL_MS: 20_000,  // per one-tier step down
  HUMAN_HOLD_MS: 120_000,   // staff/manual crowd report = floor for this long
  CAMERA_FRESH_MS: 60_000,  // no usable camera frame for this long → a human report may also LOWER the level
  DEVICE_FRESH_MS: 20_000,  // multi-camera fusion only takes devices with a frame this recent
  BUCKET_MS: 30_000,        // zone_metrics bucket
  TREND_FROM_MS: 150_000, TREND_TO_MS: 90_000, TREND_DELTA: 0.5,
  QUEUE_HOLD_MS: 60_000,    // wait ≥ alert held this long (and queue not falling) → long_queue
  SEATS_HOLD_MS: 60_000,
  RISING_HOLD_MS: 30_000,   // 'filling' pre-alert
  LIVE_MS: 15_000, LIVE_CONF: 0.55,
  BLIND_STREAK: 3,          // consecutive unusable frames → 'blind'
  HAZARD_H: 0.5, HAZARD_MEAN_H: 0.6, FAST_LANE_H: 0.8,
} as const;

// ── Live tracking state (wire) ───────────────────────────────────────────────────────────────────────────────────────

/** 0 clear · 1 busy · 2 crowded · 3 critical — Zone.status before the 'alert' override (open high/critical incident). */
export type Tier = 0 | 1 | 2 | 3;
export const TIER_STATUS: Record<Tier, ZoneStatus> = { 0: 'clear', 1: 'busy', 2: 'crowded', 3: 'critical' };
export const TRACK_LEVELS = ['ok', 'watch', 'act'] as const;   // urgency of the zone's top action (row colour + sort)
export type TrackLevel = (typeof TRACK_LEVELS)[number];
export type Trend = 'rising' | 'steady' | 'falling';
export const SIGNALS = ['live', 'weak', 'stale', 'blind', 'none'] as const;
export type Signal = (typeof SIGNALS)[number];

/** Array order = tie-break rank (first = most important). */
export const ACTION_CODES = [
  'respond', 'crowd_critical', 'path_blocked', 'lost_view', 'open_desk', 'crowded', 'path_narrowed', 'queue_building',
  'filling', 'seats_full', 'cleaning_due', 'check_camera',
] as const;
export type ActionCode = (typeof ACTION_CODES)[number];
export interface ZoneAction {
  code: ActionCode;
  level: Exclude<TrackLevel, 'ok'>;
  text: string;                       // 'Open another desk · put someone at the end of the line'
  since: number;                      // first time this code was the top action (column shows '· 3m')
  target: { zoneId: string; name: string } | null; // redirect target (seats_full)
  incidentType: IncidentType | null;  // incident this action is tied to, if any
}

/** Smoothed values (latest). null = not tracked for this zone type / no data / model abstained ('na'). */
export interface ZoneMetrics {
  crowd: number | null;               // score 0.0–4.0 (1 dp)
  crowdLevel: CrowdLevel | null;      // display level (= Zone.crowdLevel)
  people: number | null;              // fused median (= Zone.peopleEstimate)
  peopleText: string | null;          // '~12' · '≥40' (high/critical) · '50–100' · '100+'
  queue: number | null;
  queueSpills: boolean;
  waitMin: number | null;             // est., rounded to 0.5
  seatsFree: number | null;           // 0..1
  walkway: Exclude<Walkway, 'na'> | null;
  walkwayFlag: 'narrowed' | 'blocked' | null; // k-of-n latched flag (drives actions/incidents)
  hazard: { type: HazardType; conf: number } | null; // confirmed (k-of-n or fast lane)
}

export interface TrackSource { kind: 'camera' | 'staff' | 'manual' | 'chat'; id: string; label: string; at: number }

export interface ZoneTrack {
  tier: Tier;
  tierSince: number;
  crowdTier: Tier;                    // tier from crowd alone (queue / human floor / blocked corridor can lift `tier`)
  level: TrackLevel;
  action: ZoneAction | null;          // derive-time top action; UI/assistant overlay with liveAction(zone, now)
  driver: MetricKey | null;           // metric that set tier/action ('crowd', 'queue', 'walkway', …)
  metrics: ZoneMetrics;
  trend: Trend | null;
  conf: number;                       // mean frame confidence over the window × min(1, nUsable / 3)
  nUsable: number;                    // usable camera frames in the window
  badStreak: number;                  // consecutive unusable camera frames
  lastUsableAt: number | null;        // last usable camera frame
  lastHumanAt: number | null;         // last staff/manual crowd report
  hold: { tier: Tier; until: number; by: string } | null; // human floor (staff/manual report)
  sources: TrackSource[];             // newest first, ≤ 4: what fed the current values
  updatedAt: number;
}

/** Zone gains (toZone in server/world.ts fills them). */
export interface Zone {
  zoneType: ZoneType;
  queueRate: number | null;           // override in people/min; null = ZONE_TYPE_PROFILE default
  lastServiceAt: number | null;       // stretch: last Cleaned / Restocked tap
  track: ZoneTrack | null;            // null = not observed since tracking shipped
}

/** One usable-or-not observation as the tracker sees it (server-internal; kept ≤ KEEP_N in ZoneTrackState.win). */
export interface ZoneSample {
  t: number;
  dev: string;                        // device id (fusion key)
  ok: boolean;                        // scene_ok && conf ≥ MIN_STATE_CONFIDENCE
  conf: number;
  crowd: number | null;               // CROWD_LEVELS index 0..4
  people: number | null;
  queue: number | null;
  spill: boolean;
  seats: number | null;               // free share 0..1
  walk: 0 | 1 | 2 | null;             // WALKWAY_RANK
  hz: Array<{ type: HazardType; h: number }>;
}
/** Server-internal state stored in zones.track_json (only `track` goes on the wire). Rebuildable by replaying observations. */
export interface ZoneTrackState {
  v: 1;
  win: ZoneSample[];                  // camera samples, newest last, ≤ KEEP_N, ≤ WINDOW_MS old
  crowdSince: number;
  queueTier: Tier;
  queueSince: number;
  flags: { spill: boolean; blocked: boolean; narrowed: boolean; hazards: HazardType[] }; // latched k-of-n
  waitHighSince: number | null;
  queueAtHigh: number | null;
  risingSince: number | null;
  seatsLowSince: number | null;
  track: ZoneTrack;
}

// ── Time series (zone_metrics, 30-s buckets) ─────────────────────────────────────────────────────────────────────────

export interface MetricPoint {
  t: number;                          // bucket start (epoch ms)
  n: number;                          // usable camera frames in the bucket(s)
  crowd: number | null;               // AVG of last smoothed score per bucket
  people: number | null;
  queue: number | null;
  wait: number | null;
  seats: number | null;
  walkway: number | null;             // MAX 0 clear · 1 narrowed · 2 blocked
  hazard: number | null;              // MAX hazard confidence
  tier: number | null;                // MAX 0..3
  conf: number | null;
}
export interface ZoneSeriesBatch { resMs: number; from: number; to: number; series: Record<string, MetricPoint[]> }
export interface ZoneSeries { zoneId: string; resMs: 30_000 | 120_000 | 300_000; from: number; to: number; points: MetricPoint[] }

/** Stretch: one-tap service events, stored as immutable manual observations. */
export type ServiceKind = 'clean' | 'restock';
export interface ManualPayload { service?: ServiceKind }
export interface ManualBody { service?: ServiceKind }

// ── Pure helpers (shared so table, map, assistant and server agree) ──────────────────────────────────────────────────

/** Freshness at read time (no server timer). */
export function signalAt(t: ZoneTrack | null, now: number): Signal {
  if (!t || (t.lastUsableAt == null && t.lastHumanAt == null)) return 'none';
  if (t.badStreak >= ZONE_TRACK.BLIND_STREAK) return 'blind';
  const last = Math.max(t.lastUsableAt ?? 0, t.lastHumanAt ?? 0);
  if (now - last > ZONE_STALE_MS) return 'stale';
  if (t.lastUsableAt != null && now - t.lastUsableAt <= ZONE_TRACK.LIVE_MS && t.nUsable >= ZONE_TRACK.MIN_USABLE && t.conf >= ZONE_TRACK.LIVE_CONF) return 'live';
  return 'weak';
}

/** Counts saturate in dense crowds → lower bound at high/critical, bands above 50. */
export function peopleText(people: number | null, level: CrowdLevel | null): string | null {
  if (people == null) return null;
  if (people > 100) return '100+';
  if (people > 50) return '50–100';
  if (level === 'high' || level === 'critical') return `≥${people}`;
  return `~${people <= 20 ? people : Math.round(people / 5) * 5}`;
}

/** Display crowd level for a crowd tier (keeps CROWD_TO_STATUS[crowdLevel] === TIER_STATUS[crowdTier]). */
export const crowdLevelOf = (crowdTier: Tier, score: number | null): CrowdLevel =>
  crowdTier === 3 ? 'critical' : crowdTier === 2 ? 'high' : crowdTier === 1 ? 'moderate' : (score ?? 0) < 0.5 ? 'empty' : 'low';

// ── Zone tracking REST API ───────────────────────────────────────────────────────────────────────────────────────────
// POST  /api/events/:eventId/zones   body { name, polygon, zoneType? } → { zone }          (zoneType default inferZoneType(name))
// PUT   /api/events/:eventId/zones   zones[] items gain zoneType?                              (new zones: inferZoneType)
// PATCH /api/zones/:zoneId           body { name?, polygon?, zoneType?, queueRate?: number | null, version } → { zone }
//                                    (zoneType change resets the track window: track_json = NULL)
// GET   /api/zones/:zoneId/series?mins=30  → ZoneSeries   (mins ≤ 30 → 30-s buckets · ≤ 120 → 2-min · else 5-min; max 720)
// GET   /api/events/:eventId/zone-series?mins=30 → ZoneSeriesBatch (every zone, all metrics; one call for the zone table; staff+)
// POST  /api/zones/:zoneId/service   body { kind: ServiceKind } → ObservationResult          (stretch; staff+; manual observation)
// SSE:  unchanged — the 'zone' frame carries Zone incl. track. Snapshot.zones likewise.
// Data view: add 'zone_metrics' to DATA_TABLES for CSV export (optional).

// ── Live device pulses (ephemeral SSE `pulse`, never stored) ─────────────────────────────────────────────────────────
// frame = a camera frame arrived (before AI) · speech = a scribe audio chunk arrived (level ≈ how much speech) · heartbeat.
export interface DevicePulse { deviceId: string; kind: 'frame' | 'speech' | 'heartbeat'; level: number | null; at: number }

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// AI CREW: personas bound to cameras / scribes / the whole event. They watch, post to radio as themselves, dispatch work,
// and verify fixes — always through the same rules (the model proposes; rules decide; every action is recorded).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export const AGENT_ROLES = ['queue_watcher', 'safety_sentinel', 'crowd_analyst', 'meeting_secretary', 'dispatcher', 'concierge'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
export interface AgentRoleDef { role: AgentRole; label: string; description: string; icon: string; binds: 'camera' | 'scribe' | 'none'; instructions: string }
export const AGENT_ROLE_DEFS: Record<AgentRole, AgentRoleDef> = {
  queue_watcher: { role: 'queue_watcher', label: 'Queue Watcher', icon: 'ListOrdered', binds: 'camera',
    description: 'Watches lines at desks and counters and calls for help before waits get long.',
    instructions: 'Focus on lines: count people waiting, note where the line ends and whether it spills past the desk area. Flag when the wait looks longer than 5 minutes.' },
  safety_sentinel: { role: 'safety_sentinel', label: 'Safety Sentinel', icon: 'ShieldCheck', binds: 'camera',
    description: 'Watches for blocked exits, spills, overcrowding and anyone who needs help.',
    instructions: 'Focus on safety: blocked walkways and exits, liquids on the floor, cables across paths, people lying down or in distress, smoke, and crowd pressure near doors.' },
  crowd_analyst: { role: 'crowd_analyst', label: 'Crowd Analyst', icon: 'Users', binds: 'camera',
    description: 'Tracks how full each zone is and suggests where to send people.',
    instructions: 'Focus on occupancy: how full seating and tables are, where free space remains, and whether people are standing because seats are gone.' },
  meeting_secretary: { role: 'meeting_secretary', label: 'Meeting Secretary', icon: 'NotebookPen', binds: 'scribe',
    description: 'Listens to the ops meeting and turns it into owned tasks and decisions.',
    instructions: 'Capture every concrete action item with its owner and time, and every decision. Ignore small talk. Prefer updating an existing issue over creating a duplicate.' },
  dispatcher: { role: 'dispatcher', label: 'Dispatcher', icon: 'Send', binds: 'none',
    description: 'Finds the best available person for unassigned work and radios them.',
    instructions: 'Assign unowned issues to the right team member: same team first, then whoever is closest and free. Radio them with a one-line brief and wait for their "Got it".' },
  concierge: { role: 'concierge', label: 'Concierge', icon: 'MessagesSquare', binds: 'none',
    description: 'The attendee chatbot: answers questions and turns requests into tasks.',
    instructions: 'Be warm and brief. Answer from the run-of-show and live zone status. Turn any request or problem into a task for the team and tell the attendee it is on its way.' },
};
export type CrewStatus = 'watching' | 'listening' | 'on_duty' | 'idle' | 'offline' | 'paused';
export interface CrewAgent {
  id: string;
  eventId: string;
  name: string;
  role: AgentRole;
  instructions: string;
  deviceId: string | null;
  zoneIds: string[];
  teamId: string | null;
  participantId: string;          // the agent's radio identity
  active: boolean;
  status: CrewStatus;             // derived from the bound device (or on duty for event-level agents)
  lastAction: string | null;
  lastActionAt: number | null;
  stats: { observations: number; posts: number; issues: number };
  watching: string[];             // issue ids this agent is verifying
  createdAt: number;
}
export interface AgentPost { id: string; agentId: string; kind: 'radio' | 'note' | 'proposal' | 'verify' | 'assign'; text: string; issueKey: string | null; at: number }
export interface CrewState { crew: CrewAgent[]; crewPosts: AgentPost[] }
// GET    /api/events/:eventId/agents → { crew, crewPosts }
// POST   /api/events/:eventId/agents {name, role, instructions?, deviceId?, zoneIds?, teamId?} → { agent }   (admin)
// PATCH  /api/agents/:id {name?, instructions?, deviceId?, zoneIds?, teamId?, active?} → { agent }      (admin)
// DELETE /api/agents/:id → { ok: true }                                                               (admin)
// POST   /api/issues/:id/assign-agent {agentId: string | null} → { agent: CrewAgent | null }          (staff+; watch & verify)
// SSE frames: `agent` (CrewAgent), `agent_post` (AgentPost).

// ── Invites & members (joining a space should take one tap) ──────────────────────────────────────────────────────────
// Invite links: `${origin}/i/<token>` (only sha256(token) is stored; the URL is shown once, at creation).
// POST   /api/events/:eventId/invites {role, teamId?, maxUses?, expiresInHours?, note?} → { invite: InviteInfo, url }   (admin)
// GET    /api/events/:eventId/invites → { invites: InviteInfo[] }                                                        (admin)
// DELETE /api/invites/:inviteId → { ok: true }                                                                           (admin; revoke)
// GET    /api/invites/:token → InvitePreview                                                                            (public)
// POST   /api/invites/:token/accept → { eventId, role }        (signed-in user; idempotent; 409 NEEDS_LOGIN when signed out)
// POST   /api/events/join-by-code {code, as: 'staff', teamId?} → { eventId, role }                                      (signed-in user)
// POST   /api/events/:eventId/members {username, role, teamId?} → { member: Member }                                   (admin)
// GET    /api/events/:eventId/members → { members: Member[] }                                                           (admin)
export type InviteRole = 'admin' | 'staff';
export type InviteStatus = 'active' | 'expired' | 'used_up' | 'revoked';
export interface InviteInfo {
  id: string; eventId: string; role: InviteRole; teamId: string | null; teamName: string | null; createdBy: string | null;
  createdAt: number; expiresAt: number | null; maxUses: number | null; uses: number; status: InviteStatus; note: string | null;
}
export interface InvitePreview {
  valid: boolean; status: InviteStatus | 'not_found'; eventId: string | null; eventName: string | null; role: InviteRole | null;
  teamName: string | null; inviterName: string | null; expiresAt: number | null;
  /** True when the signed-in user is already a member of this event. */
  alreadyMember: boolean;
}
export interface Member {
  participantId: string; userId: string | null; username: string | null; displayName: string; role: Role; teamId: string | null;
  teamName: string | null; joinedAt: number; lastSeenAt: number; online: boolean;
}

// ── Venue presets + install slots (one-scan device setup, no login) ──────────────────────────────────────────────────
// POST /api/events {name, templateId: 'startup-branch'} → event with the real floor plan, typed zones, teams and event-level crew.
// POST /api/events/:eventId/map/preset {presetId} → { map, zones } (admin; replaces the map + all zones with the preset's).
// GET  /api/presets/slot/:joinCode/:slotId → { event: EventInfo, slot: InstallSlot } (public; for the setup screen).
// POST /api/join {code, as: 'camera' | 'scribe', slot} → the device takes the slot's label, zone, map position and team, and the slot's
//      crew persona is created or re-bound to it (re-scanning moves the slot to the new phone).

// ── Phone v4: chat-first staff app + swipe decisions ─────────────────────────────────────────────────────────────────
// Field staff phones show only Chat (assistant; photo/video attachments become field reports) and Radio. New assignments
// arrive as swipe cards: right = accept (issue → in_progress, my location → its zone), left = decline.
// POST /api/issues/:id/decline {reason?} → { issue }   (the assignee hands it back; an issue_event "Declined by <name>" is
//      recorded; the dispatcher will not offer it to the same person again)
export interface DeclineBody { reason?: string | null }
