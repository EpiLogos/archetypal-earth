// N12: a text is a lens. The Texts lens takes a Work as its subject: the picker lists every work once, a work opens with its
// title in the Path, its chapters as Contents and its cites read in page order; CW9ii opens the Aion lens and Liber Novus the
// Red Book. Closing the reading stays in the mode.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/texts-walk.mjs
import { launch, open } from './lib.mjs';

const results = [];
const check = (ok, what, detail = '') => { results.push(ok); console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` — ${detail}` : ''}`); };
const b = await launch('chromium');
const lensOf = (page) => page.evaluate(() => document.body.dataset.lens);
const counter = (page) => page.$eval('.lens-panel .th-count', (e) => e.textContent).catch(() => null);
const hash = (page) => page.evaluate(() => location.hash);

for (const size of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const tag = size.name;
  const { ctx, page, logs } = await open(b, { ...size, hash: '#/' });
  const workCount = await page.evaluate(() => window.__earth.model.workById.size);

  // the lens is in the menu, and its picker lists every Work once
  await page.click('.sh-lens');
  await page.waitForSelector('#shell-menu:not([hidden])');
  check(!!(await page.$('.sm-row[data-lens="texts"]')), `${tag}: Texts is a lens of the menu`);
  await page.click('.sm-row[data-lens="texts"]');
  await page.waitForSelector('.lens-panel:not([hidden]) .tx-works', { timeout: 10000 });
  const listed = await page.$$eval('.tx-works button[data-work]', (b) => b.map((x) => x.dataset.work));
  check(listed.length === workCount && new Set(listed).size === workCount, `${tag}: the picker lists every Work once`, `${listed.length} of ${workCount}`);
  const groups = await page.$$eval('.lens-panel .lp-body h3', (h) => h.map((x) => x.textContent));
  check(groups.length >= 3 && groups[0] === 'Jung', `${tag}: grouped by voice, Jung's first`, groups.slice(0, 4).join(' | '));
  check((await lensOf(page)) === 'texts' && (await hash(page)) === '#/texts', `${tag}: the route is #/texts`, await hash(page));

  // a work: its title in the Path, the walk at its first cite
  await page.click('.tx-works button[data-work="cw12"]');
  await page.waitForSelector('.lens-panel .th-count', { timeout: 10000 });
  const title = await page.$eval('.sh-title', (e) => e.textContent);
  check(title === 'Psychology and Alchemy (CW12)', `${tag}: the work is the title in the Path`, title);
  check((await counter(page)) === '1 / 204', `${tag}: cw12 is read through in 204 steps`, String(await counter(page)));
  await page.waitForSelector('.lens-panel .tx-step blockquote', { timeout: 10000 });
  const pdfOf = () => page.$eval('.lens-panel .tx-step .q-pg', (e) => Number((/(\d+)/.exec(e.textContent) ?? [])[1])).catch(() => NaN);
  const pages = [await pdfOf()];
  for (let i = 0; i < 8; i++) {
    await page.click('.lens-panel .th-step button[aria-label="Next cite"]');
    await page.waitForFunction((n) => document.querySelector('.lens-panel .th-count')?.textContent === `${n} / 204`, i + 2, { timeout: 8000 });
    await page.waitForSelector('.lens-panel .tx-step blockquote', { timeout: 8000 }).catch(() => {});
    pages.push(await pdfOf());
  }
  check((await hash(page)) === '#/texts/cw12/8', `${tag}: each step is in the address`, await hash(page));
  check(pages.every((p, i) => Number.isFinite(p) && (i === 0 || p >= pages[i - 1])), `${tag}: the cites come in page order`, pages.join(','));
  await page.click('.lens-panel .th-step button[aria-label="Previous cite"]');
  await page.waitForFunction(() => document.querySelector('.lens-panel .th-count')?.textContent === '8 / 204', null, { timeout: 8000 });
  check(true, `${tag}: Previous steps back`);

  // Contents: a chapter jumps to its first cite
  const chapters = await page.$$('.lens-panel .tx-contents li button');
  check(chapters.length > 5, `${tag}: the chapters are the Contents`, String(chapters.length));
  const before = await counter(page);
  await chapters[chapters.length - 1].click();
  await page.waitForFunction((was) => document.querySelector('.lens-panel .th-count')?.textContent !== was, before, { timeout: 8000 });
  check(true, `${tag}: a chapter jumps to its first cite`, `${before} → ${await counter(page)}`);

  // the work is a node of the visitor's own record, and nothing personal is in the address
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]'));
  check(log.some((e) => e.kind === 'open' && e.subject.type === 'work' && e.subject.id === 'cw12'), `${tag}: opening the work is one line of the trail`, String(log.length));
  check(!/aae|engag|you/.test(await hash(page)), `${tag}: nothing personal is in the address`, await hash(page));

  // Escape closes the reading and stays in the mode; the next steps out to the Field
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  check((await lensOf(page)) === 'texts' && !(await page.$('.lens-panel:not([hidden])')), `${tag}: Escape closes the reading and stays in Texts`, `${await lensOf(page)}`);
  // each step up (the work, the picker) shows its sheet again; the sheet's own Escape comes first, so the ladder is six presses
  const seen = [];
  for (let i = 0; i < 7 && (await lensOf(page)) !== 'field'; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(1300); seen.push(await hash(page)); }
  check(seen.includes('#/texts') && (await lensOf(page)) === 'field', `${tag}: Escape steps up through the picker, then out to the Field`, seen.join(' '));

  // the lenses of its own: CW9ii in Aion, Liber Novus in the Red Book (a link, and the picker)
  await page.goto(page.url().replace(/#.*$/, '') + '#/texts/cw09ii', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
  await page.waitForSelector('.aion:not([hidden])', { timeout: 20000 }).catch(() => {});
  check((await lensOf(page)) === 'aion' && (await hash(page)).startsWith('#/aion/'), `${tag}: opening CW9ii lands in the Aion lens`, `${await lensOf(page)} ${await hash(page)}`);
  await page.goto(page.url().replace(/#.*$/, '') + '#/texts/liber-novus', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
  await page.waitForSelector('.redbook:not([hidden])', { timeout: 20000 }).catch(() => {});
  check((await lensOf(page)) === 'redbook', `${tag}: opening Liber Novus lands in the Red Book lens`, `${await lensOf(page)} ${await hash(page)}`);
  await page.evaluate(() => { location.hash = '#/texts'; });
  await page.waitForSelector('.tx-works button[data-work="cw09ii"]', { timeout: 15000 });
  await page.click('.tx-works button[data-work="cw09ii"]');
  await page.waitForSelector('.aion:not([hidden])', { timeout: 20000 }).catch(() => {});
  check((await lensOf(page)) === 'aion', `${tag}: and choosing CW9ii in the picker does the same`, await lensOf(page));

  check(!logs.length, `${tag}: no console errors`, logs.slice(0, 3).join(' | '));
  await ctx.close();
}
await b.close();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} failure(s)` : '\nall checks passed');
process.exit(failed ? 1 : 0);
