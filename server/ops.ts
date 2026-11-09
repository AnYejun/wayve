// Ops tracker engine. Records (utterances, observations) are immutable; issues are world state changed ONLY here, and
// every change writes an issue_events row with its evidence and the raw old value (so AI/rule changes can be undone).
// The model proposes actions (server/ai.ts extractActions); applyAction() decides: auto-apply above the confidence bar,
// otherwise a pending proposal for a human. Names/teams are resolved deterministically — the model never picks ids.
import { agentFocus, secretaryNote } from './crew.ts';
import {
  AUTO_APPLY_CONFIDENCE, AUTO_DONE_CONFIDENCE, RADIO_AUDIO_TTL_MS, DEVICE_OFFLINE_MS, ESCALATE_AFTER_MS, INCIDENT_LABEL, ISSUE_KIND_LABEL,
  ISSUE_STATUS_LABEL, PRIORITY_LABEL,
  type EvidenceRef, type Incident, type Issue, type IssueEvent, type IssueKind, type IssueStatus, type Notify, type OpsState,
  type Priority, type Proposal, type ProposedAction, type TalkMessage, type Team, type Utterance, type UtteranceSource,
} from '../shared/contracts.ts';
import { aiInfo, extractActions, type ExtractInput } from './ai.ts';
import { q, tx } from './db.ts';
import { log } from './log.ts';
import { config } from './config.ts';
import { eventChannel, publish } from './sse.ts';
import { getEvent, newId, publishAll, type Frame, type ObservationRow, type ParticipantRow , listZoneRows } from './world.ts';

// ── rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TeamRow = { id: string; event_id: string; name: string; sort: number; deleted_at: number | null };
export type UtteranceRow = {
  id: string; event_id: string; team_id: string | null; device_id: string; participant_id: string; speaker: string; source: string;
  text: string; started_at: number; ended_at: number; model: string | null; latency_ms: number | null; created_at: number;
};
export type IssueRow = {
  id: string; event_id: string; number: number; title: string; kind: string; status: string; priority: string; team_id: string | null;
  assignee_id: string | null; assignee_hint: string | null; due_at: number | null; zone_id: string | null; created_by: string;
  incident_id: string | null; escalated: number; created_at: number; updated_at: number; version: number;
};
type IssueEventRow = {
  id: number; issue_id: string; event_id: string; kind: string; field: string | null; from_raw: string | null; to_raw: string | null;
  from_label: string | null; to_label: string | null; actor: string; actor_id: string | null; actor_name: string; evidence_json: string;
  confidence: number | null; undone: number; at: number;
};
type ProposalRow = {
  id: string; event_id: string; status: string; action_json: string; summary: string; confidence: number; evidence_json: string;
  issue_id: string | null; created_at: number; decided_at: number | null; decided_by: string | null;
};
type MessageRow = {
  id: string; event_id: string; from_id: string; to_type: string; to_id: string | null; to_label: string; text: string;
  utterance_id: string; expected_json: string; created_at: number; audio_path?: string | null; duration_ms?: number | null;
};
type RefKey = { type: 'utterance' | 'observation'; id: string };

const KEY = (n: number) => `WV-${n}`;

// ── mappers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const toTeam = (r: TeamRow): Team => ({ id: r.id, eventId: r.event_id, name: r.name, sort: r.sort });

export function evidenceRef(ref: RefKey): EvidenceRef | null {
  if (ref.type === 'utterance') {
    const u = q.get<UtteranceRow>('SELECT * FROM utterances WHERE id = ?', ref.id);
    if (!u) return null;
    return { type: 'utterance', id: u.id, text: u.text, at: u.started_at, source: u.source as UtteranceSource, speaker: u.speaker, teamId: u.team_id };
  }
  const o = q.get<ObservationRow>('SELECT * FROM observations WHERE id = ?', ref.id);
  if (!o) return null;
  const p = JSON.parse(o.payload_json) as { kind: string; summary?: string; transcript?: string; note?: string | null; issue_type?: string | null };
  const text = p.kind === 'vision' ? (p.summary ?? '') : p.kind === 'report' ? (p.transcript ?? p.summary ?? '') : (p.note || (p.issue_type ? INCIDENT_LABEL[p.issue_type as keyof typeof INCIDENT_LABEL] : 'Manual entry'));
  const who = q.get<{ label: string }>('SELECT label FROM devices WHERE id = ?', o.device_id)?.label
    ?? q.get<{ display_name: string }>('SELECT display_name FROM participants WHERE id = ?', o.participant_id)?.display_name ?? null;
  return { type: 'observation', id: o.id, text, at: o.observed_at, source: o.modality as EvidenceRef['source'], speaker: who, teamId: null };
}
const refs = (json: string): EvidenceRef[] => (JSON.parse(json) as RefKey[]).map(evidenceRef).filter((x): x is EvidenceRef => !!x);

export function toIssue(r: IssueRow): Issue {
  const ev = q.all<{ ref_type: 'utterance' | 'observation'; ref_id: string }>('SELECT ref_type, ref_id FROM issue_evidence WHERE issue_id = ? ORDER BY at DESC', r.id);
  return {
    id: r.id, eventId: r.event_id, number: r.number, key: KEY(r.number), title: r.title, kind: r.kind as IssueKind, status: r.status as IssueStatus,
    priority: r.priority as Priority, teamId: r.team_id, assigneeId: r.assignee_id, assigneeHint: r.assignee_hint, dueAt: r.due_at,
    zoneId: r.zone_id, createdBy: r.created_by as Issue['createdBy'], incidentId: r.incident_id, escalated: !!r.escalated,
    createdAt: r.created_at, updatedAt: r.updated_at, version: r.version, evidenceCount: ev.length,
    lastEvidence: ev[0] ? evidenceRef({ type: ev[0].ref_type, id: ev[0].ref_id }) : null,
  };
}

