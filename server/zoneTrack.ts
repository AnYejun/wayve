// Zone tracking — PURE derivation (no DB, no clock): previous state + one new sample → next state, metrics, incident candidates,
// the zone's top action and its status line. Design: data/tracking-schema.json (derivation_rules). Callers: server/rules.ts.
//   window: ≤ 8 camera samples ≤ 60 s · smoothing: per device median±1-clamped mean over ≤ 5 usable frames, max across fresh
//   devices · tier moves only with ≥ 3 usable frames · hysteresis enter/exit + 20 s per step down · human report = 120 s floor
//   · k-of-n flags (spill, blocked, narrowed, hazards 2 of 3; life-safety fast lane) · trend from 30-s buckets 90–150 s ago.
import {
  CROWD_LABEL, CROWD_LEVELS, CERTAINTY_WEIGHT, INCIDENT_LABEL, LIFE_SAFETY_HAZARDS, SEAT_FREE_SHARE, TIER_STATUS, VIEW_WEIGHT,
  WALKWAY_RANK, ZONE_TRACK, ZONE_TYPE_PROFILE, crowdLevelOf, peopleText, signalAt,
  type ActionCode, type CrowdLevel, type HazardType, type IncidentType, type MetricKey, type ObservationPayload, type Tier,
  type TrackSource, type Trend, type VisionPayload, type ZoneAction, type ZoneMetrics, type ZoneSample, type ZoneTrack,
  type ZoneTrackState, type ZoneType,
} from '../shared/contracts.ts';

const T = ZONE_TRACK;
const HAZARD_TO_INCIDENT: Record<HazardType, IncidentType> = {
  fire_smoke: 'fire_smoke', spill: 'spill', obstruction: 'obstruction', fall_injury: 'medical', fight: 'fight', medical: 'medical',
  crowd_crush: 'overcrowding', suspicious_item: 'suspicious_item', other: 'other',
};
const HAZARD_TEXT: Record<HazardType, string> = {
  fire_smoke: 'Fire / smoke', spill: 'Spill', obstruction: 'Obstruction', fall_injury: 'Person down', fight: 'Altercation',
  medical: 'Medical', crowd_crush: 'Crowd crush', suspicious_item: 'Unattended item', other: 'Hazard',
};

export type Candidate = { type: IncidentType; detail: string; confidence: number };
export type HumanSample = { src: 'staff' | 'manual' | 'chat'; t: number; crowd: number | null; label: string };

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x: number) => Math.round(x * 10) / 10;
const round05 = (x: number) => Math.round(x * 2) / 2;
const nn = <X>(x: X | null | undefined): x is X => x != null;

export function emptyTrack(now: number): ZoneTrack {
  return {
    tier: 0, tierSince: now, crowdTier: 0, level: 'ok', action: null, driver: null,
    metrics: { crowd: null, crowdLevel: null, people: null, peopleText: null, queue: null, queueSpills: false, waitMin: null, seatsFree: null, walkway: null, walkwayFlag: null, hazard: null },
    trend: null, conf: 0, nUsable: 0, badStreak: 0, lastUsableAt: null, lastHumanAt: null, hold: null, sources: [], updatedAt: now,
  };
}
export function emptyState(now: number): ZoneTrackState {
  return {
    v: 1, win: [], crowdSince: now, queueTier: 0, queueSince: now, flags: { spill: false, blocked: false, narrowed: false, hazards: [] },
    waitHighSince: null, queueAtHigh: null, risingSince: null, seatsLowSince: null, track: emptyTrack(now),
  };
}
export function parseState(json: string | null | undefined, now: number): ZoneTrackState {
  if (!json) return emptyState(now);
  try { const s = JSON.parse(json) as ZoneTrackState; return s && s.v === 1 && s.track ? s : emptyState(now); } catch { return emptyState(now); }
}

