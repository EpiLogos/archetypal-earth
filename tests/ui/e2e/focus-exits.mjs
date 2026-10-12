// Every way of arriving at a focus (an archetype, a number, a court figure, a theoretic, a family) must show a visible way
// back to the whole field, Escape must step out (deep -> focus -> world), and browser Back must return to where it began.
// Run: npx vite --port 5196 --strictPort &   then   node tests/ui/e2e/focus-exits.mjs
// FOCUS_EXITS_ONLY=<substring> runs the rows whose id contains it; FOCUS_EXITS_JSON=<path> writes the matrix as JSON.
import fs from 'node:fs';
import { launch, open } from './lib.mjs';

const field = JSON.parse(fs.readFileSync(new URL('../../../public/data/field.json', import.meta.url), 'utf8'));
const NAME = Object.fromEntries([...field.archetypes, ...field.families, ...field.theoretics].map((x) => [x.id, x.name]));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (t) => new RegExp(`^${esc(t)}$`);
const ONLY = process.env.FOCUS_EXITS_ONLY ?? '';
// a click waits for its target to be visible, stable and unobstructed; under a loaded machine (software GL, other
// processes) the label's own fade can take longer than a few seconds to settle. That wait is not an assertion: the
// verdict is still the state each click leads to. FOCUS_EXITS_CLICK_MS overrides.
const CLICK_MS = Number(process.env.FOCUS_EXITS_CLICK_MS ?? 12000);

/** the state the app holds, the label and its whole-field crumb (visible, covered or absent), and the reading sheet's X */
const measure = (page) => page.evaluate(() => {
  const s = window.__earth.ctl.state;
  const id = s.view.subject?.id ?? s.view.occId ?? s.view.target?.id ?? null;
  const L = document.querySelector('.focus-label');
  const on = !!L && L.classList.contains('on');
  const btn = [...(L?.querySelectorAll('.fl-up button') ?? [])].find((b) => /whole field/.test(b.textContent));
  let crumb = 'none';
  if (btn) {
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    crumb = r.width > 0 && (hit === btn || btn.contains(hit)) ? 'visible' : 'covered';
  }
  // the reading sheet is the controller's own (the passage sheet shares the class, so it is not queried by class)
  const sheet = window.__earth.ctl.deep.root;
  let x = 'closed';
  if (document.body.classList.contains('deep-open') && !sheet.hidden) {
    const dx = sheet.querySelector('.dp-close');
    if (!dx) x = 'NO-X';
    else {
      const r = dx.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      x = hit && dx.contains(hit) ? 'X' : 'X-covered';
    }
  }
  return {
    kind: s.view.kind, id, deep: !!s.deep, graph: !!s.graph, sky: !!s.sky, from: !!s.from, trail: !!s.trail,
    lens: s.lens?.id ?? null, hash: location.hash,
    label: !L ? 'none' : on ? (L.querySelector('.fl-name')?.textContent ?? '?') : 'off',
    crumb, sheet: x,
  };
});
const show = (m) => `${m.kind}:${m.id ?? ''}${m.deep ? '+deep' : ''}${m.from ? '+from' : ''}${m.trail ? '+trail' : ''}${m.sky ? '+sky' : ''}${m.graph ? '+graph' : ''}${m.lens ? `+lens:${m.lens}` : ''} label=${m.label} crumb=${m.crumb} sheet=${m.sheet}`;
const settle = (page, ms = 1600) => page.waitForTimeout(ms);
const press = async (page, key) => { await page.keyboard.press(key); await settle(page); };
/** a focus's label waits for a sky landing (~5.5 s): the walk waits for it before it reads or clicks */
const labelSettled = (page) => page.waitForFunction(() => { const s = window.__earth.ctl.state; return s.view.kind !== 'focus' || document.querySelector('.focus-label')?.classList.contains('on'); }, null, { timeout: 15000 }).catch(() => {});

