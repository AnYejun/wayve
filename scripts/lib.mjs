// Shared helpers for smoke scripts: a cookie jar that keeps every cookie (device token `wv` + account session `wv_u`).
export function jar() {
  const cookies = new Map();
  return {
    get: () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    set: (res) => {
      const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
      for (const c of list) {
        const m = /^([^=]+)=([^;]*)/.exec(c);
        if (!m) continue;
        if (/max-age=0/i.test(c) || m[2] === '') cookies.delete(m[1]); else cookies.set(m[1], m[2]);
      }
    },
  };
}

export function client(BASE) {
  async function call(j, method, path, body, raw) {
    const headers = { cookie: j.get() };
    let b;
    if (raw) { b = raw.data; headers['content-type'] = raw.type; } else if (body !== undefined && body !== null) { b = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const t0 = Date.now();
    const r = await fetch(BASE + path, { method, headers, body: b });
    j.set(r);
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, ms: Date.now() - t0, json, headers: r.headers };
  }
  /** Create an account (unique username per run) and sign in on this jar. */
  async function signup(j, displayName) {
    const username = `${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}${Math.random().toString(36).slice(2, 7)}`;
    const r = await call(j, 'POST', '/api/auth/signup', { username, password: 'correct-horse-9', displayName });
    if (r.status !== 200) throw new Error(`signup ${displayName} → ${r.status} ${JSON.stringify(r.json)}`);
    return { username, user: r.json.user };
  }
  return { call, signup };
}

export const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) process.exitCode = 1; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
