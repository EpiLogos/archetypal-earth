// Gate: a sign's glyph in the birth chart opens that sign's field family, the way a tied family opens from a sky card:
// the sky stands behind the reading, and closing it returns to the birth sky. Needs the families (aries…pisces) in the
// field; with none published the walk cannot run and the script says so (exit 2), it does not pass.
//   npx vite --port 5183 --strictPort &   and   ephemeris/run.sh
//   node tests/ui/e2e/sign-glyph-walk.mjs [chromium|webkit]
import { launch, URL } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
// the same fixture the birth-sky gate reads: Zürich, 15 July 1985, 10:20 local (golden "summer time" case)
const BIRTH = '#/sky/birth/1985-07-15T10:20/47.37/8.54';
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__earth.ctl.state)));

const browser = await launch(kind, { headed: false });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(URL + BIRTH, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__earth?.engine?.presences, null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.body.classList.contains('sky-ready'), null, { timeout: 30000 });
  await page.waitForFunction(() => window.__earth.ctl.skyBirthChart && !window.__earth.engine.sky.travelling, null, { timeout: 30000 });
  await page.waitForTimeout(800);

  const published = await page.evaluate(() => window.__earth.model.famById.has('aries'));
  if (!published) {
    console.log(`SKIPPED ${kind} the sign families are not in the field yet (no 'aries' family): the walk cannot run until they are published`);
    await ctx.close();
    process.exit(2);
  }

  // the Aries glyph is a control, its name is its label, and its hit area is at least 44 px square
  const glyph = page.locator('button.sky-chart-btn[aria-label="Aries"]');
  await glyph.waitFor({ state: 'visible', timeout: 15000 });
  check((await glyph.getAttribute('title')) === 'Aries', 'the Aries glyph is a button named Aries, with the name as its tooltip');
  check(await page.evaluate(() => document.querySelector('.sky-chart-mark.sky-chart-btn.on') !== null), 'the glyph controls are live while the chart stands');
  const hit = await page.evaluate(() => {
    const b = document.querySelector('button.sky-chart-btn[aria-label="Aries"]');
    return parseFloat(getComputedStyle(b, '::before').width);
  });
  check(hit >= 44, 'its hit area is at least 44 px square', `${hit}px`);
  const absent = await page.evaluate(() => document.querySelectorAll('span.sky-chart-glyph[aria-hidden="true"]').length);
  check(absent === 0, 'with every family published, no sign is a plain span', `${absent} spans`);

  // click: the Aries family opens as a reading, with the sky behind it
  await glyph.click();
  await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'focus', null, { timeout: 8000 });
  let s = await state(page);
  check(s.view.kind === 'focus' && s.view.subject.type === 'family' && s.view.subject.id === 'aries', 'clicking the Aries glyph opens the Aries family reading', JSON.stringify(s.view.subject));
  check(!!s.from?.sky?.natal, 'the birth sky stands behind the reading (the reading is opened from it)', JSON.stringify(s.from?.sky ?? null));
  check(!!(await page.evaluate(() => window.__earth.ctl.skyBirthChart)), 'the birth chart is still held while the reading is open');

  // close: back to the birth sky
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__earth.ctl.state.view.kind !== 'focus', null, { timeout: 8000 });
  s = await state(page);
  check(s.view.kind === 'world' && !!s.sky?.natal, 'closing the reading returns to the birth sky', JSON.stringify(s.view));

  // the keyboard route: the glyph takes focus and Enter opens the same family again
  await page.evaluate(() => document.querySelector('button.sky-chart-btn[aria-label="Aries"]').focus());
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check(focused === 'Aries', 'the Aries glyph takes keyboard focus', String(focused));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'focus', null, { timeout: 8000 });
  s = await state(page);
  check(s.view.subject?.id === 'aries', 'Enter on the focused glyph opens the Aries reading too');
  await page.keyboard.press('Escape');

  check(logs.length === 0, 'no console errors or warnings', logs.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
