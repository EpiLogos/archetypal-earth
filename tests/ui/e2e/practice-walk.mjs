// Gate (the practice tools): Dreams — record → the images picked out → an image opens its corpus parallels → the
// compensation answer is kept; Symbols — any word → family → dated instances; Coincidences — log twice with one image →
// the series row. Throughout: what the person writes never leaves the browser (every request is recorded and checked).
//   EARTH_HEADLESS=1 node tests/ui/e2e/practice-walk.mjs [outdir]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const URL = process.env.EARTH_URL ?? 'http://localhost:5183/';
const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
const DREAM = 'I was walking by a river at night and two snakes came out of an old tower. A woman gave me a golden ring.';
const SECRET = ['walking by a river', 'snakes came', 'golden ring', 'my sister phoned', 'scarab'];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++; };

for (const s of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: s.mobile, isMobile: s.mobile });
  const page = await ctx.newPage();
  const requests = [];
  const errors = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' }));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('aae.landing.seen', '1'); } catch {} });
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(1200); };
  await page.goto(URL + '#/dreams', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 60000 });
  await page.waitForSelector('.lens-panel .lp-privacy', { timeout: 30000 });
  const before = requests.length;

  // Dreams
  await page.click('.lens-panel .lp-btn.primary');
  await page.waitForSelector('.dr-form textarea');
  await page.fill('.dr-form textarea >> nth=0', DREAM);
  await page.fill('.dr-form textarea >> nth=1', 'Waiting to hear about a new job; my sister phoned that week.');
  await page.click('.dr-form button[type=submit]');
  await page.waitForSelector('.dr-text', { timeout: 15000 });
  const imgs = await page.$$eval('.dr-img', (b) => b.map((x) => x.textContent));
  check(imgs.length >= 3 && imgs.includes('snakes') && imgs.includes('river'), `${s.name}: the dream's images are picked out in the field's names`, imgs.join(', '));
  if (out) await page.screenshot({ path: path.join(out, `${s.name}-dream.png`) });
  await page.click('.dr-img:text("snakes")');
  await page.waitForSelector('.am-dream', { timeout: 15000 });
  const amp = await page.evaluate(() => ({ hash: location.hash, dreams: document.querySelectorAll('.am-dream').length, cites: document.querySelectorAll('.am-dream .lq-cite').length, h: document.querySelector('.lens-panel .lp-h')?.textContent }));
  check(amp.h === 'Serpent' && amp.dreams >= 3 && amp.cites >= 3, `${s.name}: the image opens the corpus's dreams of it, cited`, JSON.stringify(amp));
  if (out) await page.screenshot({ path: path.join(out, `${s.name}-dream-image.png`) });
  await page.click('.am-back');
  await page.waitForSelector('.dr-text');
  await page.fill('.am-sec textarea', 'Maybe the waiting: the dream says what I keep calm about by day.');
  await page.locator('.am-sec textarea').blur();
  await page.waitForTimeout(400);
  const kept = await page.evaluate(() => localStorage.getItem('aae.practice.v1.dreams') ?? '');
  check(kept.includes('snakes') && kept.includes('keep calm'), `${s.name}: the dream and the answer are kept in this browser`);

  // Symbols
  await go('#/symbols');
  await page.fill('.sy-search input', 'tow');
  await page.waitForTimeout(300);
  await page.click('.sy-results button >> nth=0');
  await page.waitForSelector('.am-list li', { timeout: 15000 });
  const sym = await page.evaluate(() => ({ hash: location.hash, n: document.querySelectorAll('.am-list li').length, h: document.querySelector('.lens-panel .lp-h')?.textContent }));
  check(sym.hash === '#/symbols/tower' && sym.n >= 1, `${s.name}: a word finds its family and its dated instances`, JSON.stringify(sym));

  // Coincidences
  for (const [inner, outer] of [['I dreamed of a golden beetle', 'A beetle flew against the window'], ['A scarab in a book I was reading', 'My sister phoned about a scarab brooch']]) {
    await go('#/coincidences/new');
    await page.waitForSelector('.dr-form');
    await page.fill('.dr-form textarea >> nth=0', inner);
    await page.fill('.dr-form textarea >> nth=1', outer);
    await page.fill('.dr-form input[type=text]', 'scarab');
    await page.waitForTimeout(300);
    const tie = page.locator('.co-suggest .sf-pill', { hasText: 'Scarab' });
    if (await tie.count()) await tie.first().click();
    await page.click('.dr-form button[type=submit]');
    await page.waitForTimeout(800);
  }
  await go('#/coincidences');
  await page.waitForSelector('.co-chart');
  const co = await page.evaluate(() => ({ dots: document.querySelectorAll('.co-dot').length, series: [...document.querySelectorAll('.co-row.series')].map((t) => t.textContent), runs: document.querySelectorAll('.co-run').length }));
  check(co.dots === 2 && co.series.includes('Scarab') && co.runs === 1, `${s.name}: two entries with one image draw a series`, JSON.stringify(co));
  if (out) await page.screenshot({ path: path.join(out, `${s.name}-coincidences.png`) });

  const after = requests.slice(before);
  const leaks = after.filter((r) => SECRET.some((v) => r.url.toLowerCase().includes(v) || r.body.toLowerCase().includes(v)));
  const writes = after.filter((r) => r.method !== 'GET');
  check(!leaks.length && !writes.length, `${s.name}: nothing written left the browser`, `${after.length} requests, ${leaks.length} carrying entries, ${writes.length} not GET`);
  check(!errors.length, `${s.name}: no page errors`, errors.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
