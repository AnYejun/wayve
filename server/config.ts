// Environment → typed config. Secrets (OPENAI_API_KEY) live only here and never reach the client.
import path from 'node:path';

const env = process.env;
const str = (k: string, d: string) => (env[k] ?? d).trim();
const num = (k: string, d: number) => { const v = Number(env[k]); return Number.isFinite(v) && env[k] !== '' && env[k] != null ? v : d; };

const isProd = env.NODE_ENV === 'production';
const root = path.resolve(import.meta.dirname, '..');

export const config = {
  isProd,
  root,
  PORT: num('PORT', 8080),
  PUBLIC_ORIGIN: str('PUBLIC_ORIGIN', isProd ? '' : 'http://localhost:5173'),
  DATA_DIR: path.resolve(root, str('DATA_DIR', isProd ? '/app/data' : './data')),
  LOG_LEVEL: str('LOG_LEVEL', 'info'),
  RELEASE: str('RELEASE', 'dev'),
  /** Event time zone for due times and clock labels. */
  EVENT_TZ: str('EVENT_TZ', 'Asia/Seoul'),

  OPENAI_API_KEY: str('OPENAI_API_KEY', ''),
  OPENAI_VISION_MODEL: str('OPENAI_VISION_MODEL', 'gpt-6-luna'),
  OPENAI_TEXT_MODEL: str('OPENAI_TEXT_MODEL', 'gpt-6-luna'),
  OPENAI_TRANSCRIBE_MODEL: str('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
  OPENAI_REASONING_EFFORT: str('OPENAI_REASONING_EFFORT', 'none'),
  VISION_TIMEOUT_MS: num('VISION_TIMEOUT_MS', 15_000),
  TEXT_TIMEOUT_MS: num('TEXT_TIMEOUT_MS', 15_000),
  AI_MAX_CONCURRENCY: num('AI_MAX_CONCURRENCY', 12),
};
