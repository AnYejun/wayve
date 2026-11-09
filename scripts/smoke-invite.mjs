// Invites & members smoke: organizer creates an invite → a new user previews, signs up, accepts → appears in members and
// in their own event list; join-by-code; add-by-username; revoke; expiry states. Usage: node scripts/smoke-invite.mjs [baseUrl]
import { randomBytes } from 'node:crypto';
const BASE = process.argv[2] ?? 'http://localhost:8080';
const jar = () => { const c = new Map(); return { get: () => [...c].map(([k, v]) => `${k}=${v}`).join('; '), set: (hs) => { for (const h of hs ?? []) { const m = /^(wv[^=]*)=([^;]*)/.exec(h); if (m) c.set(m[1], m[2]); } } }; };
async function call(j, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { cookie: j.get(), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  j.set(r.headers.getSetCookie?.() ?? []);
  return { status: r.status, json: await r.json().catch(() => null) };
}
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) process.exitCode = 1; };
const sfx = randomBytes(3).toString('hex');
const pw = () => randomBytes(12).toString('base64url');

const org = jar();
await call(org, 'POST', '/api/auth/signup', { username: `org-${sfx}`, password: pw(), displayName: 'Yejun' });
const ev = (await call(org, 'POST', '/api/events', { name: 'Invite Test', templateId: 'demo' })).json.event;
const snap = (await call(org, 'GET', `/api/events/${ev.id}/snapshot`)).json;
const team = snap.teams.find((t) => t.name === 'Registration') ?? snap.teams[0];

let r = await call(org, 'POST', `/api/events/${ev.id}/invites`, { role: 'staff', teamId: team.id });
ok(r.status === 200 && /\/i\/[A-Za-z0-9_-]+$/.test(r.json.url) && r.json.invite.status === 'active' && r.json.invite.maxUses === 50, `invite created (${r.json.invite?.teamName}, ${r.json.invite?.maxUses} uses)`);
const token = r.json.url.split('/i/')[1];
const inviteId = r.json.invite.id;

r = await call(org, 'GET', `/api/events/${ev.id}/invites`);
ok(r.status === 200 && r.json.invites.length === 1 && !JSON.stringify(r.json).includes(token), 'list invites never exposes the token');

const guest = jar();
r = await call(guest, 'GET', `/api/invites/${token}`);
ok(r.json.valid && r.json.eventName === 'Invite Test' && r.json.inviterName === 'Yejun' && r.json.teamName === team.name && !r.json.alreadyMember, 'public preview');
r = await call(guest, 'POST', `/api/invites/${token}/accept`, {});
ok(r.status === 400 && r.json.error.code === 'NEEDS_NAME', 'signed-out staff accept asks for a name (no account needed)');
// QR-only staff via invite: a name is enough (separate phone)
const qrGuest = jar();
r = await call(qrGuest, 'POST', `/api/invites/${token}/accept`, { name: 'Noa' });
ok(r.status === 200 && r.json.eventId === ev.id && r.json.role === 'staff', 'staff invite accepted with just a name');
r = await call(qrGuest, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.status === 200 && r.json.me.role === 'staff' && r.json.me.displayName === 'Noa' && r.json.me.deviceId, 'name-only staff opens the event with a phone device');
r = await call(qrGuest, 'POST', `/api/invites/${token}/accept`, { name: 'Noa' });
ok(r.status === 200, 'name-only accept is idempotent on the same phone');
await call(guest, 'POST', '/api/auth/signup', { username: `mina-${sfx}`, password: pw(), displayName: 'Mina' });
r = await call(guest, 'POST', `/api/invites/${token}/accept`, {});
ok(r.status === 200 && r.json.eventId === ev.id && r.json.role === 'staff', 'accepted → staff');
r = await call(guest, 'POST', `/api/invites/${token}/accept`, {});
ok(r.status === 200, `accept is idempotent (${r.status} ${r.json?.error?.code ?? ''})`);
r = await call(guest, 'GET', '/api/auth/me');
ok(r.json.events.some((e) => e.event.id === ev.id && e.role === 'staff'), 'event appears in the new user’s list');
r = await call(guest, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.status === 200 && r.json.me.role === 'staff' && r.json.me.deviceId, 'staff can open the event (has a device)');
r = await call(org, 'GET', `/api/events/${ev.id}/members`);
const mina = r.json.members.find((m) => m.displayName === 'Mina');
ok(mina && mina.teamName === team.name && mina.username === `mina-${sfx}`, 'members list shows Mina in her team');
r = await call(org, 'GET', `/api/events/${ev.id}/invites`);
ok(r.json.invites[0].uses === 2, `uses counted once per person (Noa + Mina → ${r.json.invites[0].uses})`);

