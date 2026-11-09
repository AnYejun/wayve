// Right column of the HQ board: Live transcript · Suggestions · Radio (segmented).
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ArrowUp, Check, ChevronDown, Inbox, LoaderCircle, Mic, Radio, X } from 'lucide-react';
import { type Issue, type Proposal, type Snapshot, type TalkMessage, type Utterance } from '@shared/contracts';
import { Confidence } from '@/components/bits';
import { EvidenceQuote, IssueKey, RecDot, SourceTag } from '@/components/ops-bits';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useFreshIds } from '@/components/ops/util';
import { API, HttpError } from '@/lib/api';
import { ago, clock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { cardClass, deviceTeam, isMsgOverdue, liveScribes, pendingAcks } from './util';

export type PanelTab = 'transcript' | 'proposals' | 'talk';

type Apply = (u: { kind: 'issue'; data: Issue } | { kind: 'proposal'; data: Proposal } | { kind: 'message'; data: TalkMessage } | { kind: 'utterance'; data: Utterance }) => void;

export function SidePanel({ snap, now, tab, setTab, teamId, onOpenIssue, apply, className }: {
  snap: Snapshot; now: number; tab: PanelTab; setTab: (t: PanelTab) => void; teamId: string | null;
  onOpenIssue: (keyOrId: string) => void; apply: Apply; className?: string;
}) {
  const pending = snap.proposals.filter((p) => p.status === 'pending').length;
  const unacked = snap.messages.filter((m) => pendingAcks(m).length > 0).length;
  const tabs: Array<[PanelTab, string, number]> = [['transcript', 'Live transcript', 0], ['proposals', 'Suggestions', pending], ['talk', 'Radio', unacked]];
  return (
    <section id="panel" aria-label="Live panel" className={cn(cardClass, 'flex scroll-mt-6 flex-col overflow-hidden', className)}>
      <div className="px-3 pt-3 pb-2">
        <div className="grid grid-cols-3 rounded-[10px] bg-[#f5f4f2] p-[3px]" role="tablist">
          {tabs.map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn('flex h-8 items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium transition-[background-color,box-shadow,color] duration-200',
                tab === id ? 'bg-white text-fg shadow-[0_1px_2px_rgb(23_21_15/.06),0_1px_1px_rgb(23_21_15/.04)]' : 'text-fg-2 hover:text-fg')}>
              {label}
              {n > 0 && <span className={cn('inline-grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] font-semibold tabular-nums',
                id === 'talk' ? 'bg-[#fee4e1] text-[#b91c1c]' : 'bg-[#17150f] text-white')}>{n}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1" role="tabpanel">
        {tab === 'transcript' && <Transcript snap={snap} now={now} teamId={teamId} onOpenIssue={onOpenIssue} />}
        {tab === 'proposals' && <Proposals snap={snap} now={now} apply={apply} onOpenIssue={onOpenIssue} />}
        {tab === 'talk' && <Talk snap={snap} now={now} apply={apply} onOpenIssue={onOpenIssue} />}
      </div>
    </section>
  );
}

// ── Live transcript ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Transcript({ snap, now, teamId, onOpenIssue }: { snap: Snapshot; now: number; teamId: string | null; onOpenIssue: (k: string) => void }) {
  const people = useMemo(() => new Map(snap.participants.map((p) => [p.id, p])), [snap.participants]);
  const teamName = useMemo(() => new Map(snap.teams.map((t) => [t.id, t.name])), [snap.teams]);
  const rows = useMemo(() => snap.utterances.filter((u) => teamId == null || u.teamId === teamId), [snap.utterances, teamId]);
  const fresh = useFreshIds(rows);
  const scribes = liveScribes(snap, now);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[rgb(23_21_15/.06)] px-4 pb-2.5">
        {scribes.length ? scribes.map((d) => {
          const t = deviceTeam(d, people);
          return (
            <span key={d.id} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-2">
              <RecDot />{t ? `${teamName.get(t) ?? ''} · ` : ''}{d.label}
            </span>
          );
        }) : <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-3"><RecDot on={false} />No scribe is recording</span>}
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center px-6 pt-10 pb-12 text-center">
          <span className="inline-grid size-10 place-items-center rounded-[12px] bg-[#f5f4f2] text-fg"><Mic size={20} strokeWidth={1.75} /></span>
          <p className="mt-3 text-[15px] font-medium">Nothing transcribed yet</p>
          <p className="mt-1 max-w-[280px] text-[13px] leading-[19px] text-fg-3">Scan a meeting-scribe QR with a phone on the table. Speech streams in here live.</p>
        </div>
      ) : (
        <ol className="max-h-[640px] divide-y divide-[rgb(23_21_15/.05)] overflow-y-auto xl:max-h-[calc(100dvh-220px)]" aria-live="polite">
          {rows.map((u) => (
            <li key={u.id} className={cn('px-4 py-3 transition-colors duration-[1200ms] ease-out',
              fresh.has(u.id) ? 'animate-in fade-in-0 slide-in-from-top-1 bg-[#fbf5ec] duration-300' : 'bg-white')}>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-fg-3 tabular-nums">{clock(u.startedAt)}</span>
                <span className="truncate text-[13px] font-semibold">{u.speaker}</span>
                <SourceTag source={u.source} />
                {u.teamId && teamId == null && <span className="truncate text-[12px] text-fg-3">· {teamName.get(u.teamId) ?? ''}</span>}
              </div>
              <p className="mt-1 text-[14px] leading-[21px] text-fg">{u.text}</p>
              {u.issueKeys.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {u.issueKeys.map((k) => (
                    <button key={k} type="button" onClick={() => onOpenIssue(k)}
                      className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-[#f5f4f2] px-1.5 text-[12px] font-medium text-fg-2 transition-colors hover:bg-[#eeede9] hover:text-fg active:scale-[.97]">
                      → <IssueKey k={k} className="text-fg-2" />
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Suggestions ────────────────────────────────────────────────────────────────────────────────────────────────────────

function Proposals({ snap, now, apply, onOpenIssue }: { snap: Snapshot; now: number; apply: Apply; onOpenIssue: (k: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const pending = snap.proposals.filter((p) => p.status === 'pending').sort((a, b) => b.createdAt - a.createdAt);
  const decided = snap.proposals.filter((p) => p.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
  const fresh = useFreshIds(pending);

  const decide = async (p: Proposal, d: 'accept' | 'reject') => {
    setBusy(p.id);
    try {
      const r = await API.decideProposal(p.id, d);
      apply({ kind: 'proposal', data: r.proposal });
      if (r.issue) apply({ kind: 'issue', data: r.issue });
      toast.success(d === 'accept' ? (r.issue ? `${r.issue.key} applied` : 'Applied') : 'Rejected');
    } catch (e) { toast.error((e as HttpError).message); }
    setBusy(null);
  };

  return (
    <div>
      <p className="border-b border-[rgb(23_21_15/.06)] px-4 pb-2.5 text-[12px] text-fg-3">AI Low-confidence changes wait here for a human</p>
      {pending.length === 0 ? (
        <div className="flex flex-col items-center px-6 pt-10 pb-10 text-center">
          <span className="inline-grid size-10 place-items-center rounded-[12px] bg-[#dcf2df] text-[#376c45]"><Inbox size={20} strokeWidth={1.75} /></span>
          <p className="mt-3 text-[15px] font-medium">Nothing to review</p>
          <p className="mt-1 text-[13px] text-fg-3">Confident changes go straight to the board.</p>
        </div>
      ) : (
        <ul className="max-h-[560px] divide-y divide-[rgb(23_21_15/.06)] overflow-y-auto">
          {pending.map((p) => {
            const target = p.issueId ? snap.issues.find((i) => i.id === p.issueId) : null;
            return (
              <li key={p.id} className={cn('px-4 py-3.5 transition-colors duration-[1200ms] ease-out', fresh.has(p.id) ? 'animate-in fade-in-0 slide-in-from-top-1 bg-[#fbf5ec] duration-300' : 'bg-white')}>
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[15px] leading-[21px] font-medium">{p.summary}</p>
                  <span className="shrink-0 pt-0.5 text-[12px] text-fg-3 tabular-nums">{ago(p.createdAt, now)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Confidence value={p.confidence} />
                  {target && <button type="button" onClick={() => onOpenIssue(target.id)} className="rounded-[4px] hover:underline"><IssueKey k={target.key} /></button>}
                </div>
                {p.evidence.length > 0 && <div className="mt-2.5 space-y-2">{p.evidence.slice(0, 3).map((e) => <EvidenceQuote key={`${e.type}-${e.id}`} e={e} />)}</div>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" shape="pill" onClick={() => decide(p, 'accept')} disabled={busy != null}>
                    {busy === p.id ? <LoaderCircle className="animate-spin" /> : <Check />}Approve
                  </Button>
                  <Button size="sm" shape="pill" variant="secondary" onClick={() => decide(p, 'reject')} disabled={busy != null}><X />Reject</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {decided.length > 0 && (
        <div className="border-t border-[rgb(23_21_15/.06)]">
          <button type="button" onClick={() => setShowDecided((s) => !s)} aria-expanded={showDecided}
            className="flex h-10 w-full items-center gap-1.5 px-4 text-[13px] font-medium text-fg-2 hover:text-fg">
            Reviewed <span className="text-fg-3 tabular-nums">{decided.length}</span>
            <ChevronDown size={14} className={cn('ml-auto transition-transform', showDecided && 'rotate-180')} />
          </button>
          {showDecided && (
            <ul className="divide-y divide-[rgb(23_21_15/.05)] pb-1">
              {decided.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                  <span className={cn('inline-flex h-5 shrink-0 items-center rounded-[6px] px-1.5 text-[11px] font-semibold',
                    p.status === 'accepted' ? 'bg-[#dcf2df] text-[#376c45]' : 'bg-[#f5f4f2] text-fg-3')}>{p.status === 'accepted' ? 'Approve' : 'Reject'}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-2">{p.summary}</span>
                  {p.decidedBy && <span className="shrink-0 text-[12px] text-fg-3">{p.decidedBy}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Radio ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function Talk({ snap, now, apply, onOpenIssue }: { snap: Snapshot; now: number; apply: Apply; onOpenIssue: (k: string) => void }) {
  const people = useMemo(() => new Map(snap.participants.map((p) => [p.id, p])), [snap.participants]);
  const fresh = useFreshIds(snap.messages);
  const targets = useMemo(() => {
    const t: Array<[string, string]> = [['hq', 'HQ'], ['all', 'All']];
    for (const team of snap.teams) t.push([`team:${team.id}`, `${team.name} Teams`]);
    for (const p of snap.participants) if ((p.role === 'staff' || p.role === 'admin') && p.id !== snap.me.participantId) t.push([`person:${p.id}`, p.displayName]);
    return t;
  }, [snap.teams, snap.participants, snap.me.participantId]);
  const [to, setTo] = useState('all');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const toLabel = targets.find(([v]) => v === to)?.[1] ?? 'All';

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const r = await API.talkText(t, to, snap.event.id);
      apply({ kind: 'message', data: r.message });
      apply({ kind: 'utterance', data: r.utterance });
      setText('');
    } catch (err) { toast.error((err as HttpError).message); }
    setSending(false);
  };

  return (
    <div className="flex h-full flex-col">
      {snap.messages.length === 0 ? (
        <div className="flex flex-col items-center px-6 pt-10 pb-10 text-center">
          <span className="inline-grid size-10 place-items-center rounded-[12px] bg-[#f5f4f2] text-fg"><Radio size={20} strokeWidth={1.75} /></span>
          <p className="mt-3 text-[15px] font-medium">No radio yet</p>
          <p className="mt-1 max-w-[280px] text-[13px] leading-[19px] text-fg-3">When staff push to talk, messages land here with who has acknowledged them.</p>
        </div>
      ) : (
        <TooltipProvider delayDuration={250}>
          <ul className="max-h-[520px] min-h-0 flex-1 divide-y divide-[rgb(23_21_15/.06)] overflow-y-auto xl:max-h-[calc(100dvh-300px)]">
            {snap.messages.map((m) => {
              const waiting = pendingAcks(m);
              const overdue = isMsgOverdue(m, now);
              const ackedNames = m.acks.map((a) => people.get(a.participantId)?.displayName).filter(Boolean) as string[];
              const waitingNames = waiting.map((id) => people.get(id)?.displayName ?? 'Unknown');
              return (
                <li key={m.id} className={cn('px-4 py-3 transition-colors duration-[1200ms] ease-out',
                  fresh.has(m.id) ? 'animate-in fade-in-0 slide-in-from-top-1 bg-[#fbf5ec] duration-300' : overdue ? 'bg-[#fff7f6]' : 'bg-white')}>
                  <div className="flex items-center gap-1.5 text-[13px]">
                    <span className="truncate font-semibold">{m.fromName}</span>
                    <span className="text-fg-3">→</span>
                    <span className="truncate font-medium text-fg-2">{m.to.label}</span>
                    <span className="ml-auto shrink-0 text-[12px] text-fg-3 tabular-nums">{clock(m.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[14px] leading-[21px] text-fg">{m.text}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {m.expected.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium tabular-nums',
                            waiting.length === 0 ? 'bg-[#dcf2df] text-[#376c45]' : overdue ? 'bg-[#b91c1c] text-white' : 'bg-[#f5f4f2] text-fg-2')}>
                            {waiting.length === 0 ? <Check size={12} strokeWidth={2.5} /> : null}
                            {m.acks.length}/{m.expected.length} acked{overdue ? ` · unacked ${Math.floor((now - m.createdAt) / 60_000)}m` : ''}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {ackedNames.length ? `Acked: ${ackedNames.join(', ')}` : 'Nobody has acknowledged yet'}
                          {waitingNames.length ? ` · Waiting: ${waitingNames.join(', ')}` : ''}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {m.issueKeys.map((k) => (
                      <button key={k} type="button" onClick={() => onOpenIssue(k)}
                        className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-[#f5f4f2] px-1.5 text-[12px] text-fg-2 hover:bg-[#eeede9]">→ <IssueKey k={k} className="text-fg-2" /></button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </TooltipProvider>
      )}

      <form onSubmit={send} className="flex items-center gap-2 border-t border-[rgb(23_21_15/.08)] bg-[#fafaf9] p-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" size="sm" shape="pill" className="max-w-[112px] shrink-0">
              <span className="truncate">{toLabel}</span><ChevronDown className="text-fg-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[320px]">
            <DropdownMenuLabel>To</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={to} onValueChange={setTo}>
              {targets.slice(0, 2).map(([v, l]) => <DropdownMenuRadioItem key={v} value={v}>{l}</DropdownMenuRadioItem>)}
              {snap.teams.length > 0 && <DropdownMenuSeparator />}
              {targets.filter(([v]) => v.startsWith('team:')).map(([v, l]) => <DropdownMenuRadioItem key={v} value={v}>{l}</DropdownMenuRadioItem>)}
              {targets.some(([v]) => v.startsWith('person:')) && <DropdownMenuSeparator />}
              {targets.filter(([v]) => v.startsWith('person:')).map(([v, l]) => <DropdownMenuRadioItem key={v} value={v}>{l}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Send from HQ" aria-label="Radio message"
          className="h-9 min-w-0 flex-1 rounded-full bg-white px-3.5 text-[16px] shadow-[inset_0_0_0_1px_rgb(23_21_15/.12)] outline-none placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1.5px_#17150f] sm:text-[14px]" />
        <button type="submit" disabled={!text.trim() || sending} aria-label="Send"
          className="inline-grid size-9 shrink-0 place-items-center rounded-full bg-[#17150f] text-white transition-[opacity,scale] active:scale-[.92] disabled:opacity-30">
          {sending ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.25} />}
        </button>
      </form>
    </div>
  );
}