function undoableIds(issueId: string): Set<number> {
  // The latest non-undone AI/rule change of each field can be undone (if nothing changed that field after it).
  const rows = q.all<IssueEventRow>(`SELECT * FROM issue_events WHERE issue_id = ? AND field IS NOT NULL ORDER BY id DESC`, issueId);
  const seen = new Set<string>();
  const out = new Set<number>();
  for (const e of rows) {
    if (!e.field || seen.has(e.field)) continue;
    if (e.undone) continue;
    seen.add(e.field);
    if (e.actor !== 'human' && e.kind !== 'undo') out.add(e.id);
  }
  return out;
}

function toIssueEvent(r: IssueEventRow, undoable?: Set<number>): IssueEvent {
  const issue = q.get<{ number: number }>('SELECT number FROM issues WHERE id = ?', r.issue_id);
  const u = undoable ?? undoableIds(r.issue_id);
  return {
    id: r.id, issueId: r.issue_id, issueKey: issue ? KEY(issue.number) : '', eventId: r.event_id, kind: r.kind as IssueEvent['kind'],
    from: r.from_label, to: r.to_label, actor: r.actor as IssueEvent['actor'], actorName: r.actor_name, evidence: refs(r.evidence_json),
    confidence: r.confidence, undoable: u.has(r.id), undone: !!r.undone, at: r.at,
  };
}

export function toUtterance(r: UtteranceRow): Utterance {
  const keys = q.all<{ number: number }>(
    `SELECT i.number FROM issue_evidence e JOIN issues i ON i.id = e.issue_id WHERE e.ref_type = 'utterance' AND e.ref_id = ? ORDER BY i.number`, r.id);
  return {
    id: r.id, eventId: r.event_id, teamId: r.team_id, deviceId: r.device_id, participantId: r.participant_id, speaker: r.speaker,
    source: r.source as UtteranceSource, text: r.text, startedAt: r.started_at, endedAt: r.ended_at, model: r.model, latencyMs: r.latency_ms,
    issueKeys: keys.map((k) => KEY(k.number)),
  };
}

const toProposal = (r: ProposalRow): Proposal => ({
  id: r.id, eventId: r.event_id, status: r.status as Proposal['status'], action: JSON.parse(r.action_json), summary: r.summary,
  confidence: r.confidence, evidence: refs(r.evidence_json), issueId: r.issue_id, createdAt: r.created_at, decidedAt: r.decided_at, decidedBy: r.decided_by,
});

export function toMessage(r: MessageRow): TalkMessage {
  const from = q.get<{ display_name: string }>('SELECT display_name FROM participants WHERE id = ?', r.from_id)?.display_name ?? 'Unknown';
  const acks = q.all<{ participant_id: string; at: number }>('SELECT participant_id, at FROM message_acks WHERE message_id = ? ORDER BY at', r.id);
  const u = q.get<UtteranceRow>('SELECT * FROM utterances WHERE id = ?', r.utterance_id);
  return {
    id: r.id, eventId: r.event_id, fromId: r.from_id, fromName: from, to: { type: r.to_type as TalkMessage['to']['type'], id: r.to_id, label: r.to_label },
    text: r.text, utteranceId: r.utterance_id, issueKeys: u ? toUtterance(u).issueKeys : [], createdAt: r.created_at,
    expected: JSON.parse(r.expected_json), acks: acks.map((a) => ({ participantId: a.participant_id, at: a.at })),
    audioUrl: r.audio_path && Date.now() - r.created_at < RADIO_AUDIO_TTL_MS ? `/media/${r.audio_path}` : null, durationMs: r.duration_ms ?? null,
  };
}

export const getIssueRow = (id: string) => q.get<IssueRow>('SELECT * FROM issues WHERE id = ?', id);
export const listTeams = (eventId: string) => q.all<TeamRow>('SELECT * FROM teams WHERE event_id = ? AND deleted_at IS NULL ORDER BY sort, rowid', eventId);

export function opsState(eventId: string): OpsState {
  const since = Date.now() - 12 * 3600_000;
  const issueRows = q.all<IssueRow>(`SELECT * FROM issues WHERE event_id = ? AND (status != 'done' OR updated_at >= ?) ORDER BY number DESC LIMIT 400`, eventId, since);
  const evRows = q.all<IssueEventRow>('SELECT * FROM issue_events WHERE event_id = ? ORDER BY id DESC LIMIT 200', eventId);
  const undoCache = new Map<string, Set<number>>();
  const und = (issueId: string) => { let s = undoCache.get(issueId); if (!s) { s = undoableIds(issueId); undoCache.set(issueId, s); } return s; };
  return {
    teams: listTeams(eventId).map(toTeam),
    issues: issueRows.map(toIssue),
    issueEvents: evRows.map((r) => toIssueEvent(r, und(r.issue_id))),
    proposals: [
      ...q.all<ProposalRow>(`SELECT * FROM proposals WHERE event_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 100`, eventId),
      ...q.all<ProposalRow>(`SELECT * FROM proposals WHERE event_id = ? AND status != 'pending' ORDER BY decided_at DESC LIMIT 30`, eventId),
    ].map(toProposal),
    utterances: q.all<UtteranceRow>('SELECT * FROM utterances WHERE event_id = ? ORDER BY started_at DESC LIMIT 150', eventId).map(toUtterance),
    messages: q.all<MessageRow>('SELECT * FROM messages WHERE event_id = ? ORDER BY created_at DESC LIMIT 80', eventId).map(toMessage),
  };
}

// ── resolution helpers (deterministic) ──────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.replace(/\s+/g, '').replace(/[.,!?~·'"“”‘’()[\]]/g, '').toLowerCase();
/** Strip Korean vocative/honorific endings a model might keep: 지민아 / 지민씨 / 지민님 / 지민이. */
const baseName = (s: string) => norm(s).replace(/(씨|님|아|야|이가|이)$/u, '');