// join-by-code
const code = jar();
await call(code, 'POST', '/api/auth/signup', { username: `leo-${sfx}`, password: pw(), displayName: 'Leo' });
r = await call(code, 'POST', '/api/events/join-by-code', { code: ev.joinCode.toLowerCase(), as: 'staff' });
ok(r.status === 200 && r.json.role === 'staff', 'join by code (lowercase ok)');
r = await call(code, 'POST', '/api/events/join-by-code', { code: 'ZZZZZZ', as: 'staff' });
ok(r.status === 404, `unknown code → 404 (${r.status})`);
const codeGuest = jar();
r = await call(codeGuest, 'POST', '/api/events/join-by-code', { code: ev.joinCode, as: 'staff' });
ok(r.status === 400 && r.json.error.code === 'NEEDS_NAME', 'signed-out code join asks for a name');
r = await call(codeGuest, 'POST', '/api/events/join-by-code', { code: ev.joinCode, as: 'staff', name: 'Kai' });
ok(r.status === 200 && r.json.role === 'staff', 'join by code with just a name (no account)');
r = await call(codeGuest, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.status === 200 && r.json.me.displayName === 'Kai', 'name-only code join opens the event');

// add by username
const ana = jar();
await call(ana, 'POST', '/api/auth/signup', { username: `ana-${sfx}`, password: pw(), displayName: 'Ana' });
r = await call(org, 'POST', `/api/events/${ev.id}/members`, { username: `ana-${sfx}`, role: 'admin' });
ok(r.status === 200 && r.json.member.role === 'admin', 'add by username as organizer');
r = await call(ana, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.status === 200 && r.json.me.role === 'admin', 'added organizer can open the dashboard');
r = await call(org, 'POST', `/api/events/${ev.id}/members`, { username: 'nobody-here-xyz', role: 'staff' });
ok(r.status === 404, 'unknown username → 404');

// permissions + revoke
r = await call(guest, 'POST', `/api/events/${ev.id}/invites`, { role: 'admin' });
ok(r.status === 403, 'staff cannot create invites');
r = await call(org, 'POST', `/api/events/${ev.id}/invites`, { role: 'admin' });
const orgToken = r.json.url.split('/i/')[1];
r = await call(jar(), 'POST', `/api/invites/${orgToken}/accept`, { name: 'Eve' });
ok(r.status === 409 && r.json.error.code === 'NEEDS_LOGIN', 'organizer invites still need an account');
r = await call(org, 'DELETE', `/api/invites/${inviteId}`);
ok(r.status === 200, 'revoke');
const late = jar();
await call(late, 'POST', '/api/auth/signup', { username: `late-${sfx}`, password: pw(), displayName: 'Late' });
r = await call(late, 'GET', `/api/invites/${token}`);
ok(!r.json.valid && r.json.status === 'revoked', 'preview shows revoked');
r = await call(late, 'POST', `/api/invites/${token}/accept`, {});
ok(r.status === 410, 'revoked invite cannot be accepted');
r = await call(guest, 'POST', `/api/invites/${token}/accept`, {});
ok(r.status === 200, `existing member can still reopen a revoked link (${r.status} ${r.json?.error?.code ?? ''})`);
r = await call(late, 'GET', '/api/invites/not-a-real-token-123');
ok(r.json.status === 'not_found', 'unknown token preview');
console.log(process.exitCode ? 'FAILED' : `All good · event ${ev.id}`);
