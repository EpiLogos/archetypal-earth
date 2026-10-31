// Gate: the mode polish (audit W5, SPEC §10). Three things a person sees and reads:
//   · the deep link '#/aion' opens the same default reading the lens menu opens, and closing it works (W5a)
//   · the Red Book names the book or the folio in the tab title, and every mode gives it back on leaving (W5b)
//   · the header's controls (the lens button, the View control, the search) stand in one row, clear of one another, at 1280×800,
//     1440×900 and 390×844, in reading order for Tab; the lens menu marks the mode that stands (the old four switches are gone)
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/mode-polish.mjs [chromium|webkit]
// Screenshots of the row land in .cache/screens/remediation-2026-10-09/switch-row/ (after-<width>.png).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const history = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/history.json'), 'utf8'));
const field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8'));
const shots = path.join(ROOT, '.cache/screens/remediation-2026-10-09/switch-row');
fs.mkdirSync(shots, { recursive: true });
const defaultReading = history.readings[0];
const plainTitle = 'An Archetypal Earth';

let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

const state = (page) => page.evaluate(() => {
  const c = window.__earth.ctl;
  return {
    hash: location.hash,
    kind: c.state.view.kind,
    aion: c.state.history?.reading ?? null,
    redbook: !!c.state.redbook,
    dynamics: !!c.state.dynamics,
    sky: !!c.state.sky,
    title: document.title,
  };
});
const until = (page, fn, arg = null) => page.waitForFunction(fn, arg, { timeout: 12000, polling: 50 }).then(() => true, () => false);

