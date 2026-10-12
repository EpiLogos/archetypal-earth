// Acceptance harness for the Sky ↔ Field choreography (the owner's ask; ProjectCentral/docs/SKY-CAMERA-SPEC.md §0, §2, §3).
// It measures the running app frame by frame (lib-sky.mjs) and prints one line per check:
//   PASS|FAIL <invariant> (<scope>) — detail          SKIP <invariant> (<scope>) — detail (reason)
// Scenarios, each on a fresh page:
//   A  live sky: pick Venus → approach → click an orbit (gaze) → click a plate (descend) → "See in sky" (return)
//   B  approach Venus → gaze → click off (cancel the gaze)
//   C  approach Venus → "Whole sky"
//   D  Jung's chart (#/astrology/jung/venus): A's choreography, then the sheet's X
//   E  approach Venus → gaze → Escape (cancel from the keyboard)
//   F  approach Venus → Mars (planet to planet in the sky)
//   G  approach Venus → wheel out, then 3 s still (no settle spin)
//   I9/I10  every body's every tie: reachable and landing on its subject; orbit density; jung cites (desktop only)
// The phase contract (document.body.dataset.skyPhase) is read on every frame: 'return' through the whole return,
// 'gaze' during a gaze, 'descend' during the drop, 'settled' after the landing.
// Exits non-zero on any FAIL. Thresholds are the spec's table; nothing is relaxed to pass.
//   npx vite --port 5186 --strictPort &   then   EARTH_URL=http://localhost:5186/ node tests/ui/e2e/sky-choreography.mjs [chromium|webkit] [desk|phone]
//   SKY_ONLY=A,E limits the scenarios; SKY_TIES=0 skips I9/I10; SKY_SHOTS=<dir> sets where the screenshots go.
//   The phone run (390×844, mobile emulation) runs A, B, D, E; it holds the body by the app's route (holdBody), and every
//   other step is a real pointer or DOM click. Its screenshots carry a `phone-` prefix.
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from './lib.mjs';
import {
  openSkyPage, startSampler, stopSampler, markEvent, markedClick, installClickMarks, ndcOf, poseNow, waitFor, waitStill,
  plateReachable, angleDeg, orientDeg, maxLookJump, pathLength, between, at, after,
} from './lib-sky.mjs';

const kind = process.argv[2] ?? 'chromium';
const view = process.argv[3] ?? 'desk';
const VP = view === 'phone' ? { width: 390, height: 844, mobile: true } : { width: 1440, height: 900, mobile: false };
const DESK = view === 'desk';
const ONLY = (process.env.SKY_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const wants = (s) => !ONLY.length || ONLY.includes(s);
const TIES = DESK && process.env.SKY_TIES !== '0' && (!ONLY.length || ONLY.includes('I9'));
const SHOTS = process.env.SKY_SHOTS ?? fileURLToPath(new URL('../../../.cache/screens/sky-choreography/', import.meta.url));
const DATA = fileURLToPath(new URL('../../../public/data/astrology.json', import.meta.url));
const CURATION = fileURLToPath(new URL('../../../curation/sky/ties.json', import.meta.url));

/** The click stamps the flows read: a click on a float plate, on the See-in-sky link, on an orbit satellite. */
const RULES = [
  { name: 'plate', sel: '.floats .float' },
  { name: 'ret', sel: '.focus-label button', text: 'See in sky' },
  { name: 'orbit', sel: '.po-sat' },
];
const PREFIX = { archetype: 'a', theoretic: 'th', family: 'f', culture: 'c', place: 'p' };

const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
let SCOPE = '';
const say = (status, inv, text) => {
  counts[status]++;
  console.log(`${status} ${inv}${SCOPE ? ` (${SCOPE})` : ''} — ${text}`);
};
const pass = (inv, text) => say('PASS', inv, text);
const fail = (inv, text) => say('FAIL', inv, text);
const skip = (inv, text, why = 'not measured') => say('SKIP', inv, `${text} (${why})`);
const check = (inv, ok, text) => (ok ? pass : fail)(inv, text);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const ndcOk = (n, lim = 0.85) => !!n && !n.behind && Math.abs(n.x) <= lim && Math.abs(n.y) <= lim;
const first = (samples, pred) => samples.find(pred) ?? null;
const describeFrame = (s) => `t=${s.t} rigDist=${f(s.rigDist, 3)} camDist=${f(s.camDist, 3)} phase=${s.skyPhase} rig.gazing=${s.gazing} rig.flying=${s.flying} hash=${s.hash || '(none)'} lens=${s.lens} sky=${s.sky}`;

/** A flow that cannot continue: it names the invariant it failed and why. The analysis still runs on what was sampled. */
class Bail extends Error {
  constructor(inv, msg) { super(msg); this.inv = inv; }
}

const isReload = (e) => /Execution context was destroyed|window\.__earth|__skySamples/.test(String(e?.message));

/** Runs a flow; an error ends the flow (recorded as a FAIL) and never the analysis. */
async function runFlow(name, flow, page, M, R) {
  try {
    await flow(page, M, R);
    return null;
  } catch (e) {
    if (isReload(e)) throw e; // a reload: run() repeats the scenario
    const inv = e instanceof Bail ? e.inv : 'FLOW';
    fail(inv, `${name} stopped: ${String(e.message).split('\n')[0]}`);
    if (!(e instanceof Bail)) console.error(e.stack);
    return e;
  }
}

const LOGS = [];
let browser = null;

async function openSky(hash, { reduced = false } = {}) {
  const { ctx, page, logs } = await openSkyPage(browser, { hash, width: VP.width, height: VP.height, mobile: VP.mobile, reduced });
  const ready = await waitFor(page, () => document.body.classList.contains('sky-ready') && !!window.__earth.ctl.state.sky, null, 120000);
  if (!ready) throw new Bail('FLOW', `the sky at ${hash} never reported sky-ready`);
  await page.waitForTimeout(500);
  await startSampler(page);
  await page.evaluate(installClickMarks, RULES);
  return { ctx, page, logs };
}

const phaseNow = (page) => page.evaluate(() => document.body.dataset.skyPhase ?? null);

/** A screenshot at a named moment (phone shots carry a `phone-` prefix); the file and the phase, distance and lens at the capture are reported. */
async function shot(page, tag, moment, R) {
  mkdirSync(SHOTS, { recursive: true });
  const file = `${SHOTS}/${DESK ? '' : 'phone-'}${tag}-${moment}.png`;
  await page.screenshot({ path: file });
  const p = await poseNow(page);
  R.shots.push(`${file} [phase ${p.phase}, camDist ${f(p.camDist, 2)}, lens ${p.lens}, sky ${p.sky}]`);
}

/**
 * Holds a body from the sky. Desktop: a click on its drawn disc, which must be held by the sky's own pick (the way a user
 * picks it). Phone (390×844): the sheet's text covers the disc, so the app's own route for a body in the live sky,
 * `#/astrology/sky/<key>` (the state astrologyLive({ body }) gives, as onSkyPick and openBody navigate to), holds it; every
 * step after that is a real pointer or DOM click.
 */
async function holdBody(page, key) {
  if (DESK) return pickBody(page, key);
  const t = await markEvent(page);
  await page.evaluate((k) => { location.hash = `#/astrology/sky/${k}`; }, key);
  const held = await waitFor(page, (k) => window.__earth.ctl.state.sky?.body === k, key, 15000);
  if (!held) throw new Bail('I8', `the route #/astrology/sky/${key} does not hold ${key}`);
  return t;
}

/** A click on a body's drawn disc, which must be held by the sky's own pick (the way a user picks it). */
async function pickBody(page, key) {
  const d = await page.evaluate((k) => {
    const { engine } = window.__earth;
    const s = engine.sky.screenDisc(k);
    return s && s.on ? { x: s.x, y: s.y, px: s.px, hit: engine.sky.pick(s.x, s.y, 20) } : null;
  }, key);
  if (!d) throw new Bail('I8', `${key} is not drawn in the live sky`);
  if (d.hit !== key) throw new Bail('I8', `a click on ${key}'s centre picks ${d.hit}`);
  const t = await markEvent(page);
  await page.mouse.click(d.x, d.y);
  const held = await waitFor(page, (k) => window.__earth.ctl.state.sky?.body === k, key, 15000);
  if (!held) throw new Bail('I8', `clicking ${key} does not hold it`);
  return t;
}

async function waitApproach(page, level = 0.95, timeout = 40000) {
  return waitFor(page, (l) => (window.__earth.engine.sky?.approach ?? 0) >= l, level, timeout);
}

/** The orbit satellite to click: Jung's own links first, then the atlas's; only one that is shown and reachable. */
async function satCentre(page) {
  return page.evaluate(() => {
    const cands = [...document.querySelectorAll('.po-sat')].map((b) => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent, inner: b.classList.contains('po-inner') ? 1 : 0, x: r.left + r.width / 2, y: r.top + r.height / 2, o: parseFloat(b.style.opacity || '0'), pe: b.style.pointerEvents, w: r.width };
    }).filter((c) => c.o > 0.9 && c.pe !== 'none' && c.w > 0);
    cands.sort((a, b) => b.inner - a.inner);
    return cands[0] ?? null;
  });
}

