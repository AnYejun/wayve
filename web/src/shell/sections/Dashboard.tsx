// Dashboard = the live issue tracker: ask bar, KPIs, the board (with filters) and the live rail.
import { useSearchParams } from 'react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Inbox, X } from 'lucide-react';
import { PRIORITIES, PRIORITY_LABEL, type Issue, type Priority, type Snapshot } from '@shared/contracts';
import { AskBar } from '@/components/ops/AskBar';
import { IssueBoard, Pick, type BoardFilter } from '@/components/ops/IssueBoard';
import { IssueSheet } from '@/components/ops/IssueSheet';
import { CrewPostRow } from '../live/crew';
import { SidePanel, type PanelTab } from '@/components/ops/SidePanel';
import { useIssueFlash, useMediaQuery } from '@/components/ops/util';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/lib/time';
import { useShell } from '../context';
import { opsStats } from '../metrics';
import { KpiStrip, Page, SectionHeader, dur } from '../ui';

export default function DashboardSection() {
  const { snap, apply } = useShell();
  const now = useNow(1000);
  const wide = useMediaQuery('(min-width: 1280px)');
  const [filter, setFilter] = useState<BoardFilter>({ teamId: null, kind: null });
  const [assignee, setAssignee] = useState<string>('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [tab, setTab] = useState<PanelTab>('transcript');
  const [openId, setOpenId] = useState<string | null>(null);
  const flash = useIssueFlash(snap?.issues);
  // Deep link from Radio / Assistant: /e/:id/dashboard?issue=<id or key>
  const [params, setParams] = useSearchParams();
  const wanted = params.get('issue');
  useEffect(() => {
    if (!wanted || !snap) return;
    const i = snap.issues.find((x) => x.id === wanted || x.key === wanted);
    if (i) setOpenId(i.id);
    setParams((p) => { p.delete('issue'); return p; }, { replace: true });
  }, [wanted, snap, setParams]);

  const openIssue = useCallback((keyOrId: string) => {
    const i = snap?.issues.find((x) => x.id === keyOrId || x.key === keyOrId);
    if (i) setOpenId(i.id);
    else toast('Couldn’t find that issue', { description: `${keyOrId} was removed, or closed more than 12 hours ago.` });
  }, [snap?.issues]);

  // Assignee / priority filters on top of the board's own team + kind filters.
  const scoped: Snapshot | null = useMemo(() => {
    if (!snap) return null;
    if (!assignee && !priority) return snap;
    return { ...snap, issues: snap.issues.filter((i) => (!assignee || (assignee === '-' ? !i.assigneeId : i.assigneeId === assignee)) && (!priority || i.priority === priority)) };
  }, [snap, assignee, priority]);

  if (!snap || !scoped) {
    return <Page><Skeleton className="h-9 w-48" /><Skeleton className="mt-6 h-14 w-full rounded-full" /><Skeleton className="mt-5 h-[92px] w-full rounded-[14px]" /><Skeleton className="mt-5 h-[480px] w-full rounded-[14px]" /></Page>;
  }
  const st = opsStats(snap, now);
  const pending = snap.proposals.filter((p) => p.status === 'pending').length;
  const staff = snap.participants.filter((p) => p.role === 'staff' || p.role === 'admin');
  const filtered = !!(assignee || priority);

  return (
    <Page>
      <SectionHeader title="Dashboard" sub={<>Every issue on the floor, live. AI proposes from what it hears and sees; rules decide what lands here.</>}
        actions={
          <Button variant={pending ? 'default' : 'outline'} size="sm" onClick={() => setTab('proposals')}>
            <Inbox />Suggestions{pending ? <span className="ml-0.5 tabular-nums">{pending}</span> : null}
          </Button>
        } />

      <div className="mt-6"><AskBar snap={snap} teamId={filter.teamId} onOpenIssue={openIssue} /></div>

      <div className="mt-5">
        <KpiStrip items={[
          { label: 'Open', value: st.open, sub: st.unassigned ? `${st.unassigned} unassigned` : 'All have owners' },
          { label: 'Urgent', value: st.urgent, tone: 'danger', sub: st.escalated ? `${st.escalated} escalated to HQ` : 'Nothing escalated' },
          { label: 'Blocked', value: st.blocked, tone: 'danger', sub: st.blocked ? 'Needs a hand' : 'Nothing blocked' },
          { label: 'Unacked radio', value: st.unacked, tone: 'danger', sub: st.unacked ? 'Waiting for “Got it”' : 'Everyone heard' },
          { label: 'Resolved today', value: st.resolvedToday, tone: 'good', sub: st.resolvedToday ? 'Closed with evidence' : 'None yet' },
          { label: 'Median time to resolve', value: Number.isFinite(st.medianTtrMs) ? Math.round(st.medianTtrMs / 1000) : 0, format: (n) => (Number.isFinite(st.medianTtrMs) ? dur(n * 1000) : '—'), sub: 'Open → Done' },
        ]} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Pick label="Owner" className="h-9 w-[200px]" value={assignee === '' ? 'Anyone' : assignee === '-' ? 'Unassigned' : staff.find((p) => p.id === assignee)?.displayName ?? 'Anyone'}
          options={[['', 'Anyone'], ['-', 'Unassigned'], ...staff.map((p) => [p.id, p.displayName] as [string, string])]} onPick={setAssignee} />
        <Pick label="Priority" className="h-9 w-[170px]" value={priority ? PRIORITY_LABEL[priority] : 'Any'}
          options={[['', 'Any'], ...PRIORITIES.map((p) => [p, PRIORITY_LABEL[p]] as [string, string])]} onPick={(v) => setPriority(v as Priority | '')} />
        {filtered ? <Button variant="ghost" size="sm" onClick={() => { setAssignee(''); setPriority(''); }}><X />Clear</Button> : null}
      </div>

      <div className="mt-3 grid gap-5 xl:grid-cols-[minmax(0,1fr)_372px]">
        <div className="min-w-0">
          <IssueBoard snap={scoped} now={now} filter={filter} setFilter={setFilter} wide={wide} flash={flash} onOpen={setOpenId} apply={apply as (u: { kind: 'issue'; data: Issue }) => void} />
        </div>
        <div className="min-w-0 space-y-5 xl:sticky xl:top-5 xl:self-start">
          <SidePanel snap={snap} now={now} tab={tab} setTab={setTab} teamId={filter.teamId} onOpenIssue={openIssue} apply={apply}
            className="xl:max-h-[calc(100dvh-300px)]" />
          <CrewRail snap={snap} now={now} onOpenIssue={openIssue} />
        </div>
      </div>

      <IssueSheet snap={snap} issueId={openId} onClose={() => setOpenId(null)} apply={apply as (u: { kind: 'issue'; data: Issue }) => void} now={now} />
    </Page>
  );
}

/** Latest AI crew posts (radio calls, assignments, verified fixes) under the live rail. */
function CrewRail({ snap, now, onOpenIssue }: { snap: Snapshot; now: number; onOpenIssue: (k: string) => void }) {
  const posts = (snap.crewPosts ?? []).slice(0, 3);
  if (!(snap.crew ?? []).length) return null;
  const byId = new Map((snap.crew ?? []).map((a) => [a.id, a]));
  return (
    <section className="rounded-[14px] border border-[rgb(23_21_15/.09)] bg-white px-4 pt-3 pb-1 shadow-[0_1px_2px_rgb(23_21_15/.03)]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-fg">AI crew</span>
        <span className="text-[12px] text-fg-3">{(snap.crew ?? []).filter((a) => a.status === 'watching' || a.status === 'listening' || a.status === 'on_duty').length} on duty</span>
      </div>
      {posts.length ? <div className="divide-y divide-[rgb(23_21_15/.06)]">{posts.map((p) => <CrewPostRow key={p.id} post={p} agent={byId.get(p.agentId)} now={now} onOpenIssue={onOpenIssue} compact />)}</div>
        : <p className="py-3 text-[13px] text-fg-3">Agents post here when they call something in.</p>}
    </section>
  );
}
