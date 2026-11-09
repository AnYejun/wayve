// Real-model check (needs OPENAI_API_KEY on the server): one real photo → vision observation, one text report,
// one attendee chat turn. Prints the actual model output so you can see it is real, not mocked.
// Usage: node scripts/smoke-ai.mjs [baseUrl] [image.jpg]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { client, jar } from './lib.mjs';
const BASE = process.argv[2] ?? 'http://localhost:8080';
const IMG = process.argv[3] ?? fileURLToPath(new URL('./fixtures/scene.jpg', import.meta.url));
const { call, signup } = client(BASE);
const admin = jar(), cam = jar(), staff = jar(), guest = jar();
await signup(admin, 'Organizer');
const ev = (await call(admin, 'POST', '/api/events', { name: 'AI check', templateId: 'conference' })).json.event;
const snap = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
console.log('ai:', snap.ai);
const zone = snap.zones.find((z) => z.name === 'Food court');
const c = (await call(cam, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'camera', zoneId: zone.id })).json;
await signup(staff, 'Sam');
const s = (await call(staff, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'staff' })).json;
let r = await call(cam, 'POST', `/api/devices/${c.device.id}/frames`, null, { data: fs.readFileSync(IMG), type: 'image/jpeg' });
console.log(`\nvision ${r.status} in ${r.ms}ms`, r.status === 200 ? { model: r.json.observation.model, latency: r.json.observation.latencyMs, payload: r.json.observation.payload, zone: r.json.zone.status } : r.json);
r = await call(staff, 'POST', `/api/devices/${s.me.deviceId}/report`, { text: 'Someone spilled a drink next to the tables in the food court, the floor is slippery', zoneId: zone.id });
console.log(`\nreport ${r.status} in ${r.ms}ms`, r.status === 200 ? { model: r.json.observation.model, payload: r.json.observation.payload, incidents: r.json.incidents.map((i) => `${i.incidentType}/${i.severity}`) } : r.json);
await call(guest, 'POST', '/api/join', { code: ev.joinCode, as: 'attendee' });
r = await call(guest, 'POST', '/api/chat', { message: 'There is water spilled on the food court floor, it is slippery' });
console.log(`\nchat ${r.status} in ${r.ms}ms`, r.status === 200 ? { reply: r.json.reply.text, model: r.json.reply.model, report: r.json.report } : r.json);
await new Promise((x) => setTimeout(x, 6000));
const after = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
for (const i of after.incidents) console.log(`\nincident ${i.incidentType} · evidence ${i.evidenceCount} (${i.modalities.join(', ')})`);
for (const t of after.tasks) console.log(`task "${t.title}" → ${t.stepsSource}:`, t.steps);
