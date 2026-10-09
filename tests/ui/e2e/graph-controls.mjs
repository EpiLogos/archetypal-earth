// Graph controls, end to end: the camera's clock, the Settings sheet, the double-click, the forces, the keys and
// the touch gestures. Driven with real mouse, keyboard and touch events. Where the sandbox's frame rate would decide
// the outcome, the graph's own clock is stepped at 60 fps (advance) so a run is the same every time.
// Run against the live dev server:  EARTH_HEADLESS=1 node tests/ui/e2e/graph-controls.mjs
import { mkdir } from 'node:fs/promises';
import { launch, URL } from './lib.mjs';

const SHOTS = '.cache/screens/remediation-2026-10-09/graph/after2';
const OCC = 'aboriginal-maiaurli-fire-spark-australia';
const results = [];
const check = (ok, what, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` — ${detail}` : ''}`);
};
const G = (page, fn, arg) => page.evaluate(`(${fn.toString()})(window.__earth.ctl.graph, ${JSON.stringify(arg ?? null)})`);
const snap = (page) => page.evaluate(() => {
  const g = window.__earth.ctl.graph;
  return { k: g.t.k, x: g.t.x, y: g.t.y, auto: g.autoFit, follow: g.follow, visible: g.isVisible, mode: g.stats.mode, hash: location.hash };
});
/** Step the graph's clock by `sec` seconds of 60 fps frames, then draw. */
const advance = (page, sec = 1) => page.evaluate((s) => {
  const g = window.__earth.ctl.graph;
  const n = Math.round(s * 60);
  for (let i = 0; i < n; i++) g.step(1 / 60);
  g.draw();
  g.dirty = false;
}, sec);
const settle = (page) => page.evaluate(() => window.__earth.ctl.graph.settle(400));
/** Wait (by polling frames) until an element stops moving: the Settings button eases to the manifest's left. */
const settled = (page, selector) => page.waitForFunction((sel) => new Promise((done) => {
  const el = document.querySelector(sel);
  let last = el.getBoundingClientRect().left;
  let still = 0;
  const tick = () => {
    const now = el.getBoundingClientRect().left;
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= 4) done(true);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), selector, { timeout: 20000 });
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1);

/** The waits every fresh or reloaded page needs before the graph is the thing under test. */
async function ready(page) {
  await page.waitForFunction(() => window.__earth?.ctl?.graph, null, { timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 60000 });
  const intro = page.locator('#intro:not(.dismissed)');
  if (await intro.count()) await page.getByRole('button', { name: 'Enter the globe' }).click();
  await page.waitForFunction(() => window.__earth.ctl.graph.isVisible, null, { timeout: 60000 });
  await settle(page);
  await advance(page, 1);
}

async function openGraph(browser, { w = 1440, h = 900, mobile = false, hash = '#/graph', reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL + hash, { waitUntil: 'load' });
  await ready(page);
  return { ctx, page, errors };
}

// ── B1: a frame stamped before the view woke must not blow the camera up ──
async function b1(browser) {
  const { ctx, page, errors } = await openGraph(browser);
  const r = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    // a camera away from its frame, so that following it has somewhere to go
    g.setCamera(500, 300, 1.0);
    g.autoFit = true;
    g.follow = 3.4;
    g.camAnim = null;
    g.lastTs = performance.now() + 3000;
    g.loop(performance.now());
    return { k: g.t.k, x: g.t.x, y: g.t.y };
  });
  check(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.k) && r.k >= 0.1 && r.k <= 9, 'B1 a frame stamped before wake leaves a finite camera inside the zoom extent', JSON.stringify(r));
  await advance(page, 3);
  const s = await snap(page);
  check(Number.isFinite(s.x) && Number.isFinite(s.y) && s.k >= 0.1 && s.k <= 9, 'B1 the camera stays sane through ordinary frames', `k ${s.k}`);
  check(errors.length === 0, 'B1 no page errors', errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── B2: the Settings button is on top, big enough to hit, and opens the sheet; hidden under the reading column ──
async function b2(browser) {
  const views = [
    { name: 'desktop', w: 1440, h: 900 },
    { name: 'phone', w: 390, h: 844, mobile: true },
  ];
  for (const vp of views) {
    for (const hash of ['#/graph/a/hero', '#/graph/f/serpent', `#/graph/o/${OCC}`]) {
      const { ctx, page } = await openGraph(browser, { ...vp, hash });
      const tag = `${vp.name} ${hash.replace('#/graph/', '')}`;
      await settled(page, '.gvt-settings');
      const box = await page.locator('.gvt-settings').boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const topIsSettings = (x, y) => page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.gvt-settings'), [x, y]);
      check(await topIsSettings(cx, cy), `B2 ${tag}: the Settings button is the top element at its centre`);
      // a 44 px hit area: 22 px out on every side still lands on the button
      const reach = [await topIsSettings(cx, cy - 22), await topIsSettings(cx, cy + 22), await topIsSettings(cx - 22, cy), await topIsSettings(cx + 22, cy)];
      check(reach.every(Boolean), `B2 ${tag}: the hit area is at least 44 px`, JSON.stringify(reach));
      await page.mouse.click(cx, cy);
      const expanded = await page.locator('.gvt-settings').getAttribute('aria-expanded');
      check(expanded === 'true' && (await page.locator('#graph-settings').isVisible()), `B2 ${tag}: a real click opens the settings`);
      await page.keyboard.press('Escape');
      await ctx.close();
    }
  }
  const { ctx, page } = await openGraph(browser, { hash: '#/graph/f/serpent' });
  await page.getByRole('button', { name: 'Reading', exact: true }).click();
  await page.waitForFunction(() => document.body.classList.contains('deep-open'));
  const vis = await page.evaluate(() => getComputedStyle(document.querySelector('.gv-tools')).visibility);
  check(vis === 'hidden', 'B2 with the reading column open the settings are hidden', vis);
  await ctx.close();
}

