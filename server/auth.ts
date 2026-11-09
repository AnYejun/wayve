// Accounts (ID login). Passwords: scrypt (N=16384, r=8, p=1, 16-byte salt) stored as `scrypt$N$salt$hash` (base64url).
// Sessions: random 32-byte token in the httpOnly cookie `wv_u`; the server stores only sha256(token). 30-day expiry.
// Devices (camera, scribe) and attendees keep using the per-event `wv` token cookie (no account).
import express, { type Request, type Response } from 'express';
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { z } from 'zod';
import type { AuthState, MyEvent, Role, User } from '../shared/contracts.ts';
import { config } from './config.ts';
import { q } from './db.ts';
import { HttpErr, clientIp, h, parse } from './routes.ts';
import { newId, toEvent, type EventRow } from './world.ts';

export type UserRow = { id: string; username: string; display_name: string; password_hash: string; created_at: number };

const COOKIE = 'wv_u';
const SESSION_MS = 30 * 24 * 3600_000;
const N = 16384;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const got = scryptSync(pw, Buffer.from(saltB64, 'base64url'), expected.length, { N: Number(n) || N, r: 8, p: 1 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Async scrypt (libuv threadpool) for request handlers, so a login flood can't block the event loop.
const scryptAsync = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((ok, fail) => scrypt(pw, salt, len, opts, (e, k) => (e ? fail(e) : ok(k))));

export async function hashPasswordAsync(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPasswordAsync(pw: string, stored: string): Promise<boolean> {
  const [alg, n, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const got = await scryptAsync(pw, Buffer.from(saltB64, 'base64url'), expected.length, { N: Number(n) || N, r: 8, p: 1 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}
// Spend the same time on unknown usernames so timing doesn't reveal which exist.
const DUMMY = hashPassword(randomBytes(12).toString('hex'));

export const toUser = (r: UserRow): User => ({ id: r.id, username: r.username, displayName: r.display_name, createdAt: r.created_at });

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie ?? '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

/** The signed-in user for this request, or null. */
export function currentUser(req: Request): UserRow | null {
  const cached = (req as Request & { __user?: UserRow | null }).__user;
  if (cached !== undefined) return cached;
  let user: UserRow | null = null;
  const token = readCookie(req, COOKIE);
  if (token && /^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    const s = q.get<{ user_id: string; expires_at: number }>('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', sha(token));
    if (s && s.expires_at > Date.now()) user = q.get<UserRow>('SELECT * FROM users WHERE id = ?', s.user_id) ?? null;
  }
  (req as Request & { __user?: UserRow | null }).__user = user;
  return user;
}

function startSession(res: Response, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  q.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha(token), userId, now, now + SESSION_MS);
  res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${config.isProd ? '; Secure' : ''}`);
}

export function myEvents(userId: string): MyEvent[] {
  const rows = q.all<EventRow & { role: string }>(
    `SELECT e.*, p.role AS role FROM participants p JOIN events e ON e.id = p.event_id WHERE p.user_id = ? ORDER BY p.last_seen_at DESC, e.created_at DESC`, userId);
  return rows.map((r) => ({ event: toEvent(r), role: r.role as Role, status: 'live' as const }));
}

export function authState(user: UserRow | null): AuthState {
  return { user: user ? toUser(user) : null, events: user ? myEvents(user.id) : [] };
}

// Throttles: login 5 attempts / minute per ip+username; signup 30 / minute per ip (a whole venue may share one Wi-Fi IP).
const attempts = new Map<string, number[]>();
function throttle(key: string, max = 5) {
  const now = Date.now();
  const list = (attempts.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= max) throw new HttpErr(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a minute and try again.');
  list.push(now);
  attempts.set(key, list);
  if (attempts.size > 5000) { // prune expired windows (oldest first) instead of wiping everyone's lockouts
    for (const [k, l] of attempts) { if (attempts.size <= 4000) break; if (!l.some((t) => now - t < 60_000)) attempts.delete(k); }
    for (const k of attempts.keys()) { if (attempts.size <= 4500) break; attempts.delete(k); }
  }
}

const Username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,24}$/, 'Use 3–24 letters, numbers, dots, dashes or underscores.');

export function authRouter() {
  const r = express.Router();
  const json = express.json({ limit: '16kb' });

  r.post('/auth/signup', json, h(async (req, res) => {
    const raw = z.object({ username: z.string(), password: z.string(), displayName: z.string() }).safeParse(req.body);
    if (!raw.success) throw new HttpErr(400, 'INVALID_INPUT', 'Fill in a username, password and name.');
    const u = Username.safeParse(raw.data.username);
    if (!u.success) throw new HttpErr(400, 'BAD_USERNAME', 'Usernames are 3–24 characters: letters, numbers, dots, dashes or underscores.');
    if (raw.data.password.length < 8 || raw.data.password.length > 200) throw new HttpErr(400, 'WEAK_PASSWORD', 'Use a password of at least 8 characters.');
    const displayName = raw.data.displayName.trim().slice(0, 40);
    if (!displayName) throw new HttpErr(400, 'NO_NAME', 'Tell us your name. It is how teammates assign work to you.');
    throttle(`signup:${clientIp(req)}`, 30);
    if (q.get('SELECT 1 FROM users WHERE username = ?', u.data)) throw new HttpErr(409, 'USERNAME_TAKEN', 'That username is taken. Try another one.');
    const id = newId('us');
    const hash = await hashPasswordAsync(raw.data.password);
    if (q.get('SELECT 1 FROM users WHERE username = ?', u.data)) throw new HttpErr(409, 'USERNAME_TAKEN', 'That username is taken. Try another one.');
    q.run('INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', id, u.data, displayName, hash, Date.now());
    startSession(res, id);
    res.json(authState(q.get<UserRow>('SELECT * FROM users WHERE id = ?', id)!));
  }));

  r.post('/auth/login', json, h(async (req, res) => {
    const b = parse(z.object({ username: z.string().max(64), password: z.string().max(200) }), req.body);
    const username = b.username.trim().toLowerCase();
    throttle(`login-ip:${clientIp(req)}`, 30); // any username: stops password spraying and CPU floods
    throttle(`login:${clientIp(req)}:${username}`);
    const user = q.get<UserRow>('SELECT * FROM users WHERE username = ?', username);
    const ok = (await verifyPasswordAsync(b.password, user?.password_hash ?? DUMMY)) && !!user;
    if (!ok || !user) throw new HttpErr(401, 'BAD_CREDENTIALS', 'Wrong username or password.');
    startSession(res, user.id);
    res.json(authState(user));
  }));

  r.post('/auth/logout', json, h((req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) q.run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
    res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.isProd ? '; Secure' : ''}`);
    res.json({ ok: true });
  }));

  r.get('/auth/me', h((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(authState(currentUser(req)));
  }));

  return r;
}
