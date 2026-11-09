// Ops board helpers: KST due times, unacked messages, live scribes, per-issue change flashes.
import { useEffect, useRef, useState } from 'react';
import {
  DEVICE_OFFLINE_MS, ESCALATE_AFTER_MS, type Device, type Issue, type Participant, type Snapshot, type TalkMessage,
} from '@shared/contracts';
import { serverNow } from '@/lib/live';

const KST = 9 * 3600_000;

/** "14:00" → epoch ms for today in KST (event local time). */
export function kstTodayAt(hhmm: string, now = serverNow()): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(now + KST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, min) - KST;
}

/** epoch → "14:00" in KST. */
export function kstHHMM(ts: number): string {
  const d = new Date(ts + KST);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export const isOverdue = (i: Issue, now: number) => i.dueAt != null && i.status !== 'done' && now > i.dueAt;

/** Who still has to ack this message. */
export const pendingAcks = (m: TalkMessage) => m.expected.filter((id) => !m.acks.some((a) => a.participantId === id));
export const isUnacked = (m: TalkMessage) => pendingAcks(m).length > 0;
export const isMsgOverdue = (m: TalkMessage, now: number) => isUnacked(m) && now - m.createdAt > ESCALATE_AFTER_MS;

export const isOnline = (d: Device, now: number) => now - d.lastSeenAt < DEVICE_OFFLINE_MS;
/** Scribe phones currently recording (mode observing + online). */
export const liveScribes = (snap: Snapshot, now: number) =>
  snap.devices.filter((d) => d.deviceType === 'scribe' && d.mode === 'observing' && isOnline(d, now));

/** Team of a device = its owner's team. */
export function deviceTeam(d: Device, people: Map<string, Participant>): string | null {
  return people.get(d.participantId)?.teamId ?? null;
}

/** Two-glyph monogram: trailing number ("Staff 3" → "3"), else the last two characters of a Hangul name, else initials. */
export function initials(name: string): string {
  const n = name.trim();
  const num = /(\d+)$/.exec(n);
  if (num) return num[1].slice(-2);
  const compact = n.replace(/\s+/g, '');
  if (/[\uAC00-\uD7A3]/.test(compact)) return compact.slice(-2);
  return compact.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || compact.slice(0, 2);
}

/**
 * Issues that appeared or changed (version went up) after the first render, each kept for `ms`.
 * 'new' = first time seen (enter animation), 'updated' = warm flash only. Reconnect snapshots don't re-flash.
 */
export function useIssueFlash(issues: Issue[] | undefined, ms = 1200): Map<string, 'new' | 'updated'> {
  const seen = useRef<Map<string, number> | null>(null);
  const [flash, setFlash] = useState<Map<string, 'new' | 'updated'>>(() => new Map());
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    if (!issues) return;
    if (!seen.current) { seen.current = new Map(issues.map((i) => [i.id, i.version])); return; }
    const changed: Array<[string, 'new' | 'updated']> = [];
    for (const i of issues) {
      const v = seen.current.get(i.id);
      if (v === undefined) changed.push([i.id, 'new']);
      else if (i.version > v) changed.push([i.id, 'updated']);
      seen.current.set(i.id, Math.max(v ?? 0, i.version));
    }
    if (!changed.length) return;
    setFlash((f) => { const n = new Map(f); for (const [id, k] of changed) n.set(id, f.get(id) === 'new' ? 'new' : k); return n; });
    const t = setTimeout(() => {
      timers.current.delete(t);
      setFlash((f) => { const n = new Map(f); for (const [id] of changed) n.delete(id); return n; });
    }, ms);
    timers.current.add(t);
  }, [issues, ms]);
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);
  return flash;
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(q).matches : true));
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export const cardClass = 'rounded-[16px] border border-[rgb(23_21_15/.1)] bg-white';

/** Ids that just appeared in a list (for a one-time highlight). */
export function useFreshIds<T extends { id: string | number }>(items: T[] | undefined, ms = 1200): Set<string | number> {
  const seen = useRef<Set<string | number> | null>(null);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [fresh, setFresh] = useState<Set<string | number>>(() => new Set());
  useEffect(() => {
    if (!items) return;
    if (!seen.current) { seen.current = new Set(items.map((i) => i.id)); return; }
    const added = items.filter((i) => !seen.current!.has(i.id)).map((i) => i.id);
    if (!added.length) return;
    for (const id of added) seen.current.add(id);
    setFresh((f) => new Set([...f, ...added]));
    const t = setTimeout(() => {
      timers.current.delete(t);
      setFresh((f) => { const n = new Set(f); for (const id of added) n.delete(id); return n; });
    }, ms);
    timers.current.add(t);
  }, [items, ms]);
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);
  return fresh;
}