// ── B3: two clicks 250 ms apart on a node open that node on the Earth (never a neighbour, never a manifest) ──
async function b3(browser) {
  for (const key of ['a:hero', 'f:serpent']) {
    const { ctx, page } = await openGraph(browser);
    const p = await G(page, (g, k) => g.screenOf(k), key);
    await page.mouse.click(p.x, p.y);
    await advance(page, 0.25);
    await page.mouse.click(p.x, p.y);
    const want = `#/${key.replace(':', '/')}`;
    await page.waitForFunction((h) => location.hash === h, want, { timeout: 5000 }).catch(() => undefined);
    const s = await snap(page);
    check(s.hash === want && !s.visible, `B3 a double-click on ${key} opens it on the Earth`, `hash ${s.hash}, graph visible ${s.visible}`);
    await ctx.close();
  }
}

// ── B4: a user's camera survives the controls: filters and forces do not refit it ──
async function b4(browser) {
  const { ctx, page } = await openGraph(browser);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, -700);
  await page.waitForFunction(() => window.__earth.ctl.graph.autoFit === false, null, { timeout: 5000 });
  await advance(page, 0.5);
  const before = await snap(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Occurrences', exact: true }).click();
  await page.getByRole('button', { name: 'Jung', exact: true }).click();
  await page.locator('.gvt-forces > summary').click();
  const link = page.locator('input[aria-label^="Link distance:"]');
  await link.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await advance(page, 1.5);
  const after = await snap(page);
  check(!after.auto && near(after.k, before.k) && near(after.x, before.x) && near(after.y, before.y), 'B4 filters and a force keep the user camera', `k ${before.k.toFixed(3)} → ${after.k.toFixed(3)}, auto ${after.auto}`);
  await ctx.close();
}

/** Step the clock's own easing and the graph's clock together, at 60 fps, until the cursor's window is at rest. */
const restCursor = (page) => page.evaluate(() => {
  const g = window.__earth.ctl.graph;
  const t = window.__earth.time;
  let n = 0;
  while (n < 900 && !(Math.abs(t.on - 1) < 1e-3 && Math.abs(t.trail - t.trailTarget) < 1e-3 && Math.abs(t.targetU - t.cursorU) < 1e-3)) { t.update(1 / 60); g.step(1 / 60); n++; }
  return n;
});

/** The extent (RMS of the forms about the origin) and the mean link length of a settled layout. */
const shape = (page) => page.evaluate(() => {
  const sim = window.__earth.ctl.graph.sim;
  let sq = 0;
  let n = 0;
  for (const v of sim.nodes()) {
    if (v.g.kind === 'occurrence') continue;
    sq += v.x * v.x + v.y * v.y;
    n++;
  }
  const links = sim.force('link').links();
  let len = 0;
  for (const l of links) len += Math.hypot(l.source.x - l.target.x, l.source.y - l.target.y);
  return { rms: Math.sqrt(sq / n), link: len / links.length };
});
/**
 * A layout from a fresh load (the same seeded arrangement), with one force moved by keyboard on its slider, so the
 * comparison is the force and nothing else: the layout depends on its history, a settled one does not forget it.
 */
