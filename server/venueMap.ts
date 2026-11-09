// Real venue map: floor plan / overview photo / blank canvas (schematic, grid only). Zone polygons always live in the map's coordinate space
// (image pixels, or MAP_W × MAP_H without an image); when the space changes, existing zones are rescaled proportionally.
import { inferZoneType, type ZoneType, MAP_H, MAP_W, type MapGrid, type MapKind, type VenueMapInfo, type ZoneSuggestion } from '../shared/contracts.ts';
import { q } from './db.ts';
import { type Box } from './ai3.ts';
import { deleteMedia, mediaUrl, saveMedia } from './media.ts';
import { type DeviceRow, type Frame, type ZoneRow, addActivity, getEvent, listZoneRows, newId, publishAll, toDevice, toEvent, toZone } from './world.ts';

/** width/height from PNG / JPEG / WebP headers (no deps). */
export function imageSize(buf: Buffer): { width: number; height: number; mime: string } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), mime: 'image/png' };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), mime: 'image/jpeg' };
      }
      i += 2 + len;
    }
    return null;
  }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), mime: 'image/webp' };
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, mime: 'image/webp' };
    if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, mime: 'image/webp' }; }
  }
  return null;
}

export function getMap(eventId: string): VenueMapInfo | null {
  const raw = getEvent(eventId)?.map_json;
  if (!raw) return null;
  const m = JSON.parse(raw) as Partial<VenueMapInfo>;
  return { imageUrl: m.imageUrl ?? null, width: m.width ?? MAP_W, height: m.height ?? MAP_H, updatedAt: m.updatedAt ?? 0, kind: m.kind ?? 'floorplan', grid: m.grid ?? null, ...(m.presetId ? { presetId: m.presetId } : {}) };
}
export const mapSpace = (eventId: string) => { const m = getMap(eventId); return { w: m?.width ?? MAP_W, h: m?.height ?? MAP_H }; };

const relOf = (url: string | null) => (url && url.startsWith('/media/') ? url.slice('/media/'.length) : null);

/** Rescale every zone from the old space to the new one; returns zone frames. Inside tx. */
function rescaleZones(eventId: string, from: { w: number; h: number }, to: { w: number; h: number }): Frame[] {
  if (from.w === to.w && from.h === to.h) return [];
  const sx = to.w / from.w, sy = to.h / from.h;
  const frames: Frame[] = [];
  for (const z of listZoneRows(eventId)) {
    const poly = (JSON.parse(z.polygon_json) as Array<[number, number]>).map(([x, y]) => [Math.round(x * sx * 10) / 10, Math.round(y * sy * 10) / 10]);
    q.run('UPDATE zones SET polygon_json = ?, version = version + 1 WHERE id = ?', JSON.stringify(poly), z.id);
    frames.push(['zone', toZone(q.get<ZoneRow>('SELECT * FROM zones WHERE id = ?', z.id)!)]);
  }
  return frames;
}

/** Set (or clear) the event map; rescales zones into the new space. Inside tx. */
export function setMap(eventId: string, next: VenueMapInfo | null): Frame[] {
  const prev = getMap(eventId);
  const from = { w: prev?.width ?? MAP_W, h: prev?.height ?? MAP_H };
  const to = { w: next?.width ?? MAP_W, h: next?.height ?? MAP_H };
  q.run('UPDATE events SET map_json = ? WHERE id = ?', next ? JSON.stringify(next) : null, eventId);
  if (prev?.imageUrl && prev.imageUrl !== next?.imageUrl) deleteMedia(relOf(prev.imageUrl));
  const frames = rescaleZones(eventId, from, to);
  const ev = getEvent(eventId);
  if (ev) frames.push(['event', toEvent(ev)]);
  return frames;
}

