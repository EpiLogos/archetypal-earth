// Shared helpers for the browser walks (screens, frame-rate, WebKit smoke).
// Run against a dev server:  npx vite --port 5183 --strictPort &
import { chromium, webkit } from 'playwright';

export const URL = process.env.EARTH_URL ?? 'http://localhost:5183/';

// EARTH_HEADLESS=1 runs without a display (a cloud clone): software GL through the system Chromium.
const CLOUD = process.env.EARTH_HEADLESS === '1';
// EARTH_HEADED=0 runs headless on this machine's own GPU (a local run that must not open windows)
const HEADED = !CLOUD && process.env.EARTH_HEADED !== '0';

export async function launch(kind = 'chromium', { headed = HEADED } = {}) {
  if (kind === 'webkit') return webkit.launch({ headless: !headed });
  if (CLOUD) {
    return chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
  }
  return chromium.launch({
    headless: !headed,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
  });
}

export async function open(browser, { width = 1440, height = 900, dpr = 1, hash = '', mobile = false, landing = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  // the landing shows once per browser; a walk starts past it unless it is what the walk is about
  if (!landing) await page.addInitScript(() => { try { localStorage.setItem('aae.landing.seen', '1'); } catch {} });
  const logs = [];
  // where a warning was raised is named with it (a bare 'Failed to fetch' says nothing of which fetch)
  // (the dev server's own client, /@vite/client, warns when its ping to the server drops; that is not the app's)
  // (nor is the browser's own GL driver performance note, 'GPU stall due to ReadPixels', raised by a screenshot of a WebGL page)
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/\/@vite\/client/.test(m.location()?.url ?? '') && !/^\[\.WebGL-[^\]]*\]GL Driver Message \(OpenGL, Performance,/.test(m.text())) { const at = m.location(); logs.push(`${m.type()}: ${m.text()}${at?.url ? ` @ ${at.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')}:${at.lineNumber}` : ''}`); } });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  // a failed request is named, so a 'Failed to fetch' warning says which (map tiles and web fonts the sandbox cannot
  // reach are not counted, nor a cancelled one: a fetch the app retries, a lazy image dropped, says nothing by itself;
  // if the app gives up it warns, and that is counted)
  page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_ABORTED' && !/gibs|earthdata|tile|openstreetmap|fonts\.(gstatic|googleapis)/i.test(r.url())) logs.push(`requestfailed: ${r.failure()?.errorText} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)}`); });
  await page.goto(URL + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__earth && window.__earth.engine && window.__earth.engine.presences, null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
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

/** A lens's reading stands in the pane (the pane is a reading, not Contents). */
export const paneReading = (page) => page.evaluate(() => document.body.classList.contains('pane-reading'));

/**
 * Open the standing lens's Contents from its trigger and pick an entry: the one the lens stands on (marked current) or the
 * `nth` entry. A pick is a request to read, so the pane then holds a reading.
 */
export async function openFromContents(page, nth) {
  // (a list another lens left in the pane is hidden, not open)
  if (!(await page.locator('.dp-contents-pane li button').first().isVisible())) await page.click('.sh-contents');
  await page.waitForSelector('.dp-contents-pane li button', { timeout: 8000 });
  const pick = nth === undefined ? page.locator('.dp-contents-pane li button[aria-current="true"]') : page.locator('.dp-contents-pane li button').nth(nth);
  await (nth === undefined && !(await pick.count()) ? page.locator('.dp-contents-pane li button').first() : pick.first()).click();
  await page.waitForTimeout(900);
}

/**
 * A panel lens's reading is held until the person asks for it: every lens has its Contents in the pane (a trigger beside the
 * title), and a pick from it reads in the pane. Does nothing when the reading is already on screen.
 */
export async function revealSheet(page, _label) {
  if (await paneReading(page)) return;
  await page.waitForSelector('.sh-contents:not([hidden])', { timeout: 10000 });
  await openFromContents(page);
  await page.waitForTimeout(600);
}
