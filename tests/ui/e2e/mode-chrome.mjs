// Mode chrome, clicked like a person: opening a panel mode shows its title, its Options and no sheet; the Options' first
// action (Open <mode>) reveals the sheet; X, Escape and Close hide it and stay in the mode; the Options disclosure closes
// on Escape. Desktop (1280) and phone (390). Run against a dev server:
//   npx vite --port 5193 --strictPort &   then   node tests/ui/e2e/mode-chrome.mjs [outdir]
import fs from 'node:fs';
import path from 'node:path';
import { launch, open, revealSheet } from './lib.mjs';

const out = process.argv[2] ?? '.cache/screens/mode-chrome';
fs.mkdirSync(out, { recursive: true });

const MODES = [
  // pick: the Options row (index among the rows, the standard Open row is 0) that is a content choice; none for the rest
  { id: 'alchemy', label: 'Alchemy', pick: { index: 2, title: 'Operations' } },
  { id: 'theory', label: 'Theory', pick: { index: 1, title: "Jung's theory" } },
  { id: 'dreams', label: 'Dreams' },
  { id: 'symbols', label: 'Symbols' },
  { id: 'coincidences', label: 'Coincidences' },
];
const SIZES = [
  { name: '1280', width: 1280, height: 800, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
];

const fails = [];
const results = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); return cond; };

// the sheet on screen (a hidden root has no client rects)
const sheetVisible = (page) => page.$$eval('.lens-panel', (els) => els.some((e) => !e.hidden && e.getClientRects().length > 0));
const optionsPresent = (page) => page.$eval('.sh-controls details.mode-options', () => true).catch(() => false);

const b = await launch('chromium');

