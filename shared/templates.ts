// Venue templates for /setup. Plain templates use the MAP_W × MAP_H (1000 × 640) space; presets with a `map` use its pixel space.
import type { VenueTemplate } from './contracts.ts';

const rect = (x: number, y: number, w: number, h: number): Array<[number, number]> => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
/** A box on a camera's own view (normalized 0..1). */
const box = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export const TEMPLATES: VenueTemplate[] = [
  {
    id: 'startup-branch',
    name: 'Startup Branch · c0mpiled-17 Seoul',
    description: 'The real venue: floor plan, 8 zones, teams and a stage setup — two cameras, one scribe, the attendee QR.',
    map: { imageUrl: '/presets/startup-branch.png', thumbUrl: '/presets/startup-branch-thumb.png', width: 2800, height: 2400, kind: 'floorplan', grid: { cols: 28, rows: 24 } },
    zones: [
      { name: 'Tiered Seating', polygon: rect(140, 140, 2520, 460), zoneType: 'stage' },
      { name: 'Stage', polygon: rect(140, 600, 2520, 220), zoneType: 'stage' },
      { name: 'Lounge A', polygon: rect(500, 860, 540, 560), zoneType: 'workspace' },
      { name: 'Lounge B', polygon: rect(1080, 860, 640, 560), zoneType: 'workspace' },
      { name: 'Lounge C', polygon: rect(1760, 860, 540, 560), zoneType: 'workspace' },
      { name: 'Entrance Lounge', polygon: rect(500, 1660, 1220, 440), zoneType: 'lounge' },
      { name: 'Entrance', polygon: rect(1760, 1660, 540, 200), zoneType: 'entrance' },
      { name: 'Coffee Corner', polygon: rect(1760, 1880, 540, 400), zoneType: 'food' },
    ],
    teams: ['HQ', 'Registration', 'Stage', 'Hospitality', 'Safety'],
    crew: [
      { name: 'Dispatcher', role: 'dispatcher', team: 'HQ' },
      { name: 'Concierge', role: 'concierge', team: 'Hospitality' },
    ],
    install: [
      // Stage presentation setup: two cameras + one scribe, plus the attendee QR on the front screen.
      {
        id: 'cam-seating', kind: 'camera', label: 'Seating & stage', position: [1400, 170], facing: 180, fov: 90, range: 720,
        zones: ['Tiered Seating', 'Stage'], primaryZone: 'Tiered Seating', persona: 'safety_sentinel', agentName: 'Stage Sentinel', team: 'Safety',
        mount: 'Clamp on the top railing, centered', height: 'Top row (~3 m)',
        tips: ['Room overview for the big screen: the audience and the stage in one frame', 'Look down toward the stage so it sees backs of heads, not faces', 'Regions are preset: seats in the lower part of the view, the stage at the top'],
        regions: [{ zone: 'Tiered Seating', polygon: box(0, 0.42, 1, 1) }, { zone: 'Stage', polygon: box(0, 0, 1, 0.42) }],
      },
      {
        id: 'cam-stage', kind: 'camera', label: 'Stage demo spot', position: [2580, 700], facing: 270, fov: 70, range: 1000,
        zones: ['Stage'], primaryZone: 'Stage', persona: 'queue_watcher', agentName: 'Stage Watch', team: 'Stage',
        mount: 'Small tripod at stage right, pointing across the stage', height: '1.2–1.5 m',
        tips: ['Frame the open floor in front of the podium — live demos happen there', 'Keep the projector screen out of frame', 'Plug in a charger: the screen stays on while it watches'],
      },
      {
        id: 'scribe-stage', kind: 'scribe', label: 'Stage desk', position: [1400, 760], facing: 0, fov: 0, range: 0,
        zones: [], primaryZone: null, persona: 'meeting_secretary', agentName: 'Stage Desk Scribe', team: 'Stage',
        mount: 'On the podium or the stage desk, mic toward the speaker', height: 'Desk level',
        tips: ['Within about 1 m of whoever is speaking', 'Korean, English or both — transcribed as spoken', 'Audio is never stored, only the transcript'],
      },
      { id: 'poster-screen', kind: 'poster', label: 'Front screen · attendee QR', position: [1400, 805], facing: 0, fov: 0, range: 0, zones: ['Tiered Seating'], primaryZone: 'Tiered Seating', persona: null,
        mount: 'Full screen on the projector before and during the demo', height: 'Projector', tips: ['Attendees scan it and ask in Korean or English — no app, no sign-up'] },
    ],
  },
  {
    id: 'demo',
    name: 'Demo space',
    description: 'Three consented demo areas. Built for a hackathon demo.',
    zones: [
      { name: 'Table area', polygon: rect(20, 20, 470, 360) },
      { name: 'Entrance', polygon: rect(510, 20, 470, 360) },
      { name: 'Hallway', polygon: rect(20, 400, 960, 220) },
    ],
  },
  {
    id: 'conference',
    name: 'Conference hall',
    description: 'Main hall · Lobby · Registration · Exhibition · Food court · Restrooms',
    zones: [
      { name: 'Restrooms', polygon: rect(20, 20, 260, 160) },
      { name: 'Registration', polygon: rect(20, 200, 260, 200) },
      { name: 'Lobby', polygon: rect(20, 420, 260, 200) },
      { name: 'Main hall', polygon: rect(300, 20, 680, 320) },
      { name: 'Exhibition', polygon: rect(300, 360, 340, 260) },
      { name: 'Food court', polygon: rect(660, 360, 320, 260) },
    ],
  },
  {
    id: 'festival',
    name: 'Outdoor festival',
    description: 'Main stage · Standing area · Gate · Food trucks · Merch · Medical tent · Rest area',
    zones: [
      { name: 'Medical tent', polygon: rect(20, 20, 300, 180) },
      { name: 'Rest area', polygon: rect(20, 220, 300, 220) },
      { name: 'Main gate', polygon: rect(20, 460, 300, 160) },
      { name: 'Main stage', polygon: rect(340, 20, 640, 150) },
      { name: 'Standing area', polygon: rect(340, 190, 640, 250) },
      { name: 'Food trucks', polygon: rect(340, 460, 360, 160) },
      { name: 'Merch', polygon: rect(720, 460, 260, 160) },
    ],
  },
];

/** Preset (template with a real floor plan) by id. */
export const presetById = (id: string | null | undefined) => (id ? TEMPLATES.find((t) => t.id === id && t.map) ?? null : null);
