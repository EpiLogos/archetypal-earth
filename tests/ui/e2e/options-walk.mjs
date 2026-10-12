// Gate: the Options popover in the mode chrome. Aion lists its readings and walks, never its events; the whole-reading
// walk steps through the card's rail; Escape and an outside pointer down close the popover; at 390px it is a bottom sheet.
// Also records the row count of every mode's Options, and screenshots Aion, Theory and Alchemy at 1280 and 390.
//   npx vite --port 5194 --strictPort &      EARTH_URL=http://localhost:5194/ EARTH_HEADLESS=1 node tests/ui/e2e/options-walk.mjs [chromium|webkit]
// OPTIONS_SHOTS overrides the screenshot folder (default: .cache/screens/options-walk).
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.OPTIONS_SHOTS ?? path.resolve(here, '../../../.cache/screens/options-walk');
mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

const history = JSON.parse(readFileSync(path.resolve(here, '../../../public/data/history.json'), 'utf8'));
const aion = history.readings.find((r) => r.id === 'jung-aion');
const aionEventNames = new Set(aion.events.map((e) => e.name.trim()));

const popover = '.sh-controls details.mode-options';
const rowSel = `${popover}[open] .mode-options-body .mode-opt-row`;
const openOptions = async (page) => {
  await page.locator(`${popover} > summary`).click();
  await page.waitForSelector(`${popover}[open] .mode-options-body`, { state: 'visible', timeout: 5000 });
};
// every row, by its title (or its whole text, for a row that is set as plain text)
const rowTitles = (page) => page.locator(rowSel).evaluateAll((rows) => rows.map((r) => (r.querySelector('.mode-opt-title') ?? r).textContent ?? ''));

