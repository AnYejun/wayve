# WAYVE — business model

**WAYVE sells event operations as a service.** An organizer pays per event-day (a venue pays monthly) to turn the phones
already on site into one live operations system: radio, issue tracker, crowd sensing and an attendee help desk.

## Who pays

| Customer | Pain today | How they buy |
| --- | --- | --- |
| Event organizers & agencies — conferences, hackathons, university festivals, corporate events | Radios, group chats and spreadsheets; nobody knows who is on what | Per event-day |
| Venue operators — convention centers, startup hubs (e.g. COEX Startup Branch) | Every event re-learns the same floor; no shared record | Monthly, all events in the venue |
| Festivals & public events | Crowd safety, slow incident response | Annual enterprise contract |

## Pricing

| Plan | Price | Fits | Includes |
| --- | --- | --- | --- |
| **Free** | ₩0 | Meetups, student teams | 1 event · ≤ 50 attendees · 1 camera · 5 staff |
| **Event Pass** | **₩290,000 / event-day** (~$199) | Hackathons, conferences up to 500 people | 4 cameras · 2 scribes · unlimited staff phones · AI crew · attendee chat (Korean/English) · CSV export |
| **Pro Event** | ₩790,000 / event-day (~$549) | Up to 3,000 people, several halls | 12 cameras · 6 scribes · custom crew personas · priority support |
| **Venue** | ₩1,900,000 / month (~$1,290) | One venue, unlimited events | Venue floor plans + install plans preloaded · Event Pass features for every event · on-site kit |
| **Enterprise** | from ₩30,000,000 / year | Festivals, convention centers | SLA · edge processing · ticketing and messaging integrations · data-retention controls |

Add-ons: extra camera ₩15,000 / day · setup kit rental (phone clamps, power banks) ₩50,000 / day.

**Example — c0mpiled-17: Seoul** (230 attendees, one day): Event Pass ₩290,000 ≈ ₩1,260 per attendee.

## Unit economics (Event Pass, one event-day — estimates)

Assumptions: 2 cameras × 8 h at one frame every 4 s (14,400 frames), a meeting scribe for 4 h, 500 radio calls (~10 s),
1,000 attendee messages.

| Cost | Estimate |
| --- | --- |
| AI — vision, speech-to-text, chat | ~₩30,000–60,000 (~$20–40); vision frames dominate and can be skipped when a zone hasn't changed |
| Hosting — one machine + volume shared across events | < ₩1,000 per event-day at 100 event-days / month |
| **Gross margin** | **~80–85%** |

## Why they pay

- **One live record instead of radios and group chats.** Every radio call and meeting decision becomes a tracked task with an
  owner and the exact quote as evidence.
- **Staff go where they're needed first.** Live crowd levels per zone and hazard alerts; the AI dispatcher assigns the nearest
  free person and re-offers when someone passes.
- **Fewer people at the help desk.** Attendees ask the event's own assistant in Korean or English, from a QR.
- **A post-mortem for free.** The full timeline (who did what, how fast issues closed) exports as CSV for the team and sponsors.
- **No hardware.** It runs on the phones staff already carry; each device is set up with one QR scan.

## Go to market

1. **Hackathons and university events** — free tier, spread by organizers (the c0mpiled series alone runs in San Francisco,
   Tokyo, Osaka, the UAE and Seoul).
2. **Startup hubs and convention venues** — one venue deal covers every event in its halls; the Startup Branch preset already
   exists.
3. **Festivals and public events** — sold on safety: crowd density and incident response.

## Why it compounds

Each event at a venue leaves floor plans, zone baselines and incident history behind, so the next event there starts smarter —
a data moat that grows per venue.
