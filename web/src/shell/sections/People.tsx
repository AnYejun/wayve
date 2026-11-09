// People: who is on shift, where they are, what they're on, and whether they answer the radio. Grouped by team.
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Radio, Users } from 'lucide-react';
import type { Issue, Participant, Snapshot } from '@shared/contracts';
import { IssueKey, IssueStatusPill, PriorityBadge } from '@/components/ops-bits';
import { IssueSheet } from '@/components/ops/IssueSheet';
import { Monogram } from '@/components/ops/Person';
import { isOnline } from '@/components/ops/util';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ago, clock, useNow } from '@/lib/time';
import { spring } from '@/design/motion';
import { cn } from '@/lib/utils';
import { useShell } from '../context';
import { Empty, KpiStrip, Page, PanelTitle, SectionHeader, panel } from '../ui';

type State = 'busy' | 'available' | 'offline';
const PRI = { p0: 0, p1: 1, p2: 2, p3: 3 } as const;

function personState(p: Participant, snap: Snapshot, now: number) {
  const devices = snap.devices.filter((d) => d.participantId === p.id);
  const online = devices.some((d) => isOnline(d, now)) || now - p.lastSeenAt < 60_000;
  const mine = snap.issues.filter((i) => i.assigneeId === p.id && i.status !== 'done').sort((a, b) => PRI[a.priority] - PRI[b.priority]);
  const active = mine.find((i) => i.status === 'in_progress') ?? null;
  const zoneId = devices.find((d) => d.zoneId)?.zoneId ?? null;
  const acks = snap.messages.flatMap((m) => m.acks.filter((a) => a.participantId === p.id).map((a) => a.at));
  const state: State = !online ? 'offline' : active ? 'busy' : 'available';
  // Deployment: where the active issue is vs where this person is now.
  const target = active?.zoneId ? snap.zones.find((z) => z.id === active.zoneId) ?? null : null;
  const deploy = active ? (target ? (zoneId === target.id ? `On site · ${target.name} · ${active.key}` : `On my way → ${target.name} · ${active.key}`) : `On ${active.key}`) : null;
  return { online, mine, active, zone: snap.zones.find((z) => z.id === zoneId) ?? null, lastAck: acks.length ? Math.max(...acks) : null, state, deploy };
}

const STATE_UI: Record<State, { label: string; dot: string; bg: string; fg: string }> = {
  available: { label: 'Available', dot: '#3f9a55', bg: '#eaf5ec', fg: '#2f6b3c' },
  busy: { label: 'On a task', dot: '#c9a13f', bg: '#fbf3df', fg: '#7a5d14' },
  offline: { label: 'Offline', dot: '#b9b8b4', bg: '#f4f3f1', fg: '#6b6965' },
};

