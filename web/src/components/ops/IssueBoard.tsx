// HQ issue board: kanban (Open / In progress / Blocked / Done) or a dense Linear-style list. Team + kind filters.
import { AnimatePresence, motion } from 'motion/react';
import { spring } from '@/design/motion';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Columns3, Inbox, List, LoaderCircle, Plus, SlidersHorizontal } from 'lucide-react';
import {
  ISSUE_KIND_LABEL, ISSUE_KINDS, ISSUE_STATUS_LABEL, ISSUE_STATUSES, PRIORITIES, PRIORITY_LABEL,
  type Issue, type IssueKind, type IssueStatus, type Participant, type Priority, type Snapshot, type Team,
} from '@shared/contracts';
import { AiApplied, IssueKey, IssueStatusPill, KindTag, PriorityBadge, SourceTag } from '@/components/ops-bits';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { API, HttpError } from '@/lib/api';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import { cardClass, isOverdue, kstHHMM, kstTodayAt } from './util';
import { Person } from './Person';

const PRI_RANK: Record<Priority, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
const DONE_WINDOW_MS = 12 * 3600_000;
const DONE_PREVIEW = 8;

export type BoardFilter = { teamId: string | null; kind: IssueKind | null };

const sortIssues = (a: Issue, b: Issue) =>
  Number(b.escalated) - Number(a.escalated) || PRI_RANK[a.priority] - PRI_RANK[b.priority] || b.updatedAt - a.updatedAt;

