// G2 guards (PRODUCT-ALIGNMENT-PLAN §4, "unguarded, so guarded first"): the behaviours of today's app that no other
// gate holds and the alignment must not move. Each reads the live page.
//   (a) the field filter survives a lens change (the controller keeps one filter; the hash carries it on every lens)
//   (b) the Aion chapter walk leaves the clock alone; a thread walk moves it
//   (c) entering the sky leaves the time strip alone (the sky's moment is its own)
//   (d) a sky card's reading and Jung's portrait carry their credit
//   (e) every quotation on a page carries its cite (work · locator · page); no notice stands beside a scanned one
//   (f) the Book of Symbols reading links to its related symbols, and a link goes there
//   (g) the dynamical route walks in its curated order (the arrow keys visit all sixteen stops as the data lists them)
//   npx vite --port 5293 --strictPort &
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5293/ node tests/ui/e2e/guards-g2.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open, revealSheet } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const data = (f) => JSON.parse(readFileSync(path.join(ROOT, 'public/data', f), 'utf8'));
const history = data('history.json');
const route = data('dynamics-route.json');

let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** The time model's state, as the strip shows it. */
const clock = (page) => page.evaluate(() => {
  const t = window.__earth.time;
  return { mode: t.mode, cursorU: t.cursorU, trail: t.trailTarget, cumulative: t.cumulative, fromU: t.fromU, toU: t.toU, year: window.__earth.model.scale.fromU(t.cursorU) };
});
const sameClock = (a, b) => ['mode', 'cursorU', 'trail', 'cumulative', 'fromU', 'toU'].every((k) => a[k] === b[k]);
const park = (page, year) => page.evaluate((y) => { const { time, model } = window.__earth; time.pause(); time.scrub(model.scale.toU(y)); }, year);