/** A point of the canvas in empty space: away from the held planet, its orbits, and the Earth's disc. */
async function emptySpot(page) {
  return page.evaluate(() => {
    const { engine } = window.__earth;
    const cv = engine.renderer.domElement.getBoundingClientRect();
    const g = { x: 0, y: 0, r: 0 };
    engine.globeDisc(g);
    const d = window.__skyPlanetDisc(window.__earth.ctl.state.sky?.body ?? 'venus');
    const gx = g.x, gy = g.y;
    for (const fy of [0.12, 0.88, 0.2, 0.8, 0.5]) {
      for (const fx of [0.1, 0.9, 0.25, 0.75, 0.5]) {
        const x = Math.round(cv.left + cv.width * fx), y = Math.round(cv.top + cv.height * fy);
        const cx = x - cv.left, cy = y - cv.top;
        if (Math.hypot(cx - gx, cy - gy) < g.r + 40) continue;
        if (d && Math.hypot(cx - d.x, cy - d.y) < d.px * 1.3 + 70) continue;
        if (engine.sky.pick(cx, cy, 30)) continue;
        const el = document.elementFromPoint(x, y);
        if (el && el.tagName.toLowerCase() === 'canvas') return { x, y };
      }
    }
    return null;
  });
}

/** Projection sanity: the NDC the harness computes must land on the disc the sky draws (CSS px, within 3 px). */
async function calibrate(page, key) {
  const c = await page.evaluate((k) => {
    const cv = window.__earth.engine.renderer.domElement.getBoundingClientRect();
    const n = window.__skyNdcOf(k), d = window.__skyPlanetDisc(k);
    if (!n || !d || !d.on) return null;
    return { x: (n.x * 0.5 + 0.5) * cv.width, y: (1 - (n.y * 0.5 + 0.5)) * cv.height, dx: d.x, dy: d.y };
  }, key);
  if (!c) { fail('CAL', `${key} has no projected position or drawn disc`); return; }
  const err = Math.hypot(c.x - c.dx, c.y - c.dy);
  check('CAL', err <= 3, `projection of ${key} matches its drawn disc: ${f(err, 1)} px off (${f(c.x, 0)},${f(c.y, 0)} vs ${f(c.dx, 0)},${f(c.dy, 0)})`);
}

/** A click on the first float plate (the subject's), by pointer when it can reach it, else by a DOM click. Returns the stamp. */
async function clickFirstPlate(page, R) {
  const plate = page.locator('.floats .float').first();
  const hit = await plate.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const h = document.elementFromPoint(x, y);
    const name = h ? h.tagName.toLowerCase() + (typeof h.className === 'string' && h.className ? `.${h.className.split(' ')[0]}` : '') : 'nothing';
    return { x, y, ok: !!h && !!h.closest('.float'), name, pe: getComputedStyle(el).pointerEvents };
  });
  R.plateHit = hit;
  if (hit.ok) return { stamp: await markedClick(page, 'plate', hit.x, hit.y), hit };
  await page.evaluate(() => { window.__marks.plate = null; document.querySelector('.floats .float')?.click(); });
  return { stamp: await page.evaluate(() => window.__marks.plate), hit };
}

// ── Scenario A (and D on the natal chart) ─────────────────────────────────────
async function flowA(page, M, R, cfg) {
  M.start = await markEvent(page);
  M.pick = cfg.natal ? M.start : await holdBody(page, 'venus');
  if (!(await waitApproach(page))) throw new Bail('I8', 'the approach to Venus never reached 0.95');
  await waitStill(page, { ms: 600, timeout: 20000 });
  M.held = await markEvent(page);
  R.heldNdcA = await ndcOf(page, 'venus');
  await calibrate(page, 'venus');
  await shot(page, cfg.tag, 'approach-settled', R);

  const sat = await satCentre(page);
  if (!sat) throw new Bail('FLOW', 'no orbit satellite is shown around the held planet');
  R.satName = sat.text;
  const orbitStamp = await markedClick(page, 'orbit', sat.x, sat.y);
  if (orbitStamp == null) throw new Bail('FLOW', `the click on the ${sat.text} satellite did not reach it`);
  M.orbit = orbitStamp;
  R.gazeClass = await waitFor(page, () => document.body.classList.contains('sky-gazing'), null, 6000);
  R.gazeStill = await waitStill(page, { ms: 600, timeout: 15000 });
  R.platesAppear = await waitFor(page, () => document.querySelectorAll('.floats .float').length > 0, null, 6000);
  await page.waitForTimeout(300);
  M.gazeSettled = await markEvent(page);
  await shot(page, cfg.tag, 'gaze-settled', R);

  const nPlates = await page.locator('.floats .float').count();
  R.nPlates = nPlates;
  if (!nPlates) throw new Bail('FLOW', `the gaze on ${sat.text} shows no plate`);
  R.reach = await plateReachable(page, 3000);
  const { stamp, hit } = await clickFirstPlate(page, R);
  check('FLOW', hit.ok, `the plate is reachable by a pointer: pointer-events ${R.reach.pe} after ${R.reach.took} ms (limit 3000); the hit test at (${f(hit.x, 0)}, ${f(hit.y, 0)}) gives ${hit.name}`);
  if (stamp == null) throw new Bail('FLOW', 'the plate click did not reach the plate');
  M.plate = stamp;
  await page.waitForTimeout(1200);
  await shot(page, cfg.tag, 'mid-descend', R);
  R.landed = await waitFor(page, () => !window.__earth.ctl.state.sky && !window.__earth.engine.rig.flying, null, 40000);
  await waitStill(page, { ms: 600, timeout: 25000 });
  M.landed = await markEvent(page);
  await shot(page, cfg.tag, 'landed', R);

  const see = page.locator('.focus-label button', { hasText: /See in sky/ }).first();
  const haveSee = await see.waitFor({ timeout: 15000 }).then(() => true, () => false);
  R.haveSee = haveSee;
  if (!haveSee) throw new Bail('I6', 'no "See in sky" link on the landed label');
  R.retBefore = await page.evaluate(() => {
    const s = window.__earth.ctl.state;
    return { hash: location.hash, deep: !!s.deep, lens: s.lens?.id ?? null, sky: !!s.sky, fromSky: !!s.from?.sky, links: [...document.querySelectorAll('.focus-label button')].map((b) => b.textContent.trim()) };
  });
  const box = await see.boundingBox();
  if (!box) throw new Bail('I6', 'the See-in-sky link has no box to click');
  const retStamp = await markedClick(page, 'ret', box.x + box.width / 2, box.y + box.height / 2);
  if (retStamp == null) throw new Bail('I6', 'the click on "See in sky" did not reach the link');
  M.ret = retStamp;
  // the return's compose ends about 2.6 s after the click (lift 1.0 s, compose 1.65 s): the moment is read back with the shot
  const due = M.ret + 2600 - (await markEvent(page));
  if (due > 0) await page.waitForTimeout(due);
  await shot(page, cfg.tag, 'return-compose-end', R);
  R.returned = await waitFor(page, () => window.__earth.ctl.state.sky?.body === 'venus' && window.__earth.ctl.state.lens?.id === 'astrology', null, 30000);
  await waitStill(page, { ms: 800, timeout: 30000 });
  await page.waitForTimeout(800);
  M.retEnd = await markEvent(page);
  await shot(page, cfg.tag, 'return-arrived', R);

  if (cfg.natal) {
    // the sheet's own close: X on the sheet must not put the shell in Field
    const x = page.locator('.lens-panel .lp-close').first();
    if (await x.isVisible().catch(() => false)) {
      M.sheetX = await markEvent(page);
      R.sheetX = '.lens-panel .lp-close';
      await x.click({ timeout: 8000 }).catch((e) => { R.sheetWhy = e.message.split('\n')[0]; });
      await page.waitForTimeout(1500);
      M.sheetEnd = await markEvent(page);
    } else R.sheetWhy = 'no visible sheet close button (.lens-panel .lp-close)';
  }
}

