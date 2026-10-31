// Mode chrome, clicked like a person: opening a panel mode shows its title and its Contents trigger, no sheet and no Options; a pick of
// the Contents reads in the pane; X and Escape close the reading and stay in the mode; the next Escape steps out. Desktop (1280) and
// phone (390). Run against a dev server:
//   npx vite --port 5193 --strictPort &   then   node tests/ui/e2e/mode-chrome.mjs [outdir]
import fs from 'node:fs';
import path from 'node:path';
import { launch, open } from './lib.mjs';

const out = process.argv[2] ?? '.cache/screens/mode-chrome';
fs.mkdirSync(out, { recursive: true });

const MODES = [
  { id: 'alchemy', label: 'Alchemy' },
  { id: 'theory', label: 'Theory' },
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

// the old sheet and the Options disclosure are gone: nothing of either stands in the page (H7)
const oldSurfaces = (page) => page.evaluate(() => document.querySelectorAll('.lens-panel, details.mode-options, .mode-opt-btn').length);

const b = await launch('chromium');

// a mode whose Contents stand in the pane: no sheet, no Open row, the Contents trigger; a pick reads in the pane; Escape
// closes the reading and stays; the next Escape steps out
const paneUp = (page) => page.evaluate(() => document.body.classList.contains('pane-reading'));
async function paneMode(size, mode, tag) {
  const { ctx, page, logs } = await open(b, { width: size.width, height: size.height, mobile: size.mobile, hash: `#/${mode.id}` });
  try {
    await page.waitForFunction((id) => document.body.dataset.lens === id, mode.id, { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('.sh-contents', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    ok(await page.evaluate((id) => document.body.dataset.lens === id, mode.id), `${tag}: the mode is ${mode.id}`);
    ok((await oldSurfaces(page)) === 0 && !(await paneUp(page)), `${tag}: opening the mode shows no reading, no sheet and no Options`);
    ok(await page.locator('.sh-contents').isVisible(), `${tag}: the Contents trigger is present`);
    ok((await page.locator('.sh-controls .mode-options-body button').filter({ hasText: /^(Open|Close) / }).count()) === 0, `${tag}: no Open/Close row stands in the Options`);
    await page.screenshot({ path: path.join(out, `${size.name}-${mode.id}-1-opened.png`) });
    await page.click('.sh-contents');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `${size.name}-${mode.id}-2-contents.png`) });
    await page.locator('.dp-contents-pane li button').first().click();
    await page.waitForTimeout(1500);
    ok(await paneUp(page), `${tag}: choosing an entry of the Contents reads it in the pane`);
    ok((await page.locator('.sh-controls .mode-options-body').count()) === 0 || (await page.locator('.sh-controls .mode-options-body button').filter({ hasText: /^(Open|Close) / }).count()) === 0, `${tag}: still no Open/Close row`);
    await page.screenshot({ path: path.join(out, `${size.name}-${mode.id}-3-reading.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    ok(!(await paneUp(page)), `${tag}: Escape closes the reading`);
    ok((await page.evaluate(() => location.hash)).startsWith(`#/${mode.id}`), `${tag}: Escape keeps the url in the mode`);
    ok(await page.locator('.sh-contents').isVisible(), `${tag}: the Contents remain after Escape`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    const landed = await page.evaluate(() => ({ lens: document.body.dataset.lens, hash: location.hash }));
    // the Theory panel's step out is the Dynamics landing (store.back), as it was before: not the Field
    if (mode.id === 'theory') ok(!landed.hash.startsWith('#/theory'), `${tag}: the second Escape leaves the Theory panel (landed ${landed.hash})`);
    else ok(landed.lens === 'field', `${tag}: the second Escape steps out to the Field (lens ${landed.lens}, ${landed.hash})`);
    ok(logs.length === 0, `${tag}: no console errors (got ${logs.slice(0, 2).join(' | ') || 'none'})`);
  } catch (err) {
    ok(false, `${tag}: the walk threw: ${err.message}`);
  } finally {
    await ctx.close();
  }
}

for (const size of SIZES) {
  for (const mode of MODES) await paneMode(size, mode, `${size.name}/${mode.id}`);
}

await b.close();

console.log('\nper mode:');
for (const r of results) console.log(`  ${r.fails === 0 ? 'PASS' : 'FAIL'}  ${r.tag}  ${r.title ? `title "${r.title}"` : ''}`);
console.log(fails.length ? `\n${fails.length} failure(s)` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
