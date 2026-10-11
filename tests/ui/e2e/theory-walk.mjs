// Theory, the QL walk: Number opens on the six positions; the walk stops at each, with the published site's words for
// the position and its number (marked QL), von Franz on the number and Jung on what the position names (each cite
// opening its page), the globe tuned to what the stop speaks of, and the way on.
//   EARTH_HEADLESS=1 node tests/ui/e2e/theory-walk.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const shots = process.env.SHOTS;

for (const [w, h, tag] of [[1280, 800, 'desk'], [390, 844, 'phone']]) {
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/theory/number', mobile: w < 500 });
  await page.waitForTimeout(6000);
  check(await page.getByText('One to six, beside #0 to #5').isVisible(), `${tag}: Number opens on the six positions`);
  const ql = await page.locator('.lq-ql .lq-cite').allTextContents();
  check(ql.length > 0 && ql.every((t) => /epi-logos\.org, § [IV]+/.test(t)), `${tag}: every QL formulation is the published site's, by section`, ql.slice(0, 3).join(' | '));
  await page.locator('.th-walk').first().click();
  await page.waitForTimeout(2500);
  check(/#\/theory\/number\/0$/.test(page.url()), `${tag}: the walk starts at #0`, page.url());
  const head = (await page.locator('.ql-head').textContent()) ?? '';
  check(/1\s*↔\s*#0/.test(head) && /Origin/.test(head), `${tag}: #0 holds the number one`, head);
  for (let i = 0; i < 3; i++) { await page.locator('[aria-label="Next position"]').click(); await page.waitForTimeout(700); }
  await page.waitForTimeout(2000);
  const head3 = (await page.locator('.ql-head').textContent()) ?? '';
  check(/4\s*↔\s*#3/.test(head3) && /State 10/.test(head3), `${tag}: the walk steps on in order`, head3);
  const text = (await page.locator('.lq').allTextContents()).join(' ');
  check(/symbol-making/.test(text) && /transcendent function/.test(text) && /quaternary structure/.test(text), `${tag}: the stop sets the site's words beside von Franz and Jung`);
  const line = (await page.locator('.sh-scope').textContent().catch(() => '')) ?? '';
  check(/in four at #3/.test(line), `${tag}: the globe shows the stop's own set`, line);
  if (shots) await page.screenshot({ path: `${shots}/theory-${tag}.png` });
  await page.locator('.th-walk').first().click();
  await page.waitForTimeout(2000);
  check(await page.locator('section.deep.passage').isVisible(), `${tag}: the deep dive opens the passage in the corpus`);
  if (shots) await page.screenshot({ path: `${shots}/theory-${tag}-passage.png` });
  check(!logs.length, `${tag}: no page errors`, logs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
