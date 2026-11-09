// Radio — the walkie-talkie for HQ on desktop. Channels (all radio · HQ · everyone · teams · people) | timeline with
// voice bubbles, transcripts, issue links and "heard by" state | what's still waiting on someone.
// Push to talk: hold the button, or hold SPACE anywhere outside a text field (Esc cancels). Incoming voice for me auto-plays.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import {
  ArrowUp, Check, Clock, Headset, Megaphone, Mic, Pause, Play, Radio as RadioIcon, Square, TriangleAlert, Users, Volume2, X,
} from 'lucide-react';
import type { Me, Participant, Snapshot, TalkMessage, Utterance } from '@shared/contracts';
import { HttpError, api } from '@/lib/api';
import { ago, clock, useNow } from '@/lib/time';
import { cn } from '@/lib/utils';
import { rise, spring } from '@/design/motion';
import { Switch } from '@/components/ui/switch';
import { fmtDur, useRecorder } from '@/comms/recorder';
import { useRadioPlayer, type RadioPlayer } from '@/comms/player';
import { ackedBy, heard, initials, isForMe, isOverdue, messageInChannel, personOnline, type Channel } from '@/comms/radio';
import { useShell } from '../context';
import { AgentBadge } from '../live/crew';

const AUTOPLAY_KEY = 'wayve:radio:autoplay';
const readAutoplay = () => { try { return localStorage.getItem(AUTOPLAY_KEY) !== '0'; } catch { return true; } };

const isEditable = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

export default function RadioSection() {
  const { snap, eventId, apply } = useShell();
  if (!snap) return <Loading />;
  return <Radio snap={snap} eventId={eventId} apply={apply as unknown as ApplyTalk} />;
}

type ApplyTalk = (u: { kind: 'message'; data: TalkMessage } | { kind: 'utterance'; data: Utterance }) => void;

