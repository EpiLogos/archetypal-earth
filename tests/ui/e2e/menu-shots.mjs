// The shell's menu, open, at desktop and phone size: EARTH_HEADLESS=1 node tests/ui/e2e/menu-shots.mjs <outdir>
import path from 'node:path';
import { chromium } from 'playwright';
const URL = process.env.EARTH_URL ?? 'http://localhost:5183/';
const out = process.argv[2] ?? '.cache/screens/menu';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const s of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: s.mobile, isMobile: s.mobile });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('aae.landing.seen', '1'); } catch {} });
  await page.goto(URL + '#/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 45000 });
  await page.click('.sh-lens');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, `${s.name}-menu.png`) });
  const rows = await page.$$eval('.sm-row', (r) => r.map((x) => [x.dataset.lens, Math.round(x.getBoundingClientRect().height)]));
  console.log(s.name, JSON.stringify(rows));
  await ctx.close();
}
await browser.close();
