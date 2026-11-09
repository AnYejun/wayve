// Issue card (phone) + detail sheet with the evidence timeline. Status changes are optimistic; the server echo wins.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Clock, Hand, MapPin, Users } from 'lucide-react';
import {
  ISSUE_STATUS_LABEL, type Issue, type IssueEvent, type IssueStatus, type Me, type Snapshot,
} from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { ago, clock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { AiApplied, EvidenceQuote, IssueKey, IssueStatusPill, KindTag, PriorityBadge } from '@/components/ops-bits';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { CARD, Pill, Spinner } from '../common';

export type ApplyIssue = (u: { kind: 'issue'; data: Issue }) => void;

const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2, p3: 3 } as const;
export const byUrgency = (a: Issue, b: Issue) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
  || b.updatedAt - a.updatedAt;

export function DueLabel({ dueAt, done, now, className }: { dueAt: number | null; done: boolean; now: number; className?: string }) {
  if (!dueAt) return null;
  const late = !done && now > dueAt;
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 text-[12px] font-medium tabular-nums whitespace-nowrap', late ? 'text-[#b91c1c]' : 'text-fg-2', className)}>
      <Clock size={13} strokeWidth={1.75} />Due {clock(dueAt)}{late ? ' · overdue' : ''}
    </span>
  );
}

/** Patch an issue with an optimistic local apply; reverts on failure. */
export async function patchIssue(issue: Issue, patch: Partial<Pick<Issue, 'status' | 'assigneeId'>>, apply: ApplyIssue, okMsg?: string) {
  apply({ kind: 'issue', data: { ...issue, ...patch } });
  try {
    const r = await API.patchIssue(issue.id, patch);
    apply({ kind: 'issue', data: r.issue });
    if (okMsg) toast.success(okMsg);
    return true;
  } catch (e) {
    apply({ kind: 'issue', data: issue });
    toast.error((e as HttpError).message);
    return false;
  }
}

