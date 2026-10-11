// The number archetypes in the field, in a real browser: one..six are focusable archetype nodes, focusing one opens
// its page (the position, the framework's words, von Franz, Jung, and the egg block with the drawing), the six is tied
// to the Self, and nothing warns. Run: npx vite --port 5183 --strictPort & then node tests/ui/e2e/numbers-walk.mjs
import fs from 'node:fs';
import { launch, open } from './lib.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };

/** The reading sheet that is actually open (the page carries more than one .deep host). */
const SHEET = `[...document.querySelectorAll('.deep')].find((d) => !d.hidden) ?? null`;

const b = await launch('chromium');

// 1. the six number archetypes are in the page's model, tied to the Self, as archetypes — no tier of their own
{
  const { ctx, page, logs } = await open(b, { hash: '#/graph/a/five' });
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => {
    const model = window.__earth?.model;
    if (!model) return null;
    const ids = ['one', 'two', 'three', 'four', 'five', 'six'];
    return {
      present: ids.filter((id) => model.archById.has(id)).length,
      familyNamed: ids.filter((id) => model.famById.has(id)).length,
      six: (model.archById.get('six')?.archetypes ?? []).map((t) => `${t.id}:${t.basis}`),
      fiveFams: model.archById.get('five')?.familyIds ?? [],
    };
  });
  ok(!!m, 'the model is reachable in the page');
  if (m) {
    ok(m.present === 6, `one..six are archetypes in the page's model (got ${m.present})`);
    ok(m.familyNamed === 0, 'no tier of their own and no family of the same name');
    ok(JSON.stringify(m.six) === JSON.stringify(['self:jung']), `the six ties to the Self in Jung's own word (got ${JSON.stringify(m.six)})`);
    ok(m.fiveFams.includes('quincunx') && m.fiveFams.includes('lapis'), `the five carries the quincunx and the lapis (got ${m.fiveFams.join(',')})`);
  }
  fs.mkdirSync('.cache/screens/numbers', { recursive: true });
  await page.screenshot({ path: '.cache/screens/numbers/01-graph-five.png' });
  ok(logs.length === 0, `no console errors on the graph (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 2. focusing a number opens its page: the position, the framework's words, and the egg block
{
  const { ctx, page, logs } = await open(b, { hash: '#/a/five' });
  await page.waitForTimeout(3000);
  const page1 = await page.evaluate(() => {
    const sheet = [...document.querySelectorAll('.deep')].find((d) => !d.hidden) ?? null;
    if (!sheet) return null;
    const text = sheet.textContent ?? '';
    return {
      title: sheet.querySelector('.dp-title')?.textContent ?? '',
      hasPosition: /5 ↔ #4/.test(text),
      hasQuinca: /quinta essentia/.test(text),
      hasVonFranz: /von Franz/.test(text),
      hasQl: /QL/.test(text),
      hasStages: /5→0 · The Return/.test(text),
      hasEgg: /The egg/.test(text),
      hasDream: /lays a large egg/.test(text),
      hasSnake: /egg encircled by the snake/.test(text),
      hasPauli: /Pauli/.test(text),
      canvas: !!sheet.querySelector('canvas'),
      cites: sheet.querySelectorAll('.lq-cite').length,
    };
  });
  ok(!!page1, 'focusing Five opens its page in the reading layer');
  if (page1) {
    ok(page1.title === 'Five', `the page names the archetype (got ${JSON.stringify(page1.title)})`);
    ok(page1.hasPosition, 'the position 5 ↔ #4 stands on the page');
    ok(page1.hasQl, 'the framework\'s words are there, marked QL');
    ok(page1.hasVonFranz, 'von Franz on five is there');
    ok(page1.hasQuinca, 'the page carries the quinta essentia (CW10 ¶738)');
    ok(page1.hasEgg && page1.hasDream, 'the egg block carries Pauli\'s dream');
    ok(page1.hasStages, 'the count stands as six stages, 5→0 The Return among them');
    ok(page1.hasSnake, 'the pentadic mandala (CW9i ¶615) is there');
    ok(page1.hasPauli, 'the dream is marked Pauli\'s voice');
    ok(page1.canvas, 'the drawing stands in the egg block');
    ok(page1.cites > 4, `the quotations carry cites (got ${page1.cites})`);
  }
  await page.screenshot({ path: '.cache/screens/numbers/02-five-page.png' });
  ok(logs.length === 0, `no console errors on the number page (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 3. the six's page reaches the Self, and the Self's page reaches the numbers
{
  const { ctx, page, logs } = await open(b, { hash: '#/a/six' });
  await page.waitForTimeout(3000);
  const six = await page.evaluate(() => {
    const sheet = [...document.querySelectorAll('.deep')].find((d) => !d.hidden) ?? null;
    const text = sheet?.textContent ?? '';
    const selfLink = [...(sheet?.querySelectorAll('button') ?? [])].some((b2) => b2.textContent?.trim() === 'The Self');
    return { selfLink, archOrder: /archetype of order par excellence/.test(text), wholeness: /archetype of wholeness/.test(text) };
  });
  ok(six.selfLink, 'the six\'s page links to the Self (the tie is shown)');
  ok(six.archOrder, 'the six carries CW10 ¶805 verbatim');
  ok(six.wholeness, 'the six carries the wholeness of the One (CW9i pdf p424) verbatim');
  const { ctx: ctx2, page: page2, logs: logs2 } = await open(b, { hash: '#/symbols/archetype/self' });
  await page2.waitForTimeout(3000);
  const self = await page2.evaluate(() => {
    const text = document.querySelector('.panel, .lp-panel, body')?.textContent ?? '';
    const h3s = [...document.querySelectorAll('.as-h3')].map((h) => h.textContent ?? '');
    const numberLinks = [...document.querySelectorAll('.th-link')].map((b2) => b2.textContent?.trim());
    return { sections: h3s.length, hasNumbers: h3s.some((h) => /numbers themselves/i.test(h)), numberLinks };
  });
  ok(self.sections >= 8, `the Self's page carries its sections (got ${self.sections})`);
  ok(self.hasNumbers, 'the Self\'s page has the numbers section');
  ok(['One', 'Two', 'Three', 'Four', 'Five', 'Six'].every((n) => self.numberLinks.includes(n)), `the six number nodes are linked from it (got ${self.numberLinks.join(',')})`);
  fs.mkdirSync('.cache/screens/numbers', { recursive: true });
  await page2.screenshot({ path: '.cache/screens/numbers/03-self-page.png' });
  ok(logs.length === 0, `no console errors on the six (got ${logs.slice(0, 3).join(' | ')})`);
  ok(logs2.length === 0, `no console errors on the Self's page (got ${logs2.slice(0, 3).join(' | ')})`);
  await ctx.close(); await ctx2.close();
}

// 4. a theory node is focused onto its page in the graph too: clicking one opens the reading
{
  const { ctx, page, logs } = await open(b, { hash: '#/graph/th/psychoid' });
  await page.waitForTimeout(3000);
  const views = await page.evaluate(() => {
    const sheet = [...document.querySelectorAll('.deep')].find((d) => !d.hidden) ?? null;
    const text = sheet?.textContent ?? '';
    return {
      deepOpen: !!sheet,
      title: sheet?.querySelector('.dp-title')?.textContent ?? '',
      reservations: /three reservations/.test(text),
      letters: /psychoid archetype, which, as experience has shown/.test(text),
      pauli: [...(sheet?.querySelectorAll('.lq-voice') ?? [])].some((v) => v.textContent === 'Pauli'),
    };
  });
  ok(views.deepOpen, 'the graph focus opens the node\'s page');
  ok(views.title === 'The Psychoid', `the page names the concept (got ${JSON.stringify(views.title)})`);
  ok(views.reservations, 'the three reservations are on the page');
  ok(views.letters, 'the correspondence is on the page');
  ok(views.pauli, 'Pauli\'s own counter-pressure is marked as his');
  await page.screenshot({ path: '.cache/screens/numbers/04-graph-psychoid.png' });
  ok(logs.length === 0, `no console errors on the graph focus (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nnumbers walk: all green');
process.exit(fails.length ? 1 : 0);
