// Shell primitives: section header, panels, empty states, KPI strip. One visual system for every section.
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { cn } from '@/lib/utils';

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

export const panel = 'rounded-[14px] border border-[rgb(23_21_15/.09)] bg-white shadow-[0_1px_2px_rgb(23_21_15/.03)]';

export function SectionHeader({ title, sub, actions, className }: { title: string; sub?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-end gap-x-6 gap-y-3', className)}>
      <div className="min-w-0 flex-1">
        <h1 className="text-[28px] leading-[34px] font-[650] tracking-[-0.025em] text-fg">{title}</h1>
        {sub ? <div className="mt-1 text-[14px] leading-5 text-fg-2">{sub}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Page frame for a section: consistent gutters and max width. `bleed` = full width (maps, tables). */
export function Page({ children, bleed, className }: { children: ReactNode; bleed?: boolean; className?: string }) {
  return <div className={cn('px-5 pt-7 pb-14 md:px-8 lg:px-10', !bleed && 'mx-auto max-w-[1440px]', className)}>{children}</div>;
}

export function PanelTitle({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-12 items-center gap-2 border-b border-[rgb(23_21_15/.07)] px-4">
      <span className="text-[13px] font-semibold text-fg">{title}</span>
      {meta ? <span className="text-[12px] text-fg-3 tabular-nums">{meta}</span> : null}
      {actions ? <span className="ml-auto flex items-center gap-1.5">{actions}</span> : null}
    </div>
  );
}

export function Empty({ icon: I, title, body, action, className }: { icon: Icon; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <span className="grid size-10 place-items-center rounded-[12px] bg-[#f4f3f1] text-fg-2"><I size={19} strokeWidth={1.75} /></span>
      <p className="mt-3.5 text-[15px] font-semibold text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-[360px] text-[13px] leading-[19px] text-fg-2">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export type Kpi = { label: string; value: number; format?: (n: number) => string; sub?: string; tone?: 'danger' | 'good' | 'quiet' };

export function KpiStrip({ items }: { items: Kpi[] }) {
  const reduced = useReducedMotion();
  return (
    <div className={cn(panel, 'grid grid-cols-2 overflow-hidden sm:grid-cols-3 xl:grid-cols-6')}>
      {items.map((k, i) => (
        <motion.div key={k.label} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.25 }}
          className="border-[rgb(23_21_15/.07)] px-4 py-3.5 [&:not(:first-child)]:border-l max-sm:[&:nth-child(odd)]:border-l-0 max-xl:[&:nth-child(n+3)]:border-t sm:max-xl:[&:nth-child(3n+1)]:border-l-0 sm:max-xl:[&:nth-child(n+4)]:border-t sm:max-xl:[&:nth-child(3)]:border-t-0">
          <div className="text-[12px] font-medium text-fg-2">{k.label}</div>
          <div className={cn('mt-1.5 text-[24px] leading-none font-[650] tracking-[-0.02em] tabular-nums', k.tone === 'danger' && k.value > 0 ? 'text-[#b91c1c]' : 'text-fg')}>
            <AnimatedNumber value={k.value} format={k.format} />
          </div>
          {k.sub ? <div className={cn('mt-1.5 truncate text-[12px]', k.tone === 'danger' && k.value > 0 ? 'text-[#b91c1c]' : k.tone === 'good' ? 'text-[#376c45]' : 'text-fg-3')}>{k.sub}</div> : null}
        </motion.div>
      ))}
    </div>
  );
}

/** Tiny inline sparkline (values oldest → newest). */
export function Spark({ values, w = 56, h = 16, color = '#17150f' }: { values: number[]; w?: number; h?: number; color?: string }) {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - (v / max) * (h - 2)).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0 overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** "3m 20s" / "1h 05m" */
export function dur(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