/** One observation → the tracker's input. Branch on payload.kind (a staff photo report is modality 'vision' but kind 'report'). */
export function sampleOf(o: { payload: ObservationPayload; modality: string; confidence: number; deviceId: string; at: number; label: string }):
  { cam: ZoneSample } | { human: HumanSample } | null {
  const p = o.payload;
  if (p.kind === 'vision') {
    const v = p as VisionPayload;
    const conf = v.v === 2 ? o.confidence : o.confidence; // v2 confidence already = CERTAINTY × VIEW; v1 = model float
    const ok = v.scene_ok && conf >= 0.4;
    const queue = v.v === 2 ? (v.queue_people ?? 0) : (v.queue_present ? 3 : 0);
    return {
      cam: {
        t: o.at, dev: o.deviceId, ok, conf, crowd: CROWD_LEVELS.indexOf(v.crowd_level), people: v.people_count, queue,
        spill: !!v.queue_spills, seats: v.seating ? SEAT_FREE_SHARE[v.seating] : null, walk: v.walkway ? WALKWAY_RANK[v.walkway] : null,
        hz: v.hazards.map((h) => ({ type: h.type, h: h.confidence })),
      },
    };
  }
  if (p.kind === 'report') {
    const src = o.modality === 'chat' ? 'chat' : 'staff';
    const crowd = p.crowd_level && o.confidence >= 0.4 && src === 'staff' ? CROWD_LEVELS.indexOf(p.crowd_level) : null;
    return { human: { src, t: o.at, crowd, label: src === 'chat' ? 'Attendee chat' : `${o.label} report` } };
  }
  if (p.kind === 'manual') {
    return { human: { src: 'manual', t: o.at, crowd: p.crowd_level ? CROWD_LEVELS.indexOf(p.crowd_level) : null, label: `${o.label} (manual)` } };
  }
  return null;
}

export interface Sibling { id: string; name: string; zoneType: ZoneType; track: ZoneTrack | null }
export interface DeriveCtx {
  now: number;
  type: ZoneType;
  queueRate: number | null;
  then: Array<{ crowd: number | null; people: number | null }>; // zone_metrics buckets 90–150 s ago with n_ok ≥ 2
  siblings: Sibling[];
  source: TrackSource;
}
export interface DeriveOut {
  state: ZoneTrackState;
  candidates: Candidate[];
  reason: string | null;
  crowdLevel: CrowdLevel | null; // compat → zones.crowd_level
  people: number | null;         // compat → zones.people_estimate
  bucket: { nOk: number; crowd: number | null; people: number | null; queue: number | null; wait: number | null; seats: number | null; walkway: number | null; hazard: number | null; tier: number; conf: number | null };
}

/** k-of-n latch: on when yes ≥ k among the values; off only once `clearN` values exist and all are no. */
function latch(on: boolean, values: boolean[], k: number, clearN: number): boolean {
  const yes = values.filter(Boolean).length;
  if (yes >= k) return true;
  if (on && !(values.length >= clearN && values.slice(-clearN).every((v) => !v))) return true;
  return false;
}