async function layoutOf(browser, { hash = '#/graph', label = null, steps = 0, shot = null } = {}) {
  const { ctx, page } = await openGraph(browser, { hash });
  let alpha = null;
  if (label) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.gvt-forces > summary').click();
    await page.locator(`input[aria-label^="${label}:"]`).focus();
    const before = await page.evaluate(() => window.__earth.ctl.graph.sim.alpha());
    for (let i = 0; i < Math.abs(steps); i++) await page.keyboard.press(steps > 0 ? 'ArrowRight' : 'ArrowLeft');
    alpha = { before, after: await page.evaluate(() => window.__earth.ctl.graph.sim.alpha()) };
  }
  await settle(page);
  const m = { ...(await shape(page)), alpha };
  if (shot) await page.screenshot({ path: `${SHOTS}/${shot}` });
  await ctx.close();
  return m;
}

// ── B5: the four forces move the layout, in the direction their names and tooltips say ──
async function b5(browser) {
  const base = await layoutOf(browser);
  const reheat = (label, a) => check(a.after > a.before && a.after > 0.2, `B5 ${label} reheats the layout`, `alpha ${a.before.toFixed(3)} → ${a.after.toFixed(3)}`);
  const centre = await layoutOf(browser, { label: 'Centre', steps: 42 });
  reheat('Centre', centre.alpha);
  check(centre.rms <= base.rms * 0.9, 'B5 Centre up lowers the extent by at least 10%', `rms ${base.rms.toFixed(1)} → ${centre.rms.toFixed(1)}`);
  const repel = await layoutOf(browser, { label: 'Repel', steps: 16 });
  reheat('Repel', repel.alpha);
  check(repel.rms > base.rms, 'B5 Repel up raises the extent', `rms ${base.rms.toFixed(1)} → ${repel.rms.toFixed(1)}`);
  const link = await layoutOf(browser, { label: 'Link force', steps: 16 });
  reheat('Link force', link.alpha);
  check(link.link < base.link, 'B5 Link force up shortens the mean link', `link ${base.link.toFixed(1)} → ${link.link.toFixed(1)}`);
  const dist = await layoutOf(browser, { label: 'Link distance', steps: 7, shot: 'settings-forces-desktop.png' });
  reheat('Link distance', dist.alpha);
  check(dist.link > base.link, 'B5 Link distance up lengthens the mean link', `link ${base.link.toFixed(1)} → ${dist.link.toFixed(1)}`);
  const { ctx, page } = await openGraph(browser);
  const rows = await page.locator('.gvt-forces .gvt-row[title]').count();
  check(rows === 4, 'B5 each force says what it does in its tooltip', `${rows} rows with a title`);
  await ctx.close();
}

// ── B6: touch: a pinch that starts on a node pans and zooms; one finger still drags or taps the node ──
async function b6(browser) {
  const { ctx, page } = await openGraph(browser, { w: 390, h: 844, mobile: true });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const hero = await G(page, (g) => g.screenOf('a:hero'));
  const k0 = (await snap(page)).k;
  await touch('touchStart', [[hero.x, hero.y]]);
  await touch('touchStart', [[hero.x, hero.y], [hero.x + 50, hero.y]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[hero.x - i * 6, hero.y], [hero.x + 50 + i * 6, hero.y]]);
  await touch('touchEnd', []);
  await advance(page, 0.5);
  const k1 = (await snap(page)).k;
  check(Math.abs(k1 - k0) / k0 > 0.05, 'B6 a two-finger pinch that starts on a node zooms the camera', `k ${k0.toFixed(3)} → ${k1.toFixed(3)}`);

  await page.evaluate(() => window.__earth.ctl.graph.refit(0));
  await advance(page, 1);
  const h2 = await G(page, (g) => g.screenOf('a:hero'));
  const w0 = await G(page, (g) => g.worldOf('a:hero'));
  const c0 = await snap(page);
  await touch('touchStart', [[h2.x, h2.y]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[h2.x + i * 8, h2.y + i * 6]]);
  await touch('touchEnd', []);
  await advance(page, 0.4);
  const w1 = await G(page, (g) => g.worldOf('a:hero'));
  const c1 = await snap(page);
  check(Math.hypot(w1.x - w0.x, w1.y - w0.y) > 5, 'B6 a one-finger drag from a node still moves the node', `moved ${Math.round(Math.hypot(w1.x - w0.x, w1.y - w0.y))} world px`);
  check(near(c1.k, c0.k, 0.02), 'B6 the node drag leaves the camera where it was', `k ${c0.k.toFixed(3)} → ${c1.k.toFixed(3)}`);

  await page.evaluate(() => window.__earth.ctl.graph.refit(0));
  await advance(page, 1);
  const h3 = await G(page, (g) => g.screenOf('a:hero'));
  await touch('touchStart', [[h3.x, h3.y]]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => location.hash.startsWith('#/graph/a/hero'), null, { timeout: 5000 }).catch(() => undefined);
  const tapped = await snap(page);
  check(tapped.hash.startsWith('#/graph/a/hero'), 'B6 a tap on a node still selects it', tapped.hash);
  await ctx.close();
}

