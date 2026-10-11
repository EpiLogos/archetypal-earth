// The Astrology form's place picker: typing opens a suggestion list; a keyboard Enter (desktop) or a tap (phone)
// chooses a city, fills its coordinates, and the chart casts. An unknown name says so and leaves the coordinates empty.
//   EARTH_HEADLESS=1 node tests/ui/e2e/city-picker.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const browser = await launch('chromium');
for (const s of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const { ctx, page, logs } = await open(browser, { width: s.width, height: s.height, mobile: s.mobile, hash: '#/astrology' });
  await page.waitForSelector('.as-form', { timeout: 90000 });
  const place = page.locator('.as-form input[role=combobox]');
  check(await place.count() === 1, `${s.name}: the place field is a combobox`);
  check(await page.locator('.as-form datalist').count() === 0, `${s.name}: no native datalist is left`);

  await place.click();
  await place.pressSequentially('zur', { delay: 40 });
  const list = page.locator('.as-form .cbx-list');
  await list.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const opts = await page.locator('.as-form .cbx-opt').allTextContents();
  check(opts.some((t) => t.startsWith('Zürich, Switzerland')), `${s.name}: typing "zur" offers Zürich`, opts.join(' | '));
  const box = await page.locator('.as-form .cbx-opt').first().boundingBox();
  check(!!box && box.height >= 43.5, `${s.name}: an option is a 44px target`, box ? `${Math.round(box.height)}px` : 'none');

  if (s.mobile) await page.locator('.as-form .cbx-opt', { hasText: 'Zürich' }).tap();
  else { await place.press('ArrowDown'); await place.press('Enter'); }
  const lat = await page.inputValue('.as-form input[placeholder^="Latitude"]');
  const lon = await page.inputValue('.as-form input[placeholder^="Longitude"]');
  check(await place.inputValue() === 'Zürich, Switzerland' && Math.abs(Number(lat) - 47.37) < 0.1 && Math.abs(Number(lon) - 8.54) < 0.1,
    `${s.name}: choosing fills the place and its coordinates`, `${await place.inputValue()} ${lat} ${lon}`);
  check(await list.isHidden(), `${s.name}: the list closes once a city is chosen`);

  // an edit after the choice drops the stale coordinates (unless they were typed by hand)
  await place.fill('Atlantis');
  const empty = await page.locator('.as-form .cbx-empty').textContent().catch(() => '');
  check(/No city by that name/.test(empty ?? ''), `${s.name}: an unknown name says so`, empty ?? '');
  check(await page.inputValue('.as-form input[placeholder^="Latitude"]') === '', `${s.name}: and its coordinates are not the last city's`);
  await place.press('Escape');

  await place.fill('');
  await place.pressSequentially('Zür', { delay: 40 });
  if (s.mobile) await page.locator('.as-form .cbx-opt', { hasText: 'Zürich' }).tap(); else await place.press('Enter');
  await page.fill('.as-form input[type=date]', '1990-04-01');
  await page.fill('.as-form input[type=time]', '08:30');
  await page.locator('.as-form button[type=submit]').click();
  await page.waitForFunction(() => location.hash.startsWith('#/astrology/you'), null, { timeout: 30000 }).catch(() => {});
  check((await page.evaluate(() => location.hash)).startsWith('#/astrology/you'), `${s.name}: the chart casts from a chosen city`, await page.evaluate(() => location.hash));
  check(!logs.length, `${s.name}: no page errors`, logs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
