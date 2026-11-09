// /staff — the field staff app, phone-first and minimal: Chat (ask + report with photo/video) and Radio. New work arrives
// as a swipe deck (right = take it, left = pass); the job I'm on is pinned on top with slide-to-done.
// Event comes from ?event=<id>, else this phone's QR session (no account needed), else the signed-in user's first staff event.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { LogIn, MessageCircle, QrCode, RotateCw, Unplug } from 'lucide-react';
import type { AuthState, Issue, Notify } from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { useLive } from '@/lib/live';
import { useNow } from '@/lib/time';
import { spring } from '@/design/motion';
import { CenterState, OfflineBanner, Pill, Spinner } from '@/components/phone/common';
import { IssueSheet } from '@/components/phone/ops/issue';
import { MeSheet } from '@/components/phone/ops/MeSheet';
import { haptic, usePrefs } from '@/components/phone/staff/shell';
import { PhoneHeader, PhoneTabBar, ProfileSheet, type PhoneTab } from '@/components/phone/staff/PhoneShell';
import { RadioTab, unackedCount, useRadioAlerts } from '@/components/phone/staff/RadioTab';
import { ChatTab } from '@/components/phone/staff/ChatTab';
import { ActiveTask } from '@/components/phone/staff/ActiveTask';
import { SwipeDeck, useDeck } from '@/components/phone/staff/SwipeDeck';

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
  const [tab, setTab] = useState<PhoneTab>(() => (sp.get('tab') === 'radio' ? 'radio' : 'chat'));
  const [openIssue, setOpenIssue] = useState<Issue | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);

  const participant = me ? snap?.participants.find((p) => p.id === me.participantId) : undefined;
  const name = participant?.displayName ?? me?.displayName ?? 'You';
  const myTeamId = participant?.teamId ?? null;
  const myTeam = snap?.teams.find((t) => t.id === myTeamId);
  const myDevice = me?.deviceId ? snap?.devices.find((d) => d.id === me.deviceId) : undefined;
  const myZoneId = myDevice?.zoneId ?? null;
  const mineNotifies = useMemo(() => (me ? notifies.filter((n) => n.participantId === me.participantId) : []), [notifies, me]);

  const goRadio = useCallback(() => setTab('radio'), []);
  useRadioAlerts(snap, me, myTeamId, tab === 'radio', goRadio);
  useNotifyToasts(mineNotifies, (n) => { const i = n.issueId ? snap?.issues.find((x) => x.id === n.issueId) : null; if (i) setOpenIssue(i); });

  const nudged = useRef(false);
  useEffect(() => {
    if (nudged.current || !participant || !snap) return;
    nudged.current = true;
    if (/^Staff \d+$/.test(participant.displayName) || (!participant.teamId && snap.teams.length > 0)) {
      toast('Tell us your name and team', { description: 'When someone says your name on the radio, the task comes straight to you.', action: { label: 'Set', onClick: () => setMeOpen(true) }, duration: 10000 });
    }
  }, [participant, snap]);

  if (status === 'error' && error) {
    return error.status === 401 || error.status === 403
      ? <CenterState icon={<QrCode strokeWidth={1.75} />} title="Scan the staff QR again" body="This phone isn't connected to this event anymore. Scanning the staff QR reconnects it — no account needed.">
          {auth.user ? null : <Pill tone="wash" onClick={() => navigate('/login?next=/staff')}><LogIn />Have an account? Sign in</Pill>}</CenterState>
      : <CenterState icon={<Unplug strokeWidth={1.75} />} tone="warn" title="Connection lost" body="Check your connection and try again."><Pill onClick={() => location.reload()}><RotateCw />Reload</Pill></CenterState>;
  }
  if (!snap || !me) return <CenterState icon={<Spinner className="size-6" />} title="Loading your event" />;
  return <StaffShell {...{ snap, me, status, notifies, apply, now, prefs, setPrefs, tab, setTab, openIssue, setOpenIssue, profileOpen, setProfileOpen, meOpen, setMeOpen, name, myTeamId, teamName: myTeam?.name ?? null, myZoneId, auth, eventId }} />;
}