/** The return, from the first sky frame after the click to the first 'approach' frame: LIFT, COMPOSE, CLIMB (spec §2.6). */
function analyseReturn(S, M, R, key) {
  const rw = S.filter((s) => s.t >= M.ret);
  const sk = rw.findIndex((s) => s.sky);
  if (sk < 0) { fail('I6', 'the return: no sky frame after the click'); return; }
  const ai = rw.findIndex((s, i) => i > sk && s.skyPhase === 'approach');
  if (ai < 0) { fail('I6', 'the return never reached phase approach'); return; }
  const win = rw.slice(sk, ai + 1);
  const body = win.slice(0, -1);
  const end = win[win.length - 1];
  const tAt = (s) => `+${f(s.t - M.ret, 0)} ms`;

  const badPh = body.filter((s) => s.skyPhase !== 'return');
  const phs = [...new Set(badPh.map((s) => s.skyPhase))].join('/') || 'none';
  check('I6', badPh.length === 0 && end.skyPhase === 'approach' && end.approached === key,
    `phase 'return' on all ${body.length} frames from the first sky frame (${tAt(win[0])}) to the approach (${badPh.length} other: ${phs}); the approach frame reads phase ${end.skyPhase}, approached ${end.approached}`);
  const c10 = body.filter((s) => s.skyPhase === 'settled' || s.skyPhase === 'system');
  check('I6', c10.length === 0, `C10 guard: the return never reads phase 'settled' or 'system' (${c10.length} frames)`);

  // LIFT → COMPOSE → CLIMB, from the camera distance from the Earth (R⊕) alone
  const cd = body.map((s) => s.camDist);
  let p0 = -1, p1 = -1;
  for (let i = 0; i < body.length && p0 < 0; i++) {
    if (cd[i] < 20) continue;
    let j = i;
    while (j + 1 < body.length && Math.abs(cd[j + 1] - cd[i]) <= 0.005 * cd[i]) j++;
    if (body[j].t - body[i].t >= 400) { p0 = i; p1 = j; }
  }
  if (p0 < 0) {
    fail('I6', 'LIFT: the camera distance never settles on a plateau of 20 R⊕ or more (no run of 0.4 s within 0.5 %)');
    return;
  }
  const countDrops = (xs, tol) => { let n = 0; for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1] * (1 - tol)) n++; return n; };
  const lift = body.slice(0, p0 + 1);
  const liftDrops = countDrops(lift.map((s) => s.camDist), 0.01);
  const pl = body[p0];
  const planetFront = !!pl.planet && !pl.planet.behind && Number.isFinite(pl.planet.x) && Number.isFinite(pl.planet.y);
  check('I6', planetFront && liftDrops === 0 && cd[p0] >= 20,
    `LIFT: camera distance ${f(cd[0], 2)} → plateau ${f(cd[p0], 2)} R⊕ at ${tAt(body[p0])} (${liftDrops} falls of more than 1 %); the planet's NDC at the plateau (${f(pl.planet?.x)}, ${f(pl.planet?.y)}) ${pl.planet?.behind ? 'is behind the camera' : 'is in front'}, drawn ${!!pl.pDisc?.on}`);

  const plate = body.slice(p0, p1 + 1);
  const pe = body[p1];
  const sep = pe.pDisc?.on && pe.globe ? Math.hypot(pe.pDisc.x - pe.globe.x, pe.pDisc.y - pe.globe.y) - (pe.pDisc.px / 2 + pe.globe.r) : NaN;
  const framed = (n) => ndcOk(n);
  const okFrames = plate.filter((s) => framed(s.planet) && framed(s.earth)).length;
  check('I6', framed(pe.planet) && framed(pe.earth) && Number.isFinite(sep) && sep >= 0,
    `COMPOSE: at the plateau end (${plate.length} frames, ${f(plate.at(-1).t - plate[0].t, 0)} ms): planet NDC (${f(pe.planet?.x)}, ${f(pe.planet?.y)}), Earth NDC (${f(pe.earth.x)}, ${f(pe.earth.y)}), discs ${sep >= 0 ? 'separate' : 'overlap'} by ${f(sep, 1)} px; both inside |NDC| ≤ 0.85 on ${okFrames} of ${plate.length} plateau frames`);

  const climb = win.slice(p1 + 1);
  let drops = 0, worst = 1;
  for (let i = 1; i < climb.length; i++) {
    const r = climb[i].camDist / climb[i - 1].camDist;
    worst = Math.min(worst, r);
    if (r < 0.99) drops++;
  }
  check('I6', climb.length > 1 && drops === 0 && end.skyPhase === 'approach' && end.approached === key,
    `CLIMB: camera distance ${f(cd[p1], 2)} → ${f(end.camDist, 2)} R⊕ over ${f(end.t - plate.at(-1).t, 0)} ms, rising monotonically (${drops} steps down of more than 1 %, worst step ratio ${f(worst, 4)}); ends in phase ${end.skyPhase} with approached ${end.approached}, rigDist ${f(end.rigDist, 3)}`);

  // the end of the return: the orbits stand only once stationed; no field chrome during it
  const win2 = S.filter((s) => s.t >= M.ret && s.t <= (M.retEnd ?? Infinity));
  const orbitsEarly = win2.filter((s) => s.orbits && s.approach < 0.5);
  check('I6', orbitsEarly.length === 0, `orbits shown only once the station is reached: ${orbitsEarly.length} frames with orbits before approach 0.5`);
  const filt = win2.filter((s) => s.fieldFilter);
  check('I6', filt.length === 0, `field filter / name-types not visible during the return: ${filt.length} of ${win2.length} frames visible`);
  const chrome = win2.filter((s) => s.t >= M.ret + 150 && (s.floats > 0 || s.labelVisible));
  check('I6', chrome.length === 0, `plates and label cleared during the return: ${chrome.length} frames with field chrome after 150 ms`);
  const endEnd = at(S, M.retEnd ?? Infinity);
  if (endEnd) {
    check('I6', endEnd.lens === 'astrology' && endEnd.sky, `end of return: lens ${endEnd.lens}, sky ${endEnd.sky}`);
    check('I6', endEnd.approached === key && endEnd.skyBody === key, `end of return: the approached body is ${endEnd.approached}, held ${endEnd.skyBody} (want ${key})`);
    check('I6', endEnd.orbits, `end of return: the orbits are shown (${endEnd.orbits})`);
    check('I6', !endEnd.fieldFilter, `end of return: field filter not visible (${endEnd.fieldFilter})`);
    check('I6', ndcOk(endEnd.planet), `end of return: the planet is in frame at NDC (${f(endEnd.planet?.x)}, ${f(endEnd.planet?.y)})`);
    check('PHASE', endEnd.skyPhase === 'approach', `end of return: body phase ${endEnd.skyPhase} (want approach)`);
    console.log(`     See in sky, before the click: ${JSON.stringify(R.retBefore)}; at the end: hash ${endEnd.hash}, lens ${endEnd.lens}, sky ${endEnd.sky}, approached ${endEnd.approached}, returned: ${!!R.returned}`);
  }
}

