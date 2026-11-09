// In-process SSE hub (adapted from echo/server/sse/hub.ts). One channel per event: `ev:<eventId>`.
// Every client gets a full snapshot on (re)connect, then entity frames, plus `event: hb` every 15 s.
import type { Request, Response } from 'express';
import { sseFrame } from '../shared/contracts.ts';
import { log } from './log.ts';

const MAX_CLIENTS = 2000;
const HB_MS = 15_000;
const MAX_BUFFERED = 512 * 1024;

type Client = { res: Response; channel: string };
const channels = new Map<string, Set<Client>>();
let total = 0;

export const eventChannel = (eventId: string) => `ev:${eventId}`;

function drop(c: Client) {
  const set = channels.get(c.channel);
  if (set?.delete(c)) { total--; if (!set.size) channels.delete(c.channel); }
}

function safeWrite(c: Client, chunk: string): boolean {
  const res = c.res;
  if (res.writableEnded || res.destroyed) { drop(c); return false; }
  if (res.writableLength > MAX_BUFFERED) {
    log.warn('sse.slow_client_dropped', { channel: c.channel });
    drop(c);
    try { res.end(); } catch { /* gone */ }
    return false;
  }
  try { res.write(chunk); return true; } catch { drop(c); return false; }
}

export function openStream(req: Request, res: Response, channel: string, initial: Array<{ event: string; data: unknown }>): boolean {
  if (total >= MAX_CLIENTS) {
    res.setHeader('Retry-After', '5');
    res.status(503).json({ error: { code: 'SERVER_BUSY', message: 'Too many connections. Reconnecting shortly.' } });
    return false;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  req.socket.setNoDelay(true);
  req.socket.setTimeout(0);
  res.flushHeaders?.();
  const c: Client = { res, channel };
  let set = channels.get(channel);
  if (!set) { set = new Set(); channels.set(channel, set); }
  set.add(c);
  total++;
  safeWrite(c, 'retry: 2500\n\n');
  for (const f of initial) safeWrite(c, sseFrame(f.event, f.data));
  const onClose = () => drop(c);
  res.on('close', onClose);
  req.on('close', onClose);
  return true;
}

export function publish(channel: string, event: string, data: unknown) {
  const set = channels.get(channel);
  if (!set?.size) return;
  const f = sseFrame(event, data);
  for (const c of [...set]) safeWrite(c, f);
}

export const sseCount = () => total;

let hbTimer: ReturnType<typeof setInterval> | null = null;
export function startHeartbeat() {
  if (hbTimer) return;
  hbTimer = setInterval(() => {
    const f = sseFrame('hb', { t: Date.now() });
    for (const set of channels.values()) for (const c of [...set]) safeWrite(c, f);
  }, HB_MS);
  hbTimer.unref?.();
}

export function stopHub() {
  if (hbTimer) clearInterval(hbTimer);
  hbTimer = null;
  for (const set of channels.values()) for (const c of set) { try { c.res.end(); } catch { /* gone */ } }
  channels.clear();
  total = 0;
}
