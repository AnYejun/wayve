// WAYVE app shell: one sidebar + one main area for everything an organizer does during the event.
// Route: /e/:eventId/:section  (sections in ./context). One SSE connection, shared through ShellContext.
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import {
  Bot, Cable, Database, Workflow, FileText, LayoutDashboard, Lock, Map as MapIcon, Radio, SearchX, Settings, Users, WifiOff,
} from 'lucide-react';
import { CenteredState } from './States';
import { useLive, serverNow } from '@/lib/live';
import { useNow } from '@/lib/time';
import { Logo } from '@/design/Logo';
import { LiveIndicator } from '@/components/bits';
import { AccountMenu, EventSwitcher } from '@/components/ops/AccountMenu';
import { isOnline, isUnacked } from '@/components/ops/util';
import { spring } from '@/design/motion';
import { cn } from '@/lib/utils';
import { AnyPulseDot } from './live/pulse';
import { SECTIONS, ShellContext, sectionPath, type Section } from './context';
import { AskDrawer } from '@/components/chat/AskDrawer';
import { TopBar } from './TopBar';

const views: Record<Section, ReturnType<typeof lazy>> = {
  dashboard: lazy(() => import('./sections/Dashboard')),
  map: lazy(() => import('./sections/Map')),
  radio: lazy(() => import('./sections/Radio')),
  assistant: lazy(() => import('./sections/Assistant')),
  crew: lazy(() => import('./sections/Crew')),
  database: lazy(() => import('./sections/Database')),
  devices: lazy(() => import('./sections/Devices')),
  reports: lazy(() => import('./sections/Reports')),
  people: lazy(() => import('./sections/People')),
  settings: lazy(() => import('./sections/Settings')),
};

type NavItem = { key: Section; label: string; icon: typeof LayoutDashboard };
const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: 'Operate', items: [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'map', label: 'Map', icon: MapIcon },
    { key: 'radio', label: 'Radio', icon: Radio },
    { key: 'assistant', label: 'Assistant', icon: Bot },
    { key: 'crew', label: 'AI crew', icon: Workflow },
  ] },
  { group: 'Data', items: [
    { key: 'database', label: 'Database', icon: Database },
    { key: 'devices', label: 'Devices', icon: Cable },
    { key: 'reports', label: 'Reports', icon: FileText },
    { key: 'people', label: 'People', icon: Users },
  ] },
  { group: 'Event', items: [{ key: 'settings', label: 'Settings', icon: Settings }] },
];