function analyseA(S, M, R, cfg) {
  if (!M.start) { fail('FLOW', 'the scenario did not start'); return; }
  const commit = M.plate ? first(S, (s) => s.t > M.plate && !s.sky) : null;
  const commitT = commit ? commit.t : Infinity;

  // I1 — the mode seal: lens astrology with a sky, every frame until the descend commits
  const i1 = S.filter((s) => s.t >= M.start && s.t < commitT);
  const i1bad = i1.filter((s) => !(s.lens === 'astrology' && s.sky));
  check('I1', i1bad.length === 0 && i1.length > 0,
    `mode seal through the choreography: ${i1.length} frames to the descend commit${commit ? ` (+${f(commit.t - M.plate, 0)} ms)` : ' (no commit seen)'}, ${i1bad.length} violating${i1bad[0] ? `; first ${describeFrame(i1bad[0])}` : ''}`);

  // I12 — no ejection: approach, gaze and the return keep lens astrology with a sky (C10)
  const i12 = S.filter((s) => (s.t >= M.start && s.t < commitT) || (M.ret && s.t >= M.ret));
  const i12bad = i12.filter((s) => !(s.lens === 'astrology' && s.sky));
  check('I12', i12bad.length === 0 && i12.length > 0,
    `no ejection through approach, gaze and return: ${i12.length} frames, ${i12bad.length} violating${i12bad[0] ? `; first violating frame ${describeFrame(i12bad[0])}` : ''}`);

  // I8 — pick in sky: no zoom-out-and-wait (not from a chart, where nothing is picked)
  if (!cfg.natal && M.pick) {
    const d0 = at(S, M.pick)?.camDist;
    const turn = first(S, (s) => s.t > M.pick && s.t <= (M.held ?? Infinity) && s.planet && !s.planet.behind && Math.abs(s.planet.x) <= 0.5 && Math.abs(s.planet.y) <= 0.5);
    const win8 = S.filter((s) => s.t >= M.pick && s.t <= (turn ? turn.t : (M.held ?? Infinity)));
    const peak = Math.max(...win8.map((s) => s.camDist));
    const rise = d0 ? peak / d0 - 1 : NaN;
    check('I8', Number.isFinite(rise) && rise <= 0.15,
      `pick Venus from the whole sky: camera distance ${f(d0, 1)} → peak ${f(peak, 1)} (${f(100 * rise, 1)} %) before the planet is turned into view${turn ? ` (+${f(turn.t - M.pick, 0)} ms)` : ' (never turned into view)'}`);
  }

  // I2 — gaze does not translate
  const s0 = at(S, M.orbit), s1 = at(S, M.gazeSettled);
  if (s0 && s1 && M.orbit) {
    const moved = Math.hypot(s1.cam[0] - s0.cam[0], s1.cam[1] - s0.cam[1], s1.cam[2] - s0.cam[2]);
    const allow = 0.002 * s0.camDist;
    const pd = s0.pCam ? Math.abs(s1.pCam - s0.pCam) / s0.pCam : NaN;
    const ok = moved <= allow || (Number.isFinite(pd) && pd <= 0.005);
    check('I2', ok, `gaze on ${R.satName ?? 'the orbit'}: camera moved ${f(moved, 4)} (allowed ${f(allow, 4)}, 0.2 % of dist)${moved > allow ? `; as a swing it keeps the planet at ${f(100 * pd, 2)} % of its distance (≤ 0.5 %)` : ''}`);
  } else fail('I2', 'gaze samples not reached');

  // I3 — gaze composes: planet and Earth in frame, Earth not covered by the planet's disc
  const sg = at(S, M.gazeSettled);
  if (sg) {
    const occl = sg.pCam != null && sg.pCam < sg.camDist && sg.pDisc && sg.pDisc.on
      && Math.hypot(sg.pDisc.x - sg.globe.x, sg.pDisc.y - sg.globe.y) < sg.pDisc.px / 2 + sg.globe.r;
    const ok = ndcOk(sg.planet) && ndcOk(sg.earth) && !occl;
    check('I3', ok, `at gaze settle: planet NDC (${f(sg.planet?.x)}, ${f(sg.planet?.y)})${sg.planet?.behind ? ' [behind camera]' : ''}, Earth NDC (${f(sg.earth.x)}, ${f(sg.earth.y)}), planet ${occl ? 'covers' : 'does not cover'} the Earth's disc (limit |NDC| ≤ 0.85 for both)`);
  } else fail('I3', 'no gaze settle sample');

  // the phase contract: 'approach' while held, 'gaze' from the gaze's first frame to the plate click
  const held = at(S, M.held);
  if (held) check('PHASE', held.skyPhase === 'approach', `held at the approach: phase ${held.skyPhase} (want approach)`);
  const g0 = M.orbit ? first(S, (s) => s.t >= M.orbit && s.skyPhase === 'gaze') : null;
  if (g0 && M.plate) {
    const gw = S.filter((s) => s.t >= g0.t && s.t < M.plate);
    const gbad = gw.filter((s) => s.skyPhase !== 'gaze');
    check('PHASE', gw.length > 0 && gbad.length === 0,
      `gaze: phase 'gaze' on all ${gw.length} frames from the gaze's first frame (${f(g0.t - M.orbit, 0)} ms after the click) to the plate click (${gbad.length} other${gbad[0] ? `: ${gbad[0].skyPhase}` : ''}); phase at the gaze settle ${sg?.skyPhase}`);
  } else fail('PHASE', 'no gaze frame with phase gaze');

  // I5 — descend is clean
  if (M.plate) {
    const hid = after(S.filter((s) => s.t <= (M.landed ?? Infinity)), M.plate + 150);
    if (hid) check('I5', !hid.orbits && !hid.earthLine && hid.floats === 0,
      `orbits, Earth line and plates hidden within 150 ms of the plate click: at +${f(hid.t - M.plate, 0)} ms orbits ${hid.orbits}, line ${hid.earthLine}, plates ${hid.floats}`);
    const flight = S.filter((s) => s.t > M.plate && s.t <= (M.landed ?? Infinity));
    const lab = first(flight, (s) => s.labelVisible);
    if (!lab) pass('I5', 'label, reveal and deep not shown during the descend (never visible in this run)');
    else {
      const win = S.filter((s) => s.t >= lab.t - 300 && s.t <= lab.t);
      const swing = Math.max(0, ...win.map((s) => angleDeg(s.look, lab.look)));
      const dz = Math.max(0, ...win.map((s) => Math.abs(s.camDist - lab.camDist) / lab.camDist));
      const stillWin = win.length > 1 && win.every((s) => !s.flying) && swing <= 0.05 && dz <= 1e-4;
      check('I5', !lab.flying && stillWin, `label first shown at +${f(lab.t - M.plate, 0)} ms: flying ${lab.flying}, over the 300 ms before it the look moves ${f(swing, 3)}° and dist ${f(100 * dz, 4)} % (limit 0.05° and 0.01 %), flying in ${win.filter((s) => s.flying).length} of ${win.length} frames`);
    }
    // The descent is time-based, so how far it moves in one frame is the speed times the frame's length: a slow frame (software
    // GL, a loaded machine) is a bigger step on a perfectly smooth track. Two statistics, so neither can hide the other:
    //  - the speed: the step scaled to a 60 fps frame (≤ 12 % of the distance), and
    //  - no relocation: the raw step of any one frame, however long that frame (≤ 30 %; the bug this guards was 140 %).
    let maxJ = 0, maxRaw = 0, worst = null, worstRaw = null;
    for (let i = 1; i < flight.length; i++) {
      const a = flight[i - 1], b = flight[i];
      const raw = Math.hypot(b.cam[0] - a.cam[0], b.cam[1] - a.cam[1], b.cam[2] - a.cam[2]) / b.camDist;
      const dtMs = Math.max(b.t - a.t, 1);
      const j = raw * Math.min(1, 16.7 / dtMs);
      if (j > maxJ) { maxJ = j; worst = { a, b, dtMs }; }
      if (raw > maxRaw) { maxRaw = raw; worstRaw = { a, b, dtMs }; }
    }
    check('I5', maxJ <= 0.12 && flight.length > 1, `camera speed smooth through the descend: largest step per 60 fps frame ${f(100 * maxJ, 1)} % of dist (limit 12 %)${worst ? ` at +${f(worst.b.t - M.plate, 0)} ms (frame ${f(worst.dtMs, 0)} ms), dist ${f(worst.a.camDist, 1)} → ${f(worst.b.camDist, 1)}, rig.flying ${worst.b.flying}` : ''}`);
    check('I5', maxRaw <= 0.30 && flight.length > 1, `camera does not relocate through the descend: largest single-frame step ${f(100 * maxRaw, 1)} % of dist (limit 30 %)${worstRaw ? ` at +${f(worstRaw.b.t - M.plate, 0)} ms (frame ${f(worstRaw.dtMs, 0)} ms)` : ''}`);
    check('I5', !!R.landed, `the descend lands on the field node (${R.landed ? 'landed' : 'never left the sky'})`);
    // the descend's phase: 'descend' from the commit until 'settled'
    if (commit) {
      const settle = first(S, (s) => s.t >= commit.t && s.skyPhase === 'settled');
      const dwin = S.filter((s) => s.t >= commit.t && (!settle || s.t < settle.t));
      const dbad = dwin.filter((s) => s.skyPhase !== 'descend');
      check('PHASE', dwin.length > 0 && dbad.length === 0 && !!settle,
        `descend: phase 'descend' on all ${dwin.length} frames from the commit to 'settled' (${dbad.length} other${dbad[0] ? `: ${dbad[0].skyPhase}` : ''}); 'settled' at +${settle ? f(settle.t - M.plate, 0) : 'n/a'} ms`);
    }
    if (M.landed) {
      const l = at(S, M.landed);
      check('PHASE', l.skyPhase === 'settled', `after landing the phase is ${l.skyPhase} (want settled)`);
    }
  } else fail('I5', 'no plate click reached');

  // I6 — the return is the inverse of gaze and descend
  if (M.ret) analyseReturn(S, M, R, 'venus');
  else fail('I6', 'the return was never started');

  // D — the sheet's X on Jung's chart never lands in Field
  if (cfg.natal) {
    if (M.sheetX) {
      const xs = S.filter((s) => s.t >= M.sheetX && s.t <= (M.sheetEnd ?? Infinity));
      const xbad = xs.filter((s) => !(s.lens === 'astrology' && s.sky));
      const e = at(S, M.sheetEnd ?? Infinity);
      check('D', xs.length > 1 && xbad.length === 0 && e && e.hash.startsWith('#/astrology') && e.lens === 'astrology' && e.sky && !e.fieldFilter,
        `X on the sheet (${R.sheetX}) never lands in Field: ${xs.length} frames, ${xbad.length} outside astrology with a sky; at the end hash ${e?.hash}, lens ${e?.lens}, sky ${e?.sky}, field filter ${e?.fieldFilter}${R.sheetWhy ? `; click note: ${R.sheetWhy}` : ''}`);
    } else skip('D', 'X on the sheet', R.sheetWhy ?? 'no sheet close button');
  }
}

