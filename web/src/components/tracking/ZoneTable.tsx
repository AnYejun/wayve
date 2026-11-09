// Zone tracking table + zone detail panel. One row per zone: what it is, how it is doing, what to do next — computed by the
// server tracker (Zone.track) and the 30-s metric buckets (sparklines). Cells a zone type doesn't track render '—'.
import { useMemo, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Camera, ChevronDown, Hand, MessageCircle, UserRound } from 'lucide-react';
import {
  CROWD_LABEL, ZONE_METRICS, ZONE_TYPE_LABEL, ZONE_TYPE_PROFILE, ZONE_TYPES, signalAt,
  type MetricKey, type MetricPoint, type Severity, type Signal, type Snapshot, type TrackLevel, type Zone, type ZoneType,
} from '@shared/contracts';
import { ZoneStatusPill } from '@/components/bits';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { SEVERITY_COLOR } from '@/design/status';
import { spring } from '@/design/motion';
import { useNow } from '@/lib/time';
import { serverNow } from '@/lib/live';
import { cn } from '@/lib/utils';
import { setZoneType, useZoneSeries } from './api';
import { age, liveAction, sortZones, zoneIssues } from './live';

const LEVEL_TONE: Record<TrackLevel, { fg: string; bg: string; dot: string }> = {
  act: { fg: '#b91c1c', bg: 'rgba(185,28,28,.07)', dot: '#b91c1c' },
  watch: { fg: '#86552e', bg: 'rgba(198,130,75,.10)', dot: '#c6824b' },
  ok: { fg: '#6b6965', bg: 'transparent', dot: '#b9b8b4' },
};
const SIGNAL_TONE: Record<Signal, { color: string; label: string }> = {
  live: { color: '#58a069', label: 'Live' }, weak: { color: '#c9a13f', label: 'Weak' }, stale: { color: '#8a8884', label: 'Stale' },
  blind: { color: '#b91c1c', label: 'Blind' }, none: { color: '#d5d5d4', label: 'No data' },
};
const TYPE_DOT: Record<ZoneType, string> = {
  stage: '#6E56F0', entrance: '#2F5BEA', food: '#C6824B', restroom: '#3EA0A5', workspace: '#17150f', lounge: '#A085CF', corridor: '#8a8884', general: '#b9b8b4',
};
const sevRank: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

const tracks = (z: Zone, k: MetricKey) => ZONE_TYPE_PROFILE[z.zoneType ?? 'general'].columns.includes(k);
const primary = (z: Zone, k: MetricKey) => ZONE_TYPE_PROFILE[z.zoneType ?? 'general'].primary.includes(k);

// ── tiny pieces ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Inline SVG sparkline (no chart lib). `bands` = enter thresholds drawn as faint guides on a 0–max scale. */
export function Sparkline({ points, pick, max, width = 72, height = 22, color = '#17150f', bands = [] }: {
  points: MetricPoint[] | undefined; pick: (p: MetricPoint) => number | null; max: number; width?: number; height?: number; color?: string; bands?: number[];
}) {
  const vals = (points ?? []).map((p) => ({ t: p.t, v: pick(p) })).filter((p): p is { t: number; v: number } => p.v != null);
  if (vals.length < 2) return <span className="inline-block text-[11px] text-fg-5" style={{ width }} aria-hidden>{vals.length ? '·' : ''}</span>;
  const t0 = vals[0].t, t1 = vals[vals.length - 1].t || t0 + 1;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (width - 4) + 2;
  const y = (v: number) => height - 2 - (Math.min(v, max) / max) * (height - 4);
  const d = vals.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = vals[vals.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 overflow-visible" aria-hidden>
      {bands.map((b) => <line key={b} x1={0} x2={width} y1={y(b)} y2={y(b)} stroke="rgba(23,21,15,.10)" strokeDasharray="2 3" strokeWidth={1} />)}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.t)} cy={y(last.v)} r={2.5} fill="#fff" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function Dash() { return <span className="text-fg-5" aria-label="not tracked">—</span>; }

function TrendIcon({ trend }: { trend: Zone['track'] extends infer T ? T extends { trend: infer R } ? R : null : null }) {
  if (!trend) return <Dash />;
  const I = trend === 'rising' ? ArrowUpRight : trend === 'falling' ? ArrowDownRight : ArrowRight;
  const c = trend === 'rising' ? '#c6824b' : trend === 'falling' ? '#376c45' : '#8a8884';
  return <span className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: c }}><I size={14} strokeWidth={2} />{trend === 'rising' ? 'Rising' : trend === 'falling' ? 'Falling' : 'Steady'}</span>;
}