export function deriveZone(prev: ZoneTrackState, input: { cam: ZoneSample } | { human: HumanSample }, ctx: DeriveCtx): DeriveOut {
  const { now, type } = ctx;
  const P = ZONE_TYPE_PROFILE[type];
  const st: ZoneTrackState = JSON.parse(JSON.stringify(prev));
  const tr = st.track;
  const prevTier = tr.tier;
  const prevAction = tr.action;
  const cam = 'cam' in input ? input.cam : null;
  const human = 'human' in input ? input.human : null;
  const m: ZoneMetrics = { ...tr.metrics };

  // 2) window
  st.win = (cam ? [...st.win, cam] : st.win).filter((s) => s.t >= now - T.WINDOW_MS).slice(-T.KEEP_N);
  if (cam) {
    tr.badStreak = cam.ok ? 0 : tr.badStreak + 1;
    if (cam.ok) tr.lastUsableAt = cam.t;
  }
  const U = st.win.filter((s) => s.ok).slice(-T.WINDOW_N);
  const n = U.length;
  tr.nUsable = n;
  let S = m.crowd;
  let Q = m.queue;

  // 3) smoothing + multi-camera fusion
  if (n >= 1) {
    const devs = new Map<string, ZoneSample[]>();
    for (const s of U) devs.set(s.dev, [...(devs.get(s.dev) ?? []), s]);
    let groups = [...devs.values()].filter((g) => g[g.length - 1].t >= now - T.DEVICE_FRESH_MS);
    if (!groups.length) groups = [...devs.values()];
    const scores: number[] = [], peoples: number[] = [], queues: number[] = [];
    for (const g of groups) {
      const cs = g.map((s) => s.crowd).filter(nn).filter((c) => c >= 0);
      if (cs.length) { const md = median(cs); scores.push(mean(cs.map((x) => Math.max(md - 1, Math.min(md + 1, x))))); }
      const ps = g.map((s) => s.people).filter(nn);
      if (ps.length) peoples.push(median(ps));
      const qs = g.map((s) => s.queue).filter(nn);
      if (qs.length) queues.push(median(qs));
    }
    if (scores.length) S = round1(Math.max(...scores));
    m.crowd = S;
    m.people = peoples.length ? Math.round(Math.max(...peoples)) : m.people;
    Q = P.vision.includes('queue') && queues.length ? Math.round(Math.max(...queues)) : null;
    m.queue = Q;
    const seats = U.map((s) => s.seats).filter(nn);
    m.seatsFree = P.vision.includes('seating') && seats.length ? round1(median(seats)) : null;
    const walks = U.map((s) => s.walk).filter(nn);
    if (P.vision.includes('walkway') && walks.length) {
      const cnt = [0, 0, 0];
      for (const w of walks) cnt[w]++;
      const best = Math.max(...cnt);
      const mode = cnt.lastIndexOf(best) as 0 | 1 | 2; // ties → worse
      m.walkway = (['clear', 'narrowed', 'blocked'] as const)[mode];
    } else m.walkway = null;
    // k-of-n flags over the last usable frames
    const last3 = U.slice(-3);
    st.flags.spill = P.vision.includes('queue') ? latch(st.flags.spill, last3.map((s) => s.spill), 2, 3) : false;
    const w3 = U.map((s) => s.walk).filter(nn).slice(-3);
    const w5 = U.map((s) => s.walk).filter(nn).slice(-5);
    st.flags.blocked = P.vision.includes('walkway') ? latch(st.flags.blocked, w3.map((w) => w === 2), 2, 3) : false;
    st.flags.narrowed = P.vision.includes('walkway') ? latch(st.flags.narrowed, w5.map((w) => w >= 1), 3, 3) : false;
    const confirmed: Array<{ type: HazardType; conf: number }> = [];
    const types = new Set(last3.flatMap((s) => s.hz.map((h) => h.type)));
    for (const ty of types) {
      const hits = last3.map((s) => s.hz.find((h) => h.type === ty && h.h >= T.HAZARD_H)).filter(nn);
      if (hits.length >= 2 && mean(hits.map((h) => h.h)) >= T.HAZARD_MEAN_H) confirmed.push({ type: ty, conf: Math.max(...hits.map((h) => h.h)) });
    }
    if (cam && cam.ok) {
      for (const h of cam.hz) {
        if (LIFE_SAFETY_HAZARDS.includes(h.type) && h.h >= T.FAST_LANE_H && !confirmed.some((c) => c.type === h.type)) confirmed.push({ type: h.type, conf: h.h });
      }
    }
    st.flags.hazards = confirmed.map((c) => c.type);
    m.hazard = confirmed.sort((a, b) => b.conf - a.conf)[0] ?? null;
    m.walkwayFlag = st.flags.blocked ? 'blocked' : st.flags.narrowed ? 'narrowed' : null;
    m.queueSpills = st.flags.spill;
    tr.conf = Math.round(mean(U.map((s) => s.conf)) * Math.min(1, n / 3) * 100) / 100;
  }
  const rate = ctx.queueRate ?? P.queueRate;
  m.waitMin = rate && Q != null ? round05(Q / rate) : null;

  // 4) human input
  let activeHold = tr.hold && tr.hold.until > now ? tr.hold : null;
  if (human && human.src !== 'chat' && human.crowd != null && human.crowd >= 0) {
    const th = ([0, 0, 1, 2, 3] as Tier[])[human.crowd];
    tr.lastHumanAt = now;
    const cameraFresh = tr.lastUsableAt != null && now - tr.lastUsableAt <= T.CAMERA_FRESH_MS;
    if (cameraFresh) {
      tr.hold = { tier: Math.max(th, activeHold?.tier ?? 0) as Tier, until: now + T.HUMAN_HOLD_MS, by: human.label };
    } else {
      tr.crowdTier = th; st.crowdSince = now; S = human.crowd; m.crowd = human.crowd;
      tr.hold = { tier: th, until: now + T.HUMAN_HOLD_MS, by: human.label };
    }
    activeHold = tr.hold;
  }

  // 5) hysteresis
  const bands = P.crowd;
  if (n >= T.MIN_USABLE && S != null && cam) {
    const up: Tier = S >= bands.critical[0] ? 3 : S >= bands.crowded[0] ? 2 : S >= bands.busy[0] ? 1 : 0;
    const exitOf = (t: Tier) => (t === 3 ? bands.critical[1] : t === 2 ? bands.crowded[1] : bands.busy[1]);
    if (up > tr.crowdTier) { tr.crowdTier = up; st.crowdSince = now; }
    else if (tr.crowdTier > 0 && S < exitOf(tr.crowdTier) && now - st.crowdSince >= T.DEMOTE_DWELL_MS) { tr.crowdTier = (tr.crowdTier - 1) as Tier; st.crowdSince = now; }
  }
  const A = P.waitAlertMin;
  if (rate && A != null && n >= T.MIN_USABLE && cam) {
    const w = m.waitMin ?? 0;
    const up: Tier = st.flags.spill || w >= A ? 2 : w >= A / 2 ? 1 : 0;
    if (up > st.queueTier) { st.queueTier = up; st.queueSince = now; }
    else if (now - st.queueSince >= T.DEMOTE_DWELL_MS && ((st.queueTier === 2 && !st.flags.spill && w < 0.8 * A) || (st.queueTier === 1 && w < 0.4 * A))) {
      st.queueTier = (st.queueTier - 1) as Tier; st.queueSince = now;
    }
  }
  if (!rate || A == null) st.queueTier = 0;
  const holdTier = activeHold ? activeHold.tier : 0;
  const tier = Math.max(tr.crowdTier, st.queueTier, holdTier, type === 'corridor' && st.flags.blocked ? 2 : 0) as Tier;
  tr.tier = tier;
  tr.tierSince = tier !== prevTier ? now : tr.tierSince;
  let driver: MetricKey = 'crowd';
  if (m.hazard) driver = 'hazard';
  else if (st.flags.blocked) driver = 'walkway';
  else if (st.queueTier >= tr.crowdTier && st.queueTier > 0) driver = 'queue';
  tr.driver = S == null && !m.hazard ? null : driver;

  // 6) timers
  if (A != null) {
    const high = (m.waitMin ?? 0) >= A;
    st.waitHighSince = high ? (st.waitHighSince ?? now) : null;
    st.queueAtHigh = st.waitHighSince === now ? Q : st.queueAtHigh;
  }

  // 7) trend
  let trend: Trend | null = null;
  const thenC = ctx.then.map((r) => r.crowd).filter(nn);
  if (thenC.length && S != null) {
    const d = S - mean(thenC);
    const thenP = ctx.then.map((r) => r.people).filter(nn);
    const pThen = thenP.length ? mean(thenP) : null;
    const pNow = m.people;
    if (d >= T.TREND_DELTA || (pThen != null && pNow != null && pNow >= 1.3 * pThen && pNow - pThen >= 5)) trend = 'rising';
    else if (d <= -T.TREND_DELTA || (pThen != null && pNow != null && pNow <= 0.7 * pThen && pThen - pNow >= 5)) trend = 'falling';
    else trend = 'steady';
  }
  tr.trend = trend ?? tr.trend;
  st.risingSince = tr.trend === 'rising' ? (st.risingSince ?? now) : null;
  if (P.seatsWatch != null && m.seatsFree != null) {
    st.seatsLowSince = m.seatsFree <= P.seatsWatch ? (st.seatsLowSince ?? now) : m.seatsFree >= 0.5 ? null : st.seatsLowSince;
  } else st.seatsLowSince = null;

  // display values
  m.crowdLevel = S != null || activeHold ? crowdLevelOf(Math.max(tr.crowdTier, holdTier) as Tier, S) : m.crowdLevel;
  m.peopleText = peopleText(m.people, m.crowdLevel);

  // 8) incident candidates (camera frames only; vision never resolves anything)
  const candidates: Candidate[] = [];
  if (cam) {
    if (tr.crowdTier === 3 && n >= T.MIN_USABLE && S != null && S >= bands.critical[0]) {
      candidates.push({ type: 'overcrowding', detail: `${m.peopleText ?? 'Many'} people · packed`, confidence: Math.max(0.6, tr.conf) });
    }
    if (m.hazard) {
      for (const ty of st.flags.hazards) {
        const it = HAZARD_TO_INCIDENT[ty];
        if (!candidates.some((c) => c.type === it)) {
          candidates.push({ type: it, detail: `${HAZARD_TEXT[ty]} seen on camera`, confidence: Math.max(0.6, m.hazard.conf) });
        }
      }
    }
    if (st.flags.blocked && !candidates.some((c) => c.type === 'obstruction')) candidates.push({ type: 'obstruction', detail: 'Walkway / exit path blocked', confidence: Math.max(0.6, tr.conf) });
    const longQueue = (st.waitHighSince != null && now - st.waitHighSince >= T.QUEUE_HOLD_MS && Q != null && Q >= (st.queueAtHigh ?? 0)) || st.flags.spill;
    if (longQueue && rate && A != null) candidates.push({ type: 'long_queue', detail: `Queue ${Q ?? '?'} · ~${m.waitMin ?? '?'} min est.${st.flags.spill ? ' · spilling' : ''}`, confidence: Math.max(0.6, tr.conf) });
  }

  // 9) action (derive time)
  const name = (code: ActionCode): string => {
    switch (code) {
      case 'crowd_critical': return 'Hold entry · open another route';
      case 'path_blocked': return type === 'corridor' || type === 'entrance' ? 'Exit path blocked — clear it now' : 'Clear the blocked path';
      case 'lost_view': return 'Lost camera view of a busy zone — send someone to look';
      case 'open_desk': return type === 'entrance' ? 'Open another desk · put someone at the end of the line'
        : type === 'food' ? 'Open a second serving line' : type === 'restroom' ? 'Point people to the other restrooms' : 'Manage the queue · redirect people';
      case 'crowded': return type === 'corridor' ? 'Keep the corridor moving' : type === 'stage' ? 'Keep aisles clear · watch the front' : 'Keep people moving · watch the entry';
      case 'path_narrowed': return 'Path narrowing — keep it clear';
      case 'queue_building': return `Queue building · ~${m.waitMin ?? 0} min`;
      case 'filling': return 'Filling up — get ready to redirect';
      case 'seats_full': {
        const target = ctx.siblings
          .filter((z) => z.track?.metrics.seatsFree != null && z.track.metrics.seatsFree >= 0.5 && ['live', 'weak'].includes(signalAt(z.track, now)))
          .sort((a, b) => (b.zoneType === type ? 1 : 0) - (a.zoneType === type ? 1 : 0) || (b.track!.metrics.seatsFree! - a.track!.metrics.seatsFree!))[0];
        return target ? `Almost full → send people to ${target.name}` : 'Almost full';
      }
      case 'check_camera': return "Camera can't see — re-aim or wipe the lens";
      default: return '';
    }
  };
  const longQueueNow = rate && A != null && ((st.waitHighSince != null && now - st.waitHighSince >= T.QUEUE_HOLD_MS && Q != null && Q >= (st.queueAtHigh ?? 0)) || st.flags.spill);
  const rules: Array<[ActionCode, 'act' | 'watch', boolean]> = [
    ['crowd_critical', 'act', tr.crowdTier === 3],
    ['path_blocked', 'act', st.flags.blocked],
    ['lost_view', 'act', tr.badStreak >= T.BLIND_STREAK && tier >= 2],
    ['open_desk', 'act', !!longQueueNow],
    ['crowded', 'watch', tier === 2],
    ['path_narrowed', 'watch', st.flags.narrowed],
    ['queue_building', 'watch', st.queueTier === 1],
    ['filling', 'watch', st.risingSince != null && now - st.risingSince >= T.RISING_HOLD_MS && S != null && S >= bands.crowded[0] - 0.5 && tier < 2],
    ['seats_full', 'watch', st.seatsLowSince != null && now - st.seatsLowSince >= T.SEATS_HOLD_MS],
    ['check_camera', 'watch', tr.badStreak >= T.BLIND_STREAK && tier < 2],
  ];
  const hit = rules.find(([, , on]) => on);
  let action: ZoneAction | null = null;
  if (hit) {
    const [code, level] = hit;
    let target: ZoneAction['target'] = null;
    if (code === 'seats_full') {
      const t = ctx.siblings.find((z) => name('seats_full').endsWith(z.name));
      target = t ? { zoneId: t.id, name: t.name } : null;
    }
    action = {
      code, level, text: name(code), since: prevAction?.code === code ? prevAction.since : now, target,
      incidentType: code === 'crowd_critical' ? 'overcrowding' : code === 'path_blocked' ? 'obstruction' : code === 'open_desk' ? 'long_queue' : null,
    };
  }
  tr.action = action;
  tr.level = action?.level ?? 'ok';
  tr.metrics = m;
  tr.sources = [ctx.source, ...tr.sources.filter((s) => !(s.kind === ctx.source.kind && s.id === ctx.source.id))].slice(0, 4);
  tr.updatedAt = now;

  // status line
  const lowConf = cam && tr.conf < T.LIVE_CONF ? ' · low conf' : '';
  let reason: string | null = null;
  if (human && human.src !== 'chat' && human.crowd != null && (!cam)) reason = `${human.label} · ${CROWD_LABEL[CROWD_LEVELS[human.crowd]]}`;
  else if (cam && S != null) {
    const label = ctx.source.label;
    if (driver === 'hazard' && m.hazard) reason = `${label} · ${HAZARD_TEXT[m.hazard.type]} spotted`;
    else if (driver === 'walkway') reason = `${label} · Exit path blocked`;
    else if (driver === 'queue' && Q != null) reason = `${label} · Queue ${Q} · ~${m.waitMin ?? 0} min est.${st.flags.spill ? ' · spilling' : ''}`;
    else reason = `${label} · ${m.crowdLevel ? CROWD_LABEL[m.crowdLevel] : 'Clear'}${m.peopleText ? ` · ${m.peopleText} people` : ''}`;
    reason += lowConf;
  }

  const usableNow = cam?.ok ?? false;
  return {
    state: st,
    candidates,
    reason,
    crowdLevel: m.crowdLevel,
    people: m.people,
    bucket: {
      nOk: usableNow ? 1 : 0,
      crowd: usableNow || human ? S : null,
      people: usableNow ? m.people : null,
      queue: usableNow ? Q : null,
      wait: usableNow ? m.waitMin : null,
      seats: usableNow ? m.seatsFree : null,
      walkway: usableNow && m.walkway ? WALKWAY_RANK[m.walkway] : null,
      hazard: usableNow ? (m.hazard?.conf ?? 0) : null,
      tier,
      conf: usableNow ? tr.conf : null,
    },
  };
}

