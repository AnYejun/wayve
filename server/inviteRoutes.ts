// Invites & members: shareable invite links (sha256 stored, URL shown once), join-by-code (account or QR-only name),
// add-by-username, and the members list. Contract: shared/contracts.ts "Invites & members".
import express, { type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  DEVICE_OFFLINE_MS,
  type InviteInfo, type InvitePreview, type InviteRole, type InviteStatus, type Member, type Role,
} from '../shared/contracts.ts';
import { config } from './config.ts';
import { q, tx } from './db.ts';
import { currentUser, type UserRow } from './auth.ts';
import { listTeams } from './ops.ts';
import { HttpErr, ROLE_RANK, bad, cookieTokens, h, notFound, parse, participantFor, requireRole, setTokens } from './routes.ts';
import {
  addActivity, getDeviceRow, getEvent, newId, publishAll, toDevice, toParticipant,
  type DeviceRow, type EventRow, type Frame, type ParticipantRow,
} from './world.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Sliding-window limiter: generous for people double-tapping, tight enough to stop code/token guessing. */
const hits = new Map<string, number[]>();
function window(key: string, max: number, ms = 60_000) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < ms);
  if (list.length >= max) throw new HttpErr(429, 'TOO_MANY_ATTEMPTS', 'Too many tries. Wait a minute and try again.');
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
}

type InviteRow = {
  id: string; event_id: string; token_hash: string; role: string; team_id: string | null; created_by: string | null; created_at: number;
  expires_at: number | null; max_uses: number | null; uses: number; revoked_at: number | null; note: string | null;
};

function statusOf(r: InviteRow, now = Date.now()): InviteStatus {
  if (r.revoked_at) return 'revoked';
  if (r.expires_at != null && now > r.expires_at) return 'expired';
  if (r.max_uses != null && r.uses >= r.max_uses) return 'used_up';
  return 'active';
}

const teamName = (id: string | null) => (id ? q.get<{ name: string }>('SELECT name FROM teams WHERE id = ? AND deleted_at IS NULL', id)?.name ?? null : null);
const personName = (id: string | null) => (id ? q.get<{ display_name: string }>('SELECT display_name FROM participants WHERE id = ?', id)?.display_name ?? null : null);

function toInvite(r: InviteRow): InviteInfo {
  return {
    id: r.id, eventId: r.event_id, role: r.role as InviteRole, teamId: r.team_id, teamName: teamName(r.team_id), createdBy: personName(r.created_by),
    createdAt: r.created_at, expiresAt: r.expires_at, maxUses: r.max_uses, uses: r.uses, status: statusOf(r), note: r.note,
  };
}

