// AI crew: personas that watch (cameras), listen (scribes), dispatch and verify — and talk on the radio as themselves.
// Deterministic triggers only; anything a model would decide goes through ops rules (auto above the bar, else a proposal).
import { createHash, randomBytes } from 'node:crypto';
import {
  AGENT_ROLE_DEFS, CROWD_LABEL, DEVICE_OFFLINE_MS, INCIDENT_LABEL, type CrowdLevel,
  type AgentPost, type AgentRole, type CrewAgent, type CrewState, type CrewStatus, type IncidentType, type ZoneTrack,
} from '../shared/contracts.ts';
import { q, tx } from './db.ts';
import { log } from './log.ts';
import { applyAction, changeIssue, getIssueRow, insertUtterance, issueKey, listTeams, toMessage, toUtterance, type Actor, type IssueRow } from './ops.ts';
import { resolveIncident } from './rules.ts';
import { parseState } from './zoneTrack.ts';
import { getDeviceRow, getZoneRow, newId, publishAll, type DeviceRow, type Frame, type ParticipantRow, type ZoneRow } from './world.ts';

export type AgentRow = {
  id: string; event_id: string; name: string; role: string; instructions: string; device_id: string | null; zone_ids_json: string;
  team_id: string | null; participant_id: string; active: number; last_action: string | null; last_action_at: number | null;
  stat_obs: number; stat_posts: number; stat_issues: number; deleted_at: number | null; created_at: number;
};
type PostRow = { id: string; event_id: string; agent_id: string; kind: string; text: string; issue_id: string | null; at: number };

const CAMERA_ROLES: AgentRole[] = ['queue_watcher', 'safety_sentinel', 'crowd_analyst'];

function statusOf(r: AgentRow, now: number): CrewStatus {
  if (!r.active) return 'paused';
  if (!r.device_id) return 'on_duty';
  const d = getDeviceRow(r.device_id);
  if (!d || now - d.last_seen_at > DEVICE_OFFLINE_MS) return 'offline';
  if (d.status !== 'observing') return 'idle';
  return d.device_type === 'scribe' ? 'listening' : 'watching';
}

export function toCrewAgent(r: AgentRow, now = Date.now()): CrewAgent {
  const watching = q.all<{ issue_id: string }>('SELECT issue_id FROM agent_watches WHERE agent_id = ?', r.id).map((w) => w.issue_id);
  return {
    id: r.id, eventId: r.event_id, name: r.name, role: r.role as AgentRole, instructions: r.instructions, deviceId: r.device_id,
    zoneIds: JSON.parse(r.zone_ids_json), teamId: r.team_id, participantId: r.participant_id, active: !!r.active, status: statusOf(r, now),
    lastAction: r.last_action, lastActionAt: r.last_action_at, stats: { observations: r.stat_obs, posts: r.stat_posts, issues: r.stat_issues },
    watching, createdAt: r.created_at,
  };
}

const toPost = (r: PostRow): AgentPost => {
  const n = r.issue_id ? q.get<{ number: number }>('SELECT number FROM issues WHERE id = ?', r.issue_id)?.number : null;
  return { id: r.id, agentId: r.agent_id, kind: r.kind as AgentPost['kind'], text: r.text, issueKey: n ? issueKey(n) : null, at: r.at };
};

export const listAgents = (eventId: string) => q.all<AgentRow>('SELECT * FROM agents WHERE event_id = ? AND deleted_at IS NULL ORDER BY created_at', eventId);
export const getAgent = (id: string) => q.get<AgentRow>('SELECT * FROM agents WHERE id = ? AND deleted_at IS NULL', id);

export function crewState(eventId: string): CrewState {
  const now = Date.now();
  return {
    crew: listAgents(eventId).map((r) => toCrewAgent(r, now)),
    crewPosts: q.all<PostRow>('SELECT * FROM agent_posts WHERE event_id = ? ORDER BY at DESC LIMIT 60', eventId).map(toPost),
  };
}

