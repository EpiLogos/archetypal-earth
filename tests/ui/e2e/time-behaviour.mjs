// Gate (time pass, behaviour): the chronology along the cursor (T1), focus scoping the time control (T3),
// and the Red Book's temporal conditioning (T4). Every check reads the live page; the cursor is moved through the
// time control's own keys, not through the model.
//   npx vite --port 5183 --strictPort &      EARTH_HEADLESS=1 node tests/ui/e2e/time-behaviour.mjs
// (i)   #/f/serpent: the time track scrubs; the chronology's drawn arcs grow with the cursor forward, shrink back;
//       all time draws none; a thread walk owns the arcs (count and behaviour unchanged) and hides the chronology.
// (ii)  focusing the subject scopes the track to its span (padded, never narrower than 3%); Escape restores the whole field's range.
// (iii) #/redbook: the track is the Book's span; the clock glides to each folio's year; leaving restores the
//       exact pre-mode clock and range; Aion -> Red Book -> Aion round trips keep each mode's range.
// (iv)  no page errors.
// Screenshots: .cache/screens/remediation-2026-10-09/time/
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const SHOTS = path.resolve(ROOT, '.cache/screens/remediation-2026-10-09/time');
mkdirSync(SHOTS, { recursive: true });
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const history = read('public/data/history.json');
const rb = read('public/data/redbook.json');
const READING = history.readings[0];

let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** The padded span the scoping rule gives a set of slider-positions, within the field's own extent (the expectation, computed here). */
const expectSpan = (us, bounds = { fromU: 0, toU: 1 }) => {
  const lo = Math.min(...us), hi = Math.max(...us);
  const width = Math.max(hi - lo + 2 * (hi - lo) * 0.04, 0.03);
  const mid = (lo + hi) / 2;
  let from = mid - width / 2, to = mid + width / 2;
  if (from < bounds.fromU) { to += bounds.fromU - from; from = bounds.fromU; }
  if (to > bounds.toU) { from -= to - bounds.toU; to = bounds.toU; }
  return { fromU: Math.max(bounds.fromU, from), toU: Math.min(bounds.toU, to) };
};

/** The whole field's range on the shared scale, as the time control starts on it (the scale runs past the field's last year). */
const fullRange = (page) => page.evaluate(() => {
  const { model } = window.__earth;
  return { fromU: model.scale.toU(model.field.meta.yearMin), toU: model.scale.toU(model.field.meta.yearMax) };
});

