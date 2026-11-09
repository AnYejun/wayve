#!/usr/bin/env node
// Gated Fly deploy: typecheck → build → fly deploy --ha=false (one machine: SQLite + in-process SSE) → wait for /healthz
// to report the new X-Wayve-Release → probe /api/health. Only then print "Deployed".
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const run = (cmd, args) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`✗ ${cmd} ${args[0] ?? ''} failed (exit ${r.status})`); process.exit(r.status ?? 1); }
};
const toml = fs.readFileSync(new URL('../fly.toml', import.meta.url), 'utf8');
const app = /^app\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
const origin = /PUBLIC_ORIGIN\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? `https://${app}.fly.dev`;
const release = `r${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`;

run('npm', ['run', 'typecheck']);
run('npm', ['run', 'build']);
run('fly', ['deploy', '--ha=false', '--app', app, '--build-arg', `RELEASE=${release}`, '--strategy', 'immediate']);

console.log(`\nWaiting for ${origin}/healthz to report release ${release} …`);
const deadline = Date.now() + 180_000;
let live = false;
while (Date.now() < deadline) {
  try {
    const r = await fetch(`${origin}/healthz`, { cache: 'no-store' });
    if (r.status === 200 && r.headers.get('x-wayve-release') === release) { live = true; break; }
  } catch { /* booting */ }
  await new Promise((r) => setTimeout(r, 2000));
}
if (!live) { console.error('\n✗ new release never became healthy'); process.exit(1); }
const h = await (await fetch(`${origin}/api/health`)).json();
console.log(`\n✓ Deployed — ${origin} · release ${release} · AI ${h.ai.enabled ? `on (${h.ai.visionModel})` : 'off (no OPENAI_API_KEY)'}`);
