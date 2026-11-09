// Derived ops metrics shared by Dashboard, People and the issue sheet (resolution tracking).
import type { Issue, IssueEvent, Snapshot } from '@shared/contracts';

/** When an issue was resolved (the status → Done event), else null. */
export function doneAt(i: Issue, events: IssueEvent[]): number | null {
  if (i.status !== 'done') return null;
  const e = events.filter((x) => x.issueId === i.id && x.kind === 'status' && !x.undone && x.to === 'Done').sort((a, b) => b.at - a.at)[0];
  return e?.at ?? i.updatedAt;
}

/** First human/AI response after creation: an owner set, status moved off Open, or any human change. */
export function firstResponseAt(i: Issue, events: IssueEvent[]): number | null {
  const ev = events.filter((x) => x.issueId === i.id && x.kind !== 'created' && x.kind !== 'evidence' && x.kind !== 'escalated' && !x.undone)
    .sort((a, b) => a.at - b.at)[0];
  if (ev) return ev.at;
  return i.assigneeId && i.updatedAt > i.createdAt ? i.updatedAt : null;
}

export function resolvedBy(i: Issue, events: IssueEvent[]): string | null {
  if (i.status !== 'done') return null;
  return events.filter((x) => x.issueId === i.id && x.kind === 'status' && !x.undone && x.to === 'Done').sort((a, b) => b.at - a.at)[0]?.actorName ?? null;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function opsStats(snap: Snapshot, now: number) {
  const open = snap.issues.filter((i) => i.status !== 'done');
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const done = snap.issues.filter((i) => i.status === 'done');
  const doneToday = done.filter((i) => (doneAt(i, snap.issueEvents) ?? 0) >= startOfDay.getTime());
  const ttr = done.map((i) => (doneAt(i, snap.issueEvents) ?? i.updatedAt) - i.createdAt).filter((x) => x >= 0);
  return {
    open: open.length,
    urgent: open.filter((i) => i.priority === 'p0').length,
    blocked: open.filter((i) => i.status === 'blocked').length,
    escalated: open.filter((i) => i.escalated).length,
    unassigned: open.filter((i) => !i.assigneeId).length,
    unacked: snap.messages.filter((m) => m.expected.some((id) => !m.acks.some((a) => a.participantId === id))).length,
    resolvedToday: doneToday.length,
    medianTtrMs: median(ttr),
  };
}