/** Persona focus for a camera/scribe: appended to that device's model prompt. */
export function agentFocus(deviceId: string): { name: string; role: AgentRole; instructions: string } | null {
  const r = q.get<AgentRow>('SELECT * FROM agents WHERE device_id = ? AND active = 1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1', deviceId);
  return r ? { name: r.name, role: r.role as AgentRole, instructions: r.instructions } : null;
}

/** Instructions of the event's active concierge (attendee chatbot persona), if any. */
export function conciergeInstructions(eventId: string): string | null {
  return q.get<{ instructions: string }>(`SELECT instructions FROM agents WHERE event_id = ? AND role = 'concierge' AND active = 1 AND deleted_at IS NULL LIMIT 1`, eventId)?.instructions ?? null;
}

/** One participant per agent so radio messages, acks and evidence work like any person's. */
export function ensureAgentParticipant(eventId: string, name: string): string {
  const id = newId('pt');
  const now = Date.now();
  q.run(`INSERT INTO participants (id, event_id, display_name, role, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, 'camera', ?, ?, ?)`,
    id, eventId, name, createHash('sha256').update(randomBytes(24)).digest('hex'), now, now);
  return id;
}

/** Record an agent action (+ stats) and return the frames. Inside tx. */
export function agentPost(a: AgentRow, kind: AgentPost['kind'], text: string, issueId: string | null = null, now = Date.now()): Frame[] {
  const id = newId('ap');
  q.run('INSERT INTO agent_posts (id, event_id, agent_id, kind, text, issue_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, a.event_id, a.id, kind, text.slice(0, 400), issueId, now);
  q.run(`UPDATE agents SET last_action = ?, last_action_at = ?, stat_posts = stat_posts + 1, stat_issues = stat_issues + ? WHERE id = ?`,
    text.slice(0, 200), now, issueId && (kind === 'assign' || kind === 'proposal' || kind === 'verify') ? 1 : 0, a.id);
  return [
    ['agent_post', toPost(q.get<PostRow>('SELECT * FROM agent_posts WHERE id = ?', id)!)],
    ['agent', toCrewAgent(getAgent(a.id)!, now)],
  ];
}

/** Radio message from the agent (needs acks), like a person's push-to-talk. Inside tx. */
export function radioAs(a: AgentRow, to: { type: 'hq' | 'team' | 'person'; id: string | null }, text: string, now = Date.now()): Frame[] {
  const staff = q.all<ParticipantRow>(`SELECT * FROM participants WHERE event_id = ? AND role IN ('staff','admin')`, a.event_id);
  let label = 'HQ';
  let expected: string[];
  if (to.type === 'person' && to.id) {
    const p = staff.find((x) => x.id === to.id);
    label = p?.display_name ?? 'Staff';
    expected = p ? [p.id] : [];
  } else if (to.type === 'team' && to.id) {
    label = `${listTeams(a.event_id).find((t) => t.id === to.id)?.name ?? 'Team'} team`;
    expected = staff.filter((p) => p.team_id === to.id).map((p) => p.id);
  } else {
    const hq = listTeams(a.event_id).filter((t) => /hq|headquarters|ops/i.test(t.name)).map((t) => t.id);
    expected = staff.filter((p) => p.role === 'admin' || (p.team_id && hq.includes(p.team_id))).map((p) => p.id);
  }
  const u = insertUtterance({
    event_id: a.event_id, team_id: a.team_id, device_id: a.device_id ?? a.participant_id, participant_id: a.participant_id, speaker: a.name,
    source: 'talk', text, started_at: now, ended_at: now, model: null, latency_ms: null,
  });
  const mid = newId('ms');
  q.run(`INSERT INTO messages (id, event_id, from_id, to_type, to_id, to_label, text, utterance_id, expected_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    mid, a.event_id, a.participant_id, to.type, to.id, label, text, u.id, JSON.stringify(expected), now);
  const frames: Frame[] = [['utterance', toUtterance(u)], ['message', toMessage(q.get('SELECT * FROM messages WHERE id = ?', mid)!)]];
  for (const pid of expected) frames.push(['notify', { id: newId('nt'), participantId: pid, title: `Radio · ${a.name} → ${label}`, body: text.slice(0, 140), issueId: null, messageId: mid, at: now }]);
  if (to.type === 'hq') frames.push(['notify', { id: newId('nt'), participantId: 'hq', title: `Radio · ${a.name} → HQ`, body: text.slice(0, 140), issueId: null, messageId: mid, at: now }]);
  return frames;
}

const agentActor = (a: AgentRow): Actor => ({ kind: 'ai', id: null, name: a.name });

// ── 1. Camera agents speak up when their zone's tracked action changes ─────────────────────────────────────────────
const lastZonePost = new Map<string, number>();
const ZONE_POST_GAP_MS = 2 * 60_000;

function coversZone(a: AgentRow, zoneId: string): boolean {
  if ((JSON.parse(a.zone_ids_json) as string[]).includes(zoneId)) return true;
  if (!a.device_id) return false;
  const d = getDeviceRow(a.device_id);
  if (!d) return false;
  if (d.zone_id === zoneId) return true;
  try { return (JSON.parse(d.regions_json || '[]') as Array<{ zoneId: string }>).some((r) => r.zoneId === zoneId); } catch { return false; }
}

const ROLE_FOR_DRIVER: Record<string, AgentRole> = { queue: 'queue_watcher', wait: 'queue_watcher', walkway: 'safety_sentinel', hazard: 'safety_sentinel', crowd: 'crowd_analyst', people: 'crowd_analyst', seats: 'crowd_analyst' };

/** Call inside the observation tx, after the zone tracker ran. Returns frames (agent radio + post). */
export function onZoneTrackChange(zone: ZoneRow, prev: ZoneTrack | null, next: ZoneTrack | null, now = Date.now()): Frame[] {
  try {
    if (!next?.action) return [];
    const changed = prev?.action?.code !== next.action.code || next.tier > (prev?.tier ?? 0);
    if (!changed) return [];
    if (now - (lastZonePost.get(zone.id) ?? 0) < ZONE_POST_GAP_MS) return [];
    const agents = listAgents(zone.event_id).filter((a) => a.active && CAMERA_ROLES.includes(a.role as AgentRole) && coversZone(a, zone.id));
    if (!agents.length) return [];
    const want = next.driver ? ROLE_FOR_DRIVER[next.driver] : undefined;
    const a = agents.find((x) => x.role === want) ?? agents[0];
    lastZonePost.set(zone.id, now);
    const crowd = zone.crowd_level ? CROWD_LABEL[zone.crowd_level as CrowdLevel].toLowerCase() : null;
    const people = zone.people_estimate != null ? `~${zone.people_estimate} people` : null;
    const state = [crowd, people].filter(Boolean).join(', ');
    const act = next.action.text.replace(/\s*·\s*/g, '; ');
    const text = `${zone.name} is ${state || 'getting busy'}. ${act.charAt(0).toUpperCase()}${act.slice(1)}.`;
    q.run('UPDATE agents SET stat_obs = stat_obs + 1 WHERE id = ?', a.id);
    return [...radioAs(a, { type: a.team_id ? 'team' : 'hq', id: a.team_id }, text, now), ...agentPost(a, 'radio', text, null, now)];
  } catch (e) {
    log.warn('crew.zone_post_failed', { err: (e as Error).message });
    return [];
  }
}

/** Meeting secretary note after an extraction produced actions. Inside tx. */
export function secretaryNote(deviceId: string, counts: { tasks: number; decisions: number; updates: number }, now = Date.now()): Frame[] {
  const a = q.get<AgentRow>(`SELECT * FROM agents WHERE device_id = ? AND role = 'meeting_secretary' AND active = 1 AND deleted_at IS NULL LIMIT 1`, deviceId);
  if (!a) return [];
  const parts = [counts.tasks ? `${counts.tasks} task${counts.tasks > 1 ? 's' : ''}` : '', counts.decisions ? `${counts.decisions} decision${counts.decisions > 1 ? 's' : ''}` : '',
    counts.updates ? `${counts.updates} update${counts.updates > 1 ? 's' : ''}` : ''].filter(Boolean);
  if (!parts.length) return [];
  const d = getDeviceRow(deviceId);
  q.run('UPDATE agents SET stat_obs = stat_obs + 1 WHERE id = ?', a.id);
  return agentPost(a, 'note', `Captured ${parts.join(', ')} from ${d?.label ?? 'the meeting'}.`, null, now);
}

// ── 2. Dispatcher + 3. watch & verify (every 30 s) ──────────────────────────────────────────────────────────────────
const lastDispatch = new Map<string, number>();
const DISPATCH_GAP_MS = 5 * 60_000;
/** An unowned issue waits this long (so speech like "Jimin, take this" can assign it first) before the dispatcher acts. */
const DISPATCH_AFTER_MS = Number(process.env.DISPATCH_AFTER_MS) > 0 ? Number(process.env.DISPATCH_AFTER_MS) : 12_000;
/** How often the crew loop runs (dispatch + watch & verify). */
const CREW_TICK_MS = Number(process.env.CREW_TICK_MS) > 0 ? Number(process.env.CREW_TICK_MS) : 4_000;

type Cand = ParticipantRow & { zoneId: string | null; seen: number; busy: number; load: number };

function dispatchTick(now: number) {
  const dispatchers = q.all<AgentRow>(`SELECT * FROM agents WHERE role = 'dispatcher' AND active = 1 AND deleted_at IS NULL`);
  for (const a of dispatchers) {
    const open = q.all<IssueRow>(`SELECT * FROM issues WHERE event_id = ? AND status = 'open' AND assignee_id IS NULL AND kind IN ('task','problem') AND created_at <= ? ORDER BY priority, created_at LIMIT 6`,
      a.event_id, now - DISPATCH_AFTER_MS);
    let acted = 0;
    for (const issue of open) {
      if (acted >= 2) break;
      if (now - (lastDispatch.get(issue.id) ?? 0) < DISPATCH_GAP_MS) continue;
      // Already waiting on a human decision (or suggested before a restart) → don't repeat ourselves.
      if (q.get(`SELECT 1 FROM proposals WHERE issue_id = ? AND status = 'pending' LIMIT 1`, issue.id)) { lastDispatch.set(issue.id, now); continue; }
      if (q.get(`SELECT 1 FROM agent_posts WHERE agent_id = ? AND issue_id = ? AND at > ? LIMIT 1`, a.id, issue.id, now - DISPATCH_GAP_MS)) { lastDispatch.set(issue.id, now); continue; }
      const cands = q.all<Cand>(
        `SELECT p.*, d.zone_id AS zoneId, MAX(p.last_seen_at, COALESCE(d.last_seen_at, 0)) AS seen,
           (SELECT COUNT(*) FROM issues i WHERE i.assignee_id = p.id AND i.status = 'in_progress') AS busy,
           (SELECT COUNT(*) FROM issues i WHERE i.assignee_id = p.id AND i.status != 'done') AS load
         FROM participants p LEFT JOIN devices d ON d.participant_id = p.id AND d.device_type = 'reporter'
         WHERE p.event_id = ? AND p.role = 'staff'`, a.event_id);
      if (!cands.length) continue;
      const online = (c: Cand) => now - c.seen < DEVICE_OFFLINE_MS * 4; // staff phones sleep; 100 s grace
      const score = (c: Cand) => [Number(!!issue.team_id && c.team_id === issue.team_id), Number(!!issue.zone_id && c.zoneId === issue.zone_id), Number(!c.busy), Number(online(c)), -c.load];
      cands.sort((x, y) => { const sx = score(x), sy = score(y); for (let i = 0; i < sx.length; i++) if (sx[i] !== sy[i]) return sy[i] - sx[i]; return 0; });
      const best = cands[0];
      const teamMatch = !!issue.team_id && best.team_id === issue.team_id;
      const zoneName = issue.zone_id ? getZoneRow(issue.zone_id)?.name : null;
      const why = [teamMatch ? 'same team' : null, issue.zone_id && best.zoneId === issue.zone_id ? `already at ${zoneName}` : null, !best.busy ? 'free now' : null].filter(Boolean).join(', ') || 'least busy';
      lastDispatch.set(issue.id, now);
      acted++;
      const frames: Frame[] = tx(() => {
        if (teamMatch && !best.busy && online(best)) {
          const f = changeIssue(issue.id, { assigneeId: best.id }, agentActor(a), [], 0.9, now);
          const msg = `${issueKey(issue.number)} is yours: ${issue.title}${zoneName ? ` (${zoneName})` : ''}. Tap Got it when you're on it.`;
          return [...f, ...radioAs(a, { type: 'person', id: best.id }, msg, now), ...agentPost(a, 'assign', `Assigned ${issueKey(issue.number)} to ${best.display_name} (${why}).`, issue.id, now)];
        }
        const f = applyAction(a.event_id, { type: 'update', issueNumber: issue.number, title: null, kind: null, priority: null, team: null, assignee: best.display_name,
          due: null, status: null, note: null, evidence: [], confidence: 0.6 }, [], 0.6, null, 'talk', null, now);
        return [...f, ...agentPost(a, 'proposal', `Suggested ${best.display_name} for ${issueKey(issue.number)} (${why}).`, issue.id, now)];
      });
      publishAll(a.event_id, frames);
    }
  }
}

