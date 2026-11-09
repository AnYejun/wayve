// Apple-style collapsing top bar (desktop): invisible over the section's large title; as you scroll past it, a frosted
// bar fades in and the section title slides into it — like iOS large titles collapsing into the navigation bar.
// Scroll-linked via motion values (no React re-render per scroll frame); transform/opacity only → GPU-cheap.
import type { RefObject } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { LiveIndicator } from '@/components/bits';
import type { LiveStatus } from '@/lib/live';

export function TopBar({ scrollRef, title, eventName, status }: {
  scrollRef: RefObject<HTMLElement | null>; title: string; eventName: string | null; status: LiveStatus;
}) {
  const reduced = useReducedMotion();
  const { scrollY } = useScroll({ container: scrollRef });
  const bg = useTransform(scrollY, [16, 64], [0, 1]);
  const titleOpacity = useTransform(scrollY, [40, 76], [0, 1]);
  const titleY = useTransform(scrollY, [40, 76], reduced ? [0, 0] : [8, 0]);

  return (
    <div className="pointer-events-none sticky top-0 z-20 hidden h-0 md:block" aria-hidden={false}>
      <motion.div style={{ opacity: bg }}
        className="absolute inset-x-0 top-0 h-[52px] border-b-[0.5px] border-[rgb(23_21_15/.12)] bg-[rgb(252_252_251/.78)] [backdrop-filter:saturate(180%)_blur(20px)] [-webkit-backdrop-filter:saturate(180%)_blur(20px)]" />
      <div className="absolute inset-x-0 top-0 flex h-[52px] items-center px-8">
        <motion.div style={{ opacity: titleOpacity, y: titleY }} className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</span>
          {eventName ? <span className="truncate text-[13px] text-fg-3">{eventName}</span> : null}
        </motion.div>
        <motion.div style={{ opacity: titleOpacity }} className="pointer-events-auto ml-auto">
          <LiveIndicator status={status} className="h-6 px-2 text-[12px]" />
        </motion.div>
      </div>
    </div>
  );
}