const browser = await launch(kind, { headed: false });
/** Choose a mode from the lens menu. */
const enter = async (page, lens) => {
  await page.click('.sh-lens');
  await page.waitForSelector('#shell-menu:not([hidden])');
  await page.click(`.sm-row[data-lens="${lens}"]`);
};
/** The name of the mode the lens menu marks as standing. */
const marked = async (page) => {
  await page.click('.sh-lens');
  await page.waitForSelector('#shell-menu:not([hidden])');
  const on = await page.$eval('.sm-row.on', (e) => e.dataset.lens).catch(() => null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return on;
};
const folioName = (page) => page.evaluate(() => document.querySelector('section.deep:not(.passage):not(.you-sheet) .dp-article:not([hidden]) .rv-name')?.textContent ?? '');
try {
  // ── W5a: '#/aion' is the default reading, as the menu opens it ────────────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/aion' });
    await until(page, () => document.querySelector('.aion') && !document.querySelector('.aion').hidden && window.__earth.ctl.state.history);
    await page.waitForTimeout(600);
    const s = await state(page);
    check(s.aion === defaultReading.id, 'a fresh #/aion lands on the default Aion reading (not the plain globe)', `${s.hash}, reading ${s.aion}`);
    check(s.hash === `#/aion/${defaultReading.id}`, 'the link settles to the reading it names', s.hash);
    const heading = await page.evaluate(() => { const t = document.querySelector('.sh-title'); return !!t && !t.hidden && t.getBoundingClientRect().height > 0 ? t.textContent : ''; });
    check(heading === `${defaultReading.title} · ${defaultReading.author}`, 'the Aion mode is visible with its heading', heading);
    const on = await marked(page);
    check(on === 'aion', 'the lens menu marks Aion for that reading', `marked ${on}`);
    await page.keyboard.press('Escape');
    await until(page, () => !window.__earth.ctl.state.history);
    await page.waitForTimeout(500);
    const e = await state(page);
    check(!e.aion && e.kind === 'world' && !(await page.evaluate(() => document.querySelector('.aion')?.hidden === false)), 'Escape closes the default reading (no trap)', e.hash);
    await ctx.close();
  }
  {
    // the menu and the link agree: the menu from the plain globe lands on the same hash
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await enter(page, 'aion');
    await until(page, (id) => location.hash === `#/aion/${id}`, defaultReading.id);
    const sw = await state(page);
    check(sw.hash === `#/aion/${defaultReading.id}` && sw.aion === defaultReading.id, 'the lens menu opens the same reading the link names', sw.hash);
    await ctx.close();
  }

  // ── W5b: the tab title names the book, the folio or the reading; every mode gives it back ───────────────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await enter(page, 'redbook');
    await until(page, () => location.hash.startsWith('#/redbook'));
    await page.waitForSelector('.sh-contents', { timeout: 15000 });
    await page.locator('.sh-contents').click();
    await page.locator('.dp-contents-pane li button').first().click();
    await until(page, () => document.querySelector('section.deep:not(.passage):not(.you-sheet) .dp-article:not([hidden]) .rv-name')?.textContent);
    await page.waitForTimeout(500);
    const folio = await folioName(page);
    const rb1 = await state(page);
    check(rb1.title === `${folio} — Red Book — ${plainTitle}`, 'the Red Book names its folio in the tab title', `"${rb1.title}"`);
    await page.locator('.rb-rail button[aria-label="Next folio"]').click();
    await until(page, (was) => document.querySelector('section.deep:not(.passage):not(.you-sheet) .dp-article:not([hidden]) .rv-name')?.textContent !== was, folio);
    await page.waitForTimeout(900);
    const folio2 = await folioName(page);
    const rb2 = await state(page);
    check(folio2 !== folio && rb2.title === `${folio2} — Red Book — ${plainTitle}`, 'the title follows the folio as the walk turns it', `"${rb2.title}"`);
    await enter(page, 'aion');
    await until(page, () => window.__earth.ctl.state.history && !window.__earth.ctl.state.redbook);
    await page.waitForTimeout(500);
    const aion = await state(page);
    const expectTitle = `${defaultReading.title} · ${defaultReading.author} — Aion — ${plainTitle}`;
    check(aion.title === expectTitle && !aion.redbook, 'Red Book → Aion: the title is the reading\'s, the Red Book gone', `"${aion.title}"`);
    await enter(page, 'redbook');
    await until(page, () => window.__earth.ctl.state.redbook && !window.__earth.ctl.state.history);
    await page.waitForTimeout(500);
    const rb3 = await state(page);
    check(rb3.title === `Red Book — ${plainTitle}` || rb3.title.endsWith(`Red Book — ${plainTitle}`), 'Aion → Red Book: the title is the Red Book\'s again', `"${rb3.title}"`);
    await page.keyboard.press('Escape');
    await until(page, () => !window.__earth.ctl.state.redbook);
    await page.waitForTimeout(600);
    const plain = await state(page);
    check(plain.title === plainTitle && plain.kind === 'world', 'leaving the Red Book for the plain world gives the title back', `"${plain.title}" ${plain.hash}`);
    await ctx.close();
  }

  // ── the header's row: the lens button, the View control and the search stand clear of one another, in reading order ───────────────
  for (const [w, h, tag, mobile] of [[1280, 800, '1280x800', false], [1440, 900, '1440x900', false], [390, 844, '390x844', true]]) {
    const { ctx, page } = await open(browser, { width: w, height: h, mobile });
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null; };
      return { lens: box('.sh-lens'), view: box('.vc-segs') ?? box('.vc-compact'), search: box('#search-btn'), overflowX: document.documentElement.scrollWidth - innerWidth };
    });
    const row = [m.lens, m.view, m.search];
    check(row.every(Boolean), `${tag}: the lens button, the View control and the search are all there`);
    check(row.every(Boolean) && row.every((b, i) => i === 0 || b.l >= row[i - 1].r - 0.5), `${tag}: they stand left to right without overlapping`, row.map((b) => `${b?.l.toFixed(0)}–${b?.r.toFixed(0)}`).join(' | '));
    check(row.every(Boolean) && row.every((b) => Math.abs((b.t + b.b) / 2 - (row[0].t + row[0].b) / 2) <= 16), `${tag}: they share one row`, row.map((b) => ((b?.t + b?.b) / 2).toFixed(0)).join(', '));
    check(m.overflowX <= 0, `${tag}: no horizontal page scroll`, `overflow ${m.overflowX}`);
    await page.screenshot({ path: path.join(shots, `after-${tag}.png`) });
    if (tag === '1280x800') {
      // Tab follows the eye: the lens button, then the View control, then the search
      await page.evaluate(() => document.activeElement?.blur());
      const seen = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        seen.push(await page.evaluate(() => `${document.activeElement?.className ?? ''} ${document.activeElement?.id ?? ''}`));
      }
      const at = ['sh-lens', 'vc-seg', 'search-glyph'].map((n) => seen.findIndex((c) => String(c).split(/\s+/).includes(n)));
      check(at.every((x) => x >= 0) && at[0] < at[1] && at[1] < at[2], 'Tab reaches the lens button, the View control and the search in that order', `positions ${at.join(', ')}`);
    }
    await ctx.close();
  }

  // ── the lens menu tells the truth in each mode ─────────────────────────────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/' });
    check((await marked(page)) === 'field', 'on the plain globe the menu marks the Field');
    await enter(page, 'theory');
    await until(page, () => document.body.dataset.lens === 'theory');
    await page.waitForTimeout(400);
    check((await marked(page)) === 'theory', 'in Theory the menu marks Theory');
    await enter(page, 'astrology');
    await until(page, () => window.__earth.ctl.state.sky);
    await page.waitForTimeout(600);
    check((await marked(page)) === 'astrology', 'in the sky the menu marks Astrology');
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
