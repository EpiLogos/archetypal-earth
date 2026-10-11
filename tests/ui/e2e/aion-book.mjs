// Aion, the book: the mode walks CW9ii chapter by chapter, the way the Red Book mode walks its folios. Each chapter
// quotes Jung from inside its own pages (the cite opens the corpus there), tunes the globe to what it names, links the
// readings' events that cite it, and the arrows walk on; the address names the chapter.
//   EARTH_HEADLESS=1 node tests/ui/e2e/aion-book.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const shots = process.env.SHOTS;

for (const [w, h, tag] of [[1280, 800, 'desk'], [390, 844, 'phone']]) {
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/aion/jung-aion', mobile: w < 500 });
  await page.waitForTimeout(7000);
  const toggle = page.locator('.aion-book-toggle');
  check(await toggle.isVisible(), `${tag}: the mode offers the book`);
  await toggle.click();
  await page.waitForTimeout(2500);
  check(/#\/aion\/jung-aion\/chapter\/foreword$/.test(page.url()), `${tag}: the book opens at the Foreword, and the address says so`, page.url());
  const quotes = page.locator('.aion-card blockquote');
  check(await quotes.count() >= 1, `${tag}: the chapter quotes Jung`, `${await quotes.count()} quotations`);
  // walk to chapter VI
  for (let i = 0; i < 6; i++) { await page.locator('[aria-label="Next chapter"]').click(); await page.waitForTimeout(400); }
  await page.waitForTimeout(2000);
  const title = (await page.locator('.aion-card .rv-name').textContent()) ?? '';
  check(/Sign of the Fishes/.test(title), `${tag}: the arrows walk the chapters in Jung's order`, title);
  const line = (await page.locator('.sh-scope').textContent().catch(() => '')) ?? '';
  check(/in Aion VI/.test(line), `${tag}: the globe shows the chapter's own set`, line);
  const events = page.locator('.aion-book-events button');
  check(await events.count() > 5, `${tag}: the readings' events that cite the chapter are linked`, `${await events.count()} events`);
  if (shots) await page.screenshot({ path: `${shots}/aion-book-${tag}.png` });
  const cite = page.locator('.aion-card blockquote footer button').first();
  if (await cite.count()) {
    await cite.click();
    await page.waitForTimeout(2500);
    const sheet = page.locator('section.deep.passage');
    check(await sheet.isVisible().catch(() => false), `${tag}: a cite opens its page in the corpus`);
    if (shots) await page.screenshot({ path: `${shots}/aion-book-${tag}-passage.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  }
  if (!(await events.first().isVisible())) await page.locator('.aion-card details.aion-sources > summary').last().click();
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
