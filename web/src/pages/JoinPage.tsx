// /j/:code?as=camera|staff|guest|scribe&z=zoneId&team=teamId — scanning the QR alone links this phone to the venue.
// guest = event attendee → POST /api/join { as: 'attendee' } (no device) → /chat.
// scribe = meeting transcriber → POST /api/join { as: 'scribe', teamId } → /scribe/:deviceId.
// staff join with the QR alone: signed out → their name (+ team) on one screen, no account; signed in → one-tap confirm.
// Accounts are optional for staff (only organizer dashboards need one).
// Other roles with `as` join immediately (no input); without `as` the person picks a role (and a zone for cameras).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { rise, spring } from '@/design/motion';
import { Camera, Check, ChevronRight, MessageCircle, Mic, QrCode, RotateCw, UserRound, WifiOff } from 'lucide-react';
import type { EventInfo } from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Logo } from '@/design/Logo';
import { CARD, CenterState, HAIR, Pill, Spinner } from '@/components/phone/common';
import { InviteAPI } from '@/components/invite/api';

type Role = 'camera' | 'staff' | 'guest' | 'scribe';
const NAME_KEY = 'wayve:name';
const readName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
type Preview = { event: EventInfo; zones: Array<{ id: string; name: string }> };
type Phase =
  | { k: 'preview' }
  | { k: 'choose'; p: Preview; role: Role | null }
  | { k: 'name'; p: Preview; teams: Array<{ id: string; name: string }> }
  | { k: 'auth'; p: Preview }
  | { k: 'confirm'; p: Preview; teams: Array<{ id: string; name: string }>; userName: string; username: string }
  | { k: 'joining'; p: Preview; role: Role; zoneName: string | null }
  | { k: 'done'; p: Preview; role: Role; zoneName: string | null }
  | { k: 'invalid' }
  | { k: 'network'; message: string };

