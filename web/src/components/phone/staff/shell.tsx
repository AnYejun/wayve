// Staff app chrome: header (logo + bell), event switcher row with the Live pill, frosted 5-tab bar with a sliding pill,
// notification sheet, per-device prefs (radio auto-play, haptics). Motion via motion/react (design/motion.ts).
import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Bell, Check, ChevronDown, ClipboardList, Ellipsis, Map, Radio, SquarePen } from 'lucide-react';
import type { MyEvent, Notify } from '@shared/contracts';
import type { LiveStatus } from '@/lib/live';
import { ago, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Logo } from '@/design/Logo';
import { spring } from '@/design/motion';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { CARD } from '../common';

// ── prefs + haptics ──────────────────────────────────────────────────────────────────────────────────────────────────

export type Prefs = { autoplay: boolean; haptics: boolean };
const read = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v == null ? d : v === '1'; } catch { return d; } };
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => ({ autoplay: read('wayve:autoplay', true), haptics: read('wayve:haptics', true) }));
  const set = (p: Partial<Prefs>) => setPrefs((cur) => {
    const next = { ...cur, ...p };
    try { localStorage.setItem('wayve:autoplay', next.autoplay ? '1' : '0'); localStorage.setItem('wayve:haptics', next.haptics ? '1' : '0'); } catch { /* private mode */ }
    return next;
  });
  return [prefs, set] as const;
}
export function haptic(pattern: number | number[] = 12) {
  if (!read('wayve:haptics', true)) return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

// ── tabs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type StaffTab = 'field' | 'report' | 'tasks' | 'radio' | 'more';
const TABS: Array<{ id: StaffTab; label: string; Icon: typeof Map }> = [
  { id: 'field', label: 'Field', Icon: Map },
  { id: 'report', label: 'Report', Icon: SquarePen },
  { id: 'tasks', label: 'Tasks', Icon: ClipboardList },
  { id: 'radio', label: 'Radio', Icon: Radio },
  { id: 'more', label: 'More', Icon: Ellipsis },
];

export function TabBar({ tab, onTab, badges }: { tab: StaffTab; onTab: (t: StaffTab) => void; badges: Partial<Record<StaffTab, { n: number; tone?: 'ink' | 'red' }>> }) {
  return (
    <nav className="mat-bar fixed inset-x-0 bottom-0 z-(--z-header) pb-(--safe-b) shadow-[inset_0_.5px_0_rgb(23_21_15/.14)]" aria-label="Sections">
      <ul className="mx-auto grid h-[62px] max-w-[640px] grid-cols-5 px-1.5 pt-1.5">
        {TABS.map(({ id, label, Icon }) => {
          const on = tab === id;
          const b = badges[id];
          return (
            <li key={id} className="relative">
              <button type="button" onClick={() => { if (!on) haptic(8); onTab(id); }} aria-current={on ? 'page' : undefined}
                className={cn('relative flex h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-[14px] text-[11px] font-semibold transition-colors duration-150',
                  on ? 'text-fg' : 'text-fg-3')}>
                {on ? <motion.span layoutId="tab-pill" transition={spring.smooth} className="absolute inset-x-1.5 inset-y-0.5 rounded-[14px] bg-[rgb(23_21_15/.06)]" aria-hidden /> : null}
                <span className="relative">
                  <Icon className="size-[22px]" strokeWidth={on ? 2 : 1.75} />
                  {b && b.n > 0 ? (
                    <span className={cn('absolute -top-1.5 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums text-white',
                      b.tone === 'red' ? 'bg-[#e5484d]' : 'bg-[#17150f]')}>{b.n > 9 ? '9+' : b.n}</span>
                  ) : null}
                </span>
                <span className="relative">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ── header ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function StaffHeader({ eventName, status, unread, onBell, onEvent }: {
  eventName: string; status: LiveStatus; unread: number; onBell: () => void; onEvent: () => void;
}) {
  const live = status === 'live';
  return (
    <header className="mat-bar sticky top-0 z-(--z-header) pt-(--safe-t)">
      <div className="mx-auto flex h-[50px] max-w-[640px] items-center px-4">
        <Logo size={19} />
        <motion.button type="button" whileTap={{ scale: 0.92 }} transition={spring.snappy} onClick={onBell} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
          className="relative ml-auto grid size-11 place-items-center rounded-full text-fg active:bg-[rgb(23_21_15/.05)]">
          <Bell className="size-[22px]" strokeWidth={1.75} />
          {unread > 0 ? <span className="absolute top-2.5 right-3 size-2.5 rounded-full bg-[#e5484d] ring-2 ring-white" aria-hidden /> : null}
        </motion.button>
      </div>
      <div className="mx-auto max-w-[640px] px-4 pb-2.5">
        <button type="button" onClick={onEvent}
          className="flex h-11 w-full items-center gap-2 rounded-[14px] bg-[rgb(23_21_15/.05)] pr-2 pl-3.5 text-left transition-[scale] duration-120 active:scale-[.985]">
          <span className="min-w-0 truncate text-[15px] font-semibold text-fg">{eventName}</span>
          <ChevronDown className="size-4 shrink-0 text-fg-2" strokeWidth={2} />
          <span className={cn('ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold',
            live ? 'bg-[#e8f5ec] text-[#2f7a45]' : status === 'error' ? 'bg-[#fdecec] text-[#b91c1c]' : 'bg-[#fdf3e3] text-[#8a5a12]')}>
            <span className="live-dot size-[7px]" style={{ color: live ? '#34a853' : status === 'error' ? '#b91c1c' : '#c6824b' }} data-ping={live || undefined} />
            {live ? 'Live' : status === 'error' ? 'Offline' : status === 'connecting' ? 'Connecting' : 'Reconnecting'}
          </span>
        </button>
      </div>
    </header>
  );
}

/** iOS large title + optional subtitle. */
export function LargeTitle({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end gap-3 px-1">
      <div className="min-w-0 flex-1">
        <h1 className="text-[32px] leading-[38px] font-bold tracking-[-0.03em] text-fg">{title}</h1>
        {sub ? <p className="mt-1 text-[15px] leading-[21px] text-fg-2">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return <div className="mb-2.5 flex items-center px-1"><h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{children}</h2><span className="ml-auto">{right}</span></div>;
}

// ── sheets ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function EventSheet({ open, onOpenChange, events, currentId, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; events: MyEvent[]; currentId: string; onPick: (id: string) => void;
}) {
  const staffEvents = events.filter((e) => e.role === 'staff' || e.role === 'admin');
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="pb-3 text-left">
          <DrawerTitle className="text-left">Your events</DrawerTitle>
          <DrawerDescription className="text-left">To join another event, scan its staff QR code.</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[60dvh] overflow-y-auto px-4 pb-[calc(var(--safe-b)+20px)]">
          {staffEvents.length === 0 ? <p className="py-6 text-center text-[15px] text-fg-2">This phone joined with a staff QR. To switch events, scan another event's staff QR.</p> : (
            <ul className={cn(CARD, 'overflow-hidden')}>
              {staffEvents.map((e, i) => (
                <li key={e.event.id} className="relative">
                  {i > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden /> : null}
                  <button type="button" onClick={() => onPick(e.event.id)} className="flex min-h-[58px] w-full items-center gap-3 px-4 text-left active:bg-[rgb(23_21_15/.05)]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-semibold text-fg">{e.event.name}</span>
                      <span className="block text-[13px] text-fg-3">{e.role === 'admin' ? 'Organizer' : 'Staff'} · {e.status === 'live' ? 'Live' : e.status === 'upcoming' ? 'Upcoming' : 'Ended'}</span>
                    </span>
                    {e.event.id === currentId ? <Check className="size-[18px] text-fg" strokeWidth={2.25} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function NotificationsSheet({ open, onOpenChange, items, seenAt, onOpenItem }: {
  open: boolean; onOpenChange: (o: boolean) => void; items: Notify[]; seenAt: number; onOpenItem: (n: Notify) => void;
}) {
  const now = useNow(15_000);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="pb-3 text-left"><DrawerTitle className="text-left">Notifications</DrawerTitle></DrawerHeader>
        <div className="max-h-[62dvh] overflow-y-auto px-4 pb-[calc(var(--safe-b)+20px)]">
          {items.length === 0 ? <p className="py-10 text-center text-[15px] text-fg-2">You're all caught up.</p> : (
            <ul className={cn(CARD, 'overflow-hidden')}>
              {items.map((n, i) => (
                <li key={n.id} className="relative">
                  {i > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden /> : null}
                  <button type="button" onClick={() => onOpenItem(n)} className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-[rgb(23_21_15/.05)]">
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.at > seenAt ? 'bg-[#e5484d]' : 'bg-transparent')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-fg">{n.title}</span>
                      <span className="mt-0.5 block text-[14px] leading-5 text-fg-2">{n.body}</span>
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-fg-3">{ago(n.at, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** Chip with a coloured dot; selected = tinted fill (mockup). */
export function DotChip({ label, color, on, onClick, disabled }: { label: string; color: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button type="button" whileTap={{ scale: 0.95 }} transition={spring.snappy} onClick={() => { haptic(6); onClick(); }} disabled={disabled} aria-pressed={on}
      className={cn('inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold transition-colors duration-150 disabled:opacity-40',
        on ? 'text-fg' : 'bg-[rgb(23_21_15/.04)] text-fg-2')}
      style={on ? { background: `color-mix(in srgb, ${color} 14%, white)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 40%, transparent)` } : undefined}>
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />{label}
    </motion.button>
  );
}

/** Mounts children once a condition was true (keeps sheets cheap). */
export function useOnce(cond: boolean) { const [v, setV] = useState(cond); useEffect(() => { if (cond) setV(true); }, [cond]); return v; }
