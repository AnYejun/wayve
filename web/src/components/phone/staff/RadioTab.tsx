// Radio = walkie-talkie. Everything the thumb needs lives in a dock above the tab bar: channel chips, a big press-and-hold
// talk button (release sends, slide away cancels) and a text fallback. The feed above is "Needs your OK" + history.
// Incoming clips addressed to me auto-play in order while this tab is open (one tap unlocks sound on iOS).
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { ArrowUp, Check, ChevronDown, Keyboard, Mic, Pause, Play, Radio as RadioIcon, TriangleAlert, User, Users, Volume2, VolumeX, X } from 'lucide-react';
import { ESCALATE_AFTER_MS, type Me, type Snapshot, type TalkMessage, type Utterance } from '@shared/contracts';
import { API, HttpError } from '@/lib/api';
import { ago, clock, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { rise, spring } from '@/design/motion';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { CARD, HAIR, Spinner } from '../common';
import { fmtDur, useTalkRecorder } from '../ops/recorder';
import { ackedBy, isForMe, unackedCount } from '@/comms/radio';
import { useRadioPlayer } from '@/comms/player';
import { haptic, LargeTitle, type Prefs } from './shell';

type ApplyTalk = (u: { kind: 'message'; data: TalkMessage } | { kind: 'utterance'; data: Utterance }) => void;
type Target = { to: string; label: string };

export { isForMe, ackedBy, unackedCount };

/** Toast + vibrate for radio addressed to me while the Radio tab is NOT open. */
export function useRadioAlerts(snap: Snapshot | null, me: Me | null, myTeamId: string | null, active: boolean, onOpen: () => void) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!snap || !me) return;
    if (!seen.current) { seen.current = new Set(snap.messages.map((m) => m.id)); return; }
    for (const m of snap.messages) {
      if (seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      if (!isForMe(m, me, myTeamId) || active) continue;
      haptic([80, 40, 80]);
      toast(`${m.fromName} → ${m.to.label}`, { description: m.text, action: { label: 'Listen', onClick: onOpen }, duration: 8000 });
    }
  }, [snap, me, myTeamId, active, onOpen]);
}

type Player = ReturnType<typeof useRadioPlayer>;

/** Height the dock occupies above the tab bar (content pads by this much so nothing hides under it). */
const DOCK_H = 228;

