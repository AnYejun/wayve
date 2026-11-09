// Camera observation engine for /device/:id.
//  - camera: getUserMedia after a user gesture (iOS), rear camera, no audio
//  - loop: capture → resize (long edge ≤ CAPTURE_MAX_EDGE) → JPEG .72 → POST; never overlaps; pauses while hidden
//  - AI failure (503/502/network) → `ai.ok=false`, background retries with backoff; 429 BUSY → skip this beat
//  - wake lock while observing; heartbeat every HEARTBEAT_MS regardless of mode
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CAPTURE_INTERVAL_MS, CAPTURE_MAX_EDGE, HEARTBEAT_MS, type CameraRegion, type DeviceMode, type FrameResult,
} from '@shared/contracts';
import { API, HttpError } from '@/lib/api';

export type CamState = 'off' | 'starting' | 'on' | 'denied' | 'unsupported' | 'nocamera' | 'error';
export type AiState = { ok: true } | { ok: false; code: string; message: string; retryAt: number };

const MAX_BACKOFF_MS = 30_000;

/** Region outline colour (high contrast on any scene) — the model is told regions are numbered yellow outlines. */
export const REGION_COLOR = '#ffd60a';

/** Draw numbered region outlines (normalized coords) on a 2D context of size w×h. Used for the frame AND the preview. */
export function drawRegions(ctx: CanvasRenderingContext2D, w: number, h: number, regions: CameraRegion[], scale = 1) {
  regions.forEach((r, i) => {
    if (r.polygon.length < 3) return;
    ctx.beginPath();
    r.polygon.forEach(([x, y], k) => (k ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5 * scale; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
    ctx.lineWidth = 2.5 * scale; ctx.strokeStyle = REGION_COLOR; ctx.stroke();
    const cx = r.polygon.reduce((a, p) => a + p[0], 0) / r.polygon.length * w;
    const cy = r.polygon.reduce((a, p) => a + p[1], 0) / r.polygon.length * h;
    const rad = 13 * scale;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fillStyle = REGION_COLOR; ctx.fill();
    ctx.lineWidth = 2 * scale; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
    ctx.fillStyle = '#000'; ctx.font = `700 ${15 * scale}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), cx, cy + 0.5 * scale);
  });
}

function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement, regions: CameraRegion[] = [], maxEdge = CAPTURE_MAX_EDGE): Promise<Blob | null> {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return Promise.resolve(null);
  const s = Math.min(1, maxEdge / Math.max(w, h));
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  if (regions.length) drawRegions(ctx, canvas.width, canvas.height, regions, canvas.width / 768);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.72));
}

export function useCamera({ deviceId, enabled, onResult, regions = [] }: {
  deviceId: string;
  /** Calibrated multi-zone camera: outlines + numbers are burned into every uploaded frame (1..n, array order). */
  regions?: CameraRegion[];
  /** false while the device has no zone: the loop will not upload. */
  enabled: boolean;
  onResult: (r: FrameResult) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const [cam, setCam] = useState<CamState>('off');
  const [observing, setObserving] = useState(false);
  const [inflight, setInflight] = useState(false);
  const [ai, setAi] = useState<AiState>({ ok: true });
  /** When the next capture is due and how long the wait is (for the countdown bar). */
  const [next, setNext] = useState<{ at: number; ms: number } | null>(null);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.visibilityState === 'hidden');

  const L = useRef({ running: false, timer: undefined as ReturnType<typeof setTimeout> | undefined, busy: false, backoff: 0, abort: null as AbortController | null });
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const regionsRef = useRef(regions);
  regionsRef.current = regions;

  const mode: DeviceMode = observing ? 'observing' : cam === 'on' ? 'paused' : 'idle';
  const modeRef = useRef<DeviceMode>(mode);
  modeRef.current = mode;

  // ── wake lock ──
  const acquireWake = useCallback(async () => {
    try {
      if (!('wakeLock' in navigator) || wakeRef.current) return;
      const s = await navigator.wakeLock.request('screen');
      wakeRef.current = s;
      s.addEventListener('release', () => { if (wakeRef.current === s) wakeRef.current = null; });
    } catch { /* unsupported / denied: fine */ }
  }, []);
  const releaseWake = useCallback(() => {
    const s = wakeRef.current;
    wakeRef.current = null;
    s?.release().catch(() => {});
  }, []);

  // ── loop ──
  const schedule = useCallback((ms: number) => {
    const l = L.current;
    clearTimeout(l.timer);
    if (!l.running) return;
    const d = Math.max(0, Math.round(ms));
    setNext({ at: Date.now() + d, ms: d });
    l.timer = setTimeout(() => { void tickRef.current(); }, d);
  }, []);

  const tick = useCallback(async () => {
    const l = L.current;
    if (!l.running || l.busy) return;
    if (document.visibilityState !== 'visible') { setNext(null); return; } // resumed by visibilitychange
    const video = videoRef.current;
    if (!enabledRef.current || !video || video.readyState < 2) { schedule(600); return; }
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    l.busy = true;
    setInflight(true);
    setNext(null);
    const startedAt = Date.now();
    const abort = new AbortController();
    l.abort = abort;
    try {
      const blob = await grab(video, canvasRef.current, regionsRef.current);
      if (!blob) { schedule(600); return; }
      const res = await API.frame(deviceId, blob, abort.signal);
      if (!l.running) return;
      l.backoff = 0;
      setAi({ ok: true });
      onResultRef.current(res);
      const elapsed = Date.now() - startedAt;
      // Wait out the rest of the cadence; the server's hint (nextInMs, from now) can only slow us down. Capped at 30 s.
      const hint = Number.isFinite(res.nextInMs) ? Math.min(MAX_BACKOFF_MS, Math.max(0, res.nextInMs)) : 0;
      schedule(Math.max(CAPTURE_INTERVAL_MS - elapsed, hint, 0));
    } catch (e) {
      if ((e as Error).name === 'AbortError' || !l.running) return;
      const he = e as HttpError;
      if (he.status === 429) { schedule(CAPTURE_INTERVAL_MS); return; }
      l.backoff = Math.min(MAX_BACKOFF_MS, l.backoff ? l.backoff * 2 : CAPTURE_INTERVAL_MS * 2);
      setAi({ ok: false, code: he.code ?? 'NETWORK', message: he.message ?? 'AI is not responding.', retryAt: Date.now() + l.backoff });
      schedule(l.backoff);
    } finally {
      l.busy = false;
      l.abort = null;
      setInflight(false);
    }
  }, [deviceId, schedule]);
  const tickRef = useRef(tick);
  tickRef.current = tick;

  // ── camera ──
  const startCamera = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) { setCam('unsupported'); return false; }
    setCam('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) { v.srcObject = stream; await v.play().catch(() => {}); }
      setCam('on');
      return true;
    } catch (e) {
      const name = (e as DOMException).name;
      setCam(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nocamera' : 'error');
      return false;
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCam('off');
  }, []);

  const start = useCallback(async () => {
    const ok = await startCamera();
    if (!ok) return false;
    L.current.running = true;
    L.current.backoff = 0;
    setObserving(true);
    void acquireWake();
    API.patchDevice(deviceId, { mode: 'observing' }).catch(() => {});
    schedule(350); // first frame right away (after the camera settles)
    return true;
  }, [startCamera, acquireWake, deviceId, schedule]);

  const pause = useCallback(() => {
    const l = L.current;
    l.running = false;
    clearTimeout(l.timer);
    l.abort?.abort();
    setObserving(false);
    setNext(null);
    releaseWake();
    API.patchDevice(deviceId, { mode: 'paused' }).catch(() => {});
  }, [deviceId, releaseWake]);

  /** Retry the AI right now (from the warning card). */
  const retryNow = useCallback(() => { if (L.current.running && !L.current.busy) schedule(0); }, [schedule]);

  // The <video> may mount after the stream exists (state change re-render): keep it attached.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  // ── visibility: pause the loop while hidden, resume + re-acquire wake lock on return ──
  useEffect(() => {
    const onVis = () => {
      const vis = document.visibilityState === 'visible';
      setHidden(!vis);
      const l = L.current;
      if (!vis) { clearTimeout(l.timer); setNext(null); return; }
      videoRef.current?.play().catch(() => {});
      if (l.running) { void acquireWake(); if (!l.busy) schedule(400); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [acquireWake, schedule]);

  // ── heartbeat (always) ──
  useEffect(() => {
    const beat = () => { if (document.visibilityState === 'visible') API.heartbeat(deviceId, modeRef.current).catch(() => {}); };
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [deviceId]);
  // Send the new mode promptly when it changes.
  useEffect(() => { API.heartbeat(deviceId, mode).catch(() => {}); }, [deviceId, mode]);

  // ── teardown ──
  useEffect(() => () => {
    const l = L.current;
    l.running = false;
    clearTimeout(l.timer);
    l.abort?.abort();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const s = wakeRef.current;
    wakeRef.current = null;
    s?.release().catch(() => {});
  }, []);

  /** Un-annotated still for calibration (larger, no outlines). */
  const snapshot = useCallback(async () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return null;
    return grab(v, document.createElement('canvas'), [], 1280);
  }, []);

  return { attachVideo, cam, observing, inflight, ai, next, hidden, mode, start, pause, stopCamera, retryNow, snapshot, videoRef };
}
