// Dreams in the reading pane (H5): the Contents (the journal, the recorder, then the visitor's own dreams, newest first) are the lens's
// entry; a dream is recorded and read in the same pane; the recording is noted as a `dream` for the visitor's node; closing a reading
// stays in the mode. And the privacy of a dream, asserted: its words never reach the URL, the engagement log, a request or any
// file the page loads (every request is recorded and searched; none writes). Desktop and phone.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5296/ node tests/ui/e2e/dreams-pane.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const hash = (page) => page.evaluate(() => location.hash);
const reading = (page) => page.evaluate(() => document.body.classList.contains('pane-reading'));
const sheetShown = (page) => page.evaluate(() => !!document.querySelector('.lens-panel:not([hidden])'));
const logOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]'));
// words only the visitor's dream and answer carry
const WORDS = ['lantern', 'grandmother', 'orchard', 'marmalade'];
const DREAM = 'I carried a lantern through the orchard at night and my grandmother was waiting by a serpent.';
const LIFE = 'Packing up a house; I kept finding jars of marmalade.';

for (const [w, h, tag] of [[1280, 800, 'desk'], [390, 844, 'phone']]) {
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/dreams', mobile: w < 500 });
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' }));
  await page.waitForSelector('.sh-contents', { timeout: 15000 });
  await page.waitForTimeout(2000);
  const before = requests.length;
  check(!(await reading(page)), `${tag}: the mode opens with nothing read`);
  check((await page.locator('details.mode-options').count()) === 0 && !(await sheetShown(page)), `${tag}: the lens has no Options and no sheet`);
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(600);
  const heads = await page.locator('.dp-contents-pane h3').allTextContents();
  check(heads.length === 1 && heads[0] === 'Dreams', `${tag}: with no dream kept the Contents hold the journal and the recorder only`, heads.join(' | '));
  await page.locator('.dp-contents-pane li button', { hasText: /^Record a dream$/ }).click();
  await page.waitForTimeout(1500);
  check(await reading(page) && (await page.locator('.dp-article .dr-form').count()) === 1, `${tag}: the recorder reads in the pane`, await hash(page));
  await page.fill('.dp-article .dr-form textarea >> nth=0', DREAM);
  await page.fill('.dp-article .dr-form textarea >> nth=1', LIFE);
  await page.fill('.dp-article .dr-form input[type=text]', 'The orchard');
  await page.click('.dp-article .dr-form button[type=submit]');
  await page.waitForSelector('.dp-article .dr-text', { timeout: 15000 });
  await page.waitForTimeout(600);
  const h1 = await hash(page);
  check(/^#\/dreams\/[0-9a-f-]{36}$/.test(h1), `${tag}: a dream is named by a random id alone`, h1);
  const log = await logOf(page);
  const dreamLog = log.filter((e) => e.kind === 'dream');
  check(dreamLog.length === 1 && dreamLog[0].subject.type === 'dream', `${tag}: the dream is noted once for the visitor's node`, JSON.stringify(dreamLog));
  // its images open in the same pane
  const imgs = await page.locator('.dp-article .dr-img').allTextContents();
  check(imgs.includes('serpent'), `${tag}: the images the field knows are picked out`, imgs.join(', '));
  await page.locator('.dp-article .dr-img', { hasText: 'serpent' }).click();
  await page.waitForSelector('.dp-article .am-dream', { timeout: 15000 });
  check(/^#\/dreams\/[0-9a-f-]{36}\/serpent$/.test(await hash(page)) && await reading(page), `${tag}: an image opens its parallels in the pane`, await hash(page));
  // the Contents now list the dream
  if (w > 500) await page.locator('.sh-contents').click(); else await page.locator('section.deep:not(.passage):not(.you-sheet) .pane-contents-tool').click();
  await page.waitForTimeout(500);
  const heads2 = await page.locator('.dp-contents-pane h3').allTextContents();
  check(heads2.includes('Your dreams'), `${tag}: the dream joins the Contents under Your dreams`, heads2.join(' | '));
  await page.locator('.dp-contents-pane li button', { hasText: /^The orchard$/ }).click();
  await page.waitForTimeout(1200);
  check(h1 === (await hash(page)) && await reading(page), `${tag}: a pick from Your dreams reads that dream`, await hash(page));
  // privacy: the dream's words are in the page and in this browser's storage, and nowhere else
  const everywhere = JSON.stringify({ hash: await hash(page), log: await logOf(page) }).toLowerCase();
  check(!WORDS.some((x) => everywhere.includes(x)), `${tag}: no word of the dream is in the URL or the engagement log`);
  const after = requests.slice(before);
  const leaks = after.filter((r) => WORDS.some((x) => r.url.toLowerCase().includes(x) || r.body.toLowerCase().includes(x)));
  const writes = after.filter((r) => r.method !== 'GET');
  check(!leaks.length && !writes.length, `${tag}: no request carries the dream and none writes anywhere`, `${after.length} requests, ${leaks.length} carrying it, ${writes.length} not GET`);
  const shared = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((x) => /lantern|grandmother|orchard|marmalade/i.test(x ?? '')));
  check(shared.length === 0, `${tag}: no link on the page carries the dream`);
  // closing a reading stays in the mode
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  check(!(await reading(page)) && /#\/dreams\//.test(await hash(page)) && await page.locator('.sh-contents').isVisible(), `${tag}: Escape closes the reading and stays in the mode`, await hash(page));
  check(!logs.length, `${tag}: no page errors`, logs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