export function RadioTab({ snap, me, myTeamId, apply, prefs, setPrefs, active }: {
  snap: Snapshot | null; me: Me; myTeamId: string | null; apply: ApplyTalk; prefs: Prefs; setPrefs?: (p: Partial<Prefs>) => void; active: boolean;
}) {
  const now = useNow(5000);
  const myTeam = snap?.teams.find((t) => t.id === myTeamId);
  const [target, setTarget] = useState<Target>({ to: 'hq', label: 'HQ' });
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [mode, setMode] = useState<'talk' | 'type'>(typeof MediaRecorder === 'undefined' ? 'type' : 'talk');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [micBlocked, setMicBlocked] = useState<string | null>(typeof MediaRecorder === 'undefined' ? "This browser can't record audio. Type your message instead." : null);
  const [err, setErr] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const targetRef = useRef(target);
  targetRef.current = target;
  const player = useRadioPlayer();

  // auto-play new clips addressed to me while this tab is open
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!snap) return;
    if (!seen.current) { seen.current = new Set(snap.messages.map((m) => m.id)); return; }
    for (const m of [...snap.messages].reverse()) {
      if (seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      if (!isForMe(m, me, myTeamId) || !m.audioUrl) continue;
      haptic([60, 30, 60]);
      if (active && prefs.autoplay) {
        if (!player.unlocked) setNeedsTap(true);
        player.enqueue(m);
      }
    }
  }, [snap, me, myTeamId, active, prefs.autoplay, player]);

  const delivered = (r: { message: TalkMessage; utterance: Utterance }) => {
    apply({ kind: 'utterance', data: r.utterance });
    apply({ kind: 'message', data: r.message });
    setErr(null);
    haptic(20);
    toast.success(`Sent to ${r.message.to.label}`, r.message.issueKeys.length ? { description: `Linked to ${r.message.issueKeys.join(', ')}` } : undefined);
  };
  const failed = (e: HttpError) => {
    setErr(e.status === 503 ? "AI is off, so voice can't be transcribed. Type it instead."
      : e.status === 502 ? "Couldn't make that out. Try again or type it." : e.message);
  };
  const rec = useTalkRecorder({
    maxMs: 60_000,
    onBlob: async (blob) => { try { delivered(await API.talk(blob, targetRef.current.to, me.eventId)); } catch (e) { failed(e as HttpError); } },
    onDenied: (msg) => { setMicBlocked(msg); setMode('type'); },
  });

  const sendText = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try { delivered(await API.talkText(t, target.to, me.eventId)); setText(''); } catch (e) { failed(e as HttpError); } finally { setSending(false); }
  };
  const ack = async (m: TalkMessage) => {
    haptic(10);
    apply({ kind: 'message', data: { ...m, acks: [...m.acks, { participantId: me.participantId, at: Date.now() }] } });
    try { const r = await API.ack(m.id); apply({ kind: 'message', data: r.message }); }
    catch (e) { apply({ kind: 'message', data: m }); toast.error((e as HttpError).message); }
  };

  const relevant = (snap?.messages ?? []).filter((m) => m.fromId === me.participantId || isForMe(m, me, myTeamId));
  const pending = relevant.filter((m) => m.fromId !== me.participantId && !ackedBy(m, me.participantId));
  const rest = relevant.filter((m) => !pending.includes(m));
  const people = (snap?.participants ?? []).filter((p) => (p.role === 'staff' || p.role === 'admin') && p.id !== me.participantId);
  const personChosen = target.to.startsWith('person:');
  const chips: Array<{ key: string; label: string; icon: React.ReactNode; onClick: () => void; on: boolean; disabled?: boolean }> = [
    { key: 'hq', label: 'HQ', icon: <RadioIcon />, on: target.to === 'hq', onClick: () => setTarget({ to: 'hq', label: 'HQ' }) },
    { key: 'team', label: myTeam ? myTeam.name : 'My team', icon: <Users />, on: target.to.startsWith('team:'), disabled: !myTeam, onClick: () => myTeam && setTarget({ to: `team:${myTeam.id}`, label: myTeam.name }) },
    { key: 'all', label: 'Everyone', icon: <Users />, on: target.to === 'all', onClick: () => setTarget({ to: 'all', label: 'Everyone' }) },
    { key: 'person', label: personChosen ? target.label : 'Person', icon: <User />, on: personChosen, onClick: () => setPeopleOpen(true) },
  ];
  const autoplayOn = prefs.autoplay;

  return (
    <div className="flex flex-col gap-6" style={{ paddingBottom: DOCK_H }}>
      <LargeTitle title="Radio" sub="Hold to talk. Who heard what is on the record."
        right={
          <motion.button type="button" whileTap={{ scale: 0.94 }} transition={spring.snappy}
            onClick={() => { haptic(8); if (setPrefs) setPrefs({ autoplay: !autoplayOn }); else if (!player.unlocked) void player.unlock(); }}
            aria-pressed={autoplayOn} aria-label={autoplayOn ? 'Auto-play is on' : 'Auto-play is off'}
            className={cn('mb-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold', autoplayOn ? 'bg-[#eaf4ec] text-[#2f7a45]' : cn('bg-white text-fg-2', HAIR))}>
            {autoplayOn ? <Volume2 className="size-4" strokeWidth={2} /> : <VolumeX className="size-4" strokeWidth={2} />}
            {autoplayOn ? 'Auto-play' : 'Muted'}
          </motion.button>
        } />

      <AnimatePresence>
        {needsTap && !player.unlocked ? (
          <motion.button key="unlock" type="button" variants={rise} initial="initial" animate="animate" exit="exit"
            onClick={() => { haptic(10); void player.unlock(); setNeedsTap(false); }}
            className="-mt-2 flex h-12 items-center justify-center gap-2 rounded-[14px] bg-[#17150f] text-[15px] font-semibold text-white">
            <Volume2 className="size-[18px]" strokeWidth={2} />Tap to enable sound
          </motion.button>
        ) : null}
      </AnimatePresence>

      {pending.length > 0 ? (
        <section aria-label="Needs your OK">
          <h2 className="mb-2.5 flex items-center gap-2 px-1 text-[13px] font-semibold tracking-[.04em] text-[#b91c1c] uppercase">
            <span className="live-dot" data-ping style={{ color: '#e5484d' }} />Needs your OK · <span className="tabular-nums">{pending.length}</span>
          </h2>
          <motion.div layout className="flex flex-col gap-2.5">
            <AnimatePresence initial={false}>
              {pending.map((m) => <Bubble key={m.id} m={m} me={me} snap={snap!} now={now} onAck={ack} player={player} />)}
            </AnimatePresence>
          </motion.div>
        </section>
      ) : null}

      <section aria-label="History">
        <h2 className="mb-2.5 px-1 text-[13px] font-semibold tracking-[.04em] text-fg-3 uppercase">History</h2>
        {rest.length === 0 ? (
          <div className={cn(CARD, 'px-5 py-9 text-center')}>
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-[#f3f2ef]"><RadioIcon className="size-5 text-fg-2" strokeWidth={1.75} /></div>
            <p className="mt-3 text-[16px] font-semibold text-fg">Quiet on the radio</p>
            <p className="mx-auto mt-1 max-w-[260px] text-[14px] leading-[20px] text-fg-2">Use this instead of phone calls. Every message gets a “Got it”.</p>
          </div>
        ) : (
          <motion.div layout className="flex flex-col gap-2.5">
            <AnimatePresence initial={false}>
              {rest.slice(0, 40).map((m) => <Bubble key={m.id} m={m} me={me} snap={snap!} now={now} onAck={ack} player={player} />)}
            </AnimatePresence>
          </motion.div>
        )}
      </section>

      {/* ── Thumb dock: channel · talk · type ───────────────────────────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 z-(--z-sticky) bg-[rgb(250_250_249/.96)] shadow-[inset_0_.5px_0_rgb(23_21_15/.12),0_-12px_24px_-16px_rgb(23_21_15/.18)] backdrop-blur-xl" style={{ bottom: 'calc(var(--safe-b) + 62px)' }}>
        <div className="mx-auto max-w-[640px] px-4 pt-3 pb-3">
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label="Talk to">
            {chips.map((c) => (
              <motion.button key={c.key} type="button" role="radio" aria-checked={c.on} disabled={c.disabled} onClick={() => { haptic(6); c.onClick(); }}
                whileTap={{ scale: 0.95 }} transition={spring.snappy}
                className={cn('relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold disabled:opacity-35 [&_svg]:size-[15px]',
                  c.on ? 'text-white' : cn('bg-white/70 text-fg', HAIR))}>
                {c.on ? <motion.span layoutId="radio-chip" transition={spring.smooth} className="absolute inset-0 rounded-full bg-[#17150f]" aria-hidden /> : null}
                <span className="relative inline-flex items-center gap-1.5">{c.icon}{c.label}{c.key === 'person' ? <ChevronDown className="size-3.5! opacity-60" strokeWidth={2} /> : null}</span>
              </motion.button>
            ))}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {mode === 'talk' ? (
              <motion.div key="talk" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
                className="mt-2 grid grid-cols-[48px_1fr_48px] items-center">
                <motion.button type="button" whileTap={{ scale: 0.92 }} transition={spring.snappy} onClick={() => { haptic(6); setMode('type'); }}
                  aria-label="Type a message instead" disabled={rec.state !== 'idle'}
                  className={cn('grid size-12 place-items-center rounded-full bg-white text-fg-2 disabled:opacity-30', HAIR)}>
                  <Keyboard className="size-5" strokeWidth={1.75} />
                </motion.button>
                <Ptt rec={rec} label={target.label} disabled={!!micBlocked} />
                <span aria-hidden />
              </motion.div>
            ) : (
              <motion.form key="type" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
                className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void sendText(); }}>
                {!micBlocked ? (
                  <motion.button type="button" whileTap={{ scale: 0.92 }} transition={spring.snappy} onClick={() => { haptic(6); setMode('talk'); }} aria-label="Talk instead"
                    className={cn('grid size-11 shrink-0 place-items-center rounded-full bg-white text-fg-2', HAIR)}><Mic className="size-5" strokeWidth={1.75} /></motion.button>
                ) : null}
                <div className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white py-1 pr-1 pl-4', HAIR)}>
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${target.label}`} aria-label="Message" maxLength={500}
                    enterKeyHint="send" autoFocus className="h-9 min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-3" />
                  <button type="submit" disabled={!text.trim() || sending} aria-label="Send"
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-[#17150f] text-white transition-[opacity,scale] duration-120 active:scale-[.92] disabled:opacity-25">
                    {sending ? <Spinner className="size-4 border-white/30 border-t-white" /> : <ArrowUp className="size-[18px]" strokeWidth={2.25} />}
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {err || (micBlocked && mode === 'type') ? (
              <motion.p key="err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="mt-2 flex items-start gap-2 rounded-[12px] bg-[#fdf3ea] px-3 py-2 text-[13px] leading-[18px] text-[#86552e]" role="alert">
                <TriangleAlert className="mt-px size-4 shrink-0" strokeWidth={1.75} />
                <span className="flex-1">{err ?? micBlocked}</span>
                {err ? <button type="button" onClick={() => setErr(null)} aria-label="Dismiss" className="-m-1 p-1"><X className="size-4" strokeWidth={2} /></button> : null}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <Drawer open={peopleOpen} onOpenChange={setPeopleOpen}>
        <DrawerContent>
          <DrawerHeader className="pb-3 text-left">
            <DrawerTitle className="text-left">Who should hear this?</DrawerTitle>
            <DrawerDescription className="text-left">Their phone buzzes, and their “Got it” is logged.</DrawerDescription>
          </DrawerHeader>
          <div className="max-h-[60dvh] overflow-y-auto px-4 pb-[calc(var(--safe-b)+20px)]">
            {people.length === 0 ? <p className="py-8 text-center text-[15px] text-fg-2">No other staff connected yet.</p> : (
              <ul className={cn('overflow-hidden', CARD)}>
                {people.map((p, i) => {
                  const team = snap?.teams.find((t) => t.id === p.teamId);
                  const on = target.to === `person:${p.id}`;
                  return (
                    <li key={p.id} className="relative">
                      {i > 0 ? <span className="absolute top-0 right-0 left-[60px] h-px origin-top scale-y-50 bg-[rgb(23_21_15/.16)]" aria-hidden /> : null}
                      <button type="button" onClick={() => { haptic(6); setTarget({ to: `person:${p.id}`, label: p.displayName }); setPeopleOpen(false); }}
                        className="flex min-h-[60px] w-full items-center gap-3 px-4 text-left active:bg-[rgb(23_21_15/.05)]">
                        <Avatar name={p.displayName} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[16px] font-medium text-fg">{p.displayName}</span>
                          <span className="block text-[13px] text-fg-3">{p.role === 'admin' ? 'HQ' : team?.name ?? 'No team'}</span>
                        </span>
                        {on ? <Check className="size-5 text-fg" strokeWidth={2.25} /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/** Big press-and-hold talk button. Release sends; sliding the finger ≥ 90 px away arms "cancel" (release = discard). */
function Ptt({ rec, label, disabled }: { rec: ReturnType<typeof useTalkRecorder>; label: string; disabled: boolean }) {
  const reduced = useReducedMotion();
  const [armedCancel, setArmedCancel] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const recording = rec.state === 'recording';
  const uploading = rec.state === 'uploading';

  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || disabled || uploading) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    setArmedCancel(false);
    rec.pressStart();
  };
  const move = (e: RPointerEvent<HTMLButtonElement>) => {
    if (!origin.current || !recording) return;
    const d = Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y);
    const armed = d > 90;
    if (armed !== armedCancel) { setArmedCancel(armed); haptic(armed ? [20, 30, 20] : 8); }
  };
  const up = () => {
    origin.current = null;
    if (armedCancel) { setArmedCancel(false); rec.cancel(); toast('Discarded', { duration: 1500 }); return; }
    rec.pressEnd();
  };

  const status = uploading ? 'Sending…'
    : recording ? (armedCancel ? 'Release to discard' : `${fmtDur(rec.elapsed)} · Release to send · Slide away to cancel`)
    : disabled ? 'Microphone unavailable' : `Hold to talk to ${label}`;

  return (
    <div className="flex flex-col items-center">
      <div className="relative grid size-[128px] place-items-center">
        {/* level halo */}
        <span aria-hidden className="absolute inset-0 rounded-full transition-transform duration-100 ease-out"
          style={{ transform: `scale(${recording ? 0.82 + rec.level * 0.3 : 0.82})`, background: recording ? (armedCancel ? 'rgb(23 21 15 / .08)' : 'rgb(229 72 77 / .14)') : 'rgb(23 21 15 / .05)' }} />
        {recording && !reduced ? (
          <motion.span aria-hidden className="absolute inset-[10px] rounded-full border-2 border-[#e5484d]"
            initial={{ scale: 0.92, opacity: 0.7 }} animate={{ scale: 1.18, opacity: 0 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }} />
        ) : null}
        {/* elapsed ring (60 s max) */}
        <svg className="pointer-events-none absolute inset-[6px] -rotate-90" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="48" fill="none" stroke="rgb(23 21 15 / .08)" strokeWidth="2" />
          {recording ? <circle cx="50" cy="50" r="48" fill="none" stroke={armedCancel ? '#8a8884' : '#e5484d'} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={`${Math.min(1, rec.elapsed / 60000) * 301.6} 301.6`} /> : null}
        </svg>
        <motion.button type="button" disabled={disabled || uploading}
          aria-label={recording ? 'Release to send' : `Hold to talk to ${label}`} aria-pressed={recording}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rec.toggle(); } }}
          onContextMenu={(e) => e.preventDefault()}
          animate={{ scale: recording ? (armedCancel ? 0.9 : 1.04) : 1 }} transition={spring.snappy}
          className={cn('relative grid size-[100px] touch-none select-none place-items-center rounded-full text-white shadow-[0_12px_28px_-10px_rgb(23_21_15/.5)]',
            'disabled:opacity-35 [-webkit-touch-callout:none] [-webkit-user-select:none] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#17150f]',
            recording ? (armedCancel ? 'bg-[#8a8884]' : 'bg-[#e5484d]') : 'bg-[#17150f]')}>
          {uploading ? <Spinner className="size-7 border-white/30 border-t-white" />
            : recording && armedCancel ? <X className="size-9" strokeWidth={2} />
            : <Mic className="size-9" strokeWidth={recording ? 2.25 : 1.75} />}
        </motion.button>
      </div>
      <p className={cn('mt-0.5 h-5 text-center text-[13px] font-semibold tabular-nums', recording ? (armedCancel ? 'text-fg-2' : 'text-[#b91c1c]') : 'text-fg-2')} aria-live="polite">{status}</p>
    </div>
  );
}

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-[#efeee9] font-semibold text-fg-2" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function Bubble({ m, me, snap, now, onAck, player }: {
  m: TalkMessage; me: Me; snap: Snapshot; now: number; onAck: (m: TalkMessage) => void; player: Player;
}) {
  const mine = m.fromId === me.participantId;
  const myAck = ackedBy(m, me.participantId);
  const expected = m.expected.filter((x) => x !== m.fromId);
  const heard = m.acks.filter((a) => expected.includes(a.participantId));
  const overdue = now - m.createdAt > ESCALATE_AFTER_MS && heard.length < expected.length;
  const needsMe = !mine && !myAck;
  const isPlaying = player.playing === m.id;
  const sender = snap.participants.find((p) => p.id === m.fromId);
  const senderTeam = sender?.teamId ? snap.teams.find((t) => t.id === sender.teamId)?.name : sender?.role === 'admin' ? 'HQ' : null;
  const names = heard.map((a) => snap.participants.find((p) => p.id === a.participantId)?.displayName).filter(Boolean);
  return (
    <motion.article layout variants={rise} initial="initial" animate="animate" exit="exit"
      className={cn(CARD, 'relative overflow-hidden px-4 pt-3.5 pb-3')}>
      {needsMe ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[#e5484d]" /> : null}
      <header className="flex items-center gap-2.5">
        <Avatar name={mine ? me.displayName : m.fromName} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[15px] font-semibold text-fg">{mine ? 'You' : m.fromName}{senderTeam && !mine ? <span className="ml-1.5 text-[13px] font-medium text-fg-3">{senderTeam}</span> : null}</p>
          <p className="truncate text-[12px] text-fg-3">to {m.to.label}</p>
        </div>
        <time className="shrink-0 text-[12px] tabular-nums text-fg-3" dateTime={new Date(m.createdAt).toISOString()}>{clock(m.createdAt)}</time>
      </header>

      {m.audioUrl ? (
        <div className="mt-3 flex items-center gap-3 rounded-[12px] bg-[#f6f5f2] py-2 pr-3 pl-2">
          <motion.button type="button" whileTap={{ scale: 0.9 }} transition={spring.snappy} onClick={() => { haptic(6); if (isPlaying) player.pause(); else void player.play(m); }}
            aria-label={isPlaying ? 'Pause' : 'Play'} className="grid size-9 shrink-0 place-items-center rounded-full bg-[#17150f] text-white">
            {isPlaying ? <Pause className="size-4 fill-white" strokeWidth={0} /> : <Play className="ml-0.5 size-4 fill-white" strokeWidth={0} />}
          </motion.button>
          <div className="flex h-6 min-w-0 flex-1 items-center gap-[3px]" aria-hidden>
            {Array.from({ length: 30 }, (_, i) => {
              const h = 5 + ((Math.sin(i * 1.7 + m.id.length) + 1) * 6);
              const done = isPlaying && i / 30 < player.progress;
              return <span key={i} className="w-[3px] flex-1 rounded-full transition-colors" style={{ height: h, maxWidth: 3, background: done ? '#17150f' : 'rgb(23 21 15 / .2)' }} />;
            })}
          </div>
          <span className="shrink-0 text-[12px] font-medium tabular-nums text-fg-2">{m.durationMs ? fmtDur(m.durationMs) : 'Voice'}</span>
        </div>
      ) : null}

      <p className="mt-2.5 text-[16px] leading-[23px] text-fg">{m.text}</p>
      {m.issueKeys.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.issueKeys.map((k) => <span key={k} className={cn('inline-flex h-6 items-center rounded-[7px] bg-white px-2 font-mono text-[12px] font-medium text-fg-2', HAIR)}>{k}</span>)}
        </div>
      ) : null}

      <footer className="mt-3 flex min-h-10 items-center gap-2">
        {mine ? (
          <span className={cn('text-[13px] tabular-nums', overdue ? 'font-semibold text-[#b91c1c]' : 'text-fg-2')}>
            {expected.length ? `Heard by ${heard.length}/${expected.length}` : 'Delivered'}{names.length ? ` · ${names.join(', ')}` : ''}{overdue ? ' · not heard yet' : ''}
          </span>
        ) : myAck ? (
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-[#2f7a45]"><Check className="size-4" strokeWidth={2.25} />Got it · {clock(myAck.at)}</span>
        ) : (
          <>
            <span className={cn('text-[13px] tabular-nums', overdue ? 'font-semibold text-[#b91c1c]' : 'text-fg-3')}>{overdue ? `Waiting ${ago(m.createdAt, now).replace(' ago', '')}` : ago(m.createdAt, now)}</span>
            <motion.button type="button" whileTap={{ scale: 0.95 }} transition={spring.snappy} onClick={() => onAck(m)}
              className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-full bg-[#17150f] px-5 text-[15px] font-semibold text-white">
              <Check className="size-4" strokeWidth={2.5} />Got it
            </motion.button>
          </>
        )}
      </footer>
    </motion.article>
  );
}
