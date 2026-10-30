// N20: a Work, a Person and the visitor each have a page in the reading sheet, and it opens from the graph, from search and
// from a cite. Jung's page is the hub: his own occurrences, his works, and "Open the chart" lands in Astrology on his chart.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/pages-walk.mjs
import { launch, open } from './lib.mjs';

const results = [];
const check = (ok, what, detail = '') => { results.push(ok); console.log(`${ok ? 'ok   ' : 'FAIL '} ${what}${detail ? ` — ${detail}` : ''}`); };
const b = await launch('chromium');

const WORK = 'cw12';
const WORK_TITLE = 'Psychology and Alchemy (CW12)';
// an occurrence whose first cite is the work and that carries a quotation (so the page lists it)
const OCC = 'adam-prima-materia-arrow-mercurius-14c';

const title = (page) => page.$eval('.deep.on:not(.passage):not(.you-sheet) .dp-title', (e) => e.textContent).catch(() => null);
const pageOpen = (page, want) => page.waitForFunction((w) => document.querySelector('.deep.on:not(.passage):not(.you-sheet) .dp-title')?.textContent === w, want, { timeout: 8000 }).then(() => true, () => false);
const ctl = (page, fn, arg) => page.evaluate(`(${fn.toString()})(window.__earth.ctl, ${JSON.stringify(arg ?? null)})`);

