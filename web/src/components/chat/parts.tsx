// Rich chat parts shared by every WAYVE assistant surface (Ask drawer, desktop Assistant page, staff phone sheet).
// An answer = word-reveal text (markdown-lite, WV-keys linked) + inline attachments driven by AssistantTurn.focus:
// a compact live map with the zones it talks about highlighted, issue cards, action receipts and source chips.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUp, Check, Lightbulb, MapPin, Mic, Square } from 'lucide-react';
import {
  ISSUE_STATUS_LABEL, PRIORITY_LABEL, ZONE_STATUS_LABEL,
  type AssistantTurn, type Citation, type Issue, type Snapshot,
} from '@shared/contracts';
import { VenueMap } from '@/components/VenueMap';
import { AiTag } from '@/components/bits';
import { IssueStatusPill, PriorityBadge, IssueKey } from '@/components/ops-bits';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { STATUS_COLOR } from '@/design/status';
import { spring } from '@/design/motion';
import { clock } from '@/lib/time';
import { cn } from '@/lib/utils';

const HAIR = 'shadow-[inset_0_0_0_.5px_rgb(23_21_15/.14)]';

// ── text ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Inline markdown-lite: **bold**, `code`, WV-12 keys as buttons. */
function inline(text: string, onIssue?: (key: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\bWV-\d+\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={i++} className="font-semibold text-fg">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={i++} className="rounded-[5px] bg-[rgb(23_21_15/.06)] px-1 font-mono text-[0.92em]">{t.slice(1, -1)}</code>);
    else out.push(
      <button key={i++} type="button" onClick={() => onIssue?.(t)} disabled={!onIssue}
        className="mx-[1px] inline-flex items-baseline rounded-[5px] bg-[rgb(23_21_15/.06)] px-1 font-mono text-[0.88em] font-semibold text-fg hover:bg-[rgb(23_21_15/.1)] disabled:cursor-default">
        {t}
      </button>,
    );
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Block markdown-lite: paragraphs, "- " bullets, "1. " numbered lists. */
export function Markdown({ text, onIssue, className }: { text: string; onIssue?: (key: string) => void; className?: string }) {
  const blocks = useMemo(() => {
    const lines = text.split(/\n/);
    const out: Array<{ kind: 'p' | 'ul' | 'ol'; items: string[] }> = [];
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) { out.push({ kind: 'p', items: [] }); continue; }
      const ul = /^\s*[-•*]\s+(.*)$/.exec(line);
      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      const kind = ul ? 'ul' : ol ? 'ol' : 'p';
      const body = (ul ?? ol)?.[1] ?? line;
      const prev = out[out.length - 1];
      if (prev && prev.kind === kind && kind !== 'p') prev.items.push(body);
      else if (prev && prev.kind === 'p' && kind === 'p' && prev.items.length) prev.items.push(body);
      else out.push({ kind, items: [body] });
    }
    return out.filter((b) => b.items.length);
  }, [text]);
  return (
    <div className={cn('flex flex-col gap-2.5 text-fg', className)}>
      {blocks.map((b, i) => b.kind === 'p' ? (
        <p key={i}>{b.items.map((l, j) => <Fragment key={j}>{j ? ' ' : null}{inline(l, onIssue)}</Fragment>)}</p>
      ) : b.kind === 'ul' ? (
        <ul key={i} className="flex flex-col gap-1.5 pl-1">
          {b.items.map((l, j) => <li key={j} className="flex gap-2.5"><span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-fg-3" /><span>{inline(l, onIssue)}</span></li>)}
        </ul>
      ) : (
        <ol key={i} className="flex flex-col gap-1.5 pl-1">
          {b.items.map((l, j) => <li key={j} className="flex gap-2.5"><span className="w-4 shrink-0 text-right font-semibold text-fg-3 tabular-nums">{j + 1}.</span><span>{inline(l, onIssue)}</span></li>)}
        </ol>
      ))}
    </div>
  );
}

/** Answers appear word by word once (feels streamed); older answers render instantly. */
export function RevealMarkdown({ text, animate, onIssue, className, onDone }: { text: string; animate: boolean; onIssue?: (key: string) => void; className?: string; onDone?: () => void }) {
  const reduced = useReducedMotion();
  const words = useMemo(() => text.split(/(\s+)/), [text]);
  const [n, setN] = useState(animate && !reduced ? 0 : words.length);
  useEffect(() => {
    if (!animate || reduced) { setN(words.length); return; }
    setN(0);
    const step = Math.max(1, Math.round(words.length / 70));
    const t = setInterval(() => setN((v) => { const nx = Math.min(words.length, v + step); if (nx >= words.length) clearInterval(t); return nx; }), 18);
    return () => clearInterval(t);
  }, [text, animate, reduced, words.length]);
  useEffect(() => { if (n >= words.length) onDone?.(); }, [n, words.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = n >= words.length ? text : words.slice(0, n).join('');
  return <Markdown text={shown} onIssue={n >= words.length ? onIssue : undefined} className={className} />;
}

// ── attachments ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ChatNav {
  /** Open an issue (sheet on the page, or route). */
  onOpenIssue?: (issue: Issue) => void;
  /** Open the zone on the full map. */
  onOpenZone?: (zoneId: string) => void;
}

/** Compact live map of the venue with the answer's zones highlighted (others dimmed), its issues pinned, devices marked. */
export function InlineMapCard({ snap, zoneIds, issueIds, deviceIds, onOpenZone, className, height = 220 }: {
  snap: Snapshot; zoneIds: string[]; issueIds: string[]; deviceIds: string[]; onOpenZone?: (zoneId: string) => void; className?: string; height?: number;
}) {
  const zones = snap.zones;
  const focusZones = zones.filter((z) => zoneIds.includes(z.id));
  const issues = snap.issues.filter((i) => issueIds.includes(i.id) && i.status !== 'done');
  const devices = snap.devices.filter((d) => deviceIds.includes(d.id));
  if (!zones.length) return null;
  return (
    <div className={cn('overflow-hidden rounded-[16px] bg-white', HAIR, className)}>
      <div className="pointer-events-auto relative" style={{ height }}>
        <VenueMap map={snap.event.map} zones={zones} issues={issues} devices={devices} highlightZoneIds={zoneIds} mode="preview" compact
          onSelect={(id) => { if (id) onOpenZone?.(id); }} className="h-full w-full" />
      </div>
      {focusZones.length ? (
        <div className="flex flex-wrap gap-1.5 border-t border-[rgb(23_21_15/.06)] px-3 py-2.5">
          {focusZones.map((z) => {
            const c = STATUS_COLOR[z.status];
            return (
              <button key={z.id} type="button" onClick={() => onOpenZone?.(z.id)}
                className={cn('inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-2.5 text-[12.5px] font-medium text-fg hover:bg-[#fafaf9]', HAIR)}>
                <span className="size-2 rounded-full" style={{ background: c.dot }} />
                {z.name}
                <span className="text-fg-3">{ZONE_STATUS_LABEL[z.status]}{z.peopleEstimate != null ? ` · ~${z.peopleEstimate}` : ''}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function IssueCard({ issue, snap, onOpen, dense }: { issue: Issue; snap: Snapshot; onOpen?: (i: Issue) => void; dense?: boolean }) {
  const who = issue.assigneeId ? snap.participants.find((p) => p.id === issue.assigneeId)?.displayName : null;
  const zone = issue.zoneId ? snap.zones.find((z) => z.id === issue.zoneId)?.name : null;
  return (
    <motion.button type="button" whileTap={{ scale: 0.985 }} transition={spring.snappy} onClick={() => onOpen?.(issue)}
      className={cn('flex w-full items-start gap-3 rounded-[14px] bg-white text-left hover:bg-[#fcfcfb]', dense ? 'px-3 py-2.5' : 'px-3.5 py-3', HAIR)}>
      <IssueStatusPill status={issue.status} iconOnly className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <IssueKey k={issue.key} />
          <PriorityBadge priority={issue.priority} showLabel={issue.priority === 'p0' || issue.priority === 'p1'} />
        </span>
        <span className={cn('mt-0.5 block truncate font-semibold text-fg', dense ? 'text-[13.5px]' : 'text-[14.5px]')}>{issue.title}</span>
        <span className="mt-0.5 block truncate text-[12.5px] text-fg-3">
          {ISSUE_STATUS_LABEL[issue.status]} · {who ?? (issue.assigneeHint ? `mentioned: ${issue.assigneeHint}` : 'Unassigned')}{zone ? ` · ${zone}` : ''}
        </span>
      </span>
      <span className="sr-only">{PRIORITY_LABEL[issue.priority]}</span>
    </motion.button>
  );
}

export function ActionReceipts({ actions }: { actions: AssistantTurn['actions'] }) {
  if (!actions.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {actions.map((a, i) => (
        <motion.span key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}
          className={cn('inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-[13px] font-semibold', a.applied ? 'bg-[#e8f5ec] text-[#2f7a45]' : 'bg-[#fdf3e3] text-[#8a5a12]')}>
          {a.applied ? <Check className="size-3.5" strokeWidth={2.5} /> : <Lightbulb className="size-3.5" strokeWidth={2} />}
          {a.applied ? a.summary : `Suggested: ${a.summary}`}
        </motion.span>
      ))}
    </div>
  );
}

export function CitationChips({ citations, snap, model, onOpenIssue }: { citations: Citation[]; snap: Snapshot | null; model?: string; onOpenIssue?: (i: Issue) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {model ? <AiTag model={model} /> : null}
      {citations.map((c) => {
        if (c.type === 'issue') {
          const issue = snap?.issues.find((i) => i.id === c.id || i.key === c.label);
          return (
            <button key={`i:${c.id}`} type="button" title={c.text} onClick={() => { if (issue) onOpenIssue?.(issue); }}
              className={cn('inline-flex h-6 items-center rounded-[6px] bg-white px-1.5 font-mono text-[11.5px] font-semibold text-fg-2 hover:text-fg', HAIR)}>
              {c.label}
            </button>
          );
        }
        return (
          <Popover key={`u:${c.id}`}>
            <PopoverTrigger asChild>
              <button type="button" className={cn('inline-flex h-6 max-w-[220px] items-center gap-1 truncate rounded-[6px] bg-white px-1.5 text-[11.5px] font-medium text-fg-2 hover:text-fg', HAIR)}>
                {c.at ? `${clock(c.at)} · ` : ''}{c.label}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-3.5 text-[13.5px] leading-[20px]">
              <p className="text-fg">“{c.text}”</p>
              <p className="mt-1.5 text-[12px] text-fg-3">{c.label}{c.at ? ` · ${clock(c.at)}` : ''}</p>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}

/** Everything under an answer: inline map (when it talks about places), issue cards, receipts, sources. */
export function AnswerAttachments({ res, snap, nav, compact }: { res: AssistantTurn; snap: Snapshot | null; nav: ChatNav; compact?: boolean }) {
  const focus = res.focus ?? { zoneIds: [], issueIds: [], deviceIds: [] };
  const issues = snap ? focus.issueIds.map((id) => snap.issues.find((i) => i.id === id)).filter((i): i is Issue => !!i) : [];
  const showMap = !!snap && snap.zones.length > 0 && (focus.zoneIds.length > 0 || focus.deviceIds.length > 0);
  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {showMap ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
          <InlineMapCard snap={snap!} zoneIds={focus.zoneIds} issueIds={focus.issueIds} deviceIds={focus.deviceIds} onOpenZone={nav.onOpenZone} height={compact ? 248 : 260} />
        </motion.div>
      ) : null}
      {issues.length ? (
        <div className={cn('grid gap-2', !compact && issues.length > 1 ? 'sm:grid-cols-2' : '')}>
          {issues.slice(0, compact ? 3 : 4).map((i) => <IssueCard key={i.id} issue={i} snap={snap!} onOpen={nav.onOpenIssue} dense={compact} />)}
          {issues.length > (compact ? 3 : 4) ? <p className="px-1 text-[12px] text-fg-3">+{issues.length - (compact ? 3 : 4)} more related issues</p> : null}
        </div>
      ) : null}
      <ActionReceipts actions={res.actions} />
      <CitationChips citations={res.citations.filter((c) => c.type === 'utterance' || !issues.some((i) => i.id === c.id))} snap={snap} model={res.model} onOpenIssue={nav.onOpenIssue} />
    </div>
  );
}

// ── input ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function SuggestionGrid({ items, onPick, disabled, columns = 2 }: {
  items: Array<{ q: string; hint?: string; icon?: typeof Lightbulb }>; onPick: (q: string) => void; disabled?: boolean; columns?: 1 | 2;
}) {
  return (
    <div className={cn('grid gap-2', columns === 2 ? 'sm:grid-cols-2' : '')}>
      {items.map((s, i) => {
        const I = s.icon ?? Lightbulb;
        return (
          <motion.button key={s.q} type="button" disabled={disabled} onClick={() => onPick(s.q)}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.03 * i }} whileTap={{ scale: 0.98 }}
            className={cn('flex items-start gap-3 rounded-[14px] bg-white px-4 py-3 text-left hover:bg-[#fcfcfb] disabled:opacity-50', HAIR)}>
            <I className="mt-0.5 size-[17px] shrink-0 text-fg-3" strokeWidth={1.75} />
            <span className="min-w-0">
              <span className="block text-[14.5px] font-medium text-fg">{s.q}</span>
              {s.hint ? <span className="mt-0.5 block text-[12.5px] text-fg-3">{s.hint}</span> : null}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/** Autosizing composer with send + mic. Enter sends, Shift+Enter newline, ⌘/Ctrl+Enter always sends. */
export function Composer({ value, onChange, onSend, busy, placeholder = 'Ask anything about the event…', onMic, recording, micLevel = 0, inputRef, autoFocus, className }: {
  value: string; onChange: (v: string) => void; onSend: () => void; busy?: boolean; placeholder?: string;
  onMic?: () => void; recording?: boolean; micLevel?: number; inputRef?: React.RefObject<HTMLTextAreaElement | null>; autoFocus?: boolean; className?: string;
}) {
  const local = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? local;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(180, Math.max(24, el.scrollHeight))}px`;
  }, [value, ref]);
  const can = !!value.trim() && !busy;
  return (
    <div className={cn('flex items-end gap-2 rounded-[22px] bg-white py-2 pr-2 pl-4 shadow-[0_1px_2px_rgb(23_21_15/.04),0_8px_24px_-12px_rgb(23_21_15/.18)]', HAIR, className)}>
      <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} rows={1} placeholder={placeholder} aria-label="Message" maxLength={800} autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey) && !e.nativeEvent.isComposing) { e.preventDefault(); if (can) onSend(); }
        }}
        className="max-h-[180px] min-h-[24px] flex-1 resize-none bg-transparent py-1.5 text-[15.5px] leading-[22px] text-fg outline-none placeholder:text-fg-3" />
      {onMic ? (
        <button type="button" onClick={onMic} aria-label={recording ? 'Stop and send' : 'Ask by voice'}
          className={cn('relative grid size-9 shrink-0 place-items-center rounded-full transition-colors', recording ? 'bg-[#e5484d] text-white' : 'text-fg-2 hover:bg-[rgb(23_21_15/.05)]')}>
          {recording ? <motion.span className="absolute inset-0 rounded-full bg-[#e5484d]" animate={{ scale: [1, 1 + micLevel * 0.5 + 0.08, 1], opacity: [0.5, 0, 0.5] }} transition={{ duration: 1.1, repeat: Infinity }} /> : null}
          {recording ? <Square className="relative size-3.5 fill-white" strokeWidth={0} /> : <Mic className="size-[18px]" strokeWidth={1.9} />}
        </button>
      ) : null}
      <button type="button" onClick={onSend} disabled={!can} aria-label="Send"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[#17150f] text-white transition-opacity disabled:opacity-25">
        <ArrowUp className="size-[18px]" strokeWidth={2.25} />
      </button>
    </div>
  );
}

/** Three breathing dots while the assistant thinks. */
export function Thinking({ label = 'Thinking' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 py-1 text-[13.5px] text-fg-3" aria-live="polite">
      <span className="typing" aria-hidden><i /><i /><i /></span>{label}…
    </span>
  );
}

export { MapPin };
