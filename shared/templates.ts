// Venue templates for /setup. Plain templates use the MAP_W × MAP_H (1000 × 640) space; presets with a `map` use its pixel space.
import type { VenueTemplate } from './contracts.ts';

const rect = (x: number, y: number, w: number, h: number): Array<[number, number]> => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

export const TEMPLATES: VenueTemplate[] = [
  {
    id: 'startup-branch',
    name: 'Startup Branch · SKKU Hackathon',
    description: 'The real venue: floor plan, 8 zones, teams and a camera + scribe install plan.',
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
      {
        id: 'cam-seating', kind: 'camera', label: 'Seating & stage', position: [1400, 170], facing: 180, fov: 90, range: 720,
        zones: ['Tiered Seating', 'Stage'], primaryZone: 'Tiered Seating', persona: 'safety_sentinel', agentName: 'Stage Sentinel', team: 'Safety',
        mount: 'Clamp on the top railing, centered', height: 'Top row (~3 m)',
        tips: ['Look down toward the stage so the camera sees backs of heads, not faces', 'Keep the stage lights out of frame', 'Calibrate two regions: Tiered Seating and Stage'],
      },
      {
        id: 'cam-lounges', kind: 'camera', label: 'Lounges overview', position: [1400, 1560], facing: 0, fov: 110, range: 760,
        zones: ['Lounge A', 'Lounge B', 'Lounge C'], primaryZone: 'Lounge B', persona: 'crowd_analyst', agentName: 'Lounge Analyst', team: 'HQ',
        mount: 'Phone clamp on the walkway pillar', height: '2.2–2.5 m',
        tips: ['Use the widest lens and tilt down about 25°', 'Calibrate three regions after mounting: Lounge A, B and C', 'Table tops should be visible — seats free is read from them'],
      },
      {
        id: 'cam-entrance', kind: 'camera', label: 'Entrance queue', position: [2270, 1690], facing: 250, fov: 95, range: 1100,
        zones: ['Entrance', 'Entrance Lounge'], primaryZone: 'Entrance', persona: 'queue_watcher', agentName: 'Entrance Watch', team: 'Registration',
        mount: 'Tripod or wall clamp in the door corner', height: '2.0–2.3 m',
        tips: ['Point along the queue, not into the doorway glare', 'Feet must be visible — counting uses the floor', 'Calibrate Entrance and Entrance Lounge as two regions'],
      },
      {
        id: 'cam-coffee', kind: 'camera', label: 'Coffee line', position: [2050, 1900], facing: 170, fov: 85, range: 380,
        zones: ['Coffee Corner'], primaryZone: 'Coffee Corner', persona: 'queue_watcher', agentName: 'Coffee Watch', team: 'Hospitality',
        mount: 'Shelf or small tripod facing the counter', height: '1.8–2.0 m',
        tips: ['Frame the counter and the line in front of it', 'Keep the cup stack in view so restocks get flagged'],
      },
      {
        id: 'scribe-hq', kind: 'scribe', label: 'HQ huddle', position: [290, 1450], facing: 0, fov: 0, range: 0,
        zones: [], primaryZone: null, persona: 'meeting_secretary', agentName: 'HQ Secretary', team: 'HQ',
        mount: 'Flat or on a stand, center of the HQ table', height: 'Table level',
        tips: ['Center of the table, about 1 m from the speakers', 'Away from the coffee machine and speakers', 'Announce that the meeting is transcribed — audio is never stored'],
      },
      {
        id: 'scribe-stage', kind: 'scribe', label: 'Stage desk (optional)', position: [2520, 700], facing: 0, fov: 0, range: 0,
        zones: [], primaryZone: null, persona: 'meeting_secretary', agentName: 'Stage Desk Scribe', team: 'Stage',
        mount: 'On the MC / AV desk', height: 'Desk level',
        tips: ['Captures run-of-show changes the MC announces', 'Point the mic toward the MC, away from the PA speakers'],
      },
      { id: 'poster-entrance', kind: 'poster', label: 'Attendee chat · Entrance', position: [2000, 1760], facing: 0, fov: 0, range: 0, zones: ['Entrance'], primaryZone: 'Entrance', persona: null,
        mount: 'A4 poster beside the door', height: 'Eye level', tips: ['First thing attendees see — "Ask us anything"'] },
      { id: 'poster-lounge-a', kind: 'poster', label: 'Attendee chat · Lounge A', position: [770, 900], facing: 0, fov: 0, range: 0, zones: ['Lounge A'], primaryZone: 'Lounge A', persona: null,
        mount: 'Table tent', height: 'Table', tips: ['One per table cluster'] },
      { id: 'poster-lounge-b', kind: 'poster', label: 'Attendee chat · Lounge B', position: [1400, 900], facing: 0, fov: 0, range: 0, zones: ['Lounge B'], primaryZone: 'Lounge B', persona: null,
        mount: 'Table tent', height: 'Table', tips: ['One per table cluster'] },
      { id: 'poster-lounge-c', kind: 'poster', label: 'Attendee chat · Lounge C', position: [2030, 900], facing: 0, fov: 0, range: 0, zones: ['Lounge C'], primaryZone: 'Lounge C', persona: null,
        mount: 'Table tent', height: 'Table', tips: ['One per table cluster'] },
      { id: 'poster-coffee', kind: 'poster', label: 'Attendee chat · Coffee Corner', position: [2030, 2240], facing: 0, fov: 0, range: 0, zones: ['Coffee Corner'], primaryZone: 'Coffee Corner', persona: null,
        mount: 'On the counter', height: 'Counter', tips: ['"Out of something? Tell us here"'] },
      { id: 'poster-stage', kind: 'poster', label: 'Attendee chat · Stage side', position: [2550, 640], facing: 0, fov: 0, range: 0, zones: ['Stage'], primaryZone: 'Stage', persona: null,
        mount: 'A4 poster on the stage side wall', height: 'Eye level', tips: ['Shown during breaks between talks'] },
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
