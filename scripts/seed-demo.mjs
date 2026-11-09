// Feeds a venue with MANUAL observations (labelled "Manual", never presented as AI output) to check the UI.
// Usage: JOIN_KEY=<key> node scripts/seed-demo.mjs <JOIN_CODE> [baseUrl]
import { client, jar } from './lib.mjs';
const [code, BASE = 'http://localhost:8080'] = process.argv.slice(2);
const JOIN_KEY = process.env.JOIN_KEY ?? null; // organizer's join key (Snapshot.joinKey) — needed for camera/staff joins
const { call, signup } = client(BASE);
const pv = await call(jar(), 'GET', `/api/join/${code}`);
const zones = Object.fromEntries(pv.json.zones.map((z) => [z.name, z.id]));
const names = Object.keys(zones);
const cam1 = jar(), cam2 = jar(), staff = jar(), staff2 = jar();
const c1 = (await call(cam1, 'POST', '/api/join', { code, key: JOIN_KEY, as: 'camera', zoneId: zones[names[3]] })).json;
const c2 = (await call(cam2, 'POST', '/api/join', { code, key: JOIN_KEY, as: 'camera', zoneId: zones[names[5]] })).json;
await signup(staff, 'Sam');
await signup(staff2, 'Riley');
const s1 = (await call(staff, 'POST', '/api/join', { code, key: JOIN_KEY, as: 'staff' })).json;
await call(staff2, 'POST', '/api/join', { code, key: JOIN_KEY, as: 'staff' });
await call(staff, 'PATCH', `/api/devices/${s1.me.deviceId}`, { zoneId: zones[names[5]] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await call(cam1, 'POST', `/api/devices/${c1.device.id}/manual`, { crowdLevel: 'high', note: 'Rush right before the keynote' }); await wait(900);
await call(cam2, 'POST', `/api/devices/${c2.device.id}/manual`, { crowdLevel: 'moderate' }); await wait(900);
await call(cam2, 'POST', `/api/devices/${c2.device.id}/manual`, { issueType: 'spill', note: 'Drink spilled on the floor' }); await wait(900);
await call(staff, 'POST', `/api/devices/${s1.me.deviceId}/manual`, { issueType: 'spill', note: 'Floor by the tables is slippery' });
await call(cam1, 'POST', `/api/devices/${c1.device.id}/heartbeat`, { mode: 'observing' });
console.log('seeded', { zones: names, camera: [c1.device.label, c2.device.label], staff: s1.me.displayName });
