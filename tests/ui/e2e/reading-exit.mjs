// Leaving a reading lands back where it began. A reading opened on a walk's step (a thumbnail's double-click, a
// presence on the walk) used to close onto the step's card, one more step from the walk; a click outside it picked
// through to the globe and lost the walk. Now the close button, Escape and a click outside all return to the thread
// view at the same step, and a click outside a passage opened from the reading closes both.
//   EARTH_HEADLESS=1 node tests/ui/e2e/reading-exit.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const browser = await launch('chromium');
const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash: '#/t/f/serpent' });
await page.waitForTimeout(8000);
const st = () => page.evaluate(() => { const c = window.__earth.ctl, s = c.state; return { hash: location.hash, view: s.view.kind, deep: s.deep, step: c.tour?.i ?? null, passage: !!document.querySelector('.ps-text') && getComputedStyle(document.querySelector('.ps-text').closest('[class]')).display !== 'none' }; });
const start = await st();
check(start.view === 'thread', 'the walk stands', start.hash);

const openReading = async () => { await page.evaluate(() => window.__earth.ctl.tourRead(3)); await page.waitForTimeout(3500); return st(); };
for (const how of ['the close button', 'Escape', 'a click outside']) {
  const r = await openReading();
  check(r.view === 'manifest' && r.deep, `a step's reading opens (${how})`, r.hash);
  if (how === 'the close button') await page.locator('.dp-close:visible').first().click();
  else if (how === 'Escape') await page.keyboard.press('Escape');
  else await page.mouse.click(300, 450);
  await page.waitForTimeout(3500);
  const a = await st();
  check(a.view === 'thread' && !a.deep && a.step === 3, `${how} lands back in the walk at the same step`, `${a.hash} step ${a.step}`);
}

// a passage opened from the reading: a click outside closes the passage and the reading together
await openReading();
const cite = page.locator('.dp-cite-link:visible').first();
if (await cite.count()) {
  await cite.click();
  await page.waitForTimeout(2500);
  const p = await page.evaluate(() => window.__earth.ctl.passage?.isOpen ?? null);
  check(p === true, 'a cite in the reading opens its passage');
  await page.mouse.click(300, 450);
  await page.waitForTimeout(3500);
  const a = await st();
  const still = await page.evaluate(() => window.__earth.ctl.passage?.isOpen ?? null);
  check(a.view === 'thread' && !a.deep && !still, 'a click outside the passage lands back in the walk', `${a.hash}, passage ${still ? 'open' : 'closed'}`);
} else check(false, 'the reading carries a passage link to test');

check(!logs.length, 'no page errors', logs.slice(0, 2).join(' | '));
await ctx.close();
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
