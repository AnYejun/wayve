// Server lifecycle — make a deploy invisible to users (adapted from agora/src/lifecycle.js; i18n/request-context removed).
//  - listen(): adopt the port opened by early.js and replay queued requests
//  - lifecycle middleware: X-Echo header, /healthz (200 ok | 503 draining), in-flight tracking, Connection: close while draining
//  - graceful(): on SIGINT/SIGTERM stop accepting, stop timers, close GET SSE with retry, give POST streams a short grace then
//    send `event: error {code:'DRAINING', restart:true}` (matches shared/contracts ChatSse), drain the rest, run hooks, checkpoint DB, exit.
// This module imports no app modules (so its setInterval tracking is installed first).

const DRAIN_MS = Number(process.env.DRAIN_MS || 8000); // shorter than fly.toml kill_timeout (10s)
const STREAM_GRACE_MS = Number(process.env.STREAM_GRACE_MS || 1000);
const SSE_RETRY_MS = 2500;
const RELEASE = process.env.RELEASE || process.env.WAYVE_RELEASE || '';

const log = (level, msg, extra = {}) => {
  try { process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }) + '\n'); } catch { /* ignore */ }
};

// Track every setInterval / long setTimeout created after this module so shutdown can stop them all.
const nativeSetInterval = globalThis.setInterval, nativeClearInterval = globalThis.clearInterval;
const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
const intervals = new Set();
globalThis.setInterval = function setInterval(...a) {
  const t = nativeSetInterval(...a);
  intervals.add(t);
  if (intervals.size > 4000) for (const x of intervals) if (x._destroyed) intervals.delete(x);
  return t;
};
globalThis.clearInterval = function clearInterval(t) { intervals.delete(t); return nativeClearInterval(t); };
const timeouts = new Set();
const wrappedSetTimeout = function setTimeout(fn, ms, ...rest) {
  if (typeof fn !== 'function' || !(Number(ms) >= 1000)) return nativeSetTimeout(fn, ms, ...rest);
  const t = nativeSetTimeout(function () { timeouts.delete(t); return fn.apply(this, arguments); }, ms, ...rest);
  timeouts.add(t);
  return t;
};
const promisifyKey = Symbol.for('nodejs.util.promisify.custom');
if (nativeSetTimeout[promisifyKey]) wrappedSetTimeout[promisifyKey] = nativeSetTimeout[promisifyKey];
globalThis.setTimeout = wrappedSetTimeout;
globalThis.clearTimeout = function clearTimeout(t) { if (t != null) timeouts.delete(t); return nativeClearTimeout(t); };

/** Use instead of app.listen — adopts the early server if present. */
export function listen(app, port, cb) {
  const early = globalThis.__echoEarly;
  if (!early) return app.listen(port, cb);
  delete globalThis.__echoEarly;
  const { server, queue } = early;
  server.removeAllListeners('request');
  server.on('request', app);
  const held = queue.splice(0).filter(([req]) => !req.socket?.destroyed);
  for (const [req, res] of held) app(req, res);
  const ready = () => {
    log('info', 'lifecycle.ready', { listen_ms: Math.round(early.listenAt), ready_ms: Math.round(performance.now()), held: held.length });
    cb?.();
  };
  if (server.listening) setImmediate(ready); else server.once('listening', ready);
  return server;
}

const inflight = new Set();
let state = 'up'; // 'up' -> 'draining'
const isStream = (res) => /^text\/event-stream/i.test(String(res.getHeader('Content-Type') || ''));
const retryMs = () => SSE_RETRY_MS + Math.floor(Math.random() * 1500);
const endStream = (res, text) => {
  if (!res.writableEnded) { try { res.write(text); res.end(); } catch { /* gone */ } }
  res.write = () => false;
};

