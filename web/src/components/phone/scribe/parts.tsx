// Scribe page pieces: consent, level meter, live transcript, recently organised issues, status banners.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ListChecks, Mic, ShieldCheck, TriangleAlert, Users, WifiOff, MonitorSmartphone } from 'lucide-react';
import type { Issue, Participant, Utterance } from '@shared/contracts';
import { clock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { IssueKey, IssueStatusPill } from '@/components/ops-bits';
import { CARD, HAIR } from '@/components/phone/common';

// ── Consent ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ConsentCard({ where }: { where: string }) {
  const items: Array<{ icon: ReactNode; text: string }> = [
    { icon: <ShieldCheck strokeWidth={1.75} />, text: 'Audio is never stored — only the text' },
    { icon: <ListChecks strokeWidth={1.75} />, text: 'Tasks and decisions are pulled out automatically' },
    { icon: <Users strokeWidth={1.75} />, text: 'Let everyone in the room know it is listening' },
  ];
  return (
    <section className="mx-auto w-full max-w-[420px] animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className={cn('mb-6 grid size-16 place-items-center rounded-[20px] bg-white text-fg [&_svg]:size-7', HAIR)}><Mic strokeWidth={1.75} /></div>
      <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.03em] text-fg">This phone will transcribe the meeting</h1>
      <p className="mt-1.5 text-[15px] leading-[22px] text-fg-2">{where}</p>
      <ul className={cn('mt-7 overflow-hidden', CARD)}>
        {items.map((it, i) => (
          <li key={it.text} className="relative flex min-h-[56px] items-center gap-3 px-4 py-3">
            {i > 0 ? <span className="absolute top-0 right-0 left-12 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden="true" /> : null}
            <span className="text-fg-2 [&_svg]:size-5">{it.icon}</span>
            <span className="text-[16px] leading-[22px] text-fg">{it.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 px-1 text-[13px] leading-[19px] text-fg-3">Put the phone in the middle of the table and keep the screen on.</p>
    </section>
  );
}

// ── Level meter (thin ink bars, newest on the right) ─────────────────────────────────────────────────────────────────

const BARS = 36;

export function LevelMeter({ level, active, className }: { level: number; active: boolean; className?: string }) {
  const hist = useRef<number[]>(Array(BARS).fill(0));
  const [, force] = useState(0);
  useEffect(() => {
    hist.current = [...hist.current.slice(1), active ? level : 0];
    force((n) => (n + 1) % 1_000_000);
  }, [level, active]);
  return (
    <div className={cn('flex h-8 items-center justify-center gap-[3px]', className)} aria-hidden="true">
      {hist.current.map((v, i) => (
        <span key={i} className="w-[3px] rounded-full transition-[height] duration-100 ease-out motion-reduce:transition-none"
          style={{ height: `${Math.max(3, Math.round(v * 30))}px`, background: active ? `rgba(23,21,15,${0.25 + (i / BARS) * 0.6})` : 'rgba(23,21,15,.14)' }} />
      ))}
    </div>
  );
}

// ── Live transcript (newest at the bottom, auto-scroll while the reader is near the bottom) ─────────────────────────

export function TranscriptList({ utterances, transcribing, className }: { utterances: Utterance[]; transcribing: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = utterances[utterances.length - 1]?.id;

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [last, transcribing]);

  return (
    <section className={cn('flex min-h-0 flex-col', CARD, className)} aria-label="Live transcript">
      <header className="flex h-11 shrink-0 items-center justify-between px-4">
        <h2 className="text-[13px] font-semibold text-fg-2">Live transcript</h2>
        <span className="text-[12px] text-fg-3 tabular-nums">{utterances.length ? `${utterances.length} lines` : ''}</span>
      </header>
      <span className="h-px shrink-0 origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden="true" />
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        role="log" aria-live="polite">
        {utterances.length === 0 && !transcribing ? (
          <p className="py-8 text-center text-[15px] leading-[22px] text-fg-3">Speak and the words appear here</p>
        ) : null}
        <ol>
          {utterances.map((u) => (
            <li key={u.id} className="grid grid-cols-[44px_1fr] gap-x-2 py-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
              <time className="pt-[3px] text-[13px] text-fg-3 tabular-nums" dateTime={new Date(u.startedAt).toISOString()}>{clock(u.startedAt)}</time>
              <div className="min-w-0">
                <p className="text-[17px] leading-[26px] text-fg">{u.text}</p>
                {u.issueKeys.length ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {u.issueKeys.map((k) => (
                      <span key={k} className={cn('inline-flex h-6 items-center gap-1 rounded-full bg-white pr-2 pl-1.5', HAIR)}>
                        <ArrowRight className="size-3 text-fg-3" strokeWidth={2} /><IssueKey k={k} className="text-fg-2" />
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
          {transcribing ? (
            <li className="grid grid-cols-[44px_1fr] gap-x-2 py-2 text-fg-3">
              <span />
              <span className="inline-flex items-center gap-2 text-[15px]">
                <span className="typing" aria-hidden="true"><i /><i /><i /></span>Transcribing…
              </span>
            </li>
          ) : null}
        </ol>
      </div>
    </section>
  );
}

// ── Recently organised issues ────────────────────────────────────────────────────────────────────────────────────────

export function RecentIssues({ issues, participants, max = 3, className, title = 'Just captured' }: {
  issues: Issue[]; participants: Participant[]; max?: number; className?: string; title?: string;
}) {
  const names = useMemo(() => new Map(participants.map((p) => [p.id, p.displayName])), [participants]);
  if (!issues.length) return null;
  const shown = issues.slice(0, max);
  return (
    <section className={className} aria-label={title}>
      <h2 className="mb-2 px-1 text-[13px] font-semibold text-fg-2">{title}</h2>
      <ul className={cn('overflow-hidden', CARD)}>
        {shown.map((i, idx) => {
          const who = i.assigneeId ? names.get(i.assigneeId) ?? 'Owner' : i.assigneeHint ? `Mentioned: ${i.assigneeHint}` : 'Unassigned';
          return (
            <li key={i.id} className="relative flex min-h-[48px] items-center gap-2.5 px-4 animate-in fade-in duration-300">
              {idx > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden="true" /> : null}
              <IssueStatusPill status={i.status} iconOnly />
              <IssueKey k={i.key} />
              <span className={cn('min-w-0 flex-1 truncate text-[15px] font-medium', i.status === 'done' ? 'text-fg-3 line-through decoration-[rgb(23_21_15/.3)]' : 'text-fg')}>{i.title}</span>
              <span className={cn('max-w-[34%] shrink-0 truncate text-[13px]', i.assigneeId ? 'text-fg-2' : 'text-fg-3')}>{who}</span>
            </li>
          );
        })}
      </ul>
      {issues.length > max ? <p className="mt-1.5 px-1 text-[12px] text-fg-3 tabular-nums">{issues.length - max} more on the HQ board</p> : null}
    </section>
  );
}

// ── Banners ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function Banner({ tone = 'neutral', icon, children }: { tone?: 'neutral' | 'warn'; icon: ReactNode; children: ReactNode }) {
  return (
    <div role="status" className={cn('flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-[14px] leading-5 [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0',
      tone === 'warn' ? 'bg-[#fbf3ec] text-[#86552e]' : cn('bg-white text-fg-2', HAIR))}>
      {icon}<span className="min-w-0">{children}</span>
    </div>
  );
}

export const BannerIcons = { warn: <TriangleAlert strokeWidth={1.75} />, offline: <WifiOff strokeWidth={1.75} />, screen: <MonitorSmartphone strokeWidth={1.75} /> };
