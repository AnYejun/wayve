// v3 end-to-end with REAL models: field reports (photo / text / voice) + linking, floor plan → AI zones → PUT zones,
// blank canvas grid, camera regions + per-region frame, staff assistant (text, command, voice + speech), TTS.
// Usage: node scripts/smoke-v3.mjs [baseUrl] [floorplan.png]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const BASE = process.argv[2] ?? 'http://localhost:8080';
const fx = (n) => fs.readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)));
const PLAN = process.argv[3] ?? fileURLToPath(new URL('../data/fx3/plan.svg.png', import.meta.url));
const dataUrl = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;
const jar = () => { const c = new Map(); return { get: () => [...c].map(([k, v]) => `${k}=${v}`).join('; '), set: (h) => { for (const s of h) { const m = /^([^=]+)=([^;]*)/.exec(s); if (m) c.set(m[1], m[2]); } } }; };
async function call(j, method, path, body, raw) {
  const headers = { cookie: j.get() }; let b;
  if (raw) { b = raw.data; headers['content-type'] = raw.type; } else if (body) { b = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const t0 = Date.now(); const r = await fetch(BASE + path, { method, headers, body: b }); j.set(r.headers.getSetCookie?.() ?? []);
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, ms: Date.now() - t0, json: ct.includes('json') ? await r.json() : null, bytes: ct.includes('json') ? 0 : (await r.arrayBuffer()).byteLength };
}
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
const u = (s) => `${s}${Math.random().toString(36).slice(2, 7)}`;

const admin = jar(), jimin = jar(), minsu = jar(), cam = jar();
let r = await call(admin, 'POST', '/api/auth/signup', { username: u('hq'), password: 'password123', displayName: 'Dana' });
ok(r.status === 200 && r.json.user, `admin signup ${r.status}`);
r = await call(admin, 'POST', '/api/events', { name: 'v3 test', templateId: 'conference' });
ok(r.status === 200, `create event ${r.status}`);
const ev = r.json.event;
r = await call(jimin, 'POST', '/api/auth/signup', { username: u('jimin'), password: 'password123', displayName: 'Jimin' });
r = await call(jimin, 'POST', '/api/join', { code: ev.joinCode, as: 'staff' });
ok(r.status === 200, `jimin joined ${r.status} ${r.json?.error?.message ?? ''}`);
const jMe = r.json.me;
await call(minsu, 'POST', '/api/auth/signup', { username: u('minsu'), password: 'password123', displayName: 'Minsu' });
r = await call(minsu, 'POST', '/api/join', { code: ev.joinCode, as: 'staff' });
let snap = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
const zones = snap.zones;
const entrance = zones.find((z) => /lobby|entrance/i.test(z.name)) ?? zones[0];
const hall = zones.find((z) => /hall/i.test(z.name)) ?? zones[1];
console.log('  zones:', zones.map((z) => z.name).join(', '));

// ── reports ──
r = await call(jimin, 'POST', '/api/reports', { eventId: ev.id, zoneId: entrance.id, category: 'crowd', urgency: 'caution', text: 'Long queue forming at the entrance, maybe 20 people waiting.', photo: dataUrl(fx('scene.jpg'), 'image/jpeg') });
ok(r.status === 200 && r.json.report.issueKey, `report 1 (photo+text) ${r.ms}ms → ${r.json.report?.issueKey} "${r.json.report?.ai?.title}" · status ${r.json.report?.status} · photo ${!!r.json.report?.photoUrl}`);
if (r.json?.report?.ai) console.log('   ai:', JSON.stringify(r.json.report.ai));
const rep1 = r.json.report;
r = await call(minsu, 'POST', '/api/reports', { eventId: ev.id, zoneId: entrance.id, category: 'crowd', urgency: 'urgent', text: 'Entrance queue is getting longer, people are blocking the doors.' });
ok(r.status === 200 && r.json.report.issueId === rep1.issueId && r.json.report.linkedReports === 2, `report 2 links to same issue → ${r.json.report?.issueKey} (${r.json.report?.linkedReports} reports) priority ${r.json.issue?.priority}`);
r = await call(minsu, 'POST', '/api/reports', { eventId: ev.id, category: 'facility', urgency: 'normal', audio: dataUrl(fx('t2.wav'), 'audio/wav'), zoneId: hall.id });
ok(r.status === 200, `report 3 (voice) ${r.ms}ms → transcript "${r.json.report?.transcript}" · ${r.json.report?.issueKey} "${r.json.report?.ai?.title}"`);
r = await call(jimin, 'POST', '/api/reports', { eventId: ev.id, category: 'crowd', urgency: 'normal', text: 'Queue cleared now.', parentReportId: rep1.id });
ok(r.status === 200 && r.json.report.issueId === rep1.issueId, `follow-up (Add update) joins ${r.json.report?.issueKey}`);
r = await call(jimin, 'GET', `/api/reports?eventId=${ev.id}&mine=1`);
ok(r.status === 200 && r.json.reports.length === 2, `GET my reports → ${r.json.reports?.length}`);
r = await call(admin, 'GET', `/api/reports/${rep1.id}`);
ok(r.status === 200 && r.json.related.length >= 1, `GET report detail → related ${r.json.related?.length}, issue ${r.json.issue?.key}`);
r = await call(admin, 'PATCH', `/api/issues/${rep1.issueId}`, { status: 'in_progress' });
r = await call(admin, 'GET', `/api/reports/${rep1.id}`);
ok(r.json.report.status === 'reviewing' && r.json.report.statusAt.reviewing, `report status follows issue → ${r.json.report.status}`);
snap = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
ok(snap.reports.length === 4, `snapshot.reports = ${snap.reports.length}`);

