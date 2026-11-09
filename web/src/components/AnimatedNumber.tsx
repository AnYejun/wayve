// Numbers that tick instead of jumping (spring-driven, tabular). Reduced motion → instant.
import { useEffect } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';

export function AnimatedNumber({ value, className, format = (n) => Math.round(n).toLocaleString('en-US') }: {
  value: number; className?: string; format?: (n: number) => string;
}) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (reduced) { mv.set(value); return; }
    const c = animate(mv, value, { type: 'spring', stiffness: 220, damping: 30 });
    return () => c.stop();
  }, [value, reduced, mv]);
  return <motion.span className={['tabular-nums', className].filter(Boolean).join(' ')}>{text}</motion.span>;
}
