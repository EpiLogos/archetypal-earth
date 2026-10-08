import { launch, open } from './lib.mjs';
const css = process.argv[2] ?? '';
const hash = process.argv[3] ?? '#/f/serpent';
const b = await launch('chromium');
const { page } = await open(b, { width: 1440, height: 900, dpr: 2 });
await page.waitForTimeout(6000);
if (css) await page.addStyleTag({ content: css });
await page.evaluate(() => {
  window.__ft = []; let last = performance.now(); window.__on = true;
  const loop = (n) => { if (!window.__on) return; window.__ft.push(n - last); last = n; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
});
await page.evaluate((h) => { location.hash = h; }, hash);
await page.waitForTimeout(6000);
const t = await page.evaluate(() => { window.__on = false; return window.__ft.slice(2); });
console.log(css.slice(0, 50) || 'baseline', 'frames', t.length, 'max', Math.max(...t).toFixed(0), '>50:', t.filter((x) => x > 50).length, '>33:', t.filter((x) => x > 33.4).length, 'sum excess', t.filter((x) => x > 20).reduce((a, x) => a + x - 16.7, 0).toFixed(0));
await b.close();