// ── keys, labels and the exits: 0 reframes; the canvas says so; the mode pill and the crumb leave the graph ──
async function keysAndExits(browser) {
  const { ctx, page } = await openGraph(browser);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, -700);
  await page.waitForFunction(() => window.__earth.ctl.graph.autoFit === false, null, { timeout: 5000 });
  const fit = await G(page, (g) => g.fitCamera());
  await page.locator('.gv-canvas').focus();
  await page.keyboard.press('0');
  await advance(page, 1.5);
  const s = await snap(page);
  check(s.auto && near(s.k, fit.k, 0.02), 'key 0 reframes the graph', `k ${s.k.toFixed(3)} vs fit ${fit.k.toFixed(3)}`);
  const ring = await page.evaluate(() => { const c = document.querySelector('.gv-canvas'); const cs = getComputedStyle(c); return { style: cs.outlineStyle, width: cs.outlineWidth }; });
  check(ring.style === 'solid' && ring.width === '1px', 'the keyboard-focused canvas wears a thin ring', JSON.stringify(ring));
  const label = (await page.locator('.gv-canvas').getAttribute('aria-label')) ?? '';
  check(/press 0/i.test(label) && /double-click a node to open it on the Earth/i.test(label), 'the canvas names the reframe key and the double-click', label);
  check((await page.getByRole('button', { name: 'Whole graph' }).count()) === 0 && (await page.getByRole('button', { name: 'On Earth', exact: false }).count()) === 0, 'the redundant Whole graph and On Earth buttons are gone');
  await ctx.close();

  const pill = await openGraph(browser, { hash: '#/graph/f/serpent' });
  await pill.page.locator('.mode-switch').click();
  await pill.page.waitForFunction(() => !document.body.classList.contains('mode-graph'), null, { timeout: 5000 }).catch(() => undefined);
  const e = await pill.page.evaluate(() => location.hash);
  check(e === '#/f/serpent', 'the mode pill takes the focused form to the Earth', e);
  await pill.ctx.close();

  const crumb = await openGraph(browser, { hash: '#/graph/f/serpent' });
  await crumb.page.locator('.fl-up button', { hasText: 'the whole field' }).click();
  await crumb.page.waitForFunction(() => window.__earth.ctl.graph.stats.mode === 'global', null, { timeout: 5000 }).catch(() => undefined);
  const w = await snap(crumb.page);
  check(w.mode === 'global' && w.visible, 'the crumb the whole field returns to the whole graph', `mode ${w.mode}`);
  await crumb.ctx.close();
}

