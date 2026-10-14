// Gate: a reading opens at its top. A sheet hidden while it was scrolled gave back that offset on the next open
// (the scrollTop reset ran while the sheet was still display:none), so a reading opened part-way down.
//   npx vite --port 5183 --strictPort &
//   node tests/ui/e2e/reading-scroll.mjs
import { launch, open } from './lib.mjs';

let failed = 0;
const check = (ok, label, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); };

const browser = await launch('chromium');
const { ctx, page } = await open(browser, { width: 1280, height: 720, hash: '#/a/anima' });
const top = () => page.evaluate(() => document.querySelector('.deep:not(.passage) .dp-scroll')?.scrollTop ?? -1);
const openReading = async (hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(2500);
  await page.getByText('Reading', { exact: true }).first().click();
  await page.waitForTimeout(1200);
};

await openReading('#/a/anima');
await page.mouse.move(900, 400);
await page.mouse.wheel(0, 700);
await page.waitForTimeout(800);
check((await top()) > 300, 'the first reading scrolls', `scrollTop ${await top()}`);

await page.getByRole('button', { name: 'Close reading' }).click();
await page.waitForTimeout(1000);
await openReading('#/a/great-mother');
check((await top()) === 0, 'another subject’s reading opens at its top', `scrollTop ${await top()}`);

await page.mouse.wheel(0, 700);
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Close reading' }).click();
await page.waitForTimeout(1000);
await openReading('#/a/great-mother');
check((await top()) === 0, 'the same reading, reopened, opens at its top', `scrollTop ${await top()}`);

await ctx.close();
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
