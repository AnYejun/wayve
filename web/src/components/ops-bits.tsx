// Shared ops-tracker vocabulary (issue key, status, priority, kind, source, evidence quote, AI provenance).
// Every surface (HQ board, staff phone, scribe phone) renders issues with these so they read as one system.
import { Ban, CheckCircle2, Circle, CircleDot, Gavel, HelpCircle, ListTodo, MessageCircle, Mic, Radio, TriangleAlert, FileText } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import {
  ISSUE_KIND_LABEL, ISSUE_STATUS_LABEL, PRIORITY_LABEL, SOURCE_LABEL,
  type EvidenceRef, type IssueKind, type IssueStatus, type Priority, type UtteranceSource,
} from '@shared/contracts';
import { clock } from '@/lib/time';
import { cn } from '@/lib/utils';

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

export const PRIORITY_COLOR: Record<Priority, string> = { p0: '#b91c1c', p1: '#c8553f', p2: '#8a8884', p3: '#b9b8b4' };
export const STATUS_ICON: Record<IssueStatus, Icon> = { open: Circle, in_progress: CircleDot, blocked: Ban, done: CheckCircle2 };
export const STATUS_COLOR: Record<IssueStatus, string> = { open: '#6b6965', in_progress: '#c9a13f', blocked: '#c8553f', done: '#58a069' };
export const KIND_ICON: Record<IssueKind, Icon> = { task: ListTodo, problem: TriangleAlert, decision: Gavel, question: HelpCircle };
export const SOURCE_ICON: Record<UtteranceSource, Icon> = { scribe: Mic, talk: Radio, chat: MessageCircle, report: FileText };

/** "WV-12" in mono, quiet. */
export function IssueKey({ k, className }: { k: string; className?: string }) {
  return <span className={cn('font-mono text-[12px] font-medium tracking-[.02em] text-fg-3 tabular-nums whitespace-nowrap', className)}>{k}</span>;
}

/** Status: icon + label (Linear-like). `iconOnly` for dense rows (label goes to aria-label). */
export function IssueStatusPill({ status, iconOnly, className }: { status: IssueStatus; iconOnly?: boolean; className?: string }) {
  const I = STATUS_ICON[status];
  const c = STATUS_COLOR[status];
  if (iconOnly) return <I size={16} strokeWidth={2} style={{ color: c }} aria-label={ISSUE_STATUS_LABEL[status]} role="img" className={cn('shrink-0', className)} />;
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium whitespace-nowrap text-fg-2', className)}
      style={{ boxShadow: 'inset 0 0 0 .5px rgba(23,21,15,.18)' }}>
      <I size={13} strokeWidth={2} style={{ color: c }} />{ISSUE_STATUS_LABEL[status]}
    </span>
  );
}

/** Priority: 3 signal bars (Linear) + label; p0 is a solid red "Urgent" pill. */
export function PriorityBadge({ priority, showLabel = true, className }: { priority: Priority; showLabel?: boolean; className?: string }) {
  const c = PRIORITY_COLOR[priority];
  if (priority === 'p0') {
    return (
      <span className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-semibold text-white whitespace-nowrap', className)} style={{ background: c }}>
        <TriangleAlert size={12} strokeWidth={2.25} />{PRIORITY_LABEL.p0}
      </span>
    );
  }
  const bars = priority === 'p1' ? 3 : priority === 'p2' ? 2 : 1;
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 text-[12px] font-medium text-fg-2 whitespace-nowrap', className)} aria-label={`Priority ${PRIORITY_LABEL[priority]}`}>
      <span className="flex h-3 items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((b) => <span key={b} className="w-[3px] rounded-[1px]" style={{ height: 4 + b * 3, background: b <= bars ? c : 'rgba(23,21,15,.12)' }} />)}
      </span>
      {showLabel && PRIORITY_LABEL[priority]}
    </span>
  );
}

export function KindTag({ kind, className }: { kind: IssueKind; className?: string }) {
  const I = KIND_ICON[kind];
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-md bg-wash-2 px-1.5 text-[12px] font-medium text-fg-2 whitespace-nowrap', className)}>
      <I size={13} strokeWidth={1.75} />{ISSUE_KIND_LABEL[kind]}
    </span>
  );
}

export function SourceTag({ source, className }: { source: UtteranceSource; className?: string }) {
  const I = SOURCE_ICON[source];
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 text-[12px] font-medium text-fg-3 whitespace-nowrap', className)}>
      <I size={12} strokeWidth={1.75} />{SOURCE_LABEL[source]}
    </span>
  );
}

/** Evidence quote: the exact words an issue change came from, with who/when. Never paraphrased. */
export function EvidenceQuote({ e, className, clamp = 2 }: { e: EvidenceRef; className?: string; clamp?: number }) {
  const srcLabel = (SOURCE_LABEL as Record<string, string>)[e.source] ?? 'Observation';
  return (
    <figure className={cn('min-w-0 border-l-2 border-line-3 pl-2.5', className)}>
      <blockquote className="text-[13px] leading-[19px] text-fg-2" style={{ display: '-webkit-box', WebkitLineClamp: clamp, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        “{e.text}”
      </blockquote>
      <figcaption className="mt-0.5 text-[12px] text-fg-3 tabular-nums">
        {clock(e.at)} · {e.speaker ?? srcLabel}{e.speaker ? ` · ${srcLabel}` : ''}
      </figcaption>
    </figure>
  );
}

/** "AI" provenance chip for changes the model proposed and the rules auto-applied. */
export function AiApplied({ confidence, className }: { confidence?: number | null; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-[6px] px-1.5 text-[11px] font-semibold text-fg-2 whitespace-nowrap', className)}
      style={{ boxShadow: 'inset 0 0 0 .5px rgba(23,21,15,.24)' }}>
      Applied by AI{confidence != null ? <span className="font-medium text-fg-3 tabular-nums">{Math.round(confidence * 100)}%</span> : null}
    </span>
  );
}

/** Live "recording" dot for scribe devices (red, pinging). */
export function RecDot({ on = true, className }: { on?: boolean; className?: string }) {
  return <span className={cn('live-dot', className)} style={{ color: on ? '#e5484d' : '#b9b8b4' }} data-ping={on || undefined} aria-label={on ? 'Recording' : 'Not recording'} role="img" />;
}
