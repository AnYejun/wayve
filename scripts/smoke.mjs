// End-to-end API smoke: an organizer signs up and creates an event → camera joins by QR, staff sign up + join →
// observations → incident → task → resolve; auth, walkie, live data + CSV, knowledge, device position.
// Usage: node scripts/smoke.mjs [baseUrl]   (no AI needed: uses manual observations; AI paths must report honestly)
import { client, jar, ok, sleep } from './lib.mjs';

const BASE = process.argv[2] ?? 'http://localhost:8080';
const { call, signup } = client(BASE);

const admin = jar(), cam = jar(), staff = jar(), outsider = jar(), anon = jar();

// accounts
let r = await call(anon, 'POST', '/api/events', { name: 'No login', templateId: 'demo' });
ok(r.status === 401 && r.json.error.code === 'NEEDS_LOGIN', 'creating an event needs login (401)');
const { username: adminUser } = await signup(admin, 'Ava');
r = await call(admin, 'GET', '/api/auth/me');
ok(r.status === 200 && r.json.user?.username === adminUser && !JSON.stringify(r.json).includes('scrypt'), `auth/me → ${r.json.user?.displayName} (no hash leaked)`);
r = await call(anon, 'POST', '/api/auth/login', { username: adminUser, password: 'wrong-password' });
ok(r.status === 401 && r.json.error.message === 'Wrong username or password.', 'wrong password → 401');
r = await call(anon, 'POST', '/api/auth/signup', { username: adminUser, password: 'whatever-123', displayName: 'Dup' });
ok(r.status === 409, 'duplicate username → 409');

r = await call(admin, 'POST', '/api/events', { name: 'Smoke test', templateId: 'demo' });
ok(r.status === 200 && r.json.event.joinCode && r.json.me.displayName === 'Ava', `create event (code ${r.json.event?.joinCode}) as Ava`);
const ev = r.json.event;
r = await call(admin, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.status === 200 && r.json.zones.length === 3 && r.json.me.role === 'admin', `admin snapshot: zones ${r.json.zones.map((z) => z.name).join(', ')}`);
ok(r.json.teams.map((t) => t.name).join(',') === 'HQ,Registration,Stage,Safety', `default teams: ${r.json.teams.map((t) => t.name).join(', ')}`);
const zone = r.json.zones[0];
const zoneList = r.json.zones;
const teams = Object.fromEntries(r.json.teams.map((t) => [t.name, t.id]));
console.log('  ai:', JSON.stringify(r.json.ai));
r = await call(admin, 'GET', '/api/auth/me');
ok(r.json.events.some((e) => e.event.id === ev.id && e.role === 'admin'), 'auth/me lists my event as admin');

r = await call(outsider, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.status === 401, 'outsider blocked (401)');

r = await call(cam, 'GET', `/api/join/${ev.joinCode}`);
ok(r.status === 200 && r.json.zones.length === 3, 'join preview');
r = await call(cam, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'camera', zoneId: zone.id });
ok(r.status === 200 && r.json.device.zoneId === zone.id && r.json.me.role === 'camera', `camera joined → ${r.json.device?.label}`);
const camDev = r.json.device;
// The attendee poster code alone must not join as staff or as a device: those links carry the organizer's join key.
ok(typeof ev.joinKey === 'string' && ev.joinKey.length >= 8, 'organizer gets the join key at event creation');
r = await call(jar(), 'POST', '/api/join', { code: ev.joinCode, as: 'staff', name: 'Mallory' });
ok(r.status === 403 && r.json.error?.code === 'NEEDS_STAFF_LINK', 'staff join without the join key → 403');
r = await call(jar(), 'POST', '/api/join', { code: ev.joinCode, as: 'camera', zoneId: zone.id });
ok(r.status === 403, 'camera join without the join key → 403');
r = await call(jar(), 'POST', '/api/join', { code: ev.joinCode, key: 'wrong-key-00', as: 'scribe' });
ok(r.status === 403, 'scribe join with a wrong key → 403');
r = await call(jar(), 'POST', '/api/events/join-by-code', { code: ev.joinCode, as: 'staff', name: 'Mallory' });
ok(r.status === 403, 'join-by-code without the join key → 403');
r = await call(cam, 'POST', '/api/join', { code: ev.joinCode, as: 'camera', zoneId: zone.id });
ok(r.status === 200 && r.json.device.id === camDev.id, 'a joined camera re-scans without the key');
r = await call(cam, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.status === 200 && !r.json.joinKey && r.json.messages.length === 0 && r.json.reports.length === 0 && r.json.activity.length === 0
  && r.json.participants.every((p) => p.id === r.json.me.participantId) && r.json.crew.every((a) => !a.instructions), 'camera gets a device view (no radio, people, prompts or join key)');