export function storePlanImage(eventId: string, buf: Buffer, kind: Exclude<MapKind, 'schematic'>): { map: VenueMapInfo; frames: Frame[] } | { error: string } {
  const size = imageSize(buf);
  if (!size || size.width < 64 || size.height < 64 || size.width > 12000 || size.height > 12000) return { error: 'Use a PNG, JPEG or WebP image at least 64 px wide.' };
  const rel = saveMedia('maps', buf, size.mime);
  const prev = getMap(eventId);
  const map: VenueMapInfo = { imageUrl: mediaUrl(rel), width: size.width, height: size.height, updatedAt: Date.now(), kind, grid: prev?.grid ?? null };
  const frames = setMap(eventId, map);
  frames.push(['activity', addActivity(eventId, 'zone', `Venue map updated (${kind === 'photo' ? 'overview photo' : 'floor plan'})`, null)]);
  return { map, frames };
}

export function setGrid(eventId: string, grid: MapGrid | null): VenueMapInfo {
  const cur = getMap(eventId) ?? { imageUrl: null, width: MAP_W, height: MAP_H, updatedAt: Date.now(), kind: 'schematic' as MapKind, grid: null };
  const map = { ...cur, grid, updatedAt: Date.now() };
  q.run('UPDATE events SET map_json = ? WHERE id = ?', JSON.stringify(map), eventId);
  const ev = getEvent(eventId);
  if (ev) publishAll(eventId, [['event', toEvent(ev)]]);
  return map;
}

/** Normalized boxes → suggestions in the map's space. */
export function boxesToSuggestions(boxes: Box[], space: { w: number; h: number }): ZoneSuggestion[] {
  const r = (n: number) => Math.round(n * 10) / 10;
  return boxes.map((b) => ({
    name: b.name, confidence: b.confidence,
    polygon: [[r(b.left * space.w), r(b.top * space.h)], [r(b.right * space.w), r(b.top * space.h)], [r(b.right * space.w), r(b.bottom * space.h)], [r(b.left * space.w), r(b.bottom * space.h)]],
  }));
}

/** Replace the whole zone set (ids kept for updates; missing ones soft-deleted). Inside tx. */
export function replaceZones(eventId: string, input: Array<{ id?: string; name: string; polygon: Array<[number, number]>; zoneType?: ZoneType }>): { frames: Frame[]; zones: ReturnType<typeof toZone>[] } {
  const frames: Frame[] = [];
  const existing = new Map(listZoneRows(eventId).map((z) => [z.id, z]));
  const keep = new Set<string>();
  input.forEach((z, i) => {
    const poly = JSON.stringify(z.polygon.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]));
    if (z.id && existing.has(z.id)) {
      keep.add(z.id);
      q.run('UPDATE zones SET name = ?, polygon_json = ?, sort = ?, zone_type = COALESCE(?, zone_type), version = version + 1 WHERE id = ?', z.name, poly, i, z.zoneType ?? null, z.id);
      frames.push(['zone', toZone(q.get<ZoneRow>('SELECT * FROM zones WHERE id = ?', z.id)!)]);
    } else {
      const id = newId('zn');
      keep.add(id);
      q.run('INSERT INTO zones (id, event_id, name, polygon_json, sort, zone_type) VALUES (?, ?, ?, ?, ?, ?)', id, eventId, z.name, poly, i, z.zoneType ?? inferZoneType(z.name));
      frames.push(['zone', toZone(q.get<ZoneRow>('SELECT * FROM zones WHERE id = ?', id)!)]);
    }
  });
  const now = Date.now();
  for (const [id] of existing) {
    if (keep.has(id)) continue;
    q.run('UPDATE zones SET deleted_at = ? WHERE id = ?', now, id);
    frames.push(['zone_removed', { id }]);
    const devs = q.all<DeviceRow>('SELECT * FROM devices WHERE zone_id = ?', id);
    q.run('UPDATE devices SET zone_id = NULL WHERE zone_id = ?', id);
    for (const d of devs) frames.push(['device', toDevice(q.get<DeviceRow>('SELECT * FROM devices WHERE id = ?', d.id)!)]);
  }
  frames.push(['activity', addActivity(eventId, 'zone', `Zones updated · ${input.length} zones`, null, now)]);
  return { frames, zones: listZoneRows(eventId).map(toZone) };
}
