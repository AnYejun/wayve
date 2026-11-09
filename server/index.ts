// WAYVE server entry. `node --import ./server/early.js server/index.ts` (Node 24 type stripping).
import { graceful, lifecycle, listen, onShutdown } from './lifecycle.js';
import express from 'express';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { db } from './db.ts';
import { log } from './log.ts';
import { aiInfo } from './ai.ts';
import { apiRouter } from './routes.ts';
import { sseCount, startHeartbeat, stopHub } from './sse.ts';
import { startEscalation } from './ops.ts';
import { startCrew } from './crew.ts';
import { startRadioSweeper } from './opsRoutes.ts';
import { MEDIA_ROOT } from './media.ts';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
// Server-Timing on every response: DevTools shows pure server time ("app") apart from network time.
app.use((_req, res, next) => {
  const t0 = performance.now();
  const orig = res.writeHead.bind(res) as (...a: unknown[]) => typeof res;
  (res as unknown as { writeHead: (...a: unknown[]) => typeof res }).writeHead = (...a: unknown[]) => {
    if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${(performance.now() - t0).toFixed(1)}`);
    return orig(...a);
  };
  next();
});
app.use(lifecycle);
// Never compress SSE (it would buffer frames).
app.use(compression({ filter: (req, res) => !req.path.endsWith('/stream') && compression.filter(req, res) }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  next();
});

app.get('/api/health', (_req, res) => { res.json({ ok: true, release: config.RELEASE, ai: aiInfo(), sse: sseCount() }); });
app.use('/api', apiRouter());
// Stored media: random names, long cache, never sniffed. Only files under DATA_DIR/media.
app.use('/media', express.static(MEDIA_ROOT, { index: false, maxAge: '7d', immutable: true, fallthrough: false, dotfiles: 'deny' }));

const dist = path.join(config.root, 'dist');
if (fs.existsSync(dist)) {
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  const indexHtml = path.join(dist, 'index.html');
  app.get(/.*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

startHeartbeat();
startEscalation();
startCrew();
startRadioSweeper();
const server = listen(app, config.PORT, () => {
  log.info('server.listening', { port: config.PORT, release: config.RELEASE, ai: aiInfo().enabled, vision: aiInfo().visionModel });
});
onShutdown(() => stopHub());
graceful(server, { db });
