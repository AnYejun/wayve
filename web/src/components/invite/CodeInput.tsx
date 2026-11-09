// 6-character event code: one box per character, auto-uppercase, auto-advance, paste-to-fill, monospace.
import { useRef } from 'react';
import { cn } from '@/lib/utils';

const ALPHABET = /[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g; // the join-code alphabet (no 0/O/1/I/L)

export function CodeInput({ value, onChange, onComplete, autoFocus, size = 'md' }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean; size?: 'md' | 'lg';
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const set = (raw: string, from = 0) => {
    const clean = raw.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(ALPHABET, '');
    const chars = value.padEnd(6, ' ').split('');
    for (let i = 0; i < clean.length && from + i < 6; i++) chars[from + i] = clean[i];
    const next = chars.join('').replace(/\s+$/, '').slice(0, 6);
    onChange(next);
    const focusAt = Math.min(5, from + clean.length);
    refs.current[focusAt]?.focus();
    if (next.replace(/\s/g, '').length === 6) onComplete?.(next);
  };
  return (
    <div className="flex justify-center gap-2" role="group" aria-label="Event code">
      {Array.from({ length: 6 }, (_, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} value={value[i]?.trim() ?? ''} autoFocus={autoFocus && i === 0}
          inputMode="text" autoCapitalize="characters" autoComplete="one-time-code" aria-label={`Character ${i + 1}`} maxLength={6}
          onChange={(e) => set(e.target.value, i)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i]?.trim()) { e.preventDefault(); onChange(value.slice(0, Math.max(0, i - 1))); refs.current[Math.max(0, i - 1)]?.focus(); }
            if (e.key === 'ArrowLeft') refs.current[Math.max(0, i - 1)]?.focus();
            if (e.key === 'ArrowRight') refs.current[Math.min(5, i + 1)]?.focus();
          }}
          onFocus={(e) => e.currentTarget.select()}
          className={cn('rounded-[12px] border border-[rgb(23_21_15/.14)] bg-white text-center font-mono font-semibold text-fg uppercase caret-transparent outline-none transition-[box-shadow,border-color]',
            'focus:border-[#17150f] focus:shadow-[0_0_0_3px_rgb(23_21_15/.08)]', size === 'lg' ? 'h-14 w-12 text-[24px]' : 'h-12 w-10 text-[20px]')} />
      ))}
    </div>
  );
}