export function resolvePerson(eventId: string, name: string | null): ParticipantRow | null {
  if (!name) return null;
  const n = baseName(name);
  if (n.length < 1) return null;
  const people = q.all<ParticipantRow>(`SELECT * FROM participants WHERE event_id = ? AND role IN ('staff','admin')`, eventId);
  const exact = people.filter((p) => baseName(p.display_name) === n || norm(p.display_name) === norm(name));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // ambiguous → hint only
  const partial = people.filter((p) => {
    const d = baseName(p.display_name);
    return d.length >= 2 && n.length >= 2 && (d.includes(n) || n.includes(d));
  });
  return partial.length === 1 ? partial[0] : null;
}

export function resolveTeam(eventId: string, name: string | null): TeamRow | null {
  if (!name) return null;
  const n = norm(name).replace(/(팀|team)$/iu, '');
  if (!n) return null;
  const teams = listTeams(eventId);
  return teams.find((t) => norm(t.name).replace(/(팀|team)$/iu, '') === n) ?? teams.find((t) => { const tn = norm(t.name).replace(/(팀|team)$/iu, ''); return tn.length >= 2 && (tn.includes(n) || n.includes(tn)); }) ?? null;
}

/** Offset of the event time zone from UTC at `now` (ms). */
export function tzOffsetMs(now = Date.now()): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: config.EVENT_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(now / 1000) * 1000;
}

/** "14:00" → today's epoch in the event time zone. */
export function parseDue(hhmm: string | null, now = Date.now()): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  const off = tzOffsetMs(now);
  const local = new Date(now + off);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, mi) - off;
}
const DUE_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: config.EVENT_TZ });
const HHMM_FMT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: config.EVENT_TZ });
/** "2:05 PM" in the event's time zone. */
export const fmtDue = (t: number | null) => (t == null ? 'None' : DUE_FMT.format(t));
/** "14:05" 24h in the event's time zone (for model context). */
export const fmtHHMM = (t: number) => HHMM_FMT.format(t);

/** Character-bigram Dice similarity for short Korean titles. */
function similar(a: string, b: string): number {
  const bg = (s: string) => { const t = norm(s); const out: string[] = []; for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2)); return out; };
  const A = bg(a), B = bg(b);
  if (!A.length || !B.length) return norm(a) === norm(b) ? 1 : 0;
  const pool = [...B];
  let hit = 0;
  for (const x of A) { const i = pool.indexOf(x); if (i >= 0) { hit++; pool.splice(i, 1); } }
  return (2 * hit) / (A.length + B.length);
}

const personName = (id: string | null) => (id ? q.get<{ display_name: string }>('SELECT display_name FROM participants WHERE id = ?', id)?.display_name ?? 'Unknown' : 'Unassigned');
const teamName = (id: string | null) => (id ? q.get<{ name: string }>('SELECT name FROM teams WHERE id = ?', id)?.name ?? '—' : 'None');

// ── mutations (call inside tx; return frames to publish after commit) ───────────────────────────────────────────────

export type Actor = { kind: 'ai' | 'rule' | 'human'; id: string | null; name: string };
export const AI_ACTOR: Actor = { kind: 'ai', id: null, name: 'AI' };
export const RULE_ACTOR: Actor = { kind: 'rule', id: null, name: 'Rule' };

