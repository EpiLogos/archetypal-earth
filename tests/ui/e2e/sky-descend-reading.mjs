// Gate: a descent from the sky is a reading, and a planet named in a card is a flight to that planet.
//
//  1. One click on a card's Earth action closes the sheet and starts the descent (look at the Earth, drop, settle); the node's
//     reading (the deep sheet) is never open during the drop and opens by itself when the camera has landed. The same for a
//     float click from a gaze, a tie link in a reading (a family with located occurrences and one with none), a sign's glyph on
//     a birth chart, a body picked from the graph then a card's action. X on the arrived reading closes it onto the node
//     (label, See in sky); Escape then returns to the sky, the planet held.
//  2. A planet in a card's reading (its decan's ruler, the body that holds its number) goes to that planet in the sky: the
//     camera flies from the held planet to the other (distance to it only falls, no zoom-out pop, no jump cut), the sheet and
//     the old planet's rings and floats are gone, the new planet's rings stand, Back returns to the first planet. The same
//     planet is not a link; the Earth is never one.
//
//   npx vite --port 5202 --strictPort &   and the ephemeris sidecar on :5187
//   EARTH_URL=http://localhost:5202/ node tests/ui/e2e/sky-descend-reading.mjs [outdir]
// SKY_DESCEND_ONLY=a,b,c,d,e,t limits the parts (a..e: descents; t: planet transitions).
import fs from 'node:fs';
import path from 'node:path';
import { launch, open } from './lib.mjs';

const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
const ONLY = (process.env.SKY_DESCEND_ONLY ?? 'a,b,c,d,e,t').split(',');
let failed = 0;
const check = (ok, label, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); };
const note = (label, detail = '') => console.log(`     ${label}${detail ? ` — ${detail}` : ''}`);
const f = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');

