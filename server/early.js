// Early listen — loaded via `node --import ./server/early.js server/index.ts` before any app module.
// Opens the port immediately so Fly's proxy never sees "instance refused connection" while the app boots.
// Requests that arrive meanwhile are queued and replayed by lifecycle.listen(). Imports nothing but node:http.
import http from 'node:http';
import { isMainThread } from 'node:worker_threads';

if (isMainThread) {
  const server = http.createServer();
  const queue = [];
  server.on('request', (req, res) => {
    const item = [req, res];
    queue.push(item);
    req.socket.once('close', () => {
      const i = queue.indexOf(item);
      if (i >= 0) queue.splice(i, 1);
    });
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  globalThis.__echoEarly = { server, queue, listenAt: 0 };
  server.listen(Number(process.env.PORT || 8080));
}
