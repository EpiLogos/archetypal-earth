// Shared helpers for the browser walks (screens, frame-rate, WebKit smoke).
// Run against a dev server:  npx vite --port 5183 --strictPort &
import { chromium, webkit } from 'playwright';

export const URL = process.env.EARTH_URL ?? 'http://localhost:5183/';

export async function launch(kind = 'chromium', { headed = true } = {}) {
  if (kind === 'webkit') return webkit.launch({ headless: !headed });
  return chromium.launch({
    headless: !headed,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
  });
}

export async function open(browser, { width = 1440, height = 900, dpr = 1, hash = '', mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(URL + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__earth && window.__earth.engine && window.__earth.engine.presences, null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
  // the entry dialog shows once per fresh context: walk through it like a person
  const intro = page.locator('#intro:not(.dismissed)');
  if (await intro.count()) await page.getByRole('button', { name: 'Enter the globe' }).click();
  await page.waitForTimeout(600);
  return { ctx, page, logs };
}

/** Put the camera somewhere (instantly) and let the frame, tiles and fades settle. */
export async function look(page, lat, lon, dist, settle = 2500) {
  await page.evaluate(([la, lo, d]) => {
    const { engine } = window.__earth;
    engine.rig.interacted = true;
    document.body.classList.add('interacted');
    engine.rig.flyTo(la, lo, d, { instant: true });
  }, [lat, lon, dist]);
  await page.waitForTimeout(settle);
}

export async function waitTiles(page, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => ({ ...window.__earth.engine.tiles.stats }));
    if (s.wanted > 0 && s.inflight === 0 && s.drawn > 0) {
      await page.waitForTimeout(700);
      return page.evaluate(() => ({ ...window.__earth.engine.tiles.stats }));
    }
    if (Date.now() - t0 > timeout) return s;
    await page.waitForTimeout(150);
  }
}
