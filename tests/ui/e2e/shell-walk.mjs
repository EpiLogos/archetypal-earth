// The shell, clicked through like a person: open the menu, choose each lens, check the state, the title and that no
// error was logged; Escape steps back. Desktop and phone. EARTH_HEADLESS=1 node tests/ui/e2e/shell-walk.mjs [outdir]
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

const URL = process.env.EARTH_URL ?? 'http://localhost:5183/';
const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++; };

for (const s of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: s.mobile, isMobile: s.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|127\.0\.0\.1:5187/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem('aae-intro-dismissed', '1'); } catch {} });
  await page.goto(URL + '#/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 60000 });
  const lenses = await page.$$eval('.sm-row', (r) => r.map((x) => x.dataset.lens));
  check(lenses.length >= 4, `${s.name}: the menu lists the lenses`, lenses.join(', '));
  check(await page.$$eval('h1', (h) => h.length) === 1, `${s.name}: one h1 on the page`);
  for (const id of lenses) {
    await page.click('.sh-lens');
    await page.waitForSelector('#shell-menu:not([hidden])');
    const tap = await page.$eval(`.sm-row[data-lens="${id}"]`, (x) => x.getBoundingClientRect().height);
    if (s.mobile) check(tap >= 44, `${s.name}: the ${id} row is a 44px target`, `${Math.round(tap)}px`);
    await page.click(`.sm-row[data-lens="${id}"]`);
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => ({ lens: document.body.dataset.lens, hash: location.hash, title: document.title, h1: document.querySelectorAll('h1').length, menu: !document.getElementById('shell-menu').hidden }));
    check(st.lens === id && !st.menu, `${s.name}: ${id} opens from the menu`, `${st.hash} · "${st.title}"`);
    check(st.h1 === 1, `${s.name}: ${id} keeps one h1`, String(st.h1));
    if (out) await page.screenshot({ path: path.join(out, `${s.name}-${id}.png`) });
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  check(await page.evaluate(() => document.body.dataset.lens) === 'field', `${s.name}: Escape steps back to the Field`);
  check(!errors.length, `${s.name}: no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
