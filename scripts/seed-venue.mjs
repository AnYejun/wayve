// Seeds the live demo on the user's real venue: "SKKU Hackathon 2026" at Startup Branch (8 zones), through the real APIs.
// Usage: node scripts/seed-venue.mjs [baseUrl]
// Demo accounts get random passwords stored ONLY in data/demo-credentials.json (key "venue") — never printed.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { jar, client, sleep } from './lib.mjs';

const BASE = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '');
const here = path.dirname(fileURLToPath(import.meta.url));
const { call } = client(BASE);

const credFile = process.env.WAYVE_CREDS ? path.resolve(process.env.WAYVE_CREDS) : path.join(here, '..', 'data', 'demo-credentials.json');
fs.mkdirSync(path.dirname(credFile), { recursive: true });
const all = fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile, 'utf8')) : {};
const venue = (all.venue ??= {});
const suffix = (venue.suffix ??= randomBytes(3).toString('hex'));
venue.accounts ??= {};
const save = () => fs.writeFileSync(credFile, JSON.stringify(all, null, 2), { mode: 0o600 });

const warn = (r, what) => { if (r.status >= 300) console.warn(`  ! ${what} → ${r.status} ${r.json?.error?.code ?? ''} ${r.json?.error?.message ?? ''}`); return r; };

