// Gate: the dynamical lens is a mode like Aion and the Red Book. It opens from the plain world (switch, D), holds its
// subject (#/dynamics/f/serpent), leaves nothing behind when handed to Aion, the Red Book or the sky, scopes the clock to
// its subject and gives it back exactly, and leaves the plain Earth pixel-identical while it is down.
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/dynamics-mode.mjs [chromium|webkit]
import fs from 'node:fs';
import crypto from 'node:crypto';
import { launch, look, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const SHOTS = '/home/user/archetypal-earth/.cache/screens/remediation-2026-10-09/dynamics/wired';
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const errors = [];
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** One reading of everything the mode can leave behind: the body classes, the panels, the clock, the rig, the globe. */
const snap = (page) => page.evaluate(() => {
  const { engine, ctl, time } = window.__earth;
  const vis = (sel) => { const el = document.querySelector(sel); return !!el && !el.hidden && el.getBoundingClientRect().height > 0; };
  const lensEl = document.querySelector('.dynamics');
  const rel = engine.presences.relTarget;
  let lit = 0;
  for (let i = 0; i < rel.length; i++) if (rel[i] > 1.2) lit++;
  return {
    hash: location.hash,
    lens: vis('.dynamics'),
    lensMode: document.body.classList.contains('dynamics-mode'),
    lensPressed: document.querySelector('.dy-switch')?.getAttribute('aria-pressed') ?? null,
    lensInert: !!lensEl?.inert,
    lensAriaHidden: lensEl?.getAttribute('aria-hidden') ?? null,
    lensHeading: document.querySelector('.dynamics .dy-heading h1')?.textContent ?? null,
    lensState: ctl.state.dynamics ?? null,
    aion: vis('.aion'),
    aionMode: document.body.classList.contains('aion-mode'),
    redbook: vis('.redbook'),
    redbookMode: document.body.classList.contains('redbook-mode'),
    sky: !!ctl.state.sky,
    skyOn: document.body.classList.contains('sky-on'),
    skyCard: !!document.querySelector('.sky-card') && document.querySelector('.sky-card').getAttribute('aria-hidden') === 'false',
    graph: !!ctl.state.graph,
    dist: engine.rig.dist,
    flying: engine.rig.flying,
    shiftX: engine.rig.tShiftX ?? 0,
    shiftY: engine.rig.tShiftY ?? 0,
    range: [time.fromU, time.toU],
    clock: { mode: time.mode, cursorU: time.cursorU, cumulative: time.cumulative },
    chrono: engine.arcs.chronoState(),
    lit,
    title: document.title,
  };
});

const settleRig = async (page) => {
  let prev = null;
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => { const g = window.__earth.engine.rig; return { lat: g.lat, lon: g.lon, dist: g.dist, flying: g.flying }; });
    if (!r.flying && prev && Math.abs(r.lat - prev.lat) < 1e-3 && Math.abs(r.lon - prev.lon) < 1e-3 && Math.abs(r.dist - prev.dist) < 1e-3) return;
    prev = r;
  }
};

const wait = (page, pred) => page.waitForFunction(pred, null, { timeout: 20000 }).catch(() => {});
const sameRange = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const isWorldHash = (h) => ['', '#', '#/'].includes(h);

const browser = await launch(kind, { headed: false });
const track = (logs) => { for (const l of logs) if (/pageerror/i.test(l)) errors.push(l); };

