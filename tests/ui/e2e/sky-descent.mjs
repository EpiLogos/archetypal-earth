// Gate: leaving the sky by a tie lands on the tied node's framing, not the sky camera carried down (audit S1).
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/sky-descent.mjs [chromium|webkit]
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

const pose = (page) => page.evaluate(() => {
  const { engine, ctl } = window.__earth;
  return { lat: engine.rig.lat, lon: engine.rig.lon, dist: engine.rig.dist, flying: engine.rig.flying, sky: !!ctl.state.sky, hash: location.hash };
});

// settled: no flight running and the pose still across two samples (software GL can stall a frame or two)
const settle = async (page, ms = 60000) => {
  const t0 = Date.now();
  let prev = null;
  for (;;) {
    await page.waitForTimeout(300);
    const s = await pose(page);
    const still = prev && Math.abs(s.lat - prev.lat) < 1e-3 && Math.abs(s.lon - prev.lon) < 1e-3 && Math.abs(s.dist - prev.dist) < 1e-3;
    if (!s.flying && still) return { ...s, took: Date.now() - t0 };
    if (Date.now() - t0 > ms) return { ...s, took: Date.now() - t0, timedOut: true };
    prev = s;
  }
};

const browser = await launch(kind, { headed: false });
try {
  // ── the reference: the node framed by a focus reached in-app from the plain world ──
  // (a cold link frames the first entry at its own distance; the in-app focus is what a tie is compared with)
  const ref = await open(browser, { width: 1280, height: 800 });
  await ref.page.waitForFunction(() => window.__earth?.engine?.rig, null, { timeout: 30000 });
  await ref.page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
  await ref.page.evaluate(() => { location.hash = '#/f/sol-niger'; });
  await ref.page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'focus', null, { timeout: 15000 });
  const direct = await settle(ref.page);
  check(!direct.timedOut && direct.dist < 4, 'a focus on Sol niger from the plain world frames it', `lat ${direct.lat.toFixed(2)}, lon ${direct.lon.toFixed(2)}, dist ${direct.dist.toFixed(2)}`);
  await ref.ctx.close();

  // ── the walk: Saturn's card, then its Sol niger tie ───────────────────
  const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash: '#/sky/saturn' });
  const opened = await settle(page);
  check(opened.sky && !opened.timedOut, 'the link #/sky/saturn opens the sky with Saturn\'s card', `hash "${opened.hash}"`);
  await page.waitForSelector('.sky-card[aria-hidden="false"] .sky-tie-head button', { timeout: 15000 });
  const tie = page.locator('.sky-card .sky-tie-head button', { hasText: /sol niger/i });
  check((await tie.count()) === 1, 'Saturn\'s card carries a Sol niger tie');
  await tie.first().click();
  await page.waitForTimeout(300);
  const landed = await settle(page);
  check(!landed.sky && landed.hash === '#/f/sol-niger', 'the tie leaves the sky for #/f/sol-niger', `hash "${landed.hash}", sky ${landed.sky}`);
  check(!landed.timedOut, 'the camera flight to the node ends', `${landed.took} ms`);
  const dLat = Math.abs(landed.lat - direct.lat);
  const dLon = Math.abs(((landed.lon - direct.lon + 540) % 360) - 180);
  const dDist = Math.abs(landed.dist - direct.dist);
  check(dLat < 1 && dLon < 1, 'the camera lands on Sol niger\'s framing (lat/lon within 1°)',
    `tie → lat ${landed.lat.toFixed(2)}, lon ${landed.lon.toFixed(2)}; direct → lat ${direct.lat.toFixed(2)}, lon ${direct.lon.toFixed(2)}`);
  check(dDist < 0.3, 'and at its distance (within 0.3)', `tie ${landed.dist.toFixed(2)} vs direct ${direct.dist.toFixed(2)}`);
  check(!logs.some((l) => /pageerror/i.test(l)), 'no page errors', logs.filter((l) => /pageerror/i.test(l)).join(' | ').slice(0, 300));
  await ctx.close();

  // ── the plain leave still descends (S out of the sky) ────────────────
  const plain = await open(browser, { width: 1280, height: 800, hash: '#/sky' });
  await plain.page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
  await settle(plain.page);
  await plain.page.keyboard.press('s');
  const down = await settle(plain.page);
  check(!down.sky && down.dist < 8 && !down.timedOut, 'S leaves the sky and descends to the Earth', `dist ${down.dist.toFixed(2)}`);
  await plain.ctx.close();
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
