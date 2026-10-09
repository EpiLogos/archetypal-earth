// Gate: the transport button's label follows the walk — a paused thread walk that ends leaves "Play history", not
// "Resume tour" (audit W4).
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/transport-label.mjs [chromium|webkit]
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

const label = (page) => page.evaluate(() => {
  const b = document.querySelector('.t-play');
  return { label: b?.getAttribute('aria-label'), title: b?.title, hash: location.hash };
});

const browser = await launch(kind, { headed: false });
try {
  const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/t/serpent' });
  await page.waitForFunction(() => document.querySelector('.t-play')?.getAttribute('aria-label') === 'Pause tour', null, { timeout: 20000 }).catch(() => {});
  const walking = await label(page);
  check(walking.label === 'Pause tour', 'a thread walk stands with "Pause tour"', `label "${walking.label}"`);
  await page.click('.t-play');
  await page.waitForFunction(() => document.querySelector('.t-play')?.getAttribute('aria-label') === 'Resume tour', null, { timeout: 10000 }).catch(() => {});
  const paused = await label(page);
  check(paused.label === 'Resume tour' && paused.title === 'Resume the walk', 'paused, the button offers to resume the walk', `label "${paused.label}", title "${paused.title}"`);
  // the walk is gone while paused: back to the plain world
  await page.evaluate(() => window.__earth.ctl.navigate({ view: { kind: 'world' }, deep: false }));
  await page.waitForTimeout(800);
  const after = await label(page);
  check(after.label === 'Play history' && after.title === 'Play history', 'with the walk gone the button is "Play history" again', `label "${after.label}", title "${after.title}"`);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
