// Helpers for the Sky ↔ Field acceptance harness (sky-choreography.mjs; spec: ProjectCentral/docs/SKY-CAMERA-SPEC.md §3).
//
// The sampler is installed once per page on window.__earth.engine.onFrame. Each frame it records the camera world
// position and look direction, the held body's NDC (projected through engine.camera, the same matrices the renderer
// uses), the Earth's NDC, the rig state (lat/lon in degrees, distance), the sky state, the page's
// `document.body.dataset.skyPhase` (the SkyCamera's phase contract: system | approach | gaze | descend | return | settled)
// and the visibility of the chrome the spec names.

export const EARTH_URL = process.env.EARTH_URL ?? 'http://localhost:5183/';

/**
 * Runs in the page before any script: Vite's HMR socket is replaced by a silent stub. The harness measures the build it
 * loaded; a src edit made by another lane while a walk runs must not reload the page under it (that destroys the run).
 */
function silenceViteHmr() {
  const Native = window.WebSocket;
  if (!Native) return;
  const isHmr = (proto) => proto === 'vite-hmr' || (Array.isArray(proto) && proto.includes('vite-hmr'));
  function Silent(url) {
    this.url = String(url);
    this.readyState = 0;
    this.protocol = '';
    this.extensions = '';
    this.bufferedAmount = 0;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    this.addEventListener = () => {};
    this.removeEventListener = () => {};
    this.send = () => {};
    this.close = () => {};
  }
  window.WebSocket = new Proxy(Native, {
    construct(target, args) {
      return isHmr(args[1]) ? new Silent(args[0]) : Reflect.construct(target, args);
    },
  });
}

/**
 * Opens the Earth at a hash with the sampler's page setup: the landing is marked seen, Vite's hot reload is silenced,
 * and console errors, page errors and failed requests are recorded (the tile and font fetches the sandbox cannot make
 * are not counted; a failed app request is). `mobile` emulates a phone; `reduced` sets prefers-reduced-motion, which the
 * engine reads for its flights (they then complete at once).
 */
