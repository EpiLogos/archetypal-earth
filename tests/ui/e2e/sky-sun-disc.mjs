// Gate (audit S2/#2): the Sun's disc. Un-approached, the Sun keeps the Phase-1 look at every camera distance: a glow
// with a core of (9 + 14·(1 − handoff)) device px (23 px in the lunar stage). Only as the approached body (its card open)
// does it grow to its true disc, scaled by the approach weight. Core diameters are read from the live layer.
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/sky-sun-disc.mjs [chromium|webkit]
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

// the Sun's core diameter in CSS px, and its true disc in CSS px (the layer's own geometry, recomputed here)
const sunDisc = (page) => page.evaluate(() => {
  const { engine } = window.__earth;
  const layer = engine.sky;
  const d = layer.draws.get('sun');
  const dpr = window.devicePixelRatio || 1;
  const cam = engine.camera;
  const tanH = Math.tan((cam.fov * Math.PI) / 360);
  const pxPerRad = (engine.height * dpr * 0.5) / tanH;
  const dist = d.mesh.position.distanceTo(cam.position);
  const truePx = ((2 * 696000 / 6371.0084) / Math.max(dist, 1e-3)) * pxPerRad / dpr;
  return { core: d.mat.uniforms.uCorePx.value / dpr, truePx, approach: layer.approach, stage: engine.stageDist, rig: engine.rig.dist };
});

const browser = await launch(kind, { headed: false });
try {
  const { ctx, page, logs } = await open(browser, { width: 1280, height: 800 });
  await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); window.__earth.ctl.toggleSky(); });
  await page.waitForTimeout(1500);

  // ── un-approached: the pre-Phase-4 core at each distance ──
  const want = [[30, 23], [15805, 9], [9000, 9], [5000, 9], [3200, 9], [2000, 11]];
  for (const [d, expected] of want) {
    const s = await page.evaluate((dd) => {
      const { engine } = window.__earth;
      engine.rig.flyTo(20, 20, dd, { instant: true });
      return true;
    }, d);
    await page.waitForTimeout(900);
    const r = await sunDisc(page);
    check(s && Math.round(r.core) === expected && r.approach === 0,
      `un-approached Sun at stage distance ${d} R⊕ has core ${expected} px (the pre-Phase-4 look)`,
      `core ${r.core.toFixed(2)} px, true disc ${r.truePx.toFixed(1)} px, stage ${r.stage.toFixed(0)}`);
  }

  // ── approached: the Sun grows to its true disc, as the card's approach eases in ──
  await page.evaluate(() => { window.__earth.engine.rig.flyTo(20, 20, 15805, { instant: true }); window.__earth.ctl.openBody('sun'); });
  await page.waitForFunction(() => window.__earth.ctl.state.sky?.body === 'sun', null, { timeout: 15000, polling: 100 });
  await page.waitForFunction(() => window.__earth.engine.sky.approach > 0.995, null, { timeout: 60000, polling: 150 }).catch(() => {});
  await page.waitForTimeout(400);
  const ap = await sunDisc(page);
  check(ap.approach > 0.95 && ap.core > 9 * 1.5 && Math.abs(ap.core - ap.truePx) < 0.1 * ap.truePx,
    'approached Sun (card open) grows to its true disc', `core ${ap.core.toFixed(1)} px vs true ${ap.truePx.toFixed(1)} px, approach ${ap.approach.toFixed(2)}`);

  // ── released: the Sun shrinks back to its glow disc as the approach eases out ──
  await page.evaluate(() => window.__earth.ctl.navigate({ view: { kind: 'world' }, deep: false, sky: {} }));
  await page.waitForFunction(() => window.__earth.engine.sky.approach < 0.005, null, { timeout: 60000, polling: 150 }).catch(() => {});
  await page.waitForTimeout(400);
  const rel = await sunDisc(page);
  check(rel.approach < 0.01 && Math.round(rel.core) <= 9, 'released from the card, the Sun returns to its glow disc', `core ${rel.core.toFixed(2)} px, approach ${rel.approach.toFixed(3)}`);

  const errs = logs.filter((l) => /pageerror/.test(l));
  check(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all sky-sun-disc checks passed');
process.exit(failed ? 1 : 0);