export default function PeopleSection() {
  const { snap, apply } = useShell();
  const now = useNow(2000);
  const [personId, setPersonId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);

  const people = useMemo(() => (snap ? snap.participants.filter((p) => p.role === 'staff' || p.role === 'admin') : []), [snap]);
  const states = useMemo(() => new Map(snap ? people.map((p) => [p.id, personState(p, snap, now)]) : []), [people, snap, now]);
  if (!snap) return <Page><Skeleton className="h-9 w-40" /><Skeleton className="mt-6 h-[420px] w-full rounded-[14px]" /></Page>;

  const groups = [...snap.teams.map((t) => ({ id: t.id, name: t.name })), { id: '', name: 'No team' }]
    .map((g) => ({ ...g, people: people.filter((p) => (p.teamId ?? '') === g.id) }))
    .filter((g) => g.people.length || g.id);
  const count = (s: State) => [...states.values()].filter((x) => x.state === s).length;
  const person = people.find((p) => p.id === personId) ?? null;

  return (
    <Page>
      <SectionHeader title="People" sub="Who’s available, who’s on what, and where they are — so you call the right person instead of the group chat." />
      <div className="mt-6">
        <KpiStrip items={[
          { label: 'On shift', value: people.length, sub: `${snap.teams.length} teams` },
          { label: 'Available', value: count('available'), tone: 'good', sub: 'Online, nothing in progress' },
          { label: 'On a task', value: count('busy'), sub: 'Working an issue' },
          { label: 'Offline', value: count('offline'), tone: 'danger', sub: 'Not seen in the last minute' },
          { label: 'Unassigned issues', value: snap.issues.filter((i) => i.status !== 'done' && !i.assigneeId).length, tone: 'danger', sub: 'Waiting for an owner' },
          { label: 'Radio acks', value: snap.messages.reduce((n, m) => n + m.acks.length, 0), sub: 'Messages confirmed' },
        ]} />
      </div>
      {people.length === 0 ? (
        <div className={cn(panel, 'mt-5')}><Empty icon={Users} title="Nobody has joined yet" body="Staff scan the staff QR (Settings → Invite) and sign in with their WAYVE ID." /></div>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
          {groups.map((g) => (
            <section key={g.id || 'none'} className={cn(panel, 'overflow-hidden')}>
              <PanelTitle title={g.name} meta={`${g.people.filter((p) => states.get(p.id)?.state !== 'offline').length}/${g.people.length} online`} />
              {g.people.length === 0 ? <p className="px-4 py-6 text-[13px] text-fg-3">No one on this team yet.</p> : (
                <ul>
                  {g.people.map((p) => {
                    const s = states.get(p.id)!;
                    const ui = STATE_UI[s.state];
                    return (
                      <motion.li key={p.id} layout transition={spring.smooth}>
                        <button type="button" onClick={() => setPersonId(p.id)} className="flex w-full items-start gap-3 border-b border-[rgb(23_21_15/.06)] px-4 py-3 text-left last:border-0 hover:bg-[rgb(23_21_15/.02)]">
                          <span className="relative mt-0.5"><Monogram name={p.displayName} size={32} /><span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-white" style={{ background: ui.dot }} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[14px] font-semibold text-fg">{p.displayName}</span>
                              {p.role === 'admin' ? <span className="text-[11px] font-medium text-fg-3">Organizer</span> : null}
                              <span className="ml-auto inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium" style={{ background: ui.bg, color: ui.fg }}>{s.deploy ?? ui.label}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-fg-2">
                              {s.zone ? s.zone.name : 'Location unknown'} · {s.mine.length} open {s.mine.length === 1 ? 'issue' : 'issues'}{s.lastAck ? ` · last radio ack ${ago(s.lastAck, now)}` : ''}
                            </span>
                            {s.mine.slice(0, 2).map((i) => (
                              <span key={i.id} className="mt-1.5 flex items-center gap-1.5 text-[12px] text-fg">
                                <IssueStatusPill status={i.status} iconOnly /><IssueKey k={i.key} /><span className="truncate">{i.title}</span>
                              </span>
                            ))}
                          </span>
                        </button>
                      </motion.li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <Sheet open={!!person} onOpenChange={(o) => { if (!o) setPersonId(null); }}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 sm:max-w-[460px]">
          {person ? <PersonDetail snap={snap} p={person} s={states.get(person.id)!} now={now} onIssue={(id) => { setPersonId(null); setIssueId(id); }} /> : null}
        </SheetContent>
      </Sheet>
      <IssueSheet snap={snap} issueId={issueId} onClose={() => setIssueId(null)} apply={apply as (u: { kind: 'issue'; data: Issue }) => void} now={now} />
    </Page>
  );
}

function PersonDetail({ snap, p, s, now, onIssue }: { snap: Snapshot; p: Participant; s: ReturnType<typeof personState>; now: number; onIssue: (id: string) => void }) {
  const team = snap.teams.find((t) => t.id === p.teamId);
  const radio = snap.messages.filter((m) => m.fromId === p.id || m.expected.includes(p.id)).slice(0, 12);
  const ui = STATE_UI[s.state];
  return (
    <>
      <SheetHeader className="p-0">
        <div className="flex items-center gap-3">
          <Monogram name={p.displayName} size={44} />
          <div className="min-w-0">
            <SheetTitle className="text-[20px]">{p.displayName}</SheetTitle>
            <SheetDescription>{team?.name ?? 'No team'} · {s.zone?.name ?? 'Location unknown'}</SheetDescription>
          </div>
          <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium" style={{ background: ui.bg, color: ui.fg }}>
            <span className="size-1.5 rounded-full" style={{ background: ui.dot }} />{ui.label}
          </span>
        </div>
      </SheetHeader>
      <p className="mt-6 mb-2 text-[12px] font-semibold tracking-[.04em] text-fg-3 uppercase">Open issues</p>
      {s.mine.length === 0 ? <p className="text-[13px] text-fg-2">Nothing assigned right now.</p> : (
        <ul className="space-y-1.5">
          {s.mine.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => onIssue(i.id)} className="flex w-full items-center gap-2 rounded-[10px] border border-[rgb(23_21_15/.08)] px-3 py-2.5 text-left hover:bg-[rgb(23_21_15/.02)]">
                <IssueStatusPill status={i.status} iconOnly /><IssueKey k={i.key} /><span className="min-w-0 flex-1 truncate text-[14px] font-medium">{i.title}</span>
                <PriorityBadge priority={i.priority} showLabel={false} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 mb-2 text-[12px] font-semibold tracking-[.04em] text-fg-3 uppercase">Radio</p>
      {radio.length === 0 ? <p className="text-[13px] text-fg-2">No radio yet.</p> : (
        <ul className="space-y-2">
          {radio.map((m) => {
            const acked = m.acks.find((a) => a.participantId === p.id);
            return (
              <li key={m.id} className="rounded-[10px] bg-[#f7f6f4] px-3 py-2.5">
                <div className="flex items-center gap-2 text-[12px] text-fg-3">
                  <Radio size={12} />{m.fromName} → {m.to.label}<span className="ml-auto tabular-nums">{clock(m.createdAt)}</span>
                </div>
                <p className="mt-1 text-[13px] text-fg">{m.text}</p>
                {m.expected.includes(p.id) ? <p className={cn('mt-1 text-[12px] font-medium', acked ? 'text-[#2f6b3c]' : 'text-[#b91c1c]')}>{acked ? `Got it · ${ago(acked.at, now)}` : 'Not acknowledged'}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
