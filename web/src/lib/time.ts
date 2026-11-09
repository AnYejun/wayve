// Relative and clock time (English). `now` should come from useNow() so labels tick.
import { useEffect, useState } from 'react';
import { serverNow } from './live.ts';

export function ago(ts: number | null | undefined, now = serverNow()): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
/** "2:05 PM" in the viewer's time zone. */
export function clock(ts: number): string {
  return CLOCK.format(ts);
}

/** Re-render every `ms` and return the server-aligned now. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