r = await call(admin, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.json.joinKey === ev.joinKey, 'admin snapshot carries the join key');

// QR-only staff: no account — a name (+ team) is enough for radio, reports and the live event.
const qr = jar();
r = await call(qr, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'staff', name: 'Dana', teamId: teams.Registration });
ok(r.status === 200 && r.json.me.role === 'staff' && r.json.me.displayName === 'Dana' && r.json.device?.deviceType === 'reporter', 'QR-only staff joins without an account (name + team)');
const qrMe = r.json.me;
r = await call(qr, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'staff', name: 'Dana K' });
ok(r.status === 200 && r.json.me.participantId === qrMe.participantId && r.json.me.displayName === 'Dana K', 're-scan reuses the same phone identity (and renames)');
r = await call(qr, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.status === 200 && r.json.me.role === 'staff', 'QR-only staff opens the live event');
r = await call(qr, 'POST', '/api/talk/text', { eventId: ev.id, to: 'team:' + teams.Registration, text: 'Dana here, radio check from the entrance.' });
ok(r.status === 200 && r.json.message?.fromName === 'Dana K', 'QR-only staff can use the radio');
r = await call(qr, 'POST', `/api/devices/${qrMe.deviceId}/manual`, { zoneId: zoneList[2].id, crowdLevel: 'low', note: 'radio check' });
ok(r.status === 200, 'QR-only staff can send a field observation');
r = await call(qr, 'POST', '/api/events', { name: 'Not allowed', templateId: 'demo' });
ok(r.status === 401, 'QR-only staff cannot create events (dashboards need login)');
r = await call(qr, 'GET', `/api/events/${ev.id}/data/issues`);
ok(r.status === 403, 'QR-only staff cannot open the organizer database (403)');

await signup(staff, 'Sam');
r = await call(staff, 'POST', '/api/join', { code: ev.joinCode, key: ev.joinKey, as: 'staff', name: 'ignored', teamId: teams.Registration });
ok(r.status === 200 && r.json.me.role === 'staff' && r.json.me.displayName === 'Sam', `staff joined → ${r.json.me?.displayName} (name from account)`);
const staffMe = r.json.me;
r = await call(staff, 'PATCH', `/api/devices/${staffMe.deviceId}`, { zoneId: zone.id });
ok(r.status === 200, 'staff sets own zone');

r = await call(cam, 'PATCH', `/api/devices/${staffMe.deviceId}`, { zoneId: zone.id });
ok(r.status === 403, 'camera cannot touch staff device (403)');
r = await call(cam, 'PATCH', '/api/tasks/nope', { status: 'done' });
ok(r.status === 404 || r.status === 403, 'camera cannot patch tasks');

// device position on the map
r = await call(admin, 'PUT', `/api/devices/${camDev.id}/position`, { position: [120, 80] });
ok(r.status === 200 && r.json.device.position?.[0] === 120, 'admin places camera on the map');
r = await call(cam, 'PUT', `/api/devices/${camDev.id}/position`, { position: [5000, 80] });
ok(r.status === 400, 'position outside the map → 400');

// Frame without AI → honest 503 (or 502 for this fake JPEG with AI on).
r = await call(cam, 'POST', `/api/devices/${camDev.id}/frames`, undefined, { data: Buffer.alloc(2000, 1), type: 'image/jpeg' });
ok([503, 502, 200].includes(r.status), `frame → ${r.status} ${r.json.error?.code ?? 'analysed'}`);

