// Compact per-zone metrics (occupancy, density, queue, hazards…). Today fed from the vision payload / zone row; when the
// zone tracking schema lands, only the mapping functions below change — the list renders any Metric[].
import { motion } from 'motion/react';
import { CROWD_LABEL, type Observation, type VisionPayload, type Zone } from '@shared/contracts';
import { cn } from '@/lib/utils';

export type Metric = { key: string; label: string; value: string; tone?: 'ok' | 'warn' | 'bad' | 'neutral' };
const TONE = { ok: 'text-[#2f7a45]', warn: 'text-[#8a5a12]', bad: 'text-[#b91c1c]', neutral: 'text-fg' } as const;

export function visionMetrics(p: VisionPayload): Metric[] {
  const dens = p.crowd_level;
  return [
    { key: 'people', label: 'People', value: `~${p.people_count}` },
    { key: 'density', label: 'Density', value: CROWD_LABEL[dens], tone: dens === 'critical' ? 'bad' : dens === 'high' ? 'warn' : dens === 'empty' || dens === 'low' ? 'ok' : 'neutral' },
    { key: 'queue', label: 'Queue', value: p.queue_present ? 'Yes' : 'No', tone: p.queue_present ? 'warn' : 'neutral' },
    { key: 'hazards', label: 'Hazards', value: p.hazards.length ? String(p.hazards.length) : 'None', tone: p.hazards.length ? 'bad' : 'ok' },
  ];
}

export function zoneMetrics(zone: Zone, latest?: Observation | null): Metric[] {
  // Tracked (smoothed) state first — it is what HQ sees in the zone table.
  const t = zone.track;
  if (t) {
    const m = t.metrics;
    const out: Metric[] = [];
    if (m.peopleText) out.push({ key: 'people', label: 'People', value: m.peopleText });
    if (m.crowdLevel) out.push({ key: 'density', label: 'Crowd', value: CROWD_LABEL[m.crowdLevel], tone: m.crowdLevel === 'critical' ? 'bad' : m.crowdLevel === 'high' ? 'warn' : 'neutral' });
    if (m.queue != null && m.queue > 0) out.push({ key: 'queue', label: 'Queue', value: m.waitMin != null ? `${m.queue} · ~${m.waitMin}m` : String(m.queue), tone: m.queueSpills ? 'warn' : 'neutral' });
    else if (m.seatsFree != null) out.push({ key: 'seats', label: 'Seats free', value: `${Math.round(m.seatsFree * 100)}%`, tone: m.seatsFree < 0.15 ? 'warn' : 'neutral' });
    if (t.trend) out.push({ key: 'trend', label: 'Trend', value: t.trend === 'rising' ? '↑ Rising' : t.trend === 'falling' ? '↓ Falling' : '→ Steady', tone: t.trend === 'rising' ? 'warn' : 'neutral' });
    if (out.length) return out.slice(0, 4);
  }
  if (latest?.payload.kind === 'vision' && latest.payload.scene_ok) return visionMetrics(latest.payload);
  const out: Metric[] = [];
  if (zone.peopleEstimate != null) out.push({ key: 'people', label: 'People', value: `~${zone.peopleEstimate}` });
  if (zone.crowdLevel) out.push({ key: 'density', label: 'Density', value: CROWD_LABEL[zone.crowdLevel], tone: zone.crowdLevel === 'critical' ? 'bad' : zone.crowdLevel === 'high' ? 'warn' : 'neutral' });
  return out;
}

export function MetricList({ metrics, className }: { metrics: Metric[]; className?: string }) {
  if (!metrics.length) return null;
  return (
    <dl className={cn('grid gap-px overflow-hidden rounded-[12px] bg-[rgb(23_21_15/.08)]', className)} style={{ gridTemplateColumns: `repeat(${Math.min(4, metrics.length)}, minmax(0, 1fr))` }}>
      {metrics.map((m) => (
        <div key={m.key} className="bg-[#fafaf9] px-2.5 py-2">
          <dt className="text-[11px] font-medium text-fg-3">{m.label}</dt>
          <motion.dd key={m.value} initial={{ opacity: 0.3, y: 2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            className={cn('truncate text-[15px] font-semibold tabular-nums', TONE[m.tone ?? 'neutral'])}>{m.value}</motion.dd>
        </div>
      ))}
    </dl>
  );
}
