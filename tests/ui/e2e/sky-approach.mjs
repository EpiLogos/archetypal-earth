// Gate: the per-planet approach (audit S2). A planet's card flies the camera to its disc, which fills ~30% of the view;
// the look-at rides the planet; the rings and the other bodies stay drawn; the disc picks; the walk has no teleport;
// Escape flies back to the system home, the Sun-centred look-at restored. Mercury, Saturn and the Sun are walked too.
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/sky-approach.mjs [chromium|webkit]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const SHOTS = fileURLToPath(new URL('../../../.cache/screens/remediation-2026-10-09/approach/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

const pose = (page) => page.evaluate(() => {
  const { engine, ctl } = window.__earth;
  const f = engine.rig.focus;
  return {
    lat: engine.rig.lat, lon: engine.rig.lon, dist: engine.rig.dist, flying: engine.rig.flying,
    sky: !!ctl.state.sky, body: ctl.state.sky?.body ?? null, hash: location.hash,
    focus: [f.x, f.y, f.z], approach: engine.sky?.approach ?? 0, stage: engine.stageDist,
  };
});

const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// settled: no flight running, and the pose (orientation, distance, look-at, approach weight) still across two samples
const settle = async (page, ms = 40000) => {
  const t0 = Date.now();
  let prev = null;
  for (;;) {
    await page.waitForTimeout(300);
    const s = await pose(page);
    const still = prev
      && Math.abs(s.lat - prev.lat) < 1e-3 && Math.abs(s.lon - prev.lon) < 1e-3
      && Math.abs(s.dist - prev.dist) < 1e-3 * s.dist && len3(sub3(s.focus, prev.focus)) < 1e-3 * s.dist
      && Math.abs(s.approach - prev.approach) < 1e-4;
    if (!s.flying && still && Date.now() - t0 > 500) return { ...s, took: Date.now() - t0 };
    if (Date.now() - t0 > ms) return { ...s, took: Date.now() - t0, timedOut: true };
    prev = s;
  }
};

const disc = (page, key) => page.evaluate((k) => {
  const { engine } = window.__earth;
  const d = engine.sky?.screenDisc(k);
  return d ? { ...d, height: engine.height } : null;
}, key);

const sampler = {
  start: (page) => page.evaluate(() => {
    window.__samples = [];
    const f = () => {
      const { engine, ctl } = window.__earth;
      window.__samples.push({ t: performance.now(), cam: engine.camera.position.toArray(), focus: engine.rig.focus.toArray(), dist: engine.rig.dist, body: ctl.state.sky?.body ?? null });
      window.__sampleRaf = requestAnimationFrame(f);
    };
    window.__sampleRaf = requestAnimationFrame(f);
  }),
  stop: (page) => page.evaluate(() => { cancelAnimationFrame(window.__sampleRaf); return window.__samples; }),
};

// Over a walk: the largest turn of the view direction per second (orientation), the largest look-at step between two
// frames as a share of the whole glide (a teleport is one step of ~100 %; an eased glide's largest step is a small share),
// and the largest look-at speed in units of the camera's distance per second (reported: a glide sweeps the planet across
// the view while the camera is close to it).
const analyse = (samples) => {
  let maxDeg = 0;
  let maxRel = 0;
  let maxStep = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    const va = sub3(a.cam, a.focus);
    const vb = sub3(b.cam, b.focus);
    const cos = (va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]) / (len3(va) * len3(vb));
    const ang = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
    maxDeg = Math.max(maxDeg, ang / dt);
    const step = len3(sub3(b.focus, a.focus));
    maxStep = Math.max(maxStep, step);
    maxRel = Math.max(maxRel, step / dt / b.dist);
  }
  const first = samples[0]?.focus ?? [0, 0, 0];
  const last = samples[samples.length - 1]?.focus ?? first;
  const glide = len3(sub3(last, first));
  return { frames: samples.length, maxDegPerS: maxDeg, maxFocusPerS: maxRel, maxStep, glide, stepShare: glide > 1e-6 ? maxStep / glide : 0 };
};

// a frame advances an ease by at most its clamped dt (0.1 s): ~8 % of a 1.8 s glide; a teleport is one step of the whole glide
const noTeleport = (a) => a.maxDegPerS < 0.5 && (a.glide < 1e-6 || a.stepShare < 0.2);

