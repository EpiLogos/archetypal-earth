// Gate (Phase 4): the live luminaries. From the lunar stage outward the Earth is lit by the true Sun (its terminator is
// where the sidecar's subsolar point puts it); near the surface the atlas's own light is untouched (exactly zero
// share; the pixel gate is sky-pixels.mjs). The live state is always a labelled one: live and checked against the
// sidecar, a snapshot and why, or beyond the generated sky.
//   npx vite --port 5183 --strictPort &   and   ephemeris/run.sh    (the live case needs the sidecar)
//   node tests/ui/e2e/sky-sun.mjs [chromium|webkit]
import { readFileSync } from 'node:fs';
import { launch, look, URL } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const golden = JSON.parse(readFileSync(new globalThis.URL('../../sky/golden/luminaries.json', import.meta.url), 'utf8'));
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/** A page like lib.open's, with the sidecar optionally unreachable and the clock optionally set. */
async function openWith(browser, { blockSidecar = false, clock = null, width = 1280, height = 800, dpr = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  if (blockSidecar) await page.route(/127\.0\.0\.1:5187/, (r) => r.abort('connectionrefused'));
  if (clock) await page.clock.install({ time: new Date(clock) });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__earth?.engine?.presences, null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  return { ctx, page, logs };
}
const ready = async (page) => {
  await look(page, 20, 10, 8, 1200);
  await page.waitForFunction(() => window.__earth.engine.sky && window.__earth.ctl.skyLiveState, null, { timeout: 30000 });
  await page.waitForTimeout(1800); // the first sidecar answer, or its failure, has settled
};
const sunUniform = (page) => page.evaluate(() => {
  const { sunDir, sunMix } = window.__earth.engine.earth;
  const v = sunDir.value;
  return { mix: sunMix.value, lat: (Math.asin(v.y) * 180) / Math.PI, lon: (Math.atan2(-v.z, v.x) * 180) / Math.PI };
});
const liveNote = (page) => page.evaluate(() => ({ state: document.querySelector('.sky-live')?.dataset.state, text: document.querySelector('.sky-live')?.textContent }));

const browser = await launch(kind, { headed: false });
try {
  // ── A: the sidecar present, the real clock ──
  {
    const { page, logs, ctx } = await openWith(browser);
    await ready(page);
    await look(page, 20, 10, 4, 1500);
    const near = await sunUniform(page);
    check(near.mix === 0, 'near the surface the true Sun has no share of the light (the atlas keeps its key light)', `mix=${near.mix}`);
    await look(page, 20, 10, 60, 3000);
    const far = await sunUniform(page);
    check(far.mix === 1, 'from the lunar stage outward the light is wholly the Sun\u2019s', `mix=${far.mix}`);
    const live = await page.evaluate(() => window.__earth.ctl.skyLiveState);
    check(live?.kind === 'live', 'with the sidecar answering, the sky is live and following the clock', JSON.stringify(live));
    const note = await liveNote(page);
    check(note.state === 'live' && /^Live · .*checked against the ephemeris sidecar at \d\d:\d\d UTC/.test(note.text ?? ''), 'and says so, with the check it passed', note.text);
    const side = await page.evaluate(async () => (await (await fetch('http://127.0.0.1:5187/now')).json()).subsolar);
    const now = await sunUniform(page);
    check(Math.abs(now.lat - side.lat) < 0.1 && Math.abs(wrap180(now.lon - side.lon)) < 0.1, 'the subsolar point under the shader is the sidecar\u2019s now, to display accuracy', `site ${now.lat.toFixed(3)},${now.lon.toFixed(3)} · sidecar ${side.lat.toFixed(3)},${side.lon.toFixed(3)}`);
    const t0 = (await sunUniform(page)).lon;
    await page.waitForTimeout(3000);
    const t1 = (await sunUniform(page)).lon;
    check(Math.abs(wrap180(t1 - t0)) > 0.005 && Math.abs(wrap180(t1 - t0)) < 0.1, 'while live the terminator moves with the clock (≈ 0.004° a second)', `Δlon ${wrap180(t1 - t0).toFixed(4)}° in 3 s`);
    check(logs.length === 0, 'no console errors or warnings', logs.join(' | '));
    await ctx.close();
  }

  // ── B: no sidecar: a labelled snapshot, and the terminator at the named instants ──
  {
    const { page, ctx } = await openWith(browser, { blockSidecar: true, dpr: 3 });
    await ready(page);
    const st = await page.evaluate(() => window.__earth.ctl.skyLiveState);
    check(st?.kind === 'snapshot' && st.why === 'absent', 'without the sidecar the sky is a snapshot, and knows why', JSON.stringify(st));
    await look(page, 20, 10, 60, 2500);
    const note = await liveNote(page);
    check(note.state === 'snapshot' && /^Snapshot · Computed from the generated ephemeris as of \d{4}-\d\d-\d\d \d\d:\d\d UTC; it does not follow the clock\. The ephemeris sidecar is not running\.$/.test(note.text ?? ''), 'and the page says so in plain words', note.text);
    const m0 = (await sunUniform(page)).lon;
    await page.waitForTimeout(2500);
    check(Math.abs(wrap180((await sunUniform(page)).lon - m0)) < 1e-6, 'a snapshot does not move: it is a moment, not a clock');

    let worst = 0;
    const rows = [];
    for (const g of golden.instants) {
      const ms = Date.parse(g.iso);
      await page.evaluate((t) => window.__earth.engine.sky.setMoment(t), ms);
      await page.waitForTimeout(350);
      const u = await sunUniform(page);
      const inside = await page.evaluate(() => window.__earth.engine.sky.sunKnown);
      if (!inside) { rows.push(`${g.label}: outside the span (skipped here, checked below)`); continue; }
      const d = Math.max(Math.abs(u.lat - g.subsolar.lat), Math.abs(wrap180(u.lon - g.subsolar.lon)));
      worst = Math.max(worst, d);
      rows.push(`${g.label}: Δ${d.toFixed(4)}°`);
    }
    check(worst < 0.01, 'at every named instant the shader\u2019s subsolar point is the sidecar\u2019s (≤ 0.01° ≈ 1.1 km)', `worst ${worst.toFixed(4)}° · ${rows.join(' · ')}`);
    const outside = golden.instants.find((g) => g.label === 'J2000.0');
    await page.evaluate((t) => window.__earth.engine.sky.setMoment(t), Date.parse(outside.iso));
    await page.waitForTimeout(4500); // the share eases out, it does not pop
    const out = await sunUniform(page);
    check(out.mix < 0.001, 'outside the generated span the Earth keeps the atlas\u2019s light rather than a guessed Sun', `mix=${out.mix}`);

    // the terminator is where the sun says: from 90° away from the subsolar point, the sunlit half is the bright one
    const sol = golden.instants.find((g) => g.label === 'June solstice 2026');
    await page.evaluate((t) => window.__earth.engine.sky.setMoment(t), Date.parse(sol.iso));
    await look(page, 0, sol.subsolar.lon + 90, 30, 3500);
    const halves = await page.evaluate(async () => {
      const { engine } = window.__earth;
      const cam = engine.camera;
      const right = { x: cam.matrixWorld.elements[0], y: cam.matrixWorld.elements[1], z: cam.matrixWorld.elements[2] };
      const sd = engine.earth.sunDir.value;
      const sunRight = sd.x * right.x + sd.y * right.y + sd.z * right.z;
      return { sunRight };
    });
    const shot = await page.screenshot({ clip: { x: 590, y: 350, width: 100, height: 100 } });
    const lum = await page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = `data:image/png;base64,${b64}`; });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const R = c.width / 2;
      let l = 0; let nl = 0; let r = 0; let nr = 0;
      for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) {
        const dx = i - R; const dy = j - c.height / 2;
        const rr = Math.hypot(dx, dy);
        if (rr > 30 * 3 * 0.55 || rr < 4) continue; // inside the disc, clear of the limb glow
        const k = (j * c.width + i) * 4;
        const y = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
        if (dx < 0) { l += y; nl++; } else { r += y; nr++; }
      }
      return { left: l / Math.max(1, nl), right: r / Math.max(1, nr) };
    }, shot.toString('base64'));
    const litSide = halves.sunRight > 0 ? lum.right : lum.left;
    const darkSide = halves.sunRight > 0 ? lum.left : lum.right;
    check(Math.abs(halves.sunRight) > 0.9 && litSide > 2.2 * darkSide, 'seen from 90° to the side of the Sun, the half toward the Sun is the lit half', `sun ${halves.sunRight > 0 ? 'right' : 'left'} (${halves.sunRight.toFixed(3)}); lit ${litSide.toFixed(1)} vs dark ${darkSide.toFixed(1)}`);
    await page.screenshot({ path: `.cache/sky/shots/${kind}-terminator.png`, clip: { x: 540, y: 300, width: 200, height: 200 } });
    await ctx.close();
  }

  // ── C: the clock is past the generated sky: labelled, and the Earth keeps its own light ──
  {
    const { page, ctx, logs } = await openWith(browser, { clock: '2044-05-01T12:00:00Z', blockSidecar: true });
    await ready(page);
    const st = await page.evaluate(() => window.__earth.ctl.skyLiveState);
    check(st?.kind === 'beyond', 'past the generated span the state is "beyond", not a stale present', JSON.stringify(st));
    await look(page, 20, 10, 60, 2500);
    const note = await liveNote(page);
    check(note.state === 'beyond' && /^Beyond the generated sky · .*outside 2015–2039/.test(note.text ?? ''), 'and the page says so', note.text);
    check((await sunUniform(page)).mix === 0, 'the Earth keeps the atlas\u2019s light there');
    await page.evaluate(() => window.__earth.ctl.openBody('sun'));
    await page.waitForTimeout(1500);
    const card = await page.evaluate(() => document.querySelector('.sky-syzygy')?.textContent);
    check(/No elongation for as of 2044-05-01 12:0\d UTC: it lies outside the generated sky\./.test(card ?? '') || /outside the generated sky/.test(card ?? ''), 'the Sun\u2019s card declines to state an elongation it cannot know', card);
    check(logs.every((l) => !/pageerror/.test(l)), 'no page errors', logs.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
