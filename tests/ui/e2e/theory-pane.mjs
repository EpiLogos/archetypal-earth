// Theory in the reading pane (H5, N14): one Contents for the mode (Jung's theory, the fourteen theoretics, the route), a pick opens
// its reading in the same pane, the fourteen theoretics are walked by the pane's stepper (past the last comes the first), closing
// a reading stays in the mode, and Theory and Dynamics lead into one another from the list. Desktop and phone.
//   EARTH_HEADLESS=1 node tests/ui/e2e/theory-pane.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const PANE = 'section.deep:not(.passage):not(.you-sheet)';
const hash = (page) => page.evaluate(() => location.hash);
const reading = (page) => page.evaluate(() => document.body.classList.contains('pane-reading'));
const engaged = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]').filter((e) => e.kind === 'open' && e.subject.type === 'theoretic').map((e) => e.subject.id));

for (const [w, h, tag] of [[1280, 800, 'desk'], [390, 844, 'phone']]) {
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/theory/self', mobile: w < 500 });
  await page.waitForTimeout(5000);
  // the mode opens with its reading held and no Open row among its Options: the Contents are its entry
  check(!(await reading(page)), `${tag}: the mode opens with nothing read`);
  check(await page.locator('.sh-contents').isVisible(), `${tag}: the Contents trigger stands in the mode's own place`);
  check((await page.locator('.sh-controls .mode-options-body button').filter({ hasText: /^Open Theory$/ }).count()) === 0, `${tag}: the Options carry no Open row`);
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(600);
  const theoretics = await page.locator('.dp-contents-pane li button').allTextContents();
  const names = await page.evaluate(() => window.__earth.model.field.theoretics.map((t) => t.name));
  check(names.length === 14 && names.every((n) => theoretics.some((t) => t.startsWith(n))), `${tag}: the fourteen theoretics are in the Contents (${names.length})`);
  check((await page.locator('.dp-contents-pane li button[aria-current="true"]').count()) === 1, `${tag}: the one it stands on is marked`);
  // Contents → a theoretic: its reading opens in the same pane, and the visitor's node notes it once
  await page.locator('.dp-contents-pane li button', { hasText: /^The Psychoid/ }).first().click();
  await page.waitForTimeout(1800);
  check(/#\/theory\/theoretics\/psychoid$/.test(await hash(page)) && await reading(page), `${tag}: a theoretic opens in the pane`, await hash(page));
  check((await page.locator(`${PANE} .dp-article .dp-title`).textContent()) === 'The Psychoid', `${tag}: the reading is the theoretic`);
  check((await page.locator('.pane-foot .pane-count').textContent()) === '1 / 14', `${tag}: the stepper stands at 1 / 14`);
  check(JSON.stringify(await engaged(page)) === '["psychoid"]', `${tag}: the engagement is recorded once`, JSON.stringify(await engaged(page)));
  // the walk: forward through the field's own order; back from the first comes the last
  await page.locator('.pane-foot [aria-label="Next theoretic"]').click();
  await page.waitForTimeout(1500);
  check(/theoretics\/archetype-as-such$/.test(await hash(page)) && (await page.locator('.pane-foot .pane-count').textContent()) === '2 / 14', `${tag}: the stepper walks on`, await hash(page));
  await page.locator('.pane-foot [aria-label="Previous theoretic"]').click();
  await page.locator('.pane-foot [aria-label="Previous theoretic"]').click();
  await page.waitForTimeout(1500);
  check(/theoretics\/transcendent-function$/.test(await hash(page)) && (await page.locator('.pane-foot .pane-count').textContent()) === '14 / 14', `${tag}: back past the first comes the fourteenth`, await hash(page));
  await page.locator('.pane-foot [aria-label="Next theoretic"]').click();
  await page.waitForTimeout(1500);
  check(/theoretics\/psychoid$/.test(await hash(page)), `${tag}: past the last comes the first`, await hash(page));
  // closing the reading stays in the mode; Escape does the same
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  check(!(await reading(page)) && /#\/theory\//.test(await hash(page)) && await page.locator('.sh-contents').isVisible(), `${tag}: Escape closes the reading and stays in the mode`, await hash(page));
  // asking again for the same reading brings it back (the Contents' marked entry)
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(500);
  await page.locator('.dp-contents-pane li button[aria-current="true"]').click();
  await page.waitForTimeout(1200);
  check(await reading(page), `${tag}: the entry the mode stands on shows its reading again`);
  // Theory → Dynamics from the same list
  if (w > 500) { await page.locator('.sh-contents').click(); } else { await page.locator(`${PANE} .pane-contents-tool`).click(); }
  await page.waitForTimeout(600);
  const route = await page.locator('.dp-contents-pane li button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()));
  const stopName = route.find((t) => /oscillation between poles/i.test(t));
  check(!!stopName, `${tag}: the route's stops are in the same Contents`, stopName ?? '');
  await page.locator('.dp-contents-pane li button', { hasText: stopName }).first().click();
  await page.waitForTimeout(2800);
  check(/#\/dynamics\/s\/alternating-current$/.test(await hash(page)) && await reading(page), `${tag}: a stop of the route opens in the pane`, await hash(page));
  // Dynamics → Jung's theory from the same list: the reading is shown at once
  if (w > 500) { await page.locator('.sh-contents').click(); } else { await page.locator(`${PANE} .pane-contents-tool`).click(); }
  await page.waitForTimeout(600);
  await page.locator('.dp-contents-pane li button', { hasText: /^Energy$/ }).first().click();
  await page.waitForTimeout(2800);
  check(/#\/theory\/energy$/.test(await hash(page)) && await reading(page), `${tag}: Jung's theory opens in the pane from the route`, await hash(page));
  check(!logs.length, `${tag}: no page errors`, logs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
