# WAYVE — the event operating system

Every phone at an event becomes a sensor. Meetings, radio, field reports, cameras and attendee questions land in **one live
database** that HQ, field staff and AI agents act on, instead of phone calls and group chats.

**Live demo:** https://wayve.fly.dev · built for SKKU Hackathon 2026 (venue: Startup Branch)

## What it does

| Channel | Device | What WAYVE extracts | Where it lands |
| --- | --- | --- | --- |
| Meeting scribe | A phone on the meeting table | Tasks, owners, deadlines, decisions | Issue tracker (with the exact quote as evidence) |
| Radio / walkie-talkie | Staff phones (push-to-talk) | Transcript, status updates ("done", "blocked") | Radio log with acks + issue changes |
| Field reports | Staff phones (photo + voice + text) | Title, location, situation, summary | Linked issue (same-spot reports merged) |
| Camera vision | Fixed phones (one zone, or several via calibration) | Crowd level, people, queue + wait, free seats, walkway, hazards | Zone tracker → map, alerts, incidents |
| Attendee chatbot | Attendee phones (QR posters) | Answers, requests, problems | Tracked tickets the attendee can follow |
| Staff assistant | Dashboard (⌘K) and staff phones (chat + voice) | Answers from the live DB, commands ("mark WV-3 done") | Inline maps, issue cards, applied actions |

An **AI crew** (Queue Watcher, Safety Sentinel, Crowd Analyst, Meeting Secretary, Dispatcher, Concierge) is bound to devices,
radios zone changes to HQ, auto-dispatches unowned issues to the best available staff, and watches issues until they are resolved.

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
- **Staff app** (`/staff`, QR): Field, Report, Tasks, Radio, More + voice assistant.
- **Devices** (QR, no login): camera `/device/:id`, meeting scribe `/scribe/:id`.
- **Attendees** (QR poster): `/chat`.

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
