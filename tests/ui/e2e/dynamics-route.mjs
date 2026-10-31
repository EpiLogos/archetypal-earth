// The dynamical lens walks Van Eenwyk: an overview of four movements, then sixteen stops, each drawn as the system it
// names (a native figure that moves, still under reduced motion), with his words (V), Jung's (J), Neumann's (N) where
// he speaks to it, and the QL framework's own (QL) at the end. The globe shows the lens's own set and says so; the
// address names the stop; the arrow keys and the pane's stepper walk on. The route is read in the reading pane; its Contents
// (the Theory mode's one list) open it.
//   EARTH_HEADLESS=1 node tests/ui/e2e/dynamics-route.mjs
import fs from 'node:fs';
import { launch, open } from './lib.mjs';

const ROUTE_TITLE = JSON.parse(fs.readFileSync(new URL('../../../public/data/dynamics-route.json', import.meta.url), 'utf8')).title;

// this gate reads the figure's pixels back itself; the browser's advice about that readback is the test's, not the app's
const appLogs = (logs) => logs.filter((l) => !/Multiple readback operations using getImageData/.test(l));

let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const browser = await launch('chromium');
const shots = process.env.SHOTS;
const drawn = (page) => page.evaluate(() => { const t = window.__earth.engine.presences.relTarget; return Array.from(t).filter((v) => v >= 0.035).length; });
const figure = (page) => page.evaluate(() => {
  const c = document.querySelector('.dy-hero-canvas');
  if (!c || !c.width) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ink = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4 * 7) { const v = d[i] + d[i + 1] + d[i + 2]; sum = (sum * 31 + v) % 1e9; if (v > 120) ink++; }
  return { ink, sum };
});