type ShellProps = {
  snap: NonNullable<ReturnType<typeof useLive>['snap']>; me: NonNullable<ReturnType<typeof useLive>['snap']>['me']; status: ReturnType<typeof useLive>['status'];
  notifies: Notify[]; apply: ReturnType<typeof useLive>['apply']; now: number; prefs: ReturnType<typeof usePrefs>[0]; setPrefs: ReturnType<typeof usePrefs>[1];
  tab: PhoneTab; setTab: (t: PhoneTab) => void; openIssue: Issue | null; setOpenIssue: (i: Issue | null) => void;
  profileOpen: boolean; setProfileOpen: (o: boolean) => void; meOpen: boolean; setMeOpen: (o: boolean) => void;
  name: string; myTeamId: string | null; teamName: string | null; myZoneId: string | null; auth: AuthState; eventId: string;
};

function StaffShell({ snap, me, status, notifies, apply, now, prefs, setPrefs, tab, setTab, openIssue, setOpenIssue, profileOpen, setProfileOpen, meOpen, setMeOpen, name, myTeamId, teamName, myZoneId, auth, eventId }: ShellProps) {
  const navigate = useNavigate();
  const deck = useDeck(snap, me, notifies, apply);
  const setZone = async (zoneId: string) => {
    if (!me.deviceId) { toast('Location needs a staff phone', { description: 'Scan the staff QR on this phone first.' }); return; }
    const prev = snap.devices.find((d) => d.id === me.deviceId);
    if (prev) apply({ kind: 'device', data: { ...prev, zoneId } });
    try { const r = await API.patchDevice(me.deviceId, { zoneId }); apply({ kind: 'device', data: r.device }); haptic(10); }
    catch (e) { if (prev) apply({ kind: 'device', data: prev }); toast.error((e as HttpError).message); }
  };
  const unheard = unackedCount(snap, me, myTeamId);
  const signOut = async () => { try { await API.logout(); } catch { /* ignore */ } navigate('/login', { replace: true }); };

  return (
    <div className="min-h-dvh bg-canvas">
      <PhoneHeader eventName={snap.event.name} status={status} name={name} waiting={deck.visible ? 0 : deck.items.length} onWaiting={deck.reopen} onMe={() => setProfileOpen(true)} />
      <main className="mx-auto w-full max-w-[640px] px-4 pb-[calc(var(--safe-b)+80px)]">
        <ActiveTask snap={snap} me={me} apply={apply} onOpen={setOpenIssue} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} className="pt-2"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { ...spring.smooth, opacity: { duration: 0.2 } } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            {tab === 'chat'
              ? <ChatTab snap={snap} me={me} apply={apply} myZoneId={myZoneId} onOpenIssue={setOpenIssue} />
              : <RadioTab snap={snap} me={me} myTeamId={myTeamId} apply={apply} prefs={prefs} setPrefs={setPrefs} active={tab === 'radio'} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <PhoneTabBar tab={tab} onTab={setTab} badges={{ radio: unheard }} />
      <OfflineBanner status={status} bottom={tab === 'radio' ? 300 : 150} />
      <SwipeDeck deck={deck} snap={snap} me={me} />

      <IssueSheet issue={openIssue} snap={snap} me={me} apply={apply} open={!!openIssue} onOpenChange={(o) => { if (!o) setOpenIssue(null); }} now={now} />
      <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} snap={snap} me={me} name={name} teamName={teamName} myZoneId={myZoneId}
        onZone={(z) => void setZone(z)} onEdit={() => { setProfileOpen(false); setTimeout(() => setMeOpen(true), 250); }}
        events={auth.events} onPickEvent={(id) => { setProfileOpen(false); if (id !== eventId) navigate(`/staff?event=${id}`); }}
        signedIn={!!auth.user} onSignOut={() => void signOut()} />
      <MeSheet open={meOpen} onOpenChange={setMeOpen} snap={snap} me={me} apply={apply} />
    </div>
  );
}

/** Toast + haptic for escalations and other nudges. Assignments go to the swipe deck; radio has its own alerts. */
function useNotifyToasts(items: Notify[], onOpen: (n: Notify) => void) {
  const seen = useRef<Set<string> | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(items.map((n) => n.id)); return; }
    for (const n of items) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.messageId || n.kind === 'assigned' || n.zoneName) continue;
      haptic([80, 40, 80]);
      toast(n.title, { description: n.body, action: n.issueId ? { label: 'View', onClick: () => openRef.current(n) } : undefined, duration: 8000 });
    }
  }, [items]);
}
