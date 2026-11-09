// Ops tracker end-to-end with REAL audio + REAL models (needs OPENAI_API_KEY on the server).
// Scenario: the meeting scribe hears "Jimin, print 200 more badges by 2 PM; Minsu, check the stage lights" → issues auto-created
// and assigned; Jimin radios "the badges are all printed" (walkie clip kept) → done; Minsu reports being blocked → blocked;
// HQ asks the live DB; undo an AI change. Usage: node scripts/smoke-ops.mjs [baseUrl] [--ko]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { client, jar, ok, sleep } from './lib.mjs';

const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8080';
const KO = process.argv.includes('--ko');
const fx = (n) => fs.readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)));
const { call, signup } = client(BASE);
const admin = jar(), jimin = jar(), minsu = jar(), scribe = jar();
await signup(admin, 'Organizer');
const ev = (await call(admin, 'POST', '/api/events', { name: 'Ops meeting test', templateId: 'demo' })).json.event;
let snap = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
ok(snap.teams.length === 4, `default teams: ${snap.teams.map((t) => t.name).join(', ')}`);
const team = Object.fromEntries(snap.teams.map((t) => [t.name, t.id]));
await signup(jimin, KO ? '지민' : 'Jimin');
await signup(minsu, KO ? '민수' : 'Minsu');
const j = (await call(jimin, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'staff', teamId: team.Registration })).json;
const m = (await call(minsu, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'staff', teamId: team.Stage })).json;
const s = (await call(scribe, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'scribe', teamId: team.HQ })).json;
ok(j.me.displayName && s.device.deviceType === 'scribe', `joined: ${j.me.displayName}, ${m.me.displayName}, ${s.device.label}`);

const t0 = Date.now();
let r = await call(scribe, 'POST', `/api/devices/${s.device.id}/audio?startedAt=${t0 - 6000}&endedAt=${t0}&seq=1`, null, { data: fx(KO ? 'm1.wav' : 'm1_en.wav'), type: 'audio/wav' });
ok(r.status === 200 && r.json.utterance, `scribe → ${r.status} in ${r.ms}ms: "${r.json.utterance?.text ?? JSON.stringify(r.json)}"`);
let issues = [];
for (let i = 0; i < 30 && issues.length < 2; i++) { await sleep(1000); issues = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json.issues; }
const name = (id, sn) => sn.participants.find((p) => p.id === id)?.displayName ?? null;
snap = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
for (const i of snap.issues) console.log(`   ${i.key} [${i.status}/${i.priority}] ${i.title} · owner ${name(i.assigneeId, snap) ?? (i.assigneeHint ? `unassigned (mentioned ${i.assigneeHint})` : 'unassigned')} · team ${snap.teams.find((t) => t.id === i.teamId)?.name ?? '-'} · due ${i.dueAt ? new Date(i.dueAt).toLocaleTimeString('en-US', { timeZone: 'Asia/Seoul' }) : '-'} · by ${i.createdBy}`);
for (const p of snap.proposals) console.log(`   suggestion: ${p.summary} (${Math.round(p.confidence * 100)}%)`);
const badge = snap.issues.find((i) => /badge|명찰/i.test(i.title));
const light = snap.issues.find((i) => /light|조명/i.test(i.title));
ok(badge && badge.assigneeId === j.me.participantId, `meeting → badge issue assigned to ${j.me.displayName}`);
ok(light && light.assigneeId === m.me.participantId, `meeting → stage-light issue assigned to ${m.me.displayName}`);
ok(badge && /^[\x00-\x7F]+$/.test(badge.title), `issue title in English: "${badge?.title}"`);
ok(snap.utterances[0]?.issueKeys?.length >= 1, `utterance linked to ${snap.utterances[0]?.issueKeys?.join(', ')}`);

r = await call(jimin, 'POST', `/api/talk?to=hq&eventId=${ev.id}&durationMs=1800`, null, { data: fx(KO ? 't1.wav' : 't1_en.wav'), type: 'audio/wav' });
ok(r.status === 200 && r.json.message.audioUrl?.startsWith('/media/radio/') && r.json.message.durationMs === 1800, `${j.me.displayName} radio → HQ: "${r.json.message?.text}" (clip ${r.json.message?.audioUrl ? 'kept' : 'missing'})`);
const msgId = r.json.message?.id;
const clip = await fetch(BASE + r.json.message.audioUrl);
ok(clip.status === 200 && (await clip.arrayBuffer()).byteLength > 1000, 'walkie clip is downloadable');
r = await call(minsu, 'POST', `/api/talk?to=hq&eventId=${ev.id}`, null, { data: fx(KO ? 't2.wav' : 't2_en.wav'), type: 'audio/wav' });
ok(r.status === 200, `${m.me.displayName} radio → HQ: "${r.json.message?.text}"`);
for (let i = 0; i < 25; i++) {
  await sleep(1000);
  snap = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json;
  const b = snap.issues.find((x) => x.id === badge?.id), l = snap.issues.find((x) => x.id === light?.id);
  if (b?.status === 'done' && l?.status === 'blocked') break;
}
const b2 = snap.issues.find((x) => x.id === badge?.id), l2 = snap.issues.find((x) => x.id === light?.id);
ok(b2?.status === 'done', `"all printed" → ${b2?.key} ${b2?.status}`);
ok(l2?.status === 'blocked', `"no ladder" → ${l2?.key} ${l2?.status}`);
for (const p of snap.proposals) console.log(`   suggestion: ${p.summary} (${Math.round(p.confidence * 100)}%) ${p.status}`);

r = await call(admin, 'POST', `/api/messages/${msgId}/ack`, {});
ok(r.status === 200 && r.json.message.acks.length === 1, 'HQ acks the radio message');
r = await call(admin, 'POST', '/api/ask', { question: 'Is anything blocked right now? Who needs to act?', eventId: ev.id });
ok(r.status === 200 && /[a-z]{3,}/i.test(r.json.answer ?? '') && (KO || !/[가-힣]/.test(r.json.answer ?? '')), `ask (${r.ms}ms): ${r.json.answer}\n   citations: ${r.json.citations?.map((c) => c.label).join(', ')}`);

const tl = (await call(admin, 'GET', `/api/issues/${badge.id}/timeline`)).json;
console.log('   timeline', badge.key, tl.events.map((e) => `${e.kind}:${e.from ?? ''}→${e.to ?? ''}(${e.actorName}${e.undoable ? ',undoable' : ''})`).join(' | '));
const undoable = tl.events.find((e) => e.undoable && e.kind === 'status');
if (undoable) {
  r = await call(admin, 'POST', `/api/issue-events/${undoable.id}/undo`, {});
  ok(r.status === 200 && r.json.issue.status !== 'done', `undo AI "done" → ${r.json.issue?.status}`);
}
r = await call(admin, 'GET', `/api/events/${ev.id}/data/utterances`);
ok(r.status === 200 && r.json.total >= 3, `data/utterances: ${r.json.total} rows`);
console.log(`\n${process.exitCode ? 'FAILED' : 'All good'} · event ${ev.id} · code ${ev.joinCode}`);