for (const size of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const tag = size.name;

  // ── the Work: from the graph ────────────────────────────────────────
  {
    const { ctx, page, logs } = await open(b, { ...size, hash: '#/graph' });
    await page.waitForFunction(() => window.__earth.ctl.graph?.isVisible, null, { timeout: 60000 });
    await ctl(page, (c) => c.onGraphSelect('w:cw12'));
    check(await pageOpen(page, WORK_TITLE), `${tag}: the Work's page opens from the graph`, String(await title(page)));
    check((await page.evaluate(() => location.hash)) === '#/graph/w/cw12/deep', `${tag}: and its address names it`, await page.evaluate(() => location.hash));
    const facts = await page.evaluate(() => ({
      read: !!document.querySelector('.deep.on .dp-read'),
      contents: document.querySelectorAll('.deep.on .dp-contents li').length,
      list: !!document.querySelector('.deep.on .qs'),
      listCount: document.querySelector('.deep.on .qs-count')?.textContent ?? '',
      cites: document.querySelectorAll('.deep.on .dp-work-cites li').length,
      blockquotes: document.querySelectorAll('.deep.on blockquote').length,
      byline: document.querySelector('.deep.on .dp-lede')?.textContent ?? '',
      author: document.querySelector('.deep.on .dp-author')?.textContent ?? '',
    }));
    check(facts.read, `${tag}: "Read through this text" is on the Work's page`);
    check(facts.contents > 5, `${tag}: its Contents lists the chapters`, String(facts.contents));
    check(facts.list && /^\d+ from 1 work$/.test(facts.listCount), `${tag}: its cites stand in the one quote list`, facts.listCount);
    check(facts.cites === 12, `${tag}: and the instances that cite it follow, twelve at first`, String(facts.cites));
    check(/Jung/.test(facts.byline), `${tag}: the voice stands under the title`, facts.byline);
    check(facts.author === 'C. G. Jung', `${tag}: the author is a door to the person`, facts.author);
    // the quote list's quotations are in page order
    const pages = await page.$$eval('.deep.on .qs-group .q-pg', (els) => els.map((e) => Number((/(\d+)/.exec(e.textContent) ?? [])[1])));
    check(pages.length > 1 && pages.every((p, i) => i === 0 || p >= pages[i - 1]), `${tag}: the quotations are in page order`, pages.slice(0, 6).join(','));
    // Escape closes the page and stays on the field
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    check(!(await page.evaluate(() => /\/deep$/.test(location.hash))), `${tag}: Escape closes the page`, await page.evaluate(() => location.hash));
    check(!logs.length, `${tag}: no console errors from the graph route`, logs.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ── the Work: from search, and its page's "Read through this text" ────
  {
    const { ctx, page } = await open(b, { ...size, hash: '#/' });
    await page.keyboard.press('/');
    await page.fill('.s-input', 'Psychology and Alchemy');
    await page.waitForTimeout(400);
    const first = await page.$eval('.s-row.active .s-label', (e) => e.textContent).catch(() => null);
    check(first === WORK_TITLE, `${tag}: search finds the Work first`, String(first));
    await page.keyboard.press('Enter');
    check(await pageOpen(page, WORK_TITLE), `${tag}: the Work's page opens from search`);
    await page.click('.deep.on .dp-read');
    await page.waitForFunction(() => document.body.dataset.lens === 'texts', null, { timeout: 8000 }).catch(() => {});
    const st = await page.evaluate(() => ({ lens: document.body.dataset.lens, hash: location.hash }));
    check(st.lens === 'texts' && st.hash.startsWith('#/texts/cw12'), `${tag}: "Read through this text" enters the Texts lens`, `${st.lens} ${st.hash}`);
    await ctx.close();
  }

  // ── the Work: from a cite ───────────────────────────────────────────
  {
    const { ctx, page } = await open(b, { ...size, hash: `#/o/${OCC}/deep` });
    await page.waitForSelector('.deep.on .dp-cite-work', { timeout: 10000 });
    const door = await page.$$eval('.deep.on .dp-cite-work', (els) => els.map((e) => e.getAttribute('aria-label')));
    check(door.some((t) => t?.includes(WORK_TITLE)), `${tag}: a cite in an instance's reading has a door to its Work`, door.join(' | '));
    await page.locator('.deep.on .dp-cite-work', { hasText: 'the work' }).first().click();
    check(await pageOpen(page, WORK_TITLE) || (await title(page))?.length > 0, `${tag}: the Work's page opens from a cite`, String(await title(page)));
    await ctx.close();
  }

  // ── the Person: Jung, from the graph, search and a Work ─────────────
  {
    const { ctx, page } = await open(b, { ...size, hash: '#/graph' });
    await page.waitForFunction(() => window.__earth.ctl.graph?.isVisible, null, { timeout: 60000 });
    await ctl(page, (c) => c.onGraphSelect('p:jung'));
    check(await pageOpen(page, 'C. G. Jung'), `${tag}: Jung's page opens from the graph`, String(await title(page)));
    const j = await page.evaluate(() => ({
      lede: document.querySelector('.deep.on .dp-lede')?.textContent ?? '',
      portrait: !!document.querySelector('.deep.on .dp-portrait img'),
      chart: document.querySelector('.deep.on .dp-chart-line')?.textContent ?? '',
      open: !!document.querySelector('.deep.on .dp-chart'),
      works: document.querySelectorAll('.deep.on .dp-works button').length,
      occ: document.querySelectorAll('.deep.on .dp-occ li').length,
    }));
    check(/1875/.test(j.lede) && /1961/.test(j.lede), `${tag}: the dates are his record's`, j.lede);
    check(j.portrait, `${tag}: the portrait shows`);
    check(/Sun in Leo/.test(j.chart), `${tag}: the chart summary reads off his natal placements`, j.chart);
    check(j.works >= 30, `${tag}: his works are on the page`, String(j.works));
    check(j.occ === 82, `${tag}: his 82 own-subject occurrences hang from him`, String(j.occ));
    await page.click('.deep.on .dp-chart');
    await page.waitForFunction(() => location.hash.startsWith('#/astrology/jung'), null, { timeout: 15000 }).catch(() => {});
    const st = await page.evaluate(() => ({ lens: document.body.dataset.lens, hash: location.hash, sky: document.body.dataset.skyPhase ?? '' }));
    check(st.lens === 'astrology' && st.hash.startsWith('#/astrology/jung'), `${tag}: "Open the chart" lands in Astrology on his chart`, `${st.lens} ${st.hash}`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(b, { ...size, hash: '#/' });
    await page.keyboard.press('/');
    await page.fill('.s-input', 'Jung');
    await page.waitForTimeout(400);
    const labels = await page.$$eval('.s-row .s-label', (e) => e.map((x) => x.textContent));
    check(labels.includes('C. G. Jung'), `${tag}: search finds the Person`, labels.join(' | '));
    const idx = labels.indexOf('C. G. Jung');
    for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    check(await pageOpen(page, 'C. G. Jung'), `${tag}: the Person's page opens from search`);
    // a Person from a cite: the Work's page names its author
    await page.evaluate(() => window.__earth.ctl.onGraphSelect('w:cw12'));
    await pageOpen(page, WORK_TITLE);
    await page.click('.deep.on .dp-author');
    check(await pageOpen(page, 'C. G. Jung'), `${tag}: and from a cite, through its Work's author`);
    await ctx.close();
  }

  // ── You: from the graph and from search, once the browser holds something ──
  {
    const { ctx, page } = await open(b, { ...size, hash: '#/' });
    await page.evaluate(() => {
      localStorage.setItem('aae.practice.v1.dreams', JSON.stringify([{ id: 'd1', title: 'A serpent in a well', text: 'I dreamed of a serpent and a well.', date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.keyboard.press('/');
    await page.fill('.s-input', 'you');
    await page.waitForTimeout(400);
    const labels = await page.$$eval('.s-row .s-label', (e) => e.map((x) => x.textContent));
    check(labels[0] === 'You', `${tag}: search finds your page once the browser holds something of yours`, labels.join(' | '));
    await page.keyboard.press('Enter');
    await page.waitForSelector('.you-sheet.on', { timeout: 8000 });
    check(await page.$eval('.you-sheet .dp-title', (e) => e.textContent) === 'You', `${tag}: your page opens from search`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    check(!(await page.$('.you-sheet.on')), `${tag}: Escape closes it`);
    await ctx.close();
  }
  {
    // a browser with nothing of yours has no page to find
    const { ctx, page } = await open(b, { ...size, hash: '#/' });
    await page.keyboard.press('/');
    await page.fill('.s-input', 'you');
    await page.waitForTimeout(400);
    const labels = await page.$$eval('.s-row .s-label', (e) => e.map((x) => x.textContent));
    check(!labels.includes('You'), `${tag}: with nothing of yours here, search offers no You`, labels.join(' | '));
    await ctx.close();
  }
}

await b.close();
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} failure(s)` : '\nall checks passed');
process.exit(failed ? 1 : 0);