export function IssueBoard({ snap, now, filter, setFilter, wide, flash, onOpen, apply }: {
  snap: Snapshot; now: number; filter: BoardFilter; setFilter: (f: BoardFilter) => void; wide: boolean;
  flash: Map<string, 'new' | 'updated'>; onOpen: (id: string) => void; apply: (u: { kind: 'issue'; data: Issue }) => void;
}) {
  const [mode, setMode] = useState<'board' | 'list'>('board');
  const [creating, setCreating] = useState(false);
  const view = wide ? mode : 'list';
  const people = useMemo(() => new Map(snap.participants.map((p) => [p.id, p])), [snap.participants]);
  const teams = useMemo(() => new Map(snap.teams.map((t) => [t.id, t])), [snap.teams]);

  const visible = useMemo(() => snap.issues.filter((i) =>
    (filter.teamId == null || i.teamId === filter.teamId)
    && (filter.kind == null || i.kind === filter.kind)
    && (i.status !== 'done' || now - i.updatedAt < DONE_WINDOW_MS)), [snap.issues, filter, now]);

  const byStatus = useMemo(() => {
    const m: Record<IssueStatus, Issue[]> = { open: [], in_progress: [], blocked: [], done: [] };
    for (const i of visible) m[i.status].push(i);
    for (const s of ISSUE_STATUSES) m[s].sort(s === 'done' ? (a, b) => b.updatedAt - a.updatedAt : sortIssues);
    return m;
  }, [visible]);

  return (
    <section id="board" aria-labelledby="board-h" className={cn(cardClass, 'scroll-mt-6 overflow-hidden')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-3">
        <h2 id="board-h" className="text-[15px] font-semibold tracking-[-0.01em]">
          Issues <span className="ml-1 font-medium text-fg-3 tabular-nums">{visible.filter((i) => i.status !== 'done').length}</span>
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {wide && (
            <ToggleGroup type="single" variant="segmented" size="sm" value={mode} onValueChange={(v) => v && setMode(v as 'board' | 'list')} aria-label="View">
              <ToggleGroupItem value="board" aria-label="Board"><Columns3 />Board</ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List"><List />List</ToggleGroupItem>
            </ToggleGroup>
          )}
          <Button size="sm" onClick={() => setCreating(true)}><Plus />New issue</Button>
        </div>
      </div>

      <Filters snap={snap} filter={filter} setFilter={setFilter} />

      {snap.issues.length === 0 ? (
        <Empty />
      ) : view === 'board' ? (
        <div className="grid grid-cols-4 gap-3 border-t border-[rgb(23_21_15/.06)] bg-[#fafaf9] p-3">
          {ISSUE_STATUSES.map((s) => (
            <Column key={s} status={s} issues={byStatus[s]} people={people} teams={teams} now={now} flash={flash} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <ListView issues={[...byStatus.blocked, ...byStatus.open, ...byStatus.in_progress, ...byStatus.done]}
          people={people} teams={teams} now={now} flash={flash} onOpen={onOpen} />
      )}

      <NewIssueDialog open={creating} onOpenChange={setCreating} snap={snap} defaultTeamId={filter.teamId} apply={apply} onCreated={onOpen} />
    </section>
  );
}

function Filters({ snap, filter, setFilter }: { snap: Snapshot; filter: BoardFilter; setFilter: (f: BoardFilter) => void }) {
  const chip = (active: boolean) => cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-[background-color,color,box-shadow,scale] duration-120 active:scale-[.97]',
    active ? 'bg-[#17150f] text-white' : 'bg-white text-fg-2 shadow-[inset_0_0_0_1px_rgb(23_21_15/.1)] hover:text-fg');
  return (
    <div className="flex items-center gap-2 px-5 pb-3">
      <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]" role="group" aria-label="Team filter">
        <button type="button" className={chip(filter.teamId == null)} aria-pressed={filter.teamId == null} onClick={() => setFilter({ ...filter, teamId: null })}>All</button>
        {snap.teams.map((t) => (
          <button key={t.id} type="button" className={chip(filter.teamId === t.id)} aria-pressed={filter.teamId === t.id}
            onClick={() => setFilter({ ...filter, teamId: filter.teamId === t.id ? null : t.id })}>{t.name}</button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="shrink-0">
            <SlidersHorizontal />{filter.kind ? ISSUE_KIND_LABEL[filter.kind] : 'Kind'}<ChevronDown className="text-fg-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Kind</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={filter.kind ?? 'all'} onValueChange={(v) => setFilter({ ...filter, kind: v === 'all' ? null : (v as IssueKind) })}>
            <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            {ISSUE_KINDS.map((k) => <DropdownMenuRadioItem key={k} value={k}>{ISSUE_KIND_LABEL[k]}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center border-t border-[rgb(23_21_15/.06)] px-6 pt-10 pb-12 text-center">
      <span className="inline-grid size-10 place-items-center rounded-[12px] bg-[#f5f4f2] text-fg"><Inbox size={20} strokeWidth={1.75} /></span>
      <p className="mt-3 text-[15px] font-medium">No issues yet</p>
      <p className="mt-1 max-w-[340px] text-[13px] leading-[19px] text-fg-3">Put a scribe phone on the meeting table or send a radio message — tasks and problems from what people say land here instantly.</p>
    </div>
  );
}

function Column({ status, issues, people, teams, now, flash, onOpen }: {
  status: IssueStatus; issues: Issue[]; people: Map<string, Participant>; teams: Map<string, Team>; now: number;
  flash: Map<string, 'new' | 'updated'>; onOpen: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = status === 'done' && !all ? issues.slice(0, DONE_PREVIEW) : issues;
  return (
    <div className="flex min-w-0 flex-col" aria-label={ISSUE_STATUS_LABEL[status]} role="list">
      <div className="flex h-8 items-center gap-2 px-1.5">
        <IssueStatusPill status={status} iconOnly />
        <span className="text-[13px] font-semibold">{ISSUE_STATUS_LABEL[status]}</span>
        <span className="text-[13px] text-fg-3 tabular-nums">{issues.length}</span>
      </div>
      <div className="mt-1.5 flex flex-col gap-2">
        {shown.length === 0 && (
          <div className="rounded-[12px] border border-dashed border-[rgb(23_21_15/.12)] px-3 py-5 text-center text-[12px] text-fg-3">Empty</div>
        )}
        <AnimatePresence initial={false}>
          {shown.map((i) => (
            <motion.div key={i.id} layoutId={`issue-card-${i.id}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={spring.smooth}>
              <IssueCard issue={i} people={people} teams={teams} now={now} flash={flash.get(i.id)} onOpen={onOpen} />
            </motion.div>
          ))}
        </AnimatePresence>
        {status === 'done' && issues.length > DONE_PREVIEW && (
          <button type="button" onClick={() => setAll((a) => !a)}
            className="h-8 rounded-[8px] text-[13px] font-medium text-fg-2 transition-colors hover:bg-[rgb(23_21_15/.04)] hover:text-fg">
            {all ? 'Collapse' : `${issues.length - DONE_PREVIEW} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function Assignee({ issue, people, compact }: { issue: Issue; people: Map<string, Participant>; compact?: boolean }) {
  const p = issue.assigneeId ? people.get(issue.assigneeId) : null;
  if (p) return <Person name={p.displayName} size={20} compact={compact} />;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3">
      <span className="size-5 shrink-0 rounded-full border border-dashed border-[rgb(23_21_15/.25)]" aria-hidden />
      <span className="truncate">{issue.assigneeHint ? `Unassigned · mentioned: ${issue.assigneeHint}` : 'Unassigned'}</span>
    </span>
  );
}

function Due({ issue, now }: { issue: Issue; now: number }) {
  if (issue.dueAt == null) return null;
  const late = isOverdue(issue, now);
  return <span className={cn('shrink-0 text-[12px] font-medium tabular-nums', late ? 'text-[#b91c1c]' : 'text-fg-2')}>{kstHHMM(issue.dueAt)}{late ? ' · overdue' : ''}</span>;
}

function IssueCard({ issue: i, people, teams, now, flash, onOpen }: {
  issue: Issue; people: Map<string, Participant>; teams: Map<string, Team>; now: number; flash?: 'new' | 'updated'; onOpen: (id: string) => void;
}) {
  const team = i.teamId ? teams.get(i.teamId)?.name : null;
  return (
    <button type="button" role="listitem" onClick={() => onOpen(i.id)}
      className={cn(
        'group relative w-full rounded-[12px] bg-white p-3 text-left shadow-[inset_0_0_0_1px_rgb(23_21_15/.1),0_1px_2px_rgb(23_21_15/.03)]',
        'transition-[background-color,box-shadow,scale] duration-[1200ms] ease-out hover:shadow-[inset_0_0_0_1px_rgb(23_21_15/.18),0_1px_2px_rgb(23_21_15/.04)] active:scale-[.985] active:duration-120',
        flash && 'bg-[#fbf5ec]',
        flash === 'new' && 'animate-in fade-in-0 slide-in-from-bottom-1.5 duration-300',
        i.escalated && i.status !== 'done' && 'shadow-[inset_3px_0_0_#b91c1c,inset_0_0_0_1px_rgb(185_28_28/.3)]',
        i.status === 'done' && 'opacity-75',
      )}>
      <div className="flex items-center gap-1.5">
        <IssueKey k={i.key} />
        <span className="ml-auto flex items-center gap-1.5">
          {i.createdBy === 'ai' && <AiApplied />}
          <PriorityBadge priority={i.priority} showLabel={false} />
        </span>
      </div>
      <div className={cn('mt-1.5 text-[15px] leading-[21px] font-semibold tracking-[-0.01em] text-fg', i.status === 'done' && 'text-fg-2 line-through decoration-[rgb(23_21_15/.25)]')}
        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {i.title}
      </div>
      {i.escalated && i.status !== 'done' && <div className="mt-1 text-[12px] font-semibold text-[#b91c1c]">Needs HQ</div>}
      <div className="mt-2.5 flex items-center gap-2">
        <span className="min-w-0 flex-1"><Assignee issue={i} people={people} /></span>
        <Due issue={i} now={now} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-fg-3">
        {i.kind !== 'task' && <KindTag kind={i.kind} className="h-5 text-[11px]" />}
        {team && <span className="truncate">{team}</span>}
        {i.lastEvidence && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
            {i.lastEvidence.type === 'utterance' && (i.lastEvidence.source === 'scribe' || i.lastEvidence.source === 'talk' || i.lastEvidence.source === 'chat' || i.lastEvidence.source === 'report')
              ? <SourceTag source={i.lastEvidence.source} /> : null}
            {i.evidenceCount > 1 && <span className="tabular-nums">Sources {i.evidenceCount}</span>}
          </span>
        )}
      </div>
    </button>
  );
}

function ListView({ issues, people, teams, now, flash, onOpen }: {
  issues: Issue[]; people: Map<string, Participant>; teams: Map<string, Team>; now: number; flash: Map<string, 'new' | 'updated'>; onOpen: (id: string) => void;
}) {
  if (!issues.length) {
    return <p className="border-t border-[rgb(23_21_15/.06)] px-5 py-8 text-center text-[14px] text-fg-3">No issues match this filter</p>;
  }
  return (
    <ul className="divide-y divide-[rgb(23_21_15/.06)] border-t border-[rgb(23_21_15/.06)]" role="list">
      {issues.map((i) => {
        const f = flash.get(i.id);
        const team = i.teamId ? teams.get(i.teamId)?.name : null;
        return (
          <li key={i.id}>
            <button type="button" onClick={() => onOpen(i.id)}
              className={cn('flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors duration-[1200ms] ease-out hover:bg-[rgb(23_21_15/.025)] active:bg-[rgb(23_21_15/.05)]',
                f ? 'bg-[#fbf5ec]' : 'bg-white', f === 'new' && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-300',
                i.escalated && i.status !== 'done' && 'shadow-[inset_3px_0_0_#b91c1c]')}>
              <IssueStatusPill status={i.status} iconOnly />
              <IssueKey k={i.key} className="hidden w-[52px] sm:inline" />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-[14px] font-medium text-fg', i.status === 'done' && 'text-fg-2 line-through decoration-[rgb(23_21_15/.25)]')}>{i.title}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[12px] text-fg-3 sm:hidden">
                  <IssueKey k={i.key} />{team && <span className="truncate">{team}</span>}<Due issue={i} now={now} />
                </span>
              </span>
              {i.escalated && i.status !== 'done' && <span className="hidden shrink-0 text-[12px] font-semibold text-[#b91c1c] md:inline">Needs HQ</span>}
              <span className="hidden w-[120px] shrink-0 md:block"><Assignee issue={i} people={people} compact /></span>
              <span className="hidden w-[72px] shrink-0 truncate text-[12px] text-fg-2 lg:block">{team ?? '—'}</span>
              <span className="hidden w-[64px] shrink-0 sm:block"><Due issue={i} now={now} /></span>
              <PriorityBadge priority={i.priority} showLabel={false} />
              <span className="hidden w-[52px] shrink-0 text-right text-[12px] text-fg-3 tabular-nums xl:block">{ago(i.updatedAt, now)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function NewIssueDialog({ open, onOpenChange, snap, defaultTeamId, apply, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; snap: Snapshot; defaultTeamId: string | null;
  apply: (u: { kind: 'issue'; data: Issue }) => void; onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<IssueKind>('task');
  const [priority, setPriority] = useState<Priority>('p2');
  const [teamId, setTeamId] = useState<string | null>(defaultTeamId);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const staff = snap.participants.filter((p) => p.role === 'staff' || p.role === 'admin');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await API.createIssue(snap.event.id, { title: title.trim(), kind, priority, teamId, assigneeId, dueAt: due ? kstTodayAt(due) : null });
      apply({ kind: 'issue', data: r.issue });
      toast.success(`${r.issue.key} created`);
      setTitle(''); setDue(''); setAssigneeId(null);
      onOpenChange(false);
      onCreated(r.issue.id);
    } catch (err) { toast.error((err as HttpError).message); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setTeamId(defaultTeamId); }}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>New issue</DialogTitle>
            <DialogDescription>Created by a person. It sits on the same board as issues from speech.</DialogDescription>
          </DialogHeader>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Print 200 more name badges" autoFocus maxLength={120} className="h-11 text-[16px]" />
          <div className="grid grid-cols-2 gap-2">
            <Pick label="Kind" value={ISSUE_KIND_LABEL[kind]} options={ISSUE_KINDS.map((k) => [k, ISSUE_KIND_LABEL[k]])} onPick={(v) => setKind(v as IssueKind)} />
            <Pick label="Priority" value={PRIORITY_LABEL[priority]} options={PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]])} onPick={(v) => setPriority(v as Priority)} />
            <Pick label="Teams" value={teamId ? snap.teams.find((t) => t.id === teamId)?.name ?? 'No team' : 'No team'}
              options={[['', 'No team'], ...snap.teams.map((t) => [t.id, t.name] as [string, string])]} onPick={(v) => setTeamId(v || null)} />
            <Pick label="Owner" value={assigneeId ? staff.find((p) => p.id === assigneeId)?.displayName ?? 'Unassigned' : 'Unassigned'}
              options={[['', 'Unassigned'], ...staff.map((p) => [p.id, p.displayName] as [string, string])]} onPick={(v) => setAssigneeId(v || null)} />
          </div>
          <label className="flex items-center gap-3 text-[14px] text-fg-2">
            Due
            <Input type="time" value={due} onChange={(e) => setDue(e.target.value)} className="h-10 w-[140px] text-[16px] tabular-nums" />
            <span className="text-[12px] text-fg-3">Today · local time</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !title.trim()}>{busy && <LoaderCircle className="animate-spin" />}Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Labelled dropdown field (radio menu). */
export function Pick({ label, value, options, onPick, className }: {
  label: string; value: string; options: Array<[string, string]>; onPick: (v: string) => void; className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('flex h-11 min-w-0 items-center gap-2 rounded-[10px] bg-white px-3 text-left shadow-[inset_0_0_0_1px_rgb(23_21_15/.12)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgb(23_21_15/.22)]', className)}>
          <span className="shrink-0 text-[12px] text-fg-3">{label}</span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{value}</span>
          <ChevronDown size={14} className="shrink-0 text-fg-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={options.find(([, l]) => l === value)?.[0] ?? ''} onValueChange={onPick}>
          {options.map(([v, l]) => <DropdownMenuRadioItem key={v || 'none'} value={v}>{l}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