// ── the sheet: Filters, then a collapsed Forces; the default sheet is no taller than before ──
async function sheet(browser) {
  const { ctx, page } = await openGraph(browser, { hash: '#/graph/f/serpent' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const open = await page.locator('.gvt-forces').evaluate((d) => d.open);
  check(open === false, 'the Forces disclosure is collapsed by default');
  const h = await page.locator('#graph-settings').evaluate((p) => Math.round(p.getBoundingClientRect().height));
  check(h < 330, 'the default sheet stays compact', `${h}px tall`);
  check((await page.getByRole('button', { name: 'Read here', exact: true }).count()) === 1, 'the relations keep the Read here label');
  await page.screenshot({ path: `${SHOTS}/settings-sheet-desktop.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__earth.ctl.graph.refit(0); });
  await page.goto(`${URL}#/graph/o/${OCC}`, { waitUntil: 'load' }).catch(() => undefined);
  await page.waitForFunction(() => window.__earth.ctl.graph.isVisible, null, { timeout: 60000 });
  // the card fades in and the settings button eases to its left: wait for both to be at rest, not a fixed time
  await page.waitForFunction(() => { const r = document.querySelector('.reveal'); return !!r && r.classList.contains('on') && getComputedStyle(r).opacity === '1'; }, null, { timeout: 20000 });
  await settled(page, '.gvt-settings');
  await page.evaluate(() => document.activeElement?.blur());
  await advance(page, 2);
  await page.screenshot({ path: `${SHOTS}/manifest-open-desktop.png` });
  await ctx.close();

  const phone = await openGraph(browser, { w: 390, h: 844, mobile: true, hash: '#/graph/f/serpent' });
  await phone.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await advance(phone.page, 0.5);
  await phone.page.screenshot({ path: `${SHOTS}/settings-sheet-phone.png` });
  await phone.ctx.close();
}

// ── item 1 (B7): Centre gathers a local graph too: it had no pull at all with a subject held ──
async function centreLocal(browser) {
  const hash = '#/graph/f/serpent';
  const base = await layoutOf(browser, { hash });
  const centre = await layoutOf(browser, { hash, label: 'Centre', steps: 52 });
  check(centre.alpha.after > centre.alpha.before, 'B7 Centre reheats a local layout', `alpha ${centre.alpha.before.toFixed(3)} → ${centre.alpha.after.toFixed(3)}`);
  check(centre.rms <= base.rms * 0.9, 'B7 Centre 0.8 → 6 lowers a local graph\'s extent by at least 10%', `rms ${base.rms.toFixed(1)} → ${centre.rms.toFixed(1)}`);
}

// ── item 3: the forces, occurrences and relations are remembered here; Reset restores the forces; storage that is bad changes nothing ──
async function resetPersist(browser) {
  const { ctx, page, errors } = await openGraph(browser);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Occurrences', exact: true }).click();
  await page.locator('.gvt-forces > summary').click();
  const repel = page.locator('input[aria-label^="Repel:"]');
  await repel.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); // 0.80 → 1.00
  const set = Math.abs(Number(await repel.inputValue()) - 1) < 1e-6 && (await page.evaluate(() => window.__earth.ctl.graph.stats.occurrences)) === false;
  check(set, 'Occurrences off and Repel 1.00 are set before the reload');
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  const occ = await page.evaluate(() => window.__earth.ctl.graph.stats.occurrences);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.gvt-forces > summary').click();
  const kept = Number(await page.locator('input[aria-label^="Repel:"]').inputValue());
  check(occ === false && Math.abs(kept - 1) < 1e-6, 'reload restores Occurrences off and the Repel force', `occurrences ${occ}, repel ${kept}`);
  const readout = (await page.locator('.gvt-forces .gvt-row').nth(1).locator('.gvt-n').textContent()) ?? '';
  check(readout === '1.25×', 'the readout reads the force as a multiple of the default (1.00 / 0.80)', readout);
  await page.screenshot({ path: `${SHOTS}/settings-forces-reset-desktop.png` });

  await page.locator('.gvt-reset').click();
  const back = Number(await page.locator('input[aria-label^="Repel:"]').inputValue());
  const rest = (await page.locator('.gvt-forces .gvt-row').nth(1).locator('.gvt-n').textContent()) ?? '';
  check(Math.abs(back - 0.8) < 1e-6 && rest === '1.00×', 'Reset restores the arrangement as drawn: Repel 0.80, readout 1.00×', `repel ${back}, readout ${rest}`);
  check((await page.evaluate(() => window.__earth.ctl.graph.stats.occurrences)) === false, 'Reset leaves the occurrences as the person set them');
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.gvt-forces > summary').click();
  const after = Number(await page.locator('input[aria-label^="Repel:"]').inputValue());
  check(Math.abs(after - 0.8) < 1e-6, 'after Reset and a reload the stored force is the default', `repel ${after}`);
  check(errors.length === 0, 'the persistence walk raises no page errors', errors.slice(0, 3).join(' | '));
  await ctx.close();

  // corrupt stored text: the graph opens with its defaults and nothing is broken
  const bad = await openGraph(browser);
  await bad.page.evaluate(() => localStorage.setItem('archetypal-earth.graph', '{"forces": '));
  await bad.page.reload({ waitUntil: 'load' });
  await ready(bad.page);
  const d = await bad.page.evaluate(() => ({ occ: window.__earth.ctl.graph.stats.occurrences, visible: window.__earth.ctl.graph.isVisible }));
  check(d.occ === true && d.visible, 'corrupt stored settings open the graph with its defaults', JSON.stringify(d));
  check(bad.errors.length === 0, 'corrupt stored settings raise no page errors', bad.errors.slice(0, 3).join(' | '));
  await bad.ctx.close();

  // storage that is blocked (a private window): the graph still works, and remembers nothing
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx2.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  const page2 = await ctx2.newPage();
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push(e.message));
  await page2.goto(`${URL}#/graph`, { waitUntil: 'load' });
  await ready(page2);
  await page2.getByRole('button', { name: 'Settings', exact: true }).click();
  await page2.getByRole('button', { name: 'Occurrences', exact: true }).click();
  const off = await page2.evaluate(() => window.__earth.ctl.graph.stats.occurrences);
  check(off === false, 'with storage blocked the graph still takes a setting', `occurrences ${off}`);
  check(!errs2.some((m) => /graph|forces|settings/i.test(m)), 'with storage blocked the graph raises no error of its own', errs2.slice(0, 3).join(' | '));
  await ctx2.close();
}

// ── item 4: a graph hidden mid-touch forgets the touch, so the next single touch is not a pinch ──
async function staleTouch(browser) {
  const { ctx, page } = await openGraph(browser, { w: 390, h: 844, mobile: true });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const empty = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    for (const [x, y] of [[30, 140], [360, 140], [30, 700], [360, 700], [195, 120]]) if (!g.pick(x, y)) return [x, y];
    return [30, 140];
  });
  await touch('touchStart', [empty]);
  await page.evaluate(() => { const g = window.__earth.ctl.graph; g.hide(); g.show(); });
  const held = await page.evaluate(() => window.__earth.ctl.graph.stats.touching);
  check(held === 0, 'a graph hidden and shown mid-touch forgets that touch', `touching ${held}`);
  await touch('touchEnd');
  const hero = await G(page, (g) => g.screenOf('a:hero'));
  await touch('touchStart', [[hero.x, hero.y]]);
  await touch('touchEnd');
  await page.waitForFunction(() => location.hash.startsWith('#/graph/a/hero'), null, { timeout: 5000 }).catch(() => undefined);
  const tapped = await snap(page);
  check(tapped.hash.startsWith('#/graph/a/hero'), 'the next single touch on a node selects it, not a pinch', tapped.hash);
  await ctx.close();
}