const frames = (page, n = 2) => page.evaluate((k) => new Promise((res) => {
  let c = 0;
  const step = () => (++c >= k ? res() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);

const chrono = (page) => page.evaluate(() => window.__earth.engine.arcs.chronoState());
const clock = (page) => page.evaluate(() => {
  const t = window.__earth.time;
  return { mode: t.mode, cursorU: t.cursorU, targetU: t.targetU, on: t.on, trail: t.trail, trailTarget: t.trailTarget, cumulative: t.cumulative, fromU: t.fromU, toU: t.toU, playing: t.playing };
});
const settleOn = (page) => page.waitForFunction(() => window.__earth.time.on > 0.995, null, { timeout: 60000, polling: 100 });
/** The clock has landed: the cursor is at its target (a glide has ended). */
const settleClock = (page) => page.waitForFunction(() => Math.abs(window.__earth.time.cursorU - window.__earth.time.targetU) < 1e-5, null, { timeout: 60000, polling: 100 }).catch(() => {});
const settleOff = (page) => page.waitForFunction(() => window.__earth.time.on < 0.001, null, { timeout: 60000, polling: 100 });

const browser = await launch('chromium', { headed: false });
const pageErrors = [];

// ── (i) the chronology along the cursor ───────────────────────────────────────────────────────────────────────
{
  const { ctx, page, logs } = await open(browser, { hash: '#/f/serpent', width: 1280, height: 800 });
  try {
    await page.waitForFunction(() => window.__earth.engine.arcs.chronoState().segments > 0, null, { timeout: 60000, polling: 200 });
    const info = await page.evaluate(() => {
      const { model, ctl } = window.__earth;
      const idx = model.famOcc.get('serpent').filter((i) => model.located[i]);
      const us = idx.map((i) => model.u[i]).sort((a, b) => a - b);
      return { n: idx.length, us, state: ctl.state.view, segments: window.__earth.engine.arcs.chronoState().segments };
    });
    check(info.state.kind === 'focus' && info.state.subject.id === 'serpent', 'focus: #/f/serpent stands on the globe');
    check(info.n > 20, 'focus: serpent has located occurrences', `${info.n} located, ${info.segments} chronology arcs`);

    // all time: the chronology is built but draws nothing
    const allTime = await chrono(page);
    check(allTime.visible === 0 && allTime.begun === 0 && allTime.on < 0.002, 'all time: no chronology arcs are drawn', JSON.stringify(allTime));
    check(allTime.segments >= 2 && allTime.segments <= 28, 'chronology: built with at most 28 hops', `${allTime.segments} arcs`);

    // turn the time on through the control's own track
    const track = page.locator('.t-track');
    await track.focus();
    await page.keyboard.press('Home');
    await settleOn(page);
    await frames(page, 2);

    const span = await page.evaluate(() => ({ fromU: window.__earth.time.fromU, toU: window.__earth.time.toU }));
    const lo = info.us[0], hi = info.us[info.us.length - 1];
    const u = (q) => info.us[Math.min(info.us.length - 1, Math.floor(q * (info.us.length - 1)))];
    const early = u(0.25), mid = u(0.6), late = hi;

    // forward: the track's own keys, sampling the drawn arcs as the cursor passes
    const fwd = [];
    for (let s = 0; s < 9; s++) {
      for (let k = 0; k < 6; k++) await page.keyboard.press('ArrowRight');
      await frames(page, 2);
      fwd.push({ ...(await chrono(page)), cursor: await page.evaluate(() => window.__earth.time.cursorU) });
    }
    const nonDecFwd = fwd.every((s, k) => k === 0 || (s.begun >= fwd[k - 1].begun && s.travel >= fwd[k - 1].travel - 1e-9));
    check(nonDecFwd, 'scrub forward: drawn arcs and travel never fall', `begun ${fwd.map((s) => s.begun).join(',')}`);
    const lastFwd = fwd[fwd.length - 1];
    check(lastFwd.cursor > span.fromU && lastFwd.begun > fwd[0].begun, 'scrub forward: the chronology grows with the cursor', `begun ${fwd[0].begun} → ${lastFwd.begun} of ${allTime.segments}`);

    // the screenshots: early, mid, late (cursor positions from the serpent's own dates)
    const atCursor = async (target, name) => {
      await page.evaluate((c) => window.__earth.time.scrub(c), target);
      await settleOn(page);
      await frames(page, 3);
      const s = await chrono(page);
      await page.screenshot({ path: path.join(SHOTS, `serpent-chronology-${name}.png`) });
      return s;
    };
    const eS = await atCursor(early, 'early');
    const mS = await atCursor(mid, 'mid');
    const lS = await atCursor(late, 'late');
    console.log(`     early u=${early.toFixed(3)} begun=${eS.begun} visible=${eS.visible}; mid begun=${mS.begun} visible=${mS.visible}; late begun=${lS.begun} visible=${lS.visible}`);
    check(eS.begun < lS.begun, 'drawn arcs at the early cursor are fewer than at the late cursor', `${eS.begun} < ${lS.begun}`);
    check(mS.begun >= eS.begun && lS.begun >= mS.begun, 'drawn arcs rise early → mid → late');
    check(lS.visible < lS.segments || lS.begun === lS.segments, 'the trailing window keeps the line to the present (older arcs fade)', `visible ${lS.visible} of ${lS.segments}`);

    // back: the same values come back as the cursor goes back
    const back = [];
    for (let s = 0; s < 9; s++) {
      for (let k = 0; k < 6; k++) await page.keyboard.press('ArrowLeft');
      await frames(page, 2);
      back.push(await chrono(page));
    }
    const nonIncBack = back.every((s, k) => k === 0 || (s.begun <= back[k - 1].begun && s.travel <= back[k - 1].travel + 1e-9));
    check(nonIncBack, 'scrub back: drawn arcs and travel fall', `begun ${back.map((s) => s.begun).join(',')}`);
    check(back[back.length - 1].begun < lS.begun, 'scrub back un-draws arcs', `${lS.begun} → ${back[back.length - 1].begun}`);

    // all time again: nothing drawn
    await page.evaluate(() => window.__earth.time.setAll());
    await settleOff(page);
    await frames(page, 2);
    const off = await chrono(page);
    check(off.visible === 0 && off.begun === 0, 'all time again: no chronology arcs', JSON.stringify(off));

    // a thread walk owns the arcs: the thread's arcs are built with the planned steps, the chronology stands down
    const threadLen = await page.evaluate(() => {
      const { model } = window.__earth;
      return Math.min(26, model.famOcc.get('serpent').filter((i) => model.located[i]).length);
    });
    await page.evaluate(() => {
      const { ctl } = window.__earth;
      ctl.navigate({ view: { kind: 'thread', target: { type: 'family', id: 'serpent' }, from: { kind: 'world' } }, deep: false });
    });
    await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'thread', null, { timeout: 30000, polling: 100 });
    await frames(page, 2);
    const th = await page.evaluate(() => ({ steps: window.__earth.engine.arcs.steps, tour: window.__earth.engine.arcs.uniforms.uTour.value }));
    check(th.steps === threadLen, 'thread walk: the thread arcs are built with the planned steps', `${th.steps} steps (expected ${threadLen})`);
    await page.waitForFunction(() => window.__earth.engine.arcs.uniforms.uDraw.value >= window.__earth.engine.arcs.steps, null, { timeout: 60000, polling: 200 });
    const thDrawn = await page.evaluate(() => window.__earth.engine.arcs.uniforms.uDraw.value);
    check(thDrawn >= threadLen, 'thread walk: the thread arcs draw in full during the intro', `uDraw ${thDrawn.toFixed(2)}`);
    const thChrono = await chrono(page);
    check(thChrono.segments === 0 && thChrono.visible === 0, 'thread walk: no chronology beside the thread', JSON.stringify(thChrono));

    // leaving the walk: the chronology returns for the focus
    await page.evaluate(() => window.__earth.ctl.navigate({ view: { kind: 'focus', subject: { type: 'family', id: 'serpent' } }, deep: false }));
    await page.waitForFunction(() => window.__earth.engine.arcs.chronoState().segments > 0, null, { timeout: 30000, polling: 200 });
    check((await chrono(page)).segments > 0, 'leaving the walk: the chronology is rebuilt for the focus');
    logs.forEach((l) => { if (/pageerror/.test(l)) pageErrors.push(l); });
  } finally {
    await ctx.close();
  }
}

// ── (ii) focus scopes the time control to the subject's span; the whole field restores it ───────────────────
{
  const { ctx, page, logs } = await open(browser, { hash: '#/f/serpent', width: 1280, height: 800 });
  try {
    await page.waitForFunction(() => window.__earth.engine.arcs.chronoState().segments > 0, null, { timeout: 60000, polling: 200 });
    const us = await page.evaluate(() => {
      const { model } = window.__earth;
      return model.famOcc.get('serpent').filter((i) => model.located[i]).map((i) => model.u[i]);
    });
    const full = await fullRange(page);
    const want = expectSpan(us, full);
    const got = await clock(page);
    check(near(got.fromU, want.fromU, 1e-6) && near(got.toU, want.toU, 1e-6), 'focus: the track is the subject\'s span (padded, min 3%)', `${got.fromU.toFixed(4)}..${got.toU.toFixed(4)} (expected ${want.fromU.toFixed(4)}..${want.toU.toFixed(4)})`);
    // audit #9: a subject at the field's last year pads no further than the field's data
    const late = await page.evaluate(() => {
      const { model } = window.__earth;
      let best = null;
      for (const f of model.field.families) {
        const us = model.famOcc.get(f.id)?.filter((i) => model.located[i]).map((i) => model.u[i]) ?? [];
        if (us.length > 1 && (!best || Math.max(...us) > best.hi)) best = { id: f.id, hi: Math.max(...us), us };
      }
      return best;
    });
    if (late) {
      const lateWant = expectSpan(late.us, full);
      check(lateWant.toU <= full.toU + 1e-12, 'a subject at the field\'s last year: the expected track stops at the field\'s last year', `${late.id}: ${lateWant.toU.toFixed(4)} ≤ ${full.toU.toFixed(4)}`);
      await page.evaluate((id) => window.__earth.ctl.navigate({ view: { kind: 'focus', subject: { type: 'family', id } }, deep: false }), late.id);
      await frames(page, 2);
      const lc = await clock(page);
      check(lc.toU <= full.toU + 1e-9 && near(lc.toU, lateWant.toU, 1e-6) && near(lc.fromU, lateWant.fromU, 1e-6), 'focus on the late subject: the track is bounded by the field\'s own extent (no dead track)', `${lc.fromU.toFixed(4)}..${lc.toU.toFixed(4)} (expected ${lateWant.fromU.toFixed(4)}..${lateWant.toU.toFixed(4)})`);
      await page.evaluate(() => window.__earth.ctl.navigate({ view: { kind: 'world' }, deep: false }));
      await frames(page, 2);
    }
    check(got.toU - got.fromU < full.toU - full.fromU - 1e-6, 'focus: the track is narrower than the whole field', `${(got.toU - got.fromU).toFixed(4)} < ${(full.toU - full.fromU).toFixed(4)}`);
    await page.locator('.t-track').focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'world', null, { timeout: 30000, polling: 100 });
    await frames(page, 2);
    const back = await clock(page);
    check(back.fromU === full.fromU && back.toU === full.toU, 'Escape to the world: the track returns to the whole field', `${back.fromU.toFixed(4)}..${back.toU.toFixed(4)}`);
    // a single-year subject scopes nothing
    await page.evaluate(() => window.__earth.ctl.navigate({ view: { kind: 'focus', subject: { type: 'family', id: 'serpent' } }, deep: false }));
    await frames(page, 2);
    logs.forEach((l) => { if (/pageerror/.test(l)) pageErrors.push(l); });
  } finally {
    await ctx.close();
  }
}

// ── (iii) the Red Book: the book's span, the clock glides to each folio, and the exact restore ────────────────
{
  const { ctx, page, logs } = await open(browser, { hash: '', width: 1280, height: 800 });
  try {
    await page.waitForFunction(() => window.__earth.engine.presences, null, { timeout: 30000, polling: 200 });
    // the pre-mode clock: cursor mode, mid-history, in the whole scale
    await page.evaluate(() => window.__earth.time.scrub(0.5));
    await settleOn(page);
    const pre = await clock(page);

    // three folios across the book (first, middle, last): their years differ, so the clock must travel between them
    const picks = [0, Math.floor(rb.stops.length / 2), rb.stops.length - 1];
    const stops = picks.map((i) => rb.stops[i].id);
    const stopU = await page.evaluate((ids) => ids.map((id) => {
      const { model } = window.__earth;
      const i = model.occIndex.get(id);
      return { id, u: model.u[i], year: model.occ[i].year };
    }), stops);
    const bookU = await page.evaluate((ids) => ids.map((id) => {
      const { model } = window.__earth;
      return model.u[model.occIndex.get(id)];
    }), rb.stops.map((s) => s.id));
    const want = expectSpan(bookU, await fullRange(page));

    await page.evaluate((id) => window.__earth.ctl.navigate({ view: { kind: 'world' }, deep: false, redbook: { stop: id } }), stops[0]);
    await page.waitForFunction(() => window.__earth.ctl.state.redbook, null, { timeout: 30000, polling: 100 });
    await frames(page, 2);
    const inBook = await clock(page);
    check(near(inBook.fromU, want.fromU, 1e-6) && near(inBook.toU, want.toU, 1e-6), 'Red Book: the track is the Book\'s own span', `${inBook.fromU.toFixed(4)}..${inBook.toU.toFixed(4)} (expected ${want.fromU.toFixed(4)}..${want.toU.toFixed(4)})`);

    // the clock glides to each folio's year; the readout shows the folio's year
    check(new Set(stopU.map((s) => s.year)).size === stopU.length, 'Red Book: the three folios are in different years', stopU.map((s) => s.year).join(', '));
    for (const s of stopU) {
      if (s !== stopU[0]) await page.evaluate((id) => window.__earth.ctl.navigate({ view: { kind: 'world' }, deep: false, redbook: { stop: id } }), s.id);
      await page.waitForFunction((target) => {
        const t = window.__earth.time;
        const r = document.querySelector('.t-readout')?.textContent ?? '';
        return t.mode === 'cursor' && Math.abs(t.cursorU - target.u) < 2e-4 && r === String(target.year);
      }, { u: s.u, year: s.year }, { timeout: 90000, polling: 200 }).catch(() => {});
      const now = await clock(page);
      const readout = await page.evaluate(() => document.querySelector('.t-readout')?.textContent ?? '');
      check(Math.abs(now.cursorU - s.u) < 2e-4 && readout === String(s.year), `folio ${s.id.replace('liber-novus-', '')}: the clock is at its year`, `year ${s.year}, readout "${readout}", cursor ${now.cursorU.toFixed(5)} (u ${s.u.toFixed(5)})`);
      check(now.trail > 0.1 && now.cumulative === false && now.playing === false, 'folio: the default trail, not cumulative, not playing', `trail ${now.trail.toFixed(3)}`);
    }
    await page.screenshot({ path: path.join(SHOTS, 'redbook-folio-clock.png') });

    // leave the Book: the pre-mode range and clock come back
    await page.evaluate(() => window.__earth.ctl.navigate({ view: { kind: 'world' }, deep: false }));
    await page.waitForFunction((p) => {
      const t = window.__earth.time;
      return !window.__earth.ctl.state.redbook && t.mode === 'cursor' && Math.abs(t.targetU - p.cursorU) < 1e-9;
    }, pre, { timeout: 30000, polling: 100 });
    await page.waitForFunction((p) => Math.abs(window.__earth.time.cursorU - p.cursorU) < 1e-4, pre, { timeout: 90000, polling: 200 }).catch(() => {});
    const out = await clock(page);
    check(out.fromU === pre.fromU && out.toU === pre.toU, 'leaving the Red Book: the pre-mode range is restored', `${out.fromU}..${out.toU}`);
    check(out.mode === pre.mode && near(out.targetU, pre.cursorU, 1e-9), 'leaving the Red Book: the pre-mode clock (mode and cursor) is restored', `${out.mode} ${out.targetU.toFixed(6)} (pre ${pre.cursorU.toFixed(6)})`);

    // Aion -> Red Book -> Aion -> world: each mode's range holds
    const readingU = await page.evaluate(([from, to]) => ({ fromU: window.__earth.model.scale.toU(from), toU: window.__earth.model.scale.toU(to) }), [READING.from, READING.to]);
    await page.evaluate((id) => window.__earth.ctl.navigate({ view: { kind: 'world' }, deep: false, history: { reading: id } }), READING.id);
    await page.waitForFunction(() => window.__earth.ctl.state.history, null, { timeout: 30000, polling: 100 });
    await frames(page, 2);
    const aion1 = await clock(page);
    check(near(aion1.fromU, readingU.fromU, 1e-9) && near(aion1.toU, readingU.toU, 1e-9), 'Aion: the reading\'s range', `${aion1.fromU.toFixed(4)}..${aion1.toU.toFixed(4)}`);
    await page.evaluate((id) => window.__earth.ctl.navigate({ view: { kind: 'world' }, deep: false, redbook: { stop: id } }), stops[1]);
    await page.waitForFunction(() => window.__earth.ctl.state.redbook && !window.__earth.ctl.state.history, null, { timeout: 30000, polling: 100 });
    await frames(page, 2);
    const rbAgain = await clock(page);
    check(near(rbAgain.fromU, want.fromU, 1e-6) && near(rbAgain.toU, want.toU, 1e-6), 'Aion → Red Book: the Book\'s span', `${rbAgain.fromU.toFixed(4)}..${rbAgain.toU.toFixed(4)}`);
    await page.evaluate((id) => window.__earth.ctl.navigate({ view: { kind: 'world' }, deep: false, history: { reading: id } }), READING.id);
    await page.waitForFunction(() => window.__earth.ctl.state.history && !window.__earth.ctl.state.redbook, null, { timeout: 30000, polling: 100 });
    await frames(page, 2);
    const aion2 = await clock(page);
    check(near(aion2.fromU, readingU.fromU, 1e-9) && near(aion2.toU, readingU.toU, 1e-9), 'Red Book → Aion: the reading\'s range again', `${aion2.fromU.toFixed(4)}..${aion2.toU.toFixed(4)}`);
    await page.evaluate(() => window.__earth.ctl.navigate({ view: { kind: 'world' }, deep: false }));
    await page.waitForFunction(() => !window.__earth.ctl.state.history, null, { timeout: 30000, polling: 100 });
    await frames(page, 2);
    const world = await clock(page);
    const full2 = await fullRange(page);
    check(world.fromU === full2.fromU && world.toU === full2.toU, 'Aion → world: the whole field', `${world.fromU.toFixed(4)}..${world.toU.toFixed(4)}`);
    logs.forEach((l) => { if (/pageerror/.test(l)) pageErrors.push(l); });
  } finally {
    await ctx.close();
  }
}

// ── (iv) a focus whose span excludes the cursor glides the clock (SPEC §9); a period search reaches its period from a focus ──
{
  const { ctx, page, logs } = await open(browser, { hash: '', width: 1280, height: 800 });
  try {
    await page.waitForFunction(() => window.__earth.engine.presences, null, { timeout: 30000, polling: 200 });
    const full = await fullRange(page);
    const phoenix = await page.evaluate(() => {
      const { model } = window.__earth;
      const us = model.famOcc.get('phoenix').filter((i) => model.located[i]).map((i) => model.u[i]);
      return { us, lo: Math.min(...us), hi: Math.max(...us) };
    });
    const span = expectSpan(phoenix.us, full);
    const cursor0 = Math.max(0.9, span.toU + 0.3); // well past Phoenix's own span (the cursor is outside it)
    await page.evaluate((c) => window.__earth.time.scrub(c), cursor0);
    await settleOn(page);
    await frames(page, 2);
    // the focus, and the cursor sampled frame by frame from the moment the focus is taken
    const glide = await page.evaluate(() => new Promise((res) => {
      const { ctl, time } = window.__earth;
      const start = time.cursorU;
      const immediate = [];
      ctl.navigate({ view: { kind: 'focus', subject: { type: 'family', id: 'phoenix' } }, deep: false });
      immediate.push(time.cursorU);
      const samples = [];
      const t0 = performance.now();
      const f = () => {
        samples.push(time.cursorU);
        if (performance.now() - t0 < 2600) requestAnimationFrame(f);
        else res({ start, immediate, samples, toU: time.toU, fromU: time.fromU, mode: time.mode });
      };
      requestAnimationFrame(f);
    }));
    const dist = glide.start - glide.toU;
    let maxStep = 0, monotone = true;
    for (let k = 1; k < glide.samples.length; k++) {
      const step = glide.samples[k - 1] - glide.samples[k];
      if (step < -1e-9) monotone = false;
      maxStep = Math.max(maxStep, step);
    }
    check(glide.mode === 'cursor' && near(glide.immediate[0], glide.start, 1e-12), 'focus that excludes the cursor: the clock does not snap on the navigation itself', `cursor ${glide.start.toFixed(4)} → ${glide.immediate[0].toFixed(4)} at once`);
    check(glide.samples.length >= 5 && monotone && maxStep <= 0.4 * dist, 'focus that excludes the cursor: the clock glides to the span edge (monotone, no frame jump over 40% of the way)', `${glide.samples.length} frames, largest step ${(maxStep / dist * 100).toFixed(0)}% of ${dist.toFixed(3)}`);
    // the sampled window is short under software GL: let the glide land, then read where it settled
    await settleClock(page);
    const landed = await page.evaluate(() => window.__earth.time.cursorU);
    check(near(landed, glide.toU, 2e-4), 'focus that excludes the cursor: the clock settles on the span\'s edge', `${landed.toFixed(4)} vs edge ${glide.toU.toFixed(4)}`);

    // (v) a period search from that focus reaches the period, not the span's edge
    const edgeBefore = glide.toU;
    await page.keyboard.press('/');
    await page.keyboard.type('1600s');
    await page.waitForFunction(() => [...document.querySelectorAll('.s-list li')].some((li) => /1600/.test(li.textContent)), null, { timeout: 15000, polling: 100 }).catch(() => {});
    const pick = await page.evaluate(() => {
      const li = [...document.querySelectorAll('.s-list li')].find((x) => /1600/.test(x.textContent));
      return li ? li.textContent : null;
    });
    if (pick) await page.keyboard.press('Enter');
    await settleClock(page);
    const per = await page.evaluate(() => {
      const { model, time, ctl } = window.__earth;
      return { cursorU: time.cursorU, targetU: time.targetU, fromU: time.fromU, toU: time.toU, view: ctl.state.view.kind, from1600: model.scale.toU(1600), to1700: model.scale.toU(1700), ramp: 0.022 };
    });
    const inPeriod = per.cursorU >= per.from1600 - 2e-3 && per.cursorU <= per.to1700 + per.ramp;
    check(!!pick && inPeriod && per.cursorU > edgeBefore + 0.02, 'period search 1600s from Phoenix: the cursor reaches the period, not the span\'s edge', `picked "${pick ?? 'none'}"; cursor ${per.cursorU.toFixed(4)} in [${per.from1600.toFixed(4)}, ${(per.to1700 + per.ramp).toFixed(4)}] (edge ${edgeBefore.toFixed(4)})`);
    check(near(per.fromU, full.fromU, 1e-9) && near(per.toU, full.toU, 1e-9), 'period search: the track is the whole field\'s range while the period is reached', `${per.fromU.toFixed(4)}..${per.toU.toFixed(4)}`);

    // Esc keeps it: stepping back from the focus to the world does not pull the clock back to the span
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'world', null, { timeout: 15000, polling: 100 }).catch(() => {});
    await settleClock(page);
    const esc = await page.evaluate(() => ({ cursorU: window.__earth.time.cursorU, view: window.__earth.ctl.state.view.kind }));
    check(esc.cursorU >= per.from1600 - 2e-3 && esc.cursorU <= per.to1700 + per.ramp, 'Esc afterwards keeps the period', `${esc.view}, cursor ${esc.cursorU.toFixed(4)}`);
    logs.forEach((l) => { if (/pageerror/.test(l)) pageErrors.push(l); });
  } finally {
    await ctx.close();
  }
}

// ── (vi) no page errors ────────────────────────────────────────────────────────────────────────────────────────
check(pageErrors.length === 0, 'no page errors', pageErrors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