export default function JoinPage() {
  const { code = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const asParam = search.get('as');
  const presetRole: Role | null = asParam === 'camera' || asParam === 'staff' || asParam === 'guest' || asParam === 'scribe' ? asParam : null;
  const presetZone = search.get('z');
  const presetTeam = search.get('team');
  const key = search.get('k'); // organizer's join key: required for staff, camera and scribe
  const [phase, setPhase] = useState<Phase>({ k: 'preview' });
  const started = useRef(false);

  const join = useCallback(async (p: Preview, role: Role, zoneId: string | null, name?: string | null, teamOverride?: string | null) => {
    const zoneName = zoneId ? p.zones.find((z) => z.id === zoneId)?.name ?? null : null;
    setPhase({ k: 'joining', p, role, zoneName });
    try {
      let to: string;
      if (role === 'guest') {
        await API.joinAttendee(code);
        to = '/chat';
      } else if (role === 'scribe') {
        const r = await API.join({ code, as: 'scribe', teamId: presetTeam, key });
        to = r.device ? `/scribe/${r.device.id}` : '/staff';
      } else if (role === 'staff') {
        await API.join({ code, as: 'staff', teamId: teamOverride ?? presetTeam, name: name?.trim() || null, key });
        to = `/staff?event=${encodeURIComponent(p.event.id)}`;
      } else {
        const r = await API.join({ code, as: 'camera', zoneId, key });
        to = r.device ? `/device/${r.device.id}` : '/staff';
      }
      setPhase({ k: 'done', p, role, zoneName });
      setTimeout(() => navigate(to, { replace: true }), 650);
    } catch (e) {
      const he = e as HttpError;
      if (role === 'staff' && he.code === 'NEEDS_NAME') {
        const teams = await InviteAPI.teamsForCode(code).then((r) => r.teams).catch(() => []);
        setPhase({ k: 'name', p, teams });
      } else if (role === 'staff' && (he.code === 'NEEDS_LOGIN' || he.status === 401)) setPhase({ k: 'auth', p });
      else if (he.status === 404 || he.status === 400 || he.status === 410) setPhase({ k: 'invalid' });
      else setPhase({ k: 'network', message: he.message });
    }
  }, [code, navigate, presetTeam, key]);

  /** Staff: signed in → one tap (team picker when the QR didn't name a team); signed out → name + team, no account. */
  const staffJoin = useCallback(async (p: Preview) => {
    const [a, teams] = await Promise.all([
      API.authMe().catch(() => null),
      InviteAPI.teamsForCode(code).then((r) => r.teams).catch(() => [] as Array<{ id: string; name: string }>),
    ]);
    if (!a?.user) { setPhase({ k: 'name', p, teams }); return; }
    if (presetTeam || !teams.length) { void join(p, 'staff', null, a.user.displayName); return; }
    setPhase({ k: 'confirm', p, teams, userName: a.user.displayName, username: a.user.username });
  }, [join, presetTeam, code]);

  const start = useCallback(async () => {
    setPhase({ k: 'preview' });
    try {
      const p = await API.joinPreview(code);
      if (presetRole) {
        const zoneOk = presetZone && p.zones.some((z) => z.id === presetZone) ? presetZone : null;
        if (presetRole === 'camera' && !zoneOk && p.zones.length > 1) setPhase({ k: 'choose', p, role: 'camera' });
        else if (presetRole === 'staff') await staffJoin(p);
        else await join(p, presetRole, zoneOk ?? (presetRole === 'camera' ? p.zones[0]?.id ?? null : null));
      } else {
        setPhase({ k: 'choose', p, role: null });
      }
    } catch (e) {
      const he = e as HttpError;
      if (he.status === 404 || he.status === 400 || he.status === 410) setPhase({ k: 'invalid' });
      else setPhase({ k: 'network', message: he.message });
    }
  }, [code, presetRole, presetZone, join, staffJoin]);

  useEffect(() => {
    if (started.current) return; // StrictMode double effect: join exactly once
    started.current = true;
    void start();
  }, [start]);

  if (phase.k === 'invalid') {
    return (
      <CenterState icon={<QrCode strokeWidth={1.75} />} tone="warn" title="This QR code has expired or is invalid"
        body="Ask an organizer for a new QR code and scan it again.">
        <Pill onClick={() => { started.current = true; void start(); }}><RotateCw />Try again</Pill>
      </CenterState>
    );
  }
  if (phase.k === 'network') {
    return (
      <CenterState icon={<WifiOff strokeWidth={1.75} />} tone="warn" title="Can't connect" body={phase.message || 'Check your connection.'}>
        <Pill onClick={() => void start()}><RotateCw />Try again</Pill>
      </CenterState>
    );
  }
  if (phase.k === 'choose') {
    return <ChooseRole phase={phase} setRole={(role) => setPhase({ ...phase, role })}
      onJoin={(role, zoneId) => (role === 'staff' ? void staffJoin(phase.p) : void join(phase.p, role, zoneId))} />;
  }
  if (phase.k === 'name') {
    return <QuickStaff phase={phase} presetTeam={presetTeam}
      onJoin={(name, teamId) => { try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ } void join(phase.p, 'staff', null, name, teamId); }}
      onSignIn={() => setPhase({ k: 'auth', p: phase.p })} />;
  }
  if (phase.k === 'auth') {
    return <AuthStep p={phase.p} onDone={() => void staffJoin(phase.p)}
      onBack={() => { void InviteAPI.teamsForCode(code).then((r) => r.teams).catch(() => []).then((teams) => setPhase({ k: 'name', p: phase.p, teams })); }} />;
  }
  if (phase.k === 'confirm') {
    return <ConfirmStaff phase={phase} onJoin={(teamId) => void join(phase.p, 'staff', null, phase.userName, teamId)}
      onSwitch={() => { void API.logout().finally(() => setPhase({ k: 'auth', p: phase.p })); }} />;
  }

  // preview / joining / done — calm centred progress
  const p = phase.k === 'preview' ? null : phase.p;
  const role = phase.k === 'joining' || phase.k === 'done' ? phase.role : presetRole;
  const zoneName = phase.k === 'joining' || phase.k === 'done' ? phase.zoneName : null;
  const done = phase.k === 'done';
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-6 pt-[calc(var(--safe-t)+20px)] pb-[calc(var(--safe-b)+24px)]">
      <div className="flex h-8 items-center justify-center"><Logo size={22} /></div>
      <main className="mx-auto flex w-full max-w-[360px] flex-1 flex-col items-center justify-center text-center" aria-live="polite">
        <div className={cn('mb-6 grid size-[72px] place-items-center rounded-full transition-colors duration-300',
          done ? 'bg-[#17150f] text-white' : cn('bg-white text-fg', HAIR))}>
          {done ? <Check className="size-8 animate-in zoom-in-50 fade-in duration-300" strokeWidth={2.25} /> : <Spinner className="size-7" />}
        </div>
        <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.025em] text-fg">{done ? "You're connected" : 'Connecting…'}</h1>
        <p className="mt-2 min-h-[22px] text-[16px] leading-[22px] text-fg-2">{p ? p.event.name : 'Checking the event'}</p>
        {role ? (
          <p className="mt-5 inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[14px] font-medium text-fg shadow-[inset_0_0_0_.5px_rgb(23_21_15/.16)]">
            {role === 'camera' ? <Camera className="size-4 text-fg-2" strokeWidth={1.75} />
              : role === 'guest' ? <MessageCircle className="size-4 text-fg-2" strokeWidth={1.75} />
                : role === 'scribe' ? <Mic className="size-4 text-fg-2" strokeWidth={1.75} />
                  : <UserRound className="size-4 text-fg-2" strokeWidth={1.75} />}
            {role === 'camera' ? `Camera${zoneName ? ` · ${zoneName}` : ''}` : role === 'guest' ? 'Attendee' : role === 'scribe' ? 'Meeting scribe' : 'Staff'}
          </p>
        ) : null}
        <ol className="mt-10 flex w-full flex-col gap-3 text-left text-[15px]">
          <Step done={!!p} active={!p} label="Event found" />
          <Step done={done} active={!!p && !done} label="Connecting this phone" />
        </ol>
      </main>
    </div>
  );
}

