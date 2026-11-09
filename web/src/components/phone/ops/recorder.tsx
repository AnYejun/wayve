// Push-to-talk button for phones. The recording logic lives in '@/comms/recorder' (shared with the desktop app):
// press-and-hold (release sends) or tap-to-toggle; mp4/AAC → webm/opus fallback; audio is never stored.
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDur, useRecorder, type RecState } from '@/comms/recorder';
import { Spinner } from '../common';

export type { RecState };
export { fmtDur };

/** Back-compat name used by the phone tabs. */
export const useTalkRecorder = useRecorder;

/** 96px ink circle (red while recording) with a level halo. */
export function TalkButton({ state, level, disabled, onPressStart, onPressEnd, onToggle, label }: {
  state: RecState; level: number; disabled?: boolean; onPressStart: () => void; onPressEnd: () => void; onToggle: () => void; label: string;
}) {
  const recording = state === 'recording';
  return (
    <div className="relative grid size-[132px] place-items-center">
      <span aria-hidden="true" className="absolute inset-0 rounded-full transition-transform duration-100 ease-out"
        style={{ transform: `scale(${recording ? 0.78 + level * 0.4 : 0.78})`, background: recording ? 'rgb(185 28 28 / .1)' : 'rgb(23 21 15 / .06)' }} />
      <button type="button" disabled={disabled || state === 'uploading'}
        aria-label={recording ? 'Stop and send' : label} aria-pressed={recording}
        onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture?.(e.pointerId); onPressStart(); }}
        onPointerUp={onPressEnd} onPointerCancel={onPressEnd}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        onContextMenu={(e) => e.preventDefault()}
        className={cn('relative grid size-[96px] touch-none select-none place-items-center rounded-full text-white transition-[background-color,scale,opacity] duration-150',
          'active:scale-[.96] disabled:opacity-35 motion-reduce:active:scale-100 [-webkit-touch-callout:none] [-webkit-user-select:none]',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#17150f]',
          recording ? 'bg-[#b91c1c]' : 'bg-[#17150f]')}>
        {state === 'uploading' ? <Spinner className="size-7 border-white/30 border-t-white" />
          : recording ? <Square className="size-7 fill-white" strokeWidth={0} /> : <Mic className="size-9" strokeWidth={1.75} />}
      </button>
    </div>
  );
}
