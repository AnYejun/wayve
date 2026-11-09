// AI crew routes (contract: shared/contracts.ts "AI CREW"). Mounted inside apiRouter() before its 404 handler.
import express from 'express';
import { z } from 'zod';
import { AGENT_ROLES, AGENT_ROLE_DEFS, type AgentRole } from '../shared/contracts.ts';
import { q, tx } from './db.ts';
import { agentPost, crewState, ensureAgentParticipant, getAgent, toCrewAgent } from './crew.ts';
import { getIssueRow, issueKey, listTeams } from './ops.ts';
import { bad, h, notFound, parse, requireRole } from './routes.ts';
import { getDeviceRow, getEvent, listZoneRows, newId, publishAll, type Frame } from './world.ts';

const json = express.json({ limit: '64kb' });

export function crewRouter() {
  const r = express.Router();

  r.get('/events/:eventId/agents', h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound();
    requireRole(req, ev.id, 'staff');
    res.json(crewState(ev.id));
  }));

  r.post('/events/:eventId/agents', json, h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound();
    requireRole(req, ev.id, 'admin');
    const b = parse(z.object({
      name: z.string().trim().min(1).max(40), role: z.enum(AGENT_ROLES), instructions: z.string().trim().max(1500).optional(),
      deviceId: z.string().nullish(), zoneIds: z.array(z.string()).max(20).optional(), teamId: z.string().nullish(),
    }), req.body);
    validate(ev.id, b.deviceId, b.zoneIds, b.teamId, b.role);
    const now = Date.now();
    const out = tx(() => {
      const id = newId('ag');
      const pid = ensureAgentParticipant(ev.id, b.name);
      q.run(`INSERT INTO agents (id, event_id, name, role, instructions, device_id, zone_ids_json, team_id, participant_id, active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        id, ev.id, b.name, b.role, b.instructions || AGENT_ROLE_DEFS[b.role].instructions, b.deviceId ?? null, JSON.stringify(b.zoneIds ?? []), b.teamId ?? null, pid, now);
      const a = getAgent(id)!;
      return { a, frames: agentPost(a, 'note', `${a.name} joined the crew as ${AGENT_ROLE_DEFS[b.role].label}.`, null, now) };
    });
    publishAll(ev.id, out.frames);
    res.json({ agent: toCrewAgent(getAgent(out.a.id)!) });
  }));

  r.patch('/agents/:id', json, h((req, res) => {
    const a = getAgent(String(req.params.id));
    if (!a) throw notFound('Agent not found.');
    requireRole(req, a.event_id, 'admin');
    const b = parse(z.object({
      name: z.string().trim().min(1).max(40).optional(), instructions: z.string().trim().max(1500).optional(), deviceId: z.string().nullish(),
      zoneIds: z.array(z.string()).max(20).optional(), teamId: z.string().nullish(), active: z.boolean().optional(),
    }), req.body);
    validate(a.event_id, b.deviceId, b.zoneIds, b.teamId, a.role as AgentRole);
    q.run(`UPDATE agents SET name = COALESCE(?, name), instructions = COALESCE(?, instructions),
             device_id = CASE WHEN ? THEN ? ELSE device_id END, zone_ids_json = COALESCE(?, zone_ids_json),
             team_id = CASE WHEN ? THEN ? ELSE team_id END, active = COALESCE(?, active) WHERE id = ?`,
      b.name ?? null, b.instructions ?? null, b.deviceId !== undefined ? 1 : 0, b.deviceId ?? null, b.zoneIds ? JSON.stringify(b.zoneIds) : null,
      b.teamId !== undefined ? 1 : 0, b.teamId ?? null, b.active === undefined ? null : b.active ? 1 : 0, a.id);
    if (b.name) q.run('UPDATE participants SET display_name = ? WHERE id = ?', b.name, a.participant_id);
    const agent = toCrewAgent(getAgent(a.id)!);
    publishAll(a.event_id, [['agent', agent]]);
    res.json({ agent });
  }));

  r.delete('/agents/:id', h((req, res) => {
    const a = getAgent(String(req.params.id));
    if (!a) throw notFound('Agent not found.');
    requireRole(req, a.event_id, 'admin');
    q.run('UPDATE agents SET deleted_at = ?, active = 0 WHERE id = ?', Date.now(), a.id);
    q.run('DELETE FROM agent_watches WHERE agent_id = ?', a.id);
    publishAll(a.event_id, [['agent', toCrewAgent({ ...a, active: 0, deleted_at: Date.now() })]]);
    res.json({ ok: true });
  }));

  r.post('/issues/:id/assign-agent', json, h((req, res) => {
    const issue = getIssueRow(String(req.params.id));
    if (!issue) throw notFound('Issue not found.');
    requireRole(req, issue.event_id, 'staff');
    const b = parse(z.object({ agentId: z.string().nullable() }), req.body);
    const now = Date.now();
    const frames: Frame[] = tx(() => {
      const prev = q.get<{ agent_id: string }>('SELECT agent_id FROM agent_watches WHERE issue_id = ?', issue.id);
      q.run('DELETE FROM agent_watches WHERE issue_id = ?', issue.id);
      const out: Frame[] = [];
      if (prev) { const pa = getAgent(prev.agent_id); if (pa) out.push(['agent', toCrewAgent(pa, now)]); }
      if (!b.agentId) return out;
      const a = getAgent(b.agentId);
      if (!a || a.event_id !== issue.event_id) throw bad('NO_AGENT', 'Agent not found.');
      q.run('INSERT INTO agent_watches (issue_id, agent_id, since, normal_since) VALUES (?, ?, ?, NULL)', issue.id, a.id, now);
      const zone = issue.zone_id ? listZoneRows(issue.event_id).find((z) => z.id === issue.zone_id)?.name : null;
      out.push(...agentPost(a, 'note', `Watching ${issueKey(issue.number)}${zone ? ` at ${zone}` : ''} — I'll confirm when it's fixed.`, issue.id, now));
      return out;
    });
    publishAll(issue.event_id, frames);
    res.json({ agent: b.agentId ? toCrewAgent(getAgent(b.agentId)!) : null });
  }));

  return r;
}

function validate(eventId: string, deviceId: string | null | undefined, zoneIds: string[] | undefined, teamId: string | null | undefined, role: AgentRole) {
  if (deviceId) {
    const d = getDeviceRow(deviceId);
    if (!d || d.event_id !== eventId) throw bad('NO_DEVICE', 'Device not found.');
    const binds = AGENT_ROLE_DEFS[role].binds;
    if (binds === 'camera' && d.device_type !== 'camera') throw bad('WRONG_DEVICE', 'Bind this role to a camera.');
    if (binds === 'scribe' && d.device_type !== 'scribe') throw bad('WRONG_DEVICE', 'Bind this role to a meeting scribe.');
  }
  if (zoneIds?.length) {
    const ids = new Set(listZoneRows(eventId).map((z) => z.id));
    if (!zoneIds.every((z) => ids.has(z))) throw bad('NO_ZONE', 'Zone not found.');
  }
  if (teamId && !listTeams(eventId).some((t) => t.id === teamId)) throw bad('NO_TEAM', 'Team not found.');
}
