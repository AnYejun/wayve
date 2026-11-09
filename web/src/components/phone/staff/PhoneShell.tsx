// Staff phone chrome (v4): a calm header (WAYVE mark · event · live dot · my avatar), a frosted two-tab bar
// (Chat · Radio) with a sliding pill, and the "me" sheet (name, team, where I am right now).
import { motion } from 'motion/react';
import { Check, ChevronRight, LogOut, MapPin, MessageCircle, QrCode, Radio } from 'lucide-react';
import type { Me, MyEvent, Snapshot } from '@shared/contracts';
import type { LiveStatus } from '@/lib/live';
import { cn } from '@/lib/utils';
import { Logo } from '@/design/Logo';
import { spring } from '@/design/motion';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { HAIR } from '../common';
import { haptic } from './shell';

export type PhoneTab = 'chat' | 'radio';
const TABS = [
  { id: 'chat', label: 'Chat', Icon: MessageCircle },
  { id: 'radio', label: 'Radio', Icon: Radio },
] as const;

export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';

/** 62 px tall (RadioTab's dock sits right above it). */
export function PhoneTabBar({ tab, onTab, badges }: { tab: PhoneTab; onTab: (t: PhoneTab) => void; badges: Partial<Record<PhoneTab, number>> }) {
  return (
    <nav className="mat-bar fixed inset-x-0 bottom-0 z-(--z-header) pb-(--safe-b) shadow-[inset_0_.5px_0_rgb(23_21_15/.14)]" aria-label="Sections">
      <ul className="mx-auto grid h-[62px] max-w-[440px] grid-cols-2 gap-2 px-5 pt-[7px]">
        {TABS.map(({ id, label, Icon }) => {
          const on = tab === id;
          const n = badges[id] ?? 0;
          return (
            <li key={id}>
              <button type="button" onClick={() => { if (!on) haptic(8); onTab(id); }} aria-current={on ? 'page' : undefined}
                className={cn('relative flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-colors duration-150', on ? 'text-fg' : 'text-fg-3')}>
                {on ? <motion.span layoutId="phone-tab-pill" transition={spring.smooth} className="absolute inset-0 rounded-full bg-[rgb(23_21_15/.07)]" aria-hidden /> : null}
                <span className="relative">
                  <Icon className="size-[21px]" strokeWidth={on ? 2.1 : 1.8} />
                  {n > 0 ? (
                    <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring.snappy}
                      className="absolute -top-1.5 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#e5484d] px-1 text-[10px] font-bold tabular-nums text-white">{n > 9 ? '9+' : n}</motion.span>
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

export function PhoneHeader({ eventName, status, name, waiting, onWaiting, onMe }: {
  eventName: string; status: LiveStatus; name: string; waiting: number; onWaiting: () => void; onMe: () => void;
}) {
  const live = status === 'live';
  const color = live ? '#34a853' : status === 'error' ? '#b91c1c' : '#c6824b';
  return (
    <header className="mat-bar sticky top-0 z-(--z-header) pt-(--safe-t) shadow-[inset_0_-.5px_0_rgb(23_21_15/.1)]">
      <div className="mx-auto flex h-[52px] max-w-[640px] items-center gap-2.5 pr-2 pl-4">
        <Logo size={20} markOnly />
        <span className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.01em] text-fg">{eventName}</span>
        <span className="live-dot size-[7px] shrink-0" style={{ color }} data-ping={live || undefined} aria-label={live ? 'Live' : status === 'error' ? 'Offline' : 'Reconnecting'} role="img" />
        <span className="ml-auto" />
        {waiting > 0 ? (
          <motion.button type="button" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} whileTap={{ scale: 0.94 }} transition={spring.snappy}
            onClick={() => { haptic(10); onWaiting(); }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#17150f] pr-3 pl-2.5 text-[13px] font-semibold text-white">
            <span className="grid size-[18px] place-items-center rounded-full bg-[#e5484d] text-[11px] tabular-nums">{waiting}</span>waiting
          </motion.button>
        ) : null}
        <motion.button type="button" whileTap={{ scale: 0.92 }} transition={spring.snappy} onClick={onMe} aria-label={`You: ${name}`}
          className="grid size-11 shrink-0 place-items-center rounded-full">
          <span className="grid size-[34px] place-items-center rounded-full bg-[#17150f] text-[13px] font-semibold tracking-[.02em] text-white">{initials(name)}</span>
        </motion.button>
      </div>
    </header>
  );
}

/** Me: name + team (edit opens the name/team sheet), where I am (zone), event switcher, how I joined. */
export function ProfileSheet({ open, onOpenChange, snap, me, name, teamName, myZoneId, onZone, onEdit, events, onPickEvent, signedIn, onSignOut }: {
  open: boolean; onOpenChange: (o: boolean) => void; snap: Snapshot; me: Me; name: string; teamName: string | null; myZoneId: string | null;
  onZone: (zoneId: string) => void; onEdit: () => void; events: MyEvent[]; onPickEvent: (id: string) => void; signedIn: boolean; onSignOut: () => void;
}) {
  const others = events.filter((e) => e.event.id !== me.eventId && (e.role === 'staff' || e.role === 'admin'));
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[88dvh]!">
        <div className="overflow-y-auto px-4 pt-2 pb-[calc(var(--safe-b)+20px)]">
          <div className="flex items-center gap-3.5">
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-[#17150f] text-[19px] font-semibold text-white">{initials(name)}</span>
            <div className="min-w-0 flex-1">
              <DrawerTitle className="truncate text-[21px] leading-[26px] font-bold tracking-[-0.02em]">{name}</DrawerTitle>
              <DrawerDescription className="mt-0.5 truncate text-[14px] text-fg-2">{teamName ?? 'No team yet'} · {snap.event.name}</DrawerDescription>
            </div>
            <motion.button type="button" whileTap={{ scale: 0.95 }} transition={spring.snappy} onClick={onEdit}
              className={cn('h-9 shrink-0 rounded-full bg-white px-4 text-[14px] font-semibold text-fg', HAIR)}>Edit</motion.button>
          </div>

          {snap.zones.length ? (
            <section className="mt-6">
              <h3 className="flex items-center gap-1.5 px-0.5 text-[13px] font-semibold tracking-[.03em] text-fg-3 uppercase"><MapPin className="size-3.5" strokeWidth={2.25} />Where are you?</h3>
              <p className="mt-1 px-0.5 text-[13.5px] text-fg-2">Dispatch sends you work near you.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {snap.zones.map((z) => {
                  const on = z.id === myZoneId;
                  return (
                    <motion.button key={z.id} type="button" whileTap={{ scale: 0.95 }} transition={spring.snappy} onClick={() => { if (!on) { haptic(10); onZone(z.id); } }}
                      aria-pressed={on}
                      className={cn('inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14.5px] font-medium transition-colors', on ? 'bg-[#17150f] text-white' : cn('bg-white text-fg', HAIR))}>
                      {on ? <Check className="size-4" strokeWidth={2.5} /> : null}{z.name}
                    </motion.button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {others.length ? (
            <section className="mt-6">
              <h3 className="px-0.5 text-[13px] font-semibold tracking-[.03em] text-fg-3 uppercase">Your other events</h3>
              <div className={cn('mt-2 divide-y divide-[rgb(23_21_15/.07)] overflow-hidden rounded-[16px] bg-white', HAIR)}>
                {others.map((e) => (
                  <button key={e.event.id} type="button" onClick={() => onPickEvent(e.event.id)} className="flex h-[52px] w-full items-center gap-2 px-4 text-left active:bg-[rgb(23_21_15/.03)]">
                    <span className="min-w-0 flex-1 truncate text-[15.5px] font-medium text-fg">{e.event.name}</span>
                    <ChevronRight className="size-4 text-fg-3" strokeWidth={2} />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="mt-7 flex items-center gap-2 px-0.5 text-[13px] text-fg-3">
            <QrCode className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">Joined with the staff QR — no account needed.</span>
            {signedIn ? (
              <button type="button" onClick={onSignOut} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 font-semibold text-fg-2 active:bg-[rgb(23_21_15/.05)]">
                <LogOut className="size-4" strokeWidth={2} />Sign out
              </button>
            ) : null}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