function Step({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <li className={cn('flex items-center gap-3', !done && !active && 'text-fg-3', active && 'text-fg', done && 'text-fg-2')}>
      <span className={cn('grid size-6 place-items-center rounded-full', done ? 'bg-[#17150f] text-white' : 'bg-[rgb(23_21_15/.06)]')}>
        {done ? <Check className="size-3.5" strokeWidth={2.5} /> : active ? <Spinner className="size-3 border-[1.5px]" /> : null}
      </span>
      {label}
    </li>
  );
}

function ChooseRole({ phase, setRole, onJoin }: {
  phase: Extract<Phase, { k: 'choose' }>; setRole: (r: Role) => void; onJoin: (r: Role, zoneId: string | null) => void;
}) {
  const { p, role } = phase;
  const [zoneId, setZoneId] = useState<string | null>(null);
  return (
    <div className="flex min-h-dvh flex-col bg-canvas pt-[calc(var(--safe-t)+20px)] pb-[calc(var(--safe-b)+20px)]">
      <div className="flex h-8 items-center justify-center"><Logo size={22} /></div>
      <main className="mx-auto w-full max-w-[420px] flex-1 px-5 pt-10">
        <p className="text-[14px] font-medium text-fg-2">{p.event.name}</p>
        <h1 className="mt-1 text-[28px] leading-9 font-semibold tracking-[-0.03em] text-fg">How will you use this phone?</h1>

        <div className="mt-7 flex flex-col gap-2.5" role="radiogroup" aria-label="Role">
          <RoleCard on={role === 'camera'} onClick={() => setRole('camera')} icon={<Camera strokeWidth={1.75} />}
            title="Camera" body="Point it at a zone — it reads the scene every 4 seconds and updates the map." />
          <RoleCard on={role === 'staff'} onClick={() => setRole('staff')} icon={<UserRound strokeWidth={1.75} />}
            title="Staff" body="Get tasks, talk on radio and send field reports." />
          <RoleCard on={role === 'guest'} onClick={() => setRole('guest')} icon={<MessageCircle strokeWidth={1.75} />}
            title="Attendee" body="Ask where it's quiet and tell the team about problems." />
          <RoleCard on={role === 'scribe'} onClick={() => setRole('scribe')} icon={<Mic strokeWidth={1.75} />}
            title="Meeting scribe" body="Leave it on the table — it turns the meeting into tasks and decisions." />
        </div>

        {role === 'camera' ? (
          <section className="mt-7 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <h2 className="mb-2 px-1 text-[13px] font-semibold text-fg-2">Which zone will it watch?</h2>
            <ul className={cn('overflow-hidden', CARD)} role="listbox" aria-label="Zone">
              {p.zones.map((z, i) => (
                <li key={z.id} className="relative">
                  {i > 0 ? <span className="absolute top-0 right-0 left-4 h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden="true" /> : null}
                  <button type="button" role="option" aria-selected={zoneId === z.id} onClick={() => setZoneId(z.id)}
                    className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[16px] font-medium text-fg active:bg-[rgb(23_21_15/.05)]">
                    <span className="flex-1 truncate">{z.name}</span>
                    {zoneId === z.id ? <Check className="size-[18px]" strokeWidth={2.25} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <div className="mx-auto w-full max-w-[420px] px-5 pt-4">
        <Pill className="w-full" disabled={!role || (role === 'camera' && !zoneId && p.zones.length > 0)}
          onClick={() => role && onJoin(role, role === 'camera' ? zoneId : null)}>
          Connect<ChevronRight />
        </Pill>
      </div>
    </div>
  );
}

function RoleCard({ on, onClick, icon, title, body }: { on: boolean; onClick: () => void; icon: React.ReactNode; title: string; body: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={cn('flex w-full items-start gap-3.5 rounded-[16px] bg-white p-4 text-left transition-[box-shadow,scale] duration-120 active:scale-[.985] motion-reduce:active:scale-100',
        on ? 'shadow-[inset_0_0_0_1.5px_#17150f]' : HAIR)}>
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-[12px] [&_svg]:size-5', on ? 'bg-[#17150f] text-white' : 'bg-[rgb(23_21_15/.05)] text-fg')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[17px] leading-6 font-semibold text-fg">{title}</span>
        <span className="mt-0.5 block text-[14px] leading-5 text-fg-2">{body}</span>
      </span>
    </button>
  );
}

/** Optional for staff: sign in (or create an account) so tasks follow you across devices. The display name is how people
 *  call you in meetings, so spoken assignments ("Jimin, can you…") land on the right phone. */
function AuthStep({ p, onDone, onBack }: { p: Preview; onDone: () => void; onBack?: () => void }) {
  const [mode, setMode] = useState<'signup' | 'login'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(readName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = username.trim().length >= 3 && password.length >= (mode === 'signup' ? 8 : 1) && (mode === 'login' || name.trim().length > 0);
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true); setErr(null);
    try {
      if (mode === 'signup') {
        await API.signup({ username: username.trim().toLowerCase(), password, displayName: name.trim() });
        try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* private mode */ }
      } else {
        await API.login({ username: username.trim().toLowerCase(), password });
      }
      onDone();
    } catch (e) {
      const he = e as HttpError;
      setErr(he.code === 'BAD_CREDENTIALS' ? 'That username and password don\'t match.' : he.message);
    } finally { setBusy(false); }
  };
  const field = cn('h-[52px] w-full rounded-[14px] bg-white px-4 text-[17px] text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1.5px_#17150f]', HAIR);
  return (
    <div className="flex min-h-dvh flex-col bg-canvas pt-[calc(var(--safe-t)+20px)] pb-[calc(var(--safe-b)+20px)]">
      <div className="flex h-8 items-center justify-center"><Logo size={20} /></div>
      <motion.form variants={rise} initial="initial" animate="animate" className="mx-auto flex w-full max-w-[420px] flex-1 flex-col px-5 pt-8"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-[14px] font-medium text-fg-2">{p.event.name} · Staff</p>
        <h1 className="mt-1 text-[30px] leading-9 font-bold tracking-[-0.03em] text-fg">{mode === 'signup' ? 'Create your staff account' : 'Welcome back'}</h1>
        <p className="mt-2 text-[15px] leading-[22px] text-fg-2">Optional — your tasks, radio and reports follow you across devices.</p>
        <div className="mt-5 inline-flex self-start rounded-full bg-[rgb(23_21_15/.06)] p-[3px]" role="tablist">
          {(['signup', 'login'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(null); }} className="relative h-9 rounded-full px-4 text-[14px] font-semibold">
              {mode === m ? <motion.span layoutId="auth-mode" transition={spring.smooth} className="absolute inset-0 rounded-full bg-white shadow-[0_1px_2px_rgb(23_21_15/.1)]" /> : null}
              <span className={cn('relative', mode === m ? 'text-fg' : 'text-fg-2')}>{m === 'signup' ? 'Create account' : 'Sign in'}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {mode === 'signup' ? (
              <motion.div key="name" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth}>
                <label className="mb-1.5 block px-1 text-[13px] font-semibold text-fg-2" htmlFor="wv-name">The name people call you in meetings</label>
                <input id="wv-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="given-name" placeholder="e.g. Jimin" className={field} />
              </motion.div>
            ) : null}
          </AnimatePresence>
          <label className="sr-only" htmlFor="wv-user">Username</label>
          <input id="wv-user" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={24} autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder="Username" className={field} />
          <label className="sr-only" htmlFor="wv-pass">Password</label>
          <input id="wv-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'} className={field} enterKeyHint="go" />
          {err ? <p className="px-1 text-[14px] text-[#b91c1c]" role="alert">{err}</p> : null}
        </div>
        <div className="mt-auto flex flex-col gap-2 pt-6">
          <Pill type="submit" className="w-full" disabled={!ok || busy}>{busy ? <Spinner className="size-4 border-white/30 border-t-white" /> : null}{mode === 'signup' ? 'Create account & join' : 'Sign in & join'}<ChevronRight /></Pill>
          {onBack ? <button type="button" onClick={onBack} className="h-11 text-[15px] font-medium text-fg-2">Join without an account</button> : null}
        </div>
      </motion.form>
    </div>
  );
}

/** Signed-in staff: confirm in one tap, picking a team so radio channels and ownership work from minute one. */
function ConfirmStaff({ phase, onJoin, onSwitch }: {
  phase: Extract<Phase, { k: 'confirm' }>; onJoin: (teamId: string | null) => void; onSwitch: () => void;
}) {
  const [team, setTeam] = useState<string | null>(null);
  return (
    <div className="flex min-h-dvh flex-col bg-canvas pt-[calc(var(--safe-t)+20px)] pb-[calc(var(--safe-b)+20px)]">
      <div className="flex h-8 items-center justify-center"><Logo size={20} /></div>
      <motion.main variants={rise} initial="initial" animate="animate" className="mx-auto flex w-full max-w-[420px] flex-1 flex-col px-5 pt-10">
        <p className="text-[14px] font-medium text-fg-2">{phase.p.event.name}</p>
        <h1 className="mt-1 text-[30px] leading-[1.12] font-semibold tracking-[-0.03em] text-fg">Join as {phase.userName}</h1>
        <p className="mt-2 text-[16px] leading-[22px] text-fg-2">Pick your team — it sets your radio channel and who your tasks come from.</p>
        <div className="mt-6 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Team">
          {phase.teams.map((t) => {
            const on = team === t.id;
            return (
              <motion.button key={t.id} type="button" role="radio" aria-checked={on} whileTap={{ scale: 0.97 }} transition={spring.snappy}
                onClick={() => setTeam(on ? null : t.id)}
                className={cn('flex h-14 items-center justify-between rounded-[14px] px-4 text-left text-[16px] font-medium transition-colors',
                  on ? 'bg-[#17150f] text-white' : cn('bg-white text-fg', HAIR))}>
                {t.name}{on ? <Check className="size-4" strokeWidth={2.5} /> : null}
              </motion.button>
            );
          })}
        </div>
        <div className="mt-auto pt-8">
          <motion.button type="button" whileTap={{ scale: 0.98 }} transition={spring.snappy} onClick={() => onJoin(team)}
            className="flex h-[54px] w-full items-center justify-center gap-2 rounded-[16px] bg-[#17150f] text-[17px] font-semibold text-white">
            {team ? `Join ${phase.teams.find((t) => t.id === team)?.name}` : 'Join without a team'}<ChevronRight className="size-5" />
          </motion.button>
          <p className="mt-3 text-center text-[14px] text-fg-3">@{phase.username} · <button type="button" onClick={onSwitch} className="font-medium text-fg">Not you?</button></p>
        </div>
      </motion.main>
    </div>
  );
}

/** Signed-out staff (QR only): one screen — what people call you + your team → Join. No account, no password. */
function QuickStaff({ phase, presetTeam, onJoin, onSignIn }: {
  phase: Extract<Phase, { k: 'name' }>; presetTeam: string | null;
  onJoin: (name: string, teamId: string | null) => void; onSignIn: () => void;
}) {
  const [name, setName] = useState(readName);
  const [team, setTeam] = useState<string | null>(presetTeam && phase.teams.some((t) => t.id === presetTeam) ? presetTeam : null);
  const ok = name.trim().length > 0;
  const submit = () => { if (ok) onJoin(name.trim().slice(0, 20), team); };
  return (
    <div className="flex min-h-dvh flex-col bg-canvas pt-[calc(var(--safe-t)+20px)] pb-[calc(var(--safe-b)+20px)]">
      <div className="flex h-8 items-center justify-center"><Logo size={20} /></div>
      <motion.form variants={rise} initial="initial" animate="animate" className="mx-auto flex w-full max-w-[420px] flex-1 flex-col px-5 pt-10"
        onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="text-[14px] font-medium text-fg-2">{phase.p.event.name} · Staff</p>
        <h1 className="mt-1 text-[30px] leading-[1.12] font-semibold tracking-[-0.03em] text-fg">What do people call you?</h1>
        <p className="mt-2 text-[16px] leading-[22px] text-fg-2">Radio and tasks use this name — when someone says “Jimin, can you…”, it lands on your phone.</p>
        <label className="sr-only" htmlFor="wv-qname">Your name</label>
        <input id="wv-qname" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoFocus autoComplete="given-name"
          enterKeyHint="go" placeholder="e.g. Jimin"
          className={cn('mt-6 h-[56px] w-full rounded-[16px] bg-white px-4 text-[18px] font-medium text-fg outline-none placeholder:font-normal placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1.5px_#17150f]', HAIR)} />
        {phase.teams.length ? (
          <>
            <h2 className="mt-7 mb-2 px-1 text-[13px] font-semibold text-fg-2">Your team</h2>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Team">
              {phase.teams.map((t) => {
                const on = team === t.id;
                return (
                  <motion.button key={t.id} type="button" role="radio" aria-checked={on} whileTap={{ scale: 0.97 }} transition={spring.snappy}
                    onClick={() => setTeam(on ? null : t.id)}
                    className={cn('flex h-12 items-center justify-between rounded-[14px] px-4 text-left text-[16px] font-medium transition-colors',
                      on ? 'bg-[#17150f] text-white' : cn('bg-white text-fg', HAIR))}>
                    <span className="truncate">{t.name}</span>{on ? <Check className="size-4 shrink-0" strokeWidth={2.5} /> : null}
                  </motion.button>
                );
              })}
            </div>
          </>
        ) : null}
        <div className="mt-auto pt-8">
          <motion.button type="submit" disabled={!ok} whileTap={ok ? { scale: 0.98 } : undefined} transition={spring.snappy}
            className="flex h-[56px] w-full items-center justify-center gap-2 rounded-[16px] bg-[#17150f] text-[17px] font-semibold text-white transition-opacity disabled:opacity-40">
            Join{team ? ` ${phase.teams.find((t) => t.id === team)?.name}` : ''}<ChevronRight className="size-5" />
          </motion.button>
          <p className="mt-3 text-center text-[14px] text-fg-3">No account needed · <button type="button" onClick={onSignIn} className="font-medium text-fg">Have an account? Sign in</button></p>
        </div>
      </motion.form>
    </div>
  );
}
