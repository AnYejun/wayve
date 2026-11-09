// Print-ready QR sheets (A4 PDF) and a front-screen image (1920×1080 PNG), rendered with headless Chrome.
// Usage: node scripts/qr-sheet.mjs <spec.json> <outDir>
//   spec: { event: "compiled:17", venue: "Startup Branch", cards: [{ kind: "attendee"|"staff"|"camera"|"scribe", url, title?, note?, steps?: [] }] }
//   attendee → an A4 poster + a page of 4 table cards + screen.png;  every other card → one A6 card (4 per A4 page).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';

const [specPath, outDir = 'data/print'] = process.argv.slice(2);
if (!specPath) { console.error('usage: node scripts/qr-sheet.mjs <spec.json> <outDir>'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const qr = (url) => renderToStaticMarkup(createElement(QRCodeSVG, { value: url, size: 1024, level: 'Q', marginSize: 0, fgColor: '#17150f', bgColor: '#ffffff' }));
const shortUrl = (u) => u.replace(/^https?:\/\//, '').replace(/\?as=guest$/, '');
const MARK = '<svg viewBox="0 0 32 20" fill="none"><path d="M2 15.5c3.2 0 4.4-9 8.2-9 3.6 0 4 7 7.4 7 3.1 0 4.3-8 7.4-10.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const brand = (cls = '') => `<div class="brand ${cls}">${MARK}<span>WAYVE</span></div>`;
const where = [spec.event, spec.venue].filter(Boolean).map(esc).join(' · ');

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff;color:#17150f;font-family:-apple-system,"SF Pro Display","Helvetica Neue",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.brand{display:flex;align-items:center;gap:.3em;font-weight:800;letter-spacing:-.02em;line-height:1}
.brand svg{width:1.5em;height:.95em}
.qr svg{display:block;width:100%;height:100%}
.pill{display:inline-block;padding:.45em .9em;border-radius:999px;background:#f4f3f1;font-weight:600;color:#3f3c36}
.muted{color:#6b6760}
`;

function posterHtml(card) {
  return `<section class="page poster">
  <div class="top">${brand('b')}<div class="where muted">${where}</div></div>
  <h1>${esc(card.title ?? 'Ask WAYVE.')}</h1>
  <p class="sub">${esc(card.note ?? 'Schedule, venue, help — anything about the event, answered live.')}</p>
  <div class="qrbox"><div class="qr">${qr(card.url)}</div></div>
  <div class="url">${esc(shortUrl(card.url))}</div>
  <div class="foot"><span class="pill">Point your phone camera</span><span class="pill">No app, no sign-up</span><span class="pill">Korean or English</span></div>
</section>`;
}

function smallCard(card) {
  const head = { attendee: 'Ask WAYVE', staff: 'Staff · join the radio', camera: 'Camera spot', scribe: 'Scribe spot' }[card.kind] ?? 'WAYVE';
  const steps = (card.steps ?? []).map((s) => `<li>${esc(s)}</li>`).join('');
  return `<div class="card k-${esc(card.kind)}">
    <div class="ctop">${brand('cb')}<span class="tag">${esc(head)}</span></div>
    <div class="ctitle">${esc(card.title ?? '')}</div>
    ${card.note ? `<div class="cnote muted">${esc(card.note)}</div>` : ''}
    <div class="cqr qr">${qr(card.url)}</div>
    ${steps ? `<ol class="steps">${steps}</ol>` : `<div class="curl">${esc(shortUrl(card.url))}</div>`}
    <div class="cwhere muted">${where}</div>
  </div>`;
}

const PAGE_CSS = `${CSS}
@page{size:A4;margin:0}
.page{width:210mm;height:297mm;page-break-after:always;overflow:hidden;position:relative}
.page:last-child{page-break-after:auto}
.poster{padding:17mm 18mm 15mm;display:flex;flex-direction:column}
.poster .top{display:flex;align-items:center}
.poster .b{font-size:8.6mm}
.poster .where{margin-left:auto;font-size:4.2mm;font-weight:600}
.poster h1{margin-top:15mm;font-size:22mm;line-height:.98;letter-spacing:-.04em;font-weight:800}
.poster .sub{margin-top:5mm;font-size:6.2mm;line-height:1.32;color:#4a4741;font-weight:500;max-width:160mm}
.poster .qrbox{margin:11mm auto 0;width:130mm;height:130mm;padding:7mm;border-radius:7mm;box-shadow:inset 0 0 0 .45mm rgba(23,21,15,.16)}
.poster .qr{width:100%;height:100%}
.poster .url{text-align:center;margin-top:6mm;font-size:6mm;font-weight:700;letter-spacing:.01em}
.poster .foot{margin-top:auto;display:flex;gap:3mm;justify-content:center;font-size:4.3mm}
.grid{display:grid;grid-template-columns:105mm 105mm;grid-template-rows:148.5mm 148.5mm}
.card{position:relative;padding:8mm 9mm 7mm;display:flex;flex-direction:column;border-right:.25mm dashed #c9c6c0;border-bottom:.25mm dashed #c9c6c0}
.card:nth-child(2n){border-right:0}.card:nth-child(n+3){border-bottom:0}
.ctop{display:flex;align-items:center}
.cb{font-size:5mm}
.tag{margin-left:auto;font-size:3.2mm;font-weight:700;padding:1.2mm 2.6mm;border-radius:99mm;background:#17150f;color:#fff;white-space:nowrap}
.k-attendee .tag{background:#f4f3f1;color:#17150f}
.ctitle{margin-top:5mm;font-size:7.4mm;line-height:1.05;font-weight:800;letter-spacing:-.025em}
.cnote{margin-top:1.6mm;font-size:3.5mm;line-height:1.3;font-weight:500}
.cqr{margin:4.5mm auto 0;width:66mm;height:66mm}
.curl{margin-top:3.5mm;text-align:center;font-size:3.6mm;font-weight:700}
.steps{margin:3.5mm 0 0 4.2mm;font-size:3.1mm;line-height:1.38;font-weight:500;color:#3f3c36}
.cwhere{margin-top:auto;font-size:2.8mm;font-weight:600}
`;

function screenHtml(card) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
html,body{width:1920px;height:1080px;overflow:hidden}
.s{display:grid;grid-template-columns:1fr 800px;height:1080px;padding:96px 110px;gap:90px;align-items:center;background:#fff}
.sb{font-size:46px}
.sw{margin-top:22px;font-size:26px;font-weight:600}
.sh{margin-top:90px;font-size:124px;line-height:.98;letter-spacing:-.045em;font-weight:800}
.ss{margin-top:34px;font-size:36px;line-height:1.3;color:#4a4741;font-weight:500;max-width:760px}
.su{margin-top:56px;font-size:40px;font-weight:700}
.sp{margin-top:34px;display:flex;gap:14px;font-size:24px}
.sq{width:800px;height:800px;padding:44px;border-radius:44px;box-shadow:inset 0 0 0 3px rgba(23,21,15,.14)}
</style></head><body><div class="s"><div>
  ${brand('sb')}<div class="sw muted">${where}</div>
  <div class="sh">${esc(card.screenTitle ?? 'Ask WAYVE<br>anything.').replace(/&lt;br&gt;/g, '<br>')}</div>
  <div class="ss">${esc(card.screenNote ?? 'Scan with your phone camera — the event assistant answers live, in Korean or English.')}</div>
  <div class="su">${esc(shortUrl(card.url))}</div>
  <div class="sp"><span class="pill">No app</span><span class="pill">No sign-up</span><span class="pill">Korean or English</span></div>
</div><div class="sq qr">${qr(card.url)}</div></div></body></html>`;
}

const chrome = (args) => execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', ...args], { stdio: 'pipe', timeout: 60_000 });
const out = [];
const attendee = spec.cards.filter((c) => c.kind === 'attendee');
const others = spec.cards.filter((c) => c.kind !== 'attendee');
const pages = [];
for (const a of attendee) { pages.push(posterHtml(a)); pages.push(`<section class="page grid">${[a, a, a, a].map(smallCard).join('')}</section>`); }
for (let i = 0; i < others.length; i += 4) pages.push(`<section class="page grid">${others.slice(i, i + 4).map(smallCard).join('')}</section>`);
const name = spec.name ?? 'qr-sheet';
const html = path.resolve(outDir, `${name}.html`);
fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title><style>${PAGE_CSS}</style></head><body>${pages.join('\n')}</body></html>`);
const pdf = path.resolve(outDir, `${name}.pdf`);
chrome(['--no-pdf-header-footer', `--print-to-pdf=${pdf}`, `file://${html}`]);
out.push(pdf);
for (const a of attendee) {
  const sh = path.resolve(outDir, `${name}-screen.html`);
  fs.writeFileSync(sh, screenHtml(a));
  const png = path.resolve(outDir, `${name}-screen.png`);
  chrome([`--screenshot=${png}`, '--window-size=1920,1080', `file://${sh}`]);
  out.push(png);
}
console.log(out.join('\n'));
