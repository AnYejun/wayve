// Venue presets (shared/templates.ts entries with a real floor plan) and their install slots.
// A slot is a recommended device placement: scanning its QR sets a phone up with NO login — label, zone, map position, team,
// and the slot's AI crew persona (created or re-bound, idempotent per slot). Everything here runs inside the caller's tx.
import { AGENT_ROLE_DEFS, type InstallSlot, type VenueMapInfo, type VenueTemplate } from '../shared/contracts.ts';
import { presetById } from '../shared/templates.ts';
import { q } from './db.ts';
import { log } from './log.ts';
import { agentPost, ensureAgentParticipant, getAgent, toCrewAgent } from './crew.ts';
import { listTeams } from './ops.ts';
import { getDeviceRow, getEvent, listZoneRows, newId, toDevice, toParticipant, type Frame, type ParticipantRow } from './world.ts';

export function presetMap(tpl: VenueTemplate, now = Date.now()): VenueMapInfo | null {
  if (!tpl.map) return null;
  return {
    imageUrl: tpl.map.imageUrl, width: tpl.map.width, height: tpl.map.height, kind: 'floorplan',
    grid: tpl.map.grid ?? null, updatedAt: now, presetId: tpl.id,
  };
}

/** The preset an event was created from (or had applied), via map_json.presetId. */
export function eventPreset(eventId: string): VenueTemplate | null {
  const raw = getEvent(eventId)?.map_json;
  if (!raw) return null;
  try { return presetById((JSON.parse(raw) as { presetId?: string }).presetId ?? null); } catch { return null; }
}

export function slotFor(eventId: string, slotId: string | null | undefined, kind?: InstallSlot['kind']): InstallSlot | null {
  if (!slotId) return null;
  const s = eventPreset(eventId)?.install?.find((x) => x.id === slotId) ?? null;
  return s && (!kind || s.kind === kind) ? s : null;
}

const teamId = (eventId: string, name: string | null | undefined) =>
  (name ? listTeams(eventId).find((t) => t.name.toLowerCase() === name.toLowerCase())?.id ?? null : null);
const zoneIdByName = (eventId: string, name: string | null | undefined) =>
  (name ? listZoneRows(eventId).find((z) => z.name.toLowerCase() === name.toLowerCase())?.id ?? null : null);

