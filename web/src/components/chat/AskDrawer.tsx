// "Ask WAYVE" — the assistant on every shell screen. ⌘K / Ctrl+K or the floating pill opens a right-side drawer; anything
// can open it with a question via `askWayve(q)` (window event). Same conversation as the Assistant page (shared session).
// Answers carry inline maps (zones they talk about), issue cards, receipts and sources.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CircleAlert, Clock, Expand, ListChecks, Mic, Plus, RotateCcw, TrendingUp, X } from 'lucide-react';
import { useAssistant } from '@/comms/assistant';
import { useRecorder } from '@/comms/recorder';
import { WaveMark } from '@/design/Logo';
import { spring } from '@/design/motion';
import { useShell } from '@/shell/context';
import { AnswerAttachments, Composer, RevealMarkdown, SuggestionGrid, Thinking } from './parts';

const EVT = 'wayve:ask';
/** Open the Ask drawer (optionally asking `q` right away). Safe to call from anywhere in the shell. */
export function askWayve(q?: string) {
  window.dispatchEvent(new CustomEvent(EVT, { detail: { q: q ?? '' } }));
}

const SUGGESTIONS = [
  { q: 'What needs attention right now?', hint: 'Urgent, overdue, unheard', icon: CircleAlert },
  { q: 'Which zones are busiest right now?', hint: 'Shown on the map', icon: TrendingUp },
  { q: "What's blocked and who owns it?", hint: 'Owners and next steps', icon: ListChecks },
  { q: 'Summarize the last 30 minutes', hint: 'Meetings, radio, reports', icon: Clock },
];