function Radio({ snap, eventId, apply }: { snap: Snapshot; eventId: string; apply: ApplyTalk }) {
  const me = snap.me;
  const now = useNow(5000);
  const reduced = useReducedMotion();
  const myTeamId = snap.participants.find((p) => p.id === me.participantId)?.teamId ?? null;
  const people = useMemo(() => snap.participants.filter((p) => (p.role === 'staff' || p.role === 'admin') && p.id !== me.participantId)
    .sort((a, b) => Number(personOnline(b, now)) - Number(personOnline(a, now)) || a.displayName.localeCompare(b.displayName)), [snap.participants, me.participantId, now]);

  const channels = useMemo(() => {
    const feeds: Channel[] = [
      { key: 'all-traffic', label: 'All radio', to: 'all' },
      { key: 'hq', label: 'HQ', to: 'hq' },
      { key: 'all', label: 'Everyone', to: 'all' },
    ];
    const teams: Channel[] = snap.teams.map((t) => ({ key: `team:${t.id}`, label: t.name, to: `team:${t.id}` }));
    const direct: Channel[] = people.map((p) => ({ key: `person:${p.id}`, label: p.displayName, to: `person:${p.id}` }));
    return { feeds, teams, direct, all: [...feeds, ...teams, ...direct] };
  }, [snap.teams, people]);

  const [chKey, setChKey] = useState<Channel['key']>('all-traffic');
  const channel = channels.all.find((c) => c.key === chKey) ?? channels.feeds[0];
  const [autoplay, setAutoplay] = useState(readAutoplay);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const player = useRadioPlayer();

  // auto-play new voice addressed to me
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(snap.messages.map((m) => m.id)); return; }
    for (const m of [...snap.messages].reverse()) {
      if (seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      if (!isForMe(m, me, myTeamId)) continue;
      if (m.audioUrl && autoplay) player.enqueue(m);
      else toast(`${m.fromName} → ${m.to.label}`, { description: m.text, duration: 6000 });
    }
  }, [snap.messages, me, myTeamId, autoplay, player]);

  const delivered = (r: { message: TalkMessage; utterance: Utterance }) => {
    apply({ kind: 'utterance', data: r.utterance });
    apply({ kind: 'message', data: r.message });
    setErr(null);
    setFocusId(r.message.id);
    if (r.message.issueKeys.length) toast.success(`Sent to ${r.message.to.label}`, { description: `Linked to ${r.message.issueKeys.join(', ')}` });
  };
  const failed = (e: unknown) => {
    const he = e as HttpError;
    setErr(he.status === 503 ? "AI is off, so voice can't be transcribed. Type the message instead."
      : he.status === 502 ? "Couldn't make that out. Try again, or type it." : he.status === 0 ? "Can't reach the server." : he.message);
  };
  const rec = useRecorder({
    maxMs: 60_000,
    onBlob: async (blob, dur) => {
      try {
        delivered(await api<{ message: TalkMessage; utterance: Utterance }>('/api/talk', {
          raw: blob, query: { to: channelRef.current.to, eventId, durationMs: String(Math.round(dur)) },
        }));
      } catch (e) { failed(e); }
    },
    onDenied: setMicError,
  });

  // hold SPACE to talk (outside text fields), Esc cancels
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !e.metaKey && !e.ctrlKey && !isEditable(document.activeElement)) {
        e.preventDefault();
        if (rec.state === 'idle') void rec.start();
      } else if (e.key === 'Escape' && rec.state === 'recording') {
        rec.cancel();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditable(document.activeElement) && rec.state !== 'idle') { e.preventDefault(); rec.stop(); }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [rec]);

  // Optimistic send: the bubble appears instantly ("Sending…"), the composer clears, the server's message replaces it.
  const [pending, setPending] = useState<Array<{ id: string; text: string; to: string; label: string; state: 'sending' | 'failed' }>>([]);
  const pushText = async (t: string, to: string, label: string, reuseId?: string) => {
    const id = reuseId ?? `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    setPending((p) => (reuseId ? p.map((x) => (x.id === id ? { ...x, state: 'sending' } : x)) : [...p, { id, text: t, to, label, state: 'sending' }]));
    try {
      delivered(await api<{ message: TalkMessage; utterance: Utterance }>('/api/talk/text', { body: { text: t, to, eventId } }));
      setPending((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setPending((p) => p.map((x) => (x.id === id ? { ...x, state: 'failed' } : x)));
      failed(e);
    }
  };
  const sendText = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    await pushText(t, channel.to, channel.label);
  };
  const ack = async (m: TalkMessage) => {
    apply({ kind: 'message', data: { ...m, acks: [...m.acks, { participantId: me.participantId, at: Date.now() }] } });
    try { const r = await api<{ message: TalkMessage }>(`/api/messages/${m.id}/ack`, { body: {} }); apply({ kind: 'message', data: r.message }); }
    catch (e) { apply({ kind: 'message', data: m }); toast.error((e as HttpError).message); }
  };

  const list = useMemo(() => [...snap.messages].filter((m) => messageInChannel(m, channel, me.participantId)).sort((a, b) => a.createdAt - b.createdAt),
    [snap.messages, channel, me.participantId]);
  const unread = (c: Channel) => snap.messages.filter((m) => messageInChannel(m, c, me.participantId) && isForMe(m, me, myTeamId) && !ackedBy(m, me.participantId)).length;
  const needsMe = snap.messages.filter((m) => isForMe(m, me, myTeamId) && !ackedBy(m, me.participantId));
  const waiting = snap.messages.filter((m) => m.fromId === me.participantId && heard(m).acks.length < heard(m).expected.length);
  const overdueCount = snap.messages.filter((m) => isOverdue(m, now)).length;

  const scroller = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (list.length !== lastCount.current && (nearBottom || lastCount.current === 0)) el.scrollTo({ top: el.scrollHeight, behavior: lastCount.current ? 'smooth' : 'auto' });
    lastCount.current = list.length;
  }, [list.length, chKey]);
  useEffect(() => { lastCount.current = 0; }, [chKey]);
  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => document.getElementById(`msg-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    const clear = setTimeout(() => setFocusId(null), 2400);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [focusId, chKey]);

  const chMeta = (c: Channel): string => {
    if (c.key === 'all-traffic') return 'Every message on the event radio';
    if (c.key === 'hq') return 'Organizers and the HQ team';
    if (c.key === 'all') return `Everyone on staff · ${people.length + 1} people`;
    if (c.key.startsWith('team:')) {
      const id = c.key.slice(5);
      const members = snap.participants.filter((p) => p.teamId === id && (p.role === 'staff' || p.role === 'admin'));
      return `${members.length} ${members.length === 1 ? 'member' : 'members'} · ${members.filter((p) => personOnline(p, now)).length} online`;
    }
    const p = people.find((x) => `person:${x.id}` === c.key);
    if (!p) return '';
    const team = snap.teams.find((t) => t.id === p.teamId)?.name;
    return `${p.role === 'admin' ? 'HQ' : team ?? 'No team'} · ${personOnline(p, now) ? 'online' : `last seen ${ago(p.lastSeenAt, now)}`}`;
  };

  return (
    <div className="flex h-[calc(100dvh-48px)] min-h-0 md:h-dvh">
      {/* channels */}
      <aside className="hidden w-[264px] shrink-0 flex-col border-r border-line-2 bg-white lg:flex" aria-label="Channels">
        <div className="px-5 pt-6 pb-4">
          <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-fg">Radio</h1>
          <p className="mt-1 text-[13px] leading-[18px] text-fg-2">Push to talk. Everyone who should hear it does, and it's on the record.</p>
          <label className="mt-4 flex items-center justify-between gap-3 rounded-[10px] bg-[#fafaf9] px-3 py-2.5 text-[13px] font-medium text-fg-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.12)]">
            <span className="inline-flex items-center gap-2"><Volume2 size={15} strokeWidth={1.75} />Auto-play voice</span>
            <Switch checked={autoplay} onCheckedChange={(v) => { setAutoplay(v); try { localStorage.setItem(AUTOPLAY_KEY, v ? '1' : '0'); } catch { /* storage off */ } }} aria-label="Auto-play incoming voice" />
          </label>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <ChannelGroup label="Feeds">
            {channels.feeds.map((c) => (
              <ChannelRow key={c.key} c={c} on={c.key === chKey} onPick={setChKey} unread={c.key === 'all-traffic' ? needsMe.length : unread(c)}
                icon={c.key === 'all-traffic' ? <RadioIcon size={16} strokeWidth={1.75} /> : c.key === 'hq' ? <Headset size={16} strokeWidth={1.75} /> : <Megaphone size={16} strokeWidth={1.75} />} reduced={!!reduced} />
            ))}
          </ChannelGroup>
          {channels.teams.length ? (
            <ChannelGroup label="Teams">
              {channels.teams.map((c) => <ChannelRow key={c.key} c={c} on={c.key === chKey} onPick={setChKey} unread={unread(c)} icon={<Users size={16} strokeWidth={1.75} />} reduced={!!reduced} />)}
            </ChannelGroup>
          ) : null}
          <ChannelGroup label="Direct">
            {people.length === 0 ? <p className="px-2.5 py-1.5 text-[13px] text-fg-3">No staff connected yet</p>
              : channels.direct.map((c) => {
                const p = people.find((x) => `person:${x.id}` === c.key)!;
                return <ChannelRow key={c.key} c={c} on={c.key === chKey} onPick={setChKey} unread={unread(c)} reduced={!!reduced}
                  icon={<Avatar p={p} size={22} online={personOnline(p, now)} />} />;
              })}
          </ChannelGroup>
        </nav>
      </aside>

      {/* timeline + composer */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#fcfcfb]" aria-label={channel.label}>
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line-2 bg-white/90 px-6 backdrop-blur">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold text-fg">{channel.label}</h2>
            <p className="truncate text-[12px] text-fg-3">{chMeta(channel)}</p>
          </div>
          {/* compact channel picker below lg */}
          <select className="ml-auto h-9 rounded-[8px] border border-line-3 bg-white px-2 text-[14px] lg:hidden" value={chKey} onChange={(e) => setChKey(e.target.value as Channel['key'])} aria-label="Channel">
            {channels.all.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <div className="ml-auto hidden items-center gap-2 lg:flex">
            {overdueCount ? <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#fdecec] px-2.5 text-[12px] font-semibold text-[#b91c1c]"><Clock size={13} strokeWidth={2} />{overdueCount} not heard</span> : null}
            <AnimatePresence>
              {player.blocked ? (
                <motion.button key="unlock" type="button" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  onClick={() => void player.unlock()} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#17150f] px-3 text-[13px] font-semibold text-white">
                  <Volume2 size={14} strokeWidth={2} />Enable sound
                </motion.button>
              ) : player.playing ? (
                <motion.span key="playing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex h-8 items-center gap-2 rounded-full bg-white px-3 text-[13px] font-medium text-fg-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.14)]">
                  <span className="live-dot text-[#58a069]" data-ping />Playing
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>
        </header>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 && pending.length === 0 ? (
            <div className="grid h-full place-items-center px-6">
              <div className="max-w-[360px] text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-[14px] bg-white text-fg-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.14)]"><RadioIcon size={22} strokeWidth={1.75} /></span>
                <p className="mt-4 text-[16px] font-semibold text-fg">Nothing on {channel.label} yet</p>
                <p className="mt-1.5 text-[14px] leading-5 text-fg-2">Hold the talk button or press and hold <Kbd>Space</Kbd>. Staff phones buzz, play it, and confirm with "Got it".</p>
              </div>
            </div>
          ) : (
            <ol className="mx-auto flex max-w-[860px] flex-col gap-1 px-6 py-6">
              <AnimatePresence initial={false}>
                {list.map((m) => (
                  <MessageRow key={m.id} m={m} me={me} snap={snap} now={now} player={player} onAck={ack} showTarget={channel.key === 'all-traffic'}
                    focused={focusId === m.id} myTeamId={myTeamId} />
                ))}
                {pending.map((p) => (
                  <motion.li key={p.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="ml-auto max-w-[78%] rounded-[16px] bg-[#17150f] px-3.5 py-2.5 text-white">
                    <div className="text-[11.5px] font-medium text-white/60">You → {p.label}</div>
                    <p className="mt-0.5 text-[15px] leading-[21px]">{p.text}</p>
                    {p.state === 'sending'
                      ? <div className="mt-1 flex items-center gap-1.5 text-[12px] text-white/60"><span className="size-3 animate-spin rounded-full border-[1.5px] border-white/25 border-t-white/80" />Sending…</div>
                      : <button type="button" onClick={() => void pushText(p.text, p.to, p.label, p.id)} className="mt-1 text-[12px] font-semibold text-[#ffb4a8]">Couldn’t send · Retry</button>}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
        </div>

        <Composer channel={channel} rec={rec} text={text} setText={setText} sending={sending} onSend={() => void sendText()}
          micError={micError} onRetryMic={() => { setMicError(null); void rec.start(); }} err={err} onDismissErr={() => setErr(null)} />
      </section>

      {/* waiting on */}
      <aside className="hidden w-[300px] shrink-0 flex-col border-l border-line-2 bg-white xl:flex" aria-label="Waiting on">
        <div className="px-5 pt-6 pb-3">
          <h2 className="text-[15px] font-semibold text-fg">Waiting on</h2>
          <p className="mt-0.5 text-[12px] text-fg-3">Messages someone still has to confirm</p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <WaitGroup title="Needs your OK" tone="amber" items={needsMe} me={me} now={now} onOpen={(m) => { setChKey('all-traffic'); setFocusId(m.id); }} onAck={ack} />
          <WaitGroup title="Not heard yet" tone="red" items={waiting} me={me} now={now} snap={snap} onOpen={(m) => { setChKey('all-traffic'); setFocusId(m.id); }} />
          {needsMe.length === 0 && waiting.length === 0 ? (
            <div className="mx-2 mt-2 rounded-[12px] bg-[#f6faf7] px-4 py-5 text-center">
              <Check size={18} strokeWidth={2} className="mx-auto text-[#2f7a45]" />
              <p className="mt-2 text-[13px] font-semibold text-fg">All caught up</p>
              <p className="mt-0.5 text-[12px] text-fg-2">Every message has been heard.</p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function ChannelGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-[.06em] text-fg-3 uppercase">{label}</div>
      {children}
    </div>
  );
}

function ChannelRow({ c, on, onPick, unread, icon, reduced }: { c: Channel; on: boolean; onPick: (k: Channel['key']) => void; unread: number; icon: ReactNode; reduced: boolean }) {
  return (
    <button type="button" onClick={() => onPick(c.key)} aria-current={on ? 'true' : undefined}
      className={cn('relative flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[14px] transition-colors',
        on ? 'font-semibold text-fg' : 'font-medium text-fg-2 hover:bg-wash-1 hover:text-fg')}>
      {on ? <motion.span layoutId="radio-channel" className="absolute inset-0 rounded-[8px] bg-[#f3f3f1]" transition={reduced ? { duration: 0 } : spring.smooth} /> : null}
      <span className="relative grid size-5 shrink-0 place-items-center text-fg-2">{icon}</span>
      <span className="relative min-w-0 flex-1 truncate">{c.label}</span>
      {unread ? <span className="relative grid h-5 min-w-5 place-items-center rounded-full bg-[#e5484d] px-1.5 text-[11px] font-semibold text-white tabular-nums">{unread}</span> : null}
    </button>
  );
}

function Avatar({ p, size = 32, online, ink }: { p: { displayName: string; role?: Participant['role'] }; size?: number; online?: boolean; ink?: boolean }) {
  const dark = ink ?? p.role === 'admin';
  return (
    <span className="relative inline-grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)), letterSpacing: size < 24 ? '-0.04em' : undefined, background: dark ? '#17150f' : '#efeeeb', color: dark ? '#fff' : '#4a4844' }}>
      {initials(p.displayName)}
      {online !== undefined ? (
        <span className="absolute rounded-full" style={{ width: Math.max(7, Math.round(size * 0.32)), height: Math.max(7, Math.round(size * 0.32)), right: -2, bottom: -2,
          background: online ? '#34c759' : '#c7c7cc', boxShadow: '0 0 0 2px #fff' }} />
      ) : null}
    </span>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mx-0.5 inline-flex h-5 items-center rounded-[5px] bg-white px-1.5 font-sans text-[11px] font-semibold text-fg-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.2),0_1px_0_rgb(23_21_15/.08)]">{children}</kbd>;
}

function MessageRow({ m, me, snap, now, player, onAck, showTarget, focused, myTeamId }: {
  m: TalkMessage; me: Me; snap: Snapshot; now: number; player: RadioPlayer; onAck: (m: TalkMessage) => void; showTarget: boolean; focused: boolean; myTeamId: string | null;
}) {
  const sender = snap.participants.find((p) => p.id === m.fromId);
  const mine = m.fromId === me.participantId;
  const forMe = isForMe(m, me, myTeamId);
  const myAck = ackedBy(m, me.participantId);
  const { expected, acks } = heard(m);
  const overdue = isOverdue(m, now);
  const needsMe = forMe && !myAck;
  const team = sender?.teamId ? snap.teams.find((t) => t.id === sender.teamId)?.name : null;
  return (
    <motion.li id={`msg-${m.id}`} layout="position" variants={rise} initial="initial" animate="animate" exit="exit"
      className={cn('group relative flex gap-3 rounded-[14px] px-3 py-3 transition-colors duration-700',
        focused ? 'bg-[#fff8ec]' : 'hover:bg-white', needsMe && 'bg-[#fffaf2]')}>
      {needsMe ? <span className="absolute top-3 bottom-3 left-0 w-[3px] rounded-full bg-[#e8a33d]" aria-hidden /> : null}
      <Avatar p={{ displayName: m.fromName, role: sender?.role }} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[14px] font-semibold text-fg">{mine ? `${m.fromName} (you)` : m.fromName}</span>
          {(snap.crew ?? []).some((a) => a.participantId === m.fromId) ? <AgentBadge /> : null}
          <span className="text-[12px] text-fg-3">{sender?.role === 'admin' ? 'HQ' : team ?? ''}</span>
          {showTarget || m.to.type === 'person' ? <span className="text-[12px] font-medium text-fg-2">→ {m.to.label}</span> : null}
          <time className="ml-auto text-[12px] text-fg-3 tabular-nums" dateTime={new Date(m.createdAt).toISOString()} title={new Date(m.createdAt).toLocaleString('en-US')}>{clock(m.createdAt)}</time>
        </div>
        {m.audioUrl ? <VoiceBubble m={m} player={player} /> : null}
        <p className="mt-1 text-[15px] leading-[22px] text-fg [overflow-wrap:anywhere]">{m.text}</p>
        {m.issueKeys.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {m.issueKeys.map((k) => {
              const issue = snap.issues.find((i) => i.key === k);
              return (
                <a key={k} href={issue ? `/e/${snap.event.id}/dashboard?issue=${issue.id}` : undefined}
                  className="inline-flex h-6 items-center gap-1 rounded-[6px] bg-white px-1.5 font-mono text-[11px] font-semibold text-fg-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.18)] hover:text-fg"
                  title={issue?.title}>
                  → {k}{issue ? <span className="max-w-[180px] truncate font-sans font-medium text-fg-3">{issue.title}</span> : null}
                </a>
              );
            })}
          </div>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          {expected.length ? (
            <span className={cn('inline-flex items-center gap-1.5 text-[12px] tabular-nums', overdue ? 'font-semibold text-[#b91c1c]' : 'text-fg-3')}>
              {acks.length ? <span className="flex -space-x-1.5">
                {acks.slice(0, 4).map((a) => {
                  const p = snap.participants.find((x) => x.id === a.participantId);
                  return p ? <span key={a.participantId} className="rounded-full ring-2 ring-[#fcfcfb]"><Avatar p={p} size={18} /></span> : null;
                })}
              </span> : null}
              {overdue ? <><Clock size={12} strokeWidth={2.25} />Not heard · {ago(m.createdAt, now)} · </> : null}
              Heard by {acks.length}/{expected.length}
            </span>
          ) : <span className="text-[12px] text-fg-3">Delivered</span>}
          {needsMe ? (
            <motion.button type="button" whileTap={{ scale: 0.96 }} transition={spring.snappy} onClick={() => onAck(m)}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-[#17150f] px-3.5 text-[13px] font-semibold text-white">
              <Check size={14} strokeWidth={2.5} />Got it
            </motion.button>
          ) : myAck ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-[#2f7a45]"><Check size={13} strokeWidth={2.5} />You confirmed · {clock(myAck.at)}</span>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
}

const BARS = 40;
function VoiceBubble({ m, player }: { m: TalkMessage; player: RadioPlayer }) {
  const isPlaying = player.playing === m.id;
  const total = isPlaying && player.duration ? player.duration * 1000 : m.durationMs ?? 0;
  const shown = isPlaying ? total * player.progress : total;
  const seed = useMemo(() => [...m.id].reduce((a, c) => a + c.charCodeAt(0), 0), [m.id]);
  return (
    <div className="mt-1.5 inline-flex max-w-full items-center gap-3 rounded-[14px] bg-white py-2 pr-4 pl-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.14),0_1px_2px_rgb(23_21_15/.04)]">
      <motion.button type="button" whileTap={{ scale: 0.9 }} transition={spring.snappy} onClick={() => (isPlaying ? player.pause() : void player.play(m))}
        aria-label={isPlaying ? 'Pause' : 'Play voice message'} className="grid size-9 shrink-0 place-items-center rounded-full bg-[#17150f] text-white">
        {isPlaying ? <Pause size={14} className="fill-white" strokeWidth={0} /> : <Play size={14} className="ml-0.5 fill-white" strokeWidth={0} />}
      </motion.button>
      <div className="flex h-7 items-center gap-[2.5px]" aria-hidden>
        {Array.from({ length: BARS }, (_, i) => {
          const h = 5 + Math.abs(Math.sin((i + 1) * 0.9 + seed)) * 14 + (i % 5 === 0 ? 4 : 0);
          const done = isPlaying && i / BARS < player.progress;
          return <span key={i} className="w-[2.5px] rounded-full transition-colors duration-150" style={{ height: h, background: done ? '#17150f' : 'rgb(23 21 15 / .2)' }} />;
        })}
      </div>
      <span className="w-9 shrink-0 text-right text-[12px] font-medium text-fg-3 tabular-nums">{total ? fmtDur(shown) : '0:00'}</span>
    </div>
  );
}

function Composer({ channel, rec, text, setText, sending, onSend, micError, onRetryMic, err, onDismissErr }: {
  channel: Channel; rec: ReturnType<typeof useRecorder>; text: string; setText: (s: string) => void; sending: boolean; onSend: () => void;
  micError: string | null; onRetryMic: () => void; err: string | null; onDismissErr: () => void;
}) {
  const recording = rec.state === 'recording';
  const uploading = rec.state === 'uploading';
  const target = channel.key === 'all-traffic' ? 'Everyone' : channel.label;
  return (
    <div className="shrink-0 border-t border-line-2 bg-white px-6 pt-3 pb-4">
      <div className="mx-auto max-w-[860px]">
        <AnimatePresence>
          {micError || err ? (
            <motion.div key="err" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mb-2.5 flex items-start gap-2.5 rounded-[12px] bg-[#fdf3ea] px-3.5 py-2.5 text-[13px] leading-[19px] text-[#86552e]" role="alert">
              <TriangleAlert size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
              <span className="flex-1">{micError ?? err}</span>
              {micError ? <button type="button" onClick={onRetryMic} className="font-semibold underline-offset-2 hover:underline">Try again</button>
                : <button type="button" onClick={onDismissErr} aria-label="Dismiss"><X size={15} strokeWidth={2} /></button>}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className={cn('flex items-center gap-2 rounded-[16px] p-1.5 transition-shadow',
          recording ? 'bg-[#fff5f5] shadow-[inset_0_0_0_1px_rgb(229_72_77/.45)]' : 'bg-[#fafaf9] shadow-[inset_0_0_0_.5px_rgb(23_21_15/.16)] focus-within:shadow-[inset_0_0_0_1px_rgb(23_21_15/.4)]')}>
          <button type="button" disabled={uploading || !rec.supported}
            onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture?.(e.pointerId); rec.pressStart(); }}
            onPointerUp={rec.pressEnd} onPointerCancel={rec.pressEnd}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rec.toggle(); } }}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={recording ? 'Release to send' : `Hold to talk to ${target}`} aria-pressed={recording}
            className={cn('relative inline-flex h-11 shrink-0 touch-none items-center gap-2 rounded-[12px] px-4 text-[14px] font-semibold text-white transition-[background-color,transform] duration-150 select-none active:scale-[.98] disabled:opacity-40',
              recording ? 'bg-[#e5484d]' : 'bg-[#17150f]')}>
            {uploading ? <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : recording ? <Square size={14} className="fill-white" strokeWidth={0} /> : <Mic size={17} strokeWidth={2} />}
            {uploading ? 'Sending…' : recording ? fmtDur(rec.elapsed) : 'Hold to talk'}
            {recording ? <Level level={rec.level} /> : null}
          </button>
          {recording ? (
            <p className="flex-1 truncate px-2 text-[14px] text-[#b42318]">Recording to <b>{target}</b> · release to send · <span className="text-fg-3">Esc cancels</span></p>
          ) : (
            <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${target}`} aria-label="Message" maxLength={1000}
                className="h-11 min-w-0 flex-1 bg-transparent px-2 text-[15px] text-fg outline-none placeholder:text-fg-3" />
              <button type="submit" disabled={!text.trim() || sending || uploading} aria-label="Send"
                className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#17150f] text-white transition-opacity disabled:opacity-25">
                {sending ? <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <ArrowUp size={17} strokeWidth={2.25} />}
              </button>
            </form>
          )}
        </div>
        <p className="mt-2 text-[12px] text-fg-3">Hold <Kbd>Space</Kbd> to talk anywhere on this page · <Kbd>Enter</Kbd> sends text · voice is transcribed and linked to issues automatically</p>
      </div>
    </div>
  );
}

function Level({ level }: { level: number }) {
  return (
    <span className="ml-1 flex h-4 items-center gap-[2px]" aria-hidden>
      {[0.5, 0.8, 1, 0.8, 0.5].map((k, i) => (
        <span key={i} className="w-[3px] rounded-full bg-white/90 transition-[height] duration-75" style={{ height: 3 + Math.min(1, level * 1.6) * 13 * k }} />
      ))}
    </span>
  );
}

function WaitGroup({ title, tone, items, me, now, snap, onOpen, onAck }: {
  title: string; tone: 'amber' | 'red'; items: TalkMessage[]; me: Me; now: number; snap?: Snapshot; onOpen: (m: TalkMessage) => void; onAck?: (m: TalkMessage) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-2 pb-1.5">
        <span className="size-1.5 rounded-full" style={{ background: tone === 'amber' ? '#e8a33d' : '#e5484d' }} />
        <span className="text-[12px] font-semibold text-fg-2">{title}</span>
        <span className="text-[12px] text-fg-3 tabular-nums">{items.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.slice(0, 12).map((m) => {
          const { expected, acks } = heard(m);
          const missing = snap ? expected.filter((id) => !acks.some((a) => a.participantId === id)).map((id) => snap.participants.find((p) => p.id === id)?.displayName).filter(Boolean) : [];
          const overdue = isOverdue(m, now);
          return (
            <li key={m.id}>
              <div role="button" tabIndex={0} onClick={() => onOpen(m)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(m); }}
                className="block cursor-pointer rounded-[10px] px-2.5 py-2 hover:bg-[#f6f6f4]">
                <div className="flex items-center gap-1.5 text-[12px]">
                  <span className="font-semibold text-fg">{m.fromId === me.participantId ? 'You' : m.fromName}</span>
                  <span className="text-fg-3">→ {m.to.label}</span>
                  <span className={cn('ml-auto tabular-nums', overdue ? 'font-semibold text-[#b91c1c]' : 'text-fg-3')}>{ago(m.createdAt, now)}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-fg-2">{m.text}</p>
                {missing.length ? <p className="mt-1 truncate text-[11px] text-fg-3">Waiting for {missing.join(', ')}</p> : null}
                {onAck ? (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onAck(m); }}
                    className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-full bg-[#17150f] px-2.5 text-[12px] font-semibold text-white">
                    <Check size={12} strokeWidth={2.5} />Got it
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-dvh">
      <div className="hidden w-[264px] border-r border-line-2 bg-white p-5 lg:block"><div className="h-7 w-24 animate-pulse rounded-[8px] bg-wash-2" /></div>
      <div className="flex-1 p-8"><div className="h-6 w-40 animate-pulse rounded-[8px] bg-wash-2" /></div>
    </div>
  );
}
