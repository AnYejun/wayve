// Zone detail (used by the Map view rail and the ops zone sheet): status, crowd, people, open issues, recent reports,
// cameras covering it, and a metrics block placeholder for the zone tracking schema.
import { motion } from 'motion/react';
import { ZoneTrackPanel } from '@/components/tracking/ZoneTable';
import { Camera, Mic } from 'lucide-react';
import { CROWD_LABEL, DEVICE_OFFLINE_MS, type Snapshot, type Zone } from '@shared/contracts';
import { ZoneStatusPill, isStale } from '@/components/bits';
import { IssueKey, IssueStatusPill, PriorityBadge } from '@/components/ops-bits';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { spring } from '@/design/motion';
import { ago } from '@/lib/time';

export function zoneStats(snap: Snapshot, z: Zone, now: number) {
  const issues = snap.issues.filter((i) => i.zoneId === z.id && i.status !== 'done');
  const reports = snap.reports.filter((r) => r.zoneId === z.id);
  const cams = snap.devices.filter((d) => (d.regions?.length ? d.regions.some((r) => r.zoneId === z.id) : d.zoneId === z.id) && d.deviceType !== 'reporter');
  const online = cams.filter((d) => now - d.lastSeenAt < DEVICE_OFFLINE_MS);
  return { issues, reports, cams, online };
}

export function ZoneDetail({ snap, zone, now, onIssue, onReport }: {
  snap: Snapshot; zone: Zone; now: number; onIssue?: (id: string) => void; onReport?: (id: string) => void;
}) {
  const { issues, reports, cams, online } = zoneStats(snap, zone, now);
  const stale = isStale(zone, now);
  return (
    <motion.div key={zone.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[22px] font-semibold tracking-[-0.02em] text-fg">{zone.name}</h3>
        <ZoneStatusPill status={zone.status} stale={stale} />
      </div>
      <p className="mt-1 text-[13px] text-fg-2">{zone.statusReason ?? (zone.lastObservedAt ? `Updated ${ago(zone.lastObservedAt, now)}` : 'No observations yet')}</p>
      <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-[14px] border border-[rgb(23_21_15/.1)] bg-white">
        <Stat label="People" value={zone.peopleEstimate != null ? <AnimatedNumber value={zone.peopleEstimate} /> : '—'} />
        <Stat label="Crowd" value={zone.crowdLevel ? CROWD_LABEL[zone.crowdLevel] : '—'} />
        <Stat label="Open issues" value={<AnimatedNumber value={issues.length} />} />
      </div>
      {/* Metrics block — filled by the zone tracking schema (occupancy, density, queue, wait, flow, hazards). */}
      <div data-slot="zone-metrics" className="mt-3"><ZoneTrackPanel zone={zone} snap={snap} /></div>
      <Block title="Issues">
        {issues.length ? issues.slice(0, 6).map((i) => (
          <button key={i.id} type="button" onClick={() => onIssue?.(i.id)} className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left hover:bg-[rgb(23_21_15/.04)]">
            <IssueStatusPill status={i.status} iconOnly /><IssueKey k={i.key} />
            <span className="min-w-0 flex-1 truncate text-[14px] text-fg">{i.title}</span><PriorityBadge priority={i.priority} showLabel={false} />
          </button>
        )) : <Empty>No open issues here</Empty>}
      </Block>
      <Block title="Field reports">
        {reports.length ? reports.slice(0, 4).map((r) => (
          <button key={r.id} type="button" onClick={() => onReport?.(r.id)} className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-[rgb(23_21_15/.04)]">
            {r.photoUrl ? <img src={r.photoUrl} alt="" className="size-10 shrink-0 rounded-[8px] object-cover" /> : <span className="size-10 shrink-0 rounded-[8px] bg-[#f5f4f2]" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-fg">{r.ai?.title ?? r.text ?? r.transcript ?? 'Report'}</span>
              <span className="block text-[12px] text-fg-3">{r.authorName} · {ago(r.createdAt, now)}</span>
            </span>
          </button>
        )) : <Empty>No reports yet</Empty>}
      </Block>
      <Block title="Watching this zone">
        {cams.length ? cams.map((d) => {
          const on = online.includes(d);
          const I = d.deviceType === 'scribe' ? Mic : Camera;
          return (
            <div key={d.id} className="flex items-center gap-2 px-2 py-1.5 text-[14px]">
              <I className="size-4 text-fg-2" strokeWidth={1.75} /><span className="flex-1 text-fg">{d.label}</span>
              <span className="text-[12px] tabular-nums" style={{ color: on ? '#376c45' : '#8a8884' }}>{on ? (d.lastFrameAt ? `frame ${ago(d.lastFrameAt, now)}` : 'online') : 'offline'}</span>
            </div>
          );
        }) : <Empty>No camera covers this zone</Empty>}
      </Block>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-3 py-3 [&+&]:border-l [&+&]:border-[rgb(23_21_15/.08)]">
      <p className="text-[12px] text-fg-2">{label}</p>
      <p className="mt-1 text-[20px] font-semibold tracking-[-0.01em] text-fg tabular-nums">{value}</p>
    </div>
  );
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-5"><p className="mb-1 px-2 text-[12px] font-semibold tracking-[.06em] text-fg-3 uppercase">{title}</p>{children}</section>;
}
function Empty({ children }: { children: React.ReactNode }) { return <p className="px-2 py-2 text-[13px] text-fg-3">{children}</p>; }
