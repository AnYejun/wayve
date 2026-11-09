// Seeds a realistic demo event "Demo Hackathon" on a running WAYVE server (real models do the extraction).
// Usage: node scripts/seed-hackathon.mjs [baseUrl]
// Demo accounts are created with random passwords written to data/demo-credentials.json (gitignored) — never printed.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:8080';
const here = path.dirname(fileURLToPath(import.meta.url));
const credFile = path.join(here, '..', 'data', 'demo-credentials.json');
fs.mkdirSync(path.dirname(credFile), { recursive: true });
const creds = fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile, 'utf8')) : {};
const suffix = creds.suffix ?? randomBytes(3).toString('hex');
const pw = (u) => (creds[u] ??= randomBytes(12).toString('base64url'));

const jar = () => { const c = new Map(); return { get: () => [...c].map(([k, v]) => `${k}=${v}`).join('; '), set: (hs) => { for (const h of hs ?? []) { const m = /^(wv[^=]*)=([^;]*)/.exec(h); if (m) c.set(m[1], m[2]); } } }; };
async function call(j, method, p, body, raw) {
  const headers = { cookie: j.get() }; let b;
  if (raw) { b = raw.data; headers['content-type'] = raw.type; } else if (body !== undefined) { b = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const r = await fetch(BASE + p, { method, headers, body: b });
  j.set(r.headers.getSetCookie?.() ?? []);
  const json = await r.json().catch(() => null);
  if (!r.ok) console.warn(`  ! ${method} ${p} → ${r.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`);
  return { status: r.status, json };
}
async function account(j, username, displayName) {
  let r = await call(j, 'POST', '/api/auth/signup', { username, password: pw(username), displayName });
  if (r.status !== 200) r = await call(j, 'POST', '/api/auth/login', { username, password: pw(username) });
  return r.json?.user;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const org = jar();
await account(org, `organizer-${suffix}`, 'Yejun');
const ev = (await call(org, 'POST', '/api/events', { name: 'Demo Hackathon', templateId: 'demo' })).json.event;
console.log('event', ev.id, ev.joinCode);

// Real venue map: the floor plan + zones that match its rooms exactly (1600×1000 px space).
const plan = fs.readFileSync(path.join(here, 'fixtures', 'floorplan.png'));
const up = await call(org, 'POST', `/api/events/${ev.id}/map?kind=floorplan`, undefined, { data: plan, type: 'image/png' });
console.log('map', up.json?.map?.kind, up.json?.map?.width, 'x', up.json?.map?.height, '· AI suggested', up.json?.suggestions?.length ?? 0, 'areas');
const R = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const zones = [
  ['Main Stage', R(40, 40, 900, 380)], ['Hacking Area A', R(940, 40, 620, 380)], ['Hacking Area B', R(940, 420, 620, 300)],
  ['Food & Drinks', R(40, 420, 440, 300)], ['Mentor Lounge', R(480, 420, 460, 300)], ['Registration', R(40, 720, 500, 240)],
  ['Main Entrance', R(540, 720, 700, 240)], ['Restrooms', R(1240, 720, 320, 240)],
].map(([name, polygon]) => ({ name, polygon }));
const zr = await call(org, 'PUT', `/api/events/${ev.id}/zones`, { zones });
const zid = Object.fromEntries((zr.json?.zones ?? []).map((z) => [z.name, z.id]));
console.log('zones', Object.keys(zid).length);

await call(org, 'PUT', `/api/events/${ev.id}/knowledge`, { text: `Demo Hackathon — run of show (sample data, all times KST)
09:30 Doors open · Registration desk at the Main Entrance side (badges + T-shirts)
10:30 Opening keynote — Main Stage
12:00 Lunch — Food & Drinks (vegetarian option at the left counter)
13:00 Hacking starts — Teams 1–30 in Hacking Area A, Teams 31–60 in Hacking Area B
14:00–17:00 Mentor office hours — Mentor Lounge (book on the board at the door)
18:30 Dinner — Food & Drinks
19:00 Demo submissions close
20:00 Final demos — Main Stage
Wi-Fi: Demo-Guest / ask Registration for the password. First aid kit: Registration desk. Emergency: call 119, then radio HQ.
Lost & found: Registration. Power strips: ask the Stage team.` });

const snap = (await call(org, 'GET', `/api/events/${ev.id}/snapshot`)).json;
const team = Object.fromEntries((snap?.teams ?? []).map((t) => [t.name, t.id]));
const people = [['jimin', 'Jimin', 'Registration', 'Registration'], ['minsu', 'Minsu', 'Stage', 'Main Stage'], ['haneul', 'Haneul', 'Safety', 'Main Entrance']];
const staff = {};
for (const [u, name, t, zone] of people) {
  const j = jar();
  await account(j, `${u}-${suffix}`, name);
  const r = await call(j, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'staff', teamId: team[t] });
  if (r.json?.device) await call(j, 'PATCH', `/api/devices/${r.json.device.id}`, { zoneId: zid[zone] });
  staff[name] = { j, me: r.json?.me };
}
creds.suffix = suffix;
creds.eventId = ev.id;
creds.joinCode = ev.joinCode;
fs.writeFileSync(credFile, JSON.stringify(creds, null, 2), { mode: 0o600 });

// A few radio messages + reports so the board, map and live data have real AI-extracted content.
await call(org, 'POST', '/api/talk/text', { eventId: ev.id, to: 'all', text: 'Jimin, please print 200 more name badges for registration by 2 PM. Minsu, can you check the stage lights before the keynote?' });
await sleep(6000);
await call(staff.Minsu.j, 'POST', '/api/talk/text', { eventId: ev.id, to: 'hq', text: "I can't check the stage lights yet, we don't have a ladder." });
await sleep(5000);
await call(staff.Haneul.j, 'POST', '/api/reports', { eventId: ev.id, zoneId: zid['Main Entrance'], category: 'crowd', urgency: 'caution', text: 'The line at the main entrance is getting long, about 40 people waiting.' });
await call(staff.Jimin.j, 'POST', '/api/reports', { eventId: ev.id, zoneId: zid['Food & Drinks'], category: 'facility', urgency: 'normal', text: 'Coffee machine on the left counter is out of order.' });
await sleep(4000);
console.log(`done · open ${BASE}/ops/${ev.id} · credentials in data/demo-credentials.json`);
