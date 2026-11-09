// Shared vocabulary: every surface shows status / severity / modality / AI provenance the same way.
// Colour is never the only signal — each pill carries a text label.
import type { ComponentType, SVGProps } from 'react';
import {
  Ban, Camera, CircleAlert, MessageCircle, Droplets, Flame, HeartPulse, Hourglass, Mic, MessageSquareText, Package, PenLine, ShieldAlert, Users,
} from 'lucide-react';
import {
  INCIDENT_LABEL, MODALITY_LABEL, SEVERITY_LABEL, ZONE_STALE_MS, ZONE_STATUS_LABEL,
  type IncidentType, type Modality, type Severity, type Zone, type ZoneStatus,
} from '@shared/contracts';
import { SEVERITY_COLOR, STATUS_COLOR } from '@/design/status';
import type { LiveStatus } from '@/lib/live';
import { cn } from '@/lib/utils';

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

export const INCIDENT_ICON: Record<IncidentType, Icon> = {
  overcrowding: Users, fire_smoke: Flame, spill: Droplets, obstruction: Ban, medical: HeartPulse, fight: ShieldAlert,
  suspicious_item: Package, long_queue: Hourglass, other: CircleAlert,
};
export const MODALITY_ICON: Record<Modality, Icon> = { vision: Camera, voice: Mic, text: MessageSquareText, manual: PenLine, chat: MessageCircle };

export function isStale(z: Zone, now: number) {
  return z.lastObservedAt != null && now - z.lastObservedAt > ZONE_STALE_MS;
}

/** Zone status pill: dot + label. `stale` dims it and appends "· stale". */
export function ZoneStatusPill({ status, stale, className, size = 'md' }: { status: ZoneStatus; stale?: boolean; className?: string; size?: 'sm' | 'md' }) {
  const c = STATUS_COLOR[status];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium tabular-nums whitespace-nowrap',
      size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[13px]', stale && 'opacity-60', className)}
      style={{ color: c.fg, background: c.fill, boxShadow: `inset 0 0 0 .5px ${c.stroke}` }}>
      <span className="live-dot" style={{ color: c.dot }} data-ping={status === 'alert' || undefined} />
      {ZONE_STATUS_LABEL[status]}{stale ? ' · stale' : ''}
    </span>
  );
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const c = SEVERITY_COLOR[severity];
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] font-semibold whitespace-nowrap', className)}
      style={{ color: c, background: `color-mix(in srgb, ${c} 10%, white)`, boxShadow: `inset 0 0 0 .5px color-mix(in srgb, ${c} 45%, transparent)` }}>
      <span className="size-1.5 rounded-full" style={{ background: c }} />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

/** Icon tile for an incident type: 32px rounded square tinted by severity. */
export function IncidentGlyph({ type, severity, size = 32 }: { type: IncidentType; severity: Severity; size?: number }) {
  const I = INCIDENT_ICON[type];
  const c = SEVERITY_COLOR[severity];
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-[10px]" aria-label={INCIDENT_LABEL[type]} role="img"
      style={{ width: size, height: size, color: c, background: `color-mix(in srgb, ${c} 10%, white)`, boxShadow: `inset 0 0 0 .5px color-mix(in srgb, ${c} 35%, transparent)` }}>
      <I size={Math.round(size * 0.5)} strokeWidth={1.75} />
    </span>
  );
}

export function ModalityTag({ modality, className }: { modality: Modality; className?: string }) {
  const I = MODALITY_ICON[modality];
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-md bg-wash-2 px-1.5 text-[12px] font-medium text-fg-2 whitespace-nowrap', className)}>
      <I size={13} strokeWidth={1.75} />{MODALITY_LABEL[modality]}
    </span>
  );
}

/** Provenance label for model output. Model results are never shown without it. */
export function AiTag({ model, className }: { model?: string | null; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-[6px] px-1.5 text-[11px] font-semibold tracking-[.02em] text-fg-2 whitespace-nowrap', className)}
      style={{ boxShadow: 'inset 0 0 0 .5px rgba(23,21,15,.24)' }} title={model ? `Model: ${model}` : undefined}>
      AI{model ? <span className="ml-1 font-medium text-fg-3">{model}</span> : null}
    </span>
  );
}

/** 4px confidence track + percentage. Below 50% reads "Unsure". */
export function Confidence({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const low = value < 0.5;
  return (
    <span className={cn('inline-flex items-center gap-2 text-[12px] tabular-nums', low ? 'text-st-crowded-fg' : 'text-fg-2', className)}>
      <span className="relative h-1 w-12 overflow-hidden rounded-full bg-wash-3">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: low ? '#c6824b' : '#17150f' }} />
      </span>
      {low ? `Unsure ${pct}%` : `${pct}% sure`}
    </span>
  );
}

/** Connection indicator for the live stream. */
export function LiveIndicator({ status, className }: { status: LiveStatus; className?: string }) {
  const map: Record<LiveStatus, { label: string; color: string; ping?: boolean }> = {
    connecting: { label: 'Connecting', color: '#8a8884' },
    live: { label: 'Live', color: '#58a069', ping: true },
    reconnecting: { label: 'Reconnecting', color: '#c6824b' },
    error: { label: 'Offline', color: '#b91c1c' },
  };
  const m = map[status];
  return (
    <span className={cn('inline-flex h-7 items-center gap-2 rounded-full px-2.5 text-[13px] font-medium text-fg-2', className)}
      style={{ boxShadow: 'inset 0 0 0 .5px rgba(23,21,15,.15)' }} role="status" aria-live="polite">
      <span className="live-dot" style={{ color: m.color }} data-ping={m.ping || undefined} />
      {m.label}
    </span>
  );
}
