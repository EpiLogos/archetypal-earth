// N19c: the visitor's own page. What is kept (chart, dreams, coincidences, each with its latest lines and a door to its lens)
// and the trail: the plain list of what has been recorded, a line at a time to forget, a switch that stops the recording and a
// button that clears the list. Nothing personal reaches the address or the page's data.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/you-walk.mjs
import { launch, open } from './lib.mjs';

const results = [];
const check = (ok, what, detail = '') => { results.push(ok); console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` — ${detail}` : ''}`); };
const b = await launch('chromium');
const ready = async (page) => { await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 }); await page.waitForTimeout(800); };
const now = '2026-10-01T00:00:00Z';

for (const size of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const tag = size.name;
  const { ctx, page, logs } = await open(b, { ...size, hash: '#/' });
  await page.evaluate((now) => {
    localStorage.setItem('aae.practice.v1.dreams', JSON.stringify([
      { id: 'd1', title: 'A serpent in a well', text: 'x', date: '2026-10-01', createdAt: now, updatedAt: now },
      { id: 'd2', title: 'The tower at dusk', text: 'y', date: '2026-10-03', createdAt: now, updatedAt: now },
    ]));
    localStorage.setItem('aae.practice.v1.coincidences', JSON.stringify([{ id: 'c1', date: '2026-10-02', inner: 'i', outer: 'o', symbol: 'a white bird', familyId: null, note: '', createdAt: now, updatedAt: now }]));
    localStorage.setItem('aae.practice.v1.charts', JSON.stringify([{ id: 'you', label: 'You', birth: { date: '1990-05-17', time: '08:30', offsetMinutes: 60, lat: 51.5, lon: -0.12, place: 'London' }, createdAt: now, updatedAt: now }]));
  }, now);
  await page.goto(page.url().replace(/#.*$/, '') + '#/texts/cw12/2', { waitUntil: 'load' });
  await ready(page);

  const openYou = async () => {
    await page.keyboard.press('/');
    await page.fill('.s-input', 'you');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.you-sheet.on', { timeout: 8000 });
  };
  await openYou();
  const kept = (lens) => page.$$eval(`.you-sheet [data-kept="${lens}"] .you-row .you-text`, (e) => e.map((x) => x.textContent));
  const door = (lens) => page.$eval(`.you-sheet [data-kept="${lens}"] li button`, (e) => e.textContent).catch(() => null);
  check((await kept('astrology'))[0] === 'You · London', `${tag}: your chart is on the page`, JSON.stringify(await kept('astrology')));
  check((await door('astrology')) === 'Open the chart', `${tag}: with its door`, String(await door('astrology')));
  const dr = await kept('dreams');
  check(dr[0] === 'The tower at dusk' && dr[1] === 'A serpent in a well', `${tag}: your dreams, the latest first`, dr.join(' | '));
  check((await kept('coincidences'))[0] === 'a white bird', `${tag}: your coincidences`, JSON.stringify(await kept('coincidences')));

  // the trail: opening the work was recorded; each line can be forgotten
  const rows = () => page.$$eval('.you-sheet .you-log li', (e) => e.map((x) => x.textContent.replace(/×$/, '')));
  const trail = await rows();
  check(trail.length >= 1 && /Opened/.test(trail[0]) && /Psychology and Alchemy/.test(trail[0]), `${tag}: opening the work is a line of the trail`, trail.join(' | '));
  const n0 = trail.length;
  await page.click('.you-sheet .you-forget');
  await page.waitForTimeout(300);
  check((await rows()).length === n0 - 1, `${tag}: a line is forgotten one at a time`, `${n0} → ${(await rows()).length}`);

  // the switch stops the recording; clearing empties the list
  await page.click('.you-sheet .you-acts button:first-child');
  await page.waitForTimeout(300);
  check(/Recording is off/.test(await page.$eval('.you-sheet .you-note', (e) => e.textContent)), `${tag}: Stop recording says so`);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.settings') ?? '[]').some((s) => s.id === 'recording' && s.on === false)), `${tag}: the switch is kept`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await page.goto(page.url().replace(/#.*$/, '') + '#/texts/cw11', { waitUntil: 'load' });
  await ready(page);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]').length);
  check(after === n0 - 1, `${tag}: with the switch off, opening another work records nothing`, `${after} vs ${n0 - 1}`);
  await openYou();
  await page.click('.you-sheet .you-acts button:first-child'); // Record again
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await page.goto(page.url().replace(/#.*$/, '') + '#/texts/cw12', { waitUntil: 'load' });
  await ready(page);
  await openYou();
  check((await rows()).length === 1, `${tag}: recording again notes the next work`, (await rows()).join(' | '));
  await page.click('.you-sheet .you-acts button:nth-child(2)'); // Clear the list
  await page.waitForTimeout(300);
  check((await rows()).length === 0 && /Nothing recorded yet/.test(await page.$eval('.you-sheet', (e) => e.textContent)), `${tag}: Clear the list empties it`);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.dreams') ?? '[]').length === 2), `${tag}: clearing the trail leaves the dreams`);

  // the doors open the practice lenses; the address names no record of yours
  const h = await page.evaluate(() => location.hash);
  check(!/serpent|tower|bird|London|1990|you/i.test(h), `${tag}: nothing of yours is in the address`, h);
  await page.click('.you-sheet [data-kept="dreams"] li button');
  await page.waitForTimeout(1500);
  check((await page.evaluate(() => document.body.dataset.lens)) === 'dreams' && !(await page.$('.you-sheet.on')), `${tag}: the door opens the Dreams lens and closes the page`);
  check(!logs.length, `${tag}: no console errors`, logs.slice(0, 3).join(' | '));
  await ctx.close();
}
await b.close();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} failure(s)` : '\nall checks passed');
process.exit(failed ? 1 : 0);
