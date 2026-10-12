// Gate: a sign's glyph in the birth chart opens that sign's field family, the way a tied family opens from a sky card:
// the birth sky is what the reading was opened from, and closing it returns to the birth sky. Needs the families (aries…pisces) in the
// field; with none published the walk cannot run and the script says so (exit 2), it does not pass.
//   npx vite --port 5183 --strictPort &   and   ephemeris/run.sh
//   EARTH_URL=http://localhost:5183/ EARTH_HEADLESS=1 node tests/ui/e2e/sign-glyph-walk.mjs [chromium|webkit]
import { launch, open, revealSheet } from './lib.mjs';

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
  // the birth link opens Astrology with the form filled (the sky is always Astrology); casting it is what holds the chart
  const { ctx, page, logs } = await open(browser, { width: 1440, height: 900, hash: BIRTH });
  await revealSheet(page, 'Astrology');
  await page.waitForSelector('.as-form', { timeout: 30000 });
  await page.click('.as-form button[type=submit]');
  await page.waitForFunction(() => location.hash.startsWith('#/astrology/you'), null, { timeout: 15000 });
  await page.waitForFunction(() => document.body.classList.contains('sky-ready'), null, { timeout: 30000 });
  await page.waitForFunction(() => window.__earth.ctl.skyNatalChart && !window.__earth.engine.sky.travelling, null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const published = await page.evaluate(() => window.__earth.model.famById.has('aries'));
  if (!published) {
    console.log(`SKIPPED ${kind} the sign families are not in the field yet (no 'aries' family): the walk cannot run until they are published`);
    await ctx.close();
    process.exit(2);
  }

  // a glyph is shown only where the ring stands before the camera and is drawn large enough (which signs are in view depends
  // on the chart's own orientation), so the walk takes the first sign that is shown, not a fixed one
  const SIGN = await page.evaluate(() => document.querySelector('button.sky-chart-btn.on')?.getAttribute('aria-label') ?? null);
  check(!!SIGN, 'at least one sign glyph is shown on the ring', String(SIGN));
  if (!SIGN) throw new Error('no sign glyph is shown');
  const FAMILY = SIGN.toLowerCase();
  const sel = `button.sky-chart-btn[aria-label="${SIGN}"]`;
  // its glyph is a control, its name is its label, and its hit area is at least 44 px square
  const glyph = page.locator(sel);
  await glyph.waitFor({ state: 'visible', timeout: 15000 });
  check((await glyph.getAttribute('title')) === SIGN, `the ${SIGN} glyph is a button named ${SIGN}, with the name as its tooltip`);
  check(await page.evaluate(() => document.querySelector('.sky-chart-mark.sky-chart-btn.on') !== null), 'the glyph controls are live while the chart stands');
  const hit = await page.evaluate((sel) => {
    const b = document.querySelector(sel);
    return parseFloat(getComputedStyle(b, '::before').width);
  }, sel);
  check(hit >= 44, 'its hit area is at least 44 px square', `${hit}px`);
  const absent = await page.evaluate(() => document.querySelectorAll('span.sky-chart-glyph[aria-hidden="true"]').length);
  check(absent === 0, 'with every family published, no sign is a plain span', `${absent} spans`);

  // click: the sign's family opens as a reading, with the sky behind it
  await glyph.click();
  await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'focus', null, { timeout: 8000 });
  let s = await state(page);
  check(s.view.kind === 'focus' && s.view.subject.type === 'family' && s.view.subject.id === FAMILY, `clicking the ${SIGN} glyph opens the ${SIGN} family reading`, JSON.stringify(s.view.subject));
  check(!!s.from?.sky?.natal, 'the birth sky stands behind the reading (the reading is opened from it)', JSON.stringify(s.from?.sky ?? null));
  // the reading descends to the Earth, so the sky layer lets its chart go; the state it was opened from keeps the chart's id
  // (asserted above, `from.sky.natal`) and closing the reading returns to it, the chart cast again

  // the descent carries the sign's reading (it opens on the landing); Escape closes it onto the node, a second returns to the
  // birth sky
  await page.waitForFunction(() => window.__earth.ctl.state.deep && document.body.classList.contains('deep-open'), null, { timeout: 15000 });
  check(true, `the ${SIGN} reading opens by itself on the landing`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__earth.ctl.state.deep, null, { timeout: 8000 });
  s = await state(page);
  check(s.view.kind === 'focus' && !!s.from?.sky?.natal, 'the first Escape closes the reading onto the sign, the birth sky still behind');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__earth.ctl.state.view.kind !== 'focus', null, { timeout: 8000 });
  s = await state(page);
  check(s.view.kind === 'world' && !!s.sky?.natal, 'closing the reading returns to the birth sky', JSON.stringify(s.view));
  await page.waitForFunction(() => window.__earth.ctl.skyNatalChart && !window.__earth.engine.sky.travelling, null, { timeout: 30000 }).catch(() => {});
  check(!!(await page.evaluate(() => window.__earth.ctl.skyNatalChart)), 'and the birth chart is held again');

  // the keyboard route: the glyph takes focus and Enter opens the same family again (the ring's glyphs stand once the
  // return has settled)
  await page.waitForSelector(sel, { state: 'visible', timeout: 20000 });
  await page.evaluate((sel) => document.querySelector(sel).focus(), sel);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check(focused === SIGN, `the ${SIGN} glyph takes keyboard focus`, String(focused));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'focus', null, { timeout: 8000 });
  s = await state(page);
  check(s.view.subject?.id === FAMILY, `Enter on the focused glyph opens the ${SIGN} reading too`);
  await page.keyboard.press('Escape');

  check(logs.length === 0, 'no console errors or warnings', logs.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
