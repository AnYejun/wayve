// Ops tracker routes (contract: shared/contracts.ts "Ops REST API"). Mounted inside apiRouter() before its 404/error handlers.
import express from 'express';
import { z } from 'zod';
import {
  CROWD_LABEL, ISSUE_KINDS, ISSUE_STATUS_LABEL, ISSUE_STATUSES, PRIORITIES, PRIORITY_LABEL, ZONE_STATUS_LABEL,
  type AskResult, type Citation, type IssueStatus,
} from '../shared/contracts.ts';
import { AiError, aiInfo, askOps, transcribe } from './ai.ts';
import { q, tx } from './db.ts';
import {
  type Actor, changeIssue, declineIssue, fmtDue, opsTimeline, createIssue, decideProposal, getIssueRow, insertUtterance, isNoise, issueKey, listTeams,
  queueExtraction, toIssue, toMessage, toTeam, toUtterance, undoIssueEvent, type IssueRow, type UtteranceRow,
} from './ops.ts';
import { resolveIncident } from './rules.ts';
import { nudgeDispatch } from './crew.ts';
import { emitPulse } from './pulse.ts';
import {
  HttpErr, aiErrToHttp, bad, forbidden, h, markDeviceError, notFound, parse, participantFor, rateLimit, requireDevice, requireRole,
  sessionParticipants,
} from './routes.ts';
import {
  getEvent, listZoneRows, newId, primaryDevice, publishAll, toMe, toParticipant, type Frame, type ParticipantRow,
} from './world.ts';
import type { Request } from 'express';
import { deleteMedia, saveMedia } from './media.ts';
import { RADIO_AUDIO_TTL_MS } from '../shared/contracts.ts';
import { log } from './log.ts';
import { getKnowledge } from './world.ts';

const json = express.json({ limit: '64kb' });
const audioType = (req: import('node:http').IncomingMessage) => /^audio\//.test(String(req.headers['content-type'] ?? '')) || /^video\/(mp4|webm)/.test(String(req.headers['content-type'] ?? ''));
const scribeBody = express.raw({ type: audioType, limit: '4mb' });
const talkBody = express.raw({ type: audioType, limit: '8mb' });

const actorOf = (p: ParticipantRow): Actor => ({ kind: 'human', id: p.id, name: p.display_name });

/** Staff+ participant for this request: explicit eventId, else the newest non-camera session. */
function staffFor(req: Request, eventId?: string | null): ParticipantRow {
  const p = eventId ? participantFor(req, eventId) : sessionParticipants(req).find((x) => x.role === 'staff' || x.role === 'admin') ?? null;
  if (!p) throw new HttpErr(401, 'NO_SESSION', 'Sign in and join as staff first.');
  return requireRole(req, p.event_id, 'staff');
}

function vocabulary(eventId: string): string[] {
  const people = q.all<{ display_name: string }>(`SELECT display_name FROM participants WHERE event_id = ? AND role IN ('staff','admin')`, eventId).map((p) => p.display_name);
  return [...new Set([...listTeams(eventId).map((t) => t.name), ...people, ...listZoneRows(eventId).map((z) => z.name)])].filter((x) => x && !/^(Staff|Camera|Scribe|Organizer|Attendee) ?\d*$/i.test(x)).slice(0, 40);
}

type Target = { type: 'hq' | 'team' | 'person' | 'all'; id: string | null; label: string; expected: string[] };
function resolveTarget(eventId: string, to: string, sender: ParticipantRow): Target {
  const staff = q.all<ParticipantRow>(`SELECT * FROM participants WHERE event_id = ? AND role IN ('staff','admin')`, eventId).filter((p) => p.id !== sender.id);
  if (to === 'all') return { type: 'all', id: null, label: 'Everyone', expected: staff.map((p) => p.id) };
  if (to === 'hq') {
    const hqTeams = listTeams(eventId).filter((t) => /본부|hq|운영|headquarter|control/i.test(t.name)).map((t) => t.id);
    return { type: 'hq', id: null, label: 'HQ', expected: staff.filter((p) => p.role === 'admin' || (p.team_id && hqTeams.includes(p.team_id))).map((p) => p.id) };
  }
  const [kind, id] = to.split(':');
  if (kind === 'team' && id) {
    const team = listTeams(eventId).find((t) => t.id === id);
    if (!team) throw bad('NO_TARGET', 'Team not found.');
    return { type: 'team', id, label: `${team.name} team`, expected: staff.filter((p) => p.team_id === id).map((p) => p.id) };
  }
  if (kind === 'person' && id) {
    const p = staff.find((x) => x.id === id);
    if (!p) throw bad('NO_TARGET', 'Recipient not found.');
    return { type: 'person', id, label: p.display_name, expected: [p.id] };
  }
  throw bad('NO_TARGET', 'Pick who to send this to.');
}

