// The one job I'm on, pinned under the header on Chat and Radio: "On WV-12 · Entrance". Slide the knob to finish it
// (optimistic: done instantly, server confirms); tap the pill to open the issue and its timeline.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react';
import { Check, ChevronsRight } from 'lucide-react';
import type { Issue, Me, Snapshot } from '@shared/contracts';
import { spring } from '@/design/motion';
import { patchIssue, type ApplyIssue } from '../ops/issue';
import { haptic } from './shell';

const KNOB = 44;
const PAD = 4;

export function useActiveIssue(snap: Snapshot, me: Me): Issue | null {
  return useMemo(() => snap.issues
    .filter((i) => i.assigneeId === me.participantId && (i.status === 'in_progress' || i.status === 'blocked'))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null, [snap.issues, me.participantId]);
}

export function ActiveTask({ snap, me, apply, onOpen }: { snap: Snapshot; me: Me; apply: ApplyIssue; onOpen: (i: Issue) => void }) {
  const issue = useActiveIssue(snap, me);
  const zone = issue?.zoneId ? snap.zones.find((z) => z.id === issue.zoneId)?.name ?? null : null;
  return (
    <div className="sticky top-[calc(var(--safe-t)+52px)] z-(--z-sticky) -mx-4 px-4">
      <AnimatePresence initial={false}>
        {issue ? (
          <motion.div key={issue.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth}
            className="overflow-hidden">
            <div className="pt-2 pb-3">
              <Slider issue={issue} zone={zone} onOpen={() => onOpen(issue)}
                onDone={() => { haptic([20, 30, 20]); void patchIssue(issue, { status: 'done' }, apply, `${issue.key} done — nice work`); }} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Slider({ issue, zone, onOpen, onDone }: { issue: Issue; zone: string | null; onOpen: () => void; onDone: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(260);
  const [finished, setFinished] = useState(false);
  const dragged = useRef(false);
  const x = useMotionValue(0);
  const textOpacity = useTransform(x, [0, max * 0.55], [1, 0]);
  const fill = useTransform(x, (v) => v + KNOB + PAD * 2);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setMax(Math.max(80, el.clientWidth - KNOB - PAD * 2));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setFinished(false); x.set(0); }, [issue.id, x]);

  const finish = () => { setFinished(true); void animate(x, max, spring.snappy); onDone(); };

  return (
    <div ref={track} role="group" aria-label={`On ${issue.key}${zone ? ` at ${zone}` : ''}`}
      onClick={() => { if (!dragged.current) onOpen(); }}
      className="relative h-[52px] cursor-pointer overflow-hidden rounded-full bg-[#17150f] shadow-[0_10px_28px_-14px_rgb(23_21_15/.6)] select-none">
      <motion.span aria-hidden style={{ width: fill }} className="absolute inset-y-0 left-0 rounded-full bg-[#2f7a45]" />
      <motion.span style={{ opacity: textOpacity }} className="pointer-events-none absolute inset-0 flex items-center gap-2 pr-4 pl-[60px] text-white">
        <span className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em]">
          On <span className="font-mono text-[13.5px]">{issue.key}</span>{zone ? ` · ${zone}` : ` · ${issue.title}`}
        </span>
        <span className="ml-auto shrink-0 text-[12.5px] font-medium text-white/55">{issue.status === 'blocked' ? 'Blocked · slide when done' : 'Slide when done'}</span>
      </motion.span>
      <motion.button type="button" aria-label={`Slide to mark ${issue.key} done`}
        drag={finished ? false : 'x'} dragConstraints={{ left: 0, right: max }} dragElastic={0.04} dragMomentum={false}
        style={{ x, touchAction: 'none' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); } }}
        onDragStart={() => { dragged.current = true; haptic(6); }}
        onDragEnd={() => {
          if (x.get() > max * 0.82) finish(); else void animate(x, 0, spring.snappy);
          setTimeout(() => { dragged.current = false; }, 60);
        }}
        className="absolute top-1 left-1 grid size-[44px] place-items-center rounded-full bg-white text-fg shadow-[0_2px_6px_rgb(23_21_15/.25)]">
        {finished ? <Check className="size-5 text-[#2f7a45]" strokeWidth={2.75} /> : <ChevronsRight className="size-5" strokeWidth={2.25} />}
      </motion.button>
    </div>
  );
}
