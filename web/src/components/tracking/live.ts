// Read-time overlay of a zone's top action (shared by the zone table, map pins and the detail panel).
import { signalAt, type Snapshot, type Zone, type ZoneAction, type TrackLevel } from '@shared/contracts';

export function liveAction(zone: Zone, now: number): ZoneAction | null {
  const t = zone.track;
  if (zone.status === 'alert') {
    return { code: 'respond', level: 'act', text: zone.statusReason ?? 'Respond to the open incident', since: t?.tierSince ?? now, target: null, incidentType: null };
  }
  if (!t) return null;
  const sig = signalAt(t, now);
  if (sig === 'stale' && t.lastUsableAt != null) {
    return t.tier >= 2
      ? { code: 'lost_view', level: 'act', text: 'Lost view of a busy zone — send someone to look', since: t.lastUsableAt, target: null, incidentType: null }
      : { code: 'check_camera', level: 'watch', text: 'No fresh camera frames — check the camera', since: t.lastUsableAt, target: null, incidentType: null };
  }
  return t.action;
}

export const levelOf = (zone: Zone, now: number): TrackLevel => liveAction(zone, now)?.level ?? 'ok';

const LEVEL_RANK: Record<TrackLevel, number> = { act: 2, watch: 1, ok: 0 };
/** Sort: alert first → act > watch > ok → tier desc → crowd score desc → name. */
export function sortZones(zones: Zone[], now: number): Zone[] {
  return [...zones].sort((a, b) =>
    Number(b.status === 'alert') - Number(a.status === 'alert')
    || LEVEL_RANK[levelOf(b, now)] - LEVEL_RANK[levelOf(a, now)]
    || (b.track?.tier ?? -1) - (a.track?.tier ?? -1)
    || (b.track?.metrics.crowd ?? -1) - (a.track?.metrics.crowd ?? -1)
    || a.name.localeCompare(b.name));
}

/** Open incidents + open issues for a zone. */
export function zoneIssues(snap: Snapshot, zoneId: string) {
  const incidents = snap.incidents.filter((i) => i.zoneId === zoneId && i.status !== 'resolved');
  const issues = snap.issues.filter((i) => i.zoneId === zoneId && i.status !== 'done' && !incidents.some((x) => x.id === i.incidentId));
  return { incidents, issues, count: incidents.length + issues.length };
}

export function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 && m < 5 ? ` ${s % 60}s` : ''}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