/** from a freshly booted page, step out to the bare world (the boot seat is the Self) */
async function toWorld(page) {
  for (let i = 0; i < 4; i++) {
    const m = await measure(page);
    if (m.kind === 'world' && !m.deep && !m.sky && !m.lens && !m.graph) return m;
    await press(page, 'Escape');
  }
  return measure(page);
}

/** a click on a named element inside `scope` (exact text); the act's result says what was missing */
async function clickNamed(page, scope, text) {
  const loc = page.locator(scope).filter({ hasText: exact(text) }).first();
  if (!(await loc.count())) throw new Error(`no ${scope} reads "${text}"`);
  await loc.click({ timeout: CLICK_MS });
}

/** the arrivals: each names the route or the click that reaches a focus, and whether Back is checked from it */
const ARRIVALS = [];
const direct = [
  ['#/a/self', 'archetype self'],
  ['#/a/anima', 'archetype anima'],
  ['#/a/five', 'number five'],
  ['#/a/seven', 'number seven'],
  ['#/a/ten', 'number ten'],
  ['#/a/court-knight', 'court court-knight'],
  ['#/th/psychoid', 'theoretic psychoid'],
  ['#/t/psychoid', 'NOT A ROUTE (#/t/ takes a family or an archetype); boots to the Self'],
  ['#/f/air', 'family air'],
  ['#/f/thoth-star', 'family thoth-star'],
  ['#/f/aries', 'family aries'],
];
for (const [route, what] of direct) {
  ARRIVALS.push({ id: `load ${route}`, what, base: 'load', hash: route, back: false });
  if (!route.endsWith('psychoid') || route.startsWith('#/th')) ARRIVALS.push({ id: `load ${route}/deep`, what: `${what}, /deep`, base: 'load', hash: `${route}/deep`, back: false });
  // the same route typed or linked during a session: Back has a page to return to
  ARRIVALS.push({ id: `url ${route}`, what: `${what}, set in the session`, base: 'world', act: async (page) => { await page.evaluate((h) => { location.hash = h; }, route); await settle(page, 2200); }, back: true });
}
ARRIVALS.push({ id: 'url #/a/anima/deep', what: 'archetype anima, /deep, set in the session', base: 'world', act: async (page) => { await page.evaluate(() => { location.hash = '#/a/anima/deep'; }); await settle(page, 2200); }, back: true });
ARRIVALS.push({ id: 'url #/th/psychoid/deep', what: 'theoretic psychoid, /deep, set in the session', base: 'world', act: async (page) => { await page.evaluate(() => { location.hash = '#/th/psychoid/deep'; }); await settle(page, 2200); }, back: true });

