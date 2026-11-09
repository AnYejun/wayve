// Staff assistant: knows everything live on site (issues, reports, meetings, radio, zones, run-of-show).
// Chat: type → answer with citations + action receipts. Voice: tap to talk → it answers out loud (server TTS → /api/tts →
// speechSynthesis fallback). Hands-free keeps listening after each answer. Clear commands ("mark WV-3 done") act via rules.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Check, Keyboard, Lightbulb, Mic, Square, X } from 'lucide-react';
import type { Citation, Issue, Me, Snapshot } from '@shared/contracts';
import { useAssistant } from '@/comms/assistant';
import { clock } from '@/lib/time';
import { cn } from '@/lib/utils';
import { rise, spring } from '@/design/motion';
import { AiTag } from '@/components/bits';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { HAIR, Spinner } from '../common';
import { useTalkRecorder } from '../ops/recorder';
import { haptic } from './shell';
import { AnswerAttachments, RevealMarkdown } from '@/components/chat/parts';

const SUGGESTIONS = ['What needs me right now?', 'Which zones are busiest?', "What's blocked?", 'When does the keynote start?'];

export function AssistantSheet({ open, onOpenChange, snap, me, onOpenIssue, initialMode = 'voice' }: {
  open: boolean; onOpenChange: (o: boolean) => void; snap: Snapshot | null; me: Me; onOpenIssue: (i: Issue) => void; initialMode?: 'voice' | 'chat';
}) {
  const [mode, setMode] = useState<'voice' | 'chat'>(initialMode);
  const [text, setText] = useState('');
  const [handsFree, setHandsFree] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;
  const openRef = useRef(open);
  openRef.current = open;
  const toggleRef = useRef<() => void>(() => {});
  const asst = useAssistant(me.eventId, { onSpeechEnd: () => { if (handsFreeRef.current && openRef.current) setTimeout(() => toggleRef.current(), 350); } });
  const { turns, busy, speaking } = asst;

  useEffect(() => { if (open) setMode(initialMode); else { asst.stop(); setHandsFree(false); } }, [open, initialMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [turns]);

  const ask = async (q: string, audio?: Blob) => {
    const res = audio ? await asst.askVoice(audio, { speak: true }) : await asst.ask(q, { speak: mode === 'voice' });
    if (res) haptic(12);
  };
  const rec = useTalkRecorder({ maxMs: 30_000, onBlob: async (blob) => { await ask('', blob); }, onDenied: () => setMode('chat') });
  toggleRef.current = rec.toggle;

  const sendText = () => { const q = text.trim(); if (!q || busy) return; setText(''); void ask(q); };
  const listening = rec.state === 'recording';
  const last = turns[turns.length - 1];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[94dvh] max-h-[94dvh]! bg-[#fafaf9]! [-webkit-backdrop-filter:none]! [backdrop-filter:none]!">
        <div className="flex items-center px-4 pt-1 pb-2">
          <DrawerTitle className="text-[17px] font-bold">Assistant</DrawerTitle>
          <div className="ml-3 inline-flex rounded-full bg-[rgb(23_21_15/.06)] p-[3px]" role="tablist">
            {(['voice', 'chat'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className="relative h-8 rounded-full px-3 text-[13px] font-semibold">
                {mode === m ? <motion.span layoutId="asst-mode" transition={spring.smooth} className="absolute inset-0 rounded-full bg-white shadow-[0_1px_2px_rgb(23_21_15/.1)]" /> : null}
                <span className={cn('relative', mode === m ? 'text-fg' : 'text-fg-2')}>{m === 'voice' ? 'Voice' : 'Chat'}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Close" className="ml-auto grid size-10 place-items-center rounded-full active:bg-[rgb(23_21_15/.05)]"><X className="size-5" strokeWidth={2} /></button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-4 pb-4">
          {turns.length === 0 ? (
            <motion.div variants={rise} initial="initial" animate="animate" className="pt-4">
              <p className="text-[30px] leading-[36px] font-bold tracking-[-0.03em] text-fg">What do you need?</p>
              <p className="mt-2 text-[15px] leading-[22px] text-fg-2">I see every report, meeting, radio call and zone live — and I can update your tasks when you tell me to.</p>
              <div className={cn('mt-5', mode === 'voice' ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2')}>
                {SUGGESTIONS.map((s) => (
                  <motion.button key={s} type="button" whileTap={{ scale: 0.97 }} transition={spring.snappy} onClick={() => { haptic(8); void ask(s); }} disabled={busy}
                    className={cn('flex items-center bg-white text-left text-fg', HAIR, mode === 'voice'
                      ? 'h-10 rounded-full px-4 text-[15px] font-medium'
                      : 'min-h-[52px] gap-3 rounded-[14px] px-4 text-[16px]')}>
                    {mode === 'voice' ? null : <Lightbulb className="size-[18px] text-fg-3" strokeWidth={1.75} />}{s}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="flex flex-col gap-5 pt-2">
              <AnimatePresence initial={false}>
                {turns.map((t) => (
                  <motion.div key={t.id} variants={rise} initial="initial" animate="animate" className="flex flex-col gap-2.5">
                    <p className="max-w-[85%] self-end rounded-[20px] bg-[rgb(23_21_15/.06)] px-4 py-2.5 text-[16px] leading-[23px] text-fg">
                      {t.voice ? <Mic className="mr-1.5 inline size-3.5 align-[-2px] text-fg-3" strokeWidth={2} /> : null}{t.q}
                    </p>
                    {t.err ? <p className="text-[15px] text-[#b91c1c]">{t.err}</p> : !t.res ? (
                      <span className="inline-flex items-center gap-2 py-2 text-[14px] text-fg-3" aria-live="polite"><span className="typing" aria-hidden><i /><i /><i /></span>Reading the live event…</span>
                    ) : (
                      <div>
                        <RevealMarkdown text={t.res.answer} animate={t.id === turns[turns.length - 1]?.id} className="text-[16px] leading-[24px]"
                          onIssue={(k) => { const i = snap?.issues.find((x) => x.key === k || x.id === k); if (i) onOpenIssue(i); }} />
                        {snap && t.res.focus && (t.res.focus.zoneIds.length || t.res.focus.issueIds.length || t.res.focus.deviceIds.length) ? (
                          <AnswerAttachments res={{ ...t.res, actions: [], citations: [] }} snap={snap} compact nav={{ onOpenIssue }} />
                        ) : null}
                        {t.res.actions.length ? (
                          <div className="mt-2 flex flex-col gap-1.5">
                            {t.res.actions.map((a, i) => (
                              <span key={i} className={cn('inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-[13px] font-semibold', a.applied ? 'bg-[#e8f5ec] text-[#2f7a45]' : 'bg-[#fdf3e3] text-[#8a5a12]')}>
                                {a.applied ? <Check className="size-3.5" strokeWidth={2.5} /> : <Lightbulb className="size-3.5" strokeWidth={2} />}
                                {a.applied ? a.summary : `Suggested: ${a.summary}`}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <AiTag model={t.res.model} />
                          {t.res.citations.map((c) => <CitationChip key={`${c.type}:${c.id}`} c={c} snap={snap} onOpenIssue={onOpenIssue} />)}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {mode === 'voice' ? (
          <div className="flex flex-col items-center gap-3 px-4 pt-2 pb-[calc(var(--safe-b)+18px)]">
            <Wave active={listening || speaking} level={listening ? rec.level : speaking ? 0.55 : 0} />
            <motion.button type="button" whileTap={{ scale: 0.94 }} transition={spring.snappy}
              onClick={() => { if (speaking) { asst.stop(); return; } haptic(15); rec.toggle(); }} disabled={busy && !listening}
              aria-label={listening ? 'Stop and send' : speaking ? 'Stop speaking' : 'Tap to talk'}
              className={cn('grid size-[88px] place-items-center rounded-full text-white shadow-[0_12px_28px_-10px_rgb(23_21_15/.5)] disabled:opacity-40', listening ? 'bg-[#e5484d]' : 'bg-[#17150f]')}>
              {busy && !listening ? <Spinner className="size-7 border-white/30 border-t-white" /> : listening || speaking ? <Square className="size-7 fill-white" strokeWidth={0} /> : <Mic className="size-9" strokeWidth={1.75} />}
            </motion.button>
            <p className="h-5 text-[14px] font-medium text-fg-2" aria-live="polite">{listening ? 'Listening… tap to send' : busy ? 'Thinking…' : speaking ? 'Speaking — tap to stop' : last ? 'Tap to ask a follow-up' : 'Tap to talk'}</p>
            <div className="flex items-center gap-2">
              <button type="button" role="switch" aria-checked={handsFree} onClick={() => { haptic(8); setHandsFree((v) => !v); }}
                className={cn('inline-flex h-9 items-center gap-2 rounded-full pr-3.5 pl-1.5 text-[14px] font-semibold transition-colors', handsFree ? 'bg-[#17150f] text-white' : cn('bg-white text-fg-2', HAIR))}>
                <span className={cn('relative h-6 w-10 rounded-full transition-colors', handsFree ? 'bg-white/25' : 'bg-[rgb(23_21_15/.12)]')}>
                  <motion.span layout transition={spring.snappy} className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow-[0_1px_2px_rgb(23_21_15/.25)]', handsFree ? 'right-0.5' : 'left-0.5')} />
                </span>
                Hands-free
              </button>
              <button type="button" onClick={() => setMode('chat')} className={cn('inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[14px] font-semibold text-fg-2', HAIR)}><Keyboard className="size-4" strokeWidth={1.75} />Type</button>
            </div>
          </div>
        ) : (
          <form className="mat-bar px-4 pt-2 pb-[calc(var(--safe-b)+12px)]" onSubmit={(e) => { e.preventDefault(); sendText(); }}>
            <div className={cn('flex items-center gap-2 rounded-full bg-white py-1.5 pr-1.5 pl-4', HAIR)}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about anything on site" aria-label="Message" maxLength={500} enterKeyHint="send"
                className="h-9 min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-3" />
              <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="grid size-9 shrink-0 place-items-center rounded-full bg-[#17150f] text-white disabled:opacity-30">
                {busy ? <Spinner className="size-4 border-white/30 border-t-white" /> : <ArrowUp className="size-[18px]" strokeWidth={2.25} />}
              </button>
            </div>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function CitationChip({ c, snap, onOpenIssue }: { c: Citation; snap: Snapshot | null; onOpenIssue: (i: Issue) => void }) {
  const issue = c.type === 'issue' ? snap?.issues.find((i) => i.id === c.id || i.key === c.label) : null;
  return (
    <button type="button" title={c.text} onClick={() => { if (issue) onOpenIssue(issue); }}
      className={cn('inline-flex h-6 items-center rounded-[6px] bg-white px-1.5 text-[12px] font-medium text-fg-2', HAIR)}>
      {c.type === 'utterance' && c.at ? `${clock(c.at)} · ${c.label}` : c.label}
    </button>
  );
}

/** Calm animated waveform: bars breathe with the mic level (listening) or a soft sine (speaking). */
function Wave({ active, level }: { active: boolean; level: number }) {
  return (
    <div className="flex h-12 items-center gap-[5px]" aria-hidden>
      {Array.from({ length: 13 }, (_, i) => {
        const k = 1 - Math.abs(i - 6) / 7;
        return (
          <motion.span key={i} className="w-[5px] rounded-full bg-[#17150f]"
            animate={{ height: active ? [8, 8 + 34 * k * Math.max(0.25, level), 8] : 6, opacity: active ? 1 : 0.25 }}
            transition={active ? { duration: 0.9 + (i % 3) * 0.15, repeat: Infinity, ease: 'easeInOut', delay: i * 0.04 } : { duration: 0.3 }} />
        );
      })}
    </div>
  );
}