function verifyTick(now: number) {
  const watches = q.all<{ issue_id: string; agent_id: string; since: number; normal_since: number | null }>('SELECT * FROM agent_watches');
  for (const w of watches) {
    const issue = getIssueRow(w.issue_id);
    const a = getAgent(w.agent_id);
    if (!issue || !a || issue.status === 'done') { q.run('DELETE FROM agent_watches WHERE issue_id = ?', w.issue_id); continue; }
    if (!issue.zone_id) continue;
    const zone = getZoneRow(issue.zone_id);
    const track = zone ? parseState(zone.track_json, now).track : null;
    if (!zone || !track) continue;
    if (track.tier > 0) { if (w.normal_since) q.run('UPDATE agent_watches SET normal_since = NULL WHERE issue_id = ?', w.issue_id); continue; }
    if (!w.normal_since) { q.run('UPDATE agent_watches SET normal_since = ? WHERE issue_id = ?', now, w.issue_id); continue; }
    if (now - w.normal_since < 60_000) continue;
    const inc = issue.incident_id ? q.get<{ incident_type: string }>('SELECT incident_type FROM incidents WHERE id = ?', issue.incident_id) : null;
    const crowdish = !!inc && ['overcrowding', 'long_queue'].includes(inc.incident_type);
    const frames: Frame[] = tx(() => {
      q.run('DELETE FROM agent_watches WHERE issue_id = ?', w.issue_id);
      const head = `Looks resolved — ${zone.name} has been back to normal for a minute`;
      if (crowdish && track.conf >= 0.8) {
        const f = changeIssue(issue.id, { status: 'done' }, agentActor(a), [], track.conf, now);
        const p = q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', a.participant_id);
        if (issue.incident_id && p) f.push(...resolveIncident(issue.incident_id, p, now));
        return [...f, ...agentPost(a, 'verify', `${head}. Closed ${issueKey(issue.number)} (${INCIDENT_LABEL[inc!.incident_type as IncidentType]}).`, issue.id, now)];
      }
      const f = applyAction(a.event_id, { type: 'update', issueNumber: issue.number, title: null, kind: null, priority: null, team: null, assignee: null,
        due: null, status: 'done', note: null, evidence: [], confidence: 0.75 }, [], 0.75, null, 'talk', null, now);
      return [...f, ...agentPost(a, 'verify', `${head}. Suggest closing ${issueKey(issue.number)}.`, issue.id, now)];
    });
    publishAll(issue.event_id, frames);
  }
}

export function startCrew() {
  const t = setInterval(() => {
    const now = Date.now();
    try { dispatchTick(now); } catch (e) { log.warn('crew.dispatch_failed', { err: (e as Error).message }); }
    try { verifyTick(now); } catch (e) { log.warn('crew.verify_failed', { err: (e as Error).message }); }
  }, CREW_TICK_MS);
  t.unref?.();
}

/** Defaults when creating an agent from a role preset. */
export const roleDefaults = (role: AgentRole) => AGENT_ROLE_DEFS[role];
export type { DeviceRow };