export function AskDrawer({ section }: { section: string }) {
  const { snap, eventId } = useShell();
  const nav = useNavigate();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [micErr, setMicErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const asst = useAssistant(eventId);
  const rec = useRecorder({ maxMs: 45_000, onBlob: async (b) => { await asst.askVoice(b, { speak: true }); }, onDenied: (m) => setMicErr(m) });
  const onAssistantPage = section === 'assistant';
  const newestId = asst.turns[asst.turns.length - 1]?.id;

  // ⌘K toggles (the Assistant page owns ⌘K itself), Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !onAssistantPage) { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === 'Escape' && open) { if (rec.state === 'recording') rec.cancel(); else setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onAssistantPage, rec]);
  useEffect(() => {
    const on = (e: Event) => {
      const q = ((e as CustomEvent<{ q: string }>).detail?.q ?? '').trim();
      setOpen(true);
      if (q) void asst.ask(q);
    };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, [asst]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 120); }, [open]);
  // Closing the drawer (X, scrim, ⌘K, "Open full view") ends a recording instead of sending it 45 s later.
  const recRef = useRef(rec); recRef.current = rec;
  const asstRef = useRef(asst); asstRef.current = asst;
  useEffect(() => { if (!open) { if (recRef.current.state === 'recording') recRef.current.cancel(); asstRef.current.stop(); } }, [open]);
  useEffect(() => () => { if (recRef.current.state === 'recording') recRef.current.cancel(); }, []);
  useEffect(() => { if (onAssistantPage) setOpen(false); }, [onAssistantPage]);
  // Keep the newest exchange's question at the top of the view, so its answer (and map) reads from the start.
  useEffect(() => {
    const list = listRef.current;
    const last = list?.querySelector<HTMLElement>('li[data-turn]:last-of-type');
    if (!list) return;
    if (last) list.scrollTo({ top: Math.max(0, last.offsetTop - 16), behavior: 'smooth' });
    else list.scrollTo({ top: 0 });
  }, [asst.turns.length, open]);

  const send = (q?: string) => {
    const v = (q ?? text).trim();
    if (!v || asst.busy) return;
    setText('');
    void asst.ask(v);
  };
  const go = (path: string) => { nav(`/e/${eventId}/${path}`); };
  const openIssue = (keyOrId: string) => {
    const i = snap?.issues.find((x) => x.id === keyOrId || x.key === keyOrId);
    go(`dashboard${i ? `?issue=${i.id}` : ''}`);
  };

  return (
    <>
      <AnimatePresence>
        {!open && !onAssistantPage ? (
          <motion.button key="pill" type="button" onClick={() => setOpen(true)}
            initial={reduced ? false : { opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={spring.smooth} whileHover={reduced ? undefined : { y: -2 }} whileTap={{ scale: 0.97 }}
            className="fixed right-6 bottom-6 z-40 hidden h-11 items-center gap-2.5 rounded-full bg-[#17150f] pr-2 pl-4 text-[14px] font-semibold text-white shadow-[0_14px_34px_-12px_rgb(23_21_15/.6)] md:inline-flex">
            <WaveMark size={12} />Ask WAYVE
            <kbd className="rounded-[7px] bg-white/14 px-1.5 py-0.5 font-sans text-[11.5px] font-medium text-white/80">⌘K</kbd>
          </motion.button>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div key="scrim" className="fixed inset-0 z-40 bg-[rgb(23_21_15/.08)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside key="panel" role="dialog" aria-label="Ask WAYVE"
              initial={reduced ? { opacity: 0 } : { x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={reduced ? { opacity: 0 } : { x: 32, opacity: 0 }}
              transition={spring.sheet}
              className="fixed top-3 right-3 bottom-3 z-50 flex w-[min(460px,calc(100vw-24px))] flex-col overflow-hidden rounded-[22px] bg-[#fcfcfb] shadow-[0_0_0_.5px_rgb(23_21_15/.12),0_30px_80px_-24px_rgb(23_21_15/.45)]">
              <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-[rgb(23_21_15/.07)] bg-white/90 px-4 backdrop-blur">
                <span className="grid size-7 place-items-center rounded-[9px] bg-[#17150f] text-white"><WaveMark size={11} /></span>
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold text-fg">Ask WAYVE</p>
                  <p className="truncate text-[11.5px] text-fg-3">{snap ? `${snap.event.name} · live` : 'Live event context'}</p>
                </div>
                <div className="ml-auto flex items-center gap-0.5">
                  {asst.turns.length ? (
                    <button type="button" onClick={asst.newChat} title="New chat" className="grid size-8 place-items-center rounded-[8px] text-fg-2 hover:bg-[rgb(23_21_15/.05)] hover:text-fg"><Plus size={16} strokeWidth={2} /></button>
                  ) : null}
                  <button type="button" onClick={() => { setOpen(false); go('assistant'); }} title="Open full view" className="grid size-8 place-items-center rounded-[8px] text-fg-2 hover:bg-[rgb(23_21_15/.05)] hover:text-fg"><Expand size={15} strokeWidth={2} /></button>
                  <button type="button" onClick={() => setOpen(false)} title="Close (Esc)" className="grid size-8 place-items-center rounded-[8px] text-fg-2 hover:bg-[rgb(23_21_15/.05)] hover:text-fg"><X size={16} strokeWidth={2} /></button>
                </div>
              </header>

              <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-4">
                {asst.turns.length === 0 ? (
                  <div>
                    <p className="text-[22px] leading-[28px] font-semibold tracking-[-0.02em] text-fg">What do you need to know?</p>
                    <p className="mt-1.5 text-[13.5px] leading-[20px] text-fg-2">It sees every issue, report, meeting, radio call, zone and device — live. Places show up on the map.</p>
                    <div className="mt-5"><SuggestionGrid items={SUGGESTIONS} onPick={(q) => send(q)} disabled={asst.busy} columns={1} /></div>
                  </div>
                ) : (
                  <ol className="flex flex-col gap-6">
                    {asst.turns.map((t) => (
                      <motion.li key={t.id} data-turn initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth} className="flex flex-col gap-3">
                        <p className="max-w-[88%] self-end rounded-[18px] bg-[#efeeeb] px-3.5 py-2 text-[14.5px] leading-[21px] whitespace-pre-wrap text-fg">
                          {t.voice ? <Mic size={12} strokeWidth={2.2} className="mr-1 inline align-[-1px] text-fg-3" /> : null}{t.q}
                        </p>
                        {t.err ? (
                          <div className="flex items-center gap-3 text-[14px]">
                            <span className="text-[#b42318]">{t.err}</span>
                            {!t.voice ? <button type="button" onClick={() => asst.retry(t)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-fg-2 hover:text-fg"><RotateCcw size={12} strokeWidth={2} />Retry</button> : null}
                          </div>
                        ) : !t.res ? (
                          <Thinking label={snap ? 'Reading the live event' : 'Thinking'} />
                        ) : (
                          <div>
                            <RevealMarkdown text={t.res.answer} animate={t.id === newestId} onIssue={openIssue} className="text-[14.5px] leading-[23px]" />
                            <AnswerAttachments res={t.res} snap={snap} compact nav={{ onOpenIssue: (i) => openIssue(i.id), onOpenZone: (id) => { setOpen(false); go(`map?zone=${id}`); } }} />
                          </div>
                        )}
                      </motion.li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="shrink-0 px-3 pb-3">
                {micErr ? (
                  <p className="mb-2 flex items-start gap-2 rounded-[12px] bg-[#fdf3ea] px-3 py-2 text-[12.5px] text-[#86552e]" role="alert">
                    <CircleAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0" />{micErr}
                  </p>
                ) : null}
                <Composer value={text} onChange={setText} onSend={() => send()} busy={asst.busy} inputRef={inputRef}
                  placeholder={rec.state === 'recording' ? 'Listening… click the mic to send' : 'Ask anything about the event…'}
                  recording={rec.state === 'recording'} micLevel={rec.level}
                  onMic={rec.supported ? () => { setMicErr(null); if (asst.speaking) asst.stop(); else if (rec.state === 'recording') rec.stop(); else void rec.start(); } : undefined} />
                <p className="mt-1.5 text-center text-[11px] text-fg-3">Enter to send · Esc to close · answers come from live event data</p>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}

