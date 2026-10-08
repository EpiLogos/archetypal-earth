// Gate (Phase 6): the sky's clock in Aion mode. The equinox ring carries the zodiacal ticks and the spring equinox walks
// backward as the clock plays; the card's "The sky's clock" disclosure sets the conventions beside Jung's boundaries;
// the two clocks are never conflated (opening the disclosure and choosing a convention leave the historical clock alone).
//   npx vite --port 5183 --strictPort &      node tests/ui/e2e/aion-clock.mjs [chromium|webkit]
import { launch, URL } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function openAt(browser, hash, { reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(URL + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__earth?.engine?.presences, null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.aion-ring') && !document.querySelector('.aion')?.hidden, null, { timeout: 30000 });
  await page.waitForTimeout(700);
  return { ctx, page, logs };
}
const year = (page) => page.evaluate(() => window.__earth.model.scale.fromU(window.__earth.time.cursorU));
const go = async (page, y) => { await page.evaluate((v) => window.__earth.time.scrub(window.__earth.model.scale.toU(v)), y); await page.waitForTimeout(250); };
const readout = (page) => page.locator('.aion-ring-read').textContent();
const turn = (page) => page.evaluate(() => Number(/rotate\((-?[\d.]+)/.exec(document.querySelector('.aion-ring-marker').getAttribute('transform'))?.[1] ?? NaN));
const wrap = (d) => ((d % 360) + 360) % 360;

const browser = await launch(kind, { headed: false });
try {
  mainFlow: {
    const { page, logs, ctx } = await openAt(browser, '#/aion/jung-aion');
    check(await page.evaluate(() => !!document.querySelector('.aion-ring') && !document.querySelector('.aion-ring').hidden), 'in Aion mode the equinox ring is there');
    check(await page.evaluate(() => document.querySelector('.aion-ring svg').getAttribute('aria-hidden') === 'true'), 'its drawing is out of the accessibility tree; a sentence says what it shows', await readout(page));
    const labels = await page.evaluate(() => [...document.querySelectorAll('.aion-ring-ticks text')].map((t) => t.textContent));
    check(labels.length === 12 && labels.includes('Psc') && labels.includes('Aqr'), 'the default ring carries twelve sign ticks, named, no glyphs', labels.join(' '));

    await go(page, -1000);
    check(/Aries/.test(await readout(page)), 'at 1000 BCE Jung’s equal months put the equinox in Aries', await readout(page));
    await go(page, 1000);
    check(/Pisces/.test(await readout(page)), 'at 1000 CE in Pisces', await readout(page));
    await go(page, 3000);
    check(/Aquarius/.test(await readout(page)), 'at 3000 CE in Aquarius (a calculation: the readout says by what convention)', await readout(page));

    // the walk: later years turn the marker clockwise, in every convention
    const turns = {};
    for (const c of ['jung-equal', 'fagan-bradley', 'lahiri', 'iau']) {
      await page.selectOption('.aion-ring select', c);
      await go(page, 1500);
      const a = await turn(page);
      await go(page, 1600);
      const b = await turn(page);
      turns[c] = wrap(b - a);
    }
    check(Object.values(turns).every((d) => d > 0 && d < 10), 'later years turn the marker clockwise by a few degrees a century in every convention — it walks backward', JSON.stringify(turns));

    await page.selectOption('.aion-ring select', 'iau');
    const iauLabels = await page.evaluate(() => [...document.querySelectorAll('.aion-ring-ticks text')].map((t) => t.textContent));
    check(iauLabels.length === 13 && iauLabels.includes('Oph'), 'under the IAU convention the ring carries thirteen unequal constellations, Ophiuchus among them', iauLabels.join(' '));
    await go(page, 2026);
    check(/Pisces/.test(await readout(page)) && /IAU constellations/.test(await readout(page)), 'the readout names the convention it speaks in', await readout(page));
    await page.screenshot({ path: `.cache/sky/shots/aion-ring-${kind}-a.png` });

    // it walks as the clock plays
    await page.selectOption('.aion-ring select', 'jung-equal');
    await go(page, 0);
    const t0 = await turn(page);
    await page.evaluate(() => window.__earth.time.play(window.__earth.model.scale.toU(0)));
    await page.waitForTimeout(2500);
    const t1 = await turn(page);
    const playing = await page.evaluate(() => window.__earth.time.playing);
    await page.evaluate(() => window.__earth.time.pause());
    check(wrap(t1 - t0) > 0.5 && wrap(t1 - t0) < 180, 'as the clock plays the equinox moves round the ring', `${t0.toFixed(2)} → ${t1.toFixed(2)} (playing ${playing})`);

    // the clocks are separate: choosing a convention or opening the disclosure does not move the historical clock
    await go(page, 700);
    const before = await year(page);
    await page.selectOption('.aion-ring select', 'lahiri');
    await page.selectOption('.aion-ring select', 'fagan-bradley');
    check(Math.abs((await year(page)) - before) < 0.01, 'choosing a convention leaves the historical clock where it was', `${before.toFixed(2)} → ${(await year(page)).toFixed(2)}`);
    check(logs.length === 0, 'no console errors or warnings', logs.join(' | '));
    await ctx.close();
  }

  cardFlow: {
    const { page, logs, ctx } = await openAt(browser, '#/aion/jung-aion/epoch/pisces');
    await page.waitForSelector('.aion-card .aion-skyclock', { timeout: 10000 });
    check(await page.evaluate(() => !document.querySelector('.aion-skyclock').open), 'the card gains “The sky’s clock”, closed until asked');
    const yearBefore = await year(page);
    await page.locator('.aion-skyclock summary').click();
    await page.waitForTimeout(300);
    const text = await page.locator('.aion-skyclock').innerText();
    const rows = await page.evaluate(() => [...document.querySelectorAll('.aion-skyclock .aion-sc-table')].map((t) => ({ cap: t.querySelector('caption').textContent, rows: [...t.querySelectorAll('tr')].map((r) => [r.querySelector('th').textContent, r.querySelector('td').textContent, r.classList.contains('primary')]) })));
    const signTable = rows.find((r) => /in Pisces/.test(r.cap));
    check(!!signTable && signTable.rows[0][0] === 'Jung’s display boundaries' && signTable.rows[0][2] && /0 CE – 2,200 CE/.test(signTable.rows[0][1]), 'Jung’s display boundaries come first and stay as the reading gives them', JSON.stringify(signTable?.rows[0]));
    const conv = signTable?.rows.slice(1).map((r) => r[0]);
    check(JSON.stringify(conv) === JSON.stringify(['Jung’s equal months', 'Fagan–Bradley sidereal', 'Lahiri sidereal', 'IAU constellations']), 'beside them, each convention by name', JSON.stringify(conv));
    check(signTable.rows.slice(1).every((r) => /c\. |0 CE – 2,143 CE/.test(r[1])), 'every astronomical boundary is labelled approximate or by its arithmetic', signTable.rows.slice(1).map((r) => r[1]).join(' | '));
    const aq = rows.find((r) => /Where Aquarius begins/.test(r.cap));
    const aqText = JSON.stringify(aq?.rows);
    check(!!aq && /1997 CE/.test(aqText) && /2154 CE/.test(aqText) && /2000–2200 CE/.test(aqText) && /very indefinite/.test(aqText), 'the conditional Aquarian boundaries (1997, 2154, the 2000–2200 range) are there as Jung’s calculations', aqText.slice(0, 220));
    check(aq.rows.filter((r) => /leaves Pisces/.test(r[1])).length === 4, 'each convention’s own beginning of Aquarius stands beside them', aq.rows.filter((r) => /leaves Pisces/.test(r[1])).map((r) => r[0] + ' ' + r[1].split(' · ')[0]).join(' | '));
    check(/Nothing here is a forecast/.test(text) && /not an event and not a forecast/.test(text), 'the framing is stated: calculation, not forecast');
    check(/Two clocks: the historical clock is untouched/.test(text), 'the two clocks are named and kept apart');
    check(/Vondrák, Capitaine & Wallace 2011/.test(text) && /IAU 2006/.test(text), 'the method is cited, with the IAU 2006 cross-check');
    check(Math.abs((await year(page)) - yearBefore) < 0.01, 'opening the disclosure leaves the historical clock alone');
    await page.screenshot({ path: `.cache/sky/shots/aion-card-${kind}-a.png` });

    // a child epoch (a fish) inherits Pisces and says no convention divides it
    await page.goto(URL + '#/aion/jung-aion/epoch/pisces-first-fish', { waitUntil: 'load' });
    await page.waitForSelector('.aion-card .aion-skyclock', { timeout: 10000 });
    await page.locator('.aion-skyclock summary').click();
    check(/no astronomical convention divides it/.test(await page.locator('.aion-skyclock').innerText()), 'the two fishes say plainly that no astronomical convention divides Pisces');

    // an event: the 7 BCE conjunction, and a conditional Aquarian calculation
    await page.goto(URL + '#/aion/jung-aion/event/aquarius-alternative-1997', { waitUntil: 'load' });
    await page.waitForSelector('.aion-card .aion-skyclock', { timeout: 10000 });
    await page.locator('.aion-skyclock summary').click();
    const ev = await page.locator('.aion-skyclock').innerText();
    check(/Where Aquarius begins/.test(ev) && /a calculation/.test(ev), 'the 1997 calculation’s card shows Aquarius’s beginnings as calculations', ev.slice(0, 120));
    check(logs.length === 0, 'no console errors or warnings (cards)', logs.join(' | '));
    await ctx.close();
  }

  outside: {
    const { page, ctx } = await openAt(browser, '#/aion/jung-aion', { reduced: true });
    check(await page.evaluate(() => !!document.querySelector('.aion-ring')), 'with reduced motion the ring is the same, there is no transition to shorten');
    await page.goto(URL + '#/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__earth?.engine?.presences, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    check(await page.evaluate(() => { const r = document.querySelector('.aion-ring'); return !!r && !!r.closest('[hidden]'); }), 'outside Aion mode the ring is hidden, out of the keyboard path and the accessibility tree');
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
