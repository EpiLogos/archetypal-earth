// N12: a text is a lens. The Texts lens takes a Work as its subject and reads it as an archetype is read (owner, 1 Nov 2026):
// the list of texts is a reading in the pane that lists every work the field cites, once, each with its picture; a work opens with
// its title in the Path and its page: whose it is, then the instances it attests, each a row with its picture that opens the
// instance. The text itself is not on the site: no chapters, no pages, no read-through. The Contents are the works, the open one
// marked. CW9ii opens the Aion lens and Liber Novus the Red Book. Closing the reading stays in the mode.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/texts-walk.mjs
import { launch, open } from './lib.mjs';

const results = [];
const check = (ok, what, detail = '') => { results.push(ok); console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` — ${detail}` : ''}`); };
const b = await launch('chromium');
const lensOf = (page) => page.evaluate(() => document.body.dataset.lens);
const SHEET = 'section.deep:not(.passage):not(.you-sheet)';
const openContents = async (page, phone) => {
  if (phone && (await page.evaluate(() => document.body.classList.contains('pane-reading')))) await page.locator(`${SHEET} .pane-contents-tool`).click();
  else await page.locator('.sh-contents').click();
  await page.waitForSelector(`${SHEET} .dp-contents-pane:not([hidden]) li button`, { timeout: 8000 });
};
const hash = (page) => page.evaluate(() => location.hash);

for (const size of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const tag = size.name;
  const { ctx, page, logs } = await open(b, { ...size, hash: '#/' });
  // a work no instance cites has nothing to read through it, and is not listed
  const workCount = await page.evaluate(() => { const m = window.__earth.model; return [...m.workById.keys()].filter((id) => m.workMem.get(id)?.length).length; });

  // the lens is in the menu, and its picker lists every Work once
  await page.click('.sh-lens');
  await page.waitForSelector('#shell-menu:not([hidden])');
  check(!!(await page.$('.sm-row[data-lens="texts"]')), `${tag}: Texts is a lens of the menu`);
  await page.click('.sm-row[data-lens="texts"]');
  await page.waitForSelector('.sh-contents', { timeout: 10000 });
  await page.waitForTimeout(800);
  check(!(await page.evaluate(() => document.body.classList.contains('pane-reading'))), `${tag}: the list waits in the Contents (no reading opens by itself)`);
  await page.locator('.sh-contents').click();
  await page.waitForSelector(`${SHEET} .dp-contents-pane li button`, { timeout: 10000 });
  const listed = await page.$$eval(`${SHEET} .dp-contents-pane li button`, (b) => b.map((x) => x.textContent));
  check(listed.length === workCount && new Set(listed).size === workCount, `${tag}: the Contents list every cited Work once`, `${listed.length} of ${workCount}`);
  const pictured = await page.$$eval(`${SHEET} .dp-contents-pane li .dp-ct-plate`, (x) => x.length);
  check(pictured === listed.length, `${tag}: each work in the Contents has its picture`, `${pictured} of ${listed.length}`);
  const groups = await page.$$eval(`${SHEET} .dp-contents-pane .dp-sub`, (h) => h.map((x) => x.textContent));
  check(groups.length >= 3 && /^Jung/.test(groups[0] ?? ''), `${tag}: grouped by voice, Jung's first`, groups.slice(0, 4).join(' | '));
  check((await lensOf(page)) === 'texts' && (await hash(page)) === '#/texts', `${tag}: the route is #/texts`, await hash(page));

  // a work: its title in the Path, its page, its instances as pictured rows
  const cw12 = await page.evaluate(() => window.__earth.model.workById.get('cw12').title);
  await page.locator(`${SHEET} .dp-contents-pane li button`, { hasText: new RegExp(`^${cw12.replace(/[()]/g, '\\$&')}`) }).first().click();
  await page.waitForSelector(`${SHEET} .dp-rows li`, { timeout: 10000 });
  const title = await page.$eval('.sh-title', (e) => e.textContent);
  check(title === 'Psychology and Alchemy (CW12)', `${tag}: the work is the title in the Path`, title);
  check((await hash(page)) === '#/texts/cw12', `${tag}: the route is #/texts/cw12`, await hash(page));
  const inst = await page.evaluate(() => window.__earth.model.workMem.get('cw12').length);
  const rows = await page.$$eval(`${SHEET} .dp-rows li`, (li) => li.map((x) => ({ name: x.querySelector('.dp-row-name')?.textContent ?? '', plate: !!x.querySelector('.dp-row-plate') })));
  check(rows.length === Math.min(24, inst) && rows.every((r) => r.name && r.plate), `${tag}: its instances are rows, each with its picture`, `${rows.length} of ${inst}`);
  check(!(await page.$(`${SHEET} .pane-foot .pane-count`)) && !(await page.evaluate(() => /\bpdf\s+pp?\.?\s*\d/i.test(document.querySelector('section.deep:not(.passage):not(.you-sheet) .dp-scroll')?.textContent ?? ''))), `${tag}: no read-through and no pdf pages`);
  if (inst > 24) {
    await page.locator(`${SHEET} button`, { hasText: /^Show all/ }).first().click();
    const all = await page.$$eval(`${SHEET} .dp-rows li`, (li) => li.length);
    check(all === inst, `${tag}: "Show all" lists every instance`, `${all} of ${inst}`);
  }

  // Contents: the works again, the open one marked
  await openContents(page, size.mobile);
  const current = await page.$$eval(`${SHEET} .dp-contents-pane li button[aria-current="true"]`, (b) => b.map((x) => x.textContent));
  check(current.length === 1 && current[0].startsWith(cw12), `${tag}: the Contents mark the open work`, current.join(' | '));
  await page.locator(`${SHEET} .dp-contents-pane li button[aria-current="true"]`).first().click();
  await page.waitForSelector(`${SHEET} .dp-rows li`, { timeout: 10000 });

  // an instance row opens the instance
  const firstId = await page.evaluate(() => { const m = window.__earth.model; return m.occ[m.workMem.get('cw12')[0]].id; });
  await page.locator(`${SHEET} .dp-rows li .dp-row-name`).first().click();
  await page.waitForFunction((id) => location.hash.startsWith(`#/o/${id}`), firstId, { timeout: 10000 }).catch(() => {});
  check((await hash(page)).startsWith(`#/o/${firstId}`), `${tag}: an instance row opens the instance`, await hash(page));
  await page.goBack();
  await page.waitForFunction(() => location.hash === '#/texts/cw12', null, { timeout: 10000 }).catch(() => {});

  // the work is a node of the visitor's own record, and nothing personal is in the address
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('aae.practice.v1.engagements') ?? '[]'));
  check(log.some((e) => e.kind === 'open' && e.subject.type === 'work' && e.subject.id === 'cw12'), `${tag}: opening the work is one line of the trail`, String(log.length));
  check(!/aae|engag|you/.test(await hash(page)), `${tag}: nothing personal is in the address`, await hash(page));

  // Escape closes the reading and stays in the mode; the next steps out to the Field
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  check((await lensOf(page)) === 'texts' && !(await page.evaluate(() => document.body.classList.contains('pane-reading'))), `${tag}: Escape closes the reading and stays in Texts`, `${await lensOf(page)}`);
  // each step up (the work, the list) reads in the pane again; the pane's own Escape comes first, so the ladder is several presses
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
  await page.waitForSelector('.sh-contents', { timeout: 15000 });
  await page.locator('.sh-contents').click();
  const cw9 = await page.evaluate(() => window.__earth.model.workById.get('cw09ii').title);
  await page.locator(`${SHEET} .dp-contents-pane li button`, { hasText: cw9 }).first().click();
  await page.waitForSelector('.aion:not([hidden])', { timeout: 20000 }).catch(() => {});
  check((await lensOf(page)) === 'aion', `${tag}: and choosing CW9ii in the picker does the same`, await lensOf(page));

  check(!logs.length, `${tag}: no console errors`, logs.slice(0, 3).join(' | '));
  await ctx.close();
}
await b.close();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} failure(s)` : '\nall checks passed');
process.exit(failed ? 1 : 0);