for (const [w, h, tag] of [[1280, 860, 'desk'], [390, 844, 'phone']]) {
  const { ctx, page, logs } = await open(browser, { width: w, height: h, hash: '#/dynamics', mobile: w < 500 });
  await page.waitForTimeout(6500);
  // Theory lands with its Contents waiting (no reading, no Options row for either route); the route's overview is an entry of it
  check(await page.locator('.sh-contents').isVisible(), `${tag}: the landing offers the Contents`);
  check(!(await page.locator('body.pane-reading').count()), `${tag}: the landing reads nothing yet`);
  await page.locator('.sh-contents').click();
  await page.waitForTimeout(500);
  await page.locator('.dp-contents-pane li button', { hasText: ROUTE_TITLE }).first().click();
  await page.waitForTimeout(2500);
  check(await page.locator('body.pane-reading').count() === 1, `${tag}: the overview is read in the pane`);
  check(await page.locator('.dy-route-dot').count() === 16, `${tag}: the overview maps the route, sixteen stops in four movements`);
  const line = (await page.locator('.sh-chip.scope').textContent().catch(() => '')) ?? '';
  const own = Number((/^([\d,]+) in/.exec(line)?.[1] ?? '0').replace(/,/g, ''));
  check(/in the route’s families/.test(line) && own > 0 && own < (await page.evaluate(() => Array.from(window.__earth.ctl.m.located).filter(Boolean).length)) * 0.5, `${tag}: the globe shows the lens's own set and names it`, `${line} · ${await drawn(page)} drawn`);
  await page.locator('.th-walk').click();
  await page.waitForTimeout(2500);
  check(/#\/dynamics\/s\/alternating-current$/.test(page.url()), `${tag}: the walk begins with energy between poles`, page.url());
  const f1 = await figure(page);
  check(!!f1 && f1.ink > 200, `${tag}: the stop is drawn as the system it names`, `${f1?.ink} lit samples`);
  await page.waitForTimeout(700);
  const f2 = await figure(page);
  check(f1 && f2 && f1.sum !== f2.sum, `${tag}: the figure moves`);
  const chips = await page.locator('.dy-reading .q-voice').allTextContents();
  check(chips.length >= 1 && chips.every((c) => c === 'Van Eenwyk'), `${tag}: Van Eenwyk is named where he speaks; Jung wears no chip`, chips.join(' '));
  const line2 = (await page.locator('.sh-chip.scope').textContent().catch(() => '')) ?? '';
  check(/“Energy as an oscillation between poles”/.test(line2), `${tag}: the globe tunes to the stop's families`, line2);
  if (shots) await page.screenshot({ path: `${shots}/dy-${tag}-stop.png` });
  // walk to centroversion: Neumann beside Jung
  await page.evaluate(() => { location.hash = '#/dynamics/s/self-organization'; });
  await page.waitForTimeout(2500);
  const chips2 = await page.locator('.dy-reading .q-voice').allTextContents();
  check(chips2.includes('Neumann') && /Centroversion/.test((await page.locator('.dy-reading').textContent()) ?? ''), `${tag}: Neumann speaks where he speaks to it`, chips2.join(' '));
  await page.locator('.dy-route-dot[aria-label="The 4+2 and its return"]').click();
  await page.waitForTimeout(2500);
  const ql = await page.locator('.dy-reading .q-ql .q-cite').allTextContents();
  check(/ql-cycle$/.test(page.url()) && ql.length === 3 && ql.every((t) => /epi-logos\.org · § [IV]+/.test(t)), `${tag}: the route ends on the QL framework's cycle, in the published site's words`, ql.join(' | '));
  if (shots) await page.screenshot({ path: `${shots}/dy-${tag}-ql.png` });
  if (w > 500) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1500);
    check(/alternating-current$/.test(page.url()), `${tag}: the arrow key walks on (and round)`, page.url());
  }
  // the pane's stepper walks the same route: forward from the first stop, back past the first to the last (the rail's wrap)
  await page.evaluate(() => { location.hash = '#/dynamics/s/alternating-current'; });
  await page.waitForTimeout(1800);
  check((await page.locator('.pane-foot .pane-count').textContent()) === '1 / 16', `${tag}: the stepper stands at 1 / 16`);
  await page.locator('.pane-foot [aria-label="Next stop"]').click();
  await page.waitForTimeout(1800);
  check(/#\/dynamics\/s\/homoclinic-point$/.test(page.url()) && (await page.locator('.pane-foot .pane-count').textContent()) === '2 / 16', `${tag}: the stepper walks on in the route's own order`, page.url());
  await page.locator('.pane-foot [aria-label="Previous stop"]').click();
  await page.locator('.pane-foot [aria-label="Previous stop"]').click();
  await page.waitForTimeout(1800);
  check(/#\/dynamics\/s\/ql-cycle$/.test(page.url()), `${tag}: back past the first stop comes the last`, page.url());
  // closing the reading stays in the mode: the Contents wait on the landing
  await page.locator('section.deep:not(.passage):not(.you-sheet) .dp-close').click();
  await page.waitForTimeout(1500);
  check(/#\/dynamics$/.test(page.url()) && !(await page.locator('body.pane-reading').count()) && await page.locator('.sh-contents').isVisible(), `${tag}: closing the reading stays in the mode, Contents waiting`, page.url());
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(scroll <= 0, `${tag}: no horizontal scroll`, String(scroll));
  check(!appLogs(logs).length, `${tag}: no page errors`, appLogs(logs).slice(0, 2).join(' | '));
  await ctx.close();
}
{
  const { ctx, page, logs } = await open(browser, { width: 1280, height: 860, hash: '#/dynamics/f/serpent/s/cascade-into-chaos' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(6500);
  const line = (await page.locator('.sh-chip.scope').textContent().catch(() => '')) ?? '';
  check(/Serpent and “Oscillation cascading into chaos”/.test(line), 'a chosen subject joins the stop on the globe', line);
  const a = await figure(page);
  await page.waitForTimeout(800);
  const b = await figure(page);
  check(a && b && a.ink > 200, 'the logistic map is drawn', `${a?.ink} lit samples`);
  check(!appLogs(logs).length, 'deep link: no page errors', appLogs(logs).slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