const browser = await launch('chromium', { headed: false });
try {
  // ── (a) the filter survives a lens change ──
  {
    const { ctx, page, logs } = await open(browser, { hash: '#/?w=cw12' });
    await page.waitForTimeout(2500);
    const read = () => page.evaluate(() => {
      const c = window.__earth.ctl;
      return { filter: c.filter, masked: !!c.filterMask, filteredBody: document.body.classList.contains('filtered'), hash: location.hash, lens: c.state.lens?.id ?? (c.state.dynamics ? 'theory' : c.state.history ? 'aion' : c.state.redbook ? 'redbook' : 'field') };
    });
    let s = await read();
    check(s.filter?.works?.length === 1 && s.filter.works[0] === 'cw12' && s.masked && s.filteredBody, 'the filter from the address is on in the Field', JSON.stringify(s.filter));
    for (const [lens, arrived] of [['theory', (x) => x.lens === 'theory'], ['aion', (x) => x.lens === 'aion'], ['redbook', (x) => x.lens === 'redbook'], ['field', (x) => x.lens === 'field']]) {
      await page.click('.sh-lens');
      await page.click(`.shell-menu .sm-row[data-lens="${lens}"]`);
      await page.waitForTimeout(2500);
      s = await read();
      check(arrived(s), `the ${lens} lens is open`, `lens ${s.lens}, hash ${s.hash}`);
      check(JSON.stringify(s.filter) === JSON.stringify({ works: ['cw12'] }) && s.masked && s.filteredBody, `…and the filter is the same one (not dropped, not rewritten)`, JSON.stringify(s.filter));
      check(/[?&]w=cw12(&|$)/.test(s.hash), `…and the address still carries it`, s.hash);
    }
    check(logs.length === 0, '(a) no page errors', logs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── (b) Aion: a chapter walk leaves the clock alone, a thread walk moves it ──
  {
    const reading = history.readings[0];
    const thread = reading.threads[1];
    const firstYear = reading.events.find((e) => e.id === thread.eventIds[0]).year;
    const secondYear = reading.events.find((e) => e.id === thread.eventIds[1]).year;
    const { ctx, page, logs } = await open(browser, { hash: `#/aion/${reading.id}` });
    await page.waitForTimeout(6000);
    await park(page, 1500);
    await page.waitForTimeout(400);
    const before = await clock(page);
    await page.locator('.mode-options > summary').click();
    await page.locator('.mode-options-body button', { hasText: 'Read the book' }).click();
    await page.waitForTimeout(2500);
    check(/\/chapter\/foreword$/.test(page.url()), 'the book opens at the Foreword', page.url());
    for (let i = 0; i < 3; i++) { await page.locator('[aria-label="Next chapter"]').click(); await page.waitForTimeout(600); }
    await page.waitForTimeout(1500);
    const afterChapters = await clock(page);
    check(/\/chapter\/ch-3$/.test(page.url()) && sameClock(before, afterChapters), 'three chapters on, the clock has not moved', `year ${before.year} → ${afterChapters.year}`);

    // (the book's walk has no Options of its own: the address is the way to a thread, as a shared link would be)
    await page.evaluate((h) => { location.hash = h; }, `#/aion/${reading.id}/thread/${thread.id}`);
    await page.waitForTimeout(3500);
    const atThread = await clock(page);
    check(new RegExp(`/thread/${thread.id}$`).test(page.url()) && Math.abs(atThread.year - firstYear) < 1, 'a thread walk puts the clock on its first event', `year ${atThread.year} (event ${firstYear})`);
    await page.locator('[aria-label="Next historical event"]').click();
    await page.waitForTimeout(3000);
    const next = await clock(page);
    check(Math.abs(next.year - secondYear) < 1, 'and the next event moves it on', `year ${next.year} (event ${secondYear})`);
    check(logs.length === 0, '(b) no page errors', logs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── (c) entering the sky leaves the time strip alone ──
  for (const how of ['hash #/sky', 'the controller opens a planet']) {
    const { ctx, page, logs } = await open(browser, { hash: '#/' });
    await page.waitForTimeout(2500);
    await park(page, 1500);
    await page.waitForTimeout(400);
    const before = await clock(page);
    const stripBefore = await page.evaluate(() => ({ shown: !!document.querySelector('.time') && getComputedStyle(document.querySelector('.time')).display !== 'none', range: document.querySelector('.t-track')?.getAttribute('aria-valuenow') ?? null, readout: document.querySelector('.t-readout')?.textContent ?? '' }));
    if (how === 'hash #/sky') await page.evaluate(() => { location.hash = '#/sky'; });
    else await page.evaluate(() => window.__earth.ctl.openBody('mars'));
    await page.waitForFunction(() => window.__earth.ctl.state.sky && document.body.classList.contains('sky-on'), null, { timeout: 30000 });
    await page.waitForTimeout(4000);
    const after = await clock(page);
    const stripAfter = await page.evaluate(() => ({ shown: !!document.querySelector('.time') && getComputedStyle(document.querySelector('.time')).display !== 'none', range: document.querySelector('.t-track')?.getAttribute('aria-valuenow') ?? null, readout: document.querySelector('.t-readout')?.textContent ?? '' }));
    check(sameClock(before, after), `${how}: the clock is where it was`, `year ${before.year} → ${after.year}`);
    check(JSON.stringify(stripBefore) === JSON.stringify(stripAfter), `${how}: the strip shows the same readout and value`, JSON.stringify(stripAfter));
    check(logs.length === 0, `(c) ${how}: no page errors`, logs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── (d) credits: a sky card's reading, and Jung's portrait ──
  {
    const { ctx, page, logs } = await open(browser, { hash: '#/' });
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__earth.ctl.openBody('mars'));
    await page.waitForFunction(() => document.querySelectorAll('.po-card').length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.locator('.po-card').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.cr-plate .plate-credit').length > 0, null, { timeout: 15000 }).catch(() => {});
    const credit = await page.locator('.cr-plate .plate-credit').allTextContents();
    check(credit.length === 1 && /^Frieda Harris, The Thoth Tarot/.test(credit[0]) && /All rights reserved/.test(credit[0]), 'a sky card\'s reading shows the plate\'s credit and licence', credit.join(' | '));
    check((await page.locator('.cr-plate .plate-credit').first().getAttribute('title').catch(() => '') ?? '').length >= (credit[0] ?? '').length - 1, 'and carries the unclipped line as its title');
    check(logs.length === 0, '(d) card: no page errors', logs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, logs } = await open(browser, { hash: '#/astrology' });
    await page.waitForSelector('.as-portrait-credit', { state: 'attached', timeout: 20000 }).catch(() => {});
    await revealSheet(page, 'Astrology');
    await page.waitForSelector('.as-portrait-credit', { state: 'visible', timeout: 10000 }).catch(() => {});
    const credit = await page.locator('.as-portrait-credit').allTextContents();
    check(credit.length === 1 && credit[0] === 'Unknown author · Public domain', 'Jung\'s portrait in Astrology shows its credit and licence', credit.join(' | '));
    check(await page.locator('.as-portrait img').first().getAttribute('src') === data('astrology.json').people[0].portrait.src, 'and it is the curated portrait');
    check(logs.length === 0, '(d) portrait: no page errors', logs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── (e) every quotation draws its cite; nothing is said beside a scanned one ──
  {
    const { ctx, page, logs } = await open(browser, { hash: '#/th/psychoid/deep' });
    await page.waitForTimeout(3000);
    const quotes = await page.locator('blockquote.q:not(.q-ql)').count();
    const footers = await page.locator('blockquote.q:not(.q-ql) > .q-foot .q-cite').count();
    check(quotes >= 10 && footers === quotes, 'every quotation on the psychoid page has a cite', `${footers} of ${quotes}`);
    const first = await page.locator('blockquote.q:not(.q-ql) > .q-foot .q-cite').first().getAttribute('aria-label');
    check(/, (¶|pdf p)/.test(first ?? '') || /¶\d+/.test(first ?? ''), 'the cite names the work and the locator', first ?? '');
    const parts = await page.locator('blockquote.q:not(.q-ql) > .q-foot .q-cite').first().locator('span').allTextContents();
    check(parts.length >= 2 && parts[0].length > 3, 'drawn as work, locator, page', parts.join(' | '));
    check(await page.locator('.dp-scan').count() === 0 && !/damaged scan/i.test(await page.locator('.deep').first().innerText()), 'no notice of a damaged scan is shown');
    check(logs.length === 0, '(e) no page errors', logs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // the QL formulations stand on the number pages: chipped QL, with the published site's section
  {
    const { ctx, page, logs } = await open(browser, { hash: '#/a/four/deep' });
    await page.waitForSelector('blockquote.q.q-ql .q-voice', { timeout: 20000 }).catch(() => {});
    const chips = await page.locator('blockquote.q.q-ql .q-voice').allTextContents();
    const src = await page.locator('blockquote.q.q-ql .q-cite').first().textContent().catch(() => '');
    check(chips.length >= 1 && chips.every((c) => c === 'QL'), 'a QL formulation is chipped QL', chips.join(' | '));
    check(/^epi-logos\.org · §/.test(src ?? ''), 'and names the published site\'s section', src ?? '');
    check(logs.length === 0, '(e) QL: no page errors', logs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── (f) the Book of Symbols reading links to its related symbols ──
  {
    const entry = data('symbols.json').entries.find((e) => e.familyId === 'philosophers-egg');
    const { ctx, page, logs } = await open(browser, { hash: '#/f/philosophers-egg/deep' });
    await page.waitForSelector('.symbol-reading .symbol-links button', { timeout: 20000 }).catch(() => {});
    const names = await page.locator('.symbol-reading .symbol-links button').allTextContents();
    check(names.length === entry.resonances.length && names.length >= 4, 'the egg\'s Book of Symbols reading offers its related symbols', names.join(', '));
    if (names.length) await page.locator('.symbol-reading .symbol-links button').first().click();
    await page.waitForTimeout(2500);
    check(page.url().endsWith(`#/f/${entry.resonances[0]}`), 'the first link goes to that symbol', page.url());
    check(logs.length === 0, '(f) no page errors', logs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── (g) the dynamical route walks in its curated order ──
  {
    const ids = route.movements.flatMap((m) => m.stops.map((s) => s.id));
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 860, hash: `#/dynamics/s/${ids[0]}` });
    await page.waitForTimeout(6500);
    const seen = [];
    for (let i = 0; i < ids.length; i++) {
      seen.push(/\/s\/([^/]+)$/.exec(page.url())?.[1]);
      if (i < ids.length - 1) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1200); }
    }
    check(JSON.stringify(seen) === JSON.stringify(ids), 'the arrow key visits the sixteen stops in the curated order', seen.join(' > '));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1200);
    check(/\/s\/([^/]+)$/.exec(page.url())?.[1] === ids[0], 'and wraps from the last to the first');
    check(logs.filter((l) => !/getImageData/.test(l)).length === 0, '(g) no page errors', logs.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