/** Status the zone shows from its tier (recomputeZone base). */
export const statusFromTrack = (t: ZoneTrack) => TIER_STATUS[t.tier];

/** One assistant/context line for a zone. */
export function zoneLine(z: { name: string; zoneType: ZoneType; status: string; track: ZoneTrack | null }, now: number): string {
  const t = z.track;
  if (!t) return `- ${z.name} [${z.zoneType}] · no data yet`;
  const m = t.metrics;
  const bits = [
    `${z.status} since ${Math.max(0, Math.round((now - t.tierSince) / 60000))}m`,
    m.peopleText ? `${m.peopleText} people` : null,
    m.queue != null ? `queue ${m.queue}${m.waitMin != null ? ` (~${m.waitMin} min est.)` : ''}${m.queueSpills ? ' spilling' : ''}` : null,
    m.seatsFree != null ? `seats ${Math.round(m.seatsFree * 100)}% free` : null,
    m.walkway ? `walkway ${m.walkway}` : null,
    m.hazard ? `hazard ${HAZARD_TEXT[m.hazard.type]}` : null,
    t.trend ? `trend ${t.trend}` : null,
    t.action ? `action: ${t.action.text}` : null,
    `signal ${signalAt(t, now)}`,
  ].filter(Boolean);
  return `- ${z.name} [${z.zoneType}] · ${bits.join(' · ')}`;
}

export const CERTAINTY_CONF = (c: keyof typeof CERTAINTY_WEIGHT, v: keyof typeof VIEW_WEIGHT) => CERTAINTY_WEIGHT[c] * VIEW_WEIGHT[v];
export { INCIDENT_LABEL };
