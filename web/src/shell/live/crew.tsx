// Shared crew vocabulary: persona glyph, status pill, post rows. Used by the Crew section, Dashboard rail, Radio badge.
import { ListOrdered, MessagesSquare, NotebookPen, Send, ShieldCheck, Users } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { AGENT_ROLE_DEFS, type AgentPost, type AgentRole, type CrewAgent, type CrewStatus } from '@shared/contracts';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;
export const ROLE_ICON: Record<AgentRole, Icon> = {
  queue_watcher: ListOrdered, safety_sentinel: ShieldCheck, crowd_analyst: Users, meeting_secretary: NotebookPen, dispatcher: Send, concierge: MessagesSquare,
};
export const ROLE_TINT: Record<AgentRole, string> = {
  queue_watcher: '#c6824b', safety_sentinel: '#c8553f', crowd_analyst: '#4f7fbf', meeting_secretary: '#8a6cc4', dispatcher: '#17150f', concierge: '#2f9196',
};

export function PersonaGlyph({ role, size = 36, className }: { role: AgentRole; size?: number; className?: string }) {
  const I = ROLE_ICON[role];
  const c = ROLE_TINT[role];
  return (
    <span className={cn('inline-grid shrink-0 place-items-center rounded-[10px]', className)} aria-label={AGENT_ROLE_DEFS[role].label} role="img"
      style={{ width: size, height: size, color: c, background: `color-mix(in srgb, ${c} 11%, white)`, boxShadow: `inset 0 0 0 .5px color-mix(in srgb, ${c} 35%, transparent)` }}>
      <I size={Math.round(size * 0.48)} strokeWidth={1.8} />
    </span>
  );
}

const STATUS: Record<CrewStatus, { label: string; dot: string; fg: string; bg: string; ping?: boolean }> = {
  watching: { label: 'Watching', dot: '#3f9a55', fg: '#2f6b3c', bg: '#eaf5ec', ping: true },
  listening: { label: 'Listening', dot: '#3f9a55', fg: '#2f6b3c', bg: '#eaf5ec', ping: true },
  on_duty: { label: 'On duty', dot: '#17150f', fg: '#17150f', bg: '#f1f0ee' },
  idle: { label: 'Device idle', dot: '#c9a13f', fg: '#7a5d14', bg: '#f8f2e2' },
  offline: { label: 'Device offline', dot: '#b9b8b4', fg: '#6b6965', bg: '#f4f3f1' },
  paused: { label: 'Paused', dot: '#b9b8b4', fg: '#6b6965', bg: '#f4f3f1' },
};
export function CrewStatusPill({ status, className }: { status: CrewStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium whitespace-nowrap', className)} style={{ color: s.fg, background: s.bg }}>
      <span className="live-dot" style={{ color: s.dot }} data-ping={s.ping || undefined} />{s.label}
    </span>
  );
}

/** "AI agent" badge for radio senders and feed rows. */
export function AgentBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex h-[18px] items-center rounded-[5px] px-1.5 text-[10.5px] font-semibold tracking-[.02em] text-[#5b4a99] whitespace-nowrap', className)}
      style={{ background: '#f1edfb', boxShadow: 'inset 0 0 0 .5px rgba(91,74,153,.25)' }}>AI agent</span>
  );
}

const KIND_LABEL: Record<AgentPost['kind'], string> = { radio: 'Radio', note: 'Note', proposal: 'Suggested', verify: 'Verified', assign: 'Assigned' };

export function CrewPostRow({ post, agent, now, onOpenIssue, compact }: { post: AgentPost; agent?: CrewAgent; now: number; onOpenIssue?: (key: string) => void; compact?: boolean }) {
  return (
    <div className={cn('flex gap-3', compact ? 'py-2.5' : 'py-3')}>
      {agent ? <PersonaGlyph role={agent.role} size={compact ? 26 : 30} /> : <span className="size-[26px]" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="truncate font-semibold text-fg">{agent?.name ?? 'Agent'}</span>
          <span className="text-fg-3">{KIND_LABEL[post.kind]}</span>
          <span className="ml-auto shrink-0 text-fg-3 tabular-nums">{ago(post.at, now)}</span>
        </div>
        <p className={cn('mt-0.5 text-fg-2', compact ? 'text-[13px] leading-[18px]' : 'text-[14px] leading-[20px]')}>{post.text}</p>
        {post.issueKey ? (
          <button type="button" onClick={() => onOpenIssue?.(post.issueKey!)}
            className="mt-1.5 inline-flex h-6 items-center rounded-[6px] bg-wash-2 px-1.5 font-mono text-[11px] font-medium text-fg-2 hover:bg-wash-3">→ {post.issueKey}</button>
        ) : null}
      </div>
    </div>
  );
}