// ── Scenario B ───────────────────────────────────────────────────────────────
async function flowB(page, M, R) {
  M.start = await markEvent(page);
  M.pick = await holdBody(page, 'venus');
  if (!(await waitApproach(page))) throw new Bail('I4', 'the approach to Venus never reached 0.95');
  await waitStill(page, { ms: 600, timeout: 20000 });
  M.held = await markEvent(page);
  R.heldNdcB = await ndcOf(page, 'venus');
  const sat = await satCentre(page);
  if (!sat) throw new Bail('I4', 'no orbit satellite to gaze from');
  const stamp = await markedClick(page, 'orbit', sat.x, sat.y);
  if (stamp == null) throw new Bail('I4', 'the click on the satellite did not reach it');
  M.orbit = stamp;
  await waitFor(page, () => document.body.classList.contains('sky-gazing'), null, 6000);
  await waitStill(page, { ms: 600, timeout: 15000 });
  await waitFor(page, () => document.querySelectorAll('.floats .float').length > 0, null, 6000);
  await page.waitForTimeout(300);
  M.gazeSettled = await markEvent(page);
  const spot = await emptySpot(page);
  if (!spot) throw new Bail('I4', 'no empty canvas point to click off to');
  M.cancel = await markEvent(page);
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(2000);
  await waitStill(page, { ms: 500, timeout: 15000 });
  M.cancelEnd = await markEvent(page);
  await page.waitForTimeout(300);
  await shot(page, 'B', 'after-cancel', R);
}

function analyseB(S, M, R) {
  if (!M.pick) { fail('FLOW', 'scenario B did not start'); return; }
  const i1 = S.filter((s) => s.t >= M.start);
  const i1bad = i1.filter((s) => !(s.lens === 'astrology' && s.sky));
  check('I1', i1bad.length === 0, `mode seal through the cancel: ${i1.length} frames, ${i1bad.length} violating${i1bad[0] ? `; first ${describeFrame(i1bad[0])}` : ''}`);
  const i12 = S.filter((s) => s.t >= M.pick);
  const i12bad = i12.filter((s) => !(s.lens === 'astrology' && s.sky));
  check('I12', i12bad.length === 0, `no ejection through approach, gaze and cancel: ${i12.length} frames, ${i12bad.length} violating${i12bad[0] ? `; first violating frame ${describeFrame(i12bad[0])}` : ''}`);
  const gz = at(S, M.gazeSettled);
  if (gz) check('PHASE', gz.skyPhase === 'gaze', `phase at the gaze settle: ${gz.skyPhase} (want gaze)`);
  if (!M.cancel) { fail('I4', 'the cancel was never made'); return; }
  const a = after(S, M.cancel + 1200);
  const held = R.heldNdcB;
  if (a && held && a.planet) {
    const dx = Math.abs(a.planet.x - held.x), dy = Math.abs(a.planet.y - held.y);
    check('I4', dx <= 0.08 && dy <= 0.08, `cancel re-centres: planet NDC (${f(a.planet.x)}, ${f(a.planet.y)}) at +${f(a.t - M.cancel, 0)} ms vs held (${f(held.x)}, ${f(held.y)}), |Δ| ${f(Math.max(dx, dy), 3)} (limit 0.08)`);
  } else fail('I4', 'no planet NDC after the cancel');
  const release = first(S, (s) => s.t > M.cancel && !s.gazing && !s.classes.includes('sky-gazing'));
  check('I4', !!release && release.t - M.cancel <= 1200, `gaze released within 1.2 s: ${release ? `at +${f(release.t - M.cancel, 0)} ms` : 'never'}`);
  const after4 = S.filter((s) => s.t >= M.cancel);
  const bodyOk = after4.every((s) => s.sky && s.skyBody === 'venus');
  check('I4', bodyOk, `the held body stays venus through the cancel (${after4.filter((s) => s.skyBody !== 'venus' || !s.sky).length} frames otherwise)`);
  const jump = maxLookJump(between(S, M.cancel, M.cancelEnd ?? Infinity));
  check('I4', jump.deg <= 7, `no look jump over 7° between consecutive frames: largest ${f(jump.deg, 2)}°${jump.t ? ` at +${f(jump.t - M.cancel, 0)} ms` : ''}`);
  const ce = at(S, M.cancelEnd ?? Infinity);
  if (ce) check('PHASE', ce.skyPhase === 'approach', `after the cancel the phase is ${ce.skyPhase} (want approach)`);
}

// ── Scenario C ───────────────────────────────────────────────────────────────
async function flowC(page, M, R) {
  await waitStill(page, { ms: 800, timeout: 30000 });
  R.refC = await poseNow(page);
  M.start = await markEvent(page);
  M.pick = await holdBody(page, 'venus');
  if (!(await waitApproach(page))) throw new Bail('I7', 'the approach to Venus never reached 0.95');
  await waitStill(page, { ms: 600, timeout: 20000 });
  M.held = await markEvent(page);
  const btn = page.locator('.po-earth');
  const shown = await btn.waitFor({ timeout: 10000 }).then(() => true, () => false);
  if (!shown) throw new Bail('I7', 'no "Whole sky" control on the held planet');
  M.whole = await markEvent(page);
  R.atWhole = await poseNow(page);
  await btn.click({ timeout: 8000 });
  await waitFor(page, () => window.__earth.ctl.state.sky && window.__earth.ctl.state.lens?.id === 'astrology', null, 20000);
  R.wholeStill = await waitStill(page, { ms: 800, timeout: 40000 });
  M.wholeEnd = await markEvent(page);
  R.final = await poseNow(page);
  await shot(page, 'C', 'whole-sky', R);
  await page.waitForTimeout(3000);
  M.driftEnd = await markEvent(page);
}

function analyseC(S, M, R) {
  if (!M.pick) { fail('FLOW', 'scenario C did not start'); return; }
  const i1 = S.filter((s) => s.t >= M.start);
  const i1bad = i1.filter((s) => !(s.lens === 'astrology' && s.sky));
  check('I1', i1bad.length === 0, `mode seal through Whole sky: ${i1.length} frames, ${i1bad.length} violating${i1bad[0] ? `; first ${describeFrame(i1bad[0])}` : ''}`);
  const i12 = S.filter((s) => s.t >= M.pick);
  const i12bad = i12.filter((s) => !(s.lens === 'astrology' && s.sky));
  check('I12', i12bad.length === 0, `no ejection through approach and Whole sky: ${i12.length} frames, ${i12bad.length} violating${i12bad[0] ? `; first violating frame ${describeFrame(i12bad[0])}` : ''}`);
  if (!M.wholeEnd) { fail('I7', 'Whole sky never settled'); return; }

  const ref = R.refC, fin = R.final;
  const look = angleDeg(fin.look, ref.look);
  const dd = Math.abs(fin.camDist - ref.camDist) / ref.camDist;
  check('I7', look <= 0.5 && dd <= 0.02, `final pose vs the canonical system frame: look ${f(look, 3)}° (limit 0.5°), distance ${f(100 * dd, 2)} % (limit 2 %)`);
  const seg = between(S, M.whole, M.wholeEnd);
  const arc = angleDeg(R.atWhole.look, fin.look);
  const path = pathLength(seg);
  const limit = 1.25 * arc + (arc < 0.5 ? 0.05 : 0);
  check('I7', path <= limit, `Whole sky travels no detour: look path ${f(path, 2)}° vs shortest arc ${f(arc, 2)}° (limit ${f(limit, 2)}°, 1.25×)`);
  const drift = between(S, M.wholeEnd, M.driftEnd);
  if (drift.length > 1) {
    const base = drift[0].look;
    const dmax = Math.max(...drift.map((s) => angleDeg(s.look, base)));
    check('I7', dmax < 0.05, `after arrival the orientation holds: drift ${f(dmax, 3)}° over ${f((drift.at(-1).t - drift[0].t) / 1000, 1)} s (limit 0.05° over 3 s)`);
  } else fail('I7', 'no samples after the arrival to measure drift');
  const we = at(S, M.wholeEnd);
  if (we) check('PHASE', we.skyPhase === 'system', `after Whole sky the phase is ${we.skyPhase} (want system)`);
}

