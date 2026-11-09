// Typed REST client. Cookie session (`wv`, httpOnly) rides along on every same-origin request.
import type {
  ApiError, AskResult, AssistantTurn, CameraRegion, EventKnowledge, AuthState, ChatReply, DataPage, DataTable, Report, ReportCategory, Urgency, VenueMapInfo, ZoneSuggestion,
  ChatReply as _ChatReply, ChatState, CreateEventBody, Issue, IssueKind, IssueStatus, IssueTimeline, Participant, Priority,
  Proposal, TalkMessage, Team, Utterance, Device, EventInfo, FrameResult, Incident, JoinBody, ManualBody, Me, ObservationResult,
  Snapshot, Task, VenueTemplate, Zone, TaskStatus,
} from '@shared/contracts';

export class HttpError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Opts = { method?: string; body?: unknown; raw?: Blob; signal?: AbortSignal; query?: Record<string, string | null | undefined> };

export async function api<T>(path: string, o: Opts = {}): Promise<T> {
  const qs = o.query ? Object.entries(o.query).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&') : '';
  const url = qs ? `${path}?${qs}` : path;
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (o.raw) { body = o.raw; headers['Content-Type'] = o.raw.type || 'application/octet-stream'; }
  else if (o.body !== undefined) { body = JSON.stringify(o.body); headers['Content-Type'] = 'application/json'; }
  let res: Response;
  try {
    res = await fetch(url, { method: o.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin', signal: o.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new HttpError(0, 'NETWORK', "Can't reach the server. Check your connection.");
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = (json as ApiError | null)?.error;
    throw new HttpError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? 'Something went wrong. Try again.');
  }
  return json as T;
}

export const API = {
  me: () => api<{ me: Me | null; event: EventInfo | null }>('/api/me'),
  templates: () => api<{ templates: VenueTemplate[] }>('/api/templates'),
  createEvent: (b: CreateEventBody) => api<{ event: EventInfo; me: Me }>('/api/events', { body: b }),
  joinPreview: (code: string) => api<{ event: EventInfo; zones: Array<{ id: string; name: string }> }>(`/api/join/${encodeURIComponent(code)}`),
  join: (b: JoinBody) => api<{ me: Me; device: Device }>('/api/join', { body: b }),
  /** Attendee join: device is null. */
  joinAttendee: (code: string) => api<{ me: Me; device: null }>('/api/join', { body: { code, as: 'attendee' } satisfies JoinBody }),
  chatState: (eventId?: string) => api<ChatState>('/api/chat', { query: { eventId } }),
  chat: (message: string, zoneId?: string | null, eventId?: string) => api<ChatReply>('/api/chat', { body: { message, zoneId, eventId } }),
  chatZone: (zoneId: string | null, eventId?: string) => api<{ myZoneId: string | null }>('/api/chat/zone', { method: 'PATCH', body: { zoneId, eventId } }),
  adminClaim: (eventId: string, key: string) => api<{ me: Me }>('/api/admin-claim', { body: { eventId, key } }),
  snapshot: (eventId: string) => api<Snapshot>(`/api/events/${eventId}/snapshot`),
  adminLink: (eventId: string) => api<{ url: string }>(`/api/events/${eventId}/admin-link`),

  createZone: (eventId: string, b: { name: string; polygon: Array<[number, number]> }) => api<{ zone: Zone }>(`/api/events/${eventId}/zones`, { body: b }),
  patchZone: (zoneId: string, b: { name?: string; polygon?: Array<[number, number]>; version: number }) => api<{ zone: Zone }>(`/api/zones/${zoneId}`, { method: 'PATCH', body: b }),
  deleteZone: (zoneId: string) => api<{ ok: true }>(`/api/zones/${zoneId}`, { method: 'DELETE' }),

  patchDevice: (deviceId: string, b: { zoneId?: string | null; mode?: Device['mode']; label?: string }) => api<{ device: Device }>(`/api/devices/${deviceId}`, { method: 'PATCH', body: b }),
  heartbeat: (deviceId: string, mode: Device['mode']) => api<{ device: Device; serverTime: number }>(`/api/devices/${deviceId}/heartbeat`, { body: { mode } }),
  frame: (deviceId: string, jpeg: Blob, signal?: AbortSignal) => api<FrameResult>(`/api/devices/${deviceId}/frames`, { raw: jpeg, signal }),
  manual: (deviceId: string, b: ManualBody) => api<ObservationResult>(`/api/devices/${deviceId}/manual`, { body: b }),
  report: (deviceId: string, text: string, zoneId?: string | null) => api<ObservationResult>(`/api/devices/${deviceId}/report`, { body: { text, zoneId } }),
  voice: (deviceId: string, audio: Blob, zoneId?: string | null) => api<ObservationResult>(`/api/devices/${deviceId}/voice`, { raw: audio, query: { zoneId } }),

  patchIncident: (incidentId: string, status: 'acknowledged' | 'resolved') => api<{ incident: Incident }>(`/api/incidents/${incidentId}`, { method: 'PATCH', body: { status } }),
  patchTask: (taskId: string, b: { status?: TaskStatus; assigneeId?: string | null }) => api<{ task: Task }>(`/api/tasks/${taskId}`, { method: 'PATCH', body: b }),
  assistant: (question: string) => api<{ answer: string; model: string }>('/api/assistant', { body: { question } }),

  // ── ops tracker ──
  createTeam: (eventId: string, name: string) => api<{ team: Team }>(`/api/events/${eventId}/teams`, { body: { name } }),
  renameTeam: (teamId: string, name: string) => api<{ team: Team }>(`/api/teams/${teamId}`, { method: 'PATCH', body: { name } }),
  deleteTeam: (teamId: string) => api<{ ok: true }>(`/api/teams/${teamId}`, { method: 'DELETE' }),
  updateMe: (eventId: string, b: { displayName?: string; teamId?: string | null }) => api<{ me: Me; participant: Participant }>('/api/me', { method: 'PATCH', body: { eventId, ...b } }),
  /** Scribe chunk (WAV preferred). Returns utterance null when the chunk had no intelligible speech. */
  scribeAudio: (deviceId: string, audio: Blob, meta: { startedAt: number; endedAt: number; seq: number }, signal?: AbortSignal) =>
    api<{ utterance: Utterance | null }>(`/api/devices/${deviceId}/audio`, { raw: audio, signal, query: { startedAt: String(meta.startedAt), endedAt: String(meta.endedAt), seq: String(meta.seq) } }),
  /** to: 'hq' | 'all' | `team:${id}` | `person:${id}` */
  talk: (audio: Blob, to: string, eventId?: string) => api<{ message: TalkMessage; utterance: Utterance }>('/api/talk', { raw: audio, query: { to, eventId } }),
  talkText: (text: string, to: string, eventId?: string) => api<{ message: TalkMessage; utterance: Utterance }>('/api/talk/text', { body: { text, to, eventId } }),
  ack: (messageId: string) => api<{ message: TalkMessage }>(`/api/messages/${messageId}/ack`, { body: {} }),
  createIssue: (eventId: string, b: { title: string; kind?: IssueKind; priority?: Priority; teamId?: string | null; assigneeId?: string | null; dueAt?: number | null }) =>
    api<{ issue: Issue }>(`/api/events/${eventId}/issues`, { body: b }),
  patchIssue: (issueId: string, b: { status?: IssueStatus; priority?: Priority; assigneeId?: string | null; teamId?: string | null; title?: string; dueAt?: number | null }) =>
    api<{ issue: Issue }>(`/api/issues/${issueId}`, { method: 'PATCH', body: b }),
  timeline: (issueId: string) => api<IssueTimeline>(`/api/issues/${issueId}/timeline`),
  undo: (issueEventId: number) => api<{ issue: Issue }>(`/api/issue-events/${issueEventId}/undo`, { body: {} }),
  decideProposal: (proposalId: string, decision: 'accept' | 'reject') => api<{ proposal: Proposal; issue: Issue | null }>(`/api/proposals/${proposalId}`, { body: { decision } }),
  ask: (question: string, eventId?: string, teamId?: string | null) => api<AskResult>('/api/ask', { body: { question, eventId, teamId } }),

  // ── v3: accounts ──
  authMe: () => api<AuthState>('/api/auth/me'),
  signup: (b: { username: string; password: string; displayName: string }) => api<AuthState>('/api/auth/signup', { body: b }).then(forgetPerUserState),
  login: (b: { username: string; password: string }) => api<AuthState>('/api/auth/login', { body: b }).then(forgetPerUserState),
  logout: () => api<{ ok: true }>('/api/auth/logout', { body: {} }).then(forgetPerUserState),

  // ── v3: venue map ──
  uploadMap: (eventId: string, image: Blob) => api<{ map: VenueMapInfo; suggestions: ZoneSuggestion[] }>(`/api/events/${eventId}/map`, { raw: image }),
  suggestZones: (eventId: string) => api<{ suggestions: ZoneSuggestion[] }>(`/api/events/${eventId}/map/suggest`, { body: {} }),
  deleteMap: (eventId: string) => api<{ ok: true }>(`/api/events/${eventId}/map`, { method: 'DELETE' }),
  replaceZones: (eventId: string, zones: Array<{ id?: string; name: string; polygon: Array<[number, number]> }>) =>
    api<{ zones: Zone[] }>(`/api/events/${eventId}/zones`, { method: 'PUT', body: { zones } }),

  // ── v3: field reports ──
  createReport: (b: { eventId: string; zoneId?: string | null; hereZoneId?: string | null; category: ReportCategory | 'auto'; urgency: Urgency | 'auto'; text?: string | null; photo?: string | null; photos?: string[] | null; audio?: string | null; parentReportId?: string | null }) =>
    api<{ report: Report; issue: Issue | null }>('/api/reports', { body: b }),
  reports: (eventId: string, mine = false) => api<{ reports: Report[] }>('/api/reports', { query: { eventId, mine: mine ? '1' : null } }),
  declineIssue: (issueId: string, reason?: string | null) => api<{ issue: Issue }>(`/api/issues/${issueId}/decline`, { body: { reason: reason ?? null } }),
  getReport: (id: string) => api<{ report: Report; issue: Issue | null; related: Report[] }>(`/api/reports/${id}`),

  // ── v3: staff assistant ──
  assistantTurn: (b: { eventId: string; text?: string; audio?: string; speak?: boolean }) => api<AssistantTurn>('/api/assistant/turn', { body: b }),
  /** Returns an object URL for audio/mpeg (caller revokes), or throws so the caller can fall back to speechSynthesis. */
  tts: async (text: string): Promise<string> => {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), credentials: 'same-origin' });
    if (!r.ok) throw new HttpError(r.status, 'TTS_FAILED', 'Voice reply unavailable.');
    return URL.createObjectURL(await r.blob());
  },

  // ── v3: scan, grid, camera calibration, knowledge ──
  scanMap: (eventId: string, frames: string[], note?: string) => api<{ map: VenueMapInfo; suggestions: ZoneSuggestion[] }>(`/api/events/${eventId}/map/scan`, { body: { frames, note } }),
  setGrid: (eventId: string, grid: { cols: number; rows: number } | null) => api<{ map: VenueMapInfo }>(`/api/events/${eventId}/map`, { method: 'PATCH', body: { grid } }),
  uploadMapAs: (eventId: string, image: Blob, kind: 'floorplan' | 'photo') => api<{ map: VenueMapInfo; suggestions: ZoneSuggestion[] }>(`/api/events/${eventId}/map`, { raw: image, query: { kind } }),
  cameraSnapshot: (deviceId: string, jpeg: Blob) => api<{ snapshotUrl: string }>(`/api/devices/${deviceId}/snapshot`, { raw: jpeg }),
  setRegions: (deviceId: string, regions: CameraRegion[]) => api<{ device: Device }>(`/api/devices/${deviceId}/regions`, { method: 'PUT', body: { regions } }),
  knowledge: (eventId: string) => api<EventKnowledge>(`/api/events/${eventId}/knowledge`),
  setKnowledge: (eventId: string, text: string) => api<{ ok: true }>(`/api/events/${eventId}/knowledge`, { method: 'PUT', body: { text } }),

  // ── v3: live data ──
  data: (eventId: string, table: DataTable, o: { limit?: number; offset?: number; q?: string } = {}) =>
    api<DataPage>(`/api/events/${eventId}/data/${table}`, { query: { limit: String(o.limit ?? 200), offset: String(o.offset ?? 0), q: o.q || null } }),
  dataCsvUrl: (eventId: string, table: DataTable) => `/api/events/${eventId}/data/${table}.csv`,
};

/** A different account may now be using this tab: drop per-person state kept in the tab (assistant conversations). */
function forgetPerUserState<T>(v: T): T {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('wayve:assistant')) sessionStorage.removeItem(k);
    }
  } catch { /* storage unavailable */ }
  return v;
}

/** Read a Blob as a data: URL (for photo/audio in JSON bodies). */
export const blobToDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});
