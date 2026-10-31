// H5, the Red Book (pilot): its Contents and its folios in the reading pane; the walk on the Walk runner.
//   · the lens's Contents trigger stands in its own place (under the title); the Options hamburger and the folio card are gone
//   · Contents is the 37 folios by section and the genesis table; a pick opens the folio in the pane (the folio rail stays)
//   · the rail, the arrow keys and the pane's stepper walk the same 37 stops in order and wrap past either end
//   · closing a folio (✕ or Escape) stays in the Red Book with the Contents waiting; Escape at Contents takes the list down first
//   · the Red Book's genesis table is read in the pane; a double-click on a folio opens its core reading and Escape returns to it
//   · opening a folio is noted once in the visitor's engagement log; nothing overlaps (rail, time, pane) on a desktop or a phone
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/redbook-pane.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const rb = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/redbook.json'), 'utf8'));
const field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8'));
const title = (id) => field.occurrences.find((o) => o.id === id).title;
const SHOTS = process.env.SHOTS_DIR ?? '';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };
const b = await launch('chromium');
const settle = (page, ms = 1400) => page.waitForTimeout(ms);
const hash = (page) => page.evaluate(() => location.hash);

const pane = (page) => page.evaluate(() => {
  const r = document.querySelector('section.deep:not(.passage):not(.you-sheet)');
  if (!r || r.hidden) return null;
  const q = r.getBoundingClientRect();
  const foot = r.querySelector('.pane-foot');
  return {
    mode: r.dataset.pane, x: Math.round(q.x), w: Math.round(q.width), y: Math.round(q.y), h: Math.round(q.height),
    eyebrow: r.querySelector('.dp-article:not([hidden]) .dp-eyebrow')?.textContent ?? '',
    name: r.querySelector('.dp-article:not([hidden]) .rv-name')?.textContent ?? '',
    count: r.querySelector('.pane-count')?.textContent ?? '',
    footShown: !!foot && !foot.hidden,
    items: [...r.querySelectorAll('.dp-contents-pane .dp-contents button')].map((x) => x.textContent),
    groups: [...r.querySelectorAll('.dp-contents-pane .dp-sub')].map((x) => x.textContent),
    current: r.querySelector('.dp-contents-pane [aria-current="true"]')?.textContent ?? '',
    quotes: r.querySelectorAll('.dp-article blockquote').length,
  };
});
const rail = (page) => page.evaluate(() => {
  const e = document.querySelector('.rb-rail');
  if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
  const q = e.getBoundingClientRect();
  return { progress: e.querySelector('.rb-progress')?.textContent ?? '', x: Math.round(q.x), r: Math.round(q.right), y: Math.round(q.y), b: Math.round(q.bottom) };
});
const engaged = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]').map((e) => `${e.kind}:${e.subject.type}:${e.subject.id}`));

