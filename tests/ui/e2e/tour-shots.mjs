// Screenshots of every mode at desktop and phone size: a visual record of a pass (before/after).
// EARTH_HEADLESS=1 node tests/ui/e2e/tour-shots.mjs <outdir> [hash ...]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const URL = process.env.EARTH_URL ?? 'http://localhost:5183/';
const out = process.argv[2] ?? '.cache/screens/tour';
const hashes = process.argv.slice(3).length ? process.argv.slice(3) : ['', '#/', '#/a/self', '#/aion', '#/redbook', '#/dynamics', '#/sky', '#/graph'];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const sizes = [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }];
for (const s of sizes) {
  for (const h of hashes) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1, hasTouch: s.mobile, isMobile: s.mobile });
    const page = await ctx.newPage();
    if (h !== '') await page.addInitScript(() => { try { localStorage.setItem('aae-intro-dismissed', '1'); } catch {} });
    const logs = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) logs.push(m.text()); });
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(URL + h, { waitUntil: 'load' });
    try { await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 45000 }); } catch { logs.push('loading never finished'); }
    await page.waitForTimeout(h === '' ? 1500 : 4500);
    const name = `${s.name}-${(h || 'landing').replace(/[#/]+/g, '_').replace(/^_|_$/g, '') || 'world'}.png`;
    await page.screenshot({ path: path.join(out, name) });
    console.log(name, logs.length ? `ERR ${logs.slice(0, 3).join(' | ')}` : 'ok');
    await ctx.close();
  }
}
await browser.close();