/** Create or re-bind a crew agent by (event, name). Returns frames. Never throws (crew is optional). */
function upsertAgent(eventId: string, a: { name: string; role: InstallSlot['persona']; team?: string | null; deviceId?: string | null; zoneIds?: string[] }, now: number): Frame[] {
  if (!a.role) return [];
  try {
    const tid = teamId(eventId, a.team);
    const cur = q.get<{ id: string }>('SELECT id FROM agents WHERE event_id = ? AND name = ? AND deleted_at IS NULL', eventId, a.name);
    if (a.deviceId) q.run('UPDATE agents SET device_id = NULL WHERE event_id = ? AND device_id = ? AND name != ?', eventId, a.deviceId, a.name);
    if (cur) {
      q.run(`UPDATE agents SET device_id = COALESCE(?, device_id), zone_ids_json = ?, team_id = COALESCE(?, team_id), active = 1 WHERE id = ?`,
        a.deviceId ?? null, JSON.stringify(a.zoneIds ?? []), tid, cur.id);
      const row = getAgent(cur.id)!;
      return [['agent', toCrewAgent(row)], ...agentPost(row, 'note', `${row.name} is now on ${a.deviceId ? 'this device' : 'duty'}.`, null, now)];
    }
    const id = newId('ag');
    const pid = ensureAgentParticipant(eventId, a.name);
    q.run(`INSERT INTO agents (id, event_id, name, role, instructions, device_id, zone_ids_json, team_id, participant_id, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      id, eventId, a.name, a.role, AGENT_ROLE_DEFS[a.role].instructions, a.deviceId ?? null, JSON.stringify(a.zoneIds ?? []), tid, pid, now);
    const row = getAgent(id)!;
    return [['agent', toCrewAgent(row)], ...agentPost(row, 'note', `${row.name} joined the crew as ${AGENT_ROLE_DEFS[a.role].label}.`, null, now)];
  } catch (e) {
    log.warn('preset.agent_failed', { err: (e as Error).message });
    return [];
  }
}

/** Event-level crew from the preset (dispatcher, concierge). Idempotent by name. */
export function seedPresetCrew(eventId: string, tpl: VenueTemplate, now = Date.now()): Frame[] {
  return (tpl.crew ?? []).flatMap((c) => upsertAgent(eventId, { name: c.name, role: c.role, team: c.team ?? null }, now));
}

/** A multi-zone camera slot ships default regions (camera-view coords), so every zone it covers gets readings without
 *  calibration. Only fills a camera that was never calibrated (regions_json NULL): an admin's own regions, or an explicit
 *  single-zone reset (stored as '[]'), are never overwritten. */
function applySlotRegions(eventId: string, deviceId: string, slot: InstallSlot): boolean {
  if (slot.kind !== 'camera' || !slot.regions?.length) return false;
  const regions = slot.regions.map((r) => ({ zoneId: zoneIdByName(eventId, r.zone), polygon: r.polygon }))
    .filter((r): r is { zoneId: string; polygon: Array<[number, number]> } => !!r.zoneId);
  if (regions.length < 2) return false;
  const res = q.run('UPDATE devices SET regions_json = ?, zone_id = ? WHERE id = ? AND regions_json IS NULL', JSON.stringify(regions), regions[0].zoneId, deviceId);
  return Number(res.changes) > 0;
}

/** Boot: cameras already sitting on a multi-zone preset slot (matched by the slot's label) that were never calibrated get the
 *  slot's default regions. Phones pick them up from the fresh snapshot when they reconnect. */
export function backfillSlotRegions(): number {
  let n = 0;
  try {
    for (const d of q.all<{ id: string; event_id: string; label: string }>("SELECT id, event_id, label FROM devices WHERE device_type = 'camera' AND regions_json IS NULL")) {
      const slot = eventPreset(d.event_id)?.install?.find((s) => s.kind === 'camera' && s.label === d.label);
      if (slot && applySlotRegions(d.event_id, d.id, slot)) n++;
    }
  } catch (e) { log.warn('preset.slot_regions_failed', { err: (e as Error).message }); }
  if (n) log.info('preset.slot_regions_backfilled', { devices: n });
  return n;
}

/** Apply a slot to a freshly joined (or re-scanned) device: label, zone, position, team, crew persona. */
export function applySlot(eventId: string, deviceId: string, participant: ParticipantRow, slot: InstallSlot, now = Date.now()): Frame[] {
  const zoneId = zoneIdByName(eventId, slot.primaryZone);
  q.run('UPDATE devices SET label = ?, zone_id = COALESCE(?, zone_id), position_json = ?, last_seen_at = ? WHERE id = ?',
    slot.label, zoneId, JSON.stringify(slot.position), now, deviceId);
  applySlotRegions(eventId, deviceId, slot);
  const frames: Frame[] = [];
  const tid = teamId(eventId, slot.team);
  if (tid && slot.kind === 'scribe') {
    q.run('UPDATE participants SET team_id = ? WHERE id = ?', tid, participant.id);
    const p = q.get<ParticipantRow>('SELECT * FROM participants WHERE id = ?', participant.id);
    if (p) frames.push(['participant', toParticipant(p)]);
  }
  const zoneIds = slot.zones.map((n) => zoneIdByName(eventId, n)).filter((x): x is string => !!x);
  if (slot.persona && slot.agentName) {
    frames.push(...upsertAgent(eventId, { name: slot.agentName, role: slot.persona, team: slot.team ?? null, deviceId, zoneIds }, now));
  }
  const d = getDeviceRow(deviceId);
  if (d) frames.push(['device', toDevice(d)]);
  return frames;
}