// ── item 5: a fast pan coasts on after release, decaying; reduced motion never coasts ──
const FLICK_START = async (page) => page.evaluate(() => {
  const g = window.__earth.ctl.graph;
  for (const [x, y] of [[420, 300], [1000, 650], [300, 650], [1100, 250], [700, 160]]) if (!g.pick(x, y)) return [x, y];
  return [420, 300];
});
/**
 * A fast pan, through the graph's own mouse handlers: a press, eight moves, a release. The sandbox delivers real pointer
 * events about a second and a half apart (a flick at ~30 px/s), so the drag is dispatched as one short burst in the page,
 * 2 ms between moves, and the release follows the last move at once. The same d3 handlers see it as a fast pan.
 */
async function flickPan(page, [x0, y0]) {
  await page.evaluate(([x0, y0]) => {
    const c = window.__earth.ctl.graph.canvas;
    const at = (type, x, y) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, view: window });
    const wait = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* a 2 ms gap, so the samples carry time */ } };
    c.dispatchEvent(at('mousedown', x0, y0));
    for (let i = 1; i <= 8; i++) {
      wait(2);
      window.dispatchEvent(at('mousemove', x0 + i * 40, y0 + i * 6));
    }
    window.dispatchEvent(at('mouseup', x0 + 320, y0 + 48));
  }, [x0, y0]);
}
async function flick(browser) {
  const { ctx, page, errors } = await openGraph(browser);
  const start = await FLICK_START(page);
  await flickPan(page, start);
  const rel = await page.evaluate(() => ({ x: window.__earth.ctl.graph.t.x, y: window.__earth.ctl.graph.t.y, coasting: window.__earth.ctl.graph.stats.coasting, auto: window.__earth.ctl.graph.autoFit }));
  check(rel.coasting === true && rel.auto === false, 'a fast pan that lets go coasts on, and the camera is no longer auto-framed', JSON.stringify(rel));
  // stepped at 60 fps, as the rest of this file does, so the same run gives the same numbers: one second of coast
  const trace = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    const per = [];
    let px = g.t.x;
    let py = g.t.y;
    for (let i = 0; i < 60; i++) {
      g.step(1 / 60);
      per.push(Math.hypot(g.t.x - px, g.t.y - py));
      px = g.t.x;
      py = g.t.y;
    }
    g.draw();
    g.dirty = false;
    return { perLast: per[per.length - 1], k: g.t.k, finite: [g.t.x, g.t.y, g.t.k].every(Number.isFinite) };
  });
  // the travel from the release point to one second on
  const moved = await page.evaluate(([x, y]) => Math.hypot(window.__earth.ctl.graph.t.x - x, window.__earth.ctl.graph.t.y - y), [rel.x, rel.y]);
  check(moved > 30, 'the flick carries the camera more than 30 px past the release', `moved ${moved.toFixed(0)} px`);
  check(trace.perLast < 1, 'the coast settles: under 1 px a frame one second after release', `${trace.perLast.toFixed(3)} px/frame`);
  check(trace.finite && trace.k >= 0.1 && trace.k <= 9, 'the coast keeps the camera finite and inside the zoom extent', `k ${trace.k.toFixed(3)}`);
  check(errors.length === 0, 'the flick raises no page errors', errors.slice(0, 3).join(' | '));
  await ctx.close();
}
async function reducedFlick(browser) {
  const { ctx, page } = await openGraph(browser, { reduced: true });
  const start = await FLICK_START(page);
  await flickPan(page, start);
  const rel = await page.evaluate(() => ({ x: window.__earth.ctl.graph.t.x, y: window.__earth.ctl.graph.t.y, coasting: window.__earth.ctl.graph.stats.coasting }));
  check(rel.coasting === false, 'reduced motion: a fast pan does not coast', JSON.stringify(rel));
  await advance(page, 1);
  const after = await snap(page);
  check(Number.isFinite(after.x) && Number.isFinite(after.y) && Number.isFinite(after.k) && Math.hypot(after.x - rel.x, after.y - rel.y) < 0.5, 'reduced motion: the camera stays where the pan left it, finite', `moved ${Math.hypot(after.x - rel.x, after.y - rel.y).toFixed(2)} px`);
  await ctx.close();
}

