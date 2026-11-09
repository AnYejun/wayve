// Field (home): greeting, my location, the live venue map, what needs me, alerts, quick actions.
import { useState } from 'react';
import { motion } from 'motion/react';
import { Ban, ChevronRight, MapPin, MessageCircleQuestion, Radio, SquarePen, TriangleAlert } from 'lucide-react';
import type { Issue, Me, Snapshot } from '@shared/contracts';
import { ago, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { rise, spring, stagger } from '@/design/motion';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { ZoneStatusPill, isStale } from '@/components/bits';
import { IssueKey, PriorityBadge } from '@/components/ops-bits';
import { CARD, ZoneSheet } from '../common';
import { MetricList, zoneMetrics } from '../MetricList';
import { MapCard } from '../MapCard';
import { byUrgency } from '../ops/issue';
import { ackedBy, isForMe } from './RadioTab';
import { SectionTitle, haptic } from './shell';

const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

export function FieldTab({ snap, me, name, myTeamId, myZoneId, onZone, onGo, onOpenIssue }: {
  snap: Snapshot; me: Me; name: string; myTeamId: string | null; myZoneId: string | null; onZone: (zoneId: string) => void;
  onGo: (t: 'report' | 'radio' | 'ask' | 'tasks') => void; onOpenIssue: (i: Issue) => void;
}) {
  const now = useNow(10_000);
  const [zoneOpen, setZoneOpen] = useState(false);
  const zone = snap.zones.find((z) => z.id === myZoneId);
  const mine = snap.issues.filter((i) => i.assigneeId === me.participantId && i.status !== 'done').sort(byUrgency);
  const alerts = snap.issues.filter((i) => i.status !== 'done' && (i.escalated || i.status === 'blocked' || i.priority === 'p0') && (i.teamId === myTeamId || i.assigneeId === me.participantId || i.priority === 'p0')).sort(byUrgency).slice(0, 4);
  const unheard = snap.messages.filter((m) => isForMe(m, me, myTeamId) && !ackedBy(m, me.participantId));
  const first = name.split(/\s+/)[0];

  return (
    <motion.div variants={stagger(0.05)} initial="initial" animate="animate" className="flex flex-col gap-6">
      <motion.div variants={rise} className="px-1">
        <h1 className="text-[32px] leading-[38px] font-bold tracking-[-0.03em] text-fg">{greet()}, {first}</h1>
        <button type="button" onClick={() => setZoneOpen(true)} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-white pr-3 pl-2.5 text-[15px] font-semibold text-fg shadow-[inset_0_0_0_.5px_rgb(23_21_15/.16)] active:scale-[.97] transition-transform">
          <MapPin className="size-4 text-fg-2" strokeWidth={1.75} />{zone ? `You're at ${zone.name}` : 'Set your location'}
          {zone ? <ZoneStatusPill status={zone.status} stale={isStale(zone, now)} size="sm" className="ml-1" /> : null}
        </button>
        {zone ? <MetricList metrics={zoneMetrics(zone, snap.observations.find((o) => o.zoneId === zone.id && o.modality === 'vision'))} className="mt-3" /> : null}
        {zone?.track?.action ? (
          <p className="mt-2.5 flex items-start gap-2 rounded-[12px] bg-[#fff6ec] px-3 py-2.5 text-[14px] leading-[20px] font-medium text-[#86552e]">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#c6824b]" aria-hidden />{zone.track.action.text}
          </p>
        ) : null}
      </motion.div>

      <motion.div variants={rise} className="grid grid-cols-3 gap-2.5">
        {([['report', 'Report', SquarePen], ['radio', 'Talk', Radio], ['ask', 'Ask', MessageCircleQuestion]] as const).map(([t, label, Icon]) => (
          <motion.button key={t} type="button" whileTap={{ scale: 0.95 }} transition={spring.snappy} onClick={() => { haptic(8); onGo(t); }}
            className={cn(CARD, 'flex h-[76px] flex-col items-center justify-center gap-1.5 text-[14px] font-semibold text-fg')}>
            <Icon className="size-[22px]" strokeWidth={1.75} />{label}
          </motion.button>
        ))}
      </motion.div>

      <motion.section variants={rise}>
        <SectionTitle right={<span className="text-[13px] text-fg-3">{snap.zones.length} zones</span>}>Live map</SectionTitle>
        <MapCard snap={snap} highlightZoneId={myZoneId} highlightDeviceId={me.deviceId} onSelect={(z) => z && onZone(z)} />
      </motion.section>

      <motion.section variants={rise}>
        <SectionTitle right={mine.length ? <button type="button" onClick={() => onGo('tasks')} className="text-[14px] font-semibold text-fg-2">See all</button> : null}>
          Needs you {mine.length ? <AnimatedNumber value={mine.length} className="ml-1 text-fg-3" /> : null}
        </SectionTitle>
        {mine.length === 0 ? (
          <p className={cn(CARD, 'px-4 py-4 text-[15px] leading-[21px] text-fg-2')}>Nothing assigned to you right now. When someone names you in a meeting or on radio, it shows up here.</p>
        ) : (
          <ul className={cn(CARD, 'overflow-hidden')}>
            {mine.slice(0, 3).map((i, n) => (
              <li key={i.id} className="relative">
                {n > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden /> : null}
                <button type="button" onClick={() => onOpenIssue(i)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left active:bg-[rgb(23_21_15/.04)]">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><IssueKey k={i.key} /><PriorityBadge priority={i.priority} showLabel={i.priority === 'p0' || i.priority === 'p1'} /></span>
                    <span className="mt-0.5 block truncate text-[16px] font-semibold text-fg">{i.title}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-fg-3">{ago(i.updatedAt, now)}</span>
                  <ChevronRight className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </motion.section>

      {alerts.length || unheard.length ? (
        <motion.section variants={rise}>
          <SectionTitle>Alerts</SectionTitle>
          <div className="flex flex-col gap-2">
            {unheard.length ? (
              <button type="button" onClick={() => onGo('radio')} className="flex min-h-[56px] items-center gap-3 rounded-[16px] bg-[#fdecec] px-4 text-left">
                <Radio className="size-5 text-[#b91c1c]" strokeWidth={1.75} />
                <span className="flex-1 text-[15px] font-semibold text-[#8f1d1d]">{unheard.length} radio message{unheard.length > 1 ? 's' : ''} waiting for you</span>
                <ChevronRight className="size-4 text-[#b91c1c]" strokeWidth={2} />
              </button>
            ) : null}
            {alerts.map((i) => (
              <button key={i.id} type="button" onClick={() => onOpenIssue(i)} className={cn(CARD, 'flex min-h-[56px] items-center gap-3 px-4 py-2 text-left')}>
                {i.status === 'blocked' ? <Ban className="size-5 shrink-0 text-[#c8553f]" strokeWidth={1.75} /> : <TriangleAlert className="size-5 shrink-0 text-[#b91c1c]" strokeWidth={1.75} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-fg">{i.title}</span>
                  <span className="block text-[13px] text-fg-3">{i.escalated ? 'Escalated to HQ' : i.status === 'blocked' ? 'Blocked' : 'Urgent'} · {i.key}</span>
                </span>
              </button>
            ))}
          </div>
        </motion.section>
      ) : null}

      <ZoneSheet open={zoneOpen} onOpenChange={setZoneOpen} zones={snap.zones} selectedId={myZoneId} title="Where are you?"
        description="We route nearby issues to you first." onSelect={(z) => { onZone(z.id); setZoneOpen(false); }} />
    </motion.div>
  );
}
