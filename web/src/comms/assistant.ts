// Staff assistant session shared by the desktop Assistant section and the phone sheet.
// ask(text) / askVoice(blob) → POST /api/assistant/turn. Spoken answers: server mp3 → /api/tts → speechSynthesis.
// History is kept per event in sessionStorage (survives reloads in the same tab, never shared).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantTurn } from '@shared/contracts';
import { API, HttpError, blobToDataUrl } from '@/lib/api';

export type Turn = { id: string; q: string; voice: boolean; res: AssistantTurn | null; err: string | null; at: number };

/** Speak an answer. Resolves to a stop() function; onEnd fires once when playback ends or is stopped. */
export async function speak(text: string, data: string | null, onEnd: () => void): Promise<() => void> {
  const done = { v: false };
  const end = () => { if (!done.v) { done.v = true; onEnd(); } };
  const playUrl = async (url: string) => {
    const a = new Audio(url);
    a.onended = end; a.onerror = end;
    await a.play();
    return () => { a.pause(); end(); };
  };
  try { if (data) return await playUrl(data); } catch { /* fall through */ }
  try { const url = await API.tts(text); return await playUrl(url); } catch { /* fall through */ }
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 1.02; u.onend = end; u.onerror = end;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
    return () => { speechSynthesis.cancel(); end(); };
  } catch { end(); return () => {}; }
}

const key = (eventId: string) => `wayve:assistant:${eventId}`;
const archiveKey = (eventId: string) => `wayve:assistant:${eventId}:chats`;
/** Every surface (Ask drawer, Assistant page, phone sheet) shares one conversation: writes broadcast, others reload. */
const SYNC = 'wayve:assistant-sync';
export type Chat = { id: string; title: string; at: number; turns: Turn[] };
function loadChats(eventId: string | undefined): Chat[] {
  if (!eventId) return [];
  try { const raw = sessionStorage.getItem(archiveKey(eventId)); return raw ? (JSON.parse(raw) as Chat[]).slice(0, 30) : []; } catch { return []; }
}
function saveChats(eventId: string, chats: Chat[]) {
  try { sessionStorage.setItem(archiveKey(eventId), JSON.stringify(chats.slice(0, 30))); } catch { /* storage off */ }
}
function load(eventId: string | undefined): Turn[] {
  if (!eventId) return [];
  try { const raw = sessionStorage.getItem(key(eventId)); return raw ? (JSON.parse(raw) as Turn[]).filter((t) => t.res || t.err).slice(-40) : []; } catch { return []; }
}

export function errorText(e: unknown): string {
  const he = e as HttpError;
  if (he?.status === 503) return 'The assistant is offline right now (AI is off).';
  if (he?.status === 429) return 'One moment — try again in a second.';
  if (he?.status === 0) return "Can't reach the server. Check your connection.";
  return he?.message || 'Something went wrong. Try again.';
}

export function useAssistant(eventId: string | undefined, opts: { onSpeechEnd?: () => void } = {}) {
  const [turns, setTurns] = useState<Turn[]>(() => load(eventId));
  const [chats, setChats] = useState<Chat[]>(() => loadChats(eventId));
  const [busy, setBusy] = useState(false);
  const self = useRef(Math.random().toString(36).slice(2));
  const lastWritten = useRef('');
  const [speaking, setSpeaking] = useState(false);
  const stopSpeech = useRef<() => void>(() => {});
  const onEndRef = useRef(opts.onSpeechEnd);
  onEndRef.current = opts.onSpeechEnd;

  useEffect(() => { setTurns(load(eventId)); setChats(loadChats(eventId)); }, [eventId]);
  useEffect(() => {
    if (!eventId) return;
    const json = JSON.stringify(turns.filter((t) => t.res || t.err).slice(-40));
    if (json === lastWritten.current) return;
    lastWritten.current = json;
    try { sessionStorage.setItem(key(eventId), json); } catch { /* storage off */ }
    window.dispatchEvent(new CustomEvent(SYNC, { detail: { from: self.current, eventId } }));
  }, [eventId, turns]);
  // Another surface wrote → reload (only completed turns are shared; in-flight ones stay local).
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ from: string; eventId: string }>).detail;
      if (!eventId || d.from === self.current || d.eventId !== eventId) return;
      const next = load(eventId);
      lastWritten.current = JSON.stringify(next);
      setTurns((cur) => (cur.some((t) => !t.res && !t.err) ? cur : next));
      setChats(loadChats(eventId));
    };
    window.addEventListener(SYNC, on);
    return () => window.removeEventListener(SYNC, on);
  }, [eventId]);
  useEffect(() => () => stopSpeech.current(), []);

  const run = useCallback(async (q: string, audio: Blob | null, wantSpeech: boolean) => {
    if (!eventId) return null;
    const id = Math.random().toString(36).slice(2);
    setTurns((t) => [...t, { id, q: audio ? '…' : q, voice: !!audio, res: null, err: null, at: Date.now() }]);
    setBusy(true);
    try {
      const res = await API.assistantTurn({ eventId, text: audio ? undefined : q, audio: audio ? await blobToDataUrl(audio) : undefined, speak: wantSpeech });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, q: res.transcript ?? x.q, res } : x)));
      if (wantSpeech) {
        stopSpeech.current();
        setSpeaking(true);
        stopSpeech.current = await speak(res.answer, res.speech, () => { setSpeaking(false); onEndRef.current?.(); });
      }
      return res;
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, q: x.q === '…' ? 'Voice question' : x.q, err: errorText(e) } : x)));
      return null;
    } finally { setBusy(false); }
  }, [eventId]);

  const ask = useCallback((q: string, opts2: { speak?: boolean } = {}) => run(q.trim(), null, !!opts2.speak), [run]);
  const askVoice = useCallback((blob: Blob, opts2: { speak?: boolean } = {}) => run('', blob, opts2.speak ?? true), [run]);
  const stop = useCallback(() => { stopSpeech.current(); stopSpeech.current = () => {}; setSpeaking(false); }, []);
  const clear = useCallback(() => { stop(); setTurns([]); }, [stop]);
  /** Archive the current conversation (if any) and start fresh. */
  const newChat = useCallback(() => {
    if (!eventId) return;
    stop();
    setTurns((cur) => {
      const done = cur.filter((t) => t.res || t.err);
      if (done.length) {
        const next = [{ id: Math.random().toString(36).slice(2), title: done[0].q.slice(0, 60) || 'Conversation', at: done[done.length - 1].at, turns: done }, ...loadChats(eventId)];
        saveChats(eventId, next);
        setChats(next);
      }
      return [];
    });
  }, [eventId, stop]);
  /** Bring an archived conversation back (the current one is archived first). */
  const openChat = useCallback((chatId: string) => {
    if (!eventId) return;
    stop();
    const all = loadChats(eventId);
    const target = all.find((c) => c.id === chatId);
    if (!target) return;
    setTurns((cur) => {
      const done = cur.filter((t) => t.res || t.err);
      let rest = all.filter((c) => c.id !== chatId);
      if (done.length) rest = [{ id: Math.random().toString(36).slice(2), title: done[0].q.slice(0, 60) || 'Conversation', at: done[done.length - 1].at, turns: done }, ...rest];
      saveChats(eventId, rest);
      setChats(rest);
      return target.turns;
    });
  }, [eventId, stop]);
  const retry = useCallback((t: Turn) => { setTurns((all) => all.filter((x) => x.id !== t.id)); if (!t.voice) void run(t.q, null, false); }, [run]);

  return { turns, chats, busy, speaking, ask, askVoice, stop, clear, retry, newChat, openChat };
}