export function IssueCard({ issue, snap, me, apply, now, onOpen, variant = 'mine' }: {
  issue: Issue; snap: Snapshot; me: Me; apply: ApplyIssue; now: number; onOpen: (i: Issue) => void; variant?: 'mine' | 'team';
}) {
  const [busy, setBusy] = useState<IssueStatus | 'take' | null>(null);
  const team = snap.teams.find((t) => t.id === issue.teamId);
  const zone = snap.zones.find((z) => z.id === issue.zoneId);
  const assignee = snap.participants.find((p) => p.id === issue.assigneeId);
  const done = issue.status === 'done';

  const setStatus = async (s: IssueStatus) => {
    if (s === issue.status || busy) return;
    setBusy(s);
    await patchIssue(issue, { status: s }, apply, s === 'done' ? `${issue.key} marked done` : undefined);
    setBusy(null);
  };
  const take = async () => {
    setBusy('take');
    await patchIssue(issue, { assigneeId: me.participantId, status: 'in_progress' }, apply, `You took ${issue.key}`);
    setBusy(null);
  };

  return (
    <article className={cn(CARD, 'overflow-hidden', issue.priority === 'p0' && !done && 'shadow-[inset_0_0_0_1px_rgb(185_28_28/.45)]')}>
      <button type="button" onClick={() => onOpen(issue)} className="block w-full px-4 pt-3.5 pb-3 text-left active:bg-[#fafaf9]"
        aria-label={`${issue.key} ${issue.title}, details`}>
        <div className="flex items-center gap-2">
          <IssueKey k={issue.key} />
          <PriorityBadge priority={issue.priority} showLabel={issue.priority !== 'p3'} />
          <KindTag kind={issue.kind} />
          {issue.escalated && !done ? <span className="inline-flex h-6 items-center rounded-full bg-[#fdecec] px-2 text-[12px] font-semibold text-[#b91c1c]">With HQ</span> : null}
          {variant === 'team' && issue.status !== 'open' ? <IssueStatusPill status={issue.status} className="ml-auto" /> : null}
          <ChevronRight className={cn('size-4 shrink-0 text-fg-3', !(variant === 'team' && issue.status !== 'open') && 'ml-auto')} strokeWidth={1.75} />
        </div>
        <h3 className={cn('mt-2 text-[16px] leading-[22px] font-semibold tracking-[-0.01em] text-fg', done && 'text-fg-2 line-through decoration-[rgb(23_21_15/.3)]')}>{issue.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <DueLabel dueAt={issue.dueAt} done={done} now={now} />
          {team ? <span className="inline-flex h-6 items-center gap-1 text-[12px] text-fg-2"><Users size={13} strokeWidth={1.75} />{team.name}</span> : null}
          {zone ? <span className="inline-flex h-6 items-center gap-1 text-[12px] text-fg-2"><MapPin size={13} strokeWidth={1.75} />{zone.name}</span> : null}
          {variant === 'team' ? (
            <span className="text-[12px] text-fg-2">{assignee ? `Owner: ${assignee.displayName}` : issue.assigneeHint ? `Unassigned · mentioned: ${issue.assigneeHint}` : 'Unassigned'}</span>
          ) : null}
          <span className="text-[12px] tabular-nums text-fg-3">{ago(issue.updatedAt, now)}</span>
        </div>
        {issue.lastEvidence ? <EvidenceQuote e={issue.lastEvidence} className="mt-3" /> : null}
        {issue.createdBy === 'ai' || issue.evidenceCount > 1 ? (
          <div className="mt-2.5 flex items-center gap-2">
            {issue.createdBy === 'ai' ? <AiApplied /> : null}
            {issue.evidenceCount > 1 ? <span className="text-[12px] tabular-nums text-fg-3">{issue.evidenceCount} sources</span> : null}
          </div>
        ) : null}
      </button>

      {variant === 'mine' ? (
        <div className="px-3 pb-3">
          <div className="grid grid-cols-3 gap-1 rounded-[12px] bg-[#f5f4f2] p-[3px]" role="radiogroup" aria-label={`${issue.key} status`}>
            {(['in_progress', 'blocked', 'done'] as const).map((s) => {
              const on = issue.status === s;
              return (
                <button key={s} type="button" role="radio" aria-checked={on} disabled={!!busy} onClick={() => void setStatus(s)}
                  className={cn('flex h-10 items-center justify-center gap-1.5 rounded-[9px] text-[14px] font-medium transition-[background-color,scale,box-shadow] duration-150 active:scale-[.97]',
                    on ? 'bg-white text-fg shadow-[0_1px_2px_rgb(23_21_15/.08),0_0_0_.5px_rgb(23_21_15/.08)]' : 'text-fg-2',
                    on && s === 'blocked' && 'text-[#c8553f]', on && s === 'done' && 'text-[#376c45]')}>
                  {busy === s ? <Spinner className="size-4" /> : null}{ISSUE_STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
        </div>
      ) : issue.assigneeId ? null : (
        <div className="px-3 pb-3">
          <Pill tone="wash" size="md" className="w-full" disabled={!!busy} onClick={() => void take()}>
            {busy === 'take' ? <Spinner className="size-4" /> : <Hand strokeWidth={1.75} />}Take it
          </Pill>
        </div>
      )}
    </article>
  );
}

const EVENT_TEXT = (e: IssueEvent): string => {
  switch (e.kind) {
    case 'created': return 'Created';
    case 'status': return `Status ${e.from ?? '—'} → ${e.to ?? '—'}`;
    case 'assignee': return `Owner ${e.from ?? 'none'} → ${e.to ?? 'none'}`;
    case 'priority': return `Priority ${e.from ?? '—'} → ${e.to ?? '—'}`;
    case 'due': return `Due ${e.from ?? 'none'} → ${e.to ?? 'none'}`;
    case 'title': return `Renamed → ${e.to ?? ''}`;
    case 'team': return `Team ${e.from ?? 'none'} → ${e.to ?? 'none'}`;
    case 'evidence': return 'New source added';
    case 'escalated': return 'Escalated to HQ';
    case 'undo': return `Undone${e.to ? ` · ${e.to}` : ''}`;
  }
};

/** Bottom sheet: issue header + full timeline (each change with the exact words it came from). */
export function IssueSheet({ issue, snap, me, apply, open, onOpenChange, now }: {
  issue: Issue | null; snap: Snapshot; me: Me; apply: ApplyIssue; open: boolean; onOpenChange: (o: boolean) => void; now: number;
}) {
  const [events, setEvents] = useState<IssueEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = issue ? snap.issues.find((i) => i.id === issue.id) ?? issue : null;
  const liveEvents = live ? snap.issueEvents.filter((e) => e.issueId === live.id) : [];

  useEffect(() => {
    if (!open || !issue) return;
    setEvents(null); setErr(null);
    let alive = true;
    API.timeline(issue.id).then((r) => { if (alive) setEvents(r.events); }).catch((e: HttpError) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [open, issue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // merge fetched timeline with live frames that arrived after the fetch
  const merged = (() => {
    if (!events) return null;
    const map = new Map<number, IssueEvent>();
    for (const e of events) map.set(e.id, e);
    for (const e of liveEvents) map.set(e.id, e);
    return [...map.values()].sort((a, b) => b.at - a.at || b.id - a.id);
  })();

  const assignee = live ? snap.participants.find((p) => p.id === live.assigneeId) : undefined;
  const team = live ? snap.teams.find((t) => t.id === live.teamId) : undefined;
  const mine = live?.assigneeId === me.participantId;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        {live ? (
          <>
            <DrawerHeader className="pb-2 text-left">
              <div className="flex items-center gap-2">
                <IssueKey k={live.key} />
                <PriorityBadge priority={live.priority} />
                <KindTag kind={live.kind} />
                <IssueStatusPill status={live.status} className="ml-auto" />
              </div>
              <DrawerTitle className="mt-2 text-left text-[20px] leading-7 tracking-[-0.02em]">{live.title}</DrawerTitle>
              <DrawerDescription className="text-left">
                {[team?.name, assignee ? `Owner: ${assignee.displayName}` : live.assigneeHint ? `Unassigned · mentioned: ${live.assigneeHint}` : 'Unassigned']
                  .filter(Boolean).join(' · ')}
              </DrawerDescription>
              <DueLabel dueAt={live.dueAt} done={live.status === 'done'} now={now} />
            </DrawerHeader>
            <div className="max-h-[58dvh] overflow-y-auto px-4 pb-[calc(var(--safe-b)+20px)]">
              {!mine && live.status !== 'done' ? (
                <Pill size="md" className="mb-4 w-full" onClick={() => void patchIssue(live, { assigneeId: me.participantId, status: 'in_progress' }, apply, `You took ${live.key}`)}>
                  <Hand strokeWidth={1.75} />Take it
                </Pill>
              ) : null}
              <h4 className="mb-2 px-1 text-[13px] font-semibold text-fg-2">History</h4>
              {err ? <p className="rounded-[12px] bg-[#f5f4f2] p-4 text-[14px] text-fg-2">{err}</p>
                : !merged ? (
                  <div className="flex flex-col gap-2"><Skeleton className="h-16 rounded-[12px]" /><Skeleton className="h-16 rounded-[12px]" /></div>
                ) : merged.length === 0 ? (
                  <p className="rounded-[12px] bg-[#f5f4f2] p-4 text-[14px] text-fg-2">No history yet.</p>
                ) : (
                  <ol className="relative flex flex-col gap-4 pl-5">
                    <span className="absolute top-1.5 bottom-1.5 left-[5px] w-px bg-[rgb(23_21_15/.12)]" aria-hidden="true" />
                    {merged.map((e) => (
                      <li key={e.id} className={cn('relative', e.undone && 'opacity-50')}>
                        <span className={cn('absolute top-1.5 -left-5 size-[11px] rounded-full border-2 border-white',
                          e.actor === 'ai' ? 'bg-[#17150f]' : e.actor === 'rule' ? 'bg-[#8a8884]' : 'bg-[#58a069]')} aria-hidden="true" />
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={cn('text-[14px] font-medium text-fg', e.undone && 'line-through')}>{EVENT_TEXT(e)}</span>
                          {e.actor === 'ai' ? <AiApplied confidence={e.confidence} /> : null}
                        </div>
                        <p className="mt-0.5 text-[12px] tabular-nums text-fg-3">{e.actorName} · {clock(e.at)} · {ago(e.at, now)}</p>
                        {e.evidence.map((ev) => <EvidenceQuote key={`${ev.type}:${ev.id}`} e={ev} className="mt-2" clamp={4} />)}
                      </li>
                    ))}
                  </ol>
                )}
            </div>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
