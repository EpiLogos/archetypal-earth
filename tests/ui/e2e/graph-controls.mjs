// Graph controls, end to end: the camera's clock, the Settings sheet, the double-click, the forces, the keys and
// the touch gestures. Driven with real mouse, keyboard and touch events. Where the sandbox's frame rate would decide
// the outcome, the graph's own clock is stepped at 60 fps (advance) so a run is the same every time.
// Run against the live dev server:  EARTH_HEADLESS=1 node tests/ui/e2e/graph-controls.mjs
import { mkdir } from 'node:fs/promises';
import { launch, URL } from './lib.mjs';

const SHOTS = '.cache/screens/remediation-2026-10-09/graph/after';
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

async function openGraph(browser, { w = 1440, h = 900, mobile = false, hash = '#/graph' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__earth?.ctl?.graph, null, { timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 60000 });
  const intro = page.locator('#intro:not(.dismissed)');
  if (await intro.count()) await page.getByRole('button', { name: 'Enter the globe' }).click();
  await page.waitForFunction(() => window.__earth.ctl.graph.isVisible, null, { timeout: 60000 });
  await settle(page);
  await advance(page, 1);
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

// ── B5: the four forces move the layout, in the direction their names and tooltips say ──
// Each layout is a fresh load (the same seeded arrangement), with one force moved by keyboard on its slider, so the
// comparison is the force and nothing else: the layout depends on its history, a settled one does not forget it.
async function b5(browser) {
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
  const layout = async (label = null, steps = 0, shot = null) => {
    const { ctx, page } = await openGraph(browser);
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
  };
  const base = await layout();
  const reheat = (label, a) => check(a.after > a.before && a.after > 0.2, `B5 ${label} reheats the layout`, `alpha ${a.before.toFixed(3)} → ${a.after.toFixed(3)}`);
  const centre = await layout('Centre', 42);
  reheat('Centre', centre.alpha);
  check(centre.rms <= base.rms * 0.9, 'B5 Centre up lowers the extent by at least 10%', `rms ${base.rms.toFixed(1)} → ${centre.rms.toFixed(1)}`);
  const repel = await layout('Repel', 16);
  reheat('Repel', repel.alpha);
  check(repel.rms > base.rms, 'B5 Repel up raises the extent', `rms ${base.rms.toFixed(1)} → ${repel.rms.toFixed(1)}`);
  const link = await layout('Link force', 16);
  reheat('Link force', link.alpha);
  check(link.link < base.link, 'B5 Link force up shortens the mean link', `link ${base.link.toFixed(1)} → ${link.link.toFixed(1)}`);
  const dist = await layout('Link distance', 7, 'settings-forces-desktop.png');
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

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await launch('chromium', { headed: false });
  try {
    const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
    for (const run of [b1, b2, b3, b4, b5, b6, keysAndExits, sheet].filter((r) => !only || only.includes(r.name))) {
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
