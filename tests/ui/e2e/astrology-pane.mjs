// Astrology in the reading pane (H5): the Contents (the charts, then the planets of the chart that is walked with the place each
// stands at) are the lens's entry, a chart opens its birth sky with no reading, a planet reads in the pane and its stepper walks the
// planets, the chart cast is noted once as a `chart` for the visitor's node, the lens has no sheet and no Options (the names the sky
// is read in answer the View's ⚙), and closing a reading stays in the mode. Desktop and phone.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5296/ node tests/ui/e2e/astrology-pane.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const hash = (page) => page.evaluate(() => location.hash);
const reading = (page) => page.evaluate(() => document.body.classList.contains('pane-reading'));
const sheetShown = (page) => page.evaluate(() => !!document.querySelector('.lens-panel:not([hidden])'));
const count = (page) => page.locator('.pane-foot .pane-count').textContent();
const charted = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]').filter((e) => e.kind === 'chart').map((e) => `${e.subject.type}:${e.subject.id}`));
const openContents = async (page, phone) => {
  if (phone && await reading(page)) await page.locator('section.deep:not(.passage):not(.you-sheet) .pane-contents-tool').click();
  else await page.locator('.sh-contents').click();
  await page.waitForTimeout(600);
};

for (const [w, h, tag] of [[1280, 800, 'desk'], [390, 844, 'phone']]) {
  const phone = w < 500;
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/astrology', mobile: phone });
  await page.waitForSelector('.sh-contents', { timeout: 15000 });
  await page.waitForTimeout(2500);
  check(!(await reading(page)), `${tag}: the mode opens with nothing read`);
  check((await page.locator('details.mode-options').count()) === 0, `${tag}: the lens has no Options`);
  check(!(await sheetShown(page)), `${tag}: the lens has no sheet`);
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(600);
  const heads = await page.locator('.dp-contents-pane h3').allTextContents();
  check(heads.includes('Charts') && heads.some((t) => /planets$/.test(t)), `${tag}: the Contents group the charts and the planets of the chart walked`, heads.join(' | '));
  const planets = await page.locator('.dp-contents-pane li', { hasText: /^Moon/ }).first().textContent();
  check(/\d+°/.test(planets ?? ''), `${tag}: a planet is listed with the place it stands at`, (planets ?? '').trim());
  // the charts entry is the way to cast one; the cast is noted once for the visitor's node
  await page.locator('.dp-contents-pane li button', { hasText: /^Charts/ }).first().click();
  await page.waitForSelector('.as-form', { timeout: 15000 });
  await page.fill('.as-form input[type=date]', '1990-04-01');
  await page.fill('.as-form input[type=time]', '08:30');
  await page.click('.as-form details summary');
  await page.fill('.as-form input[placeholder^="Latitude"]', '47.37');
  await page.fill('.as-form input[placeholder^="Longitude"]', '8.54');
  await page.fill('.as-form input[type=number][step="0.25"]', '2');
  await page.click('.as-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/astrology/you', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  check((await hash(page)) === '#/astrology/you', `${tag}: casting lands on the birth sky`, await hash(page));
  check(!(await reading(page)), `${tag}: the birth sky is the thing, with no reading over it`);
  const noted = await charted(page);
  check(noted.length === 1 && noted[0] === 'chart:you', `${tag}: the chart cast is noted once for the visitor's node`, JSON.stringify(noted));
  // the planets walk in the pane
  await openContents(page, phone);
  await page.locator('.dp-contents-pane li button', { hasText: /^Moon/ }).first().click();
  await page.waitForFunction(() => location.hash === '#/astrology/you/moon', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1800);
  check((await hash(page)) === '#/astrology/you/moon' && await reading(page), `${tag}: a planet reads in the pane`, await hash(page));
  const first = await count(page);
  check(/^1 \/ \d+$/.test(first), `${tag}: the stepper stands at the first planet`, first);
  await page.locator('.pane-foot [aria-label="Next planet"]').click();
  await page.waitForTimeout(1500);
  check(/^2 \/ \d+$/.test(await count(page)) && /#\/astrology\/you\/[a-z]+$/.test(await hash(page)) && (await hash(page)) !== '#/astrology/you/moon', `${tag}: the stepper walks to the next planet`, `${await count(page)} ${await hash(page)}`);
  check(await page.locator('.pane-foot [aria-label="Previous planet"]').isEnabled(), `${tag}: and back is open once past the first`);
  // the stepper names its neighbours: ‹ previous · n / N · next ›, shortened to fit (further on a phone)
  const step = await page.evaluate(() => ({
    prev: document.querySelector('.pane-step-name.prev')?.textContent ?? '', next: document.querySelector('.pane-step-name.next')?.textContent ?? '',
    wide: Math.max(0, ...[...document.querySelectorAll('.pane-step-name')].map((x) => x.getBoundingClientRect().width)),
    over: (() => { const f = document.querySelector('.pane-foot'); return !f || f.scrollWidth > f.clientWidth + 1; })(),
  }));
  check(step.prev === 'Moon' && step.next === 'Venus', `${tag}: the stepper names the planets either side`, `‹ ${step.prev} · 2 / 10 · ${step.next} ›`);
  check(!step.over && step.wide <= (phone ? 100 : 170), `${tag}: and the names fit the foot`, `widest ${Math.round(step.wide)}px`);
  // closing a reading stays in the mode
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  check(!(await reading(page)) && /^#\/astrology/.test(await hash(page)) && await page.locator('.sh-contents').isVisible(), `${tag}: Escape closes the reading and stays in the mode`, await hash(page));
  // the names the sky is read in answer the View's ⚙ (on a phone too), not an Options disclosure; Escape takes the settings down first
  await page.locator('.vc-gear').click();
  await page.waitForTimeout(400);
  const pop = page.locator('.settings-pop');
  check(await pop.isVisible() && (await pop.textContent() ?? '').includes('Greco-Roman'), `${tag}: the ⚙ opens the names the sky is read in`);
  const gear = await page.locator('.vc-gear').boundingBox();
  check(gear.width >= (phone ? 44 : 30) && gear.height >= (phone ? 44 : 30), `${tag}: the ⚙ is a target of a fit size`, `${Math.round(gear.width)}×${Math.round(gear.height)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(!(await pop.isVisible()) && /^#\/astrology/.test(await hash(page)), `${tag}: Escape closes the settings and stays in the mode`, await hash(page));
  // closing the walk's reading puts the visitor on the birth sky, and a planet reads again from the Contents
  check((await hash(page)) === '#/astrology/you', `${tag}: closing a planet's reading stands on the birth sky`, await hash(page));
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(500);
  check((await page.locator('.dp-contents-pane li button[aria-current="true"]').first().textContent()) === 'Your sky', `${tag}: the Contents stand on the chart`);
  await page.locator('.dp-contents-pane li button', { hasText: /^Venus/ }).first().click();
  await page.waitForTimeout(1500);
  check(await reading(page) && /\/venus$/.test(await hash(page)), `${tag}: a planet reads again from the Contents`, await hash(page));
  check(!logs.length, `${tag}: no page errors`, logs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