function origin(req: Request): string {
  return config.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

/**
 * Make `user` a member of the event with at least `role` (never downgrades), optional team, and a reporter device so the
 * staff app works immediately. Inside tx. Same identity rules as staff join: one participant per (user, event).
 */
export function linkUser(user: UserRow, eventId: string, role: InviteRole, teamId: string | null, now = Date.now()): { p: ParticipantRow; frames: Frame[]; created: boolean } {
  const frames: Frame[] = [];
  let p = q.get<ParticipantRow>('SELECT * FROM participants WHERE user_id = ? AND event_id = ?', user.id, eventId) ?? null;
  let created = false;
  if (!p) {
    const id = newId('pt');
    q.run('INSERT INTO participants (id, event_id, display_name, role, token_hash, created_at, last_seen_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, eventId, user.display_name, role, sha(randomBytes(24).toString('base64url')), now, now, user.id);
    p = q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', id)!;
    created = true;
    frames.push(['activity', addActivity(eventId, 'device', `${user.display_name} joined as ${role === 'admin' ? 'organizer' : 'staff'}`, p.id, now)]);
  } else if (ROLE_RANK[role as Role] > ROLE_RANK[p.role as Role]) {
    q.run('UPDATE participants SET role = ? WHERE id = ?', role, p.id);
  }
  if (teamId && listTeams(eventId).some((t) => t.id === teamId)) q.run('UPDATE participants SET team_id = ? WHERE id = ?', teamId, p.id);
  q.run('UPDATE participants SET last_seen_at = ? WHERE id = ?', now, p.id);
  // Staff app needs a reporter device (reports, radio sender, location).
  let d = q.get<DeviceRow>(`SELECT * FROM devices WHERE participant_id = ? AND device_type = 'reporter' ORDER BY created_at DESC LIMIT 1`, p.id);
  if (!d) {
    const id = newId('dv');
    q.run(`INSERT INTO devices (id, event_id, participant_id, zone_id, device_type, status, label, last_seen_at, created_at)
           VALUES (?, ?, ?, NULL, 'reporter', 'idle', ?, ?, ?)`, id, eventId, p.id, user.display_name, now, now);
    d = getDeviceRow(id)!;
    frames.push(['device', toDevice(d)]);
  }
  const row = q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', p.id)!;
  frames.push(['participant', toParticipant(row)]);
  return { p: row, frames, created };
}

function requireUser(req: Request): UserRow {
  const u = currentUser(req);
  if (!u) throw new HttpErr(409, 'NEEDS_LOGIN', 'Sign in to join this event.');
  return u;
}

/**
 * Staff without an account (QR-only): a cookie-token participant on THIS phone, named by the person, with a reporter device
 * so radio / reports / tasks work immediately. Idempotent per browser cookie. Inside tx; the caller sets the cookie.
 */
export function linkGuestStaff(req: Request, eventId: string, name: string, teamId: string | null, now = Date.now()):
  { p: ParticipantRow; frames: Frame[]; created: boolean; token: string | null } {
  const frames: Frame[] = [];
  const clean = name.trim().slice(0, 20);
  let p = participantFor(req, eventId);
  let created = false;
  let token: string | null = null;
  if (!p) {
    token = randomBytes(24).toString('base64url');
    const id = newId('pt');
    q.run('INSERT INTO participants (id, event_id, display_name, role, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, eventId, clean, 'staff', sha(token), now, now);
    p = q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', id)!;
    created = true;
    frames.push(['activity', addActivity(eventId, 'device', `${clean} joined as staff`, p.id, now)]);
  } else {
    if (ROLE_RANK.staff > ROLE_RANK[p.role as Role]) q.run(`UPDATE participants SET role = 'staff' WHERE id = ?`, p.id);
    if (!(p as ParticipantRow & { user_id?: string | null }).user_id && clean && clean !== p.display_name) {
      q.run('UPDATE participants SET display_name = ? WHERE id = ?', clean, p.id);
      q.run(`UPDATE devices SET label = ? WHERE participant_id = ? AND device_type = 'reporter'`, clean, p.id);
    }
  }
  if (teamId && listTeams(eventId).some((t) => t.id === teamId)) q.run('UPDATE participants SET team_id = ? WHERE id = ?', teamId, p.id);
  q.run('UPDATE participants SET last_seen_at = ? WHERE id = ?', now, p.id);
  let d = q.get<DeviceRow>(`SELECT * FROM devices WHERE participant_id = ? AND device_type = 'reporter' ORDER BY created_at DESC LIMIT 1`, p.id);
  if (!d) {
    const id = newId('dv');
    q.run(`INSERT INTO devices (id, event_id, participant_id, zone_id, device_type, status, label, last_seen_at, created_at)
           VALUES (?, ?, ?, NULL, 'reporter', 'idle', ?, ?, ?)`, id, eventId, p.id, clean, now, now);
    d = getDeviceRow(id)!;
    frames.push(['device', toDevice(d)]);
  }
  const row = q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', p.id)!;
  frames.push(['participant', toParticipant(row)]);
  return { p: row, frames, created, token };
}

/** The QR-only staff name from a request body (required when signed out). */
function guestName(body: unknown): string {
  const n = typeof (body as { name?: unknown })?.name === 'string' ? ((body as { name: string }).name).trim() : '';
  if (n.length < 1) throw new HttpErr(400, 'NEEDS_NAME', 'Tell us what people call you.');
  return n.slice(0, 20);
}

const isStaffMember = (p: ParticipantRow | null) => !!p && ROLE_RANK[p.role as Role] >= ROLE_RANK.staff;
function setCookieFor(req: Request, res: Response, token: string | null) {
  if (token) setTokens(res, [token, ...cookieTokens(req)]);
}

function toMember(p: ParticipantRow & { username?: string | null }, now = Date.now()): Member {
  const dev = q.get<{ last_seen_at: number }>('SELECT MAX(last_seen_at) AS last_seen_at FROM devices WHERE participant_id = ?', p.id);
  const lastSeen = Math.max(p.last_seen_at, dev?.last_seen_at ?? 0);
  return {
    participantId: p.id, userId: (p as ParticipantRow & { user_id?: string | null }).user_id ?? null, username: p.username ?? null, displayName: p.display_name, role: p.role as Role,
    teamId: p.team_id ?? null, teamName: teamName(p.team_id ?? null), joinedAt: p.created_at, lastSeenAt: lastSeen, online: now - lastSeen < DEVICE_OFFLINE_MS,
  };
}

export function inviteRouter() {
  const r = express.Router();
  const json = express.json({ limit: '16kb' });

  // ── invites (admin) ──
  r.post('/events/:eventId/invites', json, h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound('Event not found.');
    const admin = requireRole(req, ev.id, 'admin');
    const b = parse(z.object({
      role: z.enum(['admin', 'staff']).default('staff'), teamId: z.string().nullish(), maxUses: z.number().int().min(1).max(1000).nullish(),
      expiresInHours: z.number().min(0.25).max(24 * 30).nullish(), note: z.string().trim().max(80).nullish(),
    }), req.body);
    if (b.teamId && !listTeams(ev.id).some((t) => t.id === b.teamId)) throw bad('NO_TEAM', 'That team no longer exists.');
    const token = randomBytes(18).toString('base64url');
    const id = newId('iv');
    const now = Date.now();
    q.run(`INSERT INTO invites (id, event_id, token_hash, role, team_id, created_by, created_at, expires_at, max_uses, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, ev.id, sha(token), b.role, b.teamId ?? null, admin.id, now,
      b.expiresInHours == null ? now + 24 * 3600_000 : now + Math.round(b.expiresInHours * 3600_000), b.maxUses === undefined ? 50 : b.maxUses, b.note ?? null);
    res.json({ invite: toInvite(q.get<InviteRow>('SELECT * FROM invites WHERE id = ?', id)!), url: `${origin(req)}/i/${token}` });
  }));

  r.get('/events/:eventId/invites', h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound('Event not found.');
    requireRole(req, ev.id, 'admin');
    res.json({ invites: q.all<InviteRow>('SELECT * FROM invites WHERE event_id = ? ORDER BY created_at DESC LIMIT 100', ev.id).map(toInvite) });
  }));

  r.delete('/invites/:inviteId', h((req, res) => {
    const inv = q.get<InviteRow>('SELECT * FROM invites WHERE id = ?', String(req.params.inviteId));
    if (!inv) throw notFound('Invite not found.');
    requireRole(req, inv.event_id, 'admin');
    q.run('UPDATE invites SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?', Date.now(), inv.id);
    res.json({ ok: true });
  }));

  // ── public preview + accept ──
  r.get('/invites/:token', h((req, res) => {
    const token = String(req.params.token);
    const inv = /^[A-Za-z0-9_-]{10,64}$/.test(token) ? q.get<InviteRow>('SELECT * FROM invites WHERE token_hash = ?', sha(token)) : undefined;
    const user = currentUser(req);
    if (!inv) {
      const body: InvitePreview = { valid: false, status: 'not_found', eventId: null, eventName: null, role: null, teamName: null, inviterName: null, expiresAt: null, alreadyMember: false };
      return res.json(body);
    }
    const ev = getEvent(inv.event_id) as EventRow | undefined;
    const status = statusOf(inv);
    const already = user
      ? !!q.get('SELECT 1 FROM participants WHERE user_id = ? AND event_id = ?', user.id, inv.event_id)
      : isStaffMember(participantFor(req, inv.event_id));
    const body: InvitePreview = {
      valid: status === 'active', status, eventId: inv.event_id, eventName: ev?.name ?? null, role: inv.role as InviteRole,
      teamName: teamName(inv.team_id), inviterName: personName(inv.created_by), expiresAt: inv.expires_at, alreadyMember: already,
    };
    res.json(body);
  }));

  r.post('/invites/:token/accept', json, h((req, res) => {
    const user = currentUser(req);
    const token = String(req.params.token);
    const inv = /^[A-Za-z0-9_-]{10,64}$/.test(token) ? q.get<InviteRow>('SELECT * FROM invites WHERE token_hash = ?', sha(token)) : undefined;
    if (!inv) throw notFound('This invite link is not valid.');
    if (!user) {
      // QR-only staff: a name is enough. Organizer invites still need an account (they open dashboards).
      if (inv.role !== 'staff') throw new HttpErr(409, 'NEEDS_LOGIN', 'Sign in to join as an organizer.');
      window(`invite-guest:${req.ip}`, 20);
      const name = guestName(req.body);
      const mine = participantFor(req, inv.event_id);
      const st = statusOf(inv);
      if (st !== 'active' && !isStaffMember(mine)) {
        const msg = st === 'revoked' ? 'This invite was revoked.' : st === 'expired' ? 'This invite has expired.' : 'This invite has been used up.';
        throw new HttpErr(410, `INVITE_${st.toUpperCase()}`, `${msg} Ask the organizer for a new link.`);
      }
      const g = tx(() => {
        const r2 = linkGuestStaff(req, inv.event_id, name, inv.team_id);
        if (r2.created) q.run('UPDATE invites SET uses = uses + 1 WHERE id = ?', inv.id);
        return r2;
      });
      setCookieFor(req, res, g.token);
      publishAll(inv.event_id, g.frames);
      return res.json({ eventId: inv.event_id, role: g.p.role });
    }
    window(`invite:${user.id}`, 20);
    const already = q.get<ParticipantRow>('SELECT * FROM participants WHERE user_id = ? AND event_id = ?', user.id, inv.event_id);
    const status = statusOf(inv);
    // Idempotent: someone already in the event can always re-open the link.
    if (status !== 'active' && !already) {
      const msg = status === 'revoked' ? 'This invite was revoked.' : status === 'expired' ? 'This invite has expired.' : 'This invite has been used up.';
      throw new HttpErr(410, `INVITE_${status.toUpperCase()}`, `${msg} Ask the organizer for a new link.`);
    }
    const out = tx(() => {
      const r2 = linkUser(user, inv.event_id, inv.role as InviteRole, inv.team_id);
      if (r2.created) q.run('UPDATE invites SET uses = uses + 1 WHERE id = ?', inv.id);
      return r2;
    });
    publishAll(inv.event_id, out.frames);
    res.json({ eventId: inv.event_id, role: out.p.role });
  }));

  // ── public team names for an event code (the staff join picker; names only) ──
  r.get('/events/code/:code/teams', h((req, res) => {
    const ev = q.get<EventRow>('SELECT * FROM events WHERE join_code = ?', String(req.params.code).toUpperCase());
    if (!ev) throw notFound('No event uses that code.');
    res.json({ teams: listTeams(ev.id).map((t) => ({ id: t.id, name: t.name })) });
  }));

  // ── one-tap join by event code (signed-in users) ──
  r.post('/events/join-by-code', json, h((req, res) => {
    const user = currentUser(req);
    const b = parse(z.object({ code: z.string().trim().min(4).max(12), as: z.literal('staff').default('staff'), teamId: z.string().nullish(), name: z.string().trim().max(30).nullish() }), req.body);
    window(user ? `joincode:${user.id}` : `joincode-guest:${req.ip}`, 10);
    const ev = q.get<EventRow>('SELECT * FROM events WHERE join_code = ?', b.code.toUpperCase());
    if (!ev) throw notFound('No event uses that code. Check the 6 characters and try again.');
    if (!user) {
      // QR-only staff: no account, just a name on this phone.
      const name = guestName(req.body);
      const g = tx(() => linkGuestStaff(req, ev.id, name, b.teamId ?? null));
      setCookieFor(req, res, g.token);
      publishAll(ev.id, g.frames);
      return res.json({ eventId: ev.id, role: g.p.role });
    }
    const out = tx(() => linkUser(user, ev.id, 'staff', b.teamId ?? null));
    publishAll(ev.id, out.frames);
    res.json({ eventId: ev.id, role: out.p.role });
  }));

  // ── members (admin) ──
  r.get('/events/:eventId/members', h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound('Event not found.');
    requireRole(req, ev.id, 'admin');
    const rows = q.all<ParticipantRow & { username: string | null }>(
      `SELECT p.*, u.username AS username FROM participants p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.event_id = ? AND p.role IN ('admin','staff') ORDER BY CASE p.role WHEN 'admin' THEN 0 ELSE 1 END, p.created_at`, ev.id);
    res.json({ members: rows.map((p) => toMember(p)) });
  }));

  r.post('/events/:eventId/members', json, h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound('Event not found.');
    requireRole(req, ev.id, 'admin');
    const b = parse(z.object({ username: z.string().trim().toLowerCase().min(3).max(24), role: z.enum(['admin', 'staff']).default('staff'), teamId: z.string().nullish() }), req.body);
    const u = q.get<UserRow>('SELECT * FROM users WHERE username = ?', b.username);
    if (!u) throw notFound(`No account called "${b.username}". Send them an invite link instead.`);
    const out = tx(() => linkUser(u, ev.id, b.role, b.teamId ?? null));
    publishAll(ev.id, out.frames);
    const row = q.get<ParticipantRow & { username: string | null }>(
      'SELECT p.*, u.username AS username FROM participants p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?', out.p.id)!;
    res.json({ member: toMember(row) });
  }));

  return r;
}
