// Gate (Phase 5): the birth sky, end to end in the page. A date, a time and a place go in; the sidecar's chart comes
// back; the bodies fly to the natal longitudes it states; every body reads back through its mythic node; the moment is
// a link that restores; and without the sidecar the disclosure stays, labelled and disabled, and nothing else breaks.
//   npx vite --port 5183 --strictPort &   and   ephemeris/run.sh
//   node tests/ui/e2e/sky-birth.mjs [chromium|webkit]
import { readFileSync } from 'node:fs';
import { launch, URL } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const golden = JSON.parse(readFileSync(new globalThis.URL('../../sky/golden/birth.json', import.meta.url), 'utf8'));
const jung = golden.cases.find((c) => /pre-1900/.test(c.label));
const summer = golden.cases.find((c) => /summer time/.test(c.label));
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

async function openAt(browser, hash, { blockSidecar = false, reduced = false, width = 1440, height = 900, needSky = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  if (blockSidecar) await page.route(/127\.0\.0\.1:5187/, (r) => r.abort('connectionrefused'));
  await page.goto(URL + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__earth?.engine?.presences, null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
  if (needSky) await page.waitForFunction(() => document.body.classList.contains('sky-ready'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return { ctx, page, logs };
}
const settled = (page, timeout = 30000) => page.waitForFunction(() => window.__earth.ctl.skyBirthChart && !window.__earth.engine.sky.travelling, null, { timeout });
const hash = (page) => page.evaluate(() => decodeURIComponent(location.hash));
/** where each body stands now, as ecliptic longitude seen from the Earth, from the layer's own poses */
const longitudes = (page) => page.evaluate(() => {
  const out = {};
  for (const [k, v] of window.__earth.engine.sky.poses) if (k !== 'earth') out[k] = (((Math.atan2(v[1], v[0]) * 180) / Math.PI) + 360) % 360;
  return out;
});

const browser = await launch(kind, { headed: false });
try {
  // ── A: the whole path through the form, in the page ──
  {
    const { page, logs, ctx } = await openAt(browser, '#/sky');
    check(await page.evaluate(() => document.querySelector('.sky-birth')?.dataset.availability === 'ready'), 'with the sidecar running, the Birth sky disclosure is ready');
    await page.waitForFunction(() => !!document.querySelector('.sky-birth summary'));
    await page.locator('.sky-birth summary').click();
    const frame = await page.locator('.sky-birth-frame').textContent();
    check(frame === 'the sky at that moment, read in Jung\u2019s keys', 'the framing sentence is exactly the one fixed in the spec', frame);
    const limits = await page.locator('.sky-birth-limits').textContent();
    check(/no forecast/.test(limits) && /no verdict/.test(limits), 'the limits are stated beside it: no forecast, no verdict', limits);

    await page.fill('input[name=date]', '1985-07-15');
    await page.fill('input[name=time]', '10:20');
    await page.fill('input[name=place]', 'zur');
    await page.waitForSelector('.sky-birth-suggest button[data-choice]');
    const suggestions = await page.$$eval('.sky-birth-suggest button[data-choice]', (b) => b.map((x) => x.textContent));
    check(suggestions[0]?.startsWith('Zürich'), 'typing "zur" offers Zürich from the gazetteer first, accents folded', suggestions.join(' | '));
    await page.locator('.sky-birth-suggest button[data-choice]').first().click();
    const filled = await page.evaluate(() => ({ lat: document.querySelector('input[name=lat]').value, lon: document.querySelector('input[name=lon]').value, place: document.querySelector('input[name=place]').value }));
    check(filled.lat === '47.37' && filled.lon === '8.54' && /Zürich/.test(filled.place), 'choosing it fills the coordinates', JSON.stringify(filled));

    const before = await longitudes(page);
    const momentBefore = await page.evaluate(() => window.__earth.engine.sky.moment);
    await page.locator('.sky-birth-cast').click();
    await page.waitForFunction(() => window.__earth.engine.sky.travelling, null, { timeout: 15000 }).catch(() => {});
    const travelled = await page.evaluate(() => window.__earth.engine.sky.travelling);
    check(travelled, 'the bodies are seen travelling (a flight, not a jump)');
    await page.waitForTimeout(1200);
    const mid = await longitudes(page);
    const moved = Object.keys(mid).filter((k) => Math.abs(wrap180(mid[k] - before[k])) > 0.5).length;
    check(moved >= 3, 'mid-flight the bodies have left their present longitudes', `${moved} moved`);
    await settled(page);

    const h = await hash(page);
    check(h === '#/sky/birth/1985-07-15T10:20/47.37/8.54', 'the moment is a link', h);
    const chart = await page.evaluate(() => window.__earth.ctl.skyBirthChart);
    check(JSON.stringify(chart) === JSON.stringify(summer.chart), 'the chart the page received is the golden chart, byte for byte');
    const after = await longitudes(page);
    const worst = Math.max(...Object.entries(chart.bodies).map(([k, p]) => Math.abs(wrap180(after[k] - p.lon))));
    check(worst < 0.012, 'every body ends at the natal longitude the chart states (≤ 0.012°)', `worst ${worst.toFixed(4)}°`);
    const momentAfter = await page.evaluate(() => window.__earth.engine.sky.moment);
    check(momentAfter === Date.parse(chart.utc) && momentAfter !== momentBefore, 'the sky stands at the chart\u2019s instant, no longer at the clock');
    check(await page.evaluate(() => document.querySelector('.sky-live')?.dataset.state === 'held' && /does not follow the clock/.test(document.querySelector('.sky-live').textContent)), 'the live note says the sky is held, not live');
    await page.waitForTimeout(2200);
    check(Math.abs((await page.evaluate(() => window.__earth.engine.sky.moment)) - Date.parse(chart.utc)) === 0, 'the held moment does not drift with the clock');

    const rows = await page.$$eval('.sky-birth-rows li', (li) => li.map((x) => ({ body: x.dataset.body, text: x.textContent, descend: !!x.querySelector('.sky-birth-descend') })));
    check(rows.length === 10, 'ten bodies read back', rows.map((r) => r.body).join(','));
    check(rows.every((r) => r.descend), 'every body links down through a mythic node', rows.filter((r) => !r.descend).map((r) => r.body).join(','));
    check(/Zürich|Europe\/Zurich/.test(await page.locator('.sky-birth-when').textContent()), 'the zone the sidecar resolved is stated', await page.locator('.sky-birth-when').textContent());
    check(await page.evaluate(() => !document.querySelector('.sky-birth-approx')), 'a modern chart carries no approximation note');
    const marks = await page.$$eval('.sky-chart-mark.on', (m) => m.map((x) => x.textContent));
    check(marks.includes('Aries') && marks.includes('Asc') && marks.includes('MC'), 'the ring wears its sign names and the two angles', marks.join(' '));
    await page.screenshot({ path: `.cache/sky/shots/birth-${kind}-a.png` });

    // aspects and houses: off until asked
    const op = () => page.evaluate(() => { const c = window.__earth.engine.sky.chart; return { aspects: c.aspects?.visible ?? false, houses: c.houses?.visible ?? false, drawn: { ...c.drawn } }; });
    const off = await op();
    check(!off.aspects && !off.houses && !off.drawn.aspects && !off.drawn.houses, 'aspect arcs and the houses ring are off by default', JSON.stringify(off));
    await page.locator('.sky-birth-draw input').nth(0).check();
    await page.locator('.sky-birth-draw input').nth(1).check();
    await page.waitForTimeout(300);
    const on = await op();
    check(on.aspects && on.houses, 'each is drawn when asked', JSON.stringify(on));
    await page.screenshot({ path: `.cache/sky/shots/birth-${kind}-b.png` });
    await page.locator('.sky-birth-draw input').nth(0).uncheck();
    await page.waitForTimeout(300);
    check(!(await op()).aspects, 'and goes again when unasked');

    // a body's card inside the birth sky
    await page.locator('.sky-birth-rows li[data-body=sun] .sky-birth-name').click();
    await page.waitForSelector('.sky-card.on .rv-name', { timeout: 8000 });
    const card = await page.locator('.sky-card').innerText();
    check(/at the birth moment, 1985-07-15 08:20 UTC/.test(card), 'the Sun\u2019s card reads for the birth moment', card.match(/Leo[^\n]*/)?.[0]);
    check(/Sun and Moon at that moment/i.test(card) && !/Next conjunction/.test(card), 'its pair block speaks of that moment and asks for no "next" event');
    check((await hash(page)).startsWith('#/sky/birth/1985-07-15T10:20/47.37/8.54/sun'), 'the link keeps the birth and adds the body', await hash(page));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // the way down: through Mercury's node into the field
    const mercury = await page.evaluate(() => document.querySelector('.sky-birth-rows li[data-body=mercury] .sky-birth-descend')?.textContent);
    await page.locator('.sky-birth-rows li[data-body=mercury] .sky-birth-descend').click();
    await page.waitForTimeout(1500);
    const down = await hash(page);
    check(/^#\/(f|a)\//.test(down), 'a body\u2019s node leads down to the field', `${mercury} → ${down}`);
    check(logs.length === 0, 'no console errors or warnings', logs.join(' | '));
    await ctx.close();
  }

  // ── B: a link restores the sky, and a pre-1900 time says it is approximate ──
  {
    const link = '#/sky/birth/1875-07-26T19%3A32/47.55/9.32';
    const { page, logs, ctx } = await openAt(browser, link);
    await settled(page);
    const chart = await page.evaluate(() => window.__earth.ctl.skyBirthChart);
    check(JSON.stringify(chart) === JSON.stringify(jung.chart), 'a pre-1900 link restores the golden chart exactly');
    const approx = await page.locator('.sky-birth-approx').first().textContent();
    check(/^Approximate: Before 1900/.test(approx), 'a pre-1900 local time is labelled approximate, with the reason', approx);
    const form = await page.evaluate(() => ({ d: document.querySelector('input[name=date]').value, t: document.querySelector('input[name=time]').value, p: document.querySelector('input[name=place]').value, open: document.querySelector('.sky-birth').open }));
    check(form.d === '1875-07-26' && form.t === '19:32' && /Kesswil/.test(form.p) && form.open, 'the form holds what the link said, and the disclosure is open', JSON.stringify(form));
    const lon = await longitudes(page);
    const worst = Math.max(...Object.entries(chart.bodies).map(([k, p]) => Math.abs(wrap180(lon[k] - p.lon))));
    check(worst < 0.012, 'arriving by link puts the bodies at the natal longitudes too', `worst ${worst.toFixed(4)}°`);
    const earthLit = await page.evaluate(() => { const e = window.__earth.engine; return { known: e.sky.sunKnown }; });
    check(earthLit.known, 'the Earth is lit by the Sun of that moment (a window the sidecar supplied)');
    check(logs.length === 0, 'no console errors or warnings (link)', logs.join(' | '));

    // leaving returns the sky to the clock
    await page.locator('.sky-birth-leave').click();
    await page.waitForFunction(() => !window.__earth.ctl.skyBirthChart && !window.__earth.engine.sky.travelling, null, { timeout: 15000 });
    const h = await hash(page);
    const m = await page.evaluate(() => window.__earth.engine.sky.moment);
    check(h === '#/sky', 'leaving the birth sky returns to the plain sky link', h);
    check(Math.abs(m - Date.now()) < 5 * 60_000, 'and the sky returns to the clock', `${Math.round((m - Date.now()) / 1000)} s from now`);
    check(await page.evaluate(() => document.querySelector('.sky-live')?.dataset.state !== 'held'), 'the live note is the live note again');
    check(await page.evaluate(() => document.querySelectorAll('.sky-birth-rows li').length === 0), 'the chart readout is gone');
    await ctx.close();
  }

  // ── C: the sidecar's refusals are said, and the state does not claim a sky that is not shown ──
  {
    const { page, ctx } = await openAt(browser, '#/sky');
    await page.locator('.sky-birth summary').click();
    await page.fill('input[name=date]', '1400-03-01');
    await page.fill('input[name=time]', '12:00');
    await page.fill('input[name=lat]', '47.37');
    await page.fill('input[name=lon]', '8.54');
    await page.locator('.sky-birth-cast').click();
    await page.waitForFunction(() => /1549/.test(document.querySelector('.sky-birth-status')?.textContent ?? ''), null, { timeout: 15000 });
    const msg = await page.locator('.sky-birth-status').textContent();
    check(/1549–2650/.test(msg) && /DE440/.test(msg), 'a date outside the kernel is refused with the range stated', msg);
    check((await hash(page)) === '#/sky', 'and the link falls back to the present sky', await hash(page));
    await page.fill('input[name=date]', '2025-02-30');
    await page.fill('input[name=time]', '12:00');
    await page.locator('.sky-birth-cast').click();
    await page.waitForTimeout(300);
    const bad = await page.locator('.sky-birth-status').textContent();
    check(/does not exist in the calendar/.test(bad), 'a date that does not exist is refused before any request', bad);
    await page.fill('input[name=date]', '1985-07-15');
    await page.fill('input[name=time]', '25:00');
    await page.locator('.sky-birth-cast').click();
    check(/not a time on the clock/.test(await page.locator('.sky-birth-status').textContent()), 'a time that is not a clock is refused, saying so');
    await ctx.close();
  }

  // ── D: without the sidecar: labelled, disabled, and everything else stands ──
  {
    const { page, logs, ctx } = await openAt(browser, '#/sky', { blockSidecar: true });
    await page.waitForFunction(() => document.querySelector('.sky-birth')?.dataset.availability === 'off', null, { timeout: 15000 });
    await page.locator('.sky-birth summary').click();
    const notice = await page.locator('.sky-birth-notice').textContent();
    check(/sidecar is not running/.test(notice) && /ephemeris\/run\.sh/.test(notice), 'absence is a labelled notice that says how to start it', notice);
    const dis = await page.evaluate(() => ({ form: !!document.querySelector('.sky-birth-form').closest('[inert]') || document.querySelector('.sky-birth-form').hasAttribute('inert'), cast: document.querySelector('.sky-birth-cast').disabled, date: document.querySelector('input[name=date]').disabled }));
    check(dis.form && dis.cast && dis.date, 'the form is inert and its controls disabled', JSON.stringify(dis));
    check(await page.evaluate(() => document.querySelectorAll('.sky-label').length >= 10 && !!document.querySelector('.sky-live')), 'the rest of the sky stands (labels and the live note)');
    check(await page.evaluate(() => document.querySelector('.sky-live')?.dataset.state === 'snapshot'), 'and the clock is a labelled snapshot');
    await ctx.close();
  }
  {
    // a birth link with no sidecar: the sky stays the present sky, with the reason on screen
    const { page, ctx } = await openAt(browser, '#/sky/birth/1985-07-15T10:20/47.37/8.54', { blockSidecar: true });
    await page.waitForFunction(() => /not running/.test(document.querySelector('.sky-birth-status')?.textContent ?? ''), null, { timeout: 15000 });
    check((await hash(page)) === '#/sky', 'a birth link without the sidecar falls back to the present sky', await hash(page));
    check(await page.evaluate(() => !window.__earth.ctl.skyBirthChart), 'and no chart is claimed');
    await ctx.close();
  }

  // ── E: reduced motion: the arrival is instant ──
  {
    const { page, ctx } = await openAt(browser, '#/sky', { reduced: true });
    await page.locator('.sky-birth summary').click();
    await page.fill('input[name=date]', '1985-07-15');
    await page.fill('input[name=time]', '10:20');
    await page.fill('input[name=lat]', '47.37');
    await page.fill('input[name=lon]', '8.54');
    await page.locator('.sky-birth-cast').click();
    await page.waitForFunction(() => window.__earth.ctl.skyBirthChart, null, { timeout: 15000 });
    check(await page.evaluate(() => !window.__earth.engine.sky.travelling), 'with reduced motion the bodies arrive without a flight');
    await ctx.close();
  }

  // ── F: inactive panels are out of the keyboard path and the accessibility tree ──
  {
    const { page, ctx } = await openAt(browser, '#/', { needSky: false });
    check(await page.evaluate(() => { const i = document.querySelector('.sky-birth input'); return !i || !!i.closest('[inert]'); }), 'with the sky off, the birth form is inert');
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
