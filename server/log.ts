// Structured JSON-line logger. Privacy rule (critique #18): NEVER log question or answer bodies.
// Use textMeta(text) → { len, h } (code-point length + sha256 prefix) whenever a log line concerns user text.
import { createHash } from 'node:crypto';
import { config } from './config.ts';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(config.LOG_LEVEL as Level)] ?? ORDER.info;

/** Keys whose values are never written, whatever the caller passes (defence in depth). */
const FORBIDDEN = new Set(['text', 'message', 'question', 'answer', 'body', 'userText', 'user_text', 'answer_text', 'prompt', 'input', 'password', 'cookie', 'token']);

function scrub(extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (FORBIDDEN.has(k)) { out[k] = '[omitted]'; continue; }
    if (v instanceof Error) { out[k] = errInfo(v); continue; }
    out[k] = v;
  }
  return out;
}

export function errInfo(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { message: String(e).slice(0, 200) };
  const anyE = e as Error & { status?: number; code?: string; kind?: string };
  return { name: e.name, message: e.message.slice(0, 300), status: anyE.status, code: anyE.code, kind: anyE.kind };
}

function write(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (ORDER[level] < threshold) return;
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(extra ? scrub(extra) : {}) });
    process.stdout.write(line + '\n');
  } catch { /* never throw from logging */ }
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => write('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => write('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, extra),
};

/** Safe fingerprint of user text for logs: code-point length + first 10 hex chars of sha256. */
export function textMeta(text: string | null | undefined): { len: number; h: string } {
  const s = text ?? '';
  return { len: [...s].length, h: createHash('sha256').update(s).digest('hex').slice(0, 10) };
}
