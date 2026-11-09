// Stored media (floor plans, report photos, camera calibration stills, short-lived radio clips) under DATA_DIR/media.
// Names are random (unguessable); served at /media/<dir>/<file> by server/index.ts. Never store raw continuous audio/video.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.ts';

export const MEDIA_ROOT = path.join(config.DATA_DIR, 'media');
export const MEDIA_DIRS = ['maps', 'reports', 'snapshots', 'radio'] as const;
export type MediaDir = (typeof MEDIA_DIRS)[number];
for (const d of MEDIA_DIRS) fs.mkdirSync(path.join(MEDIA_ROOT, d), { recursive: true });

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'video/webm': 'webm', 'video/mp4': 'm4a',
};
export const extFor = (mime: string) => EXT[mime.split(';')[0].trim().toLowerCase()] ?? null;

/** Save bytes; returns the relative path ("reports/abc123.jpg"). */
export function saveMedia(dir: MediaDir, data: Buffer, mime: string): string {
  const ext = extFor(mime);
  if (!ext) throw new Error(`unsupported media type ${mime}`);
  const rel = `${dir}/${randomBytes(16).toString('base64url')}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_ROOT, rel), data);
  return rel;
}

export const mediaUrl = (rel: string | null | undefined) => (rel ? `/media/${rel}` : null);

export function deleteMedia(rel: string | null | undefined) {
  if (!rel || rel.includes('..')) return;
  try { fs.rmSync(path.join(MEDIA_ROOT, rel), { force: true }); } catch { /* gone */ }
}

/** data:<mime>;base64,<…> → { mime, buf } (null when malformed). */
export function parseDataUrl(s: string | null | undefined, maxBytes: number): { mime: string; buf: Buffer } | null {
  if (!s) return null;
  const m = /^data:([\w/+.-]+)(?:;[\w=.-]+)*;base64,([A-Za-z0-9+/=]+)$/.exec(s.trim());
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > maxBytes) return null;
  return { mime: m[1].toLowerCase(), buf };
}
