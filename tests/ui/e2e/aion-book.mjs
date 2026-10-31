// Aion, the book: the mode walks CW9ii chapter by chapter, the way the Red Book mode walks its folios. The book is a group of
// the pane's Contents; each chapter is read in the pane, quotes Jung from inside its own pages (the cite opens the corpus
// there), tunes the globe to what it names, links the readings' events that cite it, and the stepper, the rail and the arrows
// walk on; the address names the chapter.
//   EARTH_HEADLESS=1 node tests/ui/e2e/aion-book.mjs
import { launch, open } from './lib.mjs';

const PANE = 'section.deep:not(.passage):not(.you-sheet) .dp-article:not([hidden])';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const shots = process.env.SHOTS;

for (const [w, h, tag] of [[1280, 800, 'desk'], [390, 844, 'phone']]) {
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/aion/jung-aion', mobile: w < 500 });
  await page.waitForTimeout(7000);
  const trigger = page.locator('.sh-contents');
  check(await trigger.isVisible(), `${tag}: the Contents trigger is in the shell`);
  await trigger.click();
  await page.waitForTimeout(900);
  const book = page.locator('.dp-contents-pane .dp-sub', { hasText: 'Aion' });
  check(await book.count() >= 1, `${tag}: the Contents offer the book`);
  await page.locator('.dp-contents-pane li button', { hasText: /^Foreword/ }).first().click();
  await page.waitForTimeout(2500);
  check(/#\/aion\/jung-aion\/chapter\/foreword$/.test(page.url()), `${tag}: the book opens at the Foreword, and the address says so`, page.url());
  const quotes = page.locator(`${PANE} blockquote`);
  check(await quotes.count() >= 1, `${tag}: the chapter quotes Jung`, `${await quotes.count()} quotations`);
  // a desktop keeps the plate rail beside the pane; a phone's sheet covers it, and the pane's own stepper carries the walk
  if (w > 500) check(await page.locator('.aion .rb-rail').isVisible(), `${tag}: the walk rail sits over the timeline`);
  else check(await page.locator('.pane-foot [aria-label="Next chapter"]').isVisible() && !(await page.locator('.aion .rb-rail').isVisible()), `${tag}: the sheet's stepper carries the walk (the rail makes way)`);
  // walk to chapter VI
  for (let i = 0; i < 6; i++) { await page.locator('.pane-foot [aria-label="Next chapter"]').click(); await page.waitForTimeout(400); }
  await page.waitForTimeout(2000);
  const title = (await page.locator(`${PANE} .rv-name`).textContent()) ?? '';
  check(/Sign of the Fishes/.test(title), `${tag}: the arrows walk the chapters in Jung's order`, title);
  // presences the globe can show: an occurrence with no Earth place sits at relevance 1 in every scope (not drawn), so it is
  // not counted — and the whole field is what the model places, not a number written here
  const { drawn, placed } = await page.evaluate(() => { const t = window.__earth.engine.presences.relTarget ?? null; const loc = window.__earth.ctl.m.located; return { drawn: t ? Array.from(t).filter((v, i) => v >= 0.035 && loc[i]).length : null, placed: Array.from(loc).filter(Boolean).length }; });
  check(drawn !== null && drawn < placed * 0.6, `${tag}: the globe shows the chapter's own set`, `${drawn} drawn of ${placed}`);
  const events = page.locator('.aion-book-events button');
  check(await events.count() > 5, `${tag}: the readings' events that cite the chapter are linked`, `${await events.count()} events`);
  if (shots) await page.screenshot({ path: `${shots}/aion-book-${tag}.png` });
  const cite = page.locator(`${PANE} blockquote footer button`).first();
  if (await cite.count()) {
    await cite.click();
    await page.waitForTimeout(2500);
    const sheet = page.locator('section.deep.passage');
    check(await sheet.isVisible().catch(() => false), `${tag}: a cite opens its page in the corpus`);
    if (shots) await page.screenshot({ path: `${shots}/aion-book-${tag}-passage.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  }
  if (!(await events.first().isVisible())) await page.locator(`${PANE} details.aion-sources > summary`).last().click();
  await events.first().click();
  await page.waitForTimeout(2500);
  check(/\/event\//.test(page.url()), `${tag}: an event opens in its reading`, page.url());
  await page.goBack();
  await page.waitForTimeout(2500);
  if (w > 500) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1500);
    check(/chapter\/ch-7$/.test(page.url()), `${tag}: the arrow key walks on`, page.url());
  }
  check(!logs.length, `${tag}: no page errors`, logs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