// ── Scenario E: Escape during a gaze ──────────────────────────────────────────
async function flowE(page, M, R) {
  M.start = await markEvent(page);
  M.pick = await holdBody(page, 'venus');
  if (!(await waitApproach(page))) throw new Bail('E', 'the approach to Venus never reached 0.95');
  await waitStill(page, { ms: 600, timeout: 20000 });
  M.held = await markEvent(page);
  R.heldNdcE = await ndcOf(page, 'venus');
  const sat = await satCentre(page);
  if (!sat) throw new Bail('E', 'no orbit satellite to gaze from');
  R.satName = sat.text;
  const stamp = await markedClick(page, 'orbit', sat.x, sat.y);
  if (stamp == null) throw new Bail('E', 'the click on the satellite did not reach it');
  M.orbit = stamp;
  await waitFor(page, () => document.body.classList.contains('sky-gazing'), null, 6000);
  await waitStill(page, { ms: 600, timeout: 15000 });
  await waitFor(page, () => document.querySelectorAll('.floats .float').length > 0, null, 6000);
  await page.waitForTimeout(300);
  M.gazeSettled = await markEvent(page);
  R.platesBefore = await page.locator('.floats .float').count();
  M.esc = await markEvent(page);
  await page.keyboard.press('Escape');
  R.escInWindow = await waitFor(page, () => document.body.dataset.skyPhase === 'approach', null, 1500);
  await waitStill(page, { ms: 800, timeout: 10000 });
  await page.waitForTimeout(300);
  M.escEnd = await markEvent(page);
  R.platesAfter = await page.locator('.floats .float').count();
  await shot(page, 'E', 'after-escape', R);
}

function analyseE(S, M, R) {
  if (!M.esc) { fail('E', 'Escape was never pressed'); return; }
  const ph = first(S, (s) => s.t >= M.esc && s.skyPhase === 'approach');
  const dt = ph ? ph.t - M.esc : Infinity;
  check('E', !!ph && dt <= 1500, `Escape in the gaze: phase 'approach' at +${f(dt, 0)} ms (limit 1500 ms)`);
  const win = S.filter((s) => s.t >= M.esc && s.t <= M.escEnd);
  const off = win.filter((s) => !s.sky || s.skyBody !== 'venus');
  const e = at(S, M.escEnd);
  check('E', win.length > 1 && off.length === 0 && e.approached === 'venus',
    `the held body is still venus after Escape: ${win.length} frames, ${off.length} without state.sky on venus; the layer's approached is ${e.approached}`);
  const i1 = S.filter((s) => s.t >= M.start);
  const i1bad = i1.filter((s) => !(s.lens === 'astrology' && s.sky));
  check('E', i1bad.length === 0, `mode seal through the gaze and Escape: ${i1.length} frames, ${i1bad.length} outside astrology with a sky${i1bad[0] ? `; first ${describeFrame(i1bad[0])}` : ''}`);
  const held = R.heldNdcE;
  if (held && e.planet) {
    const dx = Math.abs(e.planet.x - held.x), dy = Math.abs(e.planet.y - held.y);
    check('E', dx <= 0.08 && dy <= 0.08, `planet NDC after Escape (${f(e.planet.x)}, ${f(e.planet.y)}) vs the held target (${f(held.x)}, ${f(held.y)}), |Δ| ${f(Math.max(dx, dy), 3)} (limit 0.08)`);
  } else fail('E', 'no planet NDC to compare with the held target');
  const jump = maxLookJump(win);
  check('E', jump.deg <= 7, `no look jump over 7° between consecutive frames from Escape to the end: largest ${f(jump.deg, 2)}°${jump.t ? ` at +${f(jump.t - M.esc, 0)} ms` : ''}`);
  check('E', R.platesAfter === 0 && e.floats === 0 && !e.classes.includes('sky-gazing'),
    `the plates are cleared after Escape: ${R.platesAfter} plate(s) in the DOM (before the Escape: ${R.platesBefore}), ${e.floats} visible, sky-gazing ${e.classes.includes('sky-gazing')}`);
}

// ── Scenario F: planet to planet in the sky ──────────────────────────────────
async function flowF(page, M, R) {
  M.start = await markEvent(page);
  M.pick = await holdBody(page, 'venus');
  if (!(await waitApproach(page))) throw new Bail('I8', 'the approach to Venus never reached 0.95');
  await waitStill(page, { ms: 600, timeout: 20000 });
  M.held = await markEvent(page);
  const mars = await page.evaluate(() => {
    const s = window.__earth.engine.sky.screenDisc('mars');
    return s && s.on ? { x: s.x, y: s.y, hit: window.__earth.engine.sky.pick(s.x, s.y, 20) } : null;
  });
  M.pick2 = await markEvent(page);
  if (mars && mars.hit === 'mars') {
    R.route = `canvas pick at (${f(mars.x, 0)}, ${f(mars.y, 0)})`;
    await page.mouse.click(mars.x, mars.y);
  } else {
    // Mars is not drawn from this station: the sky's own route to a body (#/astrology/sky/<body>), as the walk's list takes
    R.route = `route #/astrology/sky/mars (Mars drawn: ${!!mars?.on})`;
    await page.evaluate(() => { location.hash = '#/astrology/sky/mars'; });
  }
  const arrived = await waitFor(page, () => window.__earth.engine.sky?.approached === 'mars' && (window.__earth.engine.sky?.approach ?? 0) >= 0.95, null, 40000);
  if (!arrived) throw new Bail('I8', 'the approach to Mars never reached 0.95');
  await waitStill(page, { ms: 800, timeout: 30000 });
  await page.waitForTimeout(300);
  M.held2 = await markEvent(page);
}

function analyseF(S, M, R) {
  if (!M.pick2) { fail('I8', 'scenario F did not start'); return; }
  const i1 = S.filter((s) => s.t >= M.start);
  const i1bad = i1.filter((s) => !(s.lens === 'astrology' && s.sky));
  check('I1', i1bad.length === 0, `mode seal through planet to planet: ${i1.length} frames, ${i1bad.length} violating${i1bad[0] ? `; first ${describeFrame(i1bad[0])}` : ''}`);
  const d0 = at(S, M.pick2)?.camDist;
  const turn = first(S, (s) => s.t > M.pick2 && s.key === 'mars' && s.planet && !s.planet.behind && Math.abs(s.planet.x) <= 0.5 && Math.abs(s.planet.y) <= 0.5);
  const win = S.filter((s) => s.t >= M.pick2 && (!turn || s.t <= turn.t));
  const peak = Math.max(...win.map((s) => s.camDist));
  const rise = d0 ? peak / d0 - 1 : NaN;
  const end = at(S, M.held2);
  const dest = end?.camDist ?? NaN;
  // a rise is allowed when it is at most 15 %, or when it is the travel itself: the camera never rises above the Mars station
  check('I8', Number.isFinite(rise) && (rise <= 0.15 || peak <= dest * 1.02),
    `planet to planet (${R.route}): camera distance ${f(d0, 1)} → peak ${f(peak, 1)} (${f(100 * rise, 1)} %) before Mars is turned into view${turn ? ` (+${f(turn.t - M.pick2, 0)} ms)` : ' (never turned into view)'}; the Mars station is at ${f(dest, 1)}, so a rise is ${dest > d0 ? 'needed (the station is farther out)' : 'not needed'} (limit 15 % or the station's own distance)`);
  check('F', !!end && end.approached === 'mars' && end.skyBody === 'mars' && end.lens === 'astrology' && end.sky && end.orbits && end.approach >= 0.95,
    `ends approach(mars): approached ${end?.approached}, held ${end?.skyBody}, lens ${end?.lens}, sky ${end?.sky}, orbits shown ${end?.orbits}, approach ${f(end?.approach, 3)}, phase ${end?.skyPhase}`);
  const pl = end?.planet;
  check('F', ndcOk(pl), `Mars in frame at the end: NDC (${f(pl?.x)}, ${f(pl?.y)})`);
}