/** Sign up (or sign back in) a demo account on this jar. */
async function account(j, key, displayName) {
  const acc = (venue.accounts[key] ??= { username: `${key}-${suffix}`, password: randomBytes(12).toString('base64url'), displayName });
  save();
  let r = await call(j, 'POST', '/api/auth/signup', { username: acc.username, password: acc.password, displayName });
  if (r.status !== 200) r = await call(j, 'POST', '/api/auth/login', { username: acc.username, password: acc.password });
  if (r.status !== 200) throw new Error(`account ${key} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.user;
}

// ── 1. Organizer + event ─────────────────────────────────────────────────────────────────────────────────────────────
const org = jar();
await account(org, 'organizer', 'Yejun');
const ev = warn(await call(org, 'POST', '/api/events', { name: 'SKKU Hackathon 2026', templateId: 'demo' }), 'create event').json.event;
console.log(`event ${ev.id} · join code ${ev.joinCode}`);
venue.eventId = ev.id;
venue.joinCode = ev.joinCode;
save();

// ── 2. Real venue map: Startup Branch floor plan (2800×2400 px) + 8 zones matching the drawn rooms ─────────────────
const plan = fs.readFileSync(path.join(here, 'fixtures', 'startup-branch-plain.png'));
const up = warn(await call(org, 'POST', `/api/events/${ev.id}/map?kind=floorplan`, undefined, { data: plan, type: 'image/png' }), 'upload map');
console.log(`map ${up.json?.map?.width}×${up.json?.map?.height} · AI suggested ${up.json?.suggestions?.length ?? 0} areas`);
// Rooms are drawn in a 1400×1200 SVG rendered at 2× → polygons in PNG pixels.
const R = (x, y, w, h) => [[x * 2, y * 2], [(x + w) * 2, y * 2], [(x + w) * 2, (y + h) * 2], [x * 2, (y + h) * 2]];
const ZONES = [
  { name: 'Tiered Seating', polygon: R(70, 70, 1260, 230) },
  { name: 'Stage', polygon: R(70, 300, 1260, 110) },
  { name: 'Lounge A', polygon: R(250, 430, 270, 280) },
  { name: 'Lounge B', polygon: R(540, 430, 320, 280) },
  { name: 'Lounge C', polygon: R(880, 430, 270, 280) },
  { name: 'Entrance Lounge', polygon: R(250, 830, 610, 220) },
  { name: 'Coffee Corner', polygon: R(880, 940, 270, 200) },
  { name: 'Entrance', polygon: R(880, 830, 270, 100) },
];
const zr = warn(await call(org, 'PUT', `/api/events/${ev.id}/zones`, { zones: ZONES }), 'replace zones');
const zid = Object.fromEntries((zr.json?.zones ?? []).map((z) => [z.name, z.id]));
warn(await call(org, 'PATCH', `/api/events/${ev.id}/map`, { grid: { cols: 28, rows: 24 } }), 'grid');
console.log(`zones ${Object.keys(zid).length}: ${Object.keys(zid).join(', ')}`);

// ── 3. Teams + knowledge ─────────────────────────────────────────────────────────────────────────────────────────────
let snap = (await call(org, 'GET', `/api/events/${ev.id}/snapshot`)).json;
for (const name of ['HQ', 'Registration', 'Stage', 'Hospitality', 'Safety']) {
  if (!snap.teams.some((t) => t.name === name)) warn(await call(org, 'POST', `/api/events/${ev.id}/teams`, { name }), `team ${name}`);
}
snap = (await call(org, 'GET', `/api/events/${ev.id}/snapshot`)).json;
const team = Object.fromEntries(snap.teams.map((t) => [t.name, t.id]));

warn(await call(org, 'PUT', `/api/events/${ev.id}/knowledge`, { text: `SKKU Hackathon 2026 · Startup Branch, ground floor — run of show (KST)
09:00  Doors open. Check-in at the Entrance (08): badges, lanyards, T-shirts. Registration team.
10:00  Opening ceremony on the Stage (02). Audience in Tiered Seating (01).
10:30  Hacking starts. Teams 1–20 in Lounge A (03), 21–40 in Lounge B (04), 41–60 in Lounge C (05).
10:30–17:00  Coffee Corner (07) open. Refill cups and milk every hour.
12:00  Lunch boxes handed out in the Entrance Lounge (06).
14:00 and 16:00  Mentor rounds: mentors walk Lounges A → B → C, 20 minutes each.
18:00  Demo round one on the Stage; round two at 19:30. Judges sit in row 1 of Tiered Seating.
20:30  Awards on the Stage, then clean-up.
Wi-Fi: "StartupBranch-Guest" — password at the Registration desk.
First aid kit: Registration desk at the Entrance. AED next to the Coffee Corner.
Emergency: call 119 first, then radio HQ. Evacuation route: Walkway → Entrance (08).
Lost & found, power strips and extension cords: Registration desk.` }), 'knowledge');

// ── 4. Staff (accounts, teams, locations) ───────────────────────────────────────────────────────────────────────────
const people = [
  ['jimin', 'Jimin', 'Registration', 'Entrance'],
  ['minsu', 'Minsu', 'Stage', 'Stage'],
  ['haneul', 'Haneul', 'Safety', 'Lounge B'],
  ['seoyeon', 'Seoyeon', 'Hospitality', 'Coffee Corner'],
];
const staff = {};
for (const [key, name, t, zone] of people) {
  const j = jar();
  await account(j, key, name);
  const r = warn(await call(j, 'POST', '/api/join', { code: ev.joinCode, as: 'staff', teamId: team[t] }), `join ${name}`);
  const deviceId = r.json?.device?.id ?? r.json?.me?.deviceId;
  if (deviceId) warn(await call(j, 'PATCH', `/api/devices/${deviceId}`, { zoneId: zid[zone] }), `${name} location`);
  staff[name] = { j, deviceId };
}
save();
console.log(`staff: ${people.map((p) => `${p[1]} (${p[2]} @ ${p[3]})`).join(', ')}`);

// ── 5. Sensors: two fixed cameras + a meeting scribe, placed on the map ──────────────────────────────────────────────
const cams = {};
for (const [zone, label, pos] of [['Entrance', 'Entrance camera', [2260, 1700]], ['Lounge B', 'Lounge B camera', [1700, 900]]]) {
  const j = jar();
  const r = warn(await call(j, 'POST', '/api/join', { code: ev.joinCode, as: 'camera', zoneId: zid[zone] }), `camera ${zone}`);
  const id = r.json?.device?.id;
  if (id) {
    warn(await call(j, 'PATCH', `/api/devices/${id}`, { label, mode: 'observing' }), 'camera label');
    warn(await call(org, 'PUT', `/api/devices/${id}/position`, { position: pos }), 'camera position');
    await call(j, 'POST', `/api/devices/${id}/heartbeat`, { mode: 'observing' });
  }
  cams[zone] = { j, id };
}
let scribeId = null;
{
  const j = jar();
  const r = warn(await call(j, 'POST', '/api/join', { code: ev.joinCode, as: 'scribe', teamId: team.HQ }), 'scribe');
  scribeId = r.json?.device?.id ?? null;
  if (scribeId) warn(await call(org, 'PUT', `/api/devices/${scribeId}/position`, { position: [1200, 1940] }), 'scribe position');
}

// ── 5b. AI crew: personas bound to the cameras / scribe, plus event-level dispatcher and concierge ───────────────────
const crew = [
  { name: 'Entrance Watch', role: 'queue_watcher', deviceId: cams.Entrance?.id, zoneIds: [zid.Entrance], teamId: team.Registration,
    instructions: 'Watch the check-in line at the Entrance. Call Registration when more than 10 people wait or the line reaches the door.' },
  { name: 'Lounge Sentinel', role: 'safety_sentinel', deviceId: cams['Lounge B']?.id, zoneIds: [zid['Lounge B']], teamId: team.Safety,
    instructions: 'Watch Lounge B for blocked walkways, cables across paths, spilled drinks and overcrowding around the tables.' },
  { name: 'HQ Secretary', role: 'meeting_secretary', deviceId: scribeId, teamId: team.HQ },
  { name: 'Dispatcher', role: 'dispatcher' },
  { name: 'Concierge', role: 'concierge' },
];
for (const a of crew) warn(await call(org, 'POST', `/api/events/${ev.id}/agents`, { ...a, deviceId: a.deviceId ?? null }), `agent ${a.name}`);

// ── 6. Live activity: zone readings, radio, reports, a decision ─────────────────────────────────────────────────────
const manual = async (c, zone, body) => c?.id && warn(await call(c.j, 'POST', `/api/devices/${c.id}/manual`, { zoneId: zid[zone], ...body }), `reading ${zone}`);
await manual(cams.Entrance, 'Entrance', { crowdLevel: 'high', note: 'Check-in line out the door' });
await sleep(900);
await manual(cams['Lounge B'], 'Lounge B', { crowdLevel: 'high', note: 'Every table taken' });
await sleep(900);
const staffManual = async (name, zone, body) => staff[name]?.deviceId && warn(await call(staff[name].j, 'POST', `/api/devices/${staff[name].deviceId}/manual`, { zoneId: zid[zone], ...body }), `reading ${zone}`);
await staffManual('Seoyeon', 'Coffee Corner', { crowdLevel: 'moderate' });
await sleep(900);
await staffManual('Minsu', 'Stage', { crowdLevel: 'low' });
await sleep(900);
await staffManual('Haneul', 'Lounge A', { crowdLevel: 'moderate' });

const radio = async (j, to, text) => { warn(await call(j, 'POST', '/api/talk/text', { eventId: ev.id, to, text }), `radio "${text.slice(0, 30)}…"`); await sleep(6500); };
await radio(org, 'all', 'Jimin, please restock badges and lanyards at the Entrance by 10:30. Seoyeon, the Coffee Corner needs more cups before the 11 o\'clock break.');
await radio(staff.Minsu.j, 'hq', "Stage mic two keeps cutting out. I'm swapping the battery now.");
await radio(staff.Haneul.j, 'hq', 'Lounge B is packed, about forty people and no free tables. Can we open Lounge C for the overflow?');

const report = async (name, body) => { warn(await call(staff[name].j, 'POST', '/api/reports', { eventId: ev.id, ...body }), `report by ${name}`); await sleep(1200); };
const photo = `data:image/jpeg;base64,${fs.readFileSync(path.join(here, 'fixtures', 'scene.jpg')).toString('base64')}`;
await report('Seoyeon', { zoneId: zid['Coffee Corner'], category: 'facility', urgency: 'caution', text: 'The espresso machine is showing an error and stopped brewing.', photo });
await report('Jimin', { zoneId: zid.Entrance, category: 'supplies', urgency: 'normal', text: 'Running low on lanyards, maybe 30 left.' });
await report('Haneul', { zoneId: zid['Lounge B'], category: 'crowd', urgency: 'caution', text: 'Lounge B is over capacity, people are sitting on the floor near the planters.' });

await radio(org, 'all', "Decision: we'll open Lounge C for overflow from Lounge B, and demos will run in two rounds, the first at 6 PM on the Stage.");
await radio(staff.Jimin.j, 'hq', 'Badges and lanyards are restocked at the Entrance.');
await sleep(3000);

snap = (await call(org, 'GET', `/api/events/${ev.id}/snapshot`)).json;
console.log(`issues ${snap.issues.length} (${snap.issues.map((i) => `${i.key} ${i.status}`).join(', ')})`);
console.log(`reports ${snap.reports.length} · radio ${snap.messages.length} · zones with data ${snap.zones.filter((z) => z.lastObservedAt).length}/8 · devices ${snap.devices.length}`);
console.log(`done · ${BASE}/e/${ev.id}/dashboard · demo accounts in data/demo-credentials.json`);