try {
  // ── (i) the plain world → the lens: the switch, D, Escape; never a trap in the null state ─────────
  {
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 800 });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await settleRig(page);
    const w0 = await snap(page);
    await page.click('.dy-switch');
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(1500);
    let s = await snap(page);
    check(s.hash === '#/dynamics' && s.lensState && !s.lensState.subject, 'the Dynamics switch opens the lens from the plain world', `hash "${s.hash}"`);
    check(s.lens && s.lensMode && s.lensPressed === 'true', 'the lens is visible, its body mode is on, and the switch reads pressed');
    check(s.lensHeading === 'The Self', 'the bare lens holds The Self', `heading "${s.lensHeading}"`);
    check(s.lit > 0 && s.chrono.segments > 0, 'the Self\'s occurrences are lit on the globe, with a chronology to travel', `lit ${s.lit}, arcs ${s.chrono.segments}`);
    const stripInk = await page.evaluate(() => {
      const c = document.querySelector('.dy-canvas');
      if (!c || !c.width) return 0;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 0) n++;
      return n;
    });
    check(stripInk > 50, 'the phase strip is drawn (not blank)', `${stripInk} inked samples`);
    check(s.lensInert === false && s.lensAriaHidden === null, 'the open lens is in the keyboard path and the accessibility tree');
    check(Math.abs(s.dist - w0.dist) < 1e-3 && s.lensState && !s.flying, 'the lens does not move the camera on entry (the globe stays the centre)', `dist ${w0.dist.toFixed(4)} → ${s.dist.toFixed(4)}`);
    await page.keyboard.press('Escape');
    await wait(page, () => ['', '#', '#/'].includes(location.hash));
    await page.waitForTimeout(1200);
    s = await snap(page);
    check(isWorldHash(s.hash) && !s.lens && !s.lensMode, 'Escape from the bare lens returns to the plain world', `hash "${s.hash}"`);
    check(s.lensInert && s.lensAriaHidden === 'true', 'the closed lens is inert and hidden from the accessibility tree');
    check(s.lit === 0 && s.chrono.segments === 0, 'and nothing of the lens stays on the globe', `lit ${s.lit}, arcs ${s.chrono.segments}`);
    await page.keyboard.press('d');
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(800);
    s = await snap(page);
    check(s.lens && s.lensMode, 'key D opens the lens');
    await page.keyboard.press('d');
    await wait(page, () => ['', '#', '#/'].includes(location.hash));
    await page.waitForTimeout(800);
    s = await snap(page);
    check(!s.lens && !s.lensMode, 'key D closes it again', `hash "${s.hash}"`);
    // the bare lens from its link: Escape must climb out, not sit in a dead state
    await page.evaluate(() => { location.hash = '#/dynamics'; });
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await wait(page, () => ['', '#', '#/'].includes(location.hash));
    await page.waitForTimeout(800);
    s = await snap(page);
    check(!s.lens && isWorldHash(s.hash), 'a deep link to the bare lens is not a trap: Escape leaves it');
    check(!/dynamical lens/.test(await page.title()), 'leaving the lens gives the title back to the world', JSON.stringify(await page.title()));
    track(logs);
    await ctx.close();
  }

  // ── (ii) a subject: #/dynamics/f/serpent — the heading, the strip, the arcs and the cursor ───────────────────
  {
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash: '#/dynamics/f/serpent' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.waitForTimeout(1500);
    let s = await snap(page);
    check(s.lensHeading === 'Serpent', 'the deep link #/dynamics/f/serpent names the subject', `heading "${s.lensHeading}"`);
    check(s.lensState?.subject?.id === 'serpent' && s.lensState.subject.type === 'family', 'and holds it in the state');
    check(s.title.includes('Serpent'), 'the document title carries the subject', `"${s.title}"`);
    check(s.chrono.segments > 0, 'its chronology arcs stand on the globe', `${s.chrono.segments} segments`);
    // the clock is scoped to the subject: its occurrences inside the range, the range narrower than the whole scale
    const scope = await page.evaluate(() => {
      const { model, time } = window.__earth;
      const us = (model.famOcc.get('serpent') ?? []).map((i) => model.u[i]);
      return { lo: Math.min(...us), hi: Math.max(...us), from: time.fromU, to: time.toU };
    });
    check(scope.lo >= scope.from - 1e-9 && scope.hi <= scope.to + 1e-9 && scope.to - scope.from < 0.99, 'the clock is scoped to the subject\'s span', `range ${scope.from.toFixed(3)}–${scope.to.toFixed(3)}, occurrences ${scope.lo.toFixed(3)}–${scope.hi.toFixed(3)}`);
    // the cursor: the strip's point and the arcs both move with the clock
    await page.evaluate(() => { const { time } = window.__earth; time.scrub(time.fromU + (time.toU - time.fromU) * 0.2); });
    await page.waitForTimeout(2000);
    const c1 = await page.evaluate(() => ({ x: window.__earth.ctl.lens.strip.inspect().cursor?.x ?? null, begun: window.__earth.engine.arcs.chronoState().begun }));
    await page.evaluate(() => { const { time } = window.__earth; time.scrub(time.toU); });
    await page.waitForTimeout(2500);
    const c2 = await page.evaluate(() => ({ x: window.__earth.ctl.lens.strip.inspect().cursor?.x ?? null, begun: window.__earth.engine.arcs.chronoState().begun }));
    check(c1.x !== null && c2.x !== null && c2.x > c1.x, 'the strip\'s cursor rides the trajectory as the clock moves', `x ${c1.x?.toFixed(1)} → ${c2.x?.toFixed(1)}`);
    check(c2.begun >= c1.begun && c2.begun > 0, 'the chronology arcs travel along the cursor', `begun ${c1.begun} → ${c2.begun}`);
    await page.screenshot({ path: `${SHOTS}/serpent-desktop.png` });
    // a basin link inside the lens stays in the lens: the bare lens (The Self) offers the families it visits
    await page.evaluate(() => { location.hash = '#/dynamics'; });
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(1200);
    const basin = await page.evaluate(() => {
      const b = document.querySelector('.dy-basins button');
      return b ? b.textContent : null;
    });
    if (basin) {
      await page.click(`.dy-basins button:has-text("${basin.replace(/"/g, '')}")`);
      await page.waitForTimeout(1500);
      s = await snap(page);
      check(s.lens && s.lensState?.subject?.type === 'family' && s.hash.startsWith('#/dynamics/f/'), 'a basin picked in the lens stays in the lens', `hash "${s.hash}"`);
      check(s.lensHeading === basin, 'and the lens now holds that basin', `heading "${s.lensHeading}", expected "${basin}"`);
    } else check(false, 'the heading offers its basins as links');
    // Escape climbs the ladder: a subject → the bare lens (The Self), as a basin's own state would
    await page.keyboard.press('Escape');
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(1200);
    s = await snap(page);
    check(s.lens && s.lensHeading === 'The Self', 'Escape from a subject climbs to the bare lens (The Self)', `hash "${s.hash}"`);
    await page.evaluate(() => { location.hash = '#/dynamics/f/serpent'; });
    await wait(page, () => location.hash === '#/dynamics/f/serpent');
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(1000);
    s = await snap(page);
    check(s.lens && s.lensHeading === 'The Self', 'and a serpent deep link climbs the same way', `hash "${s.hash}"`);
    track(logs);
    await ctx.close();
  }

  // ── (ii-b) a subject picked inside the lens glides the clock to its span (SPEC §9): the cursor never snaps ─────────
  {
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash: '#/dynamics' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.waitForTimeout(1500);
    // the clock held in cursor mode at the Self's first occurrence; the serpent's clock span begins later, so the cursor is outside it
    const start = await page.evaluate(() => {
      const { time } = window.__earth;
      time.scrub(time.fromU);
      return { u0: time.cursorU, mode: time.mode };
    });
    check(start.mode === 'cursor', 'the clock is in cursor mode inside the Self\'s span', `cursor ${start.u0.toFixed(4)}`);
    await page.evaluate(() => {
      window.__glide = [];
      const frame = () => { window.__glide.push(window.__earth.time.cursorU); if (window.__glide.length < 4000) requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    });
    await page.evaluate(() => { location.hash = '#/dynamics/f/serpent'; });
    await wait(page, () => location.hash === '#/dynamics/f/serpent');
    // the glide lands on the nearest edge of the serpent's clock span (the span is padded, so that edge is its start)
    const edge = await page.evaluate(() => window.__earth.time.fromU);
    check(start.u0 < edge - 1e-3, 'the cursor starts before the serpent\'s clock span (the glide has somewhere to go)', `cursor ${start.u0.toFixed(4)}, span starts ${edge.toFixed(4)}`);
    await page.waitForFunction(() => { const t = window.__earth.time; return t.mode === 'cursor' && t.cursorU === t.targetU; }, null, { timeout: 150000 }).catch(() => {});
    const seq = await page.evaluate(() => window.__glide.slice());
    const moved = seq.map((v, i) => (i ? v - seq[i - 1] : 0));
    const total = edge - start.u0;
    const sign = Math.sign(total);
    const monotone = moved.every((d) => sign * d >= -1e-9);
    const biggest = Math.max(0, ...moved.map((d) => Math.abs(d)));
    const final = seq[seq.length - 1];
    check(seq.length > 2 && moved.some((d) => Math.abs(d) > 1e-9), 'the cursor moves while the clock glides', `${seq.length} frames`);
    check(monotone, 'the cursor glides monotonically toward the serpent\'s span', `${moved.filter((d) => Math.abs(d) > 1e-9).length} steps`);
    check(biggest < 0.6 * Math.abs(total), 'no single frame jumps the cursor across the span', `largest step ${(biggest / Math.abs(total) * 100).toFixed(0)}% of the distance`);
    check(Math.abs(final - edge) < 1e-3, 'and it lands on the nearest edge of the span', `final ${final.toFixed(4)}, edge ${edge.toFixed(4)}`);
    track(logs);
    await ctx.close();
  }

  // ── (iii) the handovers: Aion, the Red Book, the sky, and back — each leaves nothing behind ───────────────
  {
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 800 });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.waitForTimeout(800);
    const w0 = await snap(page);
    await page.click('.aion-switch');
    await wait(page, () => location.hash.startsWith('#/aion'));
    await page.waitForTimeout(1500);
    const a0 = await snap(page);
    check(a0.aion && a0.aionMode, 'Aion opens for the handover test', `hash "${a0.hash}"`);

    await page.click('.dy-switch');
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(1500);
    let s = await snap(page);
    check(!s.aion && !s.aionMode && s.lens && s.lensMode, 'Aion → the lens: Aion is fully hidden and the lens stands', `aion ${s.aion}, aion-mode ${s.aionMode}`);
    check(Math.abs(s.shiftX) < 1e-6, 'the lens holds no card shift from Aion', `shiftX ${s.shiftX}`);
    check(!sameRange(s.range, a0.range), 'the clock is the lens\'s own span, not Aion\'s reading', `lens ${s.range.map((v) => v.toFixed(3))}, Aion ${a0.range.map((v) => v.toFixed(3))}`);

    await page.click('.rb-switch');
    await wait(page, () => location.hash === '#/redbook');
    await page.waitForTimeout(1500);
    s = await snap(page);
    check(s.redbook && s.redbookMode && !s.lens && !s.lensMode, 'the lens → the Red Book: the lens goes, the Book stands alone', `redbook ${s.redbook}, lens ${s.lens}`);
    check(!/dynamical lens/.test(await page.title()), 'and the lens title does not survive into the Red Book', JSON.stringify(await page.title()));
    check(s.chrono.segments === 0, 'and the globe carries none of the lens\'s chronology arcs (the Book lights its own folio)', `arcs ${s.chrono.segments}`);

    await page.click('.dy-switch');
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(1500);
    s = await snap(page);
    check(s.lens && s.lensMode && !s.redbook && !s.redbookMode, 'the Red Book → the lens: the Book goes, the lens stands');
    const lensAgain = s.range;

    await page.click('.aion-switch');
    await wait(page, () => location.hash.startsWith('#/aion'));
    await page.waitForTimeout(1500);
    s = await snap(page);
    check(s.aion && s.aionMode && !s.lens && !s.lensMode, 'the lens → Aion: the lens goes, Aion stands alone', `aion ${s.aion}, lens ${s.lens}`);
    check(sameRange(s.range, a0.range), 'and Aion\'s reading span is restored exactly', `range ${s.range.map((v) => v.toFixed(6))} vs ${a0.range.map((v) => v.toFixed(6))}`);
    check(!sameRange(s.range, lensAgain), 'the lens\'s span is not carried into Aion');

    // the lens → Escape: Aion's own clock was held when the lens was entered; the world's clock comes back through it
    await page.click('.aion-switch');
    await wait(page, () => ['', '#', '#/'].includes(location.hash));
    await page.waitForTimeout(1500);
    await page.click('.dy-switch');
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    await wait(page, () => ['', '#', '#/'].includes(location.hash));
    await page.waitForTimeout(2000);
    const w1 = await snap(page);
    check(isWorldHash(w1.hash) && !w1.lens && !w1.lensMode && !w1.aion && !w1.redbook, 'the lens → the world leaves no mode behind', `hash "${w1.hash}"`);
    check(sameRange(w1.range, w0.range), 'the world\'s clock range is restored exactly', `range ${w1.range.map((v) => v.toFixed(6))} vs ${w0.range.map((v) => v.toFixed(6))}`);
    check(w1.clock.mode === w0.clock.mode && Math.abs(w1.clock.cursorU - w0.clock.cursorU) < 1e-3, 'and the world\'s clock position too', `${w1.clock.mode} ${w1.clock.cursorU.toFixed(4)} vs ${w0.clock.mode} ${w0.clock.cursorU.toFixed(4)}`);
    track(logs);
    await ctx.close();
  }

  // ── (iii-a) the graph: G and the lens are two views of the field, and each takes the other's place ─────────
  {
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash: '#/dynamics/f/serpent' });
    await page.waitForTimeout(1200);
    await page.keyboard.press('g');
    await wait(page, () => window.__earth.ctl.state.graph === true);
    await page.waitForTimeout(1200);
    let s = await snap(page);
    check(s.graph && !s.lens && !s.lensMode, 'G from the lens takes the graph, and the lens goes', `graph ${s.graph}, lens ${s.lens}`);
    await page.keyboard.press('d');
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(1200);
    s = await snap(page);
    check(s.lens && s.lensMode && !s.graph, 'D from the graph opens the lens and leaves the graph');
    await page.keyboard.press('g');
    await wait(page, () => window.__earth.ctl.state.graph === true);
    await page.waitForTimeout(1200);
    s = await snap(page);
    check(s.graph && !s.lens, 'and G again takes the graph back from the lens');
    track(logs);
    await ctx.close();
  }

  // ── (iii-b) the sky: the lens takes the sky with it, the camera comes down, and S cannot open the sky under it ─
  {
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 800 });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.keyboard.press('s');
    await wait(page, () => !!window.__earth.ctl.state.sky);
    await page.waitForTimeout(2500);
    await settleRig(page);
    const k0 = await snap(page);
    check(k0.sky && k0.skyOn, 'the sky opens for the handover test', `hash "${k0.hash}", dist ${k0.dist.toFixed(2)}`);
    await page.click('.dy-switch');
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(800);
    await settleRig(page);
    const k1 = await snap(page);
    check(!k1.sky && !k1.skyOn && !k1.skyCard, 'the sky → the lens: the sky, its card and its body class go', `sky ${k1.sky}, sky-on ${k1.skyOn}, card ${k1.skyCard}`);
    check(k1.lens && k1.lensMode && k1.lensPressed === 'true', 'and the lens stands');
    check(k1.dist < k0.dist - 0.5, 'the camera comes down out of the sky', `dist ${k0.dist.toFixed(2)} → ${k1.dist.toFixed(2)}`);
    check(k1.lit > 0, 'the Self is lit on the Earth the camera came down to');
    await page.keyboard.press('s');
    await page.waitForTimeout(800);
    const k2 = await snap(page);
    check(!k2.sky && k2.lens, 'S inside the lens does not open the sky under it', `hash "${k2.hash}"`);
    await page.keyboard.press('Escape');
    await wait(page, () => ['', '#', '#/'].includes(location.hash));
    await page.waitForTimeout(1000);
    const k3 = await snap(page);
    check(isWorldHash(k3.hash) && !k3.lens && !k3.lensMode, 'Escape closes the lens back onto the plain Earth');
    track(logs);
    await ctx.close();
  }

  // ── (iv) the screens: the plain world, the bare lens and a subject, at desktop and phone width ──────────────
  for (const [name, opts] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844, mobile: true }]]) {
    const { ctx, page, logs } = await open(browser, { ...opts, hash: '#/dynamics' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOTS}/null-${name}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `${name}: no horizontal page scroll with the lens up`, `overflow ${overflow}px`);
    await page.evaluate(() => { location.hash = '#/dynamics/f/serpent'; });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${SHOTS}/serpent-${name}.png` });
    track(logs);
    await ctx.close();
  }

  // ── (v) the plain Earth with the lens down is pixel-identical to the same pose never opened ───────────────
  // The clock is paused and the animation clock pinned for one drawn frame, so the same pose draws the same pixels.
  // A: never opened. B: opened, then closed with Escape. Both are settled before the frame is drawn.
  const shot = async (page) => crypto.createHash('sha256').update(await page.screenshot()).digest('hex');
  // The headless renderer is slow and every ease advances on a capped frame delta, so the eases (palette, presences,
  // focus) are driven to their ends explicitly before the one frame that is drawn, with the animation clock pinned.
  const freeze = (page) => page.evaluate(() => {
    const e = window.__earth.engine;
    window.__earth.time.pause();
    e.setPaused(false);
    for (let i = 0; i < 240; i++) e.frame(0.05, false);
    e.elapsed = 100; // the shared animation clock (a private field), pinned for one deterministic frame
    e.frame(0, true);
    e.setPaused(true);
  });
  // the pointer rests in a corner and keyboard focus leaves the switch in both captures: a hover or a focus ring
  // left on the switch is the pointer's or the keyboard's, not the lens's
  const rest = async (page) => {
    await page.mouse.move(2, 2);
    await page.evaluate(() => document.activeElement?.blur());
  };
  const pose = [20, 10, 3.2];
  let hashA;
  let hashA2;
  {
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 800 });
    await page.evaluate(() => window.__earth.time.pause());
    await look(page, ...pose, 4000);
    await rest(page);
    await freeze(page);
    await page.waitForTimeout(300);
    hashA = await shot(page);
    await page.waitForTimeout(400);
    hashA2 = await shot(page);
    track(logs);
    await ctx.close();
  }
  {
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 800 });
    await page.evaluate(() => window.__earth.time.pause());
    await page.click('.dy-switch');
    await wait(page, () => location.hash === '#/dynamics');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    await wait(page, () => ['', '#', '#/'].includes(location.hash));
    await page.waitForTimeout(3000);
    await look(page, ...pose, 4000);
    await rest(page);
    await freeze(page);
    await page.waitForTimeout(300);
    const hashB = await shot(page);
    check(hashA2 === hashA, 'the frozen plain Earth is stable between two captures (the baseline)', hashA === hashA2 ? '' : 'a comparison is not meaningful');
    check(hashA === hashB, 'the plain Earth with the lens opened and closed is pixel-identical to the same pose never opened', `${hashA.slice(0, 12)} vs ${hashB.slice(0, 12)}`);
    track(logs);
    await ctx.close();
  }
} finally {
  await browser.close();
}
check(errors.length === 0, 'no page errors', errors.join(' | ').slice(0, 400));
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