// ── Scenario G: wheel out from a held planet, then 3 s still ─────────────────
async function flowG(page, M, R) {
  M.start = await markEvent(page);
  M.pick = await holdBody(page, 'venus');
  if (!(await waitApproach(page))) throw new Bail('FLOW', 'the approach to Venus never reached 0.95');
  await waitStill(page, { ms: 800, timeout: 20000 });
  M.held = await markEvent(page);
  const cv = await page.evaluate(() => {
    const r = window.__earth.engine.renderer.domElement.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
  });
  const rigNow = () => page.evaluate(() => {
    const r = window.__earth.engine.rig;
    return { t: +performance.now().toFixed(1), lat: r.lat, lon: r.lon, dist: r.dist, flying: !!r.flying };
  });
  R.g0 = await rigNow();
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(cv.x, cv.y);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(150);
  }
  M.lastWheel = await markEvent(page);
  R.gWheel = await rigNow();
  R.gS = [];
  for (;;) {
    const s = await rigNow();
    R.gS.push(s);
    if (s.t - M.lastWheel >= 3000) break;
    await page.waitForTimeout(100);
  }
}

function analyseG(S, M, R) {
  if (!M.lastWheel || !R.gWheel) { fail('FLOW', 'scenario G did not start'); return; }
  const i12 = S.filter((s) => s.t >= M.start);
  const bad = i12.filter((s) => !(s.lens === 'astrology' && s.sky));
  check('I12', bad.length === 0, `no ejection through the approach and the wheel-out: ${i12.length} frames, ${bad.length} violating`);
  const w0 = R.gWheel;
  const win = R.gS.filter((s) => s.t >= M.lastWheel && s.t <= M.lastWheel + 3000);
  const endS = win.at(-1);
  const pull = w0.dist / R.g0.dist;
  check('G', pull > 1.1, `the wheel pulled the camera back: distance ${f(R.g0.dist, 3)} → ${f(w0.dist, 3)} (ratio ${f(pull, 3)}, want > 1.1)`);
  const drift = Math.max(...win.map((s) => orientDeg(s, w0)));
  const rot = endS ? orientDeg(endS, w0) : NaN;
  check('G', Number.isFinite(rot) && rot <= 3, `after the pull-back the orientation holds: ${f(rot, 3)}° from where the wheel left it, ${f((endS.t - M.lastWheel) / 1000, 2)} s later (limit 3°)`);
  check('G', win.length > 2 && drift < 0.5, `no settle spin over the 3 s after the last wheel step: largest drift ${f(drift, 3)}° in rig lat/lon over ${win.length} samples (limit 0.5°)`);
}

// ── I9 / I10: every tie of every body, on a reduced-motion page ─────────────
async function runTies() {
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const curation = JSON.parse(readFileSync(CURATION, 'utf8')).ties;
  const bodies = Object.keys(data.bodies);
  const density = [];
  const failing = [];
  let tieCount = 0, tieOk = 0;
  const classical = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];
  for (const body of bodies) {
    const seen = new Set();
    const uniq = [];
    for (const t of data.bodies[body].ties) {
      const k = `${t.target.type}:${t.target.id}`;
      if (!seen.has(k)) { seen.add(k); uniq.push(t); }
    }
    // the satellites in DOM order: Jung's links (inner orbit) first, then the atlas's (outer), as orbits.ts places them
    const order = [...uniq.filter((t) => t.basis === 'jung'), ...uniq.filter((t) => t.basis !== 'jung')];
    density.push({ body, ties: uniq.length, classical: classical.includes(body) });
    SCOPE = `I9 ${body}`;
    // normal motion: the orbits turn only when the motion is not reduced (orbits.ts), and a far-side satellite is hidden until it comes round
    const opened = await openSkyPage(browser, { hash: `#/astrology/sky/${body}`, width: VP.width, height: VP.height, reduced: false });
    const { ctx, page, logs } = opened;
    LOGS.push(...logs);
    try {
      const ready = await waitFor(page, () => document.body.classList.contains('sky-ready') && !!window.__earth.ctl.state.sky, null, 120000);
      if (!ready) { fail('I9', `${body}: the sky never reported sky-ready`); continue; }
      await page.evaluate(installClickMarks, RULES);
      const stationed = (b) => page.evaluate((k) => {
        const e = window.__earth.engine;
        return window.__earth.ctl.state.sky?.body === k && e.sky?.approached === k && (e.sky?.approach ?? 0) >= 0.95;
      }, b);
      const arrived = await waitFor(page, (b) => window.__earth.engine.sky?.approached === b && (window.__earth.engine.sky?.approach ?? 0) >= 0.95, body, 40000);
      if (!arrived) { fail('I9', `${body}: the approach never arrived`); continue; }
      await waitStill(page, { ms: 400, timeout: 20000 });
      const nSats = await page.evaluate(() => document.querySelectorAll('.po-sat').length);
      density[density.length - 1].drawn = nSats;
      console.log(`  ${body}: ${uniq.length} ties, ${nSats} satellites drawn, ${order.length} to reach`);
      for (let i = 0; i < order.length; i++) {
        const t = order[i];
        const label = `${t.target.type}:${t.target.id}`;
        const want = `#/${PREFIX[t.target.type] ?? '?'}/${t.target.id}`;
        tieCount++;
        const why = [];
        if (!(await stationed(body))) {
          await page.evaluate((h) => { location.hash = h; }, `#/astrology/sky/${body}`);
          await waitFor(page, (b) => window.__earth.engine.sky?.approached === b && (window.__earth.engine.sky?.approach ?? 0) >= 0.95, body, 30000);
          await waitStill(page, { ms: 300, timeout: 15000 });
        }
        // the satellite must come round to the near side (its orbit turns about a minute): wait up to 75 s for it to be shown
        await waitFor(page, (j) => { const b = document.querySelectorAll('.po-sat')[j]; if (!b) return false; const cs = getComputedStyle(b); return +cs.opacity > 0.9 && cs.pointerEvents !== 'none'; }, i, 75000);
        const sat = await page.evaluate((j) => {
          const b = document.querySelectorAll('.po-sat')[j];
          if (!b) return null;
          const r = b.getBoundingClientRect();
          const cs = getComputedStyle(b);
          return { text: b.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2, pe: cs.pointerEvents, op: +cs.opacity };
        }, i);
        if (!sat || sat.op <= 0.9 || sat.pe === 'none') why.push(`no satellite drawn (${sat ? `opacity ${sat.op}, pointer-events ${sat.pe}` : 'missing'})`);
        let row = { body, i: i + 1, n: order.length, basis: t.basis, label, sat: sat?.text ?? '-', plates: 0, pe: '-', hit: '-', hash: '-', back: '-', want };
        if (!why.length) {
          // the click waits for the camera to be stationed and still: a satellite pressed mid-settle is not a gaze
          await waitFor(page, () => document.body.dataset.skyPhase === 'approach', null, 15000);
          await waitStill(page, { ms: 300, timeout: 15000 });
          await page.mouse.click(sat.x, sat.y);
          let plated = await waitFor(page, () => document.querySelectorAll('.floats .float').length > 0, null, 6000);
          if (!plated) {
            // one retry of the same click, once the camera is still again: recorded in the row
            row.retry = true;
            await waitStill(page, { ms: 300, timeout: 15000 });
            await page.mouse.click(sat.x, sat.y);
            plated = await waitFor(page, () => document.querySelectorAll('.floats .float').length > 0, null, 6000);
          }
          const reach = await plateReachable(page, 3000);
          row.pe = reach.pe ?? '-';
          row.plates = await page.locator('.floats .float').count();
          if (!row.plates) why.push('no plate on the gaze');
          else if (!reach.ok) why.push(`the first plate's pointer-events is ${reach.pe} after ${reach.took} ms`);
          else {
            const plate = page.locator('.floats .float').first();
            const hit = await plate.evaluate((el) => {
              const r = el.getBoundingClientRect();
              const x = r.left + r.width / 2, y = r.top + r.height / 2;
              const h = document.elementFromPoint(x, y);
              return { x, y, ok: !!h && !!h.closest('.float') };
            });
            row.hit = hit.ok ? 'plate' : 'other';
            if (!hit.ok) why.push('the hit test at the first plate\'s centre is not the plate');
            await page.mouse.click(hit.x, hit.y);
            await waitFor(page, (w) => { const h = location.hash.split('?')[0]; return h === w || h.startsWith(`${w}/`); }, want, 6000);
            row.hash = await page.evaluate(() => location.hash.split('?')[0]);
            const landedOn = row.hash === want || row.hash.startsWith(`${want}/`);
            if (!landedOn) why.push(`the first plate lands on ${row.hash}, not ${want}`);
            // back to the body: the sky's own step back, else the body's route
            await page.evaluate(() => window.__earth.ctl.stepBack());
            const back = await waitFor(page, (b) => window.__earth.ctl.state.sky?.body === b && (window.__earth.engine.sky?.approach ?? 0) >= 0.95, body, 25000);
            row.back = back ? 'step back' : 'route';
            if (!back) {
              await page.evaluate((h) => { location.hash = h; }, `#/astrology/sky/${body}`);
              await waitFor(page, (b) => window.__earth.engine.sky?.approached === b && (window.__earth.engine.sky?.approach ?? 0) >= 0.95, body, 30000);
              await waitStill(page, { ms: 300, timeout: 15000 });
            }
          }
        }
        const ok = why.length === 0;
        if (ok) tieOk++;
        console.log(`  ROW ${body.padEnd(8)} ${String(i + 1).padStart(2)}/${order.length} ${t.basis.padEnd(8)} ${label.padEnd(20)} sat "${row.sat}" plates ${row.plates} pe ${row.pe} hit ${row.hit} → ${row.hash} back ${row.back}${row.retry ? ' (click retried)' : ''} ${ok ? 'OK' : `FAIL (${why.join('; ')})`}`);
        if (!ok) failing.push({ body, label, why: why.join('; ') });
      }
    } catch (e) {
      if (isReload(e)) throw e;
      fail('I9', `${body}: the walk stopped: ${String(e.message).split('\n')[0]}`);
    } finally {
      await ctx.close().catch(() => {});
    }
  }
  SCOPE = 'I9';
  for (const x of failing) fail('I9', `tie ${x.label} of ${x.body} is not reachable as the subject: ${x.why}`);
  if (!failing.length && tieCount) pass('I9', `every tie of every body opens plates and the first plate lands on its subject: ${tieOk} of ${tieCount} ties`);
  console.log(`     I9 summary: ${tieOk} of ${tieCount} ties reachable as their subject (${failing.length} failing)`);
  SCOPE = 'I10';
  const thin = density.filter((d) => (d.classical ? d.ties < 6 : d.ties < 4));
  check('I10', thin.length === 0, `orbit density: ${density.map((d) => `${d.body} ${d.ties}`).join(', ')}; classical ≥ 6 and outer ≥ 4 (${thin.length} under: ${thin.map((d) => `${d.body} ${d.ties}`).join(', ') || 'none'})`);
  const drawnBad = density.filter((d) => d.drawn !== undefined && d.drawn !== d.ties);
  check('I10', drawnBad.length === 0 && density.every((d) => d.drawn !== undefined),
    `the orbits drawn match the ties for every body (${density.filter((d) => d.drawn !== undefined).length} bodies read; mismatches: ${drawnBad.map((d) => `${d.body} ${d.drawn}/${d.ties}`).join(', ') || 'none'})`);
  const jungNoCite = [];
  let jungN = 0;
  for (const t of curation) {
    if (t.basis !== 'jung') continue;
    jungN++;
    if (!Array.isArray(t.cites) || t.cites.length < 1) jungNoCite.push(`${t.body}:${t.target?.id}`);
  }
  const jungData = Object.entries(data.bodies).flatMap(([b, v]) => v.ties.filter((t) => t.basis === 'jung').map((t) => ({ b, t })));
  const dataNoCite = jungData.filter(({ t }) => !Array.isArray(t.quotes) || !t.quotes.some((q) => q?.cite?.work));
  check('I10', jungNoCite.length === 0 && dataNoCite.length === 0,
    `every jung-basis tie has a cite: ${jungN} in curation/sky/ties.json (${jungNoCite.length} without), ${jungData.length} in astrology.json (${dataNoCite.length} without)`);
  SCOPE = '';
}

