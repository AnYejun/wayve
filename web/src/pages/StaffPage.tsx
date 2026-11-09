// /staff — the field staff app (mockup): Field · Report · Tasks · Radio · More, plus the always-on assistant.
// Event comes from ?event=<id>, else this phone's QR session (no account needed), else the signed-in user's first staff event.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { AudioLines, LogIn, MessageCircle, QrCode, RotateCw, Unplug } from 'lucide-react';
import type { AuthState, Issue, Notify, Report } from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { useLive } from '@/lib/live';
import { useNow } from '@/lib/time';
import { spring } from '@/design/motion';
import { CenterState, OfflineBanner, Pill, Spinner } from '@/components/phone/common';
import { MyWorkTab } from '@/components/phone/ops/MyWorkTab';
import { IssueSheet } from '@/components/phone/ops/issue';
import { MeSheet } from '@/components/phone/ops/MeSheet';
import { EventSheet, NotificationsSheet, StaffHeader, TabBar, haptic, usePrefs, type StaffTab } from '@/components/phone/staff/shell';
import { DispatchCard } from '@/components/phone/staff/DispatchCard';
import { FieldTab } from '@/components/phone/staff/FieldTab';
import { ReportComposer, ReportDetail } from '@/components/phone/staff/ReportFlow';
import { RadioTab, unackedCount, useRadioAlerts } from '@/components/phone/staff/RadioTab';
import { AssistantSheet } from '@/components/phone/staff/Assistant';
import { MoreTab } from '@/components/phone/staff/MoreTab';

type Boot = { status: 'loading' } | { status: 'error'; error: HttpError } | { status: 'ready'; eventId: string | null; auth: AuthState; attendee: boolean };

export default function StaffPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const eventParam = params.get('event');
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const load = useCallback(() => {
    setBoot({ status: 'loading' });
    Promise.all([API.me().catch(() => ({ me: null, event: null })), API.authMe().catch(() => ({ user: null, events: [] } as AuthState))])
      .then(([m, auth]) => {
        const staffMe = m.me && (m.me.role === 'staff' || m.me.role === 'admin') ? m.me : null;
        const eventId = eventParam ?? staffMe?.eventId ?? auth.events.find((e) => e.role === 'staff' || e.role === 'admin')?.event.id ?? null;
        setBoot({ status: 'ready', eventId, auth, attendee: !eventParam && !staffMe && m.me?.role === 'attendee' });
      })
      .catch((e: HttpError) => setBoot({ status: 'error', error: e }));
  }, [eventParam]);
  useEffect(load, [load]);

  if (boot.status === 'loading') return <CenterState icon={<Spinner className="size-6" />} title="Loading" />;
  if (boot.status === 'error') return <CenterState icon={<Unplug strokeWidth={1.75} />} tone="warn" title="Can't connect" body={boot.error.message}><Pill onClick={load}><RotateCw />Try again</Pill></CenterState>;
  if (boot.attendee) {
    return <CenterState icon={<MessageCircle strokeWidth={1.75} />} title="You're joined as an attendee" body="This phone is set up for the attendee chat. Staff: scan the staff QR code instead.">
      <Pill onClick={() => navigate('/chat', { replace: true })}>Go to chat</Pill></CenterState>;
  }
  if (!boot.eventId) {
    // QR-only: staff need no account. Scanning the staff QR joins this phone; signing in is optional.
    return (
      <CenterState icon={<QrCode strokeWidth={1.75} />} title="Scan the staff QR to join"
        body={boot.auth.user ? 'You are signed in but not on an event yet. Scan the staff QR your organizer shows you.' : 'Point your camera at the staff QR your organizer shows you — no account needed.'}>
        {boot.auth.user ? null : <Pill tone="wash" onClick={() => navigate('/login?next=/staff')}><LogIn />Have an account? Sign in</Pill>}
      </CenterState>
    );
  }
  return <StaffApp key={boot.eventId} eventId={boot.eventId} auth={boot.auth} />;
}

