// Phone v4 smoke: chat attachments become reports (photos[] + category/urgency 'auto' chosen by the model), and a swipe-left
// decline hands the assignment to someone else within seconds — never back to whoever declined.
// Usage: node scripts/smoke-v4.mjs [baseUrl]   (the report part needs AI; without it the fallback path is checked)
import fs from 'node:fs';
import { client, jar, ok, sleep } from './lib.mjs';

const BASE = process.argv[2] ?? 'http://localhost:8080';
const { call, signup } = client(BASE);
const CATEGORIES = ['crowd', 'facility', 'supplies', 'safety', 'medical', 'other'];
const URGENCIES = ['normal', 'caution', 'urgent'];

const admin = jar(), ariJar = jar(), boJar = jar();
await signup(admin, 'Vic');
let r = await call(admin, 'POST', '/api/events', { name: 'Smoke v4', templateId: 'demo' });
ok(r.status === 200, `event created (code ${r.json.event?.joinCode})`);
const ev = r.json.event;
r = await call(admin, 'GET', `/api/events/${ev.id}/snapshot`);
const zone = r.json.zones[0];
const teams = Object.fromEntries(r.json.teams.map((t) => [t.name, t.id]));
const aiOn = !!r.json.ai?.enabled;

r = await call(ariJar, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'staff', name: 'Ari', teamId: teams.Stage });
const ari = r.json.me;
r = await call(boJar, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'staff', name: 'Bo', teamId: teams.Stage });
const bo = r.json.me;
ok(ari?.participantId && bo?.participantId, 'two Stage staff joined by QR (Ari, Bo)');
await call(ariJar, 'PATCH', `/api/devices/${ari.deviceId}`, { zoneId: zone.id });
await call(boJar, 'PATCH', `/api/devices/${bo.deviceId}`, { zoneId: zone.id });

// ── 1. Chat attachments → report ─────────────────────────────────────────────────────────────────────────────────────
const jpg = 'data:image/jpeg;base64,' + fs.readFileSync(new URL('./fixtures/scene.jpg', import.meta.url)).toString('base64');
let t = Date.now();
r = await call(ariJar, 'POST', '/api/reports', { eventId: ev.id, zoneId: zone.id, category: 'auto', urgency: 'auto', text: null, photos: [jpg, jpg] });
const rep = r.json.report;
ok(r.status === 200 && !!rep?.id, `photos[] ×2, no text, category/urgency auto → report (${Date.now() - t} ms)`);
ok(CATEGORIES.includes(rep?.category) && URGENCIES.includes(rep?.urgency), `auto resolved → ${rep?.category} · ${rep?.urgency}`);
ok(!!rep?.photoUrl, 'first photo stored on the report');
if (aiOn) ok(!!rep?.ai?.title && rep.ai.title.length > 3, `model titled it from the images: “${rep?.ai?.title}”`);
ok(!!r.json.issue?.id, `linked issue ${r.json.issue?.key ?? ''}`);

r = await call(ariJar, 'POST', '/api/reports', { eventId: ev.id, category: 'auto', urgency: 'auto', photos: [jpg, jpg, jpg, jpg, jpg] });
ok(r.status === 400, '5 photos → 400');
r = await call(ariJar, 'POST', '/api/reports', { eventId: ev.id, category: 'auto', urgency: 'auto', photos: ['data:text/plain;base64,aGVsbG8='] });
ok(r.status === 400 && r.json.error?.code === 'BAD_PHOTO', 'non-image attachment → 400 BAD_PHOTO');
await sleep(1300); // reports are rate-limited per person (1.2 s)
r = await call(ariJar, 'POST', '/api/reports', { eventId: ev.id, category: 'auto', urgency: 'auto', text: '  ' });
ok(r.status === 400, `nothing attached → 400 (${r.status})`);
await sleep(1300);
// A chat report sent from one zone that names another lands in the named zone (where you are is only the fallback).
{
  const snapZ = (await call(ariJar, 'GET', `/api/events/${ev.id}/snapshot`)).json.zones;
  const here = snapZ[0], named = snapZ.find((z2) => z2.id !== here.id);
  const rr = await call(ariJar, 'POST', '/api/reports', { eventId: ev.id, hereZoneId: here.id, category: 'auto', urgency: 'auto', text: `Spilled drinks in the ${named.name}, the floor is slippery` });
  ok(rr.status === 200 && rr.json.report.zoneId === named.id, `chat report names ${named.name} while the reporter is in ${here.name} → ${snapZ.find((z2) => z2.id === rr.json.report?.zoneId)?.name ?? rr.status}`);
  const r2 = await call(ariJar, 'POST', '/api/reports', { eventId: ev.id, hereZoneId: here.id, category: 'auto', urgency: 'auto', text: 'The bin here is overflowing' });
  ok(r2.status === 200 && r2.json.report.zoneId === here.id, `no place named → the reporter's zone (${here.name})`);
}
r = await call(ariJar, 'POST', '/api/reports', { eventId: ev.id, zoneId: zone.id, category: 'facility', urgency: 'normal', text: 'Water spilled by the stage steps', photo: jpg });
ok(r.status === 200 && r.json.report?.category === 'facility' && r.json.report?.urgency === 'normal' && !!r.json.report?.photoUrl,
  'single photo + explicit category/urgency still work (kept as sent)');

