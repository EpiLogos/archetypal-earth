// Symbols in the reading pane (H5): the Contents (find a symbol, the images with the most instances, the dictionary's entries) are the
// lens's entry, a pick reads in the same pane, the look-up is a reading of its own, an image looked up is noted once as a `symbol`
// for the visitor's node, the lens has no sheet and no Options, and closing a reading stays in the mode. Desktop and phone.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5296/ node tests/ui/e2e/symbols-pane.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const hash = (page) => page.evaluate(() => location.hash);
const reading = (page) => page.evaluate(() => document.body.classList.contains('pane-reading'));
const symbolsNoted = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]').filter((e) => e.kind === 'symbol').map((e) => `${e.subject.type}:${e.subject.id}`));
const sheetShown = (page) => page.evaluate(() => !!document.querySelector('.lens-panel:not([hidden])'));

for (const [w, h, tag] of [[1280, 800, 'desk'], [390, 844, 'phone']]) {
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/symbols', mobile: w < 500 });
  await page.waitForSelector('.sh-contents', { timeout: 15000 });
  await page.waitForTimeout(2000);
  check(!(await reading(page)), `${tag}: the mode opens with nothing read`);
  check((await page.locator('details.mode-options').count()) === 0, `${tag}: the lens has no Options`);
  check(!(await sheetShown(page)), `${tag}: the lens has no sheet`);
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(600);
  const heads = await page.locator('.dp-contents-pane h3').allTextContents();
  check(heads.includes('Find') && heads.includes('Symbols') && heads.some((t) => /most instances/.test(t)), `${tag}: the Contents group the way in, the busiest images and the dictionary`, heads.join(' | '));
  const entries = await page.locator('.dp-contents-pane li button').count();
  check(entries > 40, `${tag}: the dictionary's entries are listed`, String(entries));
  // the way in is a reading of its own
  await page.locator('.dp-contents-pane li button', { hasText: /^Find a symbol$/ }).click();
  await page.waitForTimeout(1500);
  check(await reading(page) && (await page.locator('.dp-article input[type=search]').count()) === 1, `${tag}: Find a symbol reads in the pane, with the look-up`);
  await page.locator('.dp-article input[type=search]').fill('serpent');
  await page.waitForTimeout(500);
  check((await page.locator('.dp-article .sy-results button').count()) > 0, `${tag}: the look-up answers`);
  await page.locator('.dp-article .sy-results button').first().click();
  await page.waitForTimeout(1800);
  check(/^#\/symbols\/[^/]+$/.test(await hash(page)) && await reading(page), `${tag}: a symbol found opens in the pane`, await hash(page));
  const noted = await symbolsNoted(page);
  check(noted.length === 1 && noted[0].startsWith('family:'), `${tag}: the image looked up is noted once for the visitor's node`, JSON.stringify(noted));
  // a dictionary entry, from the Contents
  if (w > 500) await page.locator('.sh-contents').click(); else await page.locator('section.deep:not(.passage):not(.you-sheet) .pane-contents-tool').click();
  await page.waitForTimeout(500);
  await page.locator('.dp-contents-pane li button', { hasText: /^Rose$/ }).first().click();
  await page.waitForTimeout(1800);
  check(/^#\/symbols\/[^/]+$/.test(await hash(page)) && await reading(page), `${tag}: a dictionary entry (Rose) opens in the pane`, await hash(page));
  check((await symbolsNoted(page)).length === 2, `${tag}: the second image is noted`, JSON.stringify(await symbolsNoted(page)));
  check(!(await sheetShown(page)), `${tag}: still no sheet`);
  // closing a reading stays in the mode
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  check(!(await reading(page)) && /#\/symbols\//.test(await hash(page)) && await page.locator('.sh-contents').isVisible(), `${tag}: Escape closes the reading and stays in the mode`, await hash(page));
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(500);
  await page.locator('.dp-contents-pane li button[aria-current="true"]').first().click();
  await page.waitForTimeout(1200);
  check(await reading(page), `${tag}: the entry the mode stands on shows its reading again`);
  check(!logs.length, `${tag}: no page errors`, logs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
