// Reports: every field report (photo + voice + text) with its AI summary and live status from the linked issue.
import { useState } from 'react';
import type { Issue } from '@shared/contracts';
import { ReportSheet, ReportsView } from '@/components/ops/OpsViews';
import { IssueSheet } from '@/components/ops/IssueSheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useNow } from '@/lib/time';
import { useShell } from '../context';
import { Page, SectionHeader } from '../ui';

export default function ReportsSection() {
  const { snap, apply } = useShell();
  const now = useNow(1000);
  const [reportId, setReportId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  if (!snap) return <Page><Skeleton className="h-9 w-40" /><Skeleton className="mt-6 h-[420px] w-full rounded-[14px]" /></Page>;
  const open = snap.reports.filter((r) => { const i = snap.issues.find((x) => x.id === r.issueId); return i && i.status !== 'done'; }).length;
  return (
    <Page>
      <SectionHeader title="Reports" sub={<>Field reports from staff phones — {snap.reports.length} total, {open} still being worked on. Reports from the same spot merge into one issue.</>} />
      <div className="mt-6"><ReportsView snap={snap} now={now} onOpenReport={setReportId} /></div>
      <ReportSheet snap={snap} reportId={reportId} now={now} onClose={() => setReportId(null)} onOpenIssue={setIssueId} />
      <IssueSheet snap={snap} issueId={issueId} onClose={() => setIssueId(null)} apply={apply as (u: { kind: 'issue'; data: Issue }) => void} now={now} />
    </Page>
  );
}
