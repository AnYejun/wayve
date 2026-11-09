// One shared <audio> for radio clips: tap-to-play plus an ordered auto-play queue for incoming clips.
// Browsers block audio that wasn't started by a gesture — then `blocked` turns true and the UI offers "Enable sound";
// unlock() plays a silent tick from that click and drains the queue.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TalkMessage } from '@shared/contracts';

const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export function useRadioPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const queue = useRef<TalkMessage[]>([]);
  const playingRef = useRef<string | null>(null);
  const onEnded = useRef<() => void>(() => {});

  const el = () => {
    if (!audio.current) {
      const a = new Audio();
      a.preload = 'auto';
      a.addEventListener('timeupdate', () => setProgress(a.duration && Number.isFinite(a.duration) ? a.currentTime / a.duration : 0));
      a.addEventListener('loadedmetadata', () => setDuration(Number.isFinite(a.duration) ? a.duration : 0));
      a.addEventListener('ended', () => { playingRef.current = null; setPlaying(null); setProgress(0); onEnded.current(); });
      a.addEventListener('error', () => { playingRef.current = null; setPlaying(null); setProgress(0); onEnded.current(); });
      audio.current = a;
    }
    return audio.current;
  };

  const play = useCallback(async (m: TalkMessage) => {
    if (!m.audioUrl) return false;
    const a = el();
    a.src = m.audioUrl;
    try {
      await a.play();
      setUnlocked(true); setBlocked(false);
      playingRef.current = m.id; setPlaying(m.id);
      return true;
    } catch (e) {
      if ((e as DOMException)?.name === 'NotAllowedError') setBlocked(true);
      playingRef.current = null; setPlaying(null);
      return false;
    }
  }, []);
  const pause = useCallback(() => { audio.current?.pause(); playingRef.current = null; setPlaying(null); }, []);
  const next = useCallback(() => {
    const m = queue.current.shift();
    if (m) void play(m).then((ok) => { if (!ok) queue.current.unshift(m); });
  }, [play]);
  onEnded.current = next;
  const enqueue = useCallback((m: TalkMessage) => {
    if (queue.current.some((x) => x.id === m.id)) return;
    queue.current.push(m);
    if (!playingRef.current) next();
  }, [next]);
  const unlock = useCallback(async () => {
    const a = el();
    a.src = SILENT;
    try { await a.play(); setUnlocked(true); setBlocked(false); } catch { /* still locked */ }
    next();
  }, [next]);
  useEffect(() => () => { audio.current?.pause(); }, []);
  return { playing, progress, duration, unlocked, blocked, play, pause, enqueue, unlock, pending: () => queue.current.length };
}
export type RadioPlayer = ReturnType<typeof useRadioPlayer>;
