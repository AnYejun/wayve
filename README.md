# WAYVE — the event operating system

Every phone at an event becomes a sensor. Meetings, radio, field reports, cameras and attendee questions land in **one live
database** that HQ, field staff and AI agents act on, instead of phone calls and group chats.

**Live demo:** https://wayve.fly.dev · built in one day at **c0mpiled-17: Seoul** (COEX Startup Branch, Nov 9 2026) for YC's
Request for Startups #3, *a new operating system for the physical world*.

## What it does

| Channel | Device | What WAYVE extracts | Where it lands |
| --- | --- | --- | --- |
| Meeting scribe | A phone on the meeting table | Tasks, owners, deadlines, decisions | Issue tracker (with the exact quote as evidence) |
| Radio / walkie-talkie | Staff phones (push-to-talk) | Transcript (Korean, English or mixed), status updates ("done", "blocked") | Radio log with acks + issue changes |
| Field reports | Staff chat (photos or a short video + a line of text) | Title, category, urgency, location, summary | Linked issue (same-spot reports merged) |
| Camera vision | Fixed phones (one zone, or several: preset spots ship default regions) | Crowd level, people, queue + wait, free seats, walkway, hazards | Zone tracker → map, alerts, incidents |
| Attendee chatbot | Attendee phones (QR poster / front screen) | Answers from the event info, requests, problems | Tracked tickets the attendee can follow |
| Staff assistant | Dashboard (⌘K) and staff phones (chat + voice) | Answers from the live DB, commands ("mark WV-3 done") | Inline maps, issue cards, applied actions |

An **AI crew** (Queue Watcher, Safety Sentinel, Crowd Analyst, Meeting Secretary, Dispatcher, Concierge) is bound to devices,
radios zone changes to HQ, auto-dispatches unowned issues to the best available staff (a pass re-offers it to the next person),
and watches issues until they are resolved.

**Korean and English.** Chat and voice replies follow the language of each message (decided in code, not guessed by the model);
records on the dashboard (issue titles, summaries) stay English; transcripts keep the words as spoken.

## How it works

```
phones ──▶ immutable records ──▶ AI proposes ──▶ deterministic rules ──▶ live state ──▶ SSE ──▶ every screen
(camera,    (observations,        (vision,          (zone tracker,         (zones,         (dashboard,
 scribe,     utterances,           transcription,    issue rules,           issues,          staff app,
 radio,      messages,             extraction)       dispatcher,            tasks)           attendee chat)
 reports)    reports)                                confidence gates)
```

- The model never writes the database: it returns strict-JSON proposals; rules apply them (auto above a confidence bar,
  otherwise into a Suggestions inbox). Every change keeps its evidence and AI changes can be undone.
- Zone tracking smooths noisy single frames (median of the last ≤ 5 frames, hysteresis, 2-of-3 confirmation for hazards).
- No raw video or continuous audio is stored: frames and audio are analysed in memory and dropped; radio clips expire after 6 h.

## Surfaces

- **Dashboard** (`/e/:eventId/…`, organizer login): Dashboard (issue tracker), Map, Radio, Assistant, AI crew, Database
  (live tables + CSV export), Devices, Reports, People, Settings (map, zones, teams, cameras, knowledge, invites).
- **Staff app** (`/staff`, QR + a name, no account): two tabs — **Chat** (the assistant; attach photos or a short video and it
  files a tracked report with a live receipt) and **Radio** (push-to-talk). New assignments arrive as swipe cards: right to take,
  left to pass. The task you're on stays pinned; slide to finish.
- **Devices** (QR, no login): camera `/device/:id`, meeting scribe `/scribe/:id`. Preset venues come with an install plan
  (Startup Branch: two stage cameras, one stage-desk scribe, the attendee QR on the front screen) and a printable sheet.
- **Attendees** (QR poster or the front screen): `/chat`. Staff, camera and scribe links carry an organizer join key;
  the attendee code alone can only join as an attendee.

## Stack

Node 24 (TypeScript via type stripping) · Express · `node:sqlite` (single writer, WAL, migrations on boot) · in-process SSE ·
React 19 · Vite · Tailwind 4 · motion · OpenAI (`gpt-6-luna`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts`) · Fly.io (one machine + volume).

## Run locally

```bash
npm install
cp .env.example .env        # set OPENAI_API_KEY (leave empty to run without AI: manual observations only)
npm run dev                 # API on :8080, web on :5173
node scripts/seed-venue.mjs http://localhost:8080   # optional demo venue (accounts saved to data/demo-credentials.json)
```

Checks: `npm run typecheck`, `npm test`, `bash scripts/verify-all.sh` (build + unit tests + every smoke suite against a fresh
local server; needs `OPENAI_API_KEY` in the environment).

## Deploy

`node scripts/deploy.mjs` — typecheck, build, `fly deploy --ha=false`, then waits for the new release to report healthy.
Secrets live in Fly (`fly secrets set OPENAI_API_KEY=…`); nothing secret is committed.
