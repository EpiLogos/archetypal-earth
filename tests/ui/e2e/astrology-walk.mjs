// Gate (Astrology, the flagship's acceptance): enter a birthday → a planetary walk with real citations → your node beside
// Jung's → nothing left the browser. Every request the page makes is recorded; none may carry the birth (date, time or
// coordinates), and none may be anything but a GET. Desktop and phone.
//   EARTH_HEADLESS=1 node tests/ui/e2e/astrology-walk.mjs [outdir]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const URL = process.env.EARTH_URL ?? 'http://localhost:5183/';
const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
const BIRTH = { date: '1990-04-01', time: '08:30', lat: '47.37', lon: '8.54' };
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
  await page.goto(URL + '#/astrology', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 60000 });
  await page.waitForSelector('.as-form', { timeout: 30000 });
  check(await page.locator('.lp-privacy').count() > 0, `${s.name}: the lens says the data stays in this browser`);
  check(await page.locator('.as-card-h', { hasText: 'C. G. Jung' }).count() === 1, `${s.name}: Jung's chart is there before any input`);
  const before = requests.length;

  await page.fill('.as-form input[type=date]', BIRTH.date);
  await page.fill('.as-form input[type=time]', BIRTH.time);
  await page.click('.as-form details summary');
  await page.fill('.as-form input[placeholder^="Latitude"]', BIRTH.lat);
  await page.fill('.as-form input[placeholder^="Longitude"]', BIRTH.lon);
  await page.fill('.as-form input[type=number][step="0.25"]', '2');
  await page.click('.as-form button[type=submit]');
  try { await page.waitForFunction(() => location.hash.startsWith('#/astrology/you/'), null, { timeout: 15000 }); } catch { console.log('form says:', await page.evaluate(() => [location.hash, document.querySelector('.as-errors')?.textContent, [...document.querySelectorAll('.as-form input')].map((i) => i.type + '=' + i.value).join(' ')])); throw new Error('no walk'); }
  await page.waitForTimeout(2500);
  const first = await page.evaluate(() => ({ hash: location.hash, quotes: document.querySelectorAll('.lens-panel blockquote').length, cites: [...document.querySelectorAll('.lens-panel .lq-cite')].map((c) => c.textContent).slice(0, 3), who: [...document.querySelectorAll('.as-cmp-who')].map((x) => x.textContent), stored: localStorage.getItem('aae.practice.v1.charts') ?? '' }));
  check(first.hash === '#/astrology/you/moon', `${s.name}: casting opens the walk at its first planet`, first.hash);
  check(first.quotes >= 3 && first.cites.every((c) => /pdf p\d+/.test(c)), `${s.name}: the step quotes the corpus with cites`, `${first.quotes} quotes · ${first.cites.join(' | ')}`);
  check(first.who.includes('You') && first.who.includes('C. G. Jung'), `${s.name}: your place stands beside Jung's`, first.who.join(', '));
  check(first.stored.includes(BIRTH.date), `${s.name}: the chart is kept in this browser's storage`);
  if (out) await page.screenshot({ path: path.join(out, `${s.name}-walk-moon.png`) });

  for (let i = 0; i < 9; i++) { await page.click('.th-step button[aria-label="Next planet"]'); await page.waitForTimeout(400); }
  await page.waitForTimeout(2500);
  const end = await page.evaluate(() => ({ hash: location.hash, nodes: document.querySelectorAll('.as-self .as-node').length, toSelf: !!document.querySelector('.as-to-self') }));
  check(end.hash === '#/astrology/you/sun' && end.nodes === 2 && end.toSelf, `${s.name}: the walk ends at the Sun, two nodes on the Self`, JSON.stringify(end));
  if (out) await page.screenshot({ path: path.join(out, `${s.name}-walk-sun.png`) });
  await page.click('.as-to-self');
  await page.waitForTimeout(1500);
  check(await page.evaluate(() => location.hash) === '#/a/self', `${s.name}: Go to the Self opens the Self`);

  const after = requests.slice(before);
  const leaks = after.filter((r) => [BIRTH.date, BIRTH.time, '1990', BIRTH.lat, BIRTH.lon].some((v) => r.url.includes(v) || r.body.includes(v)));
  const writes = after.filter((r) => r.method !== 'GET');
  check(!leaks.length && !writes.length, `${s.name}: nothing about the birth left the browser`, `${after.length} requests after the form, ${leaks.length} carrying the birth, ${writes.length} not GET${leaks[0] ? ` (${leaks[0].url})` : ''}`);
  check(!errors.length, `${s.name}: no page errors`, errors.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