// ── item 6: the layout is time-aware: under the cursor the live hold their links and the ghosts drift; 'all time' is exactly as drawn ──
async function timeLayout(browser) {
  const { ctx, page, errors } = await openGraph(browser);
  const parity = () => page.evaluate(async () => {
    const F = await import('/src/graph/forces.ts');
    const g = window.__earth.ctl.graph;
    const L = g.sim.force('link');
    const s = L.strength();
    let worst = 0;
    const links = L.links();
    for (const l of links) worst = Math.max(worst, Math.abs(s(l) - F.linkStrength(l.e, g.nodes[l.e.t].g.prime, g.forces)));
    return { liveOn: g.stats.liveOn, worst, n: links.length };
  });
  const allTime = await parity();
  check(allTime.liveOn === 0 && allTime.worst === 0 && allTime.n > 100, 'in all time every link is exactly the force it always was', JSON.stringify(allTime));

  // the cursor early: it settles in under 3 s of frames, with no NaN
  // the clock eases its own window (about 1.8 s); the layout re-reads who is live once that is still, then re-settles.
  // The layout's own time is counted from its last re-read to its rest; the clock's ease is not the layout's.
  const settleFrames = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    const t = window.__earth.time;
    t.scrub(0.2);
    const clockRest = () => Math.abs(t.on - 1) < 1e-3 && Math.abs(t.trail - t.trailTarget) < 1e-3;
    const done = () => clockRest() && g.liveWait < 0 && g.sim.alpha() <= g.sim.alphaMin();
    let n = 0;
    let reheatAt = -1;
    let restAt = -1;
    let prevWait = g.liveWait;
    while (n < 300 && !done()) {
      t.update(1 / 60);
      g.step(1 / 60);
      n++;
      if (prevWait >= 0 && g.liveWait < 0) { reheatAt = n; restAt = -1; }
      if (reheatAt >= 0 && restAt < 0 && g.sim.alpha() <= g.sim.alphaMin()) restAt = n;
      prevWait = g.liveWait;
    }
    return { n, reheatAt, layout: reheatAt >= 0 && restAt >= 0 ? restAt - reheatAt : -1, done: done(), finite: g.nodes.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)), liveOn: g.stats.liveOn };
  });
  check(settleFrames.liveOn === 1 && settleFrames.done && settleFrames.finite, 'under the cursor the window eases to rest, with no NaN', `${settleFrames.n} frames (${(settleFrames.n / 60).toFixed(1)} s)`);
  check(settleFrames.layout > 0 && settleFrames.layout < 180, 'the layout re-reads who is live and settles in under 3 s of its own', `re-read at frame ${settleFrames.reheatAt}, at rest ${settleFrames.layout} frames (${(settleFrames.layout / 60).toFixed(2)} s) later`);
  await restCursor(page);
  await settle(page);
  await advance(page, 0.5);
  await page.screenshot({ path: `${SHOTS}/layout-cursor-early.png` });
  // the same measure: instances of a live occurrence against instances of a ghost, and the ghosts' own links
  const measure = () => page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    const live = [];
    const ghost = [];
    const ghostKs = [];
    g.activeEdges.forEach((k) => {
      const e = g.g.edges[k];
      if (e.kind !== 'instance') return;
      const o = g.nodes[e.s];
      const f = g.nodes[e.t];
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (o.live >= 0.9) live.push(d);
      else if (o.live <= 0.3) { ghost.push(d); ghostKs.push(k); }
    });
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    window.__ghostKs = ghostKs;
    const ghostNow = ghostKs.map((k) => { const e = g.g.edges[k]; return Math.hypot(g.nodes[e.s].x - g.nodes[e.t].x, g.nodes[e.s].y - g.nodes[e.t].y); });
    return { nLive: live.length, nGhost: ghost.length, live: mean(live), ghost: mean(ghost), ghostNow: mean(ghostNow), finite: g.nodes.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)) };
  });
  const early = await measure();
  check(early.nLive > 5 && early.nGhost > 5 && early.live < early.ghost, 'under the cursor the live forms sit tighter to their families than the ghosts', `live ${early.live.toFixed(1)} vs ghost ${early.ghost.toFixed(1)} (${early.nLive}/${early.nGhost})`);

  // the same ghost links, drawn in all time (no factor): they are shorter than under the cursor
  await page.evaluate(() => window.__earth.time.setAll());
  await advance(page, 1.5);
  await settle(page);
  await advance(page, 0.5);
  const back = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    const ks = window.__ghostKs;
    const ds = ks.map((k) => { const e = g.g.edges[k]; return Math.hypot(g.nodes[e.s].x - g.nodes[e.t].x, g.nodes[e.s].y - g.nodes[e.t].y); });
    return { liveOn: g.stats.liveOn, ghostAllTime: ds.reduce((x, y) => x + y, 0) / ds.length };
  });
  check(back.liveOn === 0 && early.ghostNow > back.ghostAllTime * 1.02, 'the cross-era links stretch under the cursor, and return to their length in all time', `ghost ${early.ghostNow.toFixed(1)} under the cursor vs ${back.ghostAllTime.toFixed(1)} in all time`);
  const after = await parity();
  check(after.liveOn === 0 && after.worst === 0, 'back in all time the forces are exactly the force they always were', JSON.stringify(after));

  // the cursor late: the same layout re-reads who is live
  await page.evaluate(() => window.__earth.time.scrub(0.8));
  await restCursor(page);
  await settle(page);
  await advance(page, 0.5);
  await page.screenshot({ path: `${SHOTS}/layout-cursor-late.png` });
  const late = await measure();
  check(late.finite && late.nLive > 0, 'the late cursor layout has no NaN, and live forms', `${late.nLive} live`);

  // B4 across the clock: a camera the person moved is not reframed by the cursor
  await page.evaluate(() => window.__earth.time.setAll());
  await advance(page, 1);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, -700);
  await page.waitForFunction(() => window.__earth.ctl.graph.autoFit === false, null, { timeout: 5000 });
  await advance(page, 0.5);
  const before = await snap(page);
  await page.evaluate(() => window.__earth.time.scrub(0.4));
  await advance(page, 1.5);
  const moved = await snap(page);
  check(!moved.auto && near(moved.k, before.k) && near(moved.x, before.x) && near(moved.y, before.y), 'B4 scrubbing the clock keeps the user camera', `k ${before.k.toFixed(3)} → ${moved.k.toFixed(3)}`);
  check(errors.length === 0, 'the time-aware layout raises no page errors', errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await launch('chromium', { headed: false });
  try {
    const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
    for (const run of [b1, b2, b3, b4, b5, b6, keysAndExits, sheet, centreLocal, resetPersist, staleTouch, flick, reducedFlick, timeLayout].filter((r) => !only || only.includes(r.name))) {
      try {
        await run(browser);
      } catch (e) {
        check(false, `${run.name} ran to the end`, String(e).split('\n')[0]);
      }
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
}

await main();