function addIssueEvent(issue: IssueRow, kind: string, field: string | null, fromRaw: string | null, toRaw: string | null, fromLabel: string | null,
  toLabel: string | null, actor: Actor, evidence: RefKey[], confidence: number | null, at: number): IssueEventRow {
  const r = q.run(
    `INSERT INTO issue_events (issue_id, event_id, kind, field, from_raw, to_raw, from_label, to_label, actor, actor_id, actor_name, evidence_json, confidence, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    issue.id, issue.event_id, kind, field, fromRaw, toRaw, fromLabel, toLabel, actor.kind, actor.id, actor.name, JSON.stringify(evidence), confidence, at);
  return q.get<IssueEventRow>('SELECT * FROM issue_events WHERE id = ?', Number(r.lastInsertRowid))!;
}

function linkEvidence(issueId: string, evidence: RefKey[], at: number) {
  for (const e of evidence) q.run('INSERT OR IGNORE INTO issue_evidence (issue_id, ref_type, ref_id, at) VALUES (?, ?, ?, ?)', issueId, e.type, e.id, at);
}

function notifyFrame(n: Omit<Notify, 'id'>): Frame {
  return ['notify', { id: newId('nt'), ...n }];
}

const DEFAULT_ACTION: Record<IssueKind, string> = {
  problem: 'Check it on site', task: 'Start it and mark your progress', question: 'Find the answer and reply on radio', decision: 'Share the decision with your team',
};

/** Location-first dispatch notify: "Go to Entrance" · "WV-12 · Long queue at registration" + the first step to take. */
function dispatchNotify(issue: IssueRow, participantId: string | 'hq', kind: NonNullable<Notify['kind']>, now: number, lead?: string): Frame {
  const zone = issue.zone_id ? q.get<{ id: string; name: string }>('SELECT id, name FROM zones WHERE id = ?', issue.zone_id) : undefined;
  let action: string | null = null;
  if (issue.incident_id) {
    const t = q.get<{ steps_json: string }>(`SELECT steps_json FROM tasks WHERE incident_id = ? AND steps_json != '[]' ORDER BY created_at DESC LIMIT 1`, issue.incident_id);
    try { action = t ? (JSON.parse(t.steps_json) as string[])[0] ?? null : null; } catch { action = null; }
  }
  action ??= DEFAULT_ACTION[issue.kind as IssueKind] ?? 'Check it on site';
  const title = lead ?? (zone ? `Go to ${zone.name}` : kind === 'assigned' ? 'Assigned to you' : 'Needs attention');
  return notifyFrame({
    participantId, kind, title, body: `${KEY(issue.number)} · ${issue.title}${issue.due_at ? ` · due ${fmtDue(issue.due_at)}` : ''}`,
    issueId: issue.id, messageId: null, at: now, zoneId: zone?.id ?? null, zoneName: zone?.name ?? null, issueKey: KEY(issue.number),
    issueTitle: issue.title, priority: issue.priority as Priority, action,
  });
}

function issueFrames(issueId: string, events: IssueEventRow[]): Frame[] {
  const row = getIssueRow(issueId)!;
  const und = undoableIds(issueId);
  // Every earlier event of this issue may have changed undoable state → resend the latest few too.
  const recent = q.all<IssueEventRow>('SELECT * FROM issue_events WHERE issue_id = ? ORDER BY id DESC LIMIT 12', issueId);
  const ids = new Set(events.map((e) => e.id));
  const all = [...events, ...recent.filter((r) => !ids.has(r.id))];
  return [['issue', toIssue(row)], ...all.map((e) => ['issue_event', toIssueEvent(e, und)] as Frame)];
}

export interface CreateIssueInput {
  eventId: string; title: string; kind: IssueKind; priority: Priority; status?: IssueStatus; teamId: string | null; assigneeId: string | null;
  assigneeHint: string | null; dueAt: number | null; zoneId?: string | null; incidentId?: string | null; actor: Actor; evidence: RefKey[];
  confidence: number | null; now?: number;
}

export function createIssue(inp: CreateIssueInput): { issue: IssueRow; frames: Frame[] } {
  const now = inp.now ?? Date.now();
  const number = (q.get<{ n: number }>('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM issues WHERE event_id = ?', inp.eventId)?.n ?? 1);
  const id = newId('is');
  const status = inp.status ?? (inp.kind === 'decision' ? 'done' : 'open');
  q.run(
    `INSERT INTO issues (id, event_id, number, title, kind, status, priority, team_id, assignee_id, assignee_hint, due_at, zone_id, created_by, incident_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, inp.eventId, number, inp.title.slice(0, 120), inp.kind, status, inp.priority, inp.teamId, inp.assigneeId, inp.assigneeHint, inp.dueAt,
    inp.zoneId ?? null, inp.actor.kind, inp.incidentId ?? null, now, now);
  linkEvidence(id, inp.evidence, now);
  const issue = getIssueRow(id)!;
  const ev = addIssueEvent(issue, 'created', null, null, null, null, `Created · ${ISSUE_KIND_LABEL[inp.kind]} · ${PRIORITY_LABEL[inp.priority]}`, inp.actor, inp.evidence, inp.confidence, now);
  const frames = issueFrames(id, [ev]);
  if (inp.assigneeId && inp.assigneeId !== inp.actor.id) {
    frames.push(dispatchNotify(issue, inp.assigneeId, 'assigned', now));
  }
  if (inp.priority === 'p0') frames.push(dispatchNotify(issue, 'hq', 'escalation', now, 'Urgent issue'));
  return { issue, frames };
}

export interface IssueChange { status?: IssueStatus; priority?: Priority; assigneeId?: string | null; assigneeHint?: string | null; teamId?: string | null; title?: string; dueAt?: number | null }

/** Apply field changes, one issue_event per changed field. */
export function changeIssue(issueId: string, ch: IssueChange, actor: Actor, evidence: RefKey[], confidence: number | null, now = Date.now()): Frame[] {
  const cur = getIssueRow(issueId);
  if (!cur) return [];
  const events: IssueEventRow[] = [];
  const set: string[] = [];
  const vals: (string | number | null)[] = [];
  const field = (name: string, col: string, from: string | number | null, to: string | number | null, fromL: string, toL: string) => {
    if (from === to) return;
    set.push(`${col} = ?`); vals.push(to);
    events.push(addIssueEvent(cur, name === 'assignee_id' ? 'assignee' : name === 'due_at' ? 'due' : name === 'team_id' ? 'team' : name, name,
      from == null ? null : String(from), to == null ? null : String(to), fromL, toL, actor, evidence, confidence, now));
  };
  if (ch.status !== undefined) field('status', 'status', cur.status, ch.status, ISSUE_STATUS_LABEL[cur.status as IssueStatus], ISSUE_STATUS_LABEL[ch.status]);
  if (ch.priority !== undefined) field('priority', 'priority', cur.priority, ch.priority, PRIORITY_LABEL[cur.priority as Priority], PRIORITY_LABEL[ch.priority]);
  if (ch.assigneeId !== undefined) field('assignee_id', 'assignee_id', cur.assignee_id, ch.assigneeId, personName(cur.assignee_id), personName(ch.assigneeId));
  if (ch.teamId !== undefined) field('team_id', 'team_id', cur.team_id, ch.teamId, teamName(cur.team_id), teamName(ch.teamId));
  if (ch.title !== undefined && ch.title.trim()) field('title', 'title', cur.title, ch.title.trim().slice(0, 120), cur.title, ch.title.trim().slice(0, 120));
  if (ch.dueAt !== undefined) field('due_at', 'due_at', cur.due_at, ch.dueAt, fmtDue(cur.due_at), fmtDue(ch.dueAt));
  if (ch.assigneeHint !== undefined && ch.assigneeHint !== cur.assignee_hint) { set.push('assignee_hint = ?'); vals.push(ch.assigneeHint); }
  if (ch.assigneeId) { set.push('assignee_hint = NULL'); }
  if (ch.status && ch.status !== 'open') { set.push('escalated = 0'); }
  linkEvidence(issueId, evidence, now);
  if (!set.length && !evidence.length) return [];
  q.run(`UPDATE issues SET ${[...set, 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`, ...vals, now, issueId);
  if (!events.length && evidence.length) events.push(addIssueEvent(cur, 'evidence', null, null, null, null, `${evidence.length} piece${evidence.length === 1 ? '' : 's'} of evidence added`, actor, evidence, confidence, now));
  const frames = issueFrames(issueId, events);
  if (ch.assigneeId && ch.assigneeId !== cur.assignee_id && ch.assigneeId !== actor.id) {
    frames.push(dispatchNotify(getIssueRow(issueId) ?? cur, ch.assigneeId, 'assigned', now));
  }
  if (ch.status === 'blocked' && cur.status !== 'blocked') {
    frames.push(dispatchNotify(getIssueRow(issueId) ?? cur, 'hq', 'blocked', now, 'Blocked'));
  }
  return frames;
}

/**
 * The assignee passes on an issue (swipe left on the phone): unassign with a readable "Declined" entry. The dispatcher reads
 * these events (field assignee_id, from_raw = actor_id, to_raw NULL) to re-offer the issue to someone else, never the decliner.
 */
export function declineIssue(issueId: string, by: Actor, reason: string | null, now = Date.now()): Frame[] {
  const cur = getIssueRow(issueId);
  if (!cur?.assignee_id) return [];
  q.run('UPDATE issues SET assignee_id = NULL, updated_at = ?, version = version + 1 WHERE id = ?', now, issueId);
  const who = by.id === cur.assignee_id ? '' : ` for ${personName(cur.assignee_id)}`;
  const label = `Declined${who}${reason?.trim() ? ` — ${reason.trim().slice(0, 140)}` : ''}`;
  const ev = addIssueEvent(cur, 'assignee', 'assignee_id', cur.assignee_id, null, personName(cur.assignee_id), label, by, [], null, now);
  return issueFrames(issueId, [ev]);
}

/** Undo one AI/rule change (only if the field still holds the value that change set). */
export function undoIssueEvent(eventRowId: number, by: Actor, now = Date.now()): { frames: Frame[]; issueId: string } | { error: string } {
  const e = q.get<IssueEventRow>('SELECT * FROM issue_events WHERE id = ?', eventRowId);
  if (!e || !e.field) return { error: "This change can't be undone." };
  if (!undoableIds(e.issue_id).has(e.id)) return { error: 'Only the latest AI or rule change can be undone.' };
  const cur = getIssueRow(e.issue_id)!;
  const curVal = (cur as unknown as Record<string, string | number | null>)[e.field];
  if (String(curVal ?? '') !== String(e.to_raw ?? '')) return { error: "It changed again since, so it can't be undone." };
  const raw = e.from_raw;
  const val = e.field === 'due_at' ? (raw == null ? null : Number(raw)) : raw;
  q.run(`UPDATE issues SET ${e.field} = ?, updated_at = ?, version = version + 1 WHERE id = ?`, val, now, e.issue_id);
  q.run('UPDATE issue_events SET undone = 1 WHERE id = ?', e.id);
  const ev = addIssueEvent(cur, 'undo', null, null, null, e.to_label, e.from_label, by, [], null, now);
  return { frames: issueFrames(e.issue_id, [ev]), issueId: e.issue_id };
}

// ── incidents ↔ issues (camera / chat incidents appear on the tracker) ──────────────────────────────────────────────

const SEV_TO_PRIORITY: Record<string, Priority> = { critical: 'p0', high: 'p1', medium: 'p2', low: 'p3' };

const lastEvidenceEventAt = new Map<string, number>(); // issueId → last camera-evidence history row
const EVIDENCE_EVENT_GAP_MS = 60_000;

export function mirrorIncident(inc: Incident, zoneName: string, assigneeId: string | null, observationIds: string[], now: number): Frame[] {
  const existing = q.get<IssueRow>('SELECT * FROM issues WHERE incident_id = ?', inc.id);
  const evidence: RefKey[] = observationIds.map((id) => ({ type: 'observation', id }));
  if (existing) {
    if (inc.severity === 'critical' && existing.priority !== 'p0') return changeIssue(existing.id, { priority: 'p0' }, RULE_ACTOR, evidence, null, now);
    // Camera frames on an open incident arrive every few seconds: link the evidence quietly and write at most one
    // "evidence added" history row (+ issue frame) per issue per minute, so History and every screen aren't flooded.
    if (now - (lastEvidenceEventAt.get(existing.id) ?? 0) < EVIDENCE_EVENT_GAP_MS) { linkEvidence(existing.id, evidence, now); return []; }
    if (lastEvidenceEventAt.size > 5000) lastEvidenceEventAt.clear();
    lastEvidenceEventAt.set(existing.id, now);
    return changeIssue(existing.id, {}, RULE_ACTOR, evidence, null, now);
  }
  const { frames } = createIssue({
    eventId: inc.eventId, title: `${zoneName} · ${INCIDENT_LABEL[inc.incidentType]}`, kind: 'problem', priority: SEV_TO_PRIORITY[inc.severity] ?? 'p2',
    teamId: null, assigneeId, assigneeHint: null, dueAt: null, zoneId: inc.zoneId, incidentId: inc.id, actor: RULE_ACTOR, evidence, confidence: null, now,
  });
  return frames;
}

/** Incident resolved elsewhere → its issue is done. */
export function closeIssueForIncident(incidentId: string, by: Actor, now = Date.now()): Frame[] {
  const row = q.get<IssueRow>(`SELECT * FROM issues WHERE incident_id = ? AND status != 'done'`, incidentId);
  return row ? changeIssue(row.id, { status: 'done' }, by, [], null, now) : [];
}

// ── utterances ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function insertUtterance(u: Omit<UtteranceRow, 'id' | 'created_at'>): UtteranceRow {
  const id = newId('ut');
  q.run(`INSERT INTO utterances (id, event_id, team_id, device_id, participant_id, speaker, source, text, started_at, ended_at, model, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, u.event_id, u.team_id, u.device_id, u.participant_id, u.speaker, u.source, u.text, u.started_at, u.ended_at, u.model, u.latency_ms, Date.now());
  return q.get<UtteranceRow>('SELECT * FROM utterances WHERE id = ?', id)!;
}

/** Whisper-family models invent these on silence/noise; never let them become records. */
const HALLUCINATIONS = [/시청해\s*주셔서\s*감사/, /구독(과|이랑)?\s*좋아요/, /^감사합니다\.?$/, /MBC\s*뉴스/, /^자막/, /^\.+$/, /^(음|어|아)+\.?$/, /다음\s*영상에서/,
  /thank(s| you) for watching/i, /^you\.?$/i, /^bye\.?$/i, /subscribe/i, /^\[.*\]$/, /^♪/, /^(um+|uh+|hmm+)\.?$/i];
export function isNoise(text: string): boolean {
  const t = text.trim();
  return t.length < 2 || HALLUCINATIONS.some((r) => r.test(t));
}

// ── extraction scheduler: utterances → model proposals → rules ──────────────────────────────────────────────────────

type Channel = { eventId: string; key: string; pending: string[]; firstAt: number; timer: ReturnType<typeof setTimeout> | null; running: boolean };
const channels = new Map<string, Channel>();
const DEBOUNCE_MS = 4000;
const MAX_WAIT_MS = 12_000;

/** Queue an utterance for extraction. `immediate` (talk messages) runs right away. */
export function queueExtraction(eventId: string, channelKey: string, utteranceId: string, immediate = false) {
  if (!aiInfo().enabled) return;
  let ch = channels.get(channelKey);
  if (!ch) { ch = { eventId, key: channelKey, pending: [], firstAt: 0, timer: null, running: false }; channels.set(channelKey, ch); }
  if (!ch.pending.length) ch.firstAt = Date.now();
  ch.pending.push(utteranceId);
  schedule(ch, immediate ? 0 : Math.max(0, Math.min(DEBOUNCE_MS, ch.firstAt + MAX_WAIT_MS - Date.now())));
}

function schedule(ch: Channel, ms: number) {
  if (ch.timer) clearTimeout(ch.timer);
  ch.timer = setTimeout(() => { ch.timer = null; void run(ch); }, ms);
  ch.timer.unref?.();
}

async function run(ch: Channel) {
  if (ch.running) { schedule(ch, 1500); return; }
  if (!ch.pending.length) return;
  ch.running = true;
  const batch = ch.pending.splice(0);
  try {
    await extractAndApply(ch.eventId, batch);
  } catch (e) {
    log.warn('ops.extract_failed', { err: (e as Error).message });
  } finally {
    ch.running = false;
    if (ch.pending.length) schedule(ch, 500);
  }
}

const WINDOW_MS = 3 * 60_000;

async function extractAndApply(eventId: string, newIds: string[]) {
  const newRows = newIds.map((id) => q.get<UtteranceRow>('SELECT * FROM utterances WHERE id = ?', id)).filter((x): x is UtteranceRow => !!x);
  if (!newRows.length) return;
  const first = newRows[0];
  // Context window: earlier lines from the same device (meeting) for continuity; talk messages stand alone.
  const ctxRows = first.source === 'scribe'
    ? q.all<UtteranceRow>(`SELECT * FROM utterances WHERE device_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at DESC LIMIT 12`,
      first.device_id, first.started_at - WINDOW_MS, first.started_at).reverse()
    : [];
  const lines = [...ctxRows, ...newRows];
  const refOf = new Map<string, string>();
  lines.forEach((u, i) => refOf.set(`U${i + 1}`, u.id));
  const ev = getEvent(eventId);
  if (!ev) return;
  const teams = listTeams(eventId);
  const people = q.all<ParticipantRow>(`SELECT * FROM participants WHERE event_id = ? AND role IN ('staff','admin') ORDER BY created_at`, eventId);
  const open = q.all<IssueRow>(`SELECT * FROM issues WHERE event_id = ? AND (status != 'done' OR updated_at >= ?) ORDER BY updated_at DESC LIMIT 60`, eventId, Date.now() - 3600_000);
  const input: ExtractInput = {
    zones: listZoneRows(eventId).map((z) => z.name),
    nowKst: fmtHHMM(Date.now()),
    teams: teams.map((t) => t.name),
    people: people.map((p) => ({ name: p.display_name, team: p.team_id ? teams.find((t) => t.id === p.team_id)?.name ?? null : null })),
    issues: open.map((i) => ({ number: i.number, title: i.title, status: ISSUE_STATUS_LABEL[i.status as IssueStatus], assignee: i.assignee_id ? personName(i.assignee_id) : (i.assignee_hint ? `unassigned (mentioned: ${i.assignee_hint})` : 'unassigned'), team: i.team_id ? teamName(i.team_id) : null, due: i.due_at ? fmtHHMM(i.due_at) : null })),
    lines: lines.map((u, i) => ({ ref: `U${i + 1}`, speaker: u.speaker, source: u.source, isNew: newIds.includes(u.id), text: u.text, time: fmtHHMM(u.started_at) })),
    channelTeam: first.team_id ? teamName(first.team_id) : null,
    persona: first.source === 'scribe' ? agentFocus(first.device_id)?.instructions ?? null : null,
  };
  const { actions, model } = await extractActions(input);
  const frames: Frame[] = [];
  tx(() => {
    for (const a of actions) {
      const evidence: RefKey[] = a.evidence.map((r) => refOf.get(r)).filter((x): x is string => !!x && newIds.includes(x)).map((id) => ({ type: 'utterance', id }));
      if (!evidence.length) evidence.push({ type: 'utterance', id: newRows[newRows.length - 1].id });
      const speaker = q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', first.participant_id) ?? null;
      frames.push(...applyAction(eventId, a, evidence, a.confidence, speaker, first.source as UtteranceSource, first.team_id));
    }
    // utterances whose issue links changed → resend them (shows "→ WV-7" chips)
    for (const u of newRows) frames.push(['utterance', toUtterance(q.get<UtteranceRow>('SELECT * FROM utterances WHERE id = ?', u.id)!)]);
    const msgs = q.all<MessageRow>(`SELECT * FROM messages WHERE utterance_id IN (${newRows.map(() => '?').join(',')})`, ...newRows.map((u) => u.id));
    for (const m of msgs) frames.push(['message', toMessage(m)]);
    // AI crew: the meeting secretary bound to this scribe notes what it captured.
    if (first.source === 'scribe' && actions.length) {
      frames.push(...secretaryNote(first.device_id, {
        tasks: actions.filter((a) => a.type === 'create').length, decisions: actions.filter((a) => a.type === 'decision').length,
        updates: actions.filter((a) => a.type === 'update').length,
      }));
    }
  });
  publishAll(eventId, frames);
  log.info('ops.extracted', { lines: newRows.length, actions: actions.length, model });
}

export interface ModelAction extends ProposedAction { evidence: string[]; confidence: number }

/** Deterministic zone match for a zone name the model gave ("Entrance", "the entrance area"). */
export function resolveZone(eventId: string, name: string | null | undefined): { id: string; name: string } | null {
  if (!name) return null;
  const n = norm(name);
  if (!n) return null;
  const zones = listZoneRows(eventId);
  const z = zones.find((x) => norm(x.name) === n) ?? zones.find((x) => { const zn = norm(x.name); return zn.length >= 3 && (n.includes(zn) || zn.includes(n)); });
  return z ? { id: z.id, name: z.name } : null;
}

/** The latest camera observation of a zone (≤ 3 min): attached as corroborating evidence when speech opens an issue there. */
function corroboratingFrame(zoneId: string, now: number): RefKey | null {
  const o = q.get<{ id: string }>(`SELECT id FROM observations WHERE zone_id = ? AND modality = 'vision' AND observed_at >= ? ORDER BY observed_at DESC LIMIT 1`, zoneId, now - 180_000);
  return o ? { type: 'observation', id: o.id } : null;
}

/** Rules: validate + resolve names, then auto-apply or file a proposal. Inside tx. */
export function applyAction(eventId: string, a: ModelAction, evidence: RefKey[], confidence: number, speaker: ParticipantRow | null,
  source: UtteranceSource, channelTeamId: string | null, now = Date.now()): Frame[] {
  const person = resolvePerson(eventId, a.assignee);
  const team = resolveTeam(eventId, a.team);
  const due = parseDue(a.due, now);
  const auto = confidence >= AUTO_APPLY_CONFIDENCE;

  if (a.type === 'create' || a.type === 'decision') {
    const title = (a.title ?? '').trim();
    if (title.length < 2) return [];
    const kind: IssueKind = a.type === 'decision' ? 'decision' : (a.kind ?? 'task');
    // Dedupe: a near-identical open issue absorbs this as evidence instead of a duplicate.
    const dupe = q.all<IssueRow>(`SELECT * FROM issues WHERE event_id = ? AND status != 'done' AND kind = ? ORDER BY updated_at DESC LIMIT 80`, eventId, kind)
      .find((i) => similar(i.title, title) >= 0.6);
    if (dupe) return changeIssue(dupe.id, {}, AI_ACTOR, evidence, confidence, now);
    if (!auto) return [fileProposal(eventId, a, evidence, confidence, null, `New ${ISSUE_KIND_LABEL[kind].toLowerCase()}: ${title}${a.assignee ? ` · ${a.assignee}` : ''}`, now)];
    const zone = resolveZone(eventId, a.zone);
    const cam = zone ? corroboratingFrame(zone.id, now) : null;
    return createIssue({
      eventId, title, kind, priority: a.priority ?? 'p2', teamId: team?.id ?? (person?.team_id ?? channelTeamId ?? null),
      assigneeId: person?.id ?? null, assigneeHint: person ? null : (a.assignee ?? null), dueAt: due, zoneId: zone?.id ?? null,
      actor: AI_ACTOR, evidence: cam ? [...evidence, cam] : evidence, confidence, now,
    }).frames;
  }

  // update
  if (a.issueNumber == null) return [];
  const target = q.get<IssueRow>('SELECT * FROM issues WHERE event_id = ? AND number = ?', eventId, a.issueNumber);
  if (!target) return [];
  const ch: IssueChange = {};
  if (a.status && a.status !== target.status) ch.status = a.status;
  if (a.priority && a.priority !== target.priority) ch.priority = a.priority;
  if (a.assignee) { if (person && person.id !== target.assignee_id) ch.assigneeId = person.id; else if (!person) ch.assigneeHint = a.assignee; }
  if (team && team.id !== target.team_id) ch.teamId = team.id;
  if (due != null && due !== target.due_at) ch.dueAt = due;
  if (a.title && a.title.trim() && similar(a.title, target.title) < 0.5 && !Object.keys(ch).length) { /* a re-title alone is not worth an auto change */ }
  // "done" needs more certainty — unless the assignee themself said it (talk).
  const speakerIsAssignee = !!speaker && speaker.id === target.assignee_id;
  const doneBar = speakerIsAssignee && source === 'talk' ? AUTO_APPLY_CONFIDENCE : AUTO_DONE_CONFIDENCE;
  const risky = ch.status === 'done' ? confidence < doneBar : !auto;
  if (!Object.keys(ch).length) return confidence >= 0.5 ? changeIssue(target.id, {}, AI_ACTOR, evidence, confidence, now) : [];
  if (risky) {
    const parts = [
      ch.status ? `→ ${ISSUE_STATUS_LABEL[ch.status]}` : null, ch.assigneeId ? `assign → ${personName(ch.assigneeId)}` : null,
      ch.priority ? `priority → ${PRIORITY_LABEL[ch.priority]}` : null, ch.dueAt ? `due → ${fmtDue(ch.dueAt)}` : null, ch.teamId ? `team → ${teamName(ch.teamId)}` : null,
    ].filter(Boolean);
    return [fileProposal(eventId, a, evidence, confidence, target.id, `${KEY(target.number)} ${parts.join(' · ') || 'update'}`, now)];
  }
  return changeIssue(target.id, ch, AI_ACTOR, evidence, confidence, now);
}

function fileProposal(eventId: string, a: ModelAction, evidence: RefKey[], confidence: number, issueId: string | null, summary: string, now: number): Frame {
  const id = newId('pr');
  const action: ProposedAction = { type: a.type, issueNumber: a.issueNumber, title: a.title, kind: a.kind, priority: a.priority, team: a.team, zone: a.zone ?? null, assignee: a.assignee, due: a.due, status: a.status, note: a.note };
  q.run(`INSERT INTO proposals (id, event_id, status, action_json, summary, confidence, evidence_json, issue_id, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    id, eventId, JSON.stringify(action), summary.slice(0, 200), confidence, JSON.stringify(evidence), issueId, now);
  return ['proposal', toProposal(q.get<ProposalRow>('SELECT * FROM proposals WHERE id = ?', id)!)];
}

/** Human decision on a proposal. Accept applies it exactly like an auto action (with full confidence) attributed to the human. */
export function decideProposal(proposalId: string, decision: 'accept' | 'reject', by: ParticipantRow, now = Date.now()): { frames: Frame[]; issueId: string | null } | { error: string } {
  const p = q.get<ProposalRow>('SELECT * FROM proposals WHERE id = ?', proposalId);
  if (!p) return { error: 'Suggestion not found.' };
  if (p.status !== 'pending') return { error: 'This suggestion was already handled.' };
  const frames: Frame[] = [];
  let issueId = p.issue_id;
  if (decision === 'accept') {
    const a = { ...(JSON.parse(p.action_json) as ProposedAction), evidence: [], confidence: 1 } as ModelAction;
    const evidence = JSON.parse(p.evidence_json) as RefKey[];
    const before = q.get<{ n: number }>('SELECT COALESCE(MAX(number), 0) AS n FROM issues WHERE event_id = ?', p.event_id)!.n;
    const actor: Actor = { kind: 'human', id: by.id, name: by.display_name };
    const out = applyActionAs(p.event_id, a, evidence, actor, now);
    frames.push(...out);
    const created = q.get<{ id: string }>('SELECT id FROM issues WHERE event_id = ? AND number > ? ORDER BY number LIMIT 1', p.event_id, before);
    if (created) issueId = created.id;
  }
  q.run('UPDATE proposals SET status = ?, decided_at = ?, decided_by = ?, issue_id = ? WHERE id = ?', decision === 'accept' ? 'accepted' : 'rejected', now, by.display_name, issueId, p.id);
  frames.push(['proposal', toProposal(q.get<ProposalRow>('SELECT * FROM proposals WHERE id = ?', p.id)!)]);
  return { frames, issueId };
}

/** Same resolution as applyAction but always applies, attributed to `actor` (used for accepted proposals). */
function applyActionAs(eventId: string, a: ModelAction, evidence: RefKey[], actor: Actor, now: number): Frame[] {
  const person = resolvePerson(eventId, a.assignee);
  const team = resolveTeam(eventId, a.team);
  const due = parseDue(a.due, now);
  if (a.type === 'create' || a.type === 'decision') {
    const title = (a.title ?? '').trim();
    if (title.length < 2) return [];
    const zone = resolveZone(eventId, a.zone);
    const cam = zone ? corroboratingFrame(zone.id, now) : null;
    return createIssue({
      eventId, title, kind: a.type === 'decision' ? 'decision' : (a.kind ?? 'task'), priority: a.priority ?? 'p2', teamId: team?.id ?? person?.team_id ?? null,
      assigneeId: person?.id ?? null, assigneeHint: person ? null : a.assignee, dueAt: due, zoneId: zone?.id ?? null,
      actor, evidence: cam ? [...evidence, cam] : evidence, confidence: null, now,
    }).frames;
  }
  const target = a.issueNumber != null ? q.get<IssueRow>('SELECT * FROM issues WHERE event_id = ? AND number = ?', eventId, a.issueNumber) : undefined;
  if (!target) return [];
  const ch: IssueChange = {};
  if (a.status) ch.status = a.status;
  if (a.priority) ch.priority = a.priority;
  if (person) ch.assigneeId = person.id; else if (a.assignee) ch.assigneeHint = a.assignee;
  if (team) ch.teamId = team.id;
  if (due != null) ch.dueAt = due;
  return changeIssue(target.id, ch, actor, evidence, null, now);
}

// ── escalation sweeper ──────────────────────────────────────────────────────────────────────────────────────────────

export function startEscalation() {
  const t = setInterval(() => {
    try {
      const now = Date.now();
      const rows = q.all<IssueRow>(`SELECT * FROM issues WHERE priority = 'p0' AND status = 'open' AND escalated = 0 AND created_at <= ?`, now - ESCALATE_AFTER_MS);
      for (const r of rows) {
        const frames: Frame[] = tx(() => {
          q.run('UPDATE issues SET escalated = 1, updated_at = ?, version = version + 1 WHERE id = ?', now, r.id);
          const ev = addIssueEvent(r, 'escalated', null, null, null, null, 'Escalated to HQ: nobody picked this up for 2 minutes', RULE_ACTOR, [], null, now);
          return [...issueFrames(r.id, [ev]), dispatchNotify(r, 'hq', 'escalation', now, 'Urgent issue unattended')];
        });
        publishAll(r.event_id, frames);
      }
    } catch (e) {
      log.warn('ops.escalation_failed', { err: (e as Error).message });
    }
  }, 15_000);
  t.unref?.();
}

export function opsTimeline(issueId: string): { issue: Issue; events: IssueEvent[] } {
  const und = undoableIds(issueId);
  return {
    issue: toIssue(getIssueRow(issueId)!),
    events: q.all<IssueEventRow>('SELECT * FROM issue_events WHERE issue_id = ? ORDER BY id DESC', issueId).map((r) => toIssueEvent(r, und)),
  };
}

export const isOnline = (lastSeenAt: number) => Date.now() - lastSeenAt < DEVICE_OFFLINE_MS;
export const publishNotify = (eventId: string, n: Omit<Notify, 'id'>) => publish(eventChannel(eventId), 'notify', { id: newId('nt'), ...n });
export { KEY as issueKey };
