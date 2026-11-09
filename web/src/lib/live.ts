// Live world state over SSE. useLive(eventId) → { snap, status, error, apply, applyResult }.
// The server sends a full `snapshot` on every (re)connect, then entity upserts. EventSource reconnects by itself;
// when the stream is CLOSED (auth error / server gone) we back off and retry, checking /snapshot for a 401/403 reason.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
  Activity, AgentPost, CrewAgent, Device, DevicePulse, Incident, Issue, Report, IssueEvent, Notify, Observation, ObservationResult, Participant, Proposal, Snapshot, Task,
  TalkMessage, Team, Utterance, Zone,
} from '@shared/contracts';
import { API, HttpError } from './api.ts';

let clockOffset = 0;

// ── Live device pulses: a tiny external store so a pulse never re-renders the whole snapshot. ─────────────────────────
const PULSE_KEEP = 10;
const EMPTY_PULSES: DevicePulse[] = [];
const pulseMap = new Map<string, DevicePulse[]>();
const pulseListeners = new Set<() => void>();
let lastAnyPulseAt = 0;
export const pulseStore = {
  push(p: DevicePulse) {
    const cur = pulseMap.get(p.deviceId) ?? EMPTY_PULSES;
    pulseMap.set(p.deviceId, [p, ...cur].slice(0, PULSE_KEEP));
    lastAnyPulseAt = Math.max(lastAnyPulseAt, Date.now());
    for (const l of pulseListeners) l();
  },
  subscribe(l: () => void) { pulseListeners.add(l); return () => { pulseListeners.delete(l); }; },
  get: (deviceId: string | null | undefined) => (deviceId ? pulseMap.get(deviceId) ?? EMPTY_PULSES : EMPTY_PULSES),
  lastAt: () => lastAnyPulseAt,
};
/** Recent pulses (newest first, client-clock `at` re-stamped on arrival) for one device. */
export function usePulses(deviceId: string | null | undefined): DevicePulse[] {
  return useSyncExternalStore(pulseStore.subscribe, () => pulseStore.get(deviceId), () => EMPTY_PULSES);
}
/** Client time of the most recent pulse from any device (0 = none yet). */
export function useLastPulseAt(): number {
  return useSyncExternalStore(pulseStore.subscribe, pulseStore.lastAt, () => 0);
}
/** Date.now() aligned to the server clock (set from snapshot.serverTime). */
export const serverNow = () => Date.now() + clockOffset;

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

type Upsert = { kind: 'zone'; data: Zone } | { kind: 'device'; data: Device } | { kind: 'participant'; data: Participant }
  | { kind: 'incident'; data: Incident } | { kind: 'task'; data: Task } | { kind: 'observation'; data: Observation }
  | { kind: 'activity'; data: Activity } | { kind: 'zone_removed'; data: { id: string } }
  | { kind: 'team'; data: Team } | { kind: 'team_removed'; data: { id: string } } | { kind: 'issue'; data: Issue }
  | { kind: 'issue_event'; data: IssueEvent } | { kind: 'proposal'; data: Proposal } | { kind: 'utterance'; data: Utterance }
  | { kind: 'message'; data: TalkMessage } | { kind: 'report'; data: Report } | { kind: 'event'; data: Snapshot['event'] }
  | { kind: 'agent'; data: CrewAgent } | { kind: 'agent_post'; data: AgentPost } | { kind: 'agent_removed'; data: { id: string } };

function upsert<T extends { id: string | number }>(list: T[], item: T, opts: { prepend?: boolean; cap?: number } = {}): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) { const next = list.slice(); next[i] = item; return next; }
  const next = opts.prepend ? [item, ...list] : [...list, item];
  return opts.cap && next.length > opts.cap ? next.slice(0, opts.cap) : next;
}

/** Ignore stale zone frames (version only moves forward). */
function upsertZone(list: Zone[], z: Zone): Zone[] {
  const cur = list.find((x) => x.id === z.id);
  if (cur && cur.version > z.version) return list;
  return upsert(list, z);
}

export function reduce(snap: Snapshot, u: Upsert): Snapshot {
  switch (u.kind) {
    case 'zone': return { ...snap, zones: upsertZone(snap.zones, u.data) };
    case 'zone_removed': return { ...snap, zones: snap.zones.filter((z) => z.id !== u.data.id) };
    case 'device': return { ...snap, devices: upsert(snap.devices, u.data) };
    case 'participant': return { ...snap, participants: upsert(snap.participants, u.data) };
    case 'incident': return { ...snap, incidents: upsert(snap.incidents, u.data, { prepend: true }).sort((a, b) => b.createdAt - a.createdAt) };
    case 'task': return { ...snap, tasks: upsert(snap.tasks, u.data, { prepend: true }).sort((a, b) => b.createdAt - a.createdAt) };
    case 'observation': return { ...snap, observations: upsert(snap.observations, u.data, { prepend: true, cap: 60 }) };
    case 'activity': return { ...snap, activity: upsert(snap.activity, u.data, { prepend: true, cap: 100 }) };
    case 'team': return { ...snap, teams: upsert(snap.teams, u.data).sort((a, b) => a.sort - b.sort) };
    case 'team_removed': return { ...snap, teams: snap.teams.filter((t) => t.id !== u.data.id) };
    case 'issue': {
      const cur = snap.issues.find((i) => i.id === u.data.id);
      if (cur && cur.version > u.data.version) return snap;
      return { ...snap, issues: upsert(snap.issues, u.data).sort((a, b) => b.number - a.number) };
    }
    case 'issue_event': return { ...snap, issueEvents: upsert(snap.issueEvents, u.data, { prepend: true, cap: 200 }) };
    case 'proposal': return { ...snap, proposals: upsert(snap.proposals, u.data, { prepend: true }) };
    case 'utterance': return { ...snap, utterances: upsert(snap.utterances, u.data, { prepend: true, cap: 150 }).sort((a, b) => b.startedAt - a.startedAt) };
    case 'message': return { ...snap, messages: upsert(snap.messages, u.data, { prepend: true, cap: 80 }) };
    case 'event': return { ...snap, event: u.data };
    case 'agent': return { ...snap, crew: (snap.crew ?? []).some((a) => a.id === u.data.id)
      ? snap.crew.map((a) => (a.id === u.data.id ? u.data : a)) : [...(snap.crew ?? []), u.data] };
    case 'agent_post': return { ...snap, crewPosts: upsert(snap.crewPosts ?? [], u.data, { prepend: true, cap: 60 }) };
    case 'agent_removed': return { ...snap, crew: (snap.crew ?? []).filter((a) => a.id !== u.data.id) };
    case 'report': return { ...snap, reports: upsert(snap.reports, u.data, { prepend: true, cap: 100 }).sort((a, b) => b.createdAt - a.createdAt) };
  }
}

