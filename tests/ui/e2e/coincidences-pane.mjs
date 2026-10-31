// Coincidences in the reading pane (H5): the Contents (your log, the recorder, then the visitor's own entries, newest first) are the
// lens's entry; an entry is logged and read in the same pane; the entry is noted as a `coincidence` for the visitor's node; two
// entries with one image draw a series; closing a reading stays in the mode; and nothing the visitor wrote leaves the browser.
// Desktop and phone.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5296/ node tests/ui/e2e/coincidences-pane.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const hash = (page) => page.evaluate(() => location.hash);
const reading = (page) => page.evaluate(() => document.body.classList.contains('pane-reading'));
const sheetShown = (page) => page.evaluate(() => !!document.querySelector('.lens-panel:not([hidden])'));
const logOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]'));
const WORDS = ['kingfisher', 'telegram', 'harbour'];

for (const [w, h, tag] of [[1280, 800, 'desk'], [390, 844, 'phone']]) {
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/coincidences', mobile: w < 500 });
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' }));
  await page.waitForSelector('.sh-contents', { timeout: 15000 });
  await page.waitForTimeout(2000);
  const before = requests.length;
  check(!(await reading(page)), `${tag}: the mode opens with nothing read`);
  check((await page.locator('details.mode-options').count()) === 0 && !(await sheetShown(page)), `${tag}: the lens has no Options and no sheet`);
  const openContents = async () => {
    if (w > 500) await page.locator('.sh-contents').click(); else await page.locator('section.deep:not(.passage):not(.you-sheet) .pane-contents-tool').click();
    await page.waitForTimeout(500);
  };
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(600);
  const heads = await page.locator('.dp-contents-pane h3').allTextContents();
  check(heads.length === 1 && heads[0] === 'Coincidences', `${tag}: with nothing logged the Contents hold the log and the recorder only`, heads.join(' | '));
  const logOne = async (inner, outer, fromContents) => {
    if (fromContents) await openContents();
    await page.locator('.dp-contents-pane li button', { hasText: /^Log a coincidence$/ }).click();
    await page.waitForSelector('.dp-article .dr-form', { timeout: 10000 });
    await page.fill('.dp-article .dr-form textarea >> nth=0', inner);
    await page.fill('.dp-article .dr-form textarea >> nth=1', outer);
    await page.fill('.dp-article .dr-form input[type=text]', 'kingfisher');
    await page.waitForTimeout(300);
    await page.click('.dp-article .dr-form button[type=submit]');
    await page.waitForTimeout(900);
  };
  await logOne('A telegram in a dream, from someone I had not thought of', 'The harbour master wrote that same week', false);
  check(/^#\/coincidences\/[0-9a-f-]{36}$/.test(await hash(page)) && await reading(page), `${tag}: an entry is named by a random id alone and read in the pane`, await hash(page));
  await logOne('A kingfisher on the bank in a half-dream', 'A kingfisher over the harbour wall', true);
  const noted = (await logOf(page)).filter((e) => e.kind === 'coincidence');
  check(noted.length === 2 && noted.every((e) => e.subject.type === 'coincidence'), `${tag}: each entry is noted for the visitor's node`, JSON.stringify(noted.map((e) => e.subject.type)));
  await openContents();
  const heads2 = await page.locator('.dp-contents-pane h3').allTextContents();
  check(heads2.includes('Your entries'), `${tag}: the entries join the Contents`, heads2.join(' | '));
  await page.locator('.dp-contents-pane li button', { hasText: /^Your log$/ }).click();
  await page.waitForSelector('.dp-article .co-chart', { timeout: 10000 });
  const co = await page.evaluate(() => ({ dots: document.querySelectorAll('.dp-article .co-dot').length, runs: document.querySelectorAll('.dp-article .co-run').length }));
  check(co.dots === 2 && co.runs === 1, `${tag}: two entries with one image draw a series`, JSON.stringify(co));
  await page.locator('.dp-article .co-dot').first().dispatchEvent('click');
  await page.waitForTimeout(900);
  check(/^#\/coincidences\/[0-9a-f-]{36}$/.test(await hash(page)) && await reading(page), `${tag}: a mark on the chart opens its entry in the pane`, await hash(page));
  // privacy
  const everywhere = JSON.stringify({ hash: await hash(page), log: await logOf(page) }).toLowerCase();
  check(!WORDS.some((x) => everywhere.includes(x)), `${tag}: no word of an entry is in the URL or the engagement log`);
  const after = requests.slice(before);
  const leaks = after.filter((r) => WORDS.some((x) => r.url.toLowerCase().includes(x) || r.body.toLowerCase().includes(x)));
  const writes = after.filter((r) => r.method !== 'GET');
  check(!leaks.length && !writes.length, `${tag}: nothing written left the browser`, `${after.length} requests, ${leaks.length} carrying entries, ${writes.length} not GET`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  check(!(await reading(page)) && /#\/coincidences\//.test(await hash(page)) && await page.locator('.sh-contents').isVisible(), `${tag}: Escape closes the reading and stays in the mode`, await hash(page));
  check(!logs.length, `${tag}: no page errors`, logs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
