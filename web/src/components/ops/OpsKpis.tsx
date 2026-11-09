// One hairline card, 4 cells: open issues · urgent · unacked radio · lines in the last 10 min.
import { AnimatedNumber } from '@/components/AnimatedNumber';
import type { Snapshot } from '@shared/contracts';
import { cn } from '@/lib/utils';
import { isMsgOverdue, isOverdue, isUnacked, liveScribes } from './util';

export function OpsKpis({ snap, now }: { snap: Snapshot; now: number }) {
  const open = snap.issues.filter((i) => i.status !== 'done');
  const blocked = open.filter((i) => i.status === 'blocked').length;
  const late = open.filter((i) => isOverdue(i, now)).length;
  const urgent = open.filter((i) => i.priority === 'p0');
  const escalated = open.filter((i) => i.escalated).length;
  const unacked = snap.messages.filter(isUnacked);
  const overdueMsgs = unacked.filter((m) => isMsgOverdue(m, now)).length;
  const recent = snap.utterances.filter((u) => now - u.startedAt < 10 * 60_000).length;
  const scribes = liveScribes(snap, now).length;

  const cells: Array<{ label: string; value: number; unit: string; sub: string; tone?: 'danger' | 'quiet' }> = [
    { label: 'Open issues', value: open.length, unit: '', sub: blocked || late ? [blocked ? `Blocked ${blocked}` : '', late ? `Overdue ${late}` : ''].filter(Boolean).join(' · ') : 'Nothing blocked', tone: blocked || late ? 'danger' : 'quiet' },
    { label: 'Urgent', value: urgent.length, unit: '', sub: escalated ? `Needs HQ ${escalated}` : urgent.length ? 'All have owners' : 'Nothing urgent', tone: escalated ? 'danger' : 'quiet' },
    { label: 'Unacked radio', value: unacked.length, unit: '', sub: overdueMsgs ? `2m+ unacked ${overdueMsgs}` : unacked.length ? 'Waiting for acks' : 'All acknowledged', tone: overdueMsgs ? 'danger' : 'quiet' },
    { label: 'Lines, last 10 min', value: recent, unit: 'lines', sub: scribes ? `Scribes ${scribes} recording` : 'No scribes recording', tone: 'quiet' },
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-[rgb(23_21_15/.1)] bg-white lg:grid-cols-4">
      {cells.map((c, i) => (
        <div key={c.label} className={cn('p-5', i % 2 === 1 && 'border-l border-[rgb(23_21_15/.08)]', i >= 2 && 'border-t border-[rgb(23_21_15/.08)] lg:border-t-0', i >= 1 && 'lg:border-l lg:border-[rgb(23_21_15/.08)]')}>
          <div className="text-[14px] text-fg-2">{c.label}</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-[26px] leading-none font-semibold tracking-[-0.02em] tabular-nums"><AnimatedNumber value={c.value} /></span>
            <span className="text-[14px] text-fg-2">{c.unit}</span>
          </div>
          <div className={cn('mt-2 truncate text-[13px]', c.tone === 'danger' ? 'text-[#b91c1c]' : 'text-fg-3')}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