function StaffApp({ eventId, auth }: { eventId: string; auth: AuthState }) {
  const navigate = useNavigate();
  const { snap, status, error, notifies, apply } = useLive(eventId);
  const me = snap?.me ?? null;
  const now = useNow(30_000);
  const [prefs, setPrefs] = usePrefs();
  const [sp] = useSearchParams();
  const initialTab = sp.get('tab');
  const [tab, setTab] = useState<StaffTab>(() => (['field', 'report', 'tasks', 'radio', 'more'] as const).find((t) => t === initialTab) ?? 'field');
  const [view, setView] = useState<{ kind: 'compose'; parent: Report | null } | { kind: 'detail'; id: string; initial: Report | null; fresh: boolean }>({ kind: 'compose', parent: null });
  const [openIssue, setOpenIssue] = useState<Issue | null>(null);
  const [assistant, setAssistant] = useState<{ open: boolean; mode: 'voice' | 'chat' }>({ open: false, mode: 'voice' });
  const [meOpen, setMeOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => Date.now());

  const participant = me ? snap?.participants.find((p) => p.id === me.participantId) : undefined;
  const name = participant?.displayName ?? me?.displayName ?? 'there';
  const myTeamId = participant?.teamId ?? null;
  const myTeam = snap?.teams.find((t) => t.id === myTeamId);
  const myDevice = me?.deviceId ? snap?.devices.find((d) => d.id === me.deviceId) : undefined;
  const myZoneId = myDevice?.zoneId ?? null;
  const mineNotifies = useMemo(() => (me ? notifies.filter((n) => n.participantId === me.participantId || (n.participantId === 'hq' && me.role === 'admin')) : []), [notifies, me]);
  const unread = mineNotifies.filter((n) => n.at > seenAt).length;

  const goRadio = useCallback(() => setTab('radio'), []);
  useRadioAlerts(snap, me, myTeamId, tab === 'radio', goRadio);
  useNotifyToasts(mineNotifies, (n) => { const i = n.issueId ? snap?.issues.find((x) => x.id === n.issueId) : null; if (i) setOpenIssue(i); else setTab('tasks'); });

  const nudged = useRef(false);
  useEffect(() => {
    if (nudged.current || !participant || !snap) return;
    nudged.current = true;
    if (/^Staff \d+$/.test(participant.displayName) || (!participant.teamId && snap.teams.length > 0)) {
      toast('Tell us your name and team', { description: 'When someone says your name in a meeting, the task comes straight to you.', action: { label: 'Set', onClick: () => setMeOpen(true) }, duration: 10000 });
    }
  }, [participant, snap]);

  if (status === 'error' && error) {
    return error.status === 401 || error.status === 403
      ? <CenterState icon={<QrCode strokeWidth={1.75} />} title="Scan the staff QR again" body="This phone isn't connected to this event anymore. Scanning the staff QR reconnects it — no account needed.">
          {auth.user ? null : <Pill tone="wash" onClick={() => navigate('/login?next=/staff')}><LogIn />Have an account? Sign in</Pill>}</CenterState>
      : <CenterState icon={<Unplug strokeWidth={1.75} />} tone="warn" title="Connection lost" body="Check your connection and try again."><Pill onClick={() => location.reload()}><RotateCw />Reload</Pill></CenterState>;
  }
  if (!snap || !me) return <CenterState icon={<Spinner className="size-6" />} title="Loading your event" />;

  const setZone = async (zoneId: string) => {
    if (!me.deviceId) { toast('Location needs a staff phone', { description: 'Scan the staff QR on this phone first.' }); return; }
    try { const r = await API.patchDevice(me.deviceId, { zoneId }); apply({ kind: 'device', data: r.device }); haptic(10); }
    catch (e) { toast.error((e as HttpError).message); }
  };
  const myOpen = snap.issues.filter((i) => i.assigneeId === me.participantId && i.status !== 'done').length;
  const unheard = unackedCount(snap, me, myTeamId);
  const signOut = async () => { try { await API.logout(); } catch { /* ignore */ } navigate('/login', { replace: true }); };
  const onTab = (t: StaffTab) => { if (t === 'report' && tab === 'report') setView({ kind: 'compose', parent: null }); setTab(t); };

  return (
    <div className="min-h-dvh bg-canvas">
      <StaffHeader eventName={snap.event.name} status={status} unread={unread} onBell={() => { setBellOpen(true); }} onEvent={() => setEventsOpen(true)} />
      <main className="mx-auto w-full max-w-[640px] px-4 pt-5 pb-[calc(var(--safe-b)+96px)]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab === 'report' ? `report:${view.kind}:${view.kind === 'detail' ? view.id : ''}` : tab}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { ...spring.smooth, opacity: { duration: 0.2 } } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            {tab === 'field' ? (
              <FieldTab snap={snap} me={me} name={name} myTeamId={myTeamId} myZoneId={myZoneId} onZone={(z) => void setZone(z)} onOpenIssue={setOpenIssue}
                onGo={(t) => (t === 'ask' ? setAssistant({ open: true, mode: 'voice' }) : setTab(t))} />
            ) : tab === 'report' ? (
              view.kind === 'compose' ? (
                <ReportComposer snap={snap} me={me} myZoneId={myZoneId} parent={view.parent}
                  onSent={(r) => setView({ kind: 'detail', id: r.id, initial: r, fresh: true })} onCancelUpdate={() => setView({ kind: 'compose', parent: null })}
                  onOpenReport={(r) => setView({ kind: 'detail', id: r.id, initial: r, fresh: false })} />
              ) : (
                <ReportDetail id={view.id} initial={view.initial} snap={snap} fresh={view.fresh} onBack={() => setView({ kind: 'compose', parent: null })}
                  onAddUpdate={(r) => setView({ kind: 'compose', parent: r })} onOpenIssue={setOpenIssue} />
              )
            ) : tab === 'tasks' ? (
              <div>
                <h1 className="mb-5 px-1 text-[32px] leading-[38px] font-bold tracking-[-0.03em] text-fg">Tasks</h1>
                <MyWorkTab snap={snap} me={me} myTeamId={myTeamId} apply={apply} />
              </div>
            ) : tab === 'radio' ? (
              <RadioTab snap={snap} me={me} myTeamId={myTeamId} apply={apply} prefs={prefs} setPrefs={setPrefs} active={tab === 'radio'} />
            ) : (
              <MoreTab name={name} teamName={myTeam?.name ?? null} prefs={prefs} setPrefs={setPrefs} signedIn={!!auth.user}
                onAssistant={() => setAssistant({ open: true, mode: 'chat' })} onProfile={() => setMeOpen(true)} onSignOut={() => void signOut()} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {tab === 'field' || tab === 'tasks' ? (
        <motion.button type="button" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} whileTap={{ scale: 0.92 }} transition={spring.snappy}
          onClick={() => { haptic(12); setAssistant({ open: true, mode: 'voice' }); }} aria-label="Open assistant"
          className="fixed right-4 z-(--z-sticky) grid size-14 place-items-center rounded-full bg-[#17150f] text-white shadow-[0_10px_30px_-8px_rgb(23_21_15/.45)]"
          style={{ bottom: 'calc(var(--safe-b) + 80px)' }}>
          <AudioLines className="size-6" strokeWidth={2} />
        </motion.button>
      ) : null}

      <DispatchCard snap={snap} me={me} notifies={notifies} apply={apply} />
      <TabBar tab={tab} onTab={onTab} badges={{ tasks: { n: myOpen }, radio: { n: unheard, tone: 'red' } }} />
      <OfflineBanner status={status} bottom={tab === 'radio' ? 300 : 88} />

      <IssueSheet issue={openIssue} snap={snap} me={me} apply={apply} open={!!openIssue} onOpenChange={(o) => { if (!o) setOpenIssue(null); }} now={now} />
      <AssistantSheet open={assistant.open} initialMode={assistant.mode} onOpenChange={(o) => setAssistant((a) => ({ ...a, open: o }))} snap={snap} me={me}
        onOpenIssue={(i) => { setAssistant((a) => ({ ...a, open: false })); setOpenIssue(i); }} />
      <MeSheet open={meOpen} onOpenChange={setMeOpen} snap={snap} me={me} apply={apply} />
      <EventSheet open={eventsOpen} onOpenChange={setEventsOpen} events={auth.events} currentId={eventId}
        onPick={(id) => { setEventsOpen(false); if (id !== eventId) navigate(`/staff?event=${id}`); }} />
      <NotificationsSheet open={bellOpen} onOpenChange={(o) => { setBellOpen(o); if (!o) setSeenAt(Date.now()); }} items={mineNotifies} seenAt={seenAt}
        onOpenItem={(n) => { setBellOpen(false); const i = n.issueId ? snap.issues.find((x) => x.id === n.issueId) : null; if (i) setOpenIssue(i); else if (n.messageId) setTab('radio'); }} />
    </div>
  );
}

/** Toast + haptic for assignment / escalation nudges (radio has its own). Each shown once. */
function useNotifyToasts(items: Notify[], onOpen: (n: Notify) => void) {
  const seen = useRef<Set<string> | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(items.map((n) => n.id)); return; }
    for (const n of items) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.messageId) continue;
      haptic([80, 40, 80]);
      toast(n.title, { description: n.body, action: { label: 'View', onClick: () => openRef.current(n) }, duration: 8000 });
    }
  }, [items]);
}