const browser = await launch(kind, { headed: false });
const counts = [];
try {
  // ── 1280: Aion's Options ─────────────────────────────────────────────────────────────────────────────────────────
  {
    const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash: '#/aion' });
    try {
      await openOptions(page);
      const titles = (await rowTitles(page)).map((t) => t.trim());
      counts.push({ mode: 'aion', width: 1280, rows: titles.length, titles });
      check(titles.length >= 3 && titles.length <= 12, `Aion options: at most 12 rows`, `${titles.length} rows`);
      const listed = titles.filter((t) => aionEventNames.has(t));
      check(listed.length === 0, `Aion options: no event of the reading is a row`, listed.join(' | ') || 'none');
      check(titles.every((t) => !/^\d/.test(t)), `Aion options: no year-led event row`);
      check((await page.locator('.mode-opt-group[aria-label="Walk"]').count()) === 1, `Aion options: a 'Walk' group exists`);
      check((await page.locator('.mode-opt-group[aria-label="Events"]').count()) === 0, `Aion options: no 'Events' group`);
      check((await page.locator(`${rowSel}[aria-pressed=true]`).count()) === 1, `Aion options: exactly one reading or walk is marked active`);
      await page.screenshot({ path: path.join(SHOTS, 'options-aion-1280.png') });

      // the whole reading, in order: a card with the rail, stepped three times
      await page.locator(rowSel, { hasText: 'The whole reading, in order' }).click();
      await page.waitForSelector('section.aion .aion-card:not([hidden]) .rv-text', { timeout: 15000 });
      const rail = page.locator('section.aion nav.rb-rail:not([hidden])');
      check((await rail.count()) === 1, `walk: the card shows with its prev/next rail`);
      const progress = async () => (await rail.locator('.rb-progress').textContent())?.trim() ?? '';
      const first = await progress();
      const total = Number(first.split('/')[1]);
      check(first.startsWith('1 /') && total === aion.events.length, `walk: the rail opens at 1 of every event`, first);
      for (let i = 0; i < 3; i++) {
        await rail.locator('button[aria-label="Next historical event"]').click();
        await page.waitForTimeout(350);
      }
      const after = await progress();
      check(after === `4 / ${total}`, `walk: three steps forward advance the rail to 4`, after);
      await page.screenshot({ path: path.join(SHOTS, 'walk-aion-1280.png') });

      // stepping out: the card's close returns the Options control
      await page.locator('section.aion .aion-card .rv-close').click();
      await page.waitForSelector(`${popover}`, { state: 'visible', timeout: 5000 });
      check((await page.locator('section.aion nav.rb-rail:not([hidden])').count()) === 0, `walk: closing the card hides the rail`);
      check(await page.locator(popover).isVisible(), `walk: closing the card brings the Options control back`);

      // Escape closes the popover; it does not leave the mode
      await openOptions(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      check((await page.locator(`${popover}[open]`).count()) === 0, `Escape closes the Options popover`);
      check((await page.locator('section.aion').getAttribute('hidden')) === null, `Escape leaves Aion showing`);

      // an outside pointer down closes it
      await openOptions(page);
      await page.mouse.click(640, 560);
      await page.waitForTimeout(250);
      check((await page.locator(`${popover}[open]`).count()) === 0, `an outside pointer down closes the Options popover`);
      check(logs.filter((l) => /pageerror/.test(l)).length === 0, `Aion 1280: no page errors`, logs.filter((l) => /pageerror/.test(l)).join(' | '));
    } finally {
      await ctx.close();
    }
  }

  // ── 390: Aion's Options is a bottom sheet ────────────────────────────────────────────────────────────────────────
  {
    const { ctx, page, logs } = await open(browser, { width: 390, height: 844, dpr: 1, mobile: true, hash: '#/aion' });
    try {
      await openOptions(page);
      // the sheet slides up over 0.32s: wait for its animation to finish (a fixed wait starves under software GL)
      await page.waitForFunction(() => document.querySelector('.mode-options[open] .mode-options-body')?.getAnimations().every((a) => a.playState === 'finished'), null, { timeout: 8000 });
      await page.waitForTimeout(100);
      const sheet = await page.locator(`${popover}[open] .mode-options-body`).boundingBox();
      const viewport = page.viewportSize();
      check(!!sheet && Math.abs(sheet.y + sheet.height - viewport.height) <= 2, `390px: the Options popover touches the bottom`,
        sheet ? `bottom ${Math.round(sheet.y + sheet.height)} of ${viewport.height}` : 'no box');
      check(!!sheet && sheet.width >= viewport.width - 2, `390px: the sheet spans the width`, sheet ? `${Math.round(sheet.width)}px` : '');
      const rowH = await page.locator(rowSel).first().evaluate((n) => n.getBoundingClientRect().height);
      check(rowH >= 47, `390px: rows are 48px tall`, `${Math.round(rowH)}px`);
      const titles = (await rowTitles(page)).map((t) => t.trim());
      counts.push({ mode: 'aion', width: 390, rows: titles.length });
      await page.screenshot({ path: path.join(SHOTS, 'options-aion-390.png') });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      check((await page.locator(`${popover}[open]`).count()) === 0, `390px: Escape closes the sheet`);
      check(logs.filter((l) => /pageerror/.test(l)).length === 0, `Aion 390: no page errors`, logs.filter((l) => /pageerror/.test(l)).join(' | '));
    } finally {
      await ctx.close();
    }
  }

  // ── every other mode: row counts, and the theory/alchemy screenshots ─────────────────────────────────────────────
  const others = [
    { mode: 'theory', hash: '#/theory' },
    { mode: 'alchemy', hash: '#/alchemy' },
    { mode: 'astrology', hash: '#/astrology' },
    { mode: 'redbook', hash: '#/redbook' },
  ];
  for (const { mode, hash } of others) {
    for (const width of [1280, 390]) {
      const mobile = width < 500;
      const { ctx, page, logs } = await open(browser, { width, height: width < 500 ? 844 : 800, mobile, hash });
      try {
        const has = (await page.locator(`${popover} > summary`).count()) > 0;
        if (!has) { check(false, `${mode} ${width}: an Options control is present`); continue; }
        await openOptions(page);
        const titles = (await rowTitles(page)).map((t) => t.trim());
        counts.push({ mode, width, rows: titles.length, titles });
        check(titles.length > 0, `${mode} ${width}: Options lists rows`, `${titles.length} rows`);
        if (mode === 'theory' || mode === 'alchemy') await page.screenshot({ path: path.join(SHOTS, `options-${mode}-${width}.png`) });
        check(logs.filter((l) => /pageerror/.test(l)).length === 0, `${mode} ${width}: no page errors`, logs.filter((l) => /pageerror/.test(l)).join(' | '));
      } finally {
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(counts.map(({ titles, ...rest }) => rest)));
console.log(failed ? `${failed} FAIL` : 'ALL PASS');
process.exitCode = failed ? 1 : 0;