r = await call(cam, 'POST', `/api/devices/${camDev.id}/manual`, { crowdLevel: 'high', issueType: 'spill', note: 'Drink spilled' });
ok(r.status === 200 && r.json.zone.status === 'crowded' && r.json.incidents.length === 1 && r.json.tasks.length === 1, `manual obs → zone ${r.json.zone?.status}, incident ${r.json.incidents?.[0]?.incidentType}`);
const inc = r.json.incidents[0];
const task = r.json.tasks[0];
ok(task.assigneeId === staffMe.participantId, 'task auto-assigned to staff in zone');
ok(/^[\x00-\x7F·→—~]*$/.test(task.title), `task title is English: "${task.title}"`);

await sleep(900);
r = await call(staff, 'POST', `/api/devices/${staffMe.deviceId}/manual`, { issueType: 'spill', note: 'Floor is slippery' });
ok(r.status === 200 && r.json.incidents[0]?.id === inc.id && r.json.incidents[0].evidenceCount === 2 && r.json.tasks.length === 0, 'dedupe: 2nd report joins same incident, no new task');

await sleep(900);
r = await call(cam, 'POST', `/api/devices/${camDev.id}/manual`, { issueType: 'fire_smoke' });
ok(r.status === 200 && r.json.zone.status === 'alert', `fire → zone ${r.json.zone?.status} (${r.json.zone?.statusReason})`);
const fire = r.json.incidents[0];

r = await call(staff, 'PATCH', `/api/tasks/${task.id}`, { status: 'accepted' });
ok(r.status === 200 && r.json.task.status === 'accepted', 'staff accepts task');
r = await call(staff, 'PATCH', `/api/tasks/${task.id}`, { status: 'done' });
ok(r.status === 200 && r.json.task.status === 'done', 'staff completes task');
r = await call(admin, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.json.incidents.find((i) => i.id === inc.id)?.status === 'resolved', 'incident resolved via task');
ok(r.json.zones.find((z) => z.id === zone.id)?.status === 'alert', 'zone still alert (fire open)');
r = await call(admin, 'PATCH', `/api/incidents/${fire.id}`, { status: 'resolved' });
ok(r.status === 200, 'admin resolves fire');
r = await call(admin, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.json.zones.find((z) => z.id === zone.id)?.status === 'crowded', `zone back to ${r.json.zones.find((z) => z.id === zone.id)?.status}`);
for (let i = 0; i < 20 && r.json.tasks.some((t) => t.stepsSource === 'pending'); i++) { await sleep(500); r = await call(admin, 'GET', `/api/events/${ev.id}/snapshot`); }
ok(r.json.tasks.every((t) => t.stepsSource !== 'pending'), `agent steps filled (${r.json.tasks.map((t) => t.stepsSource).join(',')})`);
ok(r.json.activity.length > 5 && /detected|Assigned|resolved/.test(r.json.activity.map((a) => a.text).join(' ')), `activity feed in English (${r.json.activity.length} rows): "${r.json.activity[0]?.text}"`);
ok(r.json.issues.some((i) => i.incidentId === inc.id), 'camera incident mirrored on the tracker');

r = await call(admin, 'PATCH', `/api/zones/${zone.id}`, { name: 'Table A', version: 1 });
ok(r.status === 409, 'stale zone version → 409');
const cur = (await call(admin, 'GET', `/api/events/${ev.id}/snapshot`)).json.zones.find((z) => z.id === zone.id);
r = await call(admin, 'PATCH', `/api/zones/${zone.id}`, { name: 'Table A', version: cur.version });
ok(r.status === 200 && r.json.zone.name === 'Table A', 'zone rename with version');
r = await call(admin, 'GET', `/api/events/${ev.id}/admin-link`);
ok(r.status === 200 && r.json.url.includes('/a/'), 'admin link');

// walkie (text) + ack
r = await call(staff, 'POST', '/api/talk/text', { text: 'Registration desk needs more pens', to: 'hq', eventId: ev.id });
ok(r.status === 200 && r.json.message.to.label === 'HQ' && r.json.message.expected.length === 1 && r.json.message.audioUrl === null, `radio text → ${r.json.message?.to?.label} (expected ${r.json.message?.expected?.length})`);
r = await call(admin, 'POST', `/api/messages/${r.json.message.id}/ack`, {});
ok(r.status === 200 && r.json.message.acks.length === 1, 'HQ acks the radio message');

