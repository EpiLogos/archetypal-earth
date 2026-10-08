// Gate: the sky as a scale of the globe — one gesture out and back, S, Back, deep links, reduced motion, frame budget.
//   npx vite --port 5183 --strictPort &
//   node tests/ui/e2e/sky-journey.mjs [chromium|webkit]
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

const snap = (page) => page.evaluate(() => {
  const { engine, ctl } = window.__earth;
  const b = ctl.state.sky?.body;
  return {
    dist: engine.rig.dist, lat: engine.rig.lat, lon: engine.rig.lon, flying: engine.rig.flying,
    sky: !!ctl.state.sky, body: b ?? null, hash: location.hash, hist: history.length,
    camDir: engine.camera.position.clone().sub(engine.rig.focus).normalize().toArray(),
    visible: !!engine.sky?.group.visible,
  };
});

const settle = async (page, ms = 12000) => {
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(150);
    const s = await snap(page);
    if (!s.flying) return { ...s, took: Date.now() - t0 };
    if (Date.now() - t0 > ms) return { ...s, took: Date.now() - t0, timedOut: true };
  }
};

const wheelTo = async (page, pred, dy, maxSteps = 400) => {
  let s = await snap(page);
  for (let i = 0; i < maxSteps && !pred(s); i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(16);
    s = await snap(page);
  }
  await page.waitForTimeout(400);
  return snap(page);
};

const angle = (a, b) => (Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

const browser = await launch(kind, { headed: false });
try {
  // ── one gesture, out and back ──────────────────────────────────────────
  {
    const { page, logs } = await open(browser, { width: 1280, height: 800 });
    await page.mouse.move(640, 400);
    await page.evaluate(() => { const { engine } = window.__earth; engine.rig.interacted = true; document.body.classList.add('interacted'); engine.rig.flyTo(30, 20, 3, { instant: true }); });
    await page.waitForTimeout(800);
    const start = await snap(page);
    const frames = [];
    await page.evaluate(() => { window.__ft = []; let last = performance.now(); const f = (t) => { window.__ft.push(t - last); last = t; window.__raf = requestAnimationFrame(f); }; window.__raf = requestAnimationFrame(f); });

    // out: sign of the wheel found by trying it
    const out = await wheelTo(page, (s) => s.dist > 4000, 140);
    check(out.dist > 4000, 'wheel carries the camera out past the handoff in one gesture', `dist ${out.dist.toFixed(0)}`);
    check(out.sky && out.hash === '#/sky', 'the sky flag and #/sky follow the gesture', `hash "${out.hash}"`);
    check(out.visible, 'the sky layer is drawn');
    const stages = [];
    const histAfterOut = out.hist;

    const back = await wheelTo(page, (s) => s.dist < 3.2, -140);
    check(back.dist < 3.3, 'wheel carries it back down to the Earth', `dist ${back.dist.toFixed(2)}`);
    check(!back.sky && ['', '#/', '#'].includes(back.hash), 'the sky flag clears and the hash returns', `hash "${back.hash}"`);
    check(back.hist === histAfterOut, 'gesture exit replaces the hash — no history entry for coming home', `history ${histAfterOut}→${back.hist}`);
    const lost = angle(start.camDir, back.camDir);
    check(lost < 0.6, 'no orientation loss over the round trip', `camera direction moved ${lost.toFixed(3)}°; lat ${start.lat.toFixed(2)}→${back.lat.toFixed(2)}, lon ${start.lon.toFixed(2)}→${back.lon.toFixed(2)}`);

    const ft = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__ft.slice(5); });
    ft.sort((a, b) => a - b);
    const p = (q) => ft[Math.min(ft.length - 1, Math.floor(q * ft.length))];
    console.log(`     frame intervals through the whole gesture (${ft.length} frames): median ${p(0.5).toFixed(1)} ms, p95 ${p(0.95).toFixed(1)} ms, max ${ft[ft.length - 1].toFixed(1)} ms`);
    check(p(0.5) < 34 && p(0.95) < 70, 'frame budget held through the handoff (median < 34 ms, p95 < 70 ms)');
    check(!logs.some((l) => /error/i.test(l)), 'no console errors', logs.join(' | ').slice(0, 300));
    await page.context().close();
  }

  // ── S, Back, deep links ────────────────────────────────────────────────
  {
    const { page } = await open(browser, { width: 1280, height: 800 });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.keyboard.press('s');
    const a = await settle(page);
    check(a.sky && a.hash === '#/sky', 'S enters the sky', `hash "${a.hash}"`);
    check(a.dist > 8000 && !a.timedOut, 'S flies to the system home', `dist ${a.dist.toFixed(0)} in ${a.took} ms`);
    await page.goBack();
    const b = await settle(page);
    check(!b.sky && b.dist < 8, 'Back from the system flies to the Earth', `dist ${b.dist.toFixed(2)}, sky ${b.sky}`);
    await page.keyboard.press('s');
    await settle(page);
    await page.keyboard.press('s');
    const c = await settle(page);
    check(!c.sky && c.dist < 8, 'S again leaves the sky', `dist ${c.dist.toFixed(2)}`);
    await page.context().close();

    const m = await open(browser, { width: 1280, height: 800, hash: '#/sky/moon' });
    const d = await settle(m.page);
    check(d.sky && d.body === 'moon' && d.dist > 8000, 'the link #/sky/moon opens the system with the Moon selected', `body ${d.body}, dist ${d.dist.toFixed(0)}`);
    await m.page.context().close();

    const v = await open(browser, { width: 1280, height: 800, hash: '#/sky/vulcan' });
    const e = await settle(v.page);
    check(e.sky && e.body === null, 'an unknown body in a link opens the plain sky, honestly', `body ${e.body}`);
    await v.page.context().close();
  }

  // ── the whole system is in frame at home, on a wide and a narrow screen ──
  for (const [w, h, label] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
    const { page } = await open(browser, { width: w, height: h, mobile: label === 'phone' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.evaluate(() => window.__earth.ctl.toggleSky());
    await settle(page);
    const where = await page.evaluate(() => window.__earth.engine.sky.screenBodies().map((b) => [b.key, b.x, b.y]));
    const out = where.filter(([, x, y]) => x < 0 || y < 0 || x > w || y > h).map(([k]) => k);
    check(where.length >= 10 && out.length === 0, `every body is in frame at the system home (${label} ${w}×${h})`, out.length ? `out of frame: ${out.join(', ')}` : `${where.length} bodies drawn (the Moon's ring is gone at this scale), all inside the screen`);
    await page.context().close();
  }

  // ── reduced motion shortens every ease ─────────────────────────────────
  {
    const time = async (reduce) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
      const page = await ctx.newPage();
      await page.goto((process.env.EARTH_URL ?? 'http://localhost:5183/'), { waitUntil: 'load' });
      await page.waitForFunction(() => window.__earth?.engine?.presences && document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
      await page.waitForTimeout(800);
      await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
      await page.keyboard.press('s');
      await page.waitForTimeout(250);
      const r = await settle(page);
      await ctx.close();
      return r.took;
    };
    const normal = await time(false);
    const reduced = await time(true);
    check(reduced < normal * 0.6, 'reduced motion shortens the flight to the sky', `${normal} ms → ${reduced} ms`);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
