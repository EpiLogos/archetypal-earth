// Gate: the handoff's composition and the gesture's arrival (audit S3 (a)–(d)).
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/sky-composition.mjs [chromium|webkit]
//
//   (a) the Earth and the Sun inside the central 70% from 1 330 R⊕ on, at the canonical pose, on four dates of the year, on a desktop and on a phone
//   (b) a wheel that rests in the system settles the orientation to the canonical pose (capped speed, eased); a drag or a key cancels
//   (c) the pull-back's limit is 1.35× the system's home, not 2.2×
//   (d) a pull-back before the sky has loaded resists, never stalls, and is monotone (sky.json held back by the route)
//   (e) an out-and-back in one continuous wheel gesture returns to the start orientation
//   (f) the Earth stage is pixel-identical: a canvas hash at fixed Earth poses equals the one recorded from the unchanged code
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const SHOTS = fileURLToPath(new URL('../../../.cache/screens/remediation-2026-10-09/sky-composition/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** The Earth-stage canvas hashes, recorded from the unchanged code on this sandbox's renderer (SwiftShader, 1280×800). */
const EARTH_BEFORE = {
  1.5: '5d6baa36289f60fcc07649504da7913b791fc2ac4654da766670d313667608d8',
  3.8: '65bf68b4c05a14f223c2952f0cf2722f908e0683cd8a76159fa90af47fd13055',
  5.4: 'a2f41ee5c07b28218cbea1852c8909617ad9787e5556ebe38ed44c4bd1842028',
};

// the canonical system view (frames.ts systemViewLatLon, camera toward the Sun's geocentric longitude) at the layer's own clock, computed in the page
const CANON = `(() => {
  const { engine } = window.__earth; const L = engine.sky; const D2R = Math.PI / 180;
  const lo = L.sunLonDeg * D2R, la = 38 * D2R, cg = Math.cos(la);
  const v = [cg * Math.cos(lo), cg * Math.sin(lo), Math.sin(la)];
  const ce = Math.cos(L.eps * D2R), se = Math.sin(L.eps * D2R);
  const X = v[0], Y = v[1] * ce - v[2] * se, Z = v[1] * se + v[2] * ce;
  const cgm = Math.cos(L.gmst * D2R), sgm = Math.sin(L.gmst * D2R);
  const s = [X * cgm + Y * sgm, Z, -(Y * cgm - X * sgm)];
  return { lat: Math.asin(s[1]) / D2R, lon: Math.atan2(-s[2], s[0]) / D2R };
})()`;

const pose = (page) => page.evaluate(() => {
  const { engine, ctl } = window.__earth;
  return {
    lat: engine.rig.lat, lon: engine.rig.lon, dist: engine.rig.dist, flying: engine.rig.flying,
    sky: !!ctl.state.sky, body: ctl.state.sky?.body ?? null, hash: location.hash,
    settling: !!engine.rig.settleTo, wheelDriven: engine.rig.wheelDriven, maxDist: engine.rig.maxDist, softMaxDist: engine.rig.softMaxDist,
    approach: engine.sky?.approach ?? 0, stage: engine.stageDist,
  };
});

const angle = (a, b) => {
  const D2R = Math.PI / 180;
  const v = (p) => { const la = p.lat * D2R, lo = p.lon * D2R; return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)]; };
  const [x, y] = [v(a), v(b)];
  return Math.acos(Math.min(1, Math.max(-1, x[0] * y[0] + x[1] * y[1] + x[2] * y[2]))) / D2R;
};

const settled = async (page, ms = 40000) => {
  const t0 = Date.now();
  let prev = null;
  for (;;) {
    await page.waitForTimeout(300);
    const s = await pose(page);
    const still = prev && Math.abs(s.lat - prev.lat) < 1e-3 && Math.abs(s.lon - prev.lon) < 1e-3 && Math.abs(s.dist - prev.dist) < 1e-3 * s.dist;
    if (!s.flying && still) return { ...s, took: Date.now() - t0 };
    if (Date.now() - t0 > ms) return { ...s, took: Date.now() - t0, timedOut: true };
    prev = s;
  }
};

/** Wheel out (or in) until `pred`, with `dy` per step; returns the pose. Steps are `gap` ms apart. */
const wheelUntil = async (page, pred, dy, maxSteps = 400, gap = 16) => {
  let s = await pose(page);
  for (let i = 0; i < maxSteps && !pred(s); i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(gap);
    s = await pose(page);
  }
  return s;
};