ARRIVALS.push(
  { id: 'click search: Anima', what: 'search', base: 'world', back: true, act: async (page) => { await press(page, '/'); await page.keyboard.type('Anima'); await settle(page, 500); await clickNamed(page, '.s-row .s-label', NAME.anima); await settle(page, 2000); } },
  { id: 'click search: Five', what: 'search, number', base: 'world', back: true, act: async (page) => { await press(page, '/'); await page.keyboard.type('Five'); await settle(page, 500); await clickNamed(page, '.s-row .s-label', NAME.five); await settle(page, 2000); } },
  { id: 'click search: Court Knight', what: 'search, court', base: 'world', back: true, act: async (page) => { await press(page, '/'); await page.keyboard.type(NAME['court-knight']); await settle(page, 500); await page.locator('.s-row .s-label').filter({ hasText: /Knight/ }).first().click({ timeout: CLICK_MS }); await settle(page, 2000); } },
  { id: 'click family ground: Abraxas > The Self', what: 'Archetypal ground link in a family reading', base: 'load', hash: '#/f/abraxas', back: true, act: async (page) => { await clickNamed(page, '.fl-links button', 'Reading'); await settle(page, 1200); await clickNamed(page, '.dp-flow button', NAME.self); await settle(page, 2000); } },
  { id: 'click theory page: The Self', what: 'a theoretic page links to an archetype (the theory page)', base: 'load', hash: '#/th/psychoid/deep', back: true, act: async (page) => { await page.waitForSelector('.th-link', { timeout: 8000 }); await clickNamed(page, '.th-link', NAME.self); await settle(page, 2200); } },
  { id: 'click theory page: Mana', what: 'a theoretic page links to a theoretic', base: 'load', hash: '#/th/psychoid/deep', back: true, act: async (page) => { await page.waitForSelector('.th-link', { timeout: 8000 }); await clickNamed(page, '.th-link', NAME.mana); await settle(page, 2200); } },
  { id: 'click related: Air > Related', what: 'the Related block of a family reading (joins exist only for families)', base: 'load', hash: '#/f/air/deep', back: true, act: async (page) => {
    await page.waitForSelector('.dp-rel button', { timeout: 8000 });
    const names = Object.values(NAME);
    const ok = await page.evaluate((names) => { const b = [...document.querySelectorAll('.dp-rel button')].find((x) => names.includes(x.textContent.trim())) ?? document.querySelector('.dp-rel button'); if (!b) return false; b.click(); return true; }, names);
    if (!ok) throw new Error('no related link');
    await settle(page, 2200);
  } },
  { id: 'click aion event: an event naming an archetype', what: 'an Aion card names an archetype', base: 'load', hash: '#/aion/jung-aion', back: true, act: async (page) => {
    const arch = field.archetypes.map((a) => a.name);
    const n = await page.$$eval('.aion-dot', (e) => e.length);
    for (let i = 0; i < n; i++) {
      const hit = await page.evaluate(([i, arch]) => {
        document.querySelectorAll('.aion-dot')[i].click();
        const b = [...document.querySelectorAll('.aion-card button')].find((x) => arch.includes(x.textContent.trim()));
        if (!b) return null;
        b.click();
        return b.textContent.trim();
      }, [i, arch]);
      await settle(page, 500);
      if (hit) { await settle(page, 2200); return; }
    }
    throw new Error('no Aion card with an archetype link');
  } },
  // the sky is always Astrology now: a body held on the live sky carries its ties as orbiting satellites (Jung's own link
  // first), not a card. A satellite's click is a gaze from the planet at the tie on the Earth, its plates stand, and the
  // first plate is the tie itself: its click descends, the landing after the sky. (A satellite is always in orbit, so it is
  // never 'stable' to the click's own check: the walks that click one force it.)
  { id: 'click sky tie: The Self (sun)', what: 'sky satellite tie, gaze, its first plate (landing after the sky)', base: 'load', hash: '#/sky/sun', back: true, act: async (page) => {
    await page.waitForSelector('.po-sat', { state: 'visible', timeout: 2 * CLICK_MS });
    await page.locator('.po-sat').filter({ hasText: exact(NAME.self) }).first().click({ force: true, timeout: CLICK_MS });
    await page.waitForSelector('.float', { state: 'visible', timeout: 2 * CLICK_MS });
    await settle(page, 1200);
    await page.locator('.float').first().click({ force: true, timeout: CLICK_MS });
    await settle(page, 7000);
  } },
  { id: 'click graph node: The Self', what: 'graph mode node', base: 'load', hash: '#/graph', back: true, act: async (page) => {
    await settle(page, 1500);
    const at = await page.evaluate(() => { const c = document.querySelector('.gv-canvas'); const r = c?.getBoundingClientRect(); const p = window.__earth.ctl.graph?.screenOf('a:self'); return r && p ? { x: r.left + p.x, y: r.top + p.y } : null; });
    if (!at) throw new Error('graph node has no screen position');
    await page.mouse.click(at.x, at.y);
    await settle(page, 3000);
  } },
  { id: 'click number tie: Six > The Self', what: "a number's tied archetype link", base: 'load', hash: '#/a/six/deep', back: true, act: async (page) => {
    const ok = await page.evaluate((n) => { const h = [...document.querySelectorAll('.dp-sub')].find((x) => x.textContent === 'Tied to'); const b = h?.nextElementSibling?.querySelectorAll('button'); const t = b && [...b].find((x) => x.textContent.trim() === n); if (!t) return false; t.click(); return true; }, NAME.self);
    if (!ok) throw new Error('no tied link to The Self on six');
    await settle(page, 2200);
  } },
  { id: 'click globe node: Anima instance', what: 'a node on the globe, with an archetype focus standing (a manifestation)', base: 'load', hash: '#/a/anima', back: true, act: async (page) => {
    await settle(page, 1200);
    const at = await page.evaluate(() => {
      const { ctl, engine } = window.__earth; const m = ctl.m;
      const i = (m.archOcc.get('anima') ?? []).find((k) => m.located[k]);
      const c = document.querySelector('.globe-canvas')?.getBoundingClientRect();
      if (i === undefined || !c) return null;
      const out = engine.project(m.dir[i], { x: 0, y: 0 });
      return { x: c.left + out.x, y: c.top + out.y };
    });
    if (!at) throw new Error('no located anima instance on the globe');
    await page.mouse.click(at.x, at.y);
    await settle(page, 2200);
  } },
  { id: 'click thread instance: Anima', what: 'an instance opened from a thread (a manifestation on the trail)', base: 'load', hash: '#/a/anima', back: true, act: async (page) => {
    await clickNamed(page, '.fl-links button', 'Follow the thread'); await settle(page, 2500);
    await page.locator('.st-caption').click({ timeout: CLICK_MS }); await settle(page, 2200);
  } },
  { id: 'click label tie: Abraxas > The Self', what: 'a family label names its archetypes', base: 'load', hash: '#/f/abraxas', back: true, act: async (page) => { await clickNamed(page, '.fl-ties button', NAME.self); await settle(page, 2000); } },
  { id: 'click follow thread: Anima', what: 'Follow the thread (a thread, not a focus)', base: 'load', hash: '#/a/anima', back: true, act: async (page) => { await clickNamed(page, '.fl-links button', 'Follow the thread'); await settle(page, 2500); } },
);

