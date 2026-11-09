// Live connection effects driven by ephemeral device pulses (SSE `pulse`): a camera's viewfinder sweeps when a frame
// arrives, a scribe's bars move with incoming speech, a staff phone's dot beats on heartbeat. Calm, decaying, reduced-motion safe.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { Device } from '@shared/contracts';
import { useLastPulseAt, usePulses } from '@/lib/live';
import { cn } from '@/lib/utils';

/** Re-render on an interval only while something is animating. */
function useTick(ms: number, active: boolean) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return t;
}

/** Live signal for one device: viewfinder (camera), audio bars (scribe), heartbeat (staff phone). */
export function DeviceSignal({ device, className }: { device: Device; className?: string }) {
  if (device.deviceType === 'camera') return <CameraSignal deviceId={device.id} className={className} />;
  if (device.deviceType === 'scribe') return <ScribeSignal deviceId={device.id} className={className} />;
  return <HeartSignal deviceId={device.id} className={className} />;
}

function CameraSignal({ deviceId, className }: { deviceId: string; className?: string }) {
  const pulses = usePulses(deviceId);
  const reduced = useReducedMotion();
  const last = pulses.find((p) => p.kind === 'frame');
  const now = useTick(1000, !!last);
  const live = !!last && now - last.at < 9000;
  const gaps = pulses.filter((p) => p.kind === 'frame').slice(0, 4).map((p, i, a) => (i ? a[i - 1].at - p.at : 0)).filter(Boolean);
  const every = gaps.length ? Math.max(1, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length / 1000)) : 4;
  return (
    <span className={cn('inline-flex items-center gap-2', className)} aria-label={live ? 'Camera receiving' : 'Camera waiting'}>
      <span className="relative h-[22px] w-[34px] overflow-hidden rounded-[5px] bg-[#17150f]" aria-hidden>
        <span className="absolute inset-[3px] rounded-[2px] border border-white/20" />
        {/* corner ticks */}
        <span className="absolute top-[5px] left-[5px] h-[4px] w-[4px] border-t border-l border-white/70" />
        <span className="absolute right-[5px] bottom-[5px] h-[4px] w-[4px] border-r border-b border-white/70" />
        <AnimatePresence>
          {last && !reduced ? (
            <motion.span key={last.at} className="absolute inset-x-0 h-[6px] bg-gradient-to-b from-transparent via-[#7fd09a]/80 to-transparent"
              initial={{ top: '-20%', opacity: 1 }} animate={{ top: '110%', opacity: 0.2 }} exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
          ) : null}
        </AnimatePresence>
        <span className={cn('absolute top-[4px] right-[4px] size-[5px] rounded-full', live ? 'bg-[#58e07a]' : 'bg-white/30')} />
      </span>
      <span className={cn('text-[12px] font-medium tabular-nums', live ? 'text-[#2f6b3c]' : 'text-fg-3')}>{live ? `Receiving · every ${every}s` : 'Waiting for frames'}</span>
    </span>
  );
}

const BARS = 5;
function ScribeSignal({ deviceId, className }: { deviceId: string; className?: string }) {
  const pulses = usePulses(deviceId);
  const reduced = useReducedMotion();
  const speech = pulses.filter((p) => p.kind === 'speech');
  const lastSpeech = speech[0];
  const now = useTick(160, !!lastSpeech && Date.now() - lastSpeech.at < 6000 && !reduced);
  // Energy decays over ~4 s after each chunk; bars wobble only while there's energy.
  const energy = speech.reduce((m, p) => Math.max(m, (p.level ?? 0.5) * Math.exp(-(now - p.at) / 2200)), 0);
  const live = !!lastSpeech && now - lastSpeech.at < 20000;
  return (
    <span className={cn('inline-flex items-center gap-2', className)} aria-label={live ? 'Transcribing' : 'Listening'}>
      <span className="flex h-[22px] items-center gap-[3px] rounded-[5px] bg-[#f4f3f1] px-[6px]" aria-hidden>
        {Array.from({ length: BARS }, (_, i) => {
          const wobble = reduced ? 0.6 : 0.45 + 0.55 * Math.abs(Math.sin(now / 140 + i * 1.7));
          const h = 3 + Math.round(13 * Math.min(1, energy * wobble * (i === 2 ? 1 : i % 2 ? 0.85 : 0.65)));
          return <span key={i} className="w-[3px] rounded-full bg-[#17150f] transition-[height] duration-150 ease-out" style={{ height: h }} />;
        })}
      </span>
      <span className={cn('text-[12px] font-medium', energy > 0.08 ? 'text-fg' : live ? 'text-fg-2' : 'text-fg-3')}>{energy > 0.08 ? 'Transcribing' : live ? 'Listening' : 'Waiting for speech'}</span>
    </span>
  );
}

function HeartSignal({ deviceId, className }: { deviceId: string; className?: string }) {
  const pulses = usePulses(deviceId);
  const reduced = useReducedMotion();
  const last = pulses[0];
  return (
    <span className={cn('relative inline-grid size-[10px] place-items-center', className)} aria-hidden>
      <span className="size-[8px] rounded-full bg-[#58a069]" />
      <AnimatePresence>
        {last && !reduced ? (
          <motion.span key={last.at} className="absolute inset-0 rounded-full bg-[#58a069]" initial={{ scale: 1, opacity: 0.5 }} animate={{ scale: 2.6, opacity: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 1.1, ease: 'easeOut' }} />
        ) : null}
      </AnimatePresence>
    </span>
  );
}

/** SVG ripple for a VenueMap device marker: one ring per pulse (green = frame, ink = speech, soft = heartbeat). */
export function MarkerRipple({ deviceId, cx, cy, r }: { deviceId: string; cx: number; cy: number; r: number }) {
  const pulses = usePulses(deviceId);
  const reduced = useReducedMotion();
  const last = pulses[0];
  if (!last || reduced || Date.now() - last.at > 2500) return null;
  const color = last.kind === 'frame' ? '#58a069' : last.kind === 'speech' ? '#17150f' : '#9cc9a8';
  return (
    <motion.circle key={last.at} cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={r * 0.22}
      initial={{ opacity: last.kind === 'heartbeat' ? 0.35 : 0.7, scale: 1 }} animate={{ opacity: 0, scale: last.kind === 'heartbeat' ? 1.8 : 2.8 }}
      transition={{ duration: last.kind === 'heartbeat' ? 1 : 1.3, ease: [0.16, 1, 0.3, 1] }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
  );
}

/** Tiny dot that glows while any device pulsed in the last 10 s (sidebar "Devices"). */
export function AnyPulseDot({ className }: { className?: string }) {
  const lastAt = useLastPulseAt();
  const now = useTick(2000, lastAt > 0);
  const live = lastAt > 0 && now - lastAt < 10_000;
  if (!live) return null;
  return <span className={cn('live-dot', className)} style={{ color: '#58a069' }} data-ping aria-label="Devices sending" role="img" />;
}
