// WAYVE motion system — Apple-grade, physical, quiet. Use these instead of ad-hoc timings.
// Library: `motion/react` (import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'motion/react').
//
// Principles
//  1. Springs for anything the hand touches or that moves position (press, sheets, cards reflowing between columns,
//     the active pill of a segmented control). Tweens only for opacity/colour.
//  2. Things ENTER with a small rise (8px) + fade; they EXIT faster (≈65% of enter) with fade only.
//  3. Continuity over cuts: when an item changes place (issue moves Open → In progress, a report becomes an issue),
//     animate it with `layout` / shared `layoutId` so the eye can follow it (Apple "magic move").
//  4. Numbers tick (AnimatedNumber), never jump. New rows get a 1.2s warm wash, once.
//  5. One focal motion per moment. No infinite loops except live/recording dots.
//  6. prefers-reduced-motion → no travel, opacity only (useReducedMotion()).
import type { Transition, Variants } from 'motion/react';

export const spring = {
  /** presses, toggles, chips */
  snappy: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as Transition,
  /** list reflow, cards moving between columns, segmented pill */
  smooth: { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 } as Transition,
  /** sheets, drawers, large panels */
  sheet: { type: 'spring', stiffness: 300, damping: 34, mass: 1 } as Transition,
  /** gentle settle for hero/empty-state elements */
  gentle: { type: 'spring', stiffness: 170, damping: 26, mass: 1 } as Transition,
};

export const ease = { out: [0.16, 1, 0.3, 1] as const, inOut: [0.37, 0, 0.63, 1] as const };
export const dur = { fast: 0.14, base: 0.22, slow: 0.32 };

/** Standard enter/exit for list rows and cards. */
export const rise: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { ...spring.smooth, opacity: { duration: dur.base, ease: ease.out } } },
  exit: { opacity: 0, transition: { duration: dur.fast, ease: ease.out } },
};

/** Stagger children by 40ms (max ~8 visible items feel intentional, more feels slow — cap it). */
export const stagger = (step = 0.04, delay = 0): Variants => ({ animate: { transition: { staggerChildren: step, delayChildren: delay } } });

/** Press feedback for custom buttons: <motion.button whileTap={press} transition={spring.snappy}> */
export const press = { scale: 0.97 };
export const pressIcon = { scale: 0.92 };

/** Warm highlight for a freshly inserted / updated row (apply as animate on a wrapper). */
export const freshWash = { backgroundColor: ['rgba(255, 214, 153, 0.35)', 'rgba(255, 214, 153, 0)'], transition: { duration: 1.2, ease: ease.out } };
