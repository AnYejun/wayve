// Korean / English: the attendee chatbot and the staff assistant answer in the user's language, from the event info that
// ships with the Startup Branch preset (c0mpiled-17: Seoul). Real models. Usage: node scripts/smoke-lang.mjs [baseUrl]
import { client, jar, ok } from './lib.mjs';
const BASE = process.argv[2] ?? 'http://localhost:8080';
const { call, signup } = client(BASE);
const hangul = (s) => { const l = (s.match(/[A-Za-z가-힣]/g) ?? []).length; return l ? (s.match(/[가-힣]/g) ?? []).length / l : 0; };

const org = jar();
await signup(org, 'Lang');
let r = await call(org, 'POST', '/api/events', { name: 'compiled:17', templateId: 'startup-branch' });
const ev = r.json.event;
r = await call(org, 'GET', `/api/events/${ev.id}/knowledge`);
ok(r.status === 200 && r.json.text.includes('c0mpiled-17: Seoul') && r.json.text.includes('Build session') && r.json.updatedAt, 'preset event info is the event knowledge (visible in Settings)');
const key = ev.joinKey ?? (await call(org, 'GET', `/api/events/${ev.id}/snapshot`)).json.joinKey;

const guest = jar();
r = await call(guest, 'POST', '/api/join', { code: ev.joinCode, as: 'attendee' });
ok(r.status === 200, `attendee joins with the poster code (${r.status})`);
const ask = async (message) => { const x = await call(guest, 'POST', '/api/chat', { message, eventId: ev.id }); return { status: x.status, reply: x.json.reply?.text ?? x.json.reply ?? x.json.message?.text ?? JSON.stringify(x.json) }; };
let a = await ask('점심은 언제 나와요?');
ok(a.status === 200 && hangul(String(a.reply)) > 0.5, `Korean question → Korean answer: ${String(a.reply).slice(0, 90)}`);
await new Promise((res) => setTimeout(res, 1600));
a = await ask('When is the submission deadline and what do we submit?');
ok(a.status === 200 && hangul(String(a.reply)) === 0 && /3(:00)?\s*PM|15:00/i.test(String(a.reply)), `English question → English answer with the 3 PM deadline: ${String(a.reply).slice(0, 90)}`);
await new Promise((res) => setTimeout(res, 1600));
a = await ask('와이파이 이름이 뭐예요?');
ok(a.status === 200 && /c0mpiled/i.test(String(a.reply)) && hangul(String(a.reply)) > 0.3, `Wi-Fi answered from the event info: ${String(a.reply).slice(0, 90)}`);

const staff = jar();
r = await call(staff, 'POST', '/api/join', { code: ev.joinCode, as: 'staff', name: 'Mina', key });
ok(r.status === 200, `staff joins with the key (${r.status})`);
r = await call(staff, 'POST', '/api/assistant/turn', { eventId: ev.id, text: '오늘 심사위원 누구예요?' });
ok(r.status === 200 && (r.json.answer ?? '').match(/[가-힣]/g)?.length > 8 && /Daniel Park|Jon Xu|Peter Shin/.test(r.json.answer ?? ''), `staff assistant answers in Korean: ${String(r.json.answer).slice(0, 90)}`);
await new Promise((res) => setTimeout(res, 1300));
r = await call(staff, 'POST', '/api/assistant/turn', { eventId: ev.id, text: 'What is first prize?' });
ok(r.status === 200 && hangul(r.json.answer ?? '') === 0 && /3,?000,?000|Jon Xu/i.test(r.json.answer ?? ''), `staff assistant answers in English: ${String(r.json.answer).slice(0, 90)}`);