/** First middleware. Serves /healthz and tracks in-flight responses. */
export function lifecycle(req, res, next) {
  res.setHeader('X-Wayve', '1');
  if (req.path === '/healthz' || req.url === '/healthz') {
    res.setHeader('Cache-Control', 'no-store');
    if (RELEASE) res.setHeader('X-Wayve-Release', RELEASE);
    res.statusCode = state === 'up' ? 200 : 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(state === 'up' ? 'ok' : 'draining');
  }
  if (state !== 'up') {
    res.setHeader('Connection', 'close');
    if (/text\/event-stream/.test(String(req.headers.accept || ''))) {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        return res.end(`retry: ${retryMs()}\n\n`);
      }
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '2' });
      return res.end(JSON.stringify({ error: { code: 'DRAINING', message: 'The server is restarting. Retrying shortly.', retryAfterMs: 2000 } }));
    }
  }
  inflight.add(res);
  const done = () => inflight.delete(res);
  res.once('finish', done);
  res.once('close', done);
  if (req.socket?.destroyed) { done(); return; }
  next();
}

const hooks = [];
/** Shutdown hooks run after in-flight requests finish, before the DB closes (sync). */
export const onShutdown = (fn) => { hooks.push(fn); };

/** Call once after listen(). db: node:sqlite DatabaseSync (checkpoint + close). */
export function graceful(server, { db } = {}) {
  let started = 0;
  const onSignal = (sig) => {
    if (started) { log('warn', 'lifecycle.second_signal', { sig }); process.exit(1); }
    started = Date.now();
    state = 'draining';
    server.close();
    for (const t of intervals) nativeClearInterval(t);
    intervals.clear();
    for (const t of timeouts) nativeClearTimeout(t);
    timeouts.clear();
    let sse = 0;
    for (const res of [...inflight]) {
      if (res.req?.method === 'GET' && isStream(res)) { endStream(res, `retry: ${retryMs()}\n\n`); sse++; }
      else if (!res.headersSent) res.setHeader('Connection', 'close');
    }
    log('info', 'lifecycle.drain', { sig, inflight: inflight.size - sse, drain_ms: DRAIN_MS, sse_closed: sse });
    let tick = 0, cut = 0;
    const gone = (res) => res.destroyed || !!(res.socket || res.req?.socket)?.destroyed;
    const step = () => {
      server.closeIdleConnections?.();
      const now = Date.now() - started;
      for (const res of [...inflight]) {
        if (gone(res)) { inflight.delete(res); continue; }
        if (isStream(res) && now >= STREAM_GRACE_MS && !res.writableEnded) {
          endStream(res, `event: error\ndata: ${JSON.stringify({ code: 'DRAINING', message: 'The server restarted mid-answer. Retrying.', restart: true })}\n\n`);
          inflight.delete(res); cut++;
        }
      }
      if (inflight.size && now < DRAIN_MS) { tick ||= nativeSetInterval(step, 25); return; }
      nativeClearInterval(tick);
      const left = inflight.size;
      for (const res of [...inflight]) {
        if (res.headersSent || !res.req?.complete || res.req.method === 'GET' || res.req.method === 'HEAD') continue;
        try {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
          res.end(JSON.stringify({ error: { code: 'DRAINING', message: 'We could not confirm the result. Please try again.', retryAfterMs: 2000 } }));
        } catch { /* gone */ }
      }
      nativeSetTimeout(() => { server.closeAllConnections?.(); finish(sig, left, cut); }, 200);
    };
    setImmediate(step);
  };
  const finish = (sig, left, cut) => {
    for (const fn of hooks) { try { fn(sig); } catch (e) { log('error', 'lifecycle.hook_failed', { err: String(e) }); } }
    if (db) {
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { log('error', 'lifecycle.checkpoint_failed', { err: String(e) }); }
      try { db.close(); } catch { /* closed */ }
    }
    log('info', 'lifecycle.done', { ms: Date.now() - started, cut, left });
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, onSignal);
}

export const lifecycleState = () => ({ state, inflight: inflight.size, intervals: intervals.size });