/**
 * Over a PNG screenshot: the share of pixels in the box the disc fills (its diameter square, centred on it) that are not
 * the renderer's clear colour. A planet on its night side is dark, but its rim and fog are not the clear colour; a
 * disc that has been clipped away leaves the box clear.
 */
const litShare = async (page, png, x, y, side, clear) => page.evaluate(async ({ b64, x, y, side, clear }) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const s = Math.max(8, Math.round(side));
  const box = g.getImageData(Math.round(x - s / 2), Math.round(y - s / 2), s, s).data;
  let n = 0, lit = 0, mean = 0;
  for (let i = 0; i < box.length; i += 4) {
    n++;
    const diff = Math.abs(box[i] - clear[0]) + Math.abs(box[i + 1] - clear[1]) + Math.abs(box[i + 2] - clear[2]);
    mean += box[i] + box[i + 1] + box[i + 2];
    if (diff > 6) lit++;
  }
  return { share: lit / n, mean: mean / (3 * n) };
}, { b64: png.toString('base64'), x, y, side, clear });

const CLEAR = [2, 3, 10]; // the renderer's clear colour (src/globe/engine.ts)

const browser = await launch(kind, { headed: false });
try {
  // ── the Earth stage: the stage distance is the rig's own, exactly ─────────
  {
    const { page, ctx } = await open(browser, { width: 1280, height: 800 });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    const rows = [];
    for (const d of [1.06, 1.5, 3.8, 12, 39]) {
      rows.push(await page.evaluate((d) => {
        const { engine } = window.__earth;
        engine.rig.flyTo(20, 20, d, { instant: true });
        return { stage: engine.stageDist, rig: engine.rig.dist, approach: engine.sky?.approach ?? 0 };
      }, d));
    }
    check(rows.every((r) => r.stage === r.rig && r.approach === 0), 'with no body approached the stage distance is the rig distance exactly (Earth stage)', rows.map((r) => r.rig.toFixed(2)).join(', '));
    await ctx.close();
  }

  // ── the system home, then Mars from its card ───────────────────────────────
  const { ctx, page, logs } = await open(browser, { width: 1280, height: 800 });
  await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
  await page.keyboard.press('s');
  const home = await settle(page);
  check(home.sky && !home.timedOut && home.dist > 8000, 'S enters the system home', `dist ${home.dist.toFixed(0)} in ${home.took} ms`);
  const homeDisc = await disc(page, 'mars');
  const homeDist = home.dist;
  await page.screenshot({ path: `${SHOTS}system-home.png` });

  // the look-at at home: the Sun-centred value (the Sun's drawn place)
  const sunAt = async () => page.evaluate(() => { const p = window.__earth.engine.sky.positionOf('sun'); return [p.x, p.y, p.z]; });
  const sunPos = await sunAt();
  const focusOff = (s, ref) => len3(sub3(s.focus, ref)) / s.dist;
  check(focusOff(home, sunPos) < 0.01, 'at the system home the look-at is the Sun-centred value', `${(focusOff(home, sunPos) * 100).toFixed(3)} % of dist off`);

  async function walkTo(body, label) {
    await sampler.start(page);
    await page.evaluate((b) => { location.hash = `#/sky/${b}`; }, body);
    const s = await settle(page);
    const samples = await sampler.stop(page);
    return { s, a: analyse(samples), label, n: samples.length };
  }

  const mars = await walkTo('mars');
  const m = mars.s;
  check(m.body === 'mars' && !m.timedOut, 'a Mars card flies the camera to Mars', `body ${m.body}, dist ${m.dist.toFixed(2)} in ${m.took} ms`);
  const marsScene = await page.evaluate(() => { const p = window.__earth.engine.sky.positionOf('mars'); return [p.x, p.y, p.z]; });
  const dFocus = len3(sub3(m.focus, marsScene));
  check(dFocus < 0.02 * Math.max(1, m.dist) && dFocus < 0.5, 'the look-at sits on Mars\' drawn place', `|focus − Mars| = ${dFocus.toFixed(4)} R⊕ at dist ${m.dist.toFixed(2)}`);
  const md = await disc(page, 'mars');
  check(md.on && md.px >= 8 * homeDisc.px, 'Mars\' disc grew at least 8× from the system home', `${homeDisc.px.toFixed(1)} px → ${md.px.toFixed(1)} px`);
  const frac = md.px / md.height;
  check(frac > 0.25 && frac < 0.35, 'and fills 25–35% of the viewport height', `${(frac * 100).toFixed(1)} % of ${md.height} px`);
  const hit = await page.evaluate(([x, y]) => window.__earth.engine.sky.pick(x, y, 20), [md.x, md.y]);
  check(hit === 'mars', 'the disc picks at its centre', `pick → ${hit}`);
  const rings = await page.evaluate(() => {
    const { engine } = window.__earth;
    let loops = 0, on = 0, meshes = 0;
    engine.sky.group.traverse((o) => {
      if (o.isLineLoop) { loops++; if (o.material.opacity > 0) on++; }
      if (o.isMesh && o.visible && o.material.uniforms?.uAlpha?.value > 0.004) meshes++;
    });
    return { visible: engine.sky.group.visible, loops, on, meshes };
  });
  check(rings.visible && rings.on > 0 && rings.meshes >= 10, 'the rings and the other bodies stay drawn', `group visible, ${rings.on}/${rings.loops} rings lit, ${rings.meshes} bodies drawn`);
  console.log(`     walk to Mars: ${mars.n} frames; view turn ${mars.a.maxDegPerS.toFixed(3)}°/s; largest look-at step ${mars.a.stepShare.toFixed(3)} of the glide (${mars.a.glide.toFixed(0)} R⊕); look-at speed ${mars.a.maxFocusPerS.toFixed(2)} dist/s`);
  check(mars.a.maxDegPerS < 0.5, 'no orientation loss on the way in (view turns < 0.5°/s)');
  check(noTeleport(mars.a), 'no teleport on the way in (no single frame moves the look-at by 20% of the glide)');
  const near = await page.evaluate(() => ({ near: window.__earth.engine.camera.near, dist: window.__earth.engine.rig.dist }));
  check(near.near < near.dist, 'the near plane clears the planet', `near ${near.near.toFixed(3)} < dist ${near.dist.toFixed(2)}`);
  await page.screenshot({ path: `${SHOTS}mars-approached.png` });

  // ── Escape: back to the system home, the Sun-centred look-at restored ────────
  await sampler.start(page);
  await page.keyboard.press('Escape');
  const up = await settle(page);
  const samplesBack = await sampler.stop(page);
  const b = analyse(samplesBack);
  check(!up.body && up.sky && !up.timedOut, 'Escape leaves Mars\' card for the sky', `hash "${up.hash}"`);
  check(Math.abs(up.dist / homeDist - 1) < 0.01, 'and returns to the system home distance (within 1%)', `dist ${up.dist.toFixed(0)} vs home ${homeDist.toFixed(0)}`);
  check(focusOff(up, sunPos) < 0.01, 'with the look-at back on the Sun', `${(focusOff(up, sunPos) * 100).toFixed(3)} % of dist off`);
  console.log(`     return from Mars: ${samplesBack.length} frames; view turn ${b.maxDegPerS.toFixed(3)}°/s; largest look-at step ${b.stepShare.toFixed(3)} of the glide; look-at speed ${b.maxFocusPerS.toFixed(2)} dist/s`);
  check(b.maxDegPerS < 0.5 && noTeleport(b), 'the return holds the orientation and does not teleport');

  // ── Mercury (tiny), then a re-target to Saturn, then the Sun ───────────────
  const walk = async (body, shot, title) => {
    const w = await walkTo(body);
    const d = await disc(page, body);
    const frac2 = d.px / d.height;
    const s = w.s;
    const sc = await page.evaluate((k) => { const p = window.__earth.engine.sky.positionOf(k); return [p.x, p.y, p.z]; }, body);
    check(s.body === body && !s.timedOut, `${title}: the card flies to ${body}`, `dist ${s.dist.toFixed(2)} in ${s.took} ms`);
    check(d.on && frac2 > 0.25 && frac2 < 0.35, `${title}: the disc fills 25–35% of the height`, `${(frac2 * 100).toFixed(1)} % (${d.px.toFixed(0)} px)`);
    check(len3(sub3(s.focus, sc)) < Math.max(0.5, 0.02 * s.dist), `${title}: the look-at sits on the planet`, `${len3(sub3(s.focus, sc)).toFixed(4)} R⊕ off`);
    const h = await page.evaluate(([x, y]) => window.__earth.engine.sky.pick(x, y, 20), [d.x, d.y]);
    check(h === body, `${title}: the disc picks`, `pick → ${h}`);
    const near2 = await page.evaluate(() => ({ near: window.__earth.engine.camera.near, dist: window.__earth.engine.rig.dist }));
    check(near2.near < near2.dist, `${title}: the near plane clears the disc`, `near ${near2.near.toFixed(3)} < dist ${near2.dist.toFixed(2)}`);
    const png = await page.screenshot({ path: `${SHOTS}${shot}.png` });
    const lit = await litShare(page, png, d.x, d.y, d.px, CLEAR);
    check(lit.share > 0.5, `${title}: the frame is not blank at the disc (most of its square is not the clear colour)`, `${(lit.share * 100).toFixed(0)} % of the disc's square lit, mean ${lit.mean.toFixed(0)}`);
    console.log(`     ${title}: ${w.n} frames; view turn ${w.a.maxDegPerS.toFixed(3)}°/s; largest look-at step ${w.a.stepShare.toFixed(3)} of the glide; look-at speed ${w.a.maxFocusPerS.toFixed(2)} dist/s`);
    check(w.a.maxDegPerS < 0.5 && noTeleport(w.a), `${title}: the walk holds the orientation and does not teleport`);
    return s;
  };

  await page.keyboard.press('Escape');
  await settle(page);
  await walk('mercury', 'mercury-approached', 'Mercury');
  await walk('saturn', 'saturn-approached', 'Saturn (re-target from Mercury)');
  await walk('sun', 'sun-approached', 'Sun');
  check(!logs.some((l) => /pageerror/i.test(l)), 'no page errors through the walk', logs.filter((l) => /pageerror/i.test(l)).join(' | ').slice(0, 300));
  await ctx.close();

  // ── reduced motion: the approach's ease is shortened to ×0.4, with no overshoot ──
  {
    const ease = async (reduce) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
      const page = await ctx.newPage();
      await page.goto(process.env.EARTH_URL ?? 'http://localhost:5183/', { waitUntil: 'load' });
      await page.waitForFunction(() => window.__earth?.engine?.presences && document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
      // stop the real-time loop first (advance() does), so the approach starts on a frame clock we step ourselves
      await page.evaluate(() => {
        window.__earth.engine.rig.interacted = true;
        document.body.classList.add('interacted');
        window.__earth.engine.advance(1 / 30, 1 / 30);
        location.hash = '#/sky/mars';
      });
      await page.waitForFunction(() => window.__earth.engine.sky && window.__earth.ctl.state.sky?.body === 'mars', null, { timeout: 60000 });
      const dur = await page.evaluate(() => ({ dur: window.__earth.engine.sky.approachE.dur, reduced: window.__earth.engine.sky.reduced }));
      // step the frames at a fixed dt: the ease must rise monotonically, never past 1
      const trace = await page.evaluate(() => {
        const { engine } = window.__earth;
        const out = [];
        for (let i = 0; i < 400; i++) {
          engine.advance(1 / 30, 1 / 30);
          out.push(engine.sky.approach);
          if (engine.sky.approach >= 0.9999) break;
        }
        return out;
      });
      await ctx.close();
      const monotone = trace.every((v, i) => i === 0 || v >= trace[i - 1] - 1e-12);
      return { ...dur, monotone, max: Math.max(...trace), frames: trace.length };
    };
    const normal = await ease(false);
    const reduced = await ease(true);
    check(!normal.reduced && reduced.reduced, 'the reduced-motion preference reaches the sky layer', `normal ${normal.reduced}, reduced ${reduced.reduced}`);
    check(reduced.dur <= 0.6 * normal.dur && Math.abs(normal.dur - 1800) < 1e-6, 'reduced motion shortens the approach\'s ease ×0.4', `${normal.dur} ms → ${reduced.dur} ms`);
    check(normal.monotone && reduced.monotone && normal.max <= 1 && reduced.max <= 1, 'the approach eases up monotonically, with no overshoot', `${normal.frames} and ${reduced.frames} frames, max ${normal.max} / ${reduced.max}`);
  }

  // ── the plain sky link is not approached: #/sky has no body and no approach ──
  {
    const plain = await open(browser, { width: 1280, height: 800, hash: '#/sky' });
    const s = await settle(plain.page);
    const approach = await plain.page.evaluate(() => window.__earth.engine.sky?.approach ?? 0);
    check(s.sky && !s.body && approach === 0, 'the plain link #/sky does not approach any body', `approach ${approach}`);
    await plain.ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
