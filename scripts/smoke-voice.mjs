// Real speech-to-text check: a Korean voice clip → /voice → transcript + structured report. Usage: node scripts/smoke-voice.mjs [baseUrl]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { client, jar } from './lib.mjs';
const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8080';
const { call, signup } = client(BASE);
const admin = jar(), staff = jar();
await signup(admin, 'Organizer');
const KO = process.argv.includes('--ko');
const ev = (await call(admin, 'POST', '/api/events', { name: 'Voice check', templateId: 'conference' })).json.event;
await signup(staff, 'Sam');
const s = (await call(staff, 'POST', '/api/join', { code: ev.joinCode, as: 'staff' })).json;
const audio = fs.readFileSync(fileURLToPath(new URL(KO ? './fixtures/report.m4a' : './fixtures/report_en.m4a', import.meta.url)));
const zones = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json.zones;
const hall = zones.find((z) => z.name === 'Main hall');
const r = await call(staff, 'POST', `/api/devices/${s.me.deviceId}/voice?zoneId=${process.env.NOZONE ? '' : hall.id}`, null, { data: audio, type: 'audio/mp4' });
console.log(`voice ${r.status} in ${r.ms}ms`, r.status === 200 ? { model: r.json.observation.model, payload: r.json.observation.payload, zone: r.json.zone.name, status: r.json.zone.status, incidents: r.json.incidents.map((i) => `${i.incidentType}/${i.severity}`) } : r.json);
