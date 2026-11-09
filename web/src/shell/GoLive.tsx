// "Go live" — the event's launch checklist at the top of the Dashboard. Every step is detected from live data and has one
// action, so an organizer runs the event from here instead of digging through Settings. Hides itself once everything is ready.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Bot, Cable, Check, ChevronDown, Link2, Map as MapIcon, MessageCircle, ScrollText, Users } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '@/lib/api';
import { serverNow } from '@/lib/live';
import { isOnline } from '@/components/ops/util';
import { spring } from '@/design/motion';
import { cn } from '@/lib/utils';
import { useShell } from './context';
import { panel } from './ui';

type Step = { key: string; icon: typeof MapIcon; title: string; detail: string; done: boolean; action: string; run: () => void };

async function copyLink(url: string, what: string) {
  try { await navigator.clipboard.writeText(url); toast.success(`${what} link copied`, { description: url }); } catch { toast.error('Couldn’t copy', { description: url }); }
}

export function GoLive() {
  const { snap, eventId } = useShell();
  const nav = useNavigate();
  const storeKey = `wayve:golive:${eventId}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(storeKey) === 'hidden'; } catch { return false; } });
  const [open, setOpen] = useState(true);
  const [knowledge, setKnowledge] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    API.knowledge(eventId).then((k) => { if (alive) setKnowledge(k.text.trim().length); }).catch(() => { if (alive) setKnowledge(0); });
    return () => { alive = false; };
  }, [eventId]);

  if (!snap || snap.me.role !== 'admin' || hidden) return null;
  const code = snap.event.joinCode;
  const origin = location.origin;
  const now = serverNow();
  const staff = snap.participants.filter((p) => p.role === 'staff').length;
  const sensors = snap.devices.filter((d) => d.deviceType === 'camera' || d.deviceType === 'scribe');
  const sensorsOnline = sensors.filter((d) => isOnline(d, now)).length;
  const attendees = snap.attendees?.count ?? 0;
  const crew = (snap as { crew?: unknown[] }).crew?.length ?? 0;
  const go = (path: string) => nav(`/e/${eventId}/${path}`);

  const steps: Step[] = [
    { key: 'map', icon: MapIcon, title: 'Venue map', done: snap.zones.length > 0,
      detail: snap.zones.length ? `${snap.event.map?.presetId ? 'Startup Branch · ' : ''}${snap.zones.length} zones` : 'Draw zones or use the preset',
      action: snap.zones.length ? 'View map' : 'Set up', run: () => go(snap.zones.length ? 'map' : 'settings?tab=map') },
    { key: 'staff', icon: Users, title: 'Invite staff', done: staff > 0,
      detail: staff ? `${staff} on the radio · QR + name, no account` : 'They join with a QR and a name',
      action: 'Copy link', run: () => void copyLink(`${origin}/j/${code}?as=staff`, 'Staff') },
    { key: 'devices', icon: Cable, title: 'Cameras & scribes', done: sensorsOnline > 0,
      detail: sensors.length ? `${sensorsOnline}/${sensors.length} live` : 'Scan a spot QR on each phone you mount',
      action: 'Install plan', run: () => go('devices?plan=1') },
    { key: 'attendees', icon: MessageCircle, title: 'Attendee chat', done: attendees > 0,
      detail: attendees ? `${attendees} attendees asking` : 'Put the QR on tables and the entrance',
      action: 'Copy link', run: () => void copyLink(`${origin}/j/${code}?as=guest`, 'Attendee chat') },
    { key: 'knowledge', icon: ScrollText, title: 'Run of show', done: (knowledge ?? 0) > 40,
      detail: (knowledge ?? 0) > 40 ? 'The assistant knows your schedule' : 'Paste your schedule, Wi-Fi, contacts',
      action: (knowledge ?? 0) > 40 ? 'Edit' : 'Add', run: () => go('settings?tab=knowledge') },
    { key: 'crew', icon: Bot, title: 'AI crew', done: crew >= 2,
      detail: crew ? `${crew} agents on duty` : 'Dispatcher, watchers, concierge',
      action: 'Open', run: () => go('crew') },
  ];
  const ready = steps.filter((s) => s.done).length;
  const all = ready === steps.length;
  const hide = () => { try { localStorage.setItem(storeKey, 'hidden'); } catch { /* storage off */ } setHidden(true); };

  return (
    <motion.section layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth} className={cn(panel, 'mt-6 overflow-hidden')}>
      <div className="flex items-center gap-3 px-5 py-3.5">
        <div className="relative size-9 shrink-0">
          <svg viewBox="0 0 36 36" className="size-9 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgb(23 21 15 / .08)" strokeWidth="3" />
            <motion.circle cx="18" cy="18" r="15" fill="none" stroke={all ? '#58a069' : '#17150f'} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 15} animate={{ strokeDashoffset: 2 * Math.PI * 15 * (1 - ready / steps.length) }} transition={spring.smooth} />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums text-fg">{ready}/{steps.length}</span>
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{all ? 'WAYVE is running your event' : 'Go live'}</div>
          <div className="truncate text-[13px] text-fg-2">{all ? 'Everything is connected. Hide this when you like.' : 'Six steps to run this event from here — each one is a click.'}</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={hide} className="h-8 rounded-full px-3 text-[13px] font-medium text-fg-2 transition-colors hover:bg-[rgb(23_21_15/.05)] hover:text-fg">Hide</button>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'}
            className="grid size-8 place-items-center rounded-full text-fg-2 transition-colors hover:bg-[rgb(23_21_15/.05)]">
            <ChevronDown size={16} strokeWidth={2} className={cn('transition-transform', !open && '-rotate-90')} />
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
            <ol className="grid grid-cols-1 border-t border-[rgb(23_21_15/.08)] sm:grid-cols-2 xl:grid-cols-3">
              {steps.map((s, i) => {
                const I = s.icon;
                return (
                  <li key={s.key} className={cn('flex items-center gap-3 px-5 py-3.5', 'border-[rgb(23_21_15/.07)] sm:border-r xl:[&:nth-child(3n)]:border-r-0', i >= 3 && 'xl:border-t', i >= 2 && 'max-xl:sm:border-t', i >= 1 && 'max-sm:border-t')}>
                    <span className={cn('grid size-8 shrink-0 place-items-center rounded-[9px] transition-colors', s.done ? 'bg-[#58a069] text-white' : 'bg-[rgb(23_21_15/.05)] text-fg-2')}>
                      {s.done ? <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.snappy}><Check size={16} strokeWidth={2.5} /></motion.span> : <I size={16} strokeWidth={1.75} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-fg">{s.title}</div>
                      <div className="truncate text-[12.5px] text-fg-3">{s.detail}</div>
                    </div>
                    <button type="button" onClick={s.run}
                      className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-transform active:scale-[.96]',
                        s.done ? 'text-fg-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.2)] hover:bg-[rgb(23_21_15/.04)]' : 'bg-[#17150f] text-white')}>
                      {s.action === 'Copy link' ? <Link2 size={13} strokeWidth={2} /> : null}{s.action}
                    </button>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