for (const size of SIZES) {
  for (const mode of MODES) {
    const tag = `${size.name}/${mode.id}`;
    const { ctx, page, logs } = await open(b, { width: size.width, height: size.height, mobile: size.mobile, hash: `#/${mode.id}` });
    try {
      // the lens is in place, and its own content has loaded (the Open action is enabled)
      await page.waitForFunction((id) => document.body.dataset.lens === id, mode.id, { timeout: 15000 }).catch(() => {});
      await page.waitForFunction(() => {
        const act = [...document.querySelectorAll('.sh-controls .mode-options-body button')].find((x) => /^(Open|Close) /.test(x.textContent ?? ''));
        return !!act && !act.disabled;
      }, null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(700);

      // 1. opening the mode: title and Options, no sheet
      const lensOk = await page.evaluate((id) => document.body.dataset.lens === id, mode.id);
      ok(lensOk, `${tag}: the mode is ${mode.id}`);
      ok(!(await sheetVisible(page)), `${tag}: opening the mode shows no sheet`);
      ok(await optionsPresent(page), `${tag}: the Options control is present`);
      const title = await page.textContent('.sh-title').catch(() => '');
      await page.screenshot({ path: path.join(out, `${size.name}-${mode.id}-1-opened.png`) });

      // 2. Options: the standard first action reads Open <mode>, and it reveals the sheet
      await page.click('.sh-controls details.mode-options > summary');
      await page.waitForTimeout(250);
      // the row's title sits in its own span (optionRow): the label is read from there
      const titleOf = () => page.$eval('.sh-controls .mode-options-body button .mode-opt-title', (x) => x.textContent?.trim() ?? '');
      const first = await titleOf();
      ok(first === `Open ${mode.label}`, `${tag}: the first Options action is "Open ${mode.label}" (got "${first}")`);
      ok(await page.$eval('.sh-controls .mode-options-body button', (x) => x.getAttribute('aria-pressed') === 'false'), `${tag}: the action is not pressed while the sheet is hidden`);
      await page.locator('.sh-controls .mode-options-body button').filter({ hasText: new RegExp(`^Open ${mode.label}$`) }).first().click();
      await page.waitForTimeout(900);
      ok(await sheetVisible(page), `${tag}: "Open ${mode.label}" shows the sheet`);
      ok(await page.evaluate(() => document.body.classList.contains('panel-open')), `${tag}: body carries panel-open while the sheet is shown`);
      await page.screenshot({ path: path.join(out, `${size.name}-${mode.id}-2-revealed.png`) });

      // 3. the action now reads Close <mode>
      await page.click('.sh-controls details.mode-options > summary');
      await page.waitForTimeout(250);
      const closeAct = await titleOf();
      ok(closeAct === `Close ${mode.label}`, `${tag}: while revealed the action reads "Close ${mode.label}" (got "${closeAct}")`);
      ok(await page.$eval('.sh-controls .mode-options-body button', (x) => x.getAttribute('aria-pressed') === 'true'), `${tag}: the action is pressed while the sheet is shown`);
      // Escape closes the disclosure (a details element does not do this by itself)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      ok(!(await page.$eval('.sh-controls details.mode-options', (d) => d.open)), `${tag}: Escape closes the Options disclosure`);
      ok(await sheetVisible(page), `${tag}: that Escape left the sheet shown`);

      // 4. X hides the sheet, stays in the mode, and the Options remain
      await page.click('.lens-panel .lp-close');
      await page.waitForTimeout(700);
      ok(!(await sheetVisible(page)), `${tag}: X hides the sheet`);
      const hashAfterX = await page.evaluate(() => location.hash);
      ok(hashAfterX.startsWith(`#/${mode.id}`), `${tag}: X keeps the url in the mode (${hashAfterX})`);
      ok(await page.evaluate((id) => document.body.dataset.lens === id, mode.id), `${tag}: X keeps the lens ${mode.id}`);
      ok(await optionsPresent(page), `${tag}: the Options remain after X`);
      ok(await page.evaluate(() => !document.body.classList.contains('panel-open')), `${tag}: panel-open is removed when hidden`);
      await page.screenshot({ path: path.join(out, `${size.name}-${mode.id}-3-dismissed.png`) });

      // 5. the sheet comes back from the Options with its content kept, and Escape hides it in the mode
      await page.click('.sh-controls details.mode-options > summary');
      await page.waitForTimeout(250);
      await page.locator('.sh-controls .mode-options-body button').filter({ hasText: new RegExp(`^Open ${mode.label}$`) }).first().click();
      await page.waitForTimeout(900);
      ok(await sheetVisible(page), `${tag}: the Options action shows the sheet again`);
      const bodyText = await page.$eval('.lens-panel .lp-body', (x) => x.textContent?.trim().length ?? 0);
      ok(bodyText > 0, `${tag}: the sheet's content is kept (${bodyText} characters)`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      ok(!(await sheetVisible(page)), `${tag}: Escape hides the sheet`);
      ok((await page.evaluate(() => location.hash)).startsWith(`#/${mode.id}`), `${tag}: Escape keeps the url in the mode`);
      ok(await optionsPresent(page), `${tag}: the Options remain after Escape`);

      // 6. a content choice in the Options is a request to read: it reveals the sheet (none for the modes without one)
      if (mode.pick) {
        await page.click('.sh-controls details.mode-options > summary');
        await page.waitForTimeout(250);
        const row = page.locator('.sh-controls .mode-options-body button').nth(mode.pick.index);
        const rowTitle = await row.locator('.mode-opt-title').textContent();
        ok(rowTitle?.trim() === mode.pick.title, `${tag}: the content row is "${mode.pick.title}" (got "${rowTitle?.trim()}")`);
        await row.click();
        await page.waitForTimeout(900);
        ok(await sheetVisible(page), `${tag}: choosing "${mode.pick.title}" from the Options shows the sheet`);
        await page.screenshot({ path: path.join(out, `${size.name}-${mode.id}-4-choice.png`) });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
        ok(!(await sheetVisible(page)), `${tag}: Escape hides the sheet after a choice`);
      }

      // 7. errors: none on the page
      ok(logs.length === 0, `${tag}: no console errors (got ${logs.slice(0, 2).join(' | ') || 'none'})`);
      results.push({ tag, title: title || '(no context line)', fails: fails.filter((f) => f.startsWith(tag)).length });
    } catch (err) {
      ok(false, `${tag}: the walk threw: ${err.message}`);
      results.push({ tag, title: '', fails: 1 });
    } finally {
      await ctx.close();
    }

    // 8. Escape from a visible sheet: the first hides it (still in the mode), the second steps out to the Field
    const second = await open(b, { width: size.width, height: size.height, mobile: size.mobile, hash: `#/${mode.id}` });
    try {
      const tag2 = `${tag}/escape`;
      await revealSheet(second.page, mode.label);
      ok(await sheetVisible(second.page), `${tag2}: the sheet is visible before Escape`);
      await second.page.keyboard.press('Escape');
      await second.page.waitForTimeout(700);
      ok(!(await sheetVisible(second.page)), `${tag2}: the first Escape hides the sheet`);
      ok((await second.page.evaluate(() => location.hash)).startsWith(`#/${mode.id}`), `${tag2}: the first Escape keeps the mode`);
      await second.page.keyboard.press('Escape');
      await second.page.waitForTimeout(1500);
      const landed = await second.page.evaluate(() => ({ lens: document.body.dataset.lens, hash: location.hash }));
      if (mode.id === 'theory') {
        // the Theory panel's step out is the Dynamics view (store.back), as it was before: not the Field
        ok(!landed.hash.startsWith('#/theory'), `${tag2}: the second Escape leaves the Theory panel (landed ${landed.hash})`);
      } else {
        ok(landed.lens === 'field', `${tag2}: the second Escape steps out to the Field (lens ${landed.lens}, ${landed.hash})`);
      }
      results.push({ tag: tag2, title: '', fails: fails.filter((f) => f.startsWith(tag2)).length });
    } catch (err) {
      ok(false, `${tag}/escape: the walk threw: ${err.message}`);
    } finally {
      await second.ctx.close();
    }
  }
}

await b.close();

console.log('\nper mode:');
for (const r of results) console.log(`  ${r.fails === 0 ? 'PASS' : 'FAIL'}  ${r.tag}  ${r.title ? `title "${r.title}"` : ''}`);
console.log(fails.length ? `\n${fails.length} failure(s)` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
