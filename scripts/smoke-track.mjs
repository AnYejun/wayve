// Zone tracking end-to-end with the REAL vision model: zone types, v2 vision payloads, smoothing/hysteresis via the tracker,
// human floor, multi-region camera, metric series. Usage: node scripts/smoke-track.mjs [baseUrl]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { client, jar, ok, sleep } from './lib.mjs';

const BASE = process.argv[2] ?? 'http://localhost:8080';
const { call, signup } = client(BASE);
const img = fs.readFileSync(fileURLToPath(new URL('./fixtures/scene.jpg', import.meta.url)));
const admin = jar(), cam = jar();
await signup(admin, 'Organizer');
const ev = (await call(admin, 'POST', '/api/events', { name: 'Tracking test', templateId: 'demo' })).json.event;
let snap = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
const byName = Object.fromEntries(snap.zones.map((z) => [z.name, z]));
ok(snap.zones.every((z) => z.zoneType), `zone types inferred: ${snap.zones.map((z) => `${z.name}=${z.zoneType}`).join(', ')}`);
const entrance = snap.zones.find((z) => z.zoneType === 'entrance') ?? snap.zones[0];
const other = snap.zones.find((z) => z.id !== entrance.id);
const j = (await call(cam, 'POST', '/api/join', { code: ev.joinCode, as: 'camera', zoneId: entrance.id })).json;
ok(!!j.device, `camera joined → ${entrance.name}`);

for (let i = 0; i < 3; i++) {
  const r = await call(cam, 'POST', `/api/devices/${j.device.id}/frames`, null, { data: img, type: 'image/jpeg' });
  const p = r.json.observation?.payload;
  ok(r.status === 200 && p?.v === 2 && r.json.zone?.track, `frame ${i + 1} → ${r.status} in ${r.ms}ms · v${p?.v} view=${p?.view} cert=${p?.certainty} conf=${r.json.observation?.confidence} · usable=${r.json.zone?.track?.nUsable} tier=${r.json.zone?.track?.tier} status=${r.json.zone?.status} · "${p?.summary}"`);
  await sleep(800);
}

// Human floor: manual 'critical' on another zone (no camera there) sets the tier both ways.
let r = await call(cam, 'POST', `/api/devices/${j.device.id}/manual`, { zoneId: other.id, crowdLevel: 'critical' });
ok(r.status === 200 && r.json.zone.track?.tier === 3 && r.json.zone.status !== 'clear', `manual critical on ${other.name} → tier ${r.json.zone.track?.tier} status ${r.json.zone.status} · action "${r.json.zone.track?.action?.text}" · reason "${r.json.zone.statusReason}"`);

// Zone type change resets the window.
r = await call(admin, 'PATCH', `/api/zones/${other.id}`, { zoneType: 'lounge' });
ok(r.status === 200 && r.json.zone.zoneType === 'lounge' && r.json.zone.track === null, `PATCH zoneType → ${r.json.zone?.zoneType}, track reset`);

// Multi-region camera: two regions on the same frame → one observation per zone.
r = await call(admin, 'PUT', `/api/devices/${j.device.id}/regions`, { regions: [
  { zoneId: entrance.id, polygon: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] },
  { zoneId: other.id, polygon: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] },
] });
ok(r.status === 200 && r.json.device.regions.length === 2, 'regions set (2 zones)');
await sleep(1200);
r = await call(cam, 'POST', `/api/devices/${j.device.id}/frames`, null, { data: img, type: 'image/jpeg' });
ok(r.status === 200 && r.json.results?.length === 2 && r.json.results.every((x) => x.observation.payload.v === 2), `region frame → ${r.status} in ${r.ms}ms · ${r.json.results?.map((x) => `${x.zone.name}: ${x.observation.payload.view}/${x.observation.payload.crowd_level}/${x.observation.payload.people_count}`).join(' · ')}`);

const s = (await call(admin, 'GET', `/api/events/${ev.id}/zone-series?mins=30`)).json;
const n = Object.values(s.series ?? {}).reduce((a, x) => a + x.length, 0);
ok(s.resMs === 30000 && n >= 2, `zone-series → ${Object.keys(s.series ?? {}).length} zones, ${n} buckets, first ${JSON.stringify(Object.values(s.series)[0]?.[0])}`);
snap = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
const e2 = snap.zones.find((z) => z.id === entrance.id);
ok(e2.track && e2.track.sources.length >= 1, `snapshot zone track: tier ${e2.track?.tier}, conf ${e2.track?.conf}, sources ${e2.track?.sources.map((x) => x.label).join(', ')}`);
console.log(`\nevent ${ev.id} (${byName ? 'ok' : ''})`);