// ── desktop ───────────────────────────────────────────────────────────
{
  const { ctx, page, logs } = await open(b, { width: 1440, height: 900, hash: '#/redbook' });
  await settle(page, 2500);
  ok(await page.locator('.sh-controls .sh-contents').isVisible(), 'the Red Book states its Contents in its own place (under the title)');
  ok(await page.locator('.sh-controls .sh-contents').textContent().then((t) => t.trim() === 'Contents'), 'the trigger is named Contents');
  ok(await page.locator('.sh-controls details.mode-options').count() === 0, 'the Options hamburger is gone (the pane carries its rows)');
  ok(await page.locator('.rb-card').count() === 0, 'the folio card is gone');
  ok(await pane(page) === null && await rail(page) === null, 'the landing reads no folio: no pane, no rail');

  // Contents: the 37 folios by section, then Genesis
  await page.locator('.sh-contents').click();
  await settle(page);
  let p = await pane(page);
  ok(p && p.mode === 'contents' && p.w === 380, `Contents opens in the pane at 380 (${p?.mode} ${p?.w})`);
  ok(p && p.items.length === 38, `it lists the 37 folios and the genesis table (${p?.items.length})`);
  ok(p && JSON.stringify(p.groups) === JSON.stringify([...rb.sections.map((s) => s.name), 'Where the roots became']), `grouped by the book's sections (${p?.groups.length} groups)`);
  const label = (id) => field.occurrences.find((o) => o.id === id).label;
  ok(p && p.items[0] === label(rb.stops[0].id) && p.items[36] === label(rb.stops[36].id) && p.items[37] === 'Genesis', 'the entries are the folios in the walk\'s order, then Genesis');
  ok(await page.locator('.sh-contents').getAttribute('aria-pressed') === 'true', 'the trigger reads pressed while the list is open');
  await page.locator('.sh-contents').click();
  await settle(page, 2200);
  ok(await pane(page) === null, 'the trigger takes the list down again');

  // pick the third folio
  await page.locator('.sh-contents').click();
  await settle(page);
  await page.locator('.dp-contents-pane .dp-contents li').nth(2).locator('button').click();
  await settle(page, 2200);
  p = await pane(page);
  const third = rb.stops[2].id;
  ok((await hash(page)) === `#/redbook/${third}`, `a pick walks to the folio (${await hash(page)})`);
  ok(p && p.mode === 'reading' && p.w === 780, `the folio reads in the pane at 780 (${p?.mode} ${p?.w})`);
  ok(p && p.eyebrow === 'Folio' && p.name === title(third), `the pane names what it reads and the folio (${p?.eyebrow} / ${p?.name})`);
  ok(p && p.footShown && p.count === '3 / 37', `the pane's stepper stands at 3 / 37 (${p?.count})`);
  let r = await rail(page);
  ok(r && r.progress === '3 / 37', `the folio rail stays and agrees (${r?.progress})`);
  ok(r && r.r <= (p?.x ?? 0) + 1, `the rail keeps to the room the pane leaves (rail right ${r?.r}, pane left ${p?.x})`);
  ok(await page.locator('.rb-card').count() === 0, 'no card stands beside the pane');
  const eng = await engaged(page);
  ok(eng.filter((e) => e === `open:occurrence:${third}`).length === 1, `opening the folio is noted once in the engagement log (${eng.length} lines)`);

  // the walk: the arrow keys, the rail, the pane's stepper; the same stops in order
  await page.keyboard.press('ArrowRight');
  await settle(page, 1800);
  p = await pane(page); r = await rail(page);
  ok(p && p.name === title(rb.stops[3].id) && p.count === '4 / 37' && r.progress === '4 / 37', `the arrow key walks to folio 4 (${p?.name})`);
  await page.locator('.pane-foot button[aria-label="Next folio"]').click();
  await settle(page, 1800);
  p = await pane(page);
  ok(p && p.name === title(rb.stops[4].id) && p.count === '5 / 37', `the pane's stepper walks to folio 5 (${p?.name})`);
  await page.locator('.rb-rail button[aria-label="Previous folio"]').click();
  await settle(page, 1800);
  p = await pane(page);
  ok(p && p.name === title(rb.stops[3].id), `the rail walks back to folio 4 (${p?.name})`);
  ok(await page.locator('.rb-card').count() === 0, 'still no card');
  // the whole book in order, then past the end to the first
  const seen = [];
  for (let k = 3; k < 37; k++) {
    seen.push((await pane(page))?.name);
    await page.keyboard.press('ArrowRight');
    await settle(page, 700);
  }
  p = await pane(page);
  ok(JSON.stringify(seen) === JSON.stringify(rb.stops.slice(3).map((s) => title(s.id))), 'the walk runs folios 4 to 37 in the book\'s order');
  ok(p && p.name === title(rb.stops[0].id) && p.count === '1 / 37', `past the last folio comes the first (${p?.count})`);
  await page.keyboard.press('ArrowLeft');
  await settle(page, 1400);
  ok((await pane(page))?.count === '37 / 37', 'and back from the first to the last');

  // the clock follows the walk's year; the globe flies (the stop names a place)
  const clock = await page.evaluate(() => ({ u: window.__earth.time.cursorU, y: window.__earth.model.scale.fromU(window.__earth.time.cursorU) }));
  ok(clock.y > 1900 && clock.y < 1960, `the clock stands in the book's years (${Math.round(clock.y)})`);

  // Contents over a reading: Escape takes the list down and the folio shows again
  await page.locator('.sh-contents').click();
  await settle(page);
  p = await pane(page);
  ok(p && p.mode === 'contents' && p.current !== '', `Contents over a folio marks the folio that stands (${p?.current})`);
  await page.keyboard.press('Escape');
  await settle(page, 1400);
  p = await pane(page);
  ok(p && p.mode === 'reading' && p.name === title(rb.stops[36].id), `Escape at Contents takes the list down; the folio shows again (${p?.mode})`);
  // Escape closes the folio and stays in the Red Book
  await page.keyboard.press('Escape');
  await settle(page, 2200);
  ok(await pane(page) === null, 'Escape closes the folio');
  ok((await hash(page)) === '#/redbook', `and stays in the Red Book (${await hash(page)})`);
  ok(await page.locator('.sh-contents').isVisible(), 'the Contents wait where they were');
  ok(await rail(page) === null, 'the rail is down with the folio');
  // the pane's own ✕
  await page.locator('.sh-contents').click();
  await settle(page);
  await page.locator('.dp-contents-pane .dp-contents li').nth(5).locator('button').click();
  await settle(page, 2000);
  await page.locator('button[aria-label="Close reading"]').click();
  await settle(page, 2000);
  ok(await pane(page) === null && (await hash(page)) === '#/redbook', 'the pane\'s ✕ closes the folio and stays in the mode');
  // Escape again leaves the Red Book for the Field (the dismissal stack)
  await page.keyboard.press('Escape');
  await settle(page, 1800);
  ok(!(await hash(page)).startsWith('#/redbook'), `with nothing left to close, Escape leaves the mode (${await hash(page)})`);
  ok(await page.locator('.sh-contents').isHidden(), 'the Contents trigger goes with the lens');
  ok(logs.length === 0, `no console errors (${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// ── genesis, and the core reading ─────────────────────────────────────
{
  const { ctx, page, logs } = await open(b, { width: 1440, height: 900, hash: '#/redbook' });
  await settle(page, 2500);
  await page.locator('.sh-contents').click();
  await settle(page);
  await page.locator('.dp-contents-pane .dp-contents button', { hasText: 'Genesis' }).click();
  await settle(page, 2000);
  let p = await pane(page);
  ok((await hash(page)) === '#/redbook/genesis' && p && p.mode === 'reading', `the genesis table is read in the pane (${await hash(page)})`);
  ok(await page.locator('section.deep .rb-genesis').count() === rb.genesis.length, `all ${rb.genesis.length} genesis rows stand in it`);
  ok(await page.locator('section.deep .rb-genesis blockquote').count() === rb.genesis.length, 'each row\'s words are the one Quote component');
  ok(await rail(page) === null, 'the genesis table has no rail');
  await page.keyboard.press('Escape');
  await settle(page, 2000);
  ok(await pane(page) === null && (await hash(page)) === '#/redbook', 'Escape closes the genesis table and stays in the mode');

  // a folio, then a double-click on its plate opens the core reading; Escape returns to the folio
  await page.goto(`http://localhost:${new URL(process.env.EARTH_URL ?? 'http://localhost:5183/').port}/#/redbook/${rb.stops[1].id}`);
  await settle(page, 3500);
  p = await pane(page);
  ok(p && p.mode === 'reading' && p.name === title(rb.stops[1].id), `a folio address opens the folio in the pane (${p?.name})`);
  await page.locator('section.deep .rv-hero').dblclick();
  await settle(page, 2500);
  const core = await page.evaluate(() => ({ deep: document.body.classList.contains('deep-open'), hash: location.hash, redbook: !!document.querySelector('.rb-rail:not([hidden])') }));
  ok(core.deep && !core.hash.startsWith('#/redbook'), `a double-click opens the folio's core reading (${core.hash})`);
  await page.keyboard.press('Escape');
  await settle(page, 2500);
  p = await pane(page);
  ok((await hash(page)) === `#/redbook/${rb.stops[1].id}` && p && p.name === title(rb.stops[1].id), `Escape returns to the folio in the Red Book (${await hash(page)})`);
  ok(logs.length === 0, `no console errors (${logs.slice(0, 3).join(' | ')})`);
  await ctx.close();
}

// ── phone ─────────────────────────────────────────────────────────────
{
  const { ctx, page, logs } = await open(b, { width: 390, height: 844, hash: '#/redbook', mobile: true });
  await settle(page, 2500);
  const box = await page.locator('.sh-contents').boundingBox();
  ok(box && box.height >= 44, `the Contents trigger is a full tap target (${box?.height})`);
  await page.locator('.sh-contents').click();
  await settle(page);
  let p = await pane(page);
  ok(p && p.mode === 'contents' && Math.abs(p.h - Math.round(844 * 0.52)) <= 2, `Contents is a sheet 52dvh tall (${p?.h})`);
  ok(await page.locator('section.deep[aria-label="Reading"] .pane-contents-tool').isHidden(), 'the head has no Contents button at the list itself');
  await page.locator('.dp-contents-pane .dp-contents li').nth(1).locator('button').click();
  await settle(page, 2200);
  p = await pane(page);
  ok(p && p.mode === 'reading' && p.w === 390 && Math.abs(p.h - Math.round(844 * 0.86)) <= 2, `a folio is a sheet 86dvh tall (${p?.w}×${p?.h})`);
  ok(p && p.footShown && p.count === '2 / 37', `the pane's stepper carries the walk on a phone (${p?.count})`);
  ok(await rail(page) === null, 'the rail makes way for the sheet on a phone');
  await page.locator('.pane-foot button[aria-label="Next folio"]').click();
  await settle(page, 1800);
  ok((await pane(page))?.count === '3 / 37', 'the stepper walks on a phone');
  // the Path makes way for the sheet: the pane's head carries the way back to the Contents
  ok(await page.locator('.sh-contents').evaluate((e) => getComputedStyle(e.closest('.shell')).opacity === '0'), 'the Path makes way for the sheet on a phone');
  await page.locator('section.deep[aria-label="Reading"] .pane-contents-tool').click();
  await settle(page, 1600);
  p = await pane(page);
  ok(p && p.mode === 'contents' && p.current !== '', `the head's Contents button opens the list over the folio (${p?.mode})`);
  ok(await page.locator('section.deep[aria-label="Reading"] .pane-contents-tool').isHidden(), 'and is not offered at the list itself');
  await page.locator('.dp-contents-pane .dp-contents li').nth(8).locator('button').click();
  await settle(page, 2000);
  p = await pane(page);
  ok(p && p.mode === 'reading' && p.count === '9 / 37', `a pick from it opens that folio (${p?.count})`);
  ok(logs.length === 0, `phone: no console errors (${logs.slice(0, 3).join(' | ')})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'redbook-phone-reading.png') });
  await ctx.close();
}

await b.close();
console.log(fails.length ? `${fails.length} failed` : 'all ok');
process.exit(fails.length ? 1 : 0);