function SignalCell({ zone, now }: { zone: Zone; now: number }) {
  const t = zone.track;
  const sig = signalAt(t, now);
  const tone = SIGNAL_TONE[sig];
  const last = t ? Math.max(t.lastUsableAt ?? 0, t.lastHumanAt ?? 0) : 0;
  const src = t?.sources[0];
  const SrcIcon = src?.kind === 'camera' ? Camera : src?.kind === 'chat' ? MessageCircle : src?.kind === 'manual' ? Hand : UserRound;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-2 whitespace-nowrap tabular-nums" title={src ? `Last input: ${src.label}` : undefined}>
      <span className="live-dot" style={{ color: tone.color }} data-ping={sig === 'live' || undefined} />
      {sig === 'none' ? <span className="text-fg-3">No data</span> : <>{tone.label} · {last ? age(now - last) : '—'}</>}
      {src ? <SrcIcon size={12} strokeWidth={1.75} className="text-fg-3" /> : null}
    </span>
  );
}

export function ZoneTypeChip({ zone, onChange }: { zone: Zone; onChange?: (t: ZoneType) => void }) {
  const t = zone.zoneType ?? 'general';
  return (
    <label className="relative inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium text-fg-2 transition-colors hover:bg-wash-2"
      style={{ boxShadow: 'inset 0 0 0 .5px rgba(23,21,15,.18)' }} onClick={(e) => e.stopPropagation()}>
      <span className="size-1.5 rounded-full" style={{ background: TYPE_DOT[t] }} />
      {ZONE_TYPE_LABEL[t].split(' / ')[0]}
      <ChevronDown size={11} strokeWidth={2} className="text-fg-3" />
      <select aria-label={`Zone type for ${zone.name}`} className="absolute inset-0 cursor-pointer opacity-0" value={t}
        onChange={(e) => { const v = e.target.value as ZoneType; onChange?.(v); void setZoneType(zone.id, v).catch(() => {}); }}>
        {ZONE_TYPES.map((x) => <option key={x} value={x}>{ZONE_TYPE_LABEL[x]}</option>)}
      </select>
    </label>
  );
}

function SeatsBar({ free }: { free: number }) {
  const pct = Math.round(free * 100);
  const c = free <= 0.2 ? '#c8553f' : free <= 0.5 ? '#c9a13f' : '#58a069';
  return (
    <span className="inline-flex items-center gap-2 text-[12px] tabular-nums text-fg-2">
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-wash-3"><motion.span className="absolute inset-y-0 left-0 rounded-full" style={{ background: c }} initial={false} animate={{ width: `${pct}%` }} transition={spring.smooth} /></span>
      ~{pct}%
    </span>
  );
}

const WALK_TONE = { clear: '#376c45', narrowed: '#86552e', blocked: '#b91c1c' } as const;

// ── table ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const COLS: Array<{ key: string; label: string; help?: string; align?: 'right'; w?: string }> = [
  { key: 'zone', label: 'Zone', w: 'min-w-[190px]' },
  { key: 'status', label: 'Status', w: 'min-w-[130px]' },
  { key: 'action', label: 'Next action', w: 'min-w-[220px]' },
  { key: 'crowd', label: ZONE_METRICS.crowd.label, help: ZONE_METRICS.crowd.help, w: 'min-w-[150px]' },
  { key: 'people', label: ZONE_METRICS.people.label, help: ZONE_METRICS.people.help },
  { key: 'trend', label: ZONE_METRICS.trend.label, help: ZONE_METRICS.trend.help },
  { key: 'queue', label: 'Queue · wait', help: ZONE_METRICS.wait.help, w: 'min-w-[120px]' },
  { key: 'seats', label: ZONE_METRICS.seats.label, help: ZONE_METRICS.seats.help },
  { key: 'walkway', label: ZONE_METRICS.walkway.label, help: ZONE_METRICS.walkway.help },
  { key: 'hazard', label: ZONE_METRICS.hazard.label, help: ZONE_METRICS.hazard.help },
  { key: 'issues', label: ZONE_METRICS.issues.label, help: ZONE_METRICS.issues.help, align: 'right' },
  { key: 'signal', label: ZONE_METRICS.signal.label, help: ZONE_METRICS.signal.help, w: 'min-w-[120px]' },
];

