// Theory in the reading pane (H5, N14): one Contents for the mode (Jung's theory, the fourteen theoretics, the route), a pick opens
// the theoretic's own walk in the same pane (the quotations of its page, one stop each, stepped by the pane's stepper; past the
// last comes the first), closing a reading stays in the mode, and Theory and Dynamics lead into one another from the list.
// Desktop and phone.
//   EARTH_HEADLESS=1 node tests/ui/e2e/theory-pane.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
// (the live-sky sidecar's probe of its own /now fails when no sidecar runs on this machine; that is the sky's, not the theory's)
const appLogs = (logs) => logs.filter((l) => !/\/now\b/.test(l));
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
  const walk = await page.evaluate(() => window.__earth.model.walkById.get('theoretic/psychoid').stops.map((st) => ({ title: st.section.title, year: st.year ?? null })));
  const n = walk.length;
  const count = () => page.locator('.pane-foot .pane-count').textContent();
  check(n > 14 && (await count()) === `1 / ${n}`, `${tag}: the stepper stands at 1 / ${n}, the stops of the psychoid's own walk, not 1 / 14`, await count());
  check(JSON.stringify(await engaged(page)) === '["psychoid"]', `${tag}: the engagement is recorded once`, JSON.stringify(await engaged(page)));
  const heading = () => page.locator(`${PANE} .dp-article h3.as-h3`).first().textContent();
  check((await heading()) === walk[0].title, `${tag}: the first stop is the section it opens (${walk[0].title})`, await heading());
  // the walk: forward through the page's own order, the engagement still once; back from the first comes the last
  await page.locator('.pane-foot [aria-label="Next passage"]').click();
  await page.waitForTimeout(1200);
  check(/theoretics\/psychoid\/1$/.test(await hash(page)) && (await count()) === `2 / ${n}`, `${tag}: the stepper walks on to the next passage`, await hash(page));
  check((await page.locator(`${PANE} blockquote.q`).count()) >= 1 && (await page.locator(`${PANE} .q-cite`).count()) >= 1, `${tag}: the stop shows Jung's passage with its cite`);
  check(JSON.stringify(await engaged(page)) === '["psychoid"]', `${tag}: stepping on through the walk is not another engagement`, JSON.stringify(await engaged(page)));
  await page.locator('.pane-foot [aria-label="Previous passage"]').click();
  await page.locator('.pane-foot [aria-label="Previous passage"]').click();
  await page.waitForTimeout(1200);
  check(new RegExp(`theoretics/psychoid/${n - 1}$`).test(await hash(page)) && (await count()) === `${n} / ${n}`, `${tag}: back past the first comes the last passage of the same walk`, await hash(page));
  await page.locator('.pane-foot [aria-label="Next passage"]').click();
  await page.waitForTimeout(1200);
  check(/theoretics\/psychoid\/0$/.test(await hash(page)) && (await count()) === `1 / ${n}`, `${tag}: past the last comes the first`, await hash(page));
  // the Contents leads with the theoretic's sections; a pick opens the walk at that section's first stop; moving to another theoretic is the Contents' too
  if (w > 500) { await page.locator('.sh-contents').click(); } else { await page.locator(`${PANE} .pane-contents-tool`).click(); }
  await page.waitForTimeout(600);
  const second = walk.findIndex((st, i) => i > 0 && st.title !== walk[i - 1].title);
  await page.locator('.dp-contents-pane li button', { hasText: new RegExp(`^${walk[second].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
  await page.waitForTimeout(1200);
  check(new RegExp(`theoretics/psychoid/${second}$`).test(await hash(page)), `${tag}: a section of the Contents opens the walk at its first stop`, await hash(page));
  if (w > 500) { await page.locator('.sh-contents').click(); } else { await page.locator(`${PANE} .pane-contents-tool`).click(); }
  await page.waitForTimeout(600);
  await page.locator('.dp-contents-pane li button', { hasText: /^The Archetype as Such/ }).first().click();
  await page.waitForTimeout(1500);
  check(/theoretics\/archetype-as-such(\/0)?$/.test(await hash(page)) && (await page.locator(`${PANE} .dp-article .dp-title`).textContent()) === 'The Archetype as Such', `${tag}: the Contents moves from one theoretic to the next`, await hash(page));
  // closing the reading stays in the mode; Escape does the same
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  check(!(await reading(page)) && /#\/theory\//.test(await hash(page)) && await page.locator('.sh-contents').isVisible(), `${tag}: Escape closes the reading and stays in the mode`, await hash(page));
  // asking again for the same reading brings it back (the Contents' marked entry)
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(500);
  await page.locator('.dp-contents-pane li button[aria-current="true"]').last().click();
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
  check(!appLogs(logs).length, `${tag}: no page errors`, appLogs(logs).slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
