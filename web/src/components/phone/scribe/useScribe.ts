// Scribe session hook: recorder + upload queue + device mode + heartbeat + wake lock + visibility handling.
//  - listening → device mode 'observing', paused → 'paused', stopped → 'idle' (API.patchDevice on change)
//  - heartbeat every HEARTBEAT_MS regardless of mode
//  - wake lock while listening (re-acquired when the page is visible again)
//  - iOS stops audio when the screen turns off: we flag `wasHidden` so the page can say so
import { useCallback, useEffect, useRef, useState } from 'react';
import { HEARTBEAT_MS, type DeviceMode, type Utterance } from '@shared/contracts';
import { API } from '@/lib/api';
import { ScribeRecorder, UploadQueue, type QueueState, type ScribeError, type ScribeState } from '@/lib/scribe';

const EMPTY_QUEUE: QueueState = { pending: 0, inflight: false, dropped: 0, offline: false, aiDisabled: false, lastError: null };

export function useScribe({ deviceId, onUtterance }: { deviceId: string; onUtterance?: (u: Utterance) => void }) {
  const [state, setState] = useState<ScribeState>('idle');
  const [error, setError] = useState<ScribeError | null>(null);
  const [level, setLevel] = useState(0);
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE);
  const [everStarted, setEverStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const [wasHidden, setWasHidden] = useState(false);
  const [wakeOk, setWakeOk] = useState(true);
  const [segments, setSegments] = useState(0);

  const recRef = useRef<ScribeRecorder | null>(null);
  const queueRef = useRef<UploadQueue | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const modeRef = useRef<DeviceMode>('idle');
  const baseRef = useRef(0);                           // ms listened before the current run
  const runStartRef = useRef<number | null>(null);
  const onUttRef = useRef(onUtterance);
  onUttRef.current = onUtterance;

  // queue (one per page)
  if (!queueRef.current) {
    queueRef.current = new UploadQueue(async (seg) => {
      const r = await API.scribeAudio(deviceId, seg.blob, { startedAt: seg.startedAt, endedAt: seg.endedAt, seq: seg.seq });
      if (r.utterance) onUttRef.current?.(r.utterance);
    }, setQueue);
  }

  const setMode = useCallback((m: DeviceMode) => {
    if (modeRef.current === m) return;
    modeRef.current = m;
    API.patchDevice(deviceId, { mode: m }).catch(() => {});
  }, [deviceId]);

  const releaseWake = useCallback(() => {
    const w = wakeRef.current;
    wakeRef.current = null;
    w?.release().catch(() => {});
  }, []);
  const acquireWake = useCallback(async () => {
    if (!('wakeLock' in navigator)) { setWakeOk(false); return; }
    if (wakeRef.current || document.visibilityState !== 'visible') return;
    try {
      const s = await navigator.wakeLock.request('screen');
      wakeRef.current = s;
      setWakeOk(true);
      s.addEventListener('release', () => { if (wakeRef.current === s) wakeRef.current = null; });
    } catch { setWakeOk(false); }
  }, []);

  const getRec = useCallback(() => {
    if (!recRef.current) {
      recRef.current = new ScribeRecorder({
        onSegment: (seg) => { setSegments((n) => n + 1); queueRef.current?.push(seg); },
        onLevel: setLevel,
        onState: (st, err) => {
          setState(st);
          setError(err);
          if (st === 'listening') { runStartRef.current = Date.now(); setMode('observing'); void acquireWake(); }
          else {
            if (runStartRef.current != null) { baseRef.current += Date.now() - runStartRef.current; runStartRef.current = null; }
            if (st === 'paused') setMode('paused');
            if (st === 'idle' || st === 'error') setMode('idle');
            releaseWake();
          }
        },
      });
    }
    return recRef.current;
  }, [acquireWake, releaseWake, setMode]);

  /** Call from a tap (iOS needs the gesture to start audio). */
  const start = useCallback(() => {
    if (ended) { baseRef.current = 0; setSegments(0); }
    setEverStarted(true);
    setEnded(false);
    setWasHidden(false);
    void getRec().start();
  }, [getRec, ended]);
  const pause = useCallback(() => recRef.current?.pause(), []);
  const resume = useCallback(() => { setWasHidden(false); recRef.current?.resume(); }, []);
  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setEnded(true);
    setMode('idle');
  }, [setMode]);

  // visibility: iOS freezes audio in the background; wake the graph + wake lock when we come back
  useEffect(() => {
    const onVis = () => {
      const vis = document.visibilityState === 'visible';
      setHidden(!vis);
      const st = recRef.current?.state;
      if (!vis && st === 'listening') setWasHidden(true);
      if (vis) {
        recRef.current?.wake();
        if (recRef.current?.state === 'listening') void acquireWake();
        queueRef.current?.kick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const onOnline = () => queueRef.current?.kick();
    window.addEventListener('online', onOnline);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onOnline); };
  }, [acquireWake]);

  // heartbeat (always)
  useEffect(() => {
    const beat = () => { API.heartbeat(deviceId, modeRef.current).catch(() => {}); };
    beat();
    const t = setInterval(() => { if (document.visibilityState === 'visible') beat(); }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [deviceId]);

  // teardown (StrictMode-safe: the queue reopens on remount)
  useEffect(() => {
    queueRef.current?.reopen();
    return () => {
      recRef.current?.stop();
      recRef.current = null;
      queueRef.current?.close();
      releaseWake();
    };
  }, [releaseWake]);

  return {
    state, error, level, queue, segments, everStarted, ended, hidden, wasHidden, wakeOk,
    /** Total listening time in ms at `now`. */
    elapsed: (now: number) => baseRef.current + (runStartRef.current != null ? Math.max(0, now - runStartRef.current) : 0),
    start, pause, resume, stop,
  };
}
