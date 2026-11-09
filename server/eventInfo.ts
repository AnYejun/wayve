// Event info that ships with a preset venue: what the attendee chatbot and the staff assistant know about the event itself
// (agenda, rules, prizes, directions, Wi-Fi). Server-only. The Wi-Fi password is never committed: it comes from the
// EVENT_WIFI_PASSWORD secret at runtime. An organizer's own knowledge text always comes first (see world.getKnowledge).

const C0MPILED_SEOUL = `c0mpiled-17: Seoul — one-day, build-first hackathon (the c0mpiled series by Transpose Platform, first Seoul edition).
Date: Monday, November 9, 2026, 9:00 AM – 7:00 PM (KST). Free to attend. The event runs in English.
Venue: COEX Startup Branch, 2F (A01), 513 Yeongdong-daero, Gangnam-gu, Seoul.
Getting here: enter through the COEX East Gate (street level, facing Yeongdong-daero), walk past the first escalator, take the far escalator on the right up one floor, then turn right into the Trade Mart — Startup Branch is beside it. Subway: Line 2 Samseong Station Exit 6, or Line 9 Bongeunsa Station Exit 7. By taxi, ask for "COEX East Gate" (코엑스 동문).
Co-hosts: ASAN Nanum Foundation, Korea Venture Capital Association (KVCA), Korea Venture Investment Corp. (KVIC), Korea International Trade Association (KITA, operator of COEX). Operated by Quantum Ventures Korea.

Agenda (schedule is subject to change):
- 9:00–9:40 Check-in and networking (your Luma ticket QR is checked at the door)
- 9:40–10:00 Opening and congratulatory remarks: Hakkyoon Kim (Chairman, KVCA), Hee Chul Jung (Executive Director, KITA), James Tan (Partner, Transpose Platform; founder of the c0mpiled series). Live captions are shown for Korean-language remarks.
- 10:00–15:00 Build session (5 hours). Lunch is brought to the venue during the session.
- 15:00–17:00 Judging, optional live demos, awards
- 17:00–19:00 Dinner, drinks and networking
Food: lunch, dinner, drinks and snacks are provided.

Challenge: pick a topic from Y Combinator's Request for Startups (Fall 2026): 1) AI for the Aging Population 2) The Best Time to Build in Crypto 3) New Operating System for the Physical World 4) AI-Powered Consumer Products for a Billion People 5) Proving You're Human 6) Multiplayer AI 7) The Primer 8) Compute at Sea 9) Self-Maintaining APIs. You do not need to follow the track you picked at registration.
Rules: teams of up to 4, or solo. Existing models, APIs and libraries are allowed; the product itself must be built during the event (brainstorming beforehand is fine). Repositories with commits made before 10:00 AM are not eligible.
Submission (deadline 3:00 PM): a demo video of 2 minutes or less (Loom or YouTube recommended) and your GitHub repository URL, through the organizers' Google Form: https://forms.gle/CXkLSBBrGQLBUa3VA (posted on Luma at 1:26 PM). A live demo to peers during judging is optional and does not affect your score.
Judging criteria: problem–solution clarity, technical implementation/execution, creativity. Judges look at how sharply you defined the problem and how directly your solution addresses it.
Prizes: 1st — office hours with YC General Partner Jon Xu + KRW 3,000,000. 2nd — KRW 2,000,000. 3rd — KRW 1,000,000. The winning team also gets YC application mentoring from Transpose Platform and the visiting YC alumni founders.
Judges: Daniel Park (Co-founder & CEO, Pickle, YC W25); Sina Matian (Product Engineer, Y Combinator); Peter Shin (Founder & CEO, Outsome, YC W20); Lewis Blackwood (CTO, Rex, YC S26); Merlin Kafka (CEO, Rex, YC S26); Arthur Guiot (SWE, Circleback, YC W24); Andres Viera (SWE, Circleback, YC W24).
Credits: Stripe gives every participant $250 in Stripe credits plus $250 off Stripe Atlas incorporation: https://stripe.com/startup-benefits/c0mpiled-seoul

Wi-Fi: networks "c0mpiled-1" to "c0mpiled-20" — connect to the nearest router. Password: {{WIFI_PASSWORD}}
Power: power strips are provided but limited — please share outlets and take turns; bring your charger and a power bank.
Seating: chairs and tables are limited; many people work on the stairs (Tiered Seating) or the floor.
Network tip: large downloads are slow on site; a personal hotspot is a good backup.
Organizers (Luma hosts): Jacob Yeum, Bumsoo Kim, Stephen Yeum, James Tan, HyungSuk Jin and the Startup Branch team. For anything not covered here, ask a staff member.
Venue areas: Tiered Seating (the stairs facing the stage; 계단석), Stage (무대), Lounge A, Lounge B, Lounge C (라운지), Entrance Lounge, Entrance (입구), Coffee Corner (커피 코너).`;

const BY_PRESET: Record<string, string> = { 'startup-branch': C0MPILED_SEOUL };

/** The first line marks preset info already inside an organizer's own text (so it is never appended twice). */
export const presetInfoMark = (presetId: string): string | null => BY_PRESET[presetId]?.split('\n')[0] ?? null;

export function presetKnowledge(presetId: string | null | undefined): string | null {
  const t = presetId ? BY_PRESET[presetId] : undefined;
  if (!t) return null;
  const wifi = process.env.EVENT_WIFI_PASSWORD?.trim();
  return t.replace('{{WIFI_PASSWORD}}', wifi || 'ask a staff member or check the Luma announcement');
}