export async function openSkyPage(browser, { hash = '#/astrology', width = 1440, height = 900, mobile = false, reduced = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('aae.landing.seen', '1'); } catch {} });
  await page.addInitScript(silenceViteHmr);
  const logs = [];
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type()) || /\/@vite\/client/.test(m.location()?.url ?? '')) return;
    const at = m.location();
    logs.push(`${m.type()}: ${m.text()}${at?.url ? ` @ ${at.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')}:${at.lineNumber}` : ''}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText !== 'net::ERR_ABORTED' && !/gibs|earthdata|tile|openstreetmap|fonts\.(gstatic|googleapis)/i.test(r.url())) logs.push(`requestfailed: ${r.failure()?.errorText} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)}`);
  });
  await page.goto(EARTH_URL.replace(/\/$/, '/') + hash.replace(/^#/, '#'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__earth && window.__earth.engine && window.__earth.engine.presences, null, { timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 60000 });
  await page.waitForTimeout(600);
  return { ctx, page, logs };
}

// Runs in the page (passed to page.evaluate, so it must be self-contained).
export function installSampler() {
  const W = window;
  const { engine, ctl } = W.__earth;
  W.__skySamples = [];
  W.__skySamplerOn = true;
  if (W.__skySamplerInstalled) return;
  W.__skySamplerInstalled = true;

  const V = engine.camera.position.constructor; // THREE.Vector3, without needing THREE on window
  const dirV = new V();
  const tmp = new V();

  // NDC of a scene point through the camera's current matrices (projectionMatrix already carries the rig's shift).
  const ndc = (v) => {
    const m = engine.camera.matrixWorldInverse.elements;
    const p = engine.camera.projectionMatrix.elements;
    const x = v.x, y = v.y, z = v.z;
    const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const vw = m[3] * x + m[7] * y + m[11] * z + m[15];
    const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12] * vw;
    const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13] * vw;
    const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15] * vw;
    return { x: +(cx / cw).toFixed(4), y: +(cy / cw).toFixed(4), behind: cw <= 0 };
  };
  W.__skyNdcOf = (key) => {
    const P = engine.sky?.scenePosition(key);
    return P ? ndc(P) : null;
  };
  W.__skyPlanetDisc = (key) => {
    const d = engine.sky?.screenDisc(key);
    return d ? { x: d.x, y: d.y, px: d.px, on: d.on } : null;
  };

  // effective opacity through the ancestors; a hidden ancestor is 0
  const effOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden) return 0;
      o *= parseFloat(getComputedStyle(n).opacity);
    }
    return o;
  };
  const cssShown = (el) => {
    if (!el || !el.isConnected) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden) return false;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return effOpacity(el) > 0.05;
  };
  const boxShown = (el) => {
    if (!cssShown(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const keyOf = () => W.__skyWatch ?? engine.sky?.approached ?? ctl.state.sky?.body ?? null;

  engine.onFrame(() => {
    if (!W.__skySamplerOn) return;
    const cam = engine.camera;
    const pos = cam.position;
    cam.getWorldDirection(dirV);
    const rig = engine.rig;
    const layer = engine.sky;
    const key = keyOf();
    let planet = null, pw = null, pCam = null, pDisc = null;
    if (layer && key) {
      const P = layer.scenePosition(key);
      if (P) {
        planet = ndc(P);
        pw = [P.x, P.y, P.z].map((v) => +v.toFixed(5));
        pCam = +pos.distanceTo(P).toFixed(5);
      }
      const d = layer.screenDisc(key);
      if (d) pDisc = { x: +d.x.toFixed(1), y: +d.y.toFixed(1), px: +d.px.toFixed(1), on: !!d.on };
    }
    const globe = { x: 0, y: 0, r: 0 };
    engine.globeDisc(globe);
    const earth = ndc(tmp.set(0, 0, 0));
    const po = document.querySelector('.po');
    const ln = document.querySelector('.po-earth-line');
    const lnLen = ln ? Math.hypot(+ln.getAttribute('x2') - +ln.getAttribute('x1'), +ln.getAttribute('y2') - +ln.getAttribute('y1')) : 0;
    const floats = [...document.querySelectorAll('.floats .float')].filter(boxShown).length;
    const plates = document.querySelectorAll('.floats .float').length;
    const lab = document.querySelector('.focus-label');
    const body = document.body;
    W.__skySamples.push({
      t: +performance.now().toFixed(1),
      camDist: +pos.length().toFixed(5),
      rigDist: +rig.dist.toFixed(5),
      rigLat: +rig.lat.toFixed(5),
      rigLon: +rig.lon.toFixed(5),
      stage: +engine.stageDist.toFixed(5),
      cam: [pos.x, pos.y, pos.z].map((v) => +v.toFixed(6)),
      look: [dirV.x, dirV.y, dirV.z].map((v) => +v.toFixed(6)),
      flying: !!rig.flying,
      gazing: !!rig.gazing,
      approach: +(layer?.approach ?? 0).toFixed(4),
      approached: layer?.approached ?? null,
      lens: ctl.state.lens?.id ?? null,
      sky: !!ctl.state.sky,
      skyBody: ctl.state.sky?.body ?? null,
      view: ctl.state.view?.kind ?? null,
      hash: location.hash,
      skyPhase: body.dataset.skyPhase ?? null,
      key,
      planet, pw, pCam, pDisc,
      earth,
      globe: { x: +globe.x.toFixed(1), y: +globe.y.toFixed(1), r: +globe.r.toFixed(1) },
      orbits: boxShown(po),
      earthLine: !!ln && cssShown(ln) && lnLen > 1,
      floats,
      plates,
      labelVisible: !!lab && lab.classList.contains('on') && boxShown(lab),
      fieldFilter: boxShown(document.querySelector('.sm-filter')),
      lensPanel: boxShown(document.querySelector('.lens-panel')),
      classes: ['sky-gazing', 'po-holding', 'sky-on', 'sky-ready', 'interacted'].filter((c) => body.classList.contains(c)),
    });
  });
}

/**
 * Stamps the page clock for clicks on the rules' targets. A rule is { name, sel, text? }: the stamp `__marks[name]` is set
 * at the pointerdown of a click whose target sits inside `sel` (and whose text matches `text`), in a capture listener, so
 * it is the real click, not the moment Playwright starts its actionability wait. A DOM click with no pointerdown is stamped
 * at the click. Runs in the page.
 */
export function installClickMarks(rules) {
  const W = window;
  W.__marks = W.__marks || {};
  W.__clickRules = rules;
  if (W.__clickMarksOn) return;
  W.__clickMarksOn = true;
  const hit = (e, r) => {
    const el = e.target && e.target.closest ? e.target.closest(r.sel) : null;
    return !!el && (!r.text || new RegExp(r.text).test(el.textContent || ''));
  };
  document.addEventListener('pointerdown', (e) => {
    for (const r of W.__clickRules) if (hit(e, r)) { W.__marks[r.name] = +performance.now().toFixed(1); r.pdAt = performance.now(); }
  }, true);
  document.addEventListener('click', (e) => {
    for (const r of W.__clickRules) if (hit(e, r)) {
      const recent = r.pdAt && performance.now() - r.pdAt < 1000;
      if (!recent) W.__marks[r.name] = +performance.now().toFixed(1);
      r.pdAt = 0;
    }
  }, true);
}

/** Start (or restart) recording. Installs the frame hook once per page. */
export async function startSampler(page) {
  await page.evaluate(installSampler);
}

/** Stop recording and return every sample taken so far. */
export async function stopSampler(page) {
  return page.evaluate(() => { window.__skySamplerOn = false; return window.__skySamples; });
}

/** A page-clock timestamp for a named moment, used to slice the samples. */
export async function markEvent(page) {
  return page.evaluate(() => +performance.now().toFixed(1));
}

/**
 * A mouse click at (x, y) that reports the page-clock stamp its click rule made (`window.__marks[name]`), or null when the
 * click did not land on a rule's target. The stamp is cleared first, so a stale one is never read.
 */
export async function markedClick(page, name, x, y) {
  await page.evaluate((n) => { window.__marks[n] = null; }, name);
  await page.mouse.click(x, y);
  return page.evaluate((n) => window.__marks[n], name);
}

/** The NDC of a body right now (through the same matrices as the sampler), or null when it is not placed. */
export async function ndcOf(page, key) {
  return page.evaluate((k) => window.__skyNdcOf(k), key);
}

/** The drawn disc of a body (CSS px), for cross-checking the projection. */
export async function discOf(page, key) {
  return page.evaluate((k) => window.__skyPlanetDisc(k), key);
}

/** The camera's pose right now, read directly (not from the sampler). */
export async function poseNow(page, key = null) {
  return page.evaluate((k) => {
    const { engine, ctl } = window.__earth;
    const V = engine.camera.position.constructor;
    const d = new V();
    engine.camera.getWorldDirection(d);
    const p = engine.camera.position;
    return {
      t: +performance.now().toFixed(1),
      cam: [p.x, p.y, p.z],
      look: [d.x, d.y, d.z],
      camDist: p.length(),
      rigDist: engine.rig.dist,
      rigLat: engine.rig.lat,
      rigLon: engine.rig.lon,
      flying: !!engine.rig.flying,
      gazing: !!engine.rig.gazing,
      approach: engine.sky?.approach ?? 0,
      lens: ctl.state.lens?.id ?? null,
      sky: !!ctl.state.sky,
      skyBody: ctl.state.sky?.body ?? null,
      phase: document.body.dataset.skyPhase ?? null,
      hash: location.hash,
      key: k,
    };
  }, key);
}

/** Wait until a predicate holds in the page, or the timeout; resolves true or false. */
export async function waitFor(page, pred, arg = null, timeout = 15000) {
  try {
    await page.waitForFunction(pred, arg, { timeout, polling: 100 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait until the camera is still: not flying, no change of look (eps degrees), camera distance, or approach for `ms`.
 * Resolves { ok, took, pose } with ok false on timeout.
 */
export async function waitStill(page, { ms = 500, timeout = 20000, eps = 0.01 } = {}) {
  const t0 = Date.now();
  let ref = null;
  let since = Date.now();
  for (;;) {
    const p = await poseNow(page);
    const moved = !ref
      || angleDeg(p.look, ref.look) > eps
      || Math.abs(p.camDist - ref.camDist) > 1e-5 * p.camDist
      || Math.abs(p.approach - ref.approach) > 1e-4
      || p.flying;
    if (moved) { ref = p; since = Date.now(); }
    if (!p.flying && Date.now() - since >= ms) return { ok: true, took: Date.now() - t0, pose: p };
    if (Date.now() - t0 > timeout) return { ok: false, took: Date.now() - t0, pose: p };
    await page.waitForTimeout(100);
  }
}

/**
 * Wait (≤ timeout) until the first plate of the open gaze is reachable by a pointer: its computed pointer-events is 'auto'.
 * Resolves { ok, took, pe }.
 */
export async function plateReachable(page, timeout = 3000) {
  const t0 = Date.now();
  for (;;) {
    const pe = await page.evaluate(() => {
      const el = document.querySelector('.floats .float');
      return el ? getComputedStyle(el).pointerEvents : null;
    });
    if (pe === 'auto') return { ok: true, took: Date.now() - t0, pe };
    if (Date.now() - t0 > timeout) return { ok: false, took: Date.now() - t0, pe };
    await page.waitForTimeout(100);
  }
}

/** The angle between two vectors, in degrees. */
export function angleDeg(a, b) {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  if (!la || !lb) return 0;
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
}

/** The angular change between two rig orientations (lat, lon in degrees), in degrees: the larger of the two steps. */
export function orientDeg(a, b) {
  const dLat = Math.abs(a.lat - b.lat);
  let dLon = Math.abs(a.lon - b.lon) % 360;
  if (dLon > 180) dLon = 360 - dLon;
  return Math.max(dLat, dLon * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180));
}

/** The largest change of look direction between two consecutive samples, in degrees, and when it happened. */
export function maxLookJump(samples) {
  let deg = 0, at = null;
  for (let i = 1; i < samples.length; i++) {
    const a = angleDeg(samples[i - 1].look, samples[i].look);
    if (a > deg) { deg = a; at = samples[i].t; }
  }
  return { deg, t: at };
}

/** The total look-direction travel over a run of samples, in degrees (the path, not the straight arc). */
export function pathLength(samples) {
  let s = 0;
  for (let i = 1; i < samples.length; i++) s += angleDeg(samples[i - 1].look, samples[i].look);
  return s;
}

/** The samples whose page time lies in [a, b]. */
export function between(samples, a, b) {
  return samples.filter((s) => s.t >= a && s.t <= b);
}

/** The last sample at or before time t (or the first, when t precedes them all). */
export function at(samples, t) {
  let best = samples[0] ?? null;
  for (const s of samples) { if (s.t <= t) best = s; else break; }
  return best;
}

/** The first sample at or after time t, or the last sample when none is that late. */
export function after(samples, t) {
  return samples.find((s) => s.t >= t) ?? samples[samples.length - 1] ?? null;
}