/** Hold a planet in Astrology and wait for its approach and its rings. */
async function hold(page, key) {
  await page.evaluate((k) => window.__earth.ctl.openBody(k), key);
  await page.waitForFunction((k) => {
    const { engine } = window.__earth;
    return engine.sky && engine.sky.approached === k && engine.sky.approach > 0.99 && document.body.dataset.skyPhase === 'approach' && document.querySelectorAll('.po-card').length > 0;
  }, key, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

/** Open a card of the held planet's rings by its name, at the planet. */
async function openCard(page, name) {
  const ok = await page.evaluate((n) => {
    const c = [...document.querySelectorAll('.po-card')].find((x) => (x.getAttribute('aria-label') ?? '').startsWith(`${n}:`));
    if (!c) return false;
    c.click();
    return true;
  }, name);
  if (!ok) throw new Error(`no card "${name}" on the held planet's rings`);
  await page.waitForSelector('.lens-panel:not([hidden]) .cr', { timeout: 10000 });
}

/** Records the page every 50 ms from now on: the sheet, the reading, the phase, the state. Stamps `window.__t0` at the click. */
async function record(page) {
  await page.evaluate(() => {
    const W = window;
    W.__rec = [];
    W.__recOn = true;
    const tick = () => {
      if (!W.__recOn) return;
      const c = W.__earth.ctl;
      const s = c.state;
      const sheet = c.deep.root;
      const panel = document.querySelector('.lens-panel');
      const shown = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
      W.__rec.push({
        t: performance.now(),
        panel: shown(panel) && !panel.hidden && !panel.closest('[hidden]'),
        deepOpen: document.body.classList.contains('deep-open') && shown(sheet),
        stateDeep: !!s.deep,
        arrived: !!s.arrived,
        kind: s.view.kind,
        subject: s.view.subject?.id ?? null,
        sky: !!s.sky,
        body: s.sky?.body ?? null,
        from: !!s.from,
        lens: s.lens?.id ?? null,
        phase: document.body.dataset.skyPhase ?? null,
        label: !!document.querySelector('.focus-label.on'),
        floats: [...document.querySelectorAll('.floats .float')].filter(shown).length,
        hash: location.hash,
      });
      setTimeout(tick, 50);
    };
    tick();
  });
}
const stopRecord = (page) => page.evaluate(() => { window.__recOn = false; return window.__rec; });
/** Click an element by DOM and stamp the page clock at that instant (no actionability wait is part of the time). */
const clickStamped = (page, selector, text) => page.evaluate(([sel, txt]) => {
  const el = [...document.querySelectorAll(sel)].find((x) => !txt || (x.textContent ?? '').includes(txt));
  if (!el) return null;
  window.__t0 = performance.now();
  el.click();
  return window.__t0;
}, [selector, text ?? '']);

/** The focus label stands within a moment of the reading (the same step; its class lands a frame later). */
const labelWith = (rec, opened) => !!opened && rec.some((r) => r.t >= opened.t && r.t - opened.t < 600 && r.label);

/** What a descent must look like, read off the recording that began before the click at `t0`. */
function judge(tag, rec, t0, { clicks, subject }) {
  const after = rec.filter((r) => r.t >= t0);
  const closed = after.find((r) => !r.panel);
  const first = after[0];
  check(!!closed && closed.t - t0 < 1200, `${tag}: the sheet closes with the click`, closed ? `${f(closed.t - t0, 0)} ms` : 'never');
  const carried = after.find((r) => r.stateDeep && r.kind === 'focus');
  check(!!carried && carried.t - t0 < 1500 && carried.subject === subject && !carried.sky, `${tag}: the descent carries the reading in the state at once (deep, ${subject})`, carried ? `${f(carried.t - t0, 0)} ms, subject ${carried.subject}` : JSON.stringify(first));
  const during = after.filter((r) => r.phase === 'descend');
  check(during.length > 5, `${tag}: the camera descends (phase "descend" for ${during.length} samples, ${during.length ? f(during[during.length - 1].t - during[0].t, 0) : 0} ms)`);
  check(!during.some((r) => r.deepOpen), `${tag}: the reading is not open during the drop`);
  check(!after.some((r) => r.t - t0 < 2000 && r.deepOpen), `${tag}: the reading is not open in the first 2 s`);
  const opened = after.find((r) => r.deepOpen);
  check(!!opened, `${tag}: the reading opens by itself`, opened ? `${f(opened.t - t0, 0)} ms after the click, phase ${opened.phase}` : 'never');
  check(!!opened && opened.phase === 'settled' && labelWith(after, opened), `${tag}: it opens on the landing (camera settled, focus label on)`, opened ? `${opened.phase}, label ${labelWith(after, opened)}` : '');
  note(`${tag}: ${clicks} click(s) to the reading, ${opened ? f((opened.t - t0) / 1000, 1) : 'n/a'} s`);
  return opened;
}

const browser = await launch('chromium', { headed: false });
const parts = {};

// ── a. a card's Earth action, once ───────────────────────────────────────────────────────────────────────────────────
parts.a = async () => {
  for (const s of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
    const { ctx, page, logs } = await open(browser, { width: s.width, height: s.height, mobile: s.mobile });
    await hold(page, 'mars');
    await openCard(page, 'Two of Wands');
    await record(page);
    await page.waitForTimeout(300);
    const t0 = await clickStamped(page, '.cr button', 'Read it in the field');
    check(t0 !== null, `a ${s.name}: the card has a "Read it in the field" action`);
    await page.waitForFunction(() => window.__earth.ctl.state.deep && document.body.classList.contains('deep-open') && document.body.dataset.skyPhase === 'settled', null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const rec = await stopRecord(page);
    const opened = judge(`a ${s.name}`, rec, t0, { clicks: 1, subject: 'thoth-two-of-wands' });
    if (out && opened) await page.screenshot({ path: path.join(out, `${s.name}-a-landed.png`) });
    // X closes the reading onto the node; the sky is one step further
    await page.click('.deep.on .dp-close');
    await page.waitForTimeout(900);
    let st = await page.evaluate(() => { const x = window.__earth.ctl.state; return { kind: x.view.kind, subject: x.view.subject?.id, deep: x.deep, from: !!x.from, sky: !!x.sky, label: !!document.querySelector('.focus-label.on'), seeInSky: [...document.querySelectorAll('.focus-label a, .focus-label button')].some((b) => /See in sky/.test(b.textContent)) }; });
    check(st.kind === 'focus' && st.subject === 'thoth-two-of-wands' && !st.deep && st.from && !st.sky && st.label, `a ${s.name}: X closes the reading onto the node (label on, the sky kept behind)`, JSON.stringify(st));
    check(st.seeInSky, `a ${s.name}: "See in sky" stands`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => { const x = window.__earth.ctl.state; return !!x.sky && x.lens?.id === 'astrology' && !x.from; }, null, { timeout: 10000 }).catch(() => {});
    st = await page.evaluate(() => { const x = window.__earth.ctl.state; return { lens: x.lens?.id, body: x.sky?.body, kind: x.view.kind }; });
    check(st.lens === 'astrology' && st.body === 'mars' && st.kind === 'world', `a ${s.name}: Escape returns to the sky, Mars held`, JSON.stringify(st));
    check(logs.filter((l) => !/ephemeris|sidecar|sky camera:/i.test(l)).length === 0, `a ${s.name}: no console errors`, logs.slice(0, 2).join(' | '));
    await ctx.close();
  }
};

// ── b. a float click from a gaze ─────────────────────────────────────────────────────────────────────────────────────
parts.b = async () => {
  const { ctx, page } = await open(browser, { width: 1440, height: 900 });
  await hold(page, 'venus');
  // an orbit node gazes at the Earth: its plates float up (one click), the plate descends (the second)
  const sat = await page.evaluate(() => {
    const x = [...document.querySelectorAll('.po-sat')].find((b) => b.getBoundingClientRect().width > 0);
    return x ? x.textContent : null;
  });
  check(!!sat, 'b: Venus carries orbit nodes', String(sat));
  await page.locator('.po-sat').first().click({ force: true });
  await page.waitForFunction(() => document.body.dataset.skyPhase === 'gaze' && document.querySelectorAll('.floats .float').length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await record(page);
  await page.waitForTimeout(200);
  const t0 = await clickStamped(page, '.floats .float', '');
  await page.waitForFunction(() => window.__earth.ctl.state.deep && document.body.classList.contains('deep-open') && document.body.dataset.skyPhase === 'settled', null, { timeout: 30000 });
  await page.waitForTimeout(700);
  const rec = await stopRecord(page);
  const after = rec.filter((r) => r.t >= t0);
  const during = after.filter((r) => r.phase === 'descend');
  const subject = after.find((r) => r.kind === 'focus')?.subject ?? null;
  check(!!subject, 'b: the float click descends to a focus', String(subject));
  check(during.length > 5 && !during.some((r) => r.deepOpen), `b: nothing opens during the drop (${during.length} samples)`);
  const opened = after.find((r) => r.deepOpen);
  check(!!opened && opened.phase === 'settled', 'b: the reading opens on the landing', opened ? `${f((opened.t - t0) / 1000, 1)} s, ${opened.phase}` : 'never');
  note('b: 2 clicks (orbit node, then the plate) to the reading — as before; the plate was the descent and only the reading was missing');
  await ctx.close();
};

// ── c. a tie link in a planet's reading: a family with placed instances, and one with none ────────────────────────────
parts.c = async () => {
  // the sephira (Chokmah) is a family with no placed instance of its own; the element (Fire) has some: both descend and open
  for (const want of [{ label: 'Chokmah', tag: 'c sephira' }, { label: 'Wands', tag: 'c element' }]) {
    const p = await open(browser, { width: 1440, height: 900 });
    await hold(p.page, 'mars');
    await openCard(p.page, 'Two of Wands');
    const placed = await p.page.evaluate((label) => {
      const b = [...document.querySelectorAll('.cr .cr-chain button.cr-chip')].find((x) => (x.textContent ?? '').includes(label));
      return b ? { name: b.querySelector('.as-tie-name')?.textContent } : null;
    }, want.label);
    check(!!placed, `${want.tag}: the link is there`, JSON.stringify(placed));
    if (!placed) { await p.ctx.close(); continue; }
    await record(p.page);
    await p.page.waitForTimeout(200);
    const t0 = await clickStamped(p.page, '.cr .cr-chain button.cr-chip', want.label);
    await p.page.waitForFunction(() => window.__earth.ctl.state.deep && document.body.classList.contains('deep-open') && document.body.dataset.skyPhase === 'settled', null, { timeout: 30000 });
    await p.page.waitForTimeout(700);
    const rec = await stopRecord(p.page);
    const after = rec.filter((r) => r.t >= t0);
    const focus = after.find((r) => r.kind === 'focus');
    const located = await p.page.evaluate((id) => { const m = window.__earth.ctl.m; return (m.famOcc.get(id) ?? []).filter((i) => m.located[i]).length; }, focus?.subject ?? '');
    note(`${want.tag}: ${focus?.subject} has ${located} placed instance(s)`);
    check(!after.some((r) => r.phase === 'descend' && r.deepOpen), `${want.tag}: the reading is not open during the drop`);
    const opened = after.find((r) => r.deepOpen);
    check(!!opened && opened.phase === 'settled' && labelWith(after, opened), `${want.tag}: the reading opens on the landing (camera settled, focus label on)`, opened ? `${f((opened.t - t0) / 1000, 1)} s, ${opened.phase}, label ${labelWith(after, opened)}` : 'never');
    note(`${want.tag}: 1 click, ${opened ? f((opened.t - t0) / 1000, 1) : 'n/a'} s`);
    await p.ctx.close();
  }
};

// ── d. a sign's glyph on a birth chart ───────────────────────────────────────────────────────────────────────────────
parts.d = async () => {
  const { ctx, page } = await open(browser, { width: 1440, height: 900, hash: '#/astrology/jung' });
  await page.waitForFunction(() => document.body.classList.contains('sky-ready'), null, { timeout: 60000 });
  await page.waitForFunction(() => window.__earth.ctl.skyNatalChart && !window.__earth.engine.sky.travelling, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const sign = await page.evaluate(() => document.querySelector('button.sky-chart-btn.on')?.getAttribute('aria-label') ?? null);
  check(!!sign, 'd: a sign glyph stands on the birth chart', String(sign));
  if (sign) {
    await record(page);
    await page.waitForTimeout(200);
    const t0 = await clickStamped(page, `button.sky-chart-btn.on[aria-label="${sign}"]`, '');
    await page.waitForFunction(() => window.__earth.ctl.state.deep && document.body.classList.contains('deep-open') && document.body.dataset.skyPhase === 'settled', null, { timeout: 30000 });
    await page.waitForTimeout(700);
    const rec = await stopRecord(page);
    const after = rec.filter((r) => r.t >= t0);
    check(!after.some((r) => r.phase === 'descend' && r.deepOpen), 'd: the reading is not open during the drop');
    const opened = after.find((r) => r.deepOpen);
    check(!!opened && opened.phase === 'settled' && opened.subject === sign.toLowerCase(), `d: the ${sign} reading opens on the landing`, opened ? `${f((opened.t - t0) / 1000, 1)} s, ${opened.subject}` : 'never');
    note(`d: 1 click, ${opened ? f((opened.t - t0) / 1000, 1) : 'n/a'} s`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => { const x = window.__earth.ctl.state; return !!x.sky?.natal && x.view.kind === 'world'; }, null, { timeout: 10000 }).catch(() => {});
    const st = await page.evaluate(() => ({ natal: window.__earth.ctl.state.sky?.natal ?? null, kind: window.__earth.ctl.state.view.kind }));
    check(st.natal === 'jung' && st.kind === 'world', 'd: X-then-Escape returns to the birth sky', JSON.stringify(st));
  }
  await ctx.close();
};

// ── e. a body picked in the graph, then a card's action ──────────────────────────────────────────────────────────────
parts.e = async () => {
  const { ctx, page } = await open(browser, { width: 1440, height: 900, hash: '#/graph' });
  await page.waitForFunction(() => window.__earth.ctl.graph?.isVisible, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  // the sky's anchors are off by default: Settings → Sky anchors
  if (await page.locator('#graph-settings').isHidden()) await page.locator('.gvt-settings').click();
  await page.locator('.gvt-sky').click();
  await page.waitForFunction(() => window.__earth.ctl.graph.stats.sky === 'on', null, { timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__earth.ctl.graph.settle(500));
  await page.waitForTimeout(600);
  const at = await page.evaluate(() => {
    const { ctl } = window.__earth;
    const c = document.querySelector('.gv-canvas')?.getBoundingClientRect();
    const p = ctl.graph?.screenOf('b:mars');
    return c && p ? { x: c.left + p.x, y: c.top + p.y } : null;
  });
  check(!!at, 'e: the graph places Mars on its outer ring');
  if (!at) { await ctx.close(); return; }
  const t0 = Date.now();
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => { const x = window.__earth.ctl.state; return x.lens?.id === 'astrology' && x.sky?.body === 'mars' && !x.graph; }, null, { timeout: 15000 }).catch(() => {});
  const st = await page.evaluate(() => { const x = window.__earth.ctl.state; return { lens: x.lens?.id, body: x.sky?.body, graph: !!x.graph }; });
  check(st.lens === 'astrology' && st.body === 'mars' && !st.graph, 'e: a body in the graph opens Astrology on that planet (1 click)', JSON.stringify(st));
  await page.waitForFunction(() => window.__earth.engine.sky?.approached === 'mars' && window.__earth.engine.sky.approach > 0.99 && document.body.dataset.skyPhase === 'approach' && document.querySelectorAll('.po-card').length > 0, null, { timeout: 60000 });
  note('e: the planet is held', `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(1200);
  await openCard(page, 'Two of Wands');
  await record(page);
  await page.waitForTimeout(200);
  const c0 = await clickStamped(page, '.cr button', 'Read it in the field');
  await page.waitForFunction(() => window.__earth.ctl.state.deep && document.body.classList.contains('deep-open') && document.body.dataset.skyPhase === 'settled', null, { timeout: 30000 });
  await page.waitForTimeout(700);
  const rec = await stopRecord(page);
  judge('e', rec, c0, { clicks: 1, subject: 'thoth-two-of-wands' });
  await ctx.close();
};

// ── t. a planet in a card's reading is a flight to the planet ────────────────────────────────────────────────────────
const TRANSITIONS = [
  { from: 'mars', card: 'Five of Wands', to: 'saturn', note: 'inner to outer: the Five of Wands is Saturn in Leo' },
  { from: 'saturn', card: 'Three of Disks', to: 'mars', note: 'outer to inner: the Three of Disks is Mars in Capricorn' },
  { from: 'moon', card: 'Nine of Disks', to: 'venus', note: 'the Moon, which orbits the Earth: the Nine of Disks is Venus in Virgo' },
];
const BODY_NAME = { sun: 'Sun', moon: 'Moon', mercury: 'Mercury', venus: 'Venus', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto' };

parts.t = async () => {
  for (const tr of TRANSITIONS) {
    const tag = `t ${tr.from} → ${tr.to}`;
    const { ctx, page, logs } = await open(browser, { width: 1440, height: 900 });
    await hold(page, tr.from);
    await openCard(page, tr.card);
    const links = await page.evaluate(() => [...document.querySelectorAll('.cr .cr-planet')].map((b) => ({ body: b.dataset.body, disabled: b.disabled, text: b.textContent })));
    const link = links.find((l) => l.body === tr.to);
    check(!!link && !link.disabled, `${tag}: the ${tr.card} reading offers ${BODY_NAME[tr.to]} as a planet link (${tr.note})`, links.map((l) => `${l.body}${l.disabled ? '(here)' : ''}`).join(', '));
    check(!links.some((l) => l.body === 'terra') && !links.some((l) => l.body === tr.from && !l.disabled), `${tag}: the Earth is never a planet link, and the planet it is at is not one`);
    const startLabels = await page.evaluate(() => [...document.querySelectorAll('.po-card')].map((c) => c.getAttribute('aria-label')).sort());
    // one frame sampler: the camera's distance to the planet and the Earth, the look, the stale chrome
    await page.evaluate((to) => {
      const W = window;
      const { engine } = W.__earth;
      const V = engine.camera.position.constructor;
      W.__fr = [];
      W.__frOn = true;
      const shown = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { if (n.hidden) return false; const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return false; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const d = new V();
      engine.onFrame(() => {
        if (!W.__frOn) return;
        const p = engine.camera.position;
        engine.camera.getWorldDirection(d);
        const T = engine.sky.scenePosition(to);
        const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
        W.__fr.push({
          t: performance.now(), cam: p.length(), to: T ? p.distanceTo(T) : null, look: [d.x, d.y, d.z],
          phase: document.body.dataset.skyPhase, approached: engine.sky.approached, approach: engine.sky.approach,
          cards: [...document.querySelectorAll('.po-card')].filter((c) => shown(c) && eff(c) > 0.05).length,
          sats: [...document.querySelectorAll('.po-sat')].filter((c) => shown(c) && eff(c) > 0.05).length,
          floats: [...document.querySelectorAll('.floats .float')].filter(shown).length,
          line: !!document.querySelector('.po-earth-line') && shown(document.querySelector('.po-earth-line')),
          panel: !!document.querySelector('.lens-panel:not([hidden])'),
          lens: W.__earth.ctl.state.lens?.id ?? null, body: W.__earth.ctl.state.sky?.body ?? null,
        });
      });
      // the largest distance of any body from the Earth: the sky's own radius
      W.__skyRadius = Math.max(...['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'].map((k) => { const q = engine.sky.scenePosition(k); return q ? q.length() : 0; }));
    }, tr.to);
    const t0 = await clickStamped(page, '.cr .cr-planet', BODY_NAME[tr.to]);
    check(t0 !== null, `${tag}: the planet link is clicked once`);
    await page.waitForFunction((k) => { const { engine } = window.__earth; return engine.sky?.approached === k && engine.sky.approach > 0.99 && document.body.dataset.skyPhase === 'approach'; }, tr.to, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const { fr, R } = await page.evaluate(() => { window.__frOn = false; return { fr: window.__fr, R: window.__skyRadius }; });
    const run = fr.filter((x) => x.t >= t0);
    const arrived = run.find((x) => x.phase === 'approach' && x.approached === tr.to && x.t - t0 > 400);
    const state = await page.evaluate(() => ({ lens: window.__earth.ctl.state.lens?.id, body: window.__earth.ctl.state.sky?.body, hash: location.hash, panel: !!document.querySelector('.lens-panel:not([hidden])'), sky: !!window.__earth.ctl.state.sky }));
    check(state.lens === 'astrology' && state.body === tr.to && state.sky && state.hash === `#/sky/${tr.to}`, `${tag}: Astrology on ${BODY_NAME[tr.to]} (sky.body ${state.body}, ${state.hash})`);
    check(!state.panel, `${tag}: the card's sheet is gone`);
    const panelGone = run.find((x) => !x.panel);
    check(!!panelGone && panelGone.t - t0 < 400, `${tag}: the sheet closes with the click`, panelGone ? `${f(panelGone.t - t0, 0)} ms` : 'never');
    // the camera
    const settled = run.filter((x) => x.t >= t0 + 300 && x.to !== null);
    let worst = 0, rises = 0;
    for (let i = 1; i < settled.length; i++) { const up = settled[i].to - settled[i - 1].to; if (up > 0.5) rises++; worst = Math.max(worst, up); }
    check(rises === 0, `${tag}: the camera's distance to ${BODY_NAME[tr.to]} only falls after the first 300 ms`, `${rises} frame(s) rising, worst +${f(worst, 2)} R⊕`);
    const startD = run[0].cam;
    const endD = run[run.length - 1].cam;
    const peak = Math.max(...run.map((x) => x.cam));
    check(peak <= startD + 1.5 * R, `${tag}: no zoom-out pop: peak distance from the Earth ${f(peak, 0)} ≤ start ${f(startD, 0)} + 1.5 × sky radius ${f(R, 0)}`);
    check(peak <= Math.max(startD, endD) * 1.05, `${tag}: …and no rise above the two stations at all (${f(peak, 0)} vs ${f(Math.max(startD, endD), 0)})`);
    let jump = 0;
    const ang = (a, b) => (Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
    for (let i = 1; i < run.length; i++) jump = Math.max(jump, ang(run[i].look, run[i - 1].look));
    check(jump < 6, `${tag}: no jump cut: the view turns at most ${f(jump, 2)}° in a frame`);
    const phases = [...new Set(run.map((x) => x.phase))];
    check(!phases.includes('return') && !phases.includes('descend') && !phases.includes('gaze'), `${tag}: the move is not a return from the Earth (phases ${phases.join(' → ')})`);
    // nothing of the planet left behind
    const stale = run.filter((x) => x.phase !== 'approach' && (x.cards > 0 || x.sats > 0 || x.floats > 0 || x.line));
    check(stale.length === 0, `${tag}: the old planet's rings, floats and Earth line are gone while the camera travels`, stale[0] ? JSON.stringify({ cards: stale[0].cards, sats: stale[0].sats, floats: stale[0].floats, line: stale[0].line }) : '');
    const endLabels = await page.evaluate(() => [...document.querySelectorAll('.po-card')].map((c) => c.getAttribute('aria-label')).sort());
    check(endLabels.length > 0 && endLabels.join('|') !== startLabels.join('|') && endLabels.every((l) => l.toLowerCase().includes(BODY_NAME[tr.to].toLowerCase())),
      `${tag}: ${BODY_NAME[tr.to]}'s own card rings stand (${endLabels.length} cards, none the old planet's)`, endLabels.slice(0, 2).join(' | '));
    note(`${tag}: 1 click; arrives in ${arrived ? f((arrived.t - t0) / 1000, 1) : 'n/a'} s; distance to ${BODY_NAME[tr.to]} ${f(run[0].to, 0)} → ${f(run[run.length - 1].to, 1)} R⊕`);
    if (out) await page.screenshot({ path: path.join(out, `t-${tr.from}-${tr.to}.png`) });
    // Back returns to the first planet
    await page.goBack();
    await page.waitForFunction((k) => { const { engine } = window.__earth; return engine.sky?.approached === k && engine.sky.approach > 0.99 && document.body.dataset.skyPhase === 'approach'; }, tr.from, { timeout: 30000 }).catch(() => {});
    const back = await page.evaluate(() => ({ body: window.__earth.ctl.state.sky?.body ?? null, lens: window.__earth.ctl.state.lens?.id ?? null, hash: location.hash, approached: window.__earth.engine.sky?.approached ?? null, phase: document.body.dataset.skyPhase }));
    check(back.lens === 'astrology' && back.body === tr.from && back.approached === tr.from && back.phase === 'approach', `${tag}: Back returns to ${BODY_NAME[tr.from]}, held`, JSON.stringify(back));
    check(logs.filter((l) => !/ephemeris|sidecar|sky camera:/i.test(l)).length === 0, `${tag}: no console errors`, logs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // the same planet is a no-op; the Earth is never a link
  const { ctx, page } = await open(browser, { width: 1440, height: 900 });
  await hold(page, 'mars');
  await page.evaluate(() => { window.__ph = []; window.__phOn = true; const tick = () => { if (!window.__phOn) return; window.__ph.push(document.body.dataset.skyPhase); setTimeout(tick, 50); }; tick(); });
  await page.evaluate(() => window.__earth.ctl.openBody('mars'));
  await page.waitForTimeout(1500);
  const ph = await page.evaluate(() => { window.__phOn = false; return [...new Set(window.__ph)]; });
  check(ph.length === 1 && ph[0] === 'approach', 'the planet already held is a no-op (the camera stays at its station)', ph.join(', '));
  await openCard(page, 'Five of Cups');
  const same = await page.evaluate(() => [...document.querySelectorAll('.cr .cr-planet')].map((b) => `${b.dataset.body}${b.disabled ? '(here)' : ''}`));
  check(same.includes('mars(here)') && !same.some((x) => x.startsWith('terra')), 'a card ruled by the planet it is read at shows it as "here", not a link', same.join(', '));
  await ctx.close();
};

for (const k of ['a', 'b', 'c', 'd', 'e', 't']) {
  if (!ONLY.includes(k)) continue;
  console.log(`\n── part ${k} ──`);
  try { await parts[k](); } catch (e) { failed++; console.log(`FAIL part ${k} stopped: ${String(e.message).split('\n')[0]}`); }
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