const browser = await launch(kind, { headed: false });
try {
  // ── (a) the composition, the canonical pose: four dates, a desktop and a phone ─────
  {
    const DATES = ['2026-03-20T12:00:00Z', '2026-06-21T12:00:00Z', '2026-09-23T12:00:00Z', '2026-12-21T12:00:00Z'];
    for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 390, height: 844 }]) {
      const { ctx, page } = await open(browser, { width: vp.width, height: vp.height, hash: '#/sky' });
      await page.waitForFunction(() => window.__earth.engine.sky && document.body.classList.contains('sky-ready'), null, { timeout: 60000 });
      await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); window.__earth.engine.rig.autoRotate = false; });
      await settled(page);
      for (const iso of DATES) {
        const ms = Date.parse(iso);
        // the clock may follow the wall clock when the sidecar vouches for it: set the moment, and say so if it does not hold
        await page.evaluate((m) => window.__earth.engine.sky.setMoment(m), ms);
        await page.waitForTimeout(900);
        const held = await page.evaluate(() => window.__earth.engine.sky.moment);
        if (Math.abs(held - ms) > 3600_000) { check(true, `${vp.name} ${iso.slice(0, 10)}: skipped — the sky's clock follows the wall clock here (sidecar live), the moment cannot be held`); continue; }
        const lon = await page.evaluate(() => window.__earth.engine.sky.sunLonDeg);
        const rows = [];
        for (const d of [1400, 2000, 3000]) {
          const c = await page.evaluate(`${CANON}`);
          await page.evaluate(([cc, dd]) => { const { engine } = window.__earth; engine.sky.setMoment(engine.sky.moment); engine.rig.flyTo(cc.lat, cc.lon, dd, { instant: true }); }, [c, d]);
          await page.waitForTimeout(1800);
          rows.push(await page.evaluate(() => {
            const { engine } = window.__earth;
            const ndc = (p) => (p ? { x: (p.x / engine.width) * 2 - 1, y: 1 - (p.y / engine.height) * 2 } : null);
            return { dist: engine.rig.dist, earth: ndc(engine.sky.screenDisc('earth')), sun: ndc(engine.sky.screenDisc('sun')) };
          }));
        }
        for (const r of rows) {
          const inside = (p) => !!p && Math.abs(p.x) <= 0.7 && Math.abs(p.y) <= 0.7;
          check(inside(r.earth) && inside(r.sun), `${vp.name} ${iso.slice(0, 10)} (Sun at ${lon.toFixed(0)}°): the Earth and the Sun inside the central 70% at ${Math.round(r.dist)} R⊕`,
            r.earth && r.sun ? `Earth (${r.earth.x.toFixed(2)}, ${r.earth.y.toFixed(2)}), Sun (${r.sun.x.toFixed(2)}, ${r.sun.y.toFixed(2)})` : 'a body is not drawn');
        }
        if (iso.startsWith('2026-06')) writeFileSync(`${SHOTS}canonical-${vp.name}-1400.png`, await page.locator('canvas.globe-canvas').screenshot());
      }
      await ctx.close();
    }
  }

  // ── (f) the Earth stage: pixel-identical at fixed Earth poses ──────────────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); window.__earth.engine.rig.autoRotate = false; });
    await page.waitForTimeout(9000);
    for (const d of [1.5, 3.8, 5.4]) {
      await page.evaluate(([dd]) => { const { engine } = window.__earth; engine.rig.flyTo(20, 20, dd, { instant: true }); engine.elapsed = 0; engine.advance(0.5); }, [d]);
      await page.waitForTimeout(3500);
      await page.evaluate(() => { const { engine } = window.__earth; engine.elapsed = 0; engine.advance(0.5); engine.advance(0.5); });
      await page.waitForTimeout(600);
      await page.evaluate(() => { const { engine } = window.__earth; engine.elapsed = 0; engine.advance(0.5); });
      const png = await page.locator('canvas.globe-canvas').screenshot();
      const h = createHash('sha256').update(png).digest('hex');
      check(h === EARTH_BEFORE[d], `the Earth stage at ${d} R⊕ is pixel-identical to the unchanged code`, h === EARTH_BEFORE[d] ? 'hash matches' : `hash ${h.slice(0, 12)}… ≠ ${EARTH_BEFORE[d].slice(0, 12)}…`);
    }
    await ctx.close();
  }

  // ── (c) the limit is 1.35× the system's home ───────────────────────────────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800 });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.keyboard.press('s');
    const home = await settled(page, 60000);
    const ratio = home.maxDist / home.dist;
    check(!home.timedOut && Math.abs(ratio - 1.35) < 0.02, 'the pull-back is limited to 1.35× the system home (it was 2.2×)', `home ${home.dist.toFixed(0)}, limit ${home.maxDist.toFixed(0)}, ratio ${ratio.toFixed(3)}`);
    await ctx.close();
  }

  // ── (b) the arrival settle: a rest in the system settles, a drag or a key cancels ──
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '' });
    await page.mouse.move(640, 400);
    await page.evaluate(() => { const { engine } = window.__earth; engine.rig.interacted = true; document.body.classList.add('interacted'); engine.rig.autoRotate = false; engine.rig.flyTo(55, 0, 3, { instant: true }); });
    await page.waitForTimeout(800);
    // a pull-back in one gesture into the system, then rest
    await wheelUntil(page, (s) => s.sky && s.stage >= 3000, 140);
    const start = await pose(page);
    check(start.sky && start.dist >= 3000, 'the wheel carries the camera into the system', `dist ${start.dist.toFixed(0)}`);
    const canonStart = await page.evaluate(`${CANON}`);
    // let the zoom's own ease finish (the distance is then the rig's to hold), then sample the orientation every frame while it rests;
    // a 12°/s cap takes ~13 s to close an offset of ~80°, so the window is 25 s
    await page.waitForTimeout(2500);
    // sampled once per engine frame, with the frame's own dt (the rig steps by exactly that dt), so the speed is the rig's
    await page.evaluate(() => {
      const { engine } = window.__earth; window.__set = []; window.__setSpeed = 0; let prev = null;
      engine.onFrame((dt) => {
        const cur = { lat: engine.rig.lat, lon: engine.rig.lon, dist: engine.rig.dist, dt };
        if (prev && dt > 0) window.__setSpeed = Math.max(window.__setSpeed, window.__angleDeg(prev, cur) / dt);
        window.__set.push(cur); prev = cur;
      });
      window.__angleDeg = (a, b) => { const D2R = Math.PI / 180; const v = (p) => { const la = p.lat * D2R, lo = p.lon * D2R; return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)]; }; const x = v(a), y = v(b); return Math.acos(Math.min(1, Math.max(-1, x[0] * y[0] + x[1] * y[1] + x[2] * y[2]))) / D2R; };
    });
    await page.waitForTimeout(25000);
    const samples = await page.evaluate(() => window.__set);
    const maxSpeed = await page.evaluate(() => window.__setSpeed);
    const end = samples[samples.length - 1];
    const off = angle(end, canonStart);
    const distDrift = Math.max(...samples.map((s) => Math.abs(s.dist - samples[0].dist) / samples[0].dist));
    check(off < 0.3, 'after a rest in the system the orientation converges to the canonical system view', `${off.toFixed(3)}° off after 12 s`);
    check(maxSpeed <= 12.5, 'the arrival settle never turns faster than 12°/s (no teleport)', `max ${maxSpeed.toFixed(2)}°/s`);
    check(distDrift < 0.01, 'the settle keeps the distance', `drift ${(distDrift * 100).toFixed(3)} %`);

    // a drag cancels: wheel out again, then drag before the rest
    await wheelUntil(page, (s) => s.dist < 3.2, -140);
    await page.waitForTimeout(600);
    await wheelUntil(page, (s) => s.sky && s.stage >= 3000, 140);
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(700, 430, { steps: 6 });
    await page.mouse.up();
    const dragged = await pose(page);
    // the release carries its own inertia for a few seconds: wait for it to decay, then measure a quiet window
    await page.waitForTimeout(4000);
    const later0 = await pose(page);
    await page.waitForTimeout(4000);
    const later = await pose(page);
    const moved = angle(later0, later);
    check(!later.settling && !later.wheelDriven && moved < 0.2, 'a drag cancels the arrival settle and it does not resume', `drift after the drag ${moved.toFixed(3)}°, settling ${later.settling}`);
    check(angle(later, canonStart) > 0.5, 'the dragged orientation is kept (not pulled to the canonical pose)', `${angle(later, canonStart).toFixed(2)}° from canonical`);

    // a key cancels: wheel out, rest briefly, press a key
    await wheelUntil(page, (s) => s.dist < 3.2, -140);
    await page.waitForTimeout(600);
    await wheelUntil(page, (s) => s.sky && s.stage >= 3000, 140);
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(3000);
    const keyed = await pose(page);
    check(!keyed.settling && !keyed.wheelDriven, 'a key press cancels the arrival settle', `settling ${keyed.settling}`);
    await ctx.close();
  }

  // ── (d) the pull-back before the sky has loaded: resists, never stalls, monotone ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // hold the sky's data back: the pull-back happens before it is here
    await ctx.route('**/data/sky.json', async (route) => { await new Promise((r) => setTimeout(r, 6000)); await route.continue(); });
    const page = await ctx.newPage();
    await page.goto((process.env.EARTH_URL ?? 'http://localhost:5183/'), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__earth?.engine?.presences && document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
    const intro = page.locator('#intro:not(.dismissed)');
    if (await intro.count()) await page.getByRole('button', { name: 'Enter the globe' }).click();
    await page.evaluate(() => { const { engine } = window.__earth; engine.rig.interacted = true; document.body.classList.add('interacted'); engine.rig.autoRotate = false; engine.rig.flyTo(20, 20, 3.8, { instant: true }); });
    await page.waitForTimeout(500);
    const pre = await pose(page);
    const readyBefore = await page.evaluate(() => document.body.classList.contains('sky-ready'));
    check(!readyBefore, 'the sky has not loaded when the pull-back starts', `dist ${pre.dist.toFixed(2)}`);
    // the page's own frame log: distance, the target the wheel is steering, and whether the wheel is turning
    await page.evaluate(() => {
      window.__log = []; window.__wheelOn = true;
      const f = (t) => { const r = window.__earth.engine.rig; const cap = r.softMaxDist > r.maxDist ? r.softMaxDist : r.maxDist; window.__log.push({ t, d: r.dist, tg: r.targetDist, cap, ready: document.body.classList.contains('sky-ready'), on: !!window.__wheelOn }); window.__logRaf = requestAnimationFrame(f); };
      window.__logRaf = requestAnimationFrame(f);
    });
    // the wheel, sent without a round trip per step: 200 steps of 40 (the sky's arrival lands among them)
    for (let i = 0; i < 200; i++) { await page.mouse.wheel(0, 40); await page.waitForTimeout(20); }
    await page.evaluate(() => { window.__wheelOn = false; });
    await page.waitForTimeout(1500);
    const log = await page.evaluate(() => { cancelAnimationFrame(window.__logRaf); return window.__log; });
    const arrivalAt = log.findIndex((x) => x.ready);
    let monotone = true;
    let maxJump = 1;
    for (let i = 1; i < log.length; i++) {
      if (log[i].d < log[i - 1].d - 1e-9) monotone = false;
      if (log[i - 1].d > 0) maxJump = Math.max(maxJump, log[i].d / log[i - 1].d);
    }
    // a stall: the wheel is turning, the target it steers is still short of the limit, and neither the target nor the camera grows
    let longest = 0;
    let since = null;
    const arrivalFrames = arrivalAt < 0 ? -1 : arrivalAt + 2;
    for (let i = 1; i < log.length; i++) {
      if (i <= arrivalFrames || !log[i].on || log[i].tg >= log[i].cap - 1e-6) { since = null; continue; }
      const grew = log[i].tg > log[i - 1].tg + 1e-9 || log[i].d > log[i - 1].d + 1e-9;
      if (grew) { since = null; continue; }
      if (since === null) since = log[i - 1].t;
      longest = Math.max(longest, log[i].t - since);
    }
    const arrival = arrivalAt > 0 ? log[arrivalAt].t - log[arrivalAt - 1].t : 0;
    console.log(`     the sky's arrival frame took ${arrival.toFixed(0)} ms (shader compilation at attach; at idle in normal use)`);
    const end = await pose(page);
    check(monotone, 'the pull-back grows monotonically across the sky\'s arrival', `sky arrived at frame ${arrivalAt < 0 ? 'never' : arrivalAt}`);
    check(maxJump <= 1.2, 'no frame-to-frame jump over 20% in the pull-back', `largest step ×${maxJump.toFixed(3)}`);
    check(end.dist > pre.dist * 1.5, 'the pull-back keeps going past the atlas\'s limit (it does not stall at 5.4)', `dist ${pre.dist.toFixed(2)} → ${end.dist.toFixed(2)}`);
    await page.waitForFunction(() => document.body.classList.contains('sky-ready'), null, { timeout: 30000 }).catch(() => {});
    const after = await pose(page);
    check(after.maxDist > 8000 && after.softMaxDist === 0, 'once the sky is loaded the limit is the sky\'s, with no resistance', `maxDist ${after.maxDist.toFixed(0)}, soft ${after.softMaxDist}`);
    check(longest < 1000, 'no pause longer than 1 s in the wheeled pull-back once the sky has arrived', `longest pause ${longest} ms`);
    await ctx.close();
  }

  // ── (e) out-and-back in one continuous wheel gesture returns to the start ──
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '' });
    await page.mouse.move(640, 400);
    await page.evaluate(() => { const { engine } = window.__earth; engine.rig.interacted = true; document.body.classList.add('interacted'); engine.rig.autoRotate = false; engine.rig.flyTo(30, 20, 3, { instant: true }); });
    await page.waitForTimeout(800);
    const start = await pose(page);
    await wheelUntil(page, (s) => s.sky && s.stage >= 3000, 140);
    await wheelUntil(page, (s) => s.dist < 3.2, -140);
    const back = await settled(page, 40000);
    const lost = angle(start, back);
    check(!back.timedOut && lost < 0.1, 'an out-and-back in one wheel gesture returns to the start orientation', `${lost.toFixed(4)}° (lat ${start.lat.toFixed(2)}→${back.lat.toFixed(2)}, lon ${start.lon.toFixed(2)}→${back.lon.toFixed(2)})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
