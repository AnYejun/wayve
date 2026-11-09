// Assistant — the staff AI with the whole event in context (issues, reports, meetings, radio, zones, devices, run-of-show).
// Type or talk. Answers cite their sources; clear commands ("mark WV-3 done") act through the same rules as radio.
// Voice: click the mic, speak, click again — the answer is spoken back. Hands-free keeps the conversation going.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowUp, Check, CircleAlert, Clock, Lightbulb, ListChecks, Mic, Plus, RotateCcw, Square, TrendingUp, Volume2, X,
} from 'lucide-react';
import type { Citation, Snapshot } from '@shared/contracts';
import { clock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { rise, spring } from '@/design/motion';
import { WaveMark } from '@/design/Logo';
import { AiTag } from '@/components/bits';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { useAssistant, type Turn } from '@/comms/assistant';
import { fmtDur, useRecorder } from '@/comms/recorder';
import { useShell } from '../context';
import { useNavigate } from 'react-router';
import { IssueCard, InlineMapCard, RevealMarkdown } from '@/components/chat/parts';

const SUGGESTIONS: Array<{ q: string; icon: typeof Lightbulb; hint: string }> = [
  { q: 'What needs attention right now?', icon: CircleAlert, hint: 'Urgent, overdue and unheard' },
  { q: "What's blocked and who owns it?", icon: ListChecks, hint: 'Blocked issues with owners' },
  { q: 'Summarize the last 30 minutes', icon: Clock, hint: 'Meetings, radio and reports' },
  { q: 'Which zones are busiest?', icon: TrendingUp, hint: 'Crowd and queues by zone' },
];

export default function AssistantSection() {
  const { snap, eventId } = useShell();
  const reduced = useReducedMotion();
  const [text, setText] = useState('');
  const [handsFree, setHandsFree] = useState(false);
  const [speakAnswers, setSpeakAnswers] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;
  const startRef = useRef<() => void>(() => {});
  // Leaving the page must end hands-free: unmount stops speech, which would otherwise re-arm an unowned mic.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; handsFreeRef.current = false; }; }, []);
  const asst = useAssistant(eventId, { onSpeechEnd: () => {
    if (alive.current && handsFreeRef.current) setTimeout(() => { if (alive.current && handsFreeRef.current) startRef.current(); }, 400);
  } });
  const rec = useRecorder({
    maxMs: 45_000,
    onBlob: async (blob) => { await asst.askVoice(blob, { speak: true }); },
    onDenied: (m) => { setMicError(m); setHandsFree(false); },
  });
  startRef.current = () => { void rec.start(); };
  const recording = rec.state === 'recording';
  const newestId = asst.turns[asst.turns.length - 1]?.id;

  // ⌘K / Ctrl+K focuses the composer; Esc cancels a recording or stops speech
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.key === 'Escape') { if (rec.state === 'recording') rec.cancel(); else if (asst.speaking) asst.stop(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rec, asst]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: asst.turns.length > 1 ? 'smooth' : 'auto' }); }, [asst.turns]);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }, [text]);

  const send = (q?: string) => {
    const v = (q ?? text).trim();
    if (!v || asst.busy) return;
    setText('');
    void asst.ask(v, { speak: speakAnswers });
  };
  const micClick = () => {
    setMicError(null);
    if (asst.speaking) { asst.stop(); return; }
    if (recording) rec.stop(); else void rec.start();
  };

  const context = useMemo(() => {
    if (!snap) return null;
    const since = Date.now() - 40 * 60_000;
    return {
      issues: snap.issues.filter((i) => i.status !== 'done').length,
      reports: snap.reports.length,
      lines: snap.utterances.filter((u) => u.startedAt >= since).length,
      zones: snap.zones.length,
      devices: snap.devices.length,
    };
  }, [snap]);

  return (
    <div className="flex h-[calc(100dvh-48px)] min-h-0 bg-[#fcfcfb] md:h-dvh">
      {/* conversation history (this browser tab) */}
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-line-2 bg-[#fafaf9] lg:flex" aria-label="Conversations">
        <div className="p-3">
          <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={asst.newChat}
            className="flex h-10 w-full items-center gap-2 rounded-[10px] bg-white px-3 text-[14px] font-semibold text-fg shadow-[inset_0_0_0_.5px_rgb(23_21_15/.16)] hover:shadow-[inset_0_0_0_.5px_rgb(23_21_15/.3)]">
            <Plus size={16} strokeWidth={2} />New chat
          </motion.button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {asst.turns.length ? (
            <div className="mb-1 flex items-center gap-2 rounded-[8px] bg-white px-2.5 py-2 shadow-[0_1px_2px_rgb(23_21_15/.05),0_0_0_.5px_rgb(23_21_15/.1)]">
              <span className="size-1.5 shrink-0 rounded-full bg-[#58a069]" />
              <span className="min-w-0 truncate text-[13px] font-medium text-fg">{asst.turns[0].q || 'Current chat'}</span>
            </div>
          ) : null}
          {asst.chats.length ? <div className="px-2.5 pt-3 pb-1.5 text-[11px] font-semibold tracking-[.06em] text-fg-3 uppercase">Earlier</div> : null}
          {asst.chats.map((c) => (
            <button key={c.id} type="button" onClick={() => asst.openChat(c.id)}
              className="flex w-full flex-col rounded-[8px] px-2.5 py-2 text-left hover:bg-[rgb(23_21_15/.04)]">
              <span className="truncate text-[13px] text-fg-2">{c.title}</span>
              <span className="text-[11.5px] text-fg-3 tabular-nums">{clock(c.at)} · {c.turns.length} {c.turns.length === 1 ? 'question' : 'questions'}</span>
            </button>
          ))}
          {!asst.turns.length && !asst.chats.length ? <p className="px-2.5 pt-2 text-[12.5px] leading-[18px] text-fg-3">Your conversations in this tab show up here.</p> : null}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line-2 bg-white/90 px-6 backdrop-blur">
        <span className="grid size-8 place-items-center rounded-[10px] bg-[#17150f] text-white"><WaveMark size={13} /></span>
        <div className="min-w-0">
          <h1 className="text-[16px] font-semibold text-fg">Assistant</h1>
          <p className="truncate text-[12px] text-fg-3">Sees every issue, report, meeting and radio call as it happens</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {snap?.ai.textModel ? <AiTag model={snap.ai.textModel} /> : null}
          {asst.turns.length ? (
            <button type="button" onClick={asst.newChat} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium text-fg-2 hover:bg-wash-1 hover:text-fg lg:hidden">
              <Plus size={15} strokeWidth={2} />New chat
            </button>
          ) : null}
        </div>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-6 pt-10 pb-8">
          {snap && !snap.ai.enabled ? (
            <div className="mb-6 flex items-start gap-2.5 rounded-[12px] bg-[#fdf3ea] px-4 py-3 text-[14px] text-[#86552e]">
              <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" />The AI is turned off for this event, so the assistant can't answer yet.
            </div>
          ) : null}
          {asst.turns.length === 0 ? (
            <motion.div variants={rise} initial="initial" animate="animate">
              <h2 className="text-[32px] leading-[38px] font-semibold tracking-[-0.03em] text-fg">What do you need to know?</h2>
              <p className="mt-2 max-w-[560px] text-[16px] leading-6 text-fg-2">Ask about anything happening on site. It can also act for you — "assign the badge printing to Jimin", "mark WV-3 done".</p>
              {context ? (
                <div className="mt-5 flex flex-wrap gap-2 text-[12px] text-fg-2">
                  {[[context.issues, 'open issues'], [context.reports, 'reports'], [context.lines, 'lines said in the last 40 min'], [context.zones, 'zones'], [context.devices, 'devices']].map(([n, l]) => (
                    <span key={String(l)} className="inline-flex h-7 items-center gap-1 rounded-full bg-white px-2.5 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.14)]">
                      <b className="font-semibold text-fg tabular-nums">{n}</b>{l}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {SUGGESTIONS.map((s, i) => (
                  <motion.button key={s.q} type="button" onClick={() => send(s.q)} disabled={asst.busy}
                    initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.05 + i * 0.04 }}
                    whileHover={reduced ? undefined : { y: -2 }} whileTap={{ scale: 0.985 }}
                    className="group flex items-start gap-3 rounded-[16px] bg-white p-4 text-left shadow-[inset_0_0_0_.5px_rgb(23_21_15/.14),0_1px_2px_rgb(23_21_15/.04)] transition-shadow hover:shadow-[inset_0_0_0_.5px_rgb(23_21_15/.24),0_8px_24px_-12px_rgb(23_21_15/.18)] disabled:opacity-50">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[#f3f3f1] text-fg-2 group-hover:text-fg"><s.icon size={16} strokeWidth={1.75} /></span>
                    <span>
                      <span className="block text-[15px] font-semibold text-fg">{s.q}</span>
                      <span className="mt-0.5 block text-[13px] text-fg-3">{s.hint}</span>
                    </span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          ) : (
            <ol className="flex flex-col gap-8">
              <AnimatePresence initial={false}>
                {asst.turns.map((t) => (
                  <TurnView key={t.id} t={t} snap={snap} eventId={eventId} animateIn={t.id === newestId} speaking={asst.speaking && t.id === newestId}
                    onStop={asst.stop} onRetry={() => asst.retry(t)} />
                ))}
              </AnimatePresence>
            </ol>
          )}
        </div>
      </div>

      {/* composer */}
      <div className="shrink-0 px-6 pb-5">
        <div className="mx-auto w-full max-w-[760px]">
          <AnimatePresence>
            {micError ? (
              <motion.div key="mic" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mb-2 flex items-start gap-2.5 rounded-[12px] bg-[#fdf3ea] px-3.5 py-2.5 text-[13px] leading-[19px] text-[#86552e]" role="alert">
                <CircleAlert size={15} strokeWidth={2} className="mt-0.5 shrink-0" /><span className="flex-1">{micError}</span>
                <button type="button" onClick={() => setMicError(null)} aria-label="Dismiss"><X size={15} strokeWidth={2} /></button>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <form onSubmit={(e) => { e.preventDefault(); send(); }}
            className={cn('rounded-[20px] bg-white p-2 transition-shadow',
              recording ? 'shadow-[inset_0_0_0_1px_rgb(229_72_77/.5),0_8px_30px_-12px_rgb(229_72_77/.35)]'
                : 'shadow-[inset_0_0_0_.5px_rgb(23_21_15/.18),0_8px_30px_-16px_rgb(23_21_15/.25)] focus-within:shadow-[inset_0_0_0_1px_rgb(23_21_15/.45),0_8px_30px_-16px_rgb(23_21_15/.25)]')}>
            {recording ? (
              <div className="flex h-[52px] items-center gap-3 px-3">
                <Wave level={rec.level} active />
                <span className="text-[14px] font-semibold text-[#b42318] tabular-nums">{fmtDur(rec.elapsed)}</span>
                <span className="text-[14px] text-fg-2">Listening — click the mic to send · Esc cancels</span>
              </div>
            ) : (
              <textarea ref={inputRef} value={text} rows={1} onChange={(e) => setText(e.target.value)} maxLength={500}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                placeholder={asst.busy ? 'Thinking…' : 'Ask anything about the event'} aria-label="Message"
                className="block max-h-[180px] min-h-[52px] w-full resize-none bg-transparent px-3 py-3.5 text-[15px] leading-[22px] text-fg outline-none placeholder:text-fg-3" />
            )}
            <div className="flex items-center gap-2 px-1.5 pb-0.5">
              <label className="inline-flex h-8 items-center gap-2 rounded-[8px] px-2 text-[13px] font-medium text-fg-2">
                <Switch checked={speakAnswers} onCheckedChange={setSpeakAnswers} aria-label="Speak answers" />
                <Volume2 size={14} strokeWidth={1.75} />Speak answers
              </label>
              <label className="inline-flex h-8 items-center gap-2 rounded-[8px] px-2 text-[13px] font-medium text-fg-2">
                <Switch checked={handsFree} onCheckedChange={(v) => { setHandsFree(v); if (v && rec.state === 'idle' && !asst.busy) void rec.start(); }} aria-label="Hands-free voice" />
                Hands-free
              </label>
              <div className="ml-auto flex items-center gap-1.5">
                <motion.button type="button" onClick={micClick} whileTap={{ scale: 0.92 }} transition={spring.snappy} disabled={!rec.supported || rec.state === 'uploading'}
                  aria-label={recording ? 'Send voice question' : asst.speaking ? 'Stop speaking' : 'Ask by voice'}
                  className={cn('grid size-9 place-items-center rounded-full transition-colors disabled:opacity-35',
                    recording ? 'bg-[#e5484d] text-white' : asst.speaking ? 'bg-[#17150f] text-white' : 'text-fg-2 hover:bg-wash-1 hover:text-fg')}>
                  {rec.state === 'uploading' ? <span className="size-4 animate-spin rounded-full border-2 border-fg-3/30 border-t-fg-2" />
                    : recording || asst.speaking ? <Square size={13} className="fill-current" strokeWidth={0} /> : <Mic size={18} strokeWidth={1.9} />}
                </motion.button>
                <motion.button type="submit" whileTap={{ scale: 0.92 }} transition={spring.snappy} disabled={!text.trim() || asst.busy || recording} aria-label="Send"
                  className="grid size-9 place-items-center rounded-full bg-[#17150f] text-white transition-opacity disabled:opacity-20">
                  {asst.busy && !recording ? <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <ArrowUp size={18} strokeWidth={2.25} />}
                </motion.button>
              </div>
            </div>
          </form>
          <p className="mt-2 text-center text-[12px] text-fg-3">Enter to send · Shift+Enter for a new line · ⌘K to focus · answers come from live event data</p>
        </div>
      </div>
      </div>
    </div>
  );
}

function TurnView({ t, snap, eventId, animateIn, speaking, onStop, onRetry }: {
  t: Turn; snap: Snapshot | null; eventId: string; animateIn: boolean; speaking: boolean; onStop: () => void; onRetry: () => void;
}) {
  const nav = useNavigate();
  const openIssue = (keyOrId: string) => {
    const i = snap?.issues.find((x) => x.id === keyOrId || x.key === keyOrId);
    nav(`/e/${eventId}/dashboard${i ? `?issue=${i.id}` : ''}`);
  };
  const focus = t.res?.focus;
  const focusIssues = snap && focus ? focus.issueIds.map((id) => snap.issues.find((i) => i.id === id)).filter((i): i is NonNullable<typeof i> => !!i) : [];
  const showMap = !!snap && !!focus && snap.zones.length > 0 && (focus.zoneIds.length > 0 || focus.deviceIds.length > 0);
  return (
    <motion.li variants={rise} initial="initial" animate="animate" exit="exit" className="flex flex-col gap-4">
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-[20px] bg-[#f0efec] px-4 py-2.5 text-[15px] leading-[22px] whitespace-pre-wrap text-fg">
          {t.voice ? <Mic size={13} strokeWidth={2.2} className="mr-1.5 inline align-[-1px] text-fg-3" /> : null}{t.q}
        </p>
      </div>
      <div className="flex gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[#17150f] text-white"><WaveMark size={10} /></span>
        <div className="min-w-0 flex-1">
          {t.err ? (
            <div className="flex items-center gap-3">
              <p className="text-[15px] text-[#b42318]">{t.err}</p>
              {!t.voice ? <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-[13px] font-semibold text-fg-2 hover:text-fg"><RotateCcw size={13} strokeWidth={2} />Retry</button> : null}
            </div>
          ) : !t.res ? (
            <div className="flex items-center gap-2 py-1 text-[14px] text-fg-3">
              <span className="typing" aria-hidden><i /><i /><i /></span>
              {snap ? `Reading ${snap.issues.filter((i) => i.status !== 'done').length} open issues, ${snap.reports.length} reports and the latest radio…` : 'Thinking…'}
            </div>
          ) : (
            <>
              <RevealMarkdown text={t.res.answer} animate={animateIn} onIssue={openIssue} className="text-[15.5px] leading-[25px]" />
              {showMap ? (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: animateIn ? 0.25 : 0 }} className="mt-4">
                  <InlineMapCard snap={snap!} zoneIds={focus!.zoneIds} issueIds={focus!.issueIds} deviceIds={focus!.deviceIds} height={248}
                    onOpenZone={(id) => nav(`/e/${eventId}/map?zone=${id}`)} />
                </motion.div>
              ) : null}
              {focusIssues.length ? (
                <div className={cn('mt-3 grid gap-2', focusIssues.length > 1 ? 'sm:grid-cols-2' : '')}>
                  {focusIssues.slice(0, 4).map((i) => <IssueCard key={i.id} issue={i} snap={snap!} onOpen={(x) => openIssue(x.id)} />)}
                </div>
              ) : null}
              {speaking ? (
                <div className="mt-3 inline-flex items-center gap-3 rounded-full bg-white py-1.5 pr-1.5 pl-3 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.14)]">
                  <Wave level={0.6} active small />
                  <span className="text-[13px] font-medium text-fg-2">Speaking</span>
                  <button type="button" onClick={onStop} className="inline-flex h-7 items-center gap-1 rounded-full bg-[#17150f] px-2.5 text-[12px] font-semibold text-white"><Square size={10} className="fill-white" strokeWidth={0} />Stop</button>
                </div>
              ) : null}
              {t.res.actions.length ? (
                <div className="mt-3 flex flex-col gap-1.5">
                  {t.res.actions.map((a, i) => (
                    <span key={i} className={cn('inline-flex items-center gap-1.5 self-start rounded-[10px] px-3 py-2 text-[13px] font-semibold',
                      a.applied ? 'bg-[#ecf7ef] text-[#2f7a45]' : 'bg-[#fdf6e8] text-[#8a5a12]')}>
                      {a.applied ? <Check size={14} strokeWidth={2.5} /> : <Lightbulb size={14} strokeWidth={2} />}
                      {a.applied ? a.summary : `Suggested: ${a.summary}`}
                      {a.issueKey ? <a href={`/e/${eventId}/dashboard`} className="ml-1 font-mono text-[11px] opacity-70 hover:opacity-100">{a.issueKey}</a> : null}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {t.res.citations.map((c) => <CitationChip key={`${c.type}:${c.id}`} c={c} snap={snap} eventId={eventId} />)}
                <span className="ml-auto text-[12px] text-fg-3 tabular-nums">{clock(t.at)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </motion.li>
  );
}

/** Streaming-feel reveal: words appear quickly for the newest answer; older answers render instantly. */
function Reveal({ text, animate }: { text: string; animate: boolean }) {
  const reduced = useReducedMotion();
  const words = useMemo(() => text.split(/(\s+)/), [text]);
  const [n, setN] = useState(animate && !reduced ? 0 : words.length);
  useEffect(() => {
    if (!animate || reduced) { setN(words.length); return; }
    setN(0);
    const step = Math.max(1, Math.round(words.length / 60));
    const t = setInterval(() => setN((v) => { if (v >= words.length) { clearInterval(t); return v; } return v + step; }), 18);
    return () => clearInterval(t);
  }, [words, animate, reduced]);
  return (
    <p className="text-[15.5px] leading-[25px] whitespace-pre-wrap text-fg">
      {words.slice(0, n).join('')}
      {n < words.length ? <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-fg-3" aria-hidden /> : null}
    </p>
  );
}

function CitationChip({ c, snap, eventId }: { c: Citation; snap: Snapshot | null; eventId: string }) {
  const chip = 'inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-white px-2 text-[12px] font-medium text-fg-2 shadow-[inset_0_0_0_.5px_rgb(23_21_15/.18)] transition-colors hover:text-fg hover:shadow-[inset_0_0_0_.5px_rgb(23_21_15/.32)]';
  if (c.type === 'issue') {
    const issue = snap?.issues.find((i) => i.id === c.id || i.key === c.label);
    return (
      <a href={`/e/${eventId}/dashboard${issue ? `?issue=${issue.id}` : ''}`} className={chip} title={c.text}>
        <span className="font-mono text-[11px] font-semibold">{c.label}</span>
        <span className="max-w-[200px] truncate text-fg-3">{issue?.title ?? c.text}</span>
      </a>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={chip}>
          <Mic size={12} strokeWidth={2} className="text-fg-3" />{c.at ? `${clock(c.at)} · ` : ''}{c.label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-4" align="start">
        <p className="text-[12px] font-medium text-fg-3">{c.label}{c.at ? ` · ${clock(c.at)}` : ''}</p>
        <blockquote className="mt-1.5 border-l-2 border-line-3 pl-3 text-[14px] leading-[21px] text-fg">“{c.text}”</blockquote>
      </PopoverContent>
    </Popover>
  );
}

/** Calm waveform: bars breathe with the mic level (listening) or a soft pulse (speaking). */
function Wave({ level, active, small }: { level: number; active: boolean; small?: boolean }) {
  const reduced = useReducedMotion();
  const n = small ? 9 : 15;
  const h = small ? 14 : 26;
  return (
    <span className={cn('flex items-center gap-[3px]', small ? 'h-4' : 'h-7')} aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const k = 1 - Math.abs(i - (n - 1) / 2) / (n / 2 + 1);
        return (
          <motion.span key={i} className="w-[3px] rounded-full bg-[#17150f]"
            animate={active && !reduced ? { height: [3, 3 + h * k * Math.max(0.3, level), 3] } : { height: 3 }}
            transition={active && !reduced ? { duration: 0.8 + (i % 3) * 0.12, repeat: Infinity, ease: 'easeInOut', delay: i * 0.035 } : { duration: 0.2 }} />
        );
      })}
    </span>
  );
}
