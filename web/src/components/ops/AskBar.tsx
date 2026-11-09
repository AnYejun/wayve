// "Ask anything" on the Dashboard — hands the question to the Ask WAYVE drawer (one shared conversation, full live
// context, answers with inline maps and issue cards). Props kept for call-site compatibility.
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import type { Snapshot } from '@shared/contracts';
import { askWayve } from '@/components/chat/AskDrawer';
import { WaveMark } from '@/design/Logo';
import { spring } from '@/design/motion';
import { cn } from '@/lib/utils';

const SUGGESTIONS = ['What needs attention right now?', 'Which zones are busiest?', 'What’s blocked and who owns it?', 'What’s still unassigned?'];

export function AskBar({ snap }: { snap: Snapshot; teamId?: string | null; onOpenIssue?: (keyOrId: string) => void }) {
  const [q, setQ] = useState('');
  const disabled = !snap.ai.enabled;
  const ask = (question: string) => {
    const t = question.trim();
    if (!t || disabled) return;
    setQ('');
    askWayve(t);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); ask(q); };

  return (
    <div>
      <form onSubmit={submit}
        className={cn('group flex h-14 items-center gap-3 rounded-full bg-white pr-2 pl-2 shadow-[inset_0_0_0_1px_rgb(23_21_15/.12),0_1px_2px_rgb(23_21_15/.04)] transition-shadow',
          'focus-within:shadow-[inset_0_0_0_1.5px_#17150f,0_10px_30px_-16px_rgb(23_21_15/.35)]', disabled && 'opacity-60')}>
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#17150f] text-white"><WaveMark size={12} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} disabled={disabled}
          placeholder={disabled ? 'AI is off — asking is unavailable' : 'Ask WAYVE anything about the floor…'} aria-label="Ask WAYVE"
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-3" />
        <kbd className="hidden rounded-[7px] bg-[rgb(23_21_15/.05)] px-2 py-1 font-sans text-[12px] font-medium text-fg-3 sm:inline">⌘K</kbd>
        <motion.button type="submit" whileTap={{ scale: 0.92 }} transition={spring.snappy} disabled={!q.trim() || disabled} aria-label="Ask"
          className="inline-grid size-10 shrink-0 place-items-center rounded-full bg-[#17150f] text-white transition-opacity disabled:opacity-25">
          <ArrowUp size={18} strokeWidth={2.25} />
        </motion.button>
      </form>
      {!disabled && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s, i) => (
            <motion.button key={s} type="button" onClick={() => ask(s)}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: 0.03 * i }} whileTap={{ scale: 0.97 }}
              className="inline-flex h-8 items-center rounded-full bg-white px-3 text-[13px] text-fg-2 shadow-[inset_0_0_0_1px_rgb(23_21_15/.1)] transition-[color,box-shadow] hover:text-fg hover:shadow-[inset_0_0_0_1px_rgb(23_21_15/.2)]">
              {s}
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