export function ZoneTable({ snap, onSelect, selectedId }: { snap: Snapshot; onSelect?: (zoneId: string) => void; selectedId?: string | null }) {
  const now = useNow(1000);
  const reduced = useReducedMotion();
  const zoneTick = useMemo(() => snap.zones.map((z) => `${z.id}:${z.version}`).join(','), [snap.zones]);
  const series = useZoneSeries(snap.event.id, zoneTick, 30);
  const rows = useMemo(() => sortZones(snap.zones, serverNow()), [snap.zones, Math.floor(now / 5000)]);

  if (!snap.zones.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-6 py-14 text-center">
        <p className="text-[15px] font-semibold text-fg">No zones yet</p>
        <p className="text-[13px] text-fg-2">Draw zones in Settings → Map. Each zone becomes a live row here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.key} title={c.help} scope="col"
                className={cn('sticky top-0 z-[1] border-b border-line-2 bg-white/95 px-3 py-2.5 text-[11.5px] font-semibold tracking-[.02em] text-fg-3 whitespace-nowrap backdrop-blur', c.align === 'right' && 'text-right', c.w)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {rows.map((z) => {
              const t = z.track;
              const m = t?.metrics;
              const action = liveAction(z, now);
              const lvl = action?.level ?? 'ok';
              const tone = LEVEL_TONE[lvl];
              const sig = signalAt(t, now);
              const dim = sig === 'stale' || sig === 'blind';
              const pts = series?.series[z.id];
              const bands = ZONE_TYPE_PROFILE[z.zoneType ?? 'general'].crowd;
              const iss = zoneIssues(snap, z.id);
              const topSev = iss.incidents.reduce<Severity | null>((s, i) => (!s || sevRank[i.severity] > sevRank[s] ? i.severity : s), null);
              const cell = (k: MetricKey, node: ReactNode) => (tracks(z, k) ? <span className={cn(!primary(z, k) && 'opacity-70')}>{node}</span> : <Dash />);
              const sel = selectedId === z.id;
              return (
                <motion.tr key={z.id} layout={!reduced} transition={spring.smooth}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onClick={() => onSelect?.(z.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(z.id); }}
                  className={cn('group cursor-pointer outline-none transition-colors', sel ? 'bg-[#f5f4f2]' : 'hover:bg-[#fafaf9]', dim && 'opacity-60')}>
                  <td className="border-b border-line-1 px-3 py-2.5 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: lvl === 'ok' ? 'transparent' : tone.dot }} aria-hidden />
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold tracking-[-0.01em] text-fg">{z.name}</div>
                        <div className="mt-0.5"><ZoneTypeChip zone={z} /></div>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-line-1 px-3 py-2.5">
                    <div className="flex flex-col items-start gap-0.5">
                      <ZoneStatusPill status={z.status} stale={dim} size="sm" />
                      {t && z.status !== 'unknown' ? <span className="text-[11px] text-fg-3 tabular-nums">for {age(now - t.tierSince)}</span> : null}
                    </div>
                  </td>
                  <td className="border-b border-line-1 px-3 py-2.5">
                    {action ? (
                      <span className="inline-flex max-w-[260px] items-start gap-1.5 rounded-[8px] px-2 py-1 text-[12.5px] font-medium leading-[17px]" style={{ color: tone.fg, background: tone.bg }}>
                        <span className="mt-[5px] size-1.5 shrink-0 rounded-full" style={{ background: tone.dot }} />
                        <span className="min-w-0">{action.text}<span className="ml-1 font-normal text-fg-3 tabular-nums">· {age(now - action.since)}</span></span>
                      </span>
                    ) : <span className="text-[12.5px] text-fg-3">{t ? 'All good' : '—'}</span>}
                  </td>
                  <td className="border-b border-line-1 px-3 py-2.5">
                    {m?.crowd != null ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[13px] font-medium text-fg whitespace-nowrap">{m.crowdLevel ? CROWD_LABEL[m.crowdLevel] : '—'} <span className="text-fg-3 tabular-nums">· {m.crowd.toFixed(1)}</span></span>
                        <Sparkline points={pts} pick={(p) => p.crowd} max={4} bands={[bands.busy[0], bands.crowded[0], bands.critical[0]]} />
                      </span>
                    ) : <Dash />}
                  </td>
                  <td className="border-b border-line-1 px-3 py-2.5 text-[13px] tabular-nums text-fg">{cell('people', m?.peopleText ?? <Dash />)}</td>
                  <td className="border-b border-line-1 px-3 py-2.5">{cell('trend', <TrendIcon trend={t?.trend ?? null} />)}</td>
                  <td className="border-b border-line-1 px-3 py-2.5 text-[13px] tabular-nums">
                    {cell('queue', m?.queue != null ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <AnimatedNumber value={m.queue} className="font-medium text-fg" />
                        <span className="text-fg-3">{m.waitMin != null ? `· ~${m.waitMin} min` : ''}</span>
                        {m.queueSpills ? <span className="rounded-[5px] bg-[rgba(198,130,75,.14)] px-1 text-[11px] font-semibold text-[#86552e]">spilling</span> : null}
                      </span>
                    ) : <Dash />)}
                  </td>
                  <td className="border-b border-line-1 px-3 py-2.5">{cell('seats', m?.seatsFree != null ? <SeatsBar free={m.seatsFree} /> : <Dash />)}</td>
                  <td className="border-b border-line-1 px-3 py-2.5 text-[12.5px] font-medium">
                    {cell('walkway', m?.walkway ? <span style={{ color: WALK_TONE[m.walkway] }} className="capitalize">{m.walkwayFlag ?? m.walkway}</span> : <Dash />)}
                  </td>
                  <td className="border-b border-line-1 px-3 py-2.5 text-[12.5px]">
                    {m?.hazard ? <span className="font-semibold text-[#b91c1c] capitalize">{m.hazard.type.replace('_', ' ')} <span className="font-normal text-fg-3 tabular-nums">{m.hazard.conf.toFixed(2)}</span></span> : <span className="text-fg-5">—</span>}
                  </td>
                  <td className="border-b border-line-1 px-3 py-2.5 text-right">
                    {iss.count ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold tabular-nums" style={{ color: topSev ? SEVERITY_COLOR[topSev] : '#17150f' }}>
                        {topSev ? <span className="size-1.5 rounded-full" style={{ background: SEVERITY_COLOR[topSev] }} /> : null}{iss.count}
                      </span>
                    ) : <span className="text-fg-5">0</span>}
                  </td>
                  <td className="border-b border-line-1 px-3 py-2.5"><SignalCell zone={z} now={now} /></td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

// ── detail panel ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Metric({ label, help, value, sub, children, off }: { label: string; help?: string; value: ReactNode; sub?: ReactNode; children?: ReactNode; off?: boolean }) {
  return (
    <div className={cn('rounded-[12px] border border-line-2 bg-white p-3', off && 'opacity-50')} title={help}>
      <div className="text-[11.5px] font-semibold tracking-[.02em] text-fg-3">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[20px] font-semibold tracking-[-0.02em] text-fg tabular-nums">{value}</div>
          {sub ? <div className="text-[12px] text-fg-3">{sub}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Zone detail block (Map section slide-over / zone sheet). */
export function ZoneTrackPanel({ zone, snap }: { zone: Zone; snap: Snapshot }) {
  const now = useNow(1000);
  const series = useZoneSeries(snap.event.id, zone.version, 30);
  const pts = series?.series[zone.id];
  const t = zone.track;
  const m = t?.metrics;
  const action = liveAction(zone, now);
  const tone = LEVEL_TONE[action?.level ?? 'ok'];
  const sig = signalAt(t, now);
  const prof = ZONE_TYPE_PROFILE[zone.zoneType ?? 'general'];
  const has = (k: MetricKey) => prof.columns.includes(k);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ZoneTypeChip zone={zone} />
        <ZoneStatusPill status={zone.status} stale={sig === 'stale' || sig === 'blind'} size="sm" />
        <span className="ml-auto"><SignalCell zone={zone} now={now} /></span>
      </div>

      <AnimatePresence initial={false} mode="popLayout">
        {action ? (
          <motion.div key={action.code} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth}
            className="rounded-[12px] px-3.5 py-3" style={{ background: tone.bg, boxShadow: `inset 0 0 0 .5px ${tone.dot}55` }}>
            <div className="text-[11.5px] font-semibold tracking-[.04em] uppercase" style={{ color: tone.fg }}>{action.level === 'act' ? 'Act now' : 'Watch'} · {age(now - action.since)}</div>
            <div className="mt-0.5 text-[15px] font-semibold tracking-[-0.01em] text-fg">{action.text}</div>
          </motion.div>
        ) : (
          <motion.div key="ok" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-[12px] border border-line-2 px-3.5 py-3 text-[13px] text-fg-2">
            {t ? 'Nothing needs action here right now.' : 'No observations yet. Point a camera at this zone or send a report.'}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Crowd" help={ZONE_METRICS.crowd.help} value={m?.crowd != null ? m.crowd.toFixed(1) : '—'} sub={m?.crowdLevel ? `${CROWD_LABEL[m.crowdLevel]}${t?.trend ? ` · ${t.trend}` : ''}` : 'level 0–4'}>
          <Sparkline points={pts} pick={(p) => p.crowd} max={4} width={88} height={30} bands={[prof.crowd.busy[0], prof.crowd.crowded[0], prof.crowd.critical[0]]} />
        </Metric>
        <Metric label="People" help={ZONE_METRICS.people.help} value={m?.peopleText ?? '—'} sub="approx.">
          <Sparkline points={pts} pick={(p) => p.people} max={Math.max(10, ...(pts ?? []).map((p) => p.people ?? 0))} width={88} height={30} color="#2F5BEA" />
        </Metric>
        <Metric label="Queue · wait" help={ZONE_METRICS.wait.help} off={!has('queue')} value={has('queue') && m?.queue != null ? m.queue : '—'}
          sub={has('queue') ? (m?.waitMin != null ? `~${m.waitMin} min est.${m.queueSpills ? ' · spilling' : ''}` : 'no line') : 'not tracked here'}>
          {has('queue') ? <Sparkline points={pts} pick={(p) => p.wait} max={Math.max(prof.waitAlertMin ?? 10, ...(pts ?? []).map((p) => p.wait ?? 0))} width={88} height={30} color="#C6824B" bands={prof.waitAlertMin ? [prof.waitAlertMin] : []} /> : null}
        </Metric>
        <Metric label="Seats free" help={ZONE_METRICS.seats.help} off={!has('seats')} value={has('seats') && m?.seatsFree != null ? `${Math.round(m.seatsFree * 100)}%` : '—'} sub={has('seats') ? 'of visible seats' : 'not tracked here'}>
          {has('seats') ? <Sparkline points={pts} pick={(p) => p.seats} max={1} width={88} height={30} color="#58a069" /> : null}
        </Metric>
        <Metric label="Walkway" help={ZONE_METRICS.walkway.help} off={!has('walkway')} value={<span className="capitalize" style={{ color: m?.walkway ? WALK_TONE[m.walkway] : undefined }}>{has('walkway') ? (m?.walkwayFlag ?? m?.walkway ?? '—') : '—'}</span>} />
        <Metric label="Hazard" help={ZONE_METRICS.hazard.help} value={m?.hazard ? <span className="capitalize text-[#b91c1c]">{m.hazard.type.replace('_', ' ')}</span> : 'None'} sub={m?.hazard ? `confidence ${m.hazard.conf.toFixed(2)}` : 'confirmed in 2 of 3 frames'} />
      </div>

      {t ? (
        <div className="rounded-[12px] border border-line-2 p-3">
          <div className="text-[11.5px] font-semibold tracking-[.02em] text-fg-3">Inputs</div>
          <ul className="mt-1.5 space-y-1">
            {t.sources.map((s) => (
              <li key={`${s.kind}:${s.id}`} className="flex items-center gap-2 text-[13px] text-fg-2">
                {s.kind === 'camera' ? <Camera size={13} strokeWidth={1.75} /> : s.kind === 'chat' ? <MessageCircle size={13} strokeWidth={1.75} /> : s.kind === 'manual' ? <Hand size={13} strokeWidth={1.75} /> : <UserRound size={13} strokeWidth={1.75} />}
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="text-[12px] text-fg-3 tabular-nums">{age(now - s.at)} ago</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[12px] text-fg-3 tabular-nums">
            {t.nUsable} usable frame{t.nUsable === 1 ? '' : 's'} in the last minute · confidence {Math.round(t.conf * 100)}%{t.hold && t.hold.until > now ? ` · held by ${t.hold.by} for ${age(t.hold.until - now)}` : ''}
          </div>
        </div>
      ) : null}
    </div>
  );
}