// knowledge
r = await call(admin, 'PUT', `/api/events/${ev.id}/knowledge`, { text: 'Doors open 9:00. Lunch 12:30 in the food court. Medical: call Dana at ext 112.' });
ok(r.status === 200, 'organizer saves knowledge');
r = await call(staff, 'GET', `/api/events/${ev.id}/knowledge`);
ok(r.status === 200 && r.json.text.includes('Lunch') && r.json.updatedAt, 'staff reads knowledge');
r = await call(staff, 'PUT', `/api/events/${ev.id}/knowledge`, { text: 'hacked' });
ok(r.status === 403, 'staff cannot edit knowledge (403)');

// live data + CSV
r = await call(admin, 'GET', `/api/events/${ev.id}/data/issues?limit=5`);
ok(r.status === 200 && r.json.columns.includes('key') && r.json.total >= 1, `data/issues: ${r.json.total} rows, columns ${r.json.columns?.slice(0, 5).join(',')}…`);
r = await call(admin, 'GET', `/api/events/${ev.id}/data/participants`);
ok(r.status === 200 && !JSON.stringify(r.json).match(/token_hash|password|scrypt|admin_key/), `data/participants has no secrets (${r.json.rows?.map((p) => p.username ?? p.name).join(', ')})`);
r = await call(admin, 'GET', `/api/events/${ev.id}/data/observations?q=slippery`);
ok(r.status === 200 && r.json.total === 1, `data search q=slippery → ${r.json.total}`);
r = await call(admin, 'GET', `/api/events/${ev.id}/data/reports`);
ok(r.status === 200 && Array.isArray(r.json.columns) && r.json.columns.includes('photo_url'), `data/reports empty-table columns: ${r.json.columns?.join(',')}`);
{
  const raw = await fetch(`${BASE}/api/events/${ev.id}/data/messages.csv`, { headers: { cookie: admin.get() } });
  const bytes = new Uint8Array(await raw.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  ok(raw.status === 200 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && /pens/.test(text) && /attachment; filename="wayve-messages-/.test(raw.headers.get('content-disposition') ?? ''), 'CSV export (UTF-8 BOM, attachment)');
}
r = await call(staff, 'GET', `/api/events/${ev.id}/data/issues`);
ok(r.status === 403, 'staff cannot read the data API (403)');

// attendee chatbot
const guest = jar();
r = await call(guest, 'POST', '/api/join', { code: ev.joinCode, as: 'attendee' });
ok(r.status === 200 && r.json.me.role === 'attendee' && r.json.device === null, `attendee joined → ${r.json.me?.displayName}`);
r = await call(guest, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.status === 403, 'attendee cannot read staff snapshot (403)');
r = await call(guest, 'GET', '/api/chat');
ok(r.status === 200 && r.json.zones.length === 3 && r.json.zones.every((z) => z.status !== 'alert'), 'attendee chat state (public zones, no alert)');
r = await call(guest, 'PATCH', '/api/chat/zone', { zoneId: zone.id });
ok(r.status === 200 && r.json.myZoneId === zone.id, 'attendee sets location');
r = await call(guest, 'POST', '/api/chat', { message: 'The line here is really long' });
ok([200, 503].includes(r.status), `chat → ${r.status} ${r.json.error?.code ?? (r.json.report ? 'report ' + r.json.report.issueType : 'reply')}`);
r = await call(admin, 'GET', `/api/events/${ev.id}/snapshot`);
ok(r.json.attendees.count === 1, `snapshot attendees ${JSON.stringify(r.json.attendees)}`);

// logout
r = await call(staff, 'POST', '/api/auth/logout', {});
r = await call(staff, 'GET', '/api/auth/me');
ok(r.json.user === null, 'logout clears the session');
console.log(`\n${process.exitCode ? 'FAILED' : 'All good'} · event ${ev.id} · code ${ev.joinCode}`);