// ── floor plan → AI zones → PUT zones ──
r = await call(admin, 'POST', `/api/events/${ev.id}/map?kind=floorplan`, null, { data: fs.readFileSync(PLAN), type: 'image/png' });
ok(r.status === 200 && r.json.map.imageUrl, `floor plan upload ${r.ms}ms → ${r.json.map?.width}×${r.json.map?.height}, ${r.json.suggestions?.length} suggestions ${r.json.aiError ?? ''}`);
for (const s of r.json.suggestions ?? []) console.log(`   ${s.name.padEnd(16)} ${JSON.stringify(s.polygon[0])}→${JSON.stringify(s.polygon[2])} (${Math.round(s.confidence * 100)}%)`);
const sugg = r.json.suggestions ?? [];
snap = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
ok(snap.event.map?.kind === 'floorplan', 'snapshot carries the map');
if (sugg.length) {
  const keep = snap.zones.slice(0, 2).map((z, i) => ({ id: z.id, name: sugg[i]?.name ?? z.name, polygon: sugg[i]?.polygon ?? z.polygon }));
  const add = sugg.slice(2).map((s) => ({ name: s.name, polygon: s.polygon }));
  r = await call(admin, 'PUT', `/api/events/${ev.id}/zones`, { zones: [...keep, ...add] });
  ok(r.status === 200 && r.json.zones.length === keep.length + add.length, `PUT zones → ${r.json.zones?.length} zones`);
}
const img = await fetch(BASE + (snap.event.map?.imageUrl ?? '/x'));
ok(img.status === 200, `map image served (${img.headers.get('content-type')})`);

// ── blank canvas ──
r = await call(admin, 'POST', '/api/events', { name: 'canvas test', templateId: 'demo' });
const ev2 = r.json.event;
r = await call(admin, 'PATCH', `/api/events/${ev2.id}/map`, { grid: { cols: 12, rows: 8 } });
ok(r.status === 200 && r.json.map.kind === 'schematic' && r.json.map.grid.cols === 12 && r.json.map.imageUrl === null, 'PATCH grid creates a blank canvas map');

// ── camera regions ──
snap = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
const z1 = snap.zones[0], z2 = snap.zones[1];
r = await call(cam, 'POST', '/api/join', { code: ev.joinCode, as: 'camera', zoneId: z1.id });
const dev = r.json.device;
r = await call(cam, 'POST', `/api/devices/${dev.id}/snapshot`, null, { data: fx('scene.jpg'), type: 'image/jpeg' });
ok(r.status === 200 && r.json.snapshotUrl, 'camera snapshot stored');
r = await call(admin, 'PUT', `/api/devices/${dev.id}/regions`, { regions: [
  { zoneId: z1.id, polygon: [[0, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]] }, { zoneId: z2.id, polygon: [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]] }] });
ok(r.status === 200 && r.json.device.regions.length === 2, 'regions saved');
r = await call(cam, 'POST', `/api/devices/${dev.id}/frames`, null, { data: fs.readFileSync(fileURLToPath(new URL('../data/fx3/s2.jpg', import.meta.url))), type: 'image/jpeg' });
ok(r.status === 200 && r.json.results?.length >= 1, `region frame ${r.ms}ms → ${r.json.results?.map((x) => `${x.zone.name}: ${x.observation.payload.crowd_level}/${x.observation.payload.people_count}`).join(' · ') ?? JSON.stringify(r.json)}`);

// ── assistant ──
await call(admin, 'PUT', `/api/events/${ev.id}/knowledge`, { text: 'Run of show: 13:00 doors open. 14:00 keynote in Main Hall. 16:30 awards. Medical team: Hana (010-1234-5678) at the Lobby.' });
r = await call(jimin, 'POST', '/api/assistant/turn', { eventId: ev.id, text: "What's happening at the entrance, and when is the keynote?" });
ok(r.status === 200, `assistant (text) ${r.ms}ms: ${r.json.answer}\n   citations: ${r.json.citations?.map((c) => c.label).join(', ')}`);
r = await call(jimin, 'POST', '/api/assistant/turn', { eventId: ev.id, text: `I'm handling ${rep1.issueKey} now, mark it in progress and assign it to me.` });
ok(r.status === 200, `assistant (command) → ${r.json.answer}\n   actions: ${JSON.stringify(r.json.actions)}`);
r = await call(jimin, 'POST', '/api/assistant/turn', { eventId: ev.id, audio: dataUrl(fx('t1.wav'), 'audio/wav'), speak: true });
ok(r.status === 200 && r.json.transcript, `assistant (voice+speak) ${r.ms}ms: heard "${r.json.transcript}" → ${r.json.answer} · speech ${r.json.speech ? Math.round(r.json.speech.length / 1024) + 'KB' : 'none'}`);
r = await call(jimin, 'POST', '/api/tts', { text: 'Entrance queue is under control.', eventId: ev.id });
ok(r.status === 200 && r.bytes > 1000, `TTS → ${r.bytes} bytes in ${r.ms}ms`);

console.log(failed ? `\n${failed} failed` : '\nall passed', `· event ${ev.id}`);
process.exitCode = failed ? 1 : 0;