if (aiOn) {
  t = Date.now();
  r = await call(boJar, 'POST', '/api/assistant/turn', { eventId: ev.id, text: 'What is in this photo? One sentence.', images: [jpg] });
  ok(r.status === 200 && (r.json.answer ?? '').length > 5, `assistant reads an attached image (${Date.now() - t} ms): “${(r.json.answer ?? r.json.error?.message ?? '').slice(0, 80)}”`);
  await sleep(1300);
  r = await call(boJar, 'POST', '/api/assistant/turn', { eventId: ev.id, images: ['data:text/plain;base64,aGVsbG8='] });
  ok(r.status === 400 && r.json.error?.code === 'BAD_PHOTO', 'assistant: non-image attachment → 400');
}

// ── 2. Decline → the dispatcher re-offers to someone else ──────────────────────────────────────────────────────────────
r = await call(admin, 'POST', `/api/events/${ev.id}/agents`, { name: 'Dispatch', role: 'dispatcher' });
ok(r.status === 200, 'dispatcher on duty');
r = await call(admin, 'POST', `/api/events/${ev.id}/issues`, { title: 'Move 20 chairs to the stage', kind: 'task', priority: 'p1', teamId: teams.Stage });
ok(r.status === 200 && !!r.json.issue?.id, `task ${r.json.issue?.key} for Stage`);
const issueId = r.json.issue.id;
const owner = async () => (await call(admin, 'GET', `/api/issues/${issueId}/timeline`)).json.issue?.assigneeId ?? null;

let first = null;
t = Date.now();
while (Date.now() - t < 30_000 && !(first = await owner())) await sleep(500);
const ids = { [ari.participantId]: 'Ari', [bo.participantId]: 'Bo' };
ok(!!ids[first], `dispatcher assigned it to ${ids[first] ?? first} (${((Date.now() - t) / 1000).toFixed(1)} s, includes the 12 s grace)`);
const [ownerJar, otherJar, otherId] = first === ari.participantId ? [ariJar, boJar, bo.participantId] : [boJar, ariJar, ari.participantId];

r = await call(otherJar, 'POST', `/api/issues/${issueId}/decline`, { reason: 'not mine' });
ok(r.status === 403, 'someone else cannot decline it (403)');
r = await call(ownerJar, 'POST', `/api/issues/${issueId}/decline`, { reason: 'At the registration desk' });
ok(r.status === 200 && r.json.issue?.assigneeId === null, 'assignee declines → unassigned');
r = await call(admin, 'GET', `/api/issues/${issueId}/timeline`);
ok((r.json.events ?? []).some((e) => e.kind === 'assignee' && /^Declined — At the registration desk/.test(e.to ?? '')), 'timeline reads “Declined — At the registration desk”');

let next = null;
t = Date.now();
while (Date.now() - t < 10_000 && !(next = await owner())) await sleep(300);
const took = (Date.now() - t) / 1000;
ok(next === otherId, `re-offered to ${ids[next] ?? next} — not the decliner (${took.toFixed(1)} s)`);
ok(took <= 6, 're-offer within ~5 s');

// The second person passes too → nobody left on the team: it must stay open rather than bounce back to a decliner.
r = await call(otherJar, 'POST', `/api/issues/${issueId}/decline`, {});
ok(r.status === 200 && r.json.issue?.assigneeId === null, 'second assignee declines (no reason)');
await sleep(6_000);
ok((await owner()) === null, 'after everyone declined it stays unassigned (no bounce back)');
r = await call(ownerJar, 'POST', `/api/issues/${issueId}/decline`, {});
ok(r.status === 400, 'declining an unassigned issue → 400');

console.log(process.exitCode ? 'SMOKE V4 FAILED' : 'SMOKE V4 OK');