const KINDS = ['zone', 'zone_removed', 'device', 'participant', 'incident', 'task', 'observation', 'activity',
  'team', 'team_removed', 'issue', 'issue_event', 'proposal', 'utterance', 'message', 'report', 'event', 'agent', 'agent_post', 'agent_removed'] as const;

export function useLive(eventId: string | null | undefined) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [error, setError] = useState<HttpError | null>(null);
  const [lastFrameAt, setLastFrameAt] = useState(0);
  /** Targeted nudges received this session (newest first). Filter by me.participantId (or 'hq' for admins) before showing. */
  const [notifies, setNotifies] = useState<Notify[]>([]);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snap;

  useEffect(() => {
    if (!eventId) return;
    let es: EventSource | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      setStatus((s) => (s === 'live' ? 'reconnecting' : s));
      es = new EventSource(`/api/events/${encodeURIComponent(eventId)}/stream`, { withCredentials: true });
      es.addEventListener('snapshot', (e) => {
        const s = JSON.parse((e as MessageEvent).data) as Snapshot;
        clockOffset = s.serverTime - Date.now();
        attempt = 0;
        setSnap(s);
        setError(null);
        setStatus('live');
        setLastFrameAt(Date.now());
      });
      for (const kind of KINDS) {
        es.addEventListener(kind, (e) => {
          const data = JSON.parse((e as MessageEvent).data);
          setSnap((cur) => (cur ? reduce(cur, { kind, data } as Upsert) : cur));
          setLastFrameAt(Date.now());
        });
      }
      es.addEventListener('pulse', (e) => {
        // Re-stamp on arrival so animations are timed in client time.
        try { const p = JSON.parse((e as MessageEvent).data) as DevicePulse; pulseStore.push({ ...p, at: Date.now() }); } catch { /* ignore */ }
      });
      es.addEventListener('notify', (e) => {
        const n = JSON.parse((e as MessageEvent).data) as Notify;
        setNotifies((cur) => (cur.some((x) => x.id === n.id) ? cur : [n, ...cur].slice(0, 50)));
      });
      es.addEventListener('hb', (e) => {
        try { const { t } = JSON.parse((e as MessageEvent).data); clockOffset = t - Date.now(); } catch { /* ignore */ }
        setLastFrameAt(Date.now());
      });
      es.onerror = () => {
        if (closed || !es) return;
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          // Find out why (auth?) before retrying.
          API.snapshot(eventId).then(() => scheduleRetry()).catch((err: HttpError) => {
            if (err.status === 401 || err.status === 403 || err.status === 404) { setError(err); setStatus('error'); }
            else scheduleRetry();
          });
        } else {
          setStatus('reconnecting');
        }
      };
    };
    const scheduleRetry = () => {
      if (closed) return;
      setStatus('reconnecting');
      const ms = Math.min(15_000, 1000 * 2 ** attempt++) + Math.random() * 400;
      retryTimer = setTimeout(connect, ms);
    };

    connect();
    // Mobile Safari freezes background tabs: reconnect promptly when the page comes back.
    const onVis = () => {
      if (document.visibilityState === 'visible' && (!es || es.readyState === EventSource.CLOSED)) {
        clearTimeout(retryTimer);
        es?.close();
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      es?.close();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [eventId]);

  /** Apply a local upsert (e.g. from a REST response that may arrive before its SSE echo). */
  const apply = useCallback((u: Upsert) => setSnap((cur) => (cur ? reduce(cur, u) : cur)), []);
  const applyResult = useCallback((r: ObservationResult) => {
    setSnap((cur) => {
      if (!cur) return cur;
      let s = reduce(cur, { kind: 'observation', data: r.observation });
      s = reduce(s, { kind: 'zone', data: r.zone });
      for (const i of r.incidents) s = reduce(s, { kind: 'incident', data: i });
      for (const t of r.tasks) s = reduce(s, { kind: 'task', data: t });
      return s;
    });
  }, []);

  return { snap, status, error, lastFrameAt, notifies, apply, applyResult, pulses: pulseStore };
}
