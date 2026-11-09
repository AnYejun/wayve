// Voice recorder shared by radio (push-to-talk) and the assistant, on phones AND desktop browsers.
// MediaRecorder container/codec support differs: Safari records audio/mp4 (AAC) only; Chrome records webm/opus and,
// in recent versions, mp4. We prefer AAC-in-MP4 (plays everywhere), then plain mp4, then webm/opus. The Blob type has the
// codecs parameter stripped (the server keys on the container). Audio never touches storage here.
import { useCallback, useEffect, useRef, useState } from 'react';

export type RecState = 'idle' | 'recording' | 'uploading';

export const MIME_PREFERENCE = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'] as const;

/** Pure for testing: first supported mime from the preference list, or undefined (= let the browser choose). */
export function chooseMime(isSupported: (m: string) => boolean): string | undefined {
  for (const m of MIME_PREFERENCE) {
    try { if (isSupported(m)) return m; } catch { /* old Safari throws */ }
  }
  return undefined;
}

export function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return chooseMime((m) => MediaRecorder.isTypeSupported(m));
}

export const recordingSupported = () => typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Human hint for a blocked microphone, per browser. */
export function micHelp(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  if (/iPhone|iPad/.test(ua)) return 'Microphone is blocked. Open Settings › Safari › Microphone, allow it for this site, then reload.';
  if (safari) return 'Microphone is blocked. In Safari, choose Settings for This Website › Microphone › Allow, then reload.';
  return 'Microphone is blocked. Click the icon at the left of the address bar, allow the microphone, then reload.';
}

const HOLD_MS = 450;
const MIN_MS = 600;

export const fmtDur = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const haptic = (ms: number | number[]) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

/**
 * useRecorder — press-and-hold (release sends), tap-to-toggle, or explicit start()/stop() (e.g. hold SPACE on desktop).
 * Clips shorter than 0.6 s are treated as accidental and dropped. Hits maxMs → stops and sends.
 */
export function useRecorder({ maxMs = 60_000, onBlob, onDenied }: {
  maxMs?: number; onBlob: (b: Blob, durationMs: number) => Promise<void> | void; onDenied: (msg: string) => void;
}) {
  const [state, setState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const r = useRef({
    rec: null as MediaRecorder | null, stream: null as MediaStream | null, ctx: null as AudioContext | null,
    chunks: [] as Blob[], startedAt: 0, downAt: 0, startedByPress: false, raf: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined,
    starting: false, stopRequested: false, cancelled: false,
  });
  const onBlobRef = useRef(onBlob);
  onBlobRef.current = onBlob;
  const onDeniedRef = useRef(onDenied);
  onDeniedRef.current = onDenied;
  const stateRef = useRef(state);
  stateRef.current = state;

  const cleanup = useCallback(() => {
    const s = r.current;
    cancelAnimationFrame(s.raf);
    clearTimeout(s.timer);
    s.stream?.getTracks().forEach((t) => t.stop());
    s.stream = null;
    s.ctx?.close().catch(() => {});
    s.ctx = null;
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    const s = r.current;
    if (s.starting) { s.stopRequested = true; return; }
    if (s.rec && s.rec.state !== 'inactive') s.rec.stop();
  }, []);

  /** Stop without sending. */
  const cancel = useCallback(() => { r.current.cancelled = true; stop(); }, [stop]);

  const start = useCallback(async () => {
    const s = r.current;
    if (s.rec || s.starting || stateRef.current === 'uploading') return;
    if (!recordingSupported()) { onDeniedRef.current("This browser can't record audio. Type instead."); return; }
    s.starting = true; s.stopRequested = false; s.cancelled = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      s.stream = stream;
      const mime = pickMime();
      let rec: MediaRecorder;
      try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
      catch { rec = new MediaRecorder(stream); } // a listed type can still be refused at construction (Safari quirk)
      s.rec = rec; s.chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) s.chunks.push(e.data); };
      rec.onstop = async () => {
        const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
        const blob = new Blob(s.chunks, { type });
        const dur = Date.now() - s.startedAt;
        s.rec = null;
        cleanup();
        haptic(15);
        if (s.cancelled || dur < MIN_MS || blob.size < 1200) { s.cancelled = false; setState('idle'); setElapsed(0); return; }
        setState('uploading');
        try { await onBlobRef.current(blob, dur); } finally { setState('idle'); setElapsed(0); }
      };
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        s.ctx = ctx;
        ctx.resume().catch(() => {});
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const loop = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
          setElapsed(Date.now() - s.startedAt);
          s.raf = requestAnimationFrame(loop);
        };
        s.raf = requestAnimationFrame(loop);
      } catch { /* the meter is optional */ }
      s.startedAt = Date.now();
      rec.start(250);
      setState('recording');
      haptic(25);
      s.timer = setTimeout(() => stop(), maxMs);
    } catch (e) {
      cleanup();
      s.rec = null;
      const name = (e as DOMException)?.name;
      onDeniedRef.current(name === 'NotAllowedError' || name === 'SecurityError' ? micHelp()
        : name === 'NotFoundError' ? 'No microphone found. Plug one in or type instead.'
        : "Couldn't start recording. Type instead.");
      setState('idle');
    } finally {
      s.starting = false;
      if (s.stopRequested) { s.stopRequested = false; stop(); }
    }
  }, [cleanup, maxMs, stop]);

  const pressStart = useCallback(() => {
    const s = r.current;
    s.downAt = Date.now();
    if (stateRef.current === 'idle') { s.startedByPress = true; void start(); } else { s.startedByPress = false; }
  }, [start]);

  const pressEnd = useCallback(() => {
    const s = r.current;
    const held = Date.now() - s.downAt;
    if (s.startedByPress) {
      s.startedByPress = false;
      if (held >= HOLD_MS) stop(); // press-and-hold: release sends
      return;                       // short click/tap: keep recording (toggle mode)
    }
    if (stateRef.current === 'recording' || s.starting) stop();
  }, [stop]);

  const toggle = useCallback(() => {
    if (stateRef.current === 'idle') void start(); else if (stateRef.current === 'recording') stop();
  }, [start, stop]);

  useEffect(() => () => {
    const s = r.current;
    if (s.rec && s.rec.state !== 'inactive') { s.rec.onstop = null; s.rec.stop(); }
    cleanup();
  }, [cleanup]);

  return { state, elapsed, level, start, stop, cancel, pressStart, pressEnd, toggle, supported: recordingSupported() };
}
export type Recorder = ReturnType<typeof useRecorder>;
