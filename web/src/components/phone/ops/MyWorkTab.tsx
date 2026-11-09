// Staff "My work": issues assigned to me (urgent first), my team's open issues I can take, legacy incident tasks the
// tracker doesn't mirror yet, and a collapsed Done group. Issue cards open the evidence timeline sheet.
import { useState } from 'react';
import { Check, ChevronDown, Inbox } from 'lucide-react';
import type { Incident, Issue, Me, Snapshot, Task } from '@shared/contracts';
import { ago, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { IssueKey } from '@/components/ops-bits';
import { Skeleton } from '@/components/ui/skeleton';
import { TasksTab } from '../TasksTab';
import { CARD } from '../common';
import { IssueCard, IssueSheet, byUrgency, type ApplyIssue } from './issue';

type Apply = ApplyIssue & ((u: { kind: 'task'; data: Task } | { kind: 'incident'; data: Incident }) => void);

export function MyWorkTab({ snap, me, myTeamId, apply }: { snap: Snapshot | null; me: Me; myTeamId: string | null; apply: Apply }) {
  const now = useNow(5000);
  const [openIssue, setOpenIssue] = useState<Issue | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [showTasks, setShowTasks] = useState(false);

  if (!snap) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[176px] rounded-[16px]" />
        <Skeleton className="h-[176px] rounded-[16px]" />
      </div>
    );
  }

  const mine = snap.issues.filter((i) => i.assigneeId === me.participantId && i.status !== 'done').sort(byUrgency);
  const team = myTeamId
    ? snap.issues.filter((i) => i.teamId === myTeamId && i.assigneeId !== me.participantId && i.status !== 'done').sort(byUrgency)
    : [];
  const done = snap.issues.filter((i) => i.assigneeId === me.participantId && i.status === 'done')
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);

  // Camera/chat incidents create tasks; the server mirrors them as issues (incidentId). Show only tasks not mirrored.
  const mirrored = new Set(snap.issues.map((i) => i.incidentId).filter(Boolean));
  const legacy = snap.tasks.filter((t) => t.status !== 'done' && !mirrored.has(t.incidentId) && (t.assigneeId === me.participantId || t.assigneeId == null));
  const legacySnap: Snapshot = { ...snap, tasks: snap.tasks.filter((t) => !mirrored.has(t.incidentId)) };

  return (
    <div className="flex flex-col gap-7">
      {mine.length === 0 && team.length === 0 && legacy.length === 0 ? (
        <div className={cn(CARD, 'flex flex-col items-center px-6 py-10 text-center')}>
          <span className="grid size-12 place-items-center rounded-full bg-[#eef5f0] text-[#376c45]"><Check className="size-6" strokeWidth={2} /></span>
          <p className="mt-4 text-[17px] font-semibold text-fg">Nothing on your plate</p>
          <p className="mt-1 text-[14px] leading-5 text-fg-2">When someone names you in a meeting or on radio, the task lands here.</p>
        </div>
      ) : null}

      {mine.length > 0 ? (
        <Section title="Assigned to you" count={mine.length}>
          {mine.map((i) => <IssueCard key={i.id} issue={i} snap={snap} me={me} apply={apply} now={now} onOpen={setOpenIssue} />)}
        </Section>
      ) : null}

      {team.length > 0 ? (
        <Section title={`Your team · ${snap.teams.find((t) => t.id === myTeamId)?.name ?? ''}`} count={team.length}>
          {team.map((i) => <IssueCard key={i.id} issue={i} snap={snap} me={me} apply={apply} now={now} onOpen={setOpenIssue} variant="team" />)}
        </Section>
      ) : myTeamId == null && mine.length > 0 ? (
        <p className="flex items-center gap-2 px-1 text-[13px] text-fg-3"><Inbox className="size-4" strokeWidth={1.75} />Pick a team to see its work here too.</p>
      ) : null}

      {legacy.length > 0 ? (
        <section aria-label="Field incidents">
          <Collapser open={showTasks} onToggle={() => setShowTasks((v) => !v)} title="Field incidents" count={legacy.length} />
          {showTasks ? <div className="animate-in fade-in duration-200"><TasksTab snap={legacySnap} me={me} apply={apply} /></div> : null}
        </section>
      ) : null}

      {done.length > 0 ? (
        <section aria-label="Done">
          <Collapser open={showDone} onToggle={() => setShowDone((v) => !v)} title="Done" count={done.length} />
          {showDone ? (
            <ul className={cn(CARD, 'overflow-hidden animate-in fade-in duration-200')}>
              {done.map((i, n) => (
                <li key={i.id} className="relative">
                  {n > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden="true" /> : null}
                  <button type="button" onClick={() => setOpenIssue(i)} className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left active:bg-[rgb(23_21_15/.04)]">
                    <Check className="size-4 shrink-0 text-st-clear-fg" strokeWidth={2.25} />
                    <IssueKey k={i.key} />
                    <span className="min-w-0 flex-1 truncate text-[15px] text-fg-2">{i.title}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-fg-3">{ago(i.updatedAt, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <IssueSheet issue={openIssue} snap={snap} me={me} apply={apply} open={!!openIssue} onOpenChange={(o) => { if (!o) setOpenIssue(null); }} now={now} />
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2.5 px-1 text-[13px] font-semibold text-fg-2">{title} <span className="tabular-nums text-fg-3">{count}</span></h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Collapser({ open, onToggle, title, count }: { open: boolean; onToggle: () => void; title: string; count: number }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex h-11 w-full items-center gap-1.5 px-1 text-[13px] font-semibold text-fg-2">
      {title} <span className="tabular-nums text-fg-3">{count}</span>
      <ChevronDown className={cn('ml-auto size-4 transition-transform duration-200', open && 'rotate-180')} strokeWidth={1.75} />
    </button>
  );
}
