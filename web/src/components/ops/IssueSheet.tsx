// Issue detail sheet: editable fields + the evidence timeline (every change with the exact words it came from; AI changes undoable).
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CircleAlert, LoaderCircle, RotateCcw } from 'lucide-react';
import {
  ISSUE_KIND_LABEL, ISSUE_STATUS_LABEL, ISSUE_STATUSES, PRIORITIES, PRIORITY_LABEL,
  type Issue, type IssueEvent, type IssueEventKind, type IssueStatus, type Priority, type Snapshot,
} from '@shared/contracts';
import { AiApplied, EvidenceQuote, IssueKey, KindTag, PriorityBadge, STATUS_COLOR, STATUS_ICON } from '@/components/ops-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { API, HttpError, api } from '@/lib/api';
import { PersonaGlyph } from '@/shell/live/crew';
import { ago, clock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Pick } from './IssueBoard';
import { Monogram } from './Person';
import { isOverdue, kstHHMM, kstTodayAt } from './util';
import { doneAt, firstResponseAt, resolvedBy } from '@/shell/metrics';
import { dur } from '@/shell/ui';

const CHANGE_LABEL: Record<IssueEventKind, string> = {
  created: 'Created', status: 'Status', assignee: 'Owner', priority: 'Priority', due: 'Due', title: 'Title', team: 'Teams',
  evidence: 'Evidence added', escalated: 'Escalated to HQ', undo: 'Undone',
};

type Apply = (u: { kind: 'issue'; data: Issue }) => void;

