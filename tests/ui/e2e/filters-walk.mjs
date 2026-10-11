// The two filter surfaces, in a real browser: the graph settings' kind toggles (Archetypes · Theoretics · Families,
// beside Occurrences) and the "Filter the field" section's Archetype and Theory dimensions. A tier switched off leaves
// the drawing with its ties; a subject dimension slices the field by what governs an occurrence. No console errors.
// Run: npx vite --port 5183 --strictPort & then node tests/ui/e2e/filters-walk.mjs
import { launch, open, URL } from './lib.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };

const b = await launch('chromium');

/** The field's totals, from a throwaway page: the model's own maps. */
async function pageTotal(browser) {
  const { ctx, page } = await open(browser, { hash: '#/' });
  const n = await page.evaluate(() => window.__earth.model.occ.length);
  await ctx.close();
  return n;
}
async function countOf(browser, kind, id) {
  const { ctx, page } = await open(browser, { hash: '#/' });
  const n = await page.evaluate(([k, i]) => ((k === 'arch' ? window.__earth.model.archOcc : window.__earth.model.theoOcc).get(i) ?? []).length, [kind, id]);
  await ctx.close();
  return n;
}

// 1. the graph settings carry one toggle per tier, and a tier switched off is absent with its ties
{
  const { ctx, page, logs } = await open(b, { hash: '#/graph' });
  await page.waitForTimeout(3500);
  const before = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    const kinds = [...g.active.keys()].map((id) => g.nodes[id].g.kind);
    return { nodes: g.stats.nodes, edges: g.stats.edges, theoretic: kinds.filter((k) => k === 'theoretic').length, family: kinds.filter((k) => k === 'family').length, archetype: kinds.filter((k) => k === 'archetype').length };
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const toggles = await page.$$eval('.gvt-kinds .gvt-filter', (els) => els.map((e) => ({ text: e.textContent, pressed: e.getAttribute('aria-pressed') })));
  ok(JSON.stringify(toggles.map((t) => t.text)) === JSON.stringify(['Occurrences', 'Archetypes', 'Theoretics', 'Families']), `the settings carry one toggle per tier (got ${JSON.stringify(toggles.map((t) => t.text))})`);
  ok(toggles.every((t) => t.pressed === 'true'), 'every tier is on by default');
  await page.getByRole('button', { name: 'Theoretics', exact: true }).click();
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    const kinds = [...g.active.keys()].map((id) => g.nodes[id].g.kind);
    const dangling = g.activeEdges.some((k) => {
      const e = g.g.edges[k];
      return !g.active.has(e.s) || !g.active.has(e.t);
    });
    return { nodes: g.stats.nodes, edges: g.stats.edges, theoretic: kinds.filter((k) => k === 'theoretic').length, archetype: kinds.filter((k) => k === 'archetype').length, dangling };
  });
  ok(before.theoretic > 0, `the theory stands in the graph before the filter (got ${before.theoretic})`);
  ok(after.theoretic === 0, `Theoretics off: no theoretic node is drawn (got ${after.theoretic})`);
  ok(after.archetype === before.archetype && after.nodes < before.nodes && after.edges < before.edges, `the rest of the field stands, the tier's ties left with it (nodes ${before.nodes}→${after.nodes}, edges ${before.edges}→${after.edges})`);
  ok(!after.dangling, 'no edge is left dangling by the filter');
  await page.screenshot({ path: '.cache/screens/filters/01-graph-theoretics-off.png' });
  // back on: the tier returns
  await page.getByRole('button', { name: 'Theoretics', exact: true }).click();
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    return [...g.active.keys()].map((id) => g.nodes[id].g.kind).filter((k) => k === 'theoretic').length;
  });
  ok(back === before.theoretic, `Theoretics on again: the tier is back (got ${back})`);
  ok(logs.length === 0, `no console errors in the graph settings (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 2. the field filter's Archetype and Theory dimensions slice the field by what governs an occurrence
{
  const total = await pageTotal(b);
  const selfCount = await countOf(b, 'arch', 'self');
  const psychoidCount = await countOf(b, 'theo', 'psychoid');
  const { ctx, page, logs } = await open(b, { hash: '#/' });
  await page.waitForTimeout(3000);
  await page.click('.sh-lens');
  await page.waitForSelector('#shell-menu:not([hidden])');
  await page.waitForTimeout(300);
  const rows = await page.$$eval('.sf-field .sf-label', (els) => els.map((e) => e.textContent));
  ok(rows.includes('Archetype') && rows.includes('Theory'), `the "Filter the field" section carries Archetype and Theory rows (got ${JSON.stringify(rows)})`);
  // a pill works: clicking The Self turns the archetype dimension on, and the count is the union of what is on
  const pill = await page.getByRole('region', { name: 'Filter the field' }).getByRole('button', { name: 'The Self', exact: true }).elementHandle();
  await pill.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await pill.click();
  await page.waitForTimeout(800);
  const clickState = await page.evaluate(() => {
    const ctl = window.__earth.ctl;
    const model = window.__earth.model;
    const f = ctl.filter;
    const on = new Set();
    for (const id of f.archetypes ?? []) for (const i of model.archOcc.get(id) ?? []) on.add(i);
    const text = document.querySelector('.sf-count')?.textContent ?? '';
    const m = text.match(/^([\d,]+)/);
    return { hash: location.hash, archetypes: f.archetypes ?? [], union: on.size, shown: m ? Number(m[1].replace(/,/g, '')) : null, chips: [...document.querySelectorAll('.sh-chip')].map((c) => c.textContent) };
  });
  ok(clickState.archetypes.includes('self'), `the Archetype pill turns the dimension on (${JSON.stringify(clickState.archetypes)})`);
  ok(clickState.shown === clickState.union, `the count is exactly the union of the archetypes on (${clickState.shown} vs ${clickState.union})`);
  ok(clickState.chips.some((c) => c.includes('The Self')), `a chip names the archetype (got ${JSON.stringify(clickState.chips)})`);
  ok(clickState.hash.includes('a=') && clickState.hash.includes('self'), `the filter rides in the address (${clickState.hash})`);
  // a filter can also be linked: the same dimension through the hash, deterministic
  await page.goto(`${URL}#/?a=self`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const byHash = await page.evaluate(() => {
    const { ctl, model } = window.__earth;
    const mask = ctl.filterMask;
    let on = 0;
    if (mask) for (let i = 0; i < mask.length; i++) if (mask[i] === 1) on++;
    return { mask: on, expected: (model.archOcc.get('self') ?? []).length, chip: [...document.querySelectorAll('.sh-chip')].map((c) => c.textContent) };
  });
  ok(byHash.mask === byHash.expected && byHash.mask === selfCount, `#/?a=self leaves the Self's own presences (mask ${byHash.mask} vs model ${byHash.expected})`);
  ok(byHash.chip.some((c) => c.includes('The Self')), `the chip stands on a linked filter (got ${JSON.stringify(byHash.chip)})`);
  await page.goto(`${URL}#/?t=psychoid`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const theo = await page.evaluate(() => {
    const { ctl, model } = window.__earth;
    const mask = ctl.filterMask;
    let on = 0;
    if (mask) for (let i = 0; i < mask.length; i++) if (mask[i] === 1) on++;
    return { mask: on, expected: (model.theoOcc.get('psychoid') ?? []).length, chip: [...document.querySelectorAll('.sh-chip')].map((c) => c.textContent) };
  });
  ok(theo.mask === theo.expected && theo.mask === psychoidCount, `#/?t=psychoid leaves the concept's own presences (mask ${theo.mask} vs model ${theo.expected})`);
  ok(theo.chip.some((c) => c.includes('The Psychoid')), `a chip names the concept (got ${JSON.stringify(theo.chip)})`);
  await page.screenshot({ path: '.cache/screens/filters/02-field-theory.png' });
  // clearing returns the whole field
  await page.click('.sh-lens');
  await page.waitForSelector('#shell-menu:not([hidden])');
  await page.getByRole('region', { name: 'Filter the field' }).getByRole('button', { name: 'Clear the filter', exact: true }).click();
  await page.waitForTimeout(700);
  const cleared = await page.evaluate(() => ({ text: document.querySelector('.sf-count')?.textContent ?? '', hash: location.hash, mask: !!window.__earth.ctl.filterMask }));
  ok(/whole field/.test(cleared.text) && !cleared.hash.includes('t=') && !cleared.hash.includes('a=') && !cleared.mask, `clearing returns the whole field (${JSON.stringify(cleared)})`);
  ok(total > selfCount && total > psychoidCount && selfCount > 0 && psychoidCount > 0, `the counts are real slices (all ${total}, self ${selfCount}, psychoid ${psychoidCount})`);
  ok(logs.length === 0, `no console errors in the field filter (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 3. the tier flags are remembered like the other graph settings
{
  const { ctx, page, logs } = await open(b, { hash: '#/graph' });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Families', exact: true }).click();
  await page.waitForTimeout(1200);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('archetypal-earth.graph') ?? '{}').kinds ?? null);
  ok(saved && saved.family === false && saved.archetype === true && saved.theoretic === true, `the tier flags are kept (got ${JSON.stringify(saved)})`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    return { family: [...g.active.keys()].filter((id) => g.nodes[id].g.kind === 'family').length, kinds: g.stats.occurrences };
  });
  ok(after.family === 0, `the stored flag stands after a reload (families drawn: ${after.family})`);
  ok(logs.length === 0, `no console errors on the reload (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nfilters walk: all green');
process.exit(fails.length ? 1 : 0);
