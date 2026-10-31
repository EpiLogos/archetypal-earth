// Alchemy in the reading pane (H5, S9): the Contents (the opus, its stages, the operations, the matter, the elements) are the lens's
// entry, a pick reads in the same pane, the four stages are walked by the pane's stepper on the one runner (past the last comes the
// first), the stage opened is noted once for the visitor's node, and closing a reading stays in the mode. Desktop and phone.
//   EARTH_HEADLESS=1 node tests/ui/e2e/alchemy-pane.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const PANE = 'section.deep:not(.passage):not(.you-sheet)';
const hash = (page) => page.evaluate(() => location.hash);
const reading = (page) => page.evaluate(() => document.body.classList.contains('pane-reading'));
const count = (page) => page.locator('.pane-foot .pane-count').textContent();
const engaged = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]').filter((e) => e.kind === 'open' && e.subject.type === 'family').map((e) => e.subject.id));

for (const [w, h, tag] of [[1280, 800, 'desk'], [390, 844, 'phone']]) {
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/alchemy', mobile: w < 500 });
  await page.waitForSelector('.sh-contents', { timeout: 15000 });
  await page.waitForTimeout(2500);
  check(!(await reading(page)), `${tag}: the mode opens with nothing read`);
  check((await page.locator('.sh-controls .mode-options-body button').filter({ hasText: /^(Open|Close) Alchemy$/ }).count()) === 0, `${tag}: the Options carry no Open row`);
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(600);
  await page.locator('.dp-contents-pane li button', { hasText: /^Albedo/ }).first().click();
  await page.waitForTimeout(1800);
  check(/#\/alchemy\/opus\/albedo$/.test(await hash(page)) && await reading(page), `${tag}: a stage opens in the pane`, await hash(page));
  check((await count(page)) === '2 / 4', `${tag}: the stepper stands at 2 / 4`, await count(page));
  const fam = await engaged(page);
  check(fam.length === 1, `${tag}: the stage's form is noted once for the visitor's node`, JSON.stringify(fam));
  await page.locator('.pane-foot [aria-label="Next stage"]').click();
  await page.waitForTimeout(1200);
  await page.locator('.pane-foot [aria-label="Next stage"]').click();
  await page.waitForTimeout(1200);
  check(/opus\/rubedo$/.test(await hash(page)) && (await count(page)) === '4 / 4', `${tag}: the stepper walks the opus in order`, await hash(page));
  await page.locator('.pane-foot [aria-label="Next stage"]').click();
  await page.waitForTimeout(1200);
  check(/opus\/nigredo$/.test(await hash(page)) && (await count(page)) === '1 / 4', `${tag}: past the last stage comes the first`, await hash(page));
  await page.locator('.pane-foot [aria-label="Previous stage"]').click();
  await page.waitForTimeout(1200);
  check(/opus\/rubedo$/.test(await hash(page)), `${tag}: back from the first comes the last`, await hash(page));
  // an operation, from the same list; its own stepper counts the operations
  if (w > 500) await page.locator('.sh-contents').click(); else await page.locator(`${PANE} .pane-contents-tool`).click();
  await page.waitForTimeout(500);
  await page.locator('.dp-contents-pane li button', { hasText: /^Solutio/ }).first().click();
  await page.waitForTimeout(1500);
  check(/#\/alchemy\/operations\/solutio$/.test(await hash(page)) && await reading(page), `${tag}: an operation opens in the pane`, await hash(page));
  check(/^\d+ \/ \d+$/.test(await count(page)), `${tag}: the operations have their own stepper`, await count(page));
  // closing a reading stays in the mode
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  check(!(await reading(page)) && /#\/alchemy\//.test(await hash(page)) && await page.locator('.sh-contents').isVisible(), `${tag}: Escape closes the reading and stays in the mode`, await hash(page));
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(500);
  await page.locator('.dp-contents-pane li button[aria-current="true"]').click();
  await page.waitForTimeout(1200);
  check(await reading(page), `${tag}: the entry the mode stands on shows its reading again`);
  check(!logs.length, `${tag}: no page errors`, logs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