export function IssueSheet({ snap, issueId, onClose, apply, now }: {
  snap: Snapshot; issueId: string | null; onClose: () => void; apply: Apply; now: number;
}) {
  const issue = issueId ? snap.issues.find((i) => i.id === issueId) ?? null : null;
  return (
    <Sheet open={!!issueId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[480px]">
        {issue ? <Body key={issue.id} snap={snap} issue={issue} apply={apply} now={now} /> : (
          <div className="p-6">
            <SheetHeader><SheetTitle>Couldn’t find that issue</SheetTitle><SheetDescription>It was removed, or it’s still loading.</SheetDescription></SheetHeader>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Body({ snap, issue: i, apply, now }: { snap: Snapshot; issue: Issue; apply: Apply; now: number }) {
  const [title, setTitle] = useState(i.title);
  useEffect(() => setTitle(i.title), [i.title]);
  const [due, setDue] = useState(i.dueAt ? kstHHMM(i.dueAt) : '');
  useEffect(() => setDue(i.dueAt ? kstHHMM(i.dueAt) : ''), [i.dueAt]);
  const [busy, setBusy] = useState(false);
  const staff = useMemo(() => snap.participants.filter((p) => p.role === 'staff' || p.role === 'admin'), [snap.participants]);
  const assignee = i.assigneeId ? snap.participants.find((p) => p.id === i.assigneeId) : null;
  const team = i.teamId ? snap.teams.find((t) => t.id === i.teamId) : null;

  const patch = async (b: Parameters<typeof API.patchIssue>[1]) => {
    setBusy(true);
    try { const r = await API.patchIssue(i.id, b); apply({ kind: 'issue', data: r.issue }); }
    catch (e) { toast.error((e as HttpError).message); }
    setBusy(false);
  };

  return (
    <>
      <div className="mat-bar hairline-b sticky top-0 z-10 px-6 pt-5 pb-4">
        <SheetHeader className="gap-1">
          <div className="flex items-center gap-2 pe-8">
            <IssueKey k={i.key} className="text-[13px]" />
            <KindTag kind={i.kind} className="h-5 text-[11px]" />
            {i.createdBy === 'ai' && <AiApplied />}
            {busy && <LoaderCircle size={14} className="animate-spin text-fg-3" />}
          </div>
          <SheetTitle className="sr-only">{i.title}</SheetTitle>
          <SheetDescription className="sr-only">{ISSUE_KIND_LABEL[i.kind]} · {ISSUE_STATUS_LABEL[i.status]}</SheetDescription>
        </SheetHeader>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="Title"
          onBlur={() => { const t = title.trim(); if (!t) setTitle(i.title); else if (t !== i.title) patch({ title: t }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTitle(i.title); (e.target as HTMLInputElement).blur(); } }}
          className="-mx-2 mt-1.5 h-auto border-transparent bg-transparent px-2 py-1 text-[20px] leading-[28px] font-semibold tracking-[-0.02em] shadow-none hover:border-[rgb(23_21_15/.12)] sm:text-[20px]" />
        {i.escalated && i.status !== 'done' && (
          <div className="mt-2 flex items-center gap-2 rounded-[10px] bg-[#fee4e1] px-3 py-2 text-[13px] font-medium text-[#b91c1c]">
            <CircleAlert size={15} strokeWidth={2} />Nobody picked this up — escalated to HQ
          </div>
        )}
      </div>

      <div className="space-y-5 px-6 pt-5 pb-8">
        <StatusControl value={i.status} onChange={(s) => patch({ status: s })} />

        <div className="grid grid-cols-2 gap-2">
          <Pick label="Priority" value={PRIORITY_LABEL[i.priority]} options={PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]])} onPick={(v) => patch({ priority: v as Priority })} />
          <Pick label="Owner" value={assignee?.displayName ?? 'Unassigned'}
            options={[['', 'Unassigned'], ...staff.map((p) => [p.id, p.displayName] as [string, string])]} onPick={(v) => patch({ assigneeId: v || null })} />
          <Pick label="Teams" value={team?.name ?? 'No team'}
            options={[['', 'No team'], ...snap.teams.map((t) => [t.id, t.name] as [string, string])]} onPick={(v) => patch({ teamId: v || null })} />
          <label className={cn('flex h-11 items-center gap-2 rounded-[10px] bg-white px-3 shadow-[inset_0_0_0_1px_rgb(23_21_15/.12)]', isOverdue(i, now) && 'shadow-[inset_0_0_0_1px_rgb(185_28_28/.45)]')}>
            <span className="shrink-0 text-[12px] text-fg-3">Due</span>
            <input type="time" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due (local time)"
              onBlur={() => { const t = due ? kstTodayAt(due) : null; if (t !== i.dueAt) patch({ dueAt: t }); }}
              className={cn('min-w-0 flex-1 bg-transparent text-[14px] font-medium tabular-nums outline-none', isOverdue(i, now) && 'text-[#b91c1c]')} />
          </label>
        </div>
        {!assignee && i.assigneeHint && (
          <p className="-mt-2 text-[13px] text-fg-3">Name heard: <span className="font-medium text-fg-2">{i.assigneeHint}</span> · Didn’t match anyone on the team, so left unassigned</p>
        )}

        <div className="flex items-center gap-3 text-[12px] text-fg-3 tabular-nums">
          <PriorityBadge priority={i.priority} />
          <span>Created {clock(i.createdAt)}</span>
          <span>· Updated {ago(i.updatedAt, now)}</span>
        </div>

        <Resolution snap={snap} issue={i} now={now} />

        <WatchAgent snap={snap} issue={i} />

        <Timeline snap={snap} issue={i} apply={apply} />
      </div>
    </>
  );
}

function StatusControl({ value, onChange }: { value: IssueStatus; onChange: (s: IssueStatus) => void }) {
  return (
    <div className="grid grid-cols-4 gap-0 rounded-[10px] bg-[#f5f4f2] p-[3px]" role="radiogroup" aria-label="Status">
      {ISSUE_STATUSES.map((s) => {
        const I = STATUS_ICON[s];
        const on = s === value;
        return (
          <button key={s} type="button" role="radio" aria-checked={on} onClick={() => !on && onChange(s)}
            className={cn('flex h-9 items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium transition-[background-color,box-shadow,color] duration-200',
              on ? 'bg-white text-fg shadow-[0_1px_2px_rgb(23_21_15/.06),0_1px_1px_rgb(23_21_15/.04)]' : 'text-fg-2 hover:text-fg')}>
            <I size={14} strokeWidth={2} style={{ color: on ? STATUS_COLOR[s] : undefined }} />{ISSUE_STATUS_LABEL[s]}
          </button>
        );
      })}
    </div>
  );
}

function Timeline({ snap, issue, apply }: { snap: Snapshot; issue: Issue; apply: Apply }) {
  const [fetched, setFetched] = useState<IssueEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<number | null>(null);
  const live = useMemo(() => snap.issueEvents.filter((e) => e.issueId === issue.id), [snap.issueEvents, issue.id]);
  const liveCount = live.length;
  const reqId = useRef(0);

  // Load the full history; reload when a new event for this issue arrives over SSE.
  useEffect(() => {
    const id = ++reqId.current;
    API.timeline(issue.id)
      .then((r) => { if (id === reqId.current) { setFetched(r.events); setError(null); } })
      .catch((e: HttpError) => { if (id === reqId.current) setError(e.message); });
  }, [issue.id, liveCount, issue.version]);

  const events = useMemo(() => {
    const m = new Map<number, IssueEvent>();
    for (const e of fetched ?? []) m.set(e.id, e);
    for (const e of live) m.set(e.id, e); // live copy wins (undone / undoable flags)
    return [...m.values()].sort((a, b) => b.at - a.at || b.id - a.id);
  }, [fetched, live]);

  const undo = async (e: IssueEvent) => {
    setUndoing(e.id);
    try {
      const r = await API.undo(e.id);
      apply({ kind: 'issue', data: r.issue });
      toast.success('Undone');
    } catch (err) { toast.error((err as HttpError).message); }
    setUndoing(null);
  };

  return (
    <section aria-labelledby="tl-h">
      <h3 id="tl-h" className="text-[13px] font-semibold tracking-[.02em] text-fg-2">History</h3>
      {!fetched && !error && !events.length ? (
        <div className="mt-3 space-y-3">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-14 w-full rounded-[10px]" />)}</div>
      ) : error && !events.length ? (
        <p className="mt-3 rounded-[10px] bg-[#fafaf9] px-3 py-3 text-[13px] text-fg-2">Couldn’t load the history. {error}</p>
      ) : events.length === 0 ? (
        <p className="mt-3 text-[13px] text-fg-3">No history yet</p>
      ) : (
        <ol className="relative mt-3 space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-[rgb(23_21_15/.08)]">
          {events.map((e) => (
            <li key={e.id} className="relative flex gap-3">
              <span className="relative z-10 mt-0.5 shrink-0">
                {e.actor === 'human' ? <Monogram name={e.actorName} size={22} ink /> : (
                  <span className="inline-grid size-[22px] place-items-center rounded-full bg-white text-[10px] font-bold text-fg-2 shadow-[inset_0_0_0_1px_rgb(23_21_15/.18)]">
                    {e.actor === 'ai' ? 'AI' : 'R'}
                  </span>
                )}
              </span>
              <div className={cn('min-w-0 flex-1', e.undone && 'opacity-50')}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[13px] font-semibold">{e.actor === 'human' ? e.actorName : e.actor === 'ai' ? 'AI' : 'Rule'}</span>
                  {e.actor === 'ai' && <AiApplied confidence={e.confidence} />}
                  <span className="text-[12px] text-fg-3 tabular-nums">{clock(e.at)}</span>
                  {e.undone && <span className="text-[12px] font-medium text-fg-3">Undone</span>}
                </div>
                <p className={cn('mt-0.5 text-[14px] leading-5 text-fg', e.undone && 'line-through decoration-[rgb(23_21_15/.35)]')}>
                  {changeText(e)}
                </p>
                {e.evidence.length > 0 && (
                  <div className="mt-2 space-y-2">{e.evidence.slice(0, 4).map((ev) => <EvidenceQuote key={`${ev.type}-${ev.id}`} e={ev} clamp={3} />)}</div>
                )}
                {e.undoable && !e.undone && (
                  <Button variant="ghost" size="xs" className="mt-1.5 -ml-2" onClick={() => undo(e)} disabled={undoing != null}>
                    {undoing === e.id ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}Undo
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function changeText(e: IssueEvent): string {
  const label = CHANGE_LABEL[e.kind];
  if (e.kind === 'created') return e.to ? `Created · ${e.to}` : label;
  if (e.kind === 'evidence' || e.kind === 'escalated') return e.to ? `${label} · ${e.to}` : label;
  if (e.kind === 'undo') return e.to ? `${label} · ${e.to}` : label;
  return `${label}: ${e.from ?? 'None'} → ${e.to ?? 'None'}`;
}

/** Resolution tracking: how long it has been open, how fast someone responded, who closed it, on what evidence. */
function Resolution({ snap, issue: i, now }: { snap: Snapshot; issue: Issue; now: number }) {
  const closed = doneAt(i, snap.issueEvents);
  const first = firstResponseAt(i, snap.issueEvents);
  const by = resolvedBy(i, snap.issueEvents);
  const cells: Array<[string, string, boolean?]> = [
    [closed ? 'Resolved in' : 'Open for', dur((closed ?? now) - i.createdAt), !!closed],
    ['First response', first ? dur(first - i.createdAt) : 'Waiting'],
    [closed ? 'Resolved by' : 'Owner', closed ? by ?? '—' : snap.participants.find((p) => p.id === i.assigneeId)?.displayName ?? 'Unassigned'],
    ['Evidence', `${i.evidenceCount} ${i.evidenceCount === 1 ? 'record' : 'records'}`],
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-[rgb(23_21_15/.09)]">
      {cells.map(([k, v, good], idx) => (
        <div key={k} className={cn('px-3.5 py-2.5', idx % 2 === 1 && 'border-l border-[rgb(23_21_15/.07)]', idx >= 2 && 'border-t border-[rgb(23_21_15/.07)]')}>
          <div className="text-[11px] font-medium text-fg-3">{k}</div>
          <div className={cn('mt-0.5 truncate text-[14px] font-semibold tabular-nums', good ? 'text-[#376c45]' : 'text-fg')}>{v}</div>
        </div>
      ))}
    </div>
  );
}

/** Assign an AI crew agent to watch this issue until it's fixed (it confirms on the radio and proposes closing). */
function WatchAgent({ snap, issue }: { snap: Snapshot; issue: Issue }) {
  const crew = (snap.crew ?? []).filter((a) => a.active && (a.role === 'queue_watcher' || a.role === 'safety_sentinel' || a.role === 'crowd_analyst'));
  const watcher = (snap.crew ?? []).find((a) => a.watching.includes(issue.id)) ?? null;
  const [busy, setBusy] = useState(false);
  if (!crew.length && !watcher) return null;
  const set = async (agentId: string | null) => {
    setBusy(true);
    try { await api(`/api/issues/${issue.id}/assign-agent`, { body: { agentId } }); toast.success(agentId ? 'Agent is watching this issue' : 'Stopped watching'); }
    catch (e) { toast.error((e as HttpError).message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-4 flex items-center gap-3 rounded-[12px] border border-[rgb(23_21_15/.09)] px-3 py-2.5">
      {watcher ? <PersonaGlyph role={watcher.role} size={28} /> : <span className="grid size-7 place-items-center rounded-[8px] bg-wash-2 text-[11px] font-semibold text-fg-3">AI</span>}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-fg">{watcher ? `${watcher.name} is watching` : 'Watch & verify'}</div>
        <div className="text-[12px] text-fg-3">{issue.zoneId ? 'Confirms on the radio when the zone is back to normal.' : 'Needs a zone to verify from cameras.'}</div>
      </div>
      <select aria-label="Assign to agent" disabled={busy || !issue.zoneId} value={watcher?.id ?? ''} onChange={(e) => void set(e.target.value || null)}
        className="h-8 max-w-[160px] rounded-[8px] border border-[rgb(23_21_15/.15)] bg-white px-2 text-[13px]">
        <option value="">{watcher ? 'Stop watching' : 'Assign agent…'}</option>
        {crew.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </div>
  );
}
