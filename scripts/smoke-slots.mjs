// Preset install slots: one scan sets a camera up with the slot's label and zone, and multi-zone spots get default regions
// (every zone it covers is read without calibration). Usage: node scripts/smoke-slots.mjs [baseUrl]
import { client, jar, ok } from './lib.mjs';
const BASE = process.argv[2] ?? 'http://localhost:8080';
const { call, signup } = client(BASE);

const org = jar();
await signup(org, 'Slots');
let r = await call(org, 'POST', '/api/events', { name: 'Slot Test', templateId: 'startup-branch' });
ok(r.status === 200, `preset event created (${r.status})`);
const ev = r.json.event;
const snap = (await call(org, 'GET', `/api/events/${ev.id}/snapshot`)).json;
const key = snap.joinKey ?? snap.event?.joinKey ?? ev.joinKey ?? null;
const zoneName = (id) => snap.zones.find((z) => z.id === id)?.name;
const scan = (slot) => call(jar(), 'POST', '/api/join', { code: ev.joinCode, as: 'camera', slot, key });

r = await scan('cam-seating');
const seat = r.json.device;
ok(r.status === 200 && seat?.label === 'Seating & stage', `camera takes the slot (${r.status} ${seat?.label ?? JSON.stringify(r.json)})`);
const regs = seat?.regions ?? [];
ok(regs.length === 2 && zoneName(regs[0].zoneId) === 'Tiered Seating' && zoneName(regs[1].zoneId) === 'Stage', `default regions: ${regs.map((x) => zoneName(x.zoneId)).join(' + ') || 'none'}`);
ok(seat?.zoneId === regs[0]?.zoneId, 'own zone = the primary zone');

r = await scan('cam-stage');
ok(r.status === 200 && r.json.device?.label === 'Stage demo spot' && (r.json.device?.regions ?? []).length === 0 && zoneName(r.json.device?.zoneId) === 'Stage', 'stage camera watches the Stage (single zone)');

r = await call(jar(), 'POST', '/api/join', { code: ev.joinCode, as: 'scribe', slot: 'scribe-stage', key });
ok(r.status === 200 && r.json.device?.label === 'Stage desk' && r.json.device?.deviceType === 'scribe', 'scribe takes the stage desk');

// An organizer's explicit single-zone choice is kept (stored as []), never re-filled by the preset.
r = await call(org, 'PUT', `/api/devices/${seat.id}/regions`, { regions: [] });
ok(r.status === 200 && r.json.device.regions.length === 0, 'organizer can reset to single-zone');
