// The theoretics in the field, in a real browser: the ground is offered first, a concept is a focusable subject,
// the node is drawn in the graph, and each of the fourteen is a real walk (the quotations of its page, played by the one runner:
// each stop shows Jung's passage with its cite, stands the time strip on its year, and carries no label of the build). Run: npx vite --port 5183 --strictPort & then node tests/ui/e2e/theoretics-walk.mjs
import fs from 'node:fs';
import { launch, open, revealSheet } from './lib.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };

// (the live-sky sidecar's probe of its own /now fails when no sidecar runs on this machine; that is the sky's, not the theory's)
const appLogs = (logs) => logs.filter((l) => !/\/now\b/.test(l));
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
  ok(appLogs(logs).length === 0, `no console errors in the field (got ${appLogs(logs).slice(0, 3).join(' | ')})`);
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
  ok(appLogs(logs).length === 0, `no console errors on the focus route (got ${appLogs(logs).slice(0, 3).join(' | ')})`);
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
  ok(appLogs(logs).length === 0, `no console errors in the graph (got ${appLogs(logs).slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// 4. the theory reads the field back: the section links to its node
{
  const { ctx, page, logs } = await open(b, { hash: '#/theory/self' });
  await page.waitForTimeout(2000);
  await revealSheet(page, 'Theory');
  const links = await page.$$eval('.th-link', (els) => els.map((e) => e.textContent.trim()));
  ok(links.includes('The Psychoid'), `Theory's self section links to the psychoid node (got ${JSON.stringify(links)})`);
  await ctx.close();
}

// 5. each theoretic is a real walk, on the desktop and on the phone
for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
  const { ctx, page, logs } = await open(b, { width: w, height: h, hash: '#/theory/theoretics/psychoid', mobile: w < 500 });
  await revealSheet(page, 'Theory');
  await page.waitForTimeout(1500);
  const walks = await page.evaluate(() => Object.fromEntries(window.__earth.model.field.theoretics.map((t) => [t.id, window.__earth.model.walkById.get(`theoretic/${t.id}`).stops])));
  const ids = Object.keys(walks);
  const entered = (st) => (!st.caption && /^\p{Ll}/u.test(st.text) ? `…${st.text}` : st.text);
  const clock = () => page.evaluate(() => { const { time, model } = window.__earth; return model.scale.fromU(time.cursorU); });
  const countText = () => page.locator('.pane-foot .pane-count').textContent();
  const quoteText = () => page.locator('section.deep:not(.passage):not(.you-sheet) .dp-article blockquote.q .q-text, section.deep:not(.passage):not(.you-sheet) .dp-article figure.q .q-text').last().textContent();
  const hashNow = () => page.evaluate(() => location.hash);
  ok(ids.length === 14 && ids.every((id) => walks[id].length >= 8), `${tag}: all 14 theoretics are walks of their page's quotations (${ids.map((id) => walks[id].length).join(',')})`);
  let allFirst = 0, allClock = 0, allClockN = 0;
  for (const id of ids) {
    await page.evaluate((hh) => { location.hash = hh; }, `#/theory/theoretics/${id}`);
    await page.waitForTimeout(700);
    const n = walks[id].length;
    if ((await countText()) === `1 / ${n}` && (await quoteText()) === entered(walks[id][0])) allFirst++;
    else console.log(`    ${id}: opens at ${await countText()} / ${JSON.stringify((await quoteText())?.slice(0, 50))}`);
  }
  ok(allFirst === 14, `${tag}: opening each theoretic starts its walk at the first stop of its own page (${allFirst}/14)`);
  // the whole psychoid walk, stop by stop: the passage and its cite in the pane, the time strip on the stop's year
  await page.evaluate(() => { location.hash = '#/theory/theoretics/psychoid'; });
  await page.waitForTimeout(900);
  const stops = walks.psychoid;
  let shown = 0, cited = 0, headed = 0, sizeOk = 0;
  let last = await clock();
  for (let i = 0; i < stops.length; i++) {
    if (i > 0) { await page.locator('.pane-foot [aria-label="Next passage"]').click(); await page.waitForTimeout(450); }
    if ((await quoteText()) === entered(stops[i])) shown++;
    const cite = (await page.locator('section.deep:not(.passage):not(.you-sheet) .dp-article .q-cite').last().textContent()) ?? '';
    if (cite.includes(stops[i].cite.locator.match(/¶\d+/)?.[0] ?? `pdf p${stops[i].page.page}`)) cited++;
    if ((await page.locator('section.deep:not(.passage):not(.you-sheet) .dp-article h3.as-h3').first().textContent()) === stops[i].section.title) headed++;
    if ((await countText()) === `${i + 1} / ${stops.length}`) sizeOk++;
    const now = await clock();
    if (stops[i].year !== undefined) { allClockN++; if (Math.abs(now - stops[i].year) < 1.5) allClock++; else console.log(`    stop ${i}: clock ${now} for year ${stops[i].year}`); }
    else if (Math.abs(now - last) > 1e-6) console.log(`    stop ${i} has no year but the clock moved ${last} -> ${now}`);
    last = now;
  }
  ok(shown === stops.length, `${tag}: every stop of the psychoid shows its own passage, verbatim (${shown}/${stops.length})`);
  ok(cited === stops.length, `${tag}: every stop shows its cite (${cited}/${stops.length})`);
  ok(headed === stops.length && sizeOk === stops.length, `${tag}: every stop shows its section heading and stands at its place in the walk (${headed}, ${sizeOk})`);
  ok(allClockN > 20 && allClock === allClockN, `${tag}: the time strip stands on each dated stop's year (${allClock}/${allClockN})`);
  const years = new Set(stops.map((x) => x.year).filter((y) => y !== undefined));
  ok(years.size > 3, `${tag}: the walk reaches more than one year (${[...years].join(', ')})`);
  // a stop's passage opens at its source in the corpus
  await page.locator('section.deep:not(.passage):not(.you-sheet) .dp-article .q-open').last().click().catch(() => {});
  await page.waitForTimeout(900);
  ok(await page.locator('section.deep.passage').isVisible().catch(() => false), `${tag}: the cite opens the passage in the corpus`);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/theoretic-walk-${tag}.png` });
  // no label, count or provenance of the build in what the visitor reads
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.evaluate(() => { location.hash = '#/theory/theoretics/mana'; });
  await page.waitForTimeout(900);
  const text = await page.locator('section.deep:not(.passage):not(.you-sheet)').first().innerText();
  ok(!/\b\d+\s+stops?\b|generated|derived|walks?\.json|theory-pages|curated|provenance|palaeolithic/i.test(text), `${tag}: the pane carries no label or metadata of the build`);
  ok(/Mana/.test(text) && (await hashNow()).includes('theoretics/mana'), `${tag}: another theoretic opens its own walk from the address (${await hashNow()})`);
  ok(appLogs(logs).length === 0, `${tag}: no console errors in the walk (got ${appLogs(logs).slice(0, 3).join(' | ')})`);
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\ntheoretics walk: all green');
process.exit(fails.length ? 1 : 0);