const rows = ARRIVALS.filter((a) => a.id.includes(ONLY));

/** One arrival, one plan: 'escape' presses Escape twice; 'crumb' goes Back, Forward, then the whole-field crumb. */
async function run(b, arr, plan) {
  const out = { id: arr.id, what: arr.what, plan, steps: [], errors: [] };
  const note = (k, m) => out.steps.push([k, m]);
  let ctx, page, logs;
  try {
    ({ ctx, page, logs } = await open(b, { hash: arr.base === 'world' ? '#/' : arr.hash }));
    // the boot seat is applied once the controller has started; a late boot would re-seat the Self under the walk
    await page.waitForFunction(() => window.__earth.ctl.started === true, null, { timeout: 15000 });
    await settle(page, 2200);
    if (arr.base === 'world') { const w = await toWorld(page); note('world', w); }
    const pre = await measure(page);
    note('pre', pre);
    if (arr.act) {
      try { await arr.act(page); } catch (e) { out.errors.push(`act: ${String(e.message).split('\n')[0].slice(0, 160)}`); await ctx.close(); return out; }
    }
    await labelSettled(page);
    const m1 = await measure(page);
    note('arrive', m1);
    out.arrive = m1;
    if (plan === 'escape') {
      await press(page, 'Escape'); await labelSettled(page); const m2 = await measure(page); note('esc1', m2);
      await press(page, 'Escape'); await labelSettled(page); const m3 = await measure(page); note('esc2', m3);
      await press(page, 'Escape'); await labelSettled(page); const m4 = await measure(page); note('esc3', m4);
      out.esc = { esc1: m2, esc2: m3, esc3: m4 };
    } else {
      if (arr.back) {
        await page.goBack({ timeout: 4000 }).catch((e) => out.errors.push(`back: ${e.message.split('\n')[0]}`));
        await settle(page, 1800); const m2 = await measure(page); note('back', m2);
        out.backState = m2;
        await page.goForward({ timeout: 4000 }).catch(() => {});
        await settle(page, 1800);
        await labelSettled(page);
      }
      const m3 = await measure(page); note('again', m3);
      if (m3.crumb === 'visible') {
        const crumb = page.locator('.focus-label .fl-up button', { hasText: 'whole field' }).first();
        try { await crumb.click({ timeout: CLICK_MS }); await settle(page, 1800); }
        catch (e) { out.errors.push(`crumb click: ${e.message.split('\n')[0].slice(0, 140)}`); }
      }
      const m4 = await measure(page); note('crumb', m4);
      out.crumbState = m4;
    }
    out.jsErrors = logs.filter((l) => !/net::|requestfailed|Failed to load resource/.test(l)).slice(0, 3);
  } catch (e) {
    out.errors.push(`run: ${String(e.message).split('\n')[0].slice(0, 160)}`);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
  return out;
}

/** The verdict of one row, from the states the two plans recorded. */
function verdict(r) {
  const reasons = [];
  const a = r.arrive;
  if (r.errors.length) reasons.push(...r.errors);
  if (!a) return { verdict: 'ERROR', reasons };
  if (a.kind === 'world') return { verdict: 'N/A (no focus)', reasons };
  if (r.plan === 'escape') {
    if (!r.esc) return { verdict: 'ERROR', reasons: [...reasons, 'the run stopped before Escape was pressed'] };
  const e1 = r.esc.esc1, e2 = r.esc.esc2;
    const e3 = r.esc.esc3;
    const reach = [e1, e2, e3].findIndex((e) => e.kind === 'world' && !e.deep);
    if (reach < 0) reasons.push(`Escape x3 never reaches the world (ends at ${show(e3)})`);
    if (reach > 1 && a.kind !== 'thread' && a.kind !== 'manifest') reasons.push(`a focus needs ${reach + 1} Escapes to reach the world`);
    for (const [k, e] of [['esc1', e1], ['esc2', e2], ['esc3', e3]]) if ((e.kind === 'focus' || e.kind === 'thread') && e.crumb !== 'visible') reasons.push(`after ${k} on a ${e.kind}: no whole-field crumb (${e.crumb})`);
    if (a.deep && a.sheet !== 'X') reasons.push(`sheet has no X (${a.sheet})`);
  } else {
    const c = r.crumbState;
    if (a.crumb !== 'visible' && a.kind !== 'manifest') reasons.push(`no visible whole-field crumb on arrival (${a.crumb})`);
    if (a.kind === 'manifest' && a.crumb !== 'visible') reasons.push('manifestation: no whole-field control, only the back name');
    if (c && (c.kind !== 'world' || c.deep)) reasons.push(`crumb does not reach the world (${show(c)})`);
    if (r.backState && r.pre && r.backState.hash !== r.pre.hash) reasons.push(`Back goes to ${r.backState.hash} not ${r.pre.hash}`);
    if (a.deep && a.sheet !== 'X') reasons.push(`sheet has no X (${a.sheet})`);
  }
  return { verdict: reasons.length ? 'STUCK' : 'PASS', reasons };
}

const b = await launch('chromium');
const results = [];
for (const arr of rows) {
  const plans = ['escape', 'crumb'];
  for (const plan of plans) {
    const r = await run(b, arr, plan);
    const v = verdict(r);
    results.push({ ...r, ...v });
    console.log(`${v.verdict.padEnd(6)} ${arr.id} [${plan}] ${r.arrive ? show(r.arrive) : ''}${v.reasons.length ? `\n         - ${v.reasons.join('\n         - ')}` : ''}`);
  }
}
await b.close();

const ob = process.env.FOCUS_EXITS_JSON;
if (ob) fs.writeFileSync(ob, JSON.stringify(results, null, 2));
const stuck = results.filter((r) => r.verdict === 'STUCK' || r.verdict === 'ERROR');
console.log(`\n${results.length} runs, ${stuck.length} stuck or errored`);
process.exit(stuck.length ? 1 : 0);
