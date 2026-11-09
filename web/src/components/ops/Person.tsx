// Person chip: neutral monogram circle + name (SYSTEM.md Monogram, scaled down).
import { cn } from '@/lib/utils';
import { initials } from './util';

export function Monogram({ name, size = 20, ink, className }: { name: string; size?: number; ink?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold tabular-nums', ink ? 'bg-[#17150f] text-white' : 'bg-[#eeede9] text-fg-2', className)}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)), letterSpacing: '-0.02em' }}>
      {initials(name)}
    </span>
  );
}

export function Person({ name, size = 20, compact, className }: { name: string; size?: number; compact?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Monogram name={name} size={size} />
      <span className={cn('truncate font-medium text-fg', compact ? 'text-[13px]' : 'text-[12px]')}>{name}</span>
    </span>
  );
}