export default function AppShell() {
  const { eventId, section } = useParams<{ eventId: string; section?: string }>();
  const mainRef = useRef<HTMLElement>(null);
  const live = useLive(eventId);
  const now = useNow(5000);
  const nav = useNavigate();
  const reduced = useReducedMotion();
  const current = (SECTIONS as readonly string[]).includes(section ?? '') ? (section as Section) : null;

  useEffect(() => { if (live.snap) document.title = `${live.snap.event.name} · WAYVE`; }, [live.snap?.event.name]);

  // Targeted nudges for HQ (or me) → one toast each, with a jump to the right section.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const s = live.snap;
    if (!s || !eventId) return;
    for (const n of [...live.notifies].reverse()) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.participantId !== 'hq' && n.participantId !== s.me.participantId) continue;
      toast(n.title, {
        description: n.body,
        action: n.messageId ? { label: 'Radio', onClick: () => nav(sectionPath(eventId, 'radio')) } : n.issueId ? { label: 'Open', onClick: () => nav(sectionPath(eventId, 'dashboard')) } : undefined,
      });
    }
  }, [live.notifies, live.snap?.me.participantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const badges = useMemo(() => {
    const s = live.snap;
    if (!s) return {} as Partial<Record<Section, string>>;
    const open = s.issues.filter((i) => i.status !== 'done').length;
    const unacked = s.messages.filter(isUnacked).length;
    const online = s.devices.filter((d) => isOnline(d, serverNow())).length;
    return {
      dashboard: open ? String(open) : undefined,
      radio: unacked ? String(unacked) : undefined,
      devices: `${online}/${s.devices.length}`,
      reports: s.reports.length ? String(s.reports.length) : undefined,
    } as Partial<Record<Section, string>>;
  }, [live.snap, now]);

  if (!eventId) return <Navigate to="/" replace />;
  if (!current) return <Navigate to={sectionPath(eventId, 'dashboard')} replace />;
  if (live.error && (live.error.status === 401 || live.error.status === 403)) {
    return <CenteredState icon={Lock} title="Sign in as an organizer" body="This event’s workspace is for organizers. Staff use the phone app."
      action={{ label: 'Sign in', to: `/login?next=${encodeURIComponent(location.pathname)}` }} secondary={{ label: 'Staff app', to: '/staff' }} />;
  }
  if (live.error && live.error.status === 404) return <CenteredState icon={SearchX} title="Couldn’t find this event" body="Check the link and try again." action={{ label: 'Go home', to: '/' }} />;
  if (live.snap && live.snap.me.role !== 'admin') {
    return <CenteredState icon={Lock} title="This workspace is for organizers" body="Your tasks, radio and assistant live in the staff app."
      action={live.snap.me.role === 'attendee' ? { label: 'Open chat', to: '/chat' } : { label: 'Open the staff app', to: '/staff' }} />;
  }
  const View = views[current];

  return (
    <ShellContext.Provider value={{ ...live, eventId }}>
      <div className="flex h-dvh overflow-hidden bg-canvas">
        <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line-2 bg-[#fafaf9] md:flex">
          <div className="flex h-14 items-center px-5"><Link to="/" aria-label="Home"><Logo size={18} /></Link></div>
          <div className="px-3 pb-2">
            {live.snap ? <EventSwitcher eventId={eventId} name={live.snap.event.name} code={live.snap.event.joinCode} /> : <div className="h-12 rounded-[10px] bg-wash-2" />}
          </div>
          <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Sections">
            {NAV.map((g) => (
              <div key={g.group} className="mt-4 first:mt-2">
                <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[.06em] text-fg-3 uppercase">{g.group}</div>
                {g.items.map((it) => {
                  const on = it.key === current;
                  const I = it.icon;
                  return (
                    <button key={it.key} type="button" onClick={() => nav(sectionPath(eventId, it.key))}
                      className={cn('relative flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] font-medium transition-colors',
                        on ? 'text-fg' : 'text-fg-2 hover:bg-wash-1 hover:text-fg')}
                      aria-current={on ? 'page' : undefined}>
                      {on && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-[8px] bg-white shadow-[0_1px_2px_rgb(23_21_15/.06),0_0_0_.5px_rgb(23_21_15/.1)]" transition={reduced ? { duration: 0 } : spring.smooth} />}
                      <I size={17} strokeWidth={1.75} className="relative" />
                      <span className="relative flex-1 text-left">{it.label}</span>
                      {it.key === 'devices' ? <AnyPulseDot className="relative" /> : null}
                      {badges[it.key] ? <span className="relative text-[12px] font-medium text-fg-3 tabular-nums">{badges[it.key]}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="flex items-center gap-2 border-t border-line-2 px-3 py-3">
            <LiveIndicator status={live.status} />
            <span className="ml-auto"><AccountMenu /></span>
          </div>
        </aside>

        <main ref={mainRef} className="relative min-w-0 flex-1 overflow-y-auto bg-[#fcfcfb]">
          <TopBar scrollRef={mainRef} title={NAV.flatMap((g) => g.items).find((i) => i.key === current)?.label ?? ''}
            eventName={live.snap?.event.name ?? null} status={live.status} />
          {live.snap && live.status !== 'live' && (
            <div className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-[#17150f] px-4 py-1.5 text-[12px] font-medium text-white" role="status">
              <WifiOff size={13} strokeWidth={2} />Live connection lost — reconnecting. What you see may be out of date.
            </div>
          )}
          {/* mobile top bar */}
          <div className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line-2 bg-white/80 px-4 backdrop-blur md:hidden">
            <Logo size={15} />
            <select className="ml-auto h-8 rounded-[8px] border border-line-3 bg-white px-2 text-[14px]" value={current}
              onChange={(e) => nav(sectionPath(eventId, e.target.value as Section))} aria-label="Section">
              {NAV.flatMap((g) => g.items).map((it) => <option key={it.key} value={it.key}>{it.label}</option>)}
            </select>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={current} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }} className="min-h-full">
              <Suspense fallback={<div className="p-10"><div className="h-8 w-48 animate-pulse rounded-[8px] bg-wash-2" /></div>}>
                <View />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
        <AskDrawer section={current} />
      </div>
    </ShellContext.Provider>
  );
}