function sendTalk(sender: ParticipantRow, target: Target, text: string, startedAt: number, model: string | null, latencyMs: number | null,
  audio: { path: string; durationMs: number | null } | null = null) {
  const now = Date.now();
  const dev = primaryDevice(sender.id);
  const out = tx(() => {
    const u = insertUtterance({
      event_id: sender.event_id, team_id: sender.team_id ?? null, device_id: dev?.id ?? sender.id, participant_id: sender.id, speaker: sender.display_name,
      source: 'talk', text: text.slice(0, 2000), started_at: startedAt, ended_at: now, model, latency_ms: latencyMs,
    });
    const id = newId('ms');
    q.run(`INSERT INTO messages (id, event_id, from_id, to_type, to_id, to_label, text, utterance_id, expected_json, created_at, audio_path, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, sender.event_id, sender.id, target.type, target.id, target.label, u.text, u.id, JSON.stringify(target.expected), now, audio?.path ?? null, audio?.durationMs ?? null);
    const m = toMessage(q.get('SELECT * FROM messages WHERE id = ?', id)!);
    const frames: Frame[] = [['utterance', toUtterance(u)], ['message', m]];
    for (const pid of target.expected) {
      frames.push(['notify', { id: newId('nt'), participantId: pid, title: `Radio · ${sender.display_name} → ${target.label}`, body: u.text.slice(0, 140), issueId: null, messageId: id, at: now }]);
    }
    if (target.type === 'hq') frames.push(['notify', { id: newId('nt'), participantId: 'hq', title: `Radio · ${sender.display_name} → HQ`, body: u.text.slice(0, 140), issueId: null, messageId: id, at: now }]);
    return { u, m, frames };
  });
  publishAll(sender.event_id, out.frames);
  // A talk message can create or close issues ("the badges are printed") — extract right away.
  queueExtraction(sender.event_id, `talk:${sender.id}`, out.u.id, true);
  return { message: out.m, utterance: toUtterance(out.u) };
}

/** Read-only text view of the live DB for the ask endpoint. Lines get refs U1.. for citations. */
function askContext(eventId: string, question: string, teamId: string | null) {
  const now = Date.now();
  const teams = listTeams(eventId);
  const tname = (id: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? '' : '');
  const pname = (id: string | null) => (id ? q.get<{ display_name: string }>('SELECT display_name FROM participants WHERE id = ?', id)?.display_name ?? '' : '');
  const hhmm = (t: number) => fmtDue(t);
  const issues = q.all<IssueRow>(`SELECT * FROM issues WHERE event_id = ? AND (status != 'done' OR updated_at >= ?) ORDER BY updated_at DESC LIMIT 80`, eventId, now - 2 * 3600_000)
    .filter((i) => !teamId || i.team_id === teamId || !i.team_id);
  const tokens = [...new Set(question.replace(/[?.!,]/g, ' ').split(/\s+/).filter((w) => w.length >= 2))];
  const recent = q.all<UtteranceRow>('SELECT * FROM utterances WHERE event_id = ? AND started_at >= ? ORDER BY started_at DESC LIMIT 300', eventId, now - 40 * 60_000);
  const relevant = recent.filter((u) => tokens.some((t) => u.text.includes(t) || u.speaker.includes(t)));
  const picked = [...new Map([...relevant.slice(0, 30), ...recent.slice(0, 40)].map((u) => [u.id, u])).values()].sort((a, b) => a.started_at - b.started_at).slice(-60);
  const refs = new Map<string, UtteranceRow>();
  picked.forEach((u, i) => refs.set(`U${i + 1}`, u));
  const unacked = q.all<{ id: string; text: string; to_label: string; from_id: string; created_at: number; expected_json: string }>(
    'SELECT * FROM messages WHERE event_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 30', eventId, now - 60 * 60_000)
    .filter((m) => { const exp = JSON.parse(m.expected_json) as string[]; const acked = q.all<{ participant_id: string }>('SELECT participant_id FROM message_acks WHERE message_id = ?', m.id).map((a) => a.participant_id); return exp.some((e) => !acked.includes(e)); });
  const zones = listZoneRows(eventId).filter((z) => z.last_observed_at);
  const text = [
    `Now: ${hhmm(now)} · Event: ${getEvent(eventId)?.name ?? ''}`,
    `Teams: ${teams.map((t) => t.name).join(', ')}`,
    'Issues:',
    ...(issues.length ? issues.map((i) => `- WV-${i.number} [${ISSUE_STATUS_LABEL[i.status as IssueStatus]}·${PRIORITY_LABEL[i.priority as 'p2']}] ${i.title} · owner ${pname(i.assignee_id) || (i.assignee_hint ? `unassigned (mentioned: ${i.assignee_hint})` : 'unassigned')}${i.team_id ? ` · ${tname(i.team_id)} team` : ''}${i.due_at ? ` · due ${hhmm(i.due_at)}` : ''} · updated ${hhmm(i.updated_at)}${i.escalated ? ' · escalated to HQ' : ''}`) : ['- none']),
    'Recent speech (meeting transcripts and radio):',
    ...(picked.length ? [...refs].map(([r, u]) => `${r} [${hhmm(u.started_at)}] ${u.speaker}${u.team_id ? ` (${tname(u.team_id)})` : ''}: ${u.text}`) : ['- none']),
    'Unacknowledged radio:',
    ...(unacked.length ? unacked.map((m) => `- ${hhmm(m.created_at)} ${pname(m.from_id)} → ${m.to_label}: ${m.text}`) : ['- none']),
    ...(getKnowledge(eventId) ? ['Organizer notes (run of show, FAQ, contacts):', getKnowledge(eventId).slice(0, 9000)] : []),
    ...(zones.length ? ['Zones:', ...zones.map((z) => `- ${z.name}: ${ZONE_STATUS_LABEL[z.current_status as 'clear']}${z.crowd_level ? ` (${CROWD_LABEL[z.crowd_level as 'low']})` : ''}`)] : []),
  ].join('\n');
  return { text, refs, issues };
}

export function opsRouter() {
  const r = express.Router();

  // teams (admin)
  r.post('/events/:eventId/teams', json, h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound();
    requireRole(req, ev.id, 'admin');
    const b = parse(z.object({ name: z.string().trim().min(1).max(20) }), req.body);
    const id = newId('tm');
    const sort = q.get<{ m: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS m FROM teams WHERE event_id = ?', ev.id)?.m ?? 0;
    q.run('INSERT INTO teams (id, event_id, name, sort) VALUES (?, ?, ?, ?)', id, ev.id, b.name, sort);
    const team = toTeam(q.get('SELECT * FROM teams WHERE id = ?', id)!);
    publishAll(ev.id, [['team', team]]);
    res.json({ team });
  }));
  r.patch('/teams/:teamId', json, h((req, res) => {
    const t = q.get<{ id: string; event_id: string }>('SELECT * FROM teams WHERE id = ? AND deleted_at IS NULL', String(req.params.teamId));
    if (!t) throw notFound('Team not found.');
    requireRole(req, t.event_id, 'admin');
    const b = parse(z.object({ name: z.string().trim().min(1).max(20) }), req.body);
    q.run('UPDATE teams SET name = ? WHERE id = ?', b.name, t.id);
    const team = toTeam(q.get('SELECT * FROM teams WHERE id = ?', t.id)!);
    publishAll(t.event_id, [['team', team]]);
    res.json({ team });
  }));
  r.delete('/teams/:teamId', h((req, res) => {
    const t = q.get<{ id: string; event_id: string }>('SELECT * FROM teams WHERE id = ? AND deleted_at IS NULL', String(req.params.teamId));
    if (!t) throw notFound('Team not found.');
    requireRole(req, t.event_id, 'admin');
    q.run('UPDATE teams SET deleted_at = ? WHERE id = ?', Date.now(), t.id);
    q.run('UPDATE participants SET team_id = NULL WHERE team_id = ?', t.id);
    publishAll(t.event_id, [['team_removed', { id: t.id }]]);
    res.json({ ok: true });
  }));

  // me
  r.patch('/me', json, h((req, res) => {
    const b = parse(z.object({ eventId: z.string(), displayName: z.string().trim().min(1).max(20).optional(), teamId: z.string().nullish() }), req.body);
    const p = participantFor(req, b.eventId);
    if (!p) throw new HttpErr(401, 'NO_SESSION', "You're not connected to this event.");
    if (b.teamId && !listTeams(p.event_id).some((t) => t.id === b.teamId)) throw bad('NO_TEAM', 'Team not found.');
    q.run('UPDATE participants SET display_name = COALESCE(?, display_name), team_id = CASE WHEN ? THEN ? ELSE team_id END WHERE id = ?',
      b.displayName ?? null, b.teamId !== undefined ? 1 : 0, b.teamId ?? null, p.id);
    const row = q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', p.id)!;
    publishAll(p.event_id, [['participant', toParticipant(row)]]);
    res.json({ me: toMe(row), participant: toParticipant(row) });
  }));

  // scribe audio → utterance → extraction
  r.post('/devices/:deviceId/audio', scribeBody, h(async (req, res) => {
    const { device, participant } = requireDevice(req, String(req.params.deviceId));
    if (device.device_type !== 'scribe') throw forbidden('Only scribe devices can send meeting audio.');
    if (!Buffer.isBuffer(req.body) || req.body.length < 2000) throw bad('NO_AUDIO', 'The recording is empty.');
    if (!aiInfo().enabled) throw aiErrToHttp(new AiError('AI_DISABLED', ''));
    const qn = (k: string) => { const v = Number(req.query[k]); return Number.isFinite(v) && v > 0 ? v : null; };
    const endedAt = Math.min(qn('endedAt') ?? Date.now(), Date.now());
    const startedAt = Math.min(qn('startedAt') ?? endedAt, endedAt);
    // Live pulse: a speech chunk arrived (level ≈ how much was said; 16 kHz mono WAV ≈ 32 KB/s).
    emitPulse(device.event_id, device.id, 'speech', 0.35 + 0.65 * Math.min(1, Math.max((endedAt - startedAt) / 1000, req.body.length / 32000) / 12));
    q.run(`UPDATE devices SET last_seen_at = ?, status = 'observing' WHERE id = ?`, Date.now(), device.id);
    let tr;
    try {
      tr = await transcribe(req.body, String(req.headers['content-type'] ?? 'audio/wav'), vocabulary(device.event_id));
    } catch (e) {
      markDeviceError(device, 'Transcription failed');
      throw aiErrToHttp(e);
    }
    // Audio is dropped here; only text is stored.
    if (isNoise(tr.text)) return res.json({ utterance: null });
    const u = tx(() => insertUtterance({
      event_id: device.event_id, team_id: participant.team_id ?? null, device_id: device.id, participant_id: participant.id, speaker: device.label,
      source: 'scribe', text: tr.text.slice(0, 2000), started_at: startedAt, ended_at: endedAt, model: tr.model, latency_ms: tr.latencyMs,
    }));
    q.run('UPDATE devices SET last_error = NULL WHERE id = ?', device.id);
    const wire = toUtterance(u);
    publishAll(device.event_id, [['utterance', wire]]);
    queueExtraction(device.event_id, device.id, u.id);
    res.json({ utterance: wire });
  }));

  // talk (push-to-talk) — replaces phone calls
  r.post('/talk', talkBody, h(async (req, res) => {
    const p = staffFor(req, typeof req.query.eventId === 'string' ? req.query.eventId : null);
    if (!Buffer.isBuffer(req.body) || req.body.length < 800) throw bad('NO_AUDIO', 'That recording is too short.');
    rateLimit(`talk:${p.id}`, 1000);
    const target = resolveTarget(p.event_id, String(req.query.to ?? ''), p);
    const startedAt = Date.now();
    let tr;
    try { tr = await transcribe(req.body, String(req.headers['content-type'] ?? 'audio/webm'), vocabulary(p.event_id)); } catch (e) { throw aiErrToHttp(e); }
    if (isNoise(tr.text)) throw bad('EMPTY_TRANSCRIPT', "Couldn't make out any speech. Try again.");
    // Walkie-talkie: keep the clip briefly so recipients can hear it (deleted after RADIO_AUDIO_TTL_MS).
    let clip: { path: string; durationMs: number | null } | null = null;
    try {
      const d = Number(req.query.durationMs);
      clip = { path: saveMedia('radio', req.body, String(req.headers['content-type'] ?? 'audio/webm')), durationMs: Number.isFinite(d) ? Math.max(0, Math.min(60_000, Math.round(d))) : null };
    } catch (e) { log.warn('talk.clip_not_saved', { err: (e as Error).message }); }
    res.json(sendTalk(p, target, tr.text, startedAt, tr.model, tr.latencyMs, clip));
  }));
  r.post('/talk/text', json, h((req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(1).max(1000), to: z.string(), eventId: z.string().nullish() }), req.body);
    const p = staffFor(req, b.eventId);
    rateLimit(`talk:${p.id}`, 800);
    res.json(sendTalk(p, resolveTarget(p.event_id, b.to, p), b.text, Date.now(), null, null));
  }));
  r.post('/messages/:id/ack', json, h((req, res) => {
    const m = q.get<{ id: string; event_id: string }>('SELECT * FROM messages WHERE id = ?', String(req.params.id));
    if (!m) throw notFound('Radio message not found.');
    const p = requireRole(req, m.event_id, 'staff');
    q.run('INSERT OR IGNORE INTO message_acks (message_id, participant_id, at) VALUES (?, ?, ?)', m.id, p.id, Date.now());
    const message = toMessage(q.get('SELECT * FROM messages WHERE id = ?', m.id)!);
    publishAll(m.event_id, [['message', message]]);
    res.json({ message });
  }));

  // issues
  r.post('/events/:eventId/issues', json, h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound();
    const p = requireRole(req, ev.id, 'staff');
    const b = parse(z.object({
      title: z.string().trim().min(1).max(120), kind: z.enum(ISSUE_KINDS).optional(), priority: z.enum(PRIORITIES).optional(),
      teamId: z.string().nullish(), assigneeId: z.string().nullish(), dueAt: z.number().nullish(),
    }), req.body);
    const out = tx(() => createIssue({
      eventId: ev.id, title: b.title, kind: b.kind ?? 'task', priority: b.priority ?? 'p2', teamId: b.teamId ?? p.team_id ?? null,
      assigneeId: b.assigneeId ?? null, assigneeHint: null, dueAt: b.dueAt ?? null, actor: actorOf(p), evidence: [], confidence: null,
    }));
    publishAll(ev.id, out.frames);
    res.json({ issue: toIssue(getIssueRow(out.issue.id)!) });
  }));

  r.patch('/issues/:issueId', json, h((req, res) => {
    const cur = getIssueRow(String(req.params.issueId));
    if (!cur) throw notFound('Issue not found.');
    const p = requireRole(req, cur.event_id, 'staff');
    const b = parse(z.object({
      status: z.enum(ISSUE_STATUSES).optional(), priority: z.enum(PRIORITIES).optional(), assigneeId: z.string().nullish(),
      teamId: z.string().nullish(), title: z.string().trim().min(1).max(120).optional(), dueAt: z.number().nullish(),
    }), req.body);
    if (b.assigneeId && !q.get(`SELECT 1 FROM participants WHERE id = ? AND event_id = ? AND role IN ('staff','admin')`, b.assigneeId, cur.event_id)) throw bad('NO_ASSIGNEE', 'Assignee not found.');
    if (b.teamId && !listTeams(cur.event_id).some((t) => t.id === b.teamId)) throw bad('NO_TEAM', 'Team not found.');
    const frames = tx(() => {
      const f = changeIssue(cur.id, {
        status: b.status, priority: b.priority, assigneeId: b.assigneeId === undefined ? undefined : b.assigneeId ?? null,
        teamId: b.teamId === undefined ? undefined : b.teamId ?? null, title: b.title, dueAt: b.dueAt === undefined ? undefined : b.dueAt ?? null,
      }, actorOf(p), [], null);
      // A tracker issue that mirrors a camera/chat incident resolves it too.
      if (b.status === 'done' && cur.incident_id) f.push(...resolveIncident(cur.incident_id, p));
      return f;
    });
    publishAll(cur.event_id, frames);
    res.json({ issue: toIssue(getIssueRow(cur.id)!) });
  }));

  // Swipe left on an assignment: only the current assignee (or an admin) can pass. The dispatcher re-offers it to someone
  // else within a few seconds and never back to whoever declined.
  r.post('/issues/:issueId/decline', json, h((req, res) => {
    const cur = getIssueRow(String(req.params.issueId));
    if (!cur) throw notFound('Issue not found.');
    const p = requireRole(req, cur.event_id, 'staff');
    const b = parse(z.object({ reason: z.string().trim().max(200).nullish() }), req.body ?? {});
    if (!cur.assignee_id) throw bad('NOT_ASSIGNED', 'This issue has no owner to decline.');
    if (cur.assignee_id !== p.id && p.role !== 'admin') throw forbidden('Only the person it is assigned to can decline it.');
    const frames = tx(() => declineIssue(cur.id, actorOf(p), b.reason ?? null));
    publishAll(cur.event_id, frames);
    nudgeDispatch();
    res.json({ issue: toIssue(getIssueRow(cur.id)!) });
  }));

  r.get('/issues/:issueId/timeline', h((req, res) => {
    const cur = getIssueRow(String(req.params.issueId));
    if (!cur) throw notFound('Issue not found.');
    requireRole(req, cur.event_id, 'staff');
    res.json(opsTimeline(cur.id));
  }));

  r.post('/issue-events/:id/undo', json, h((req, res) => {
    const e = q.get<{ id: number; event_id: string; issue_id: string }>('SELECT id, event_id, issue_id FROM issue_events WHERE id = ?', Number(req.params.id));
    if (!e) throw notFound('History entry not found.');
    const p = requireRole(req, e.event_id, 'staff');
    const out = tx(() => undoIssueEvent(e.id, actorOf(p)));
    if ('error' in out) throw new HttpErr(409, 'CANNOT_UNDO', out.error);
    publishAll(e.event_id, out.frames);
    res.json({ issue: toIssue(getIssueRow(out.issueId)!) });
  }));

  r.post('/proposals/:id', json, h((req, res) => {
    const pr = q.get<{ id: string; event_id: string }>('SELECT id, event_id FROM proposals WHERE id = ?', String(req.params.id));
    if (!pr) throw notFound('Suggestion not found.');
    const p = requireRole(req, pr.event_id, 'staff');
    const b = parse(z.object({ decision: z.enum(['accept', 'reject']) }), req.body);
    const out = tx(() => decideProposal(pr.id, b.decision, p));
    if ('error' in out) throw new HttpErr(409, 'ALREADY_DECIDED', out.error);
    publishAll(pr.event_id, out.frames);
    const proposal = out.frames.findLast((f) => f[0] === 'proposal')![1];
    res.json({ proposal, issue: out.issueId ? toIssue(getIssueRow(out.issueId)!) : null });
  }));

  // ask the live DB
  r.post('/ask', json, h(async (req, res) => {
    const b = parse(z.object({ question: z.string().trim().min(1).max(500), eventId: z.string().nullish(), teamId: z.string().nullish() }), req.body);
    const p = staffFor(req, b.eventId);
    rateLimit(`ask:${p.id}`, 1500);
    const ctx = askContext(p.event_id, b.question, b.teamId ?? null);
    let out;
    try { out = await askOps(b.question, ctx.text); } catch (e) { throw aiErrToHttp(e); }
    const citations: Citation[] = [];
    for (const n of out.issues) {
      const i = q.get<IssueRow>('SELECT * FROM issues WHERE event_id = ? AND number = ?', p.event_id, n);
      if (i) citations.push({ type: 'issue', id: i.id, label: issueKey(i.number), text: i.title, at: null });
    }
    for (const ref of out.lines) {
      const u = ctx.refs.get(ref);
      if (u) {
        citations.push({ type: 'utterance', id: u.id, label: u.speaker, text: u.text, at: u.started_at });
      }
    }
    const body: AskResult = { answer: out.answer, model: out.model, citations };
    res.json(body);
  }));

  return r;
}


/** Walkie-talkie clips are short-lived: delete files older than RADIO_AUDIO_TTL_MS (every 10 min). */
export function startRadioSweeper() {
  const t = setInterval(() => {
    try {
      const old = q.all<{ id: string; audio_path: string }>('SELECT id, audio_path FROM messages WHERE audio_path IS NOT NULL AND created_at < ?', Date.now() - RADIO_AUDIO_TTL_MS);
      for (const m of old) { deleteMedia(m.audio_path); q.run('UPDATE messages SET audio_path = NULL WHERE id = ?', m.id); }
      if (old.length) log.info('radio.clips_expired', { n: old.length });
    } catch (e) { log.warn('radio.sweep_failed', { err: (e as Error).message }); }
  }, 10 * 60_000);
  t.unref?.();
}
