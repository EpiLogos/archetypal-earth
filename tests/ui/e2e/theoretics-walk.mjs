// The theoretics in the field, in a real browser: the ground is offered first, a concept is a focusable subject,
// and the node is drawn in the graph. Run: npx vite --port 5183 --strictPort & then node tests/ui/e2e/theoretics-walk.mjs
import fs from 'node:fs';
import { launch, open } from './lib.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };

const b = await launch('chromium');

// 1. the search invitation: the field's ground, ahead of the archetypes
{
  const { ctx, page, logs } = await open(b);
  await page.click('.sh-search, button[aria-label="Search"], .search-glyph').catch(async () => { await page.keyboard.press('/'); });
  await page.waitForTimeout(400);
  const rows = await page.$$eval('.s-row', (els) => els.slice(0, 4).map((e) => ({ label: e.querySelector('.s-label')?.textContent, sub: e.querySelector('.s-sub')?.textContent })));
  ok(rows[0]?.label === 'The Psychoid', `the invitation opens on the psychoid (got ${JSON.stringify(rows[0])})`);
  ok(rows[0]?.sub === 'the ground', 'the psychoid is offered as the ground');
  ok(rows[1]?.label === 'The Archetype as Such', `the second entry is the other keystone (got ${JSON.stringify(rows[1])})`);
  ok(rows[1]?.sub === 'the ground', 'the archetype as such is offered as the ground');
  ok(logs.length === 0, `no console errors in the field (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 2. the concept as a subject: #/th/psychoid tunes the world and names it
{
  const { ctx, page, logs } = await open(b, { hash: '#/th/psychoid' });
  await page.waitForTimeout(2500);
  const title = await page.textContent('.sh-title');
  ok(title === 'The Psychoid', `the context line names the subject (got ${JSON.stringify(title)})`);
  const tuned = await page.evaluate(() => {
    const { engine } = window.__earth;
    const rel = engine.presences?.rel;
    if (!rel) return null;
    let own = 0, aside = 0;
    for (const v of rel) { if (v >= 1.4) own++; else if (v === 0) aside++; }
    return { own, aside, total: rel.length };
  });
  ok(tuned && tuned.own > 500, `the globe is tuned to the concept's own presences (${JSON.stringify(tuned)})`);
  fs.mkdirSync('.cache/screens/theoretics', { recursive: true });
  await page.screenshot({ path: '.cache/screens/theoretics/01-focus-psychoid.png' });
  ok(logs.length === 0, `no console errors on the focus route (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 3. the graph view: the field carries the ground (the drawing is judged from the screenshot)
{
  const { ctx, page, logs } = await open(b, { hash: '#/graph' });
  await page.waitForTimeout(4000);
  const tier = await page.evaluate(() => {
    const m = window.__earth?.model;
    if (!m) return null;
    const theo = [...m.theoById.values()];
    return {
      count: theo.length,
      ground: theo.filter((t) => t.ground).map((t) => `${t.id}/${t.ground}`),
      psychoidOcc: m.theoOcc.get('psychoid')?.length ?? 0,
      kinds: m.field.theoretics.length === theo.length,
    };
  });
  ok(!!tier, 'the model is reachable in the page');
  if (tier) {
    ok(tier.count === 14, `all 14 theoretics are in the page's model (got ${tier.count})`);
    ok(JSON.stringify(tier.ground) === JSON.stringify(['psychoid/ontological', 'archetype-as-such/epistemological']), `the ground is exactly the two keystones (got ${JSON.stringify(tier.ground)})`);
    ok(tier.psychoidOcc > 500, `the psychoid stands for the field's own presences (${tier.psychoidOcc})`);
  }
  await page.screenshot({ path: '.cache/screens/theoretics/02-graph-ground.png' });
  ok(logs.length === 0, `no console errors in the graph (got ${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 4. the theory reads the field back: the section links to its node
{
  const { ctx, page, logs } = await open(b, { hash: '#/theory/self' });
  await page.waitForTimeout(2000);
  const links = await page.$$eval('.th-link', (els) => els.map((e) => e.textContent.trim()));
  ok(links.includes('The Psychoid'), `Theory's self section links to the psychoid node (got ${JSON.stringify(links)})`);
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\ntheoretics walk: all green');
process.exit(fails.length ? 1 : 0);