// ── the runner ───────────────────────────────────────────────────────────────
/** One scenario, on a fresh page. A page that reloads under the run (Vite's hot reload after another lane edits src/ in
 * the shared tree) destroys the context: that run is discarded and repeated once, and the repeat is named in the output. */
async function run(name, sc) {
  SCOPE = sc.tag;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const M = {}, R = { shots: [] };
    let ctx = null;
    try {
      const opened = await openSky(sc.hash);
      ctx = opened.ctx;
      await runFlow(name, sc.flow, opened.page, M, R);
      const S = await stopSampler(opened.page);
      LOGS.push(...opened.logs);
      sc.analyse(S, M, R);
      for (const s of R.shots) console.log(`     shot ${s}`);
      return;
    } catch (e) {
      if (isReload(e) && attempt === 1) { console.log(`NOTE ${name}: the page reloaded under the run (Vite hot reload after an edit in the shared tree); repeating it`); continue; }
      if (e instanceof Bail) fail(e.inv, `${name} stopped: ${e.message}`);
      else { fail('ERROR', `${name} harness error: ${e.message}`); console.error(e.stack); }
      return;
    } finally {
      await ctx?.close().catch(() => {});
      SCOPE = sc.tag;
    }
  }
  SCOPE = '';
}

const SCENARIOS = [
  { id: 'A', tag: 'A', name: 'scenario A', hash: '#/astrology', flow: (p, M, R) => flowA(p, M, R, { tag: 'A', natal: false }), analyse: (S, M, R) => analyseA(S, M, R, { tag: 'A', natal: false }) },
  { id: 'B', tag: 'B', name: 'scenario B', hash: '#/astrology', flow: flowB, analyse: analyseB },
  { id: 'C', tag: 'C', name: 'scenario C', hash: '#/astrology', flow: flowC, analyse: analyseC },
  { id: 'D', tag: 'D', name: 'scenario D (Jung\'s chart)', hash: '#/astrology/jung/venus', flow: (p, M, R) => flowA(p, M, R, { tag: 'D', natal: true }), analyse: (S, M, R) => analyseA(S, M, R, { tag: 'D', natal: true }) },
  { id: 'E', tag: 'E', name: 'scenario E (Escape in the gaze)', hash: '#/astrology', flow: flowE, analyse: analyseE },
  { id: 'F', tag: 'F', name: 'scenario F (planet to planet)', hash: '#/astrology', flow: flowF, analyse: analyseF },
  { id: 'G', tag: 'G', name: 'scenario G (wheel out, then still)', hash: '#/astrology', flow: flowG, analyse: analyseG },
];
const PLAN = view === 'phone' ? ['A', 'B', 'D', 'E'] : ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

browser = await launch(kind, { headed: false });
console.log(`sky-choreography (${kind}, ${view} ${VP.width}x${VP.height}${VP.mobile ? ', mobile emulation' : ''}) against ${process.env.EARTH_URL ?? 'http://localhost:5183/'}`);
if (DESK) console.log(`screenshots: ${SHOTS}`);
try {
  for (const sc of SCENARIOS) {
    if (!PLAN.includes(sc.id) || !wants(sc.id)) continue;
    await run(sc.name, sc);
  }
  if (TIES) await runTies();
  else if (DESK) skip('I9', 'reachability (every tie)', 'SKY_TIES=0 or SKY_ONLY excludes it');
  else skip('I9', 'reachability (every tie)', 'desktop only (this is the phone run)');

  // I11 — no console or page errors (remote tile and font fetches the sandbox cannot make are not app errors)
  SCOPE = '';
  const noise = /gibs|earthdata|openstreetmap|tile|fonts\.(gstatic|googleapis)|ERR_NAME|ERR_INTERNET|Failed to fetch/i;
  const errs = LOGS.filter((l) => /^(pageerror|error):/.test(l) && !noise.test(l));
  check('I11', errs.length === 0, `no console or page errors across the scenarios (${LOGS.length} logged warnings and errors, ${errs.length} app errors)${errs.length ? `: ${errs.slice(0, 2).join(' | ').slice(0, 240)}` : ''}`);
} finally {
  await browser.close();
}
console.log(`summary (${kind}, ${view}): ${counts.PASS} pass, ${counts.FAIL} fail, ${counts.SKIP} skip`);
process.exitCode = counts.FAIL ? 1 : 0;
