// S6, S7, S17: what a lens writes on the time strip, the cite-year axis, and a folio the filter leaves out.
//   - Aion: an epoch is a band, an event a tick, for the standing reading only (jung-aion: 7 bands)
//   - Red Book: 37 folio ticks; the Field and every other lens: none
//   - "Cite years" toggles the strip onto the years of his cites and leaves the clock alone
//   - with a filter on, the Red Book's rail draws the folios it leaves out as filtered, and so does its strip
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/time-marks.mjs
import { launch, open } from './lib.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };
const b = await launch('chromium');

const marks = (page) => page.evaluate(() => ({
  bands: document.querySelectorAll('.t-mark[data-kind="band"]').length,
  ticks: document.querySelectorAll('.t-mark[data-kind="tick"]').length,
  out: document.querySelectorAll('.t-mark.out').length,
}));

// the Field and the lenses with no marks of their own
for (const hash of ['#/', '#/theory', '#/alchemy']) {
  const { ctx, page, logs } = await open(b, { hash });
  await page.waitForTimeout(2500);
  const n = await marks(page);
  ok(n.bands === 0 && n.ticks === 0, `${hash}: the strip carries no marks (${n.bands} bands, ${n.ticks} ticks)`);
  ok(logs.length === 0, `${hash}: no console errors (${logs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// Aion: that reading's epochs as bands, its events as ticks
{
  const { ctx, page, logs } = await open(b, { hash: '#/aion/jung-aion' });
  await page.waitForTimeout(4000);
  const want = await page.evaluate(() => {
    const h = window.__earth.ctl.history;
    const r = h.readings.find((x) => x.id === 'jung-aion');
    return { epochs: r.epochs.length, events: r.events.length };
  });
  const n = await marks(page);
  ok(n.bands === want.epochs && want.epochs === 7, `Aion, jung-aion: its ${want.epochs} epochs are bands (${n.bands})`);
  ok(n.ticks === want.events, `its ${want.events} events are ticks (${n.ticks})`);
  // another reading carries its own
  await page.goto(page.url().replace('jung-aion', 'jung-turn'), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__earth?.ctl, null, { timeout: 20000 });
  await page.waitForTimeout(4000);
  const wantTurn = await page.evaluate(() => { const r = window.__earth.ctl.history.readings.find((x) => x.id === 'jung-turn'); return { epochs: r.epochs.length, events: r.events.length }; });
  const t = await marks(page);
  ok(t.bands === wantTurn.epochs && t.ticks === wantTurn.events, `jung-turn: ${wantTurn.epochs} bands, ${wantTurn.events} ticks (${t.bands}, ${t.ticks})`);
  ok(logs.length === 0, `Aion: no console errors (${logs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// Red Book: 37 folio ticks; a filter dims the folios it leaves out, on the strip and on the rail
{
  const { ctx, page, logs } = await open(b, { hash: '#/redbook' });
  await page.waitForTimeout(3500);
  const n = await marks(page);
  ok(n.ticks === 37 && n.bands === 0 && n.out === 0, `Red Book: 37 folio ticks (${n.ticks}), none out under no filter (${n.out})`);
  // a filter that keeps some folios and drops the rest: the kind of material
  await page.goto('http://localhost:' + new URL(page.url()).port + '/#/redbook/' + await page.evaluate(() => window.__earth.ctl.redbookData.stops[0].id) + '?k=vision', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__earth?.ctl, null, { timeout: 20000 });
  await page.waitForTimeout(3500);
  const f = await page.evaluate(() => {
    const { ctl, model } = window.__earth;
    const mask = ctl.filterMask;
    const stops = ctl.redbookData.stops.map((s) => model.occIndex.get(s.id));
    const out = stops.filter((i) => !mask || mask[i] === 0).length;
    return {
      total: stops.length, out,
      rail: document.querySelectorAll('.ws-frame').length,
      railOut: document.querySelectorAll('.ws-frame.filtered').length,
      stripOut: document.querySelectorAll('.t-mark.out').length,
    };
  });
  ok(f.out > 0 && f.out < f.total, `the filter leaves some folios out and some in (${f.out} of ${f.total} out)`);
  ok(f.rail === 37 && f.railOut === f.out, `the rail keeps all 37 frames and draws ${f.out} as filtered (got ${f.railOut} of ${f.rail})`);
  ok(f.stripOut === f.out, `the strip dims the same ${f.out} ticks (got ${f.stripOut})`);
  await page.screenshot({ path: '.cache/screens/time-marks-redbook-filtered.png' });
  ok(logs.length === 0, `Red Book: no console errors (${logs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// the cite-year axis: a toggle on the strip, a reading apart from the clock
{
  const { ctx, page, logs } = await open(b, { hash: '#/' });
  await page.waitForTimeout(3000);
  const btn = page.locator('.t-axis');
  ok(await btn.isVisible(), 'the strip offers the cite years');
  ok((await btn.getAttribute('aria-pressed')) === 'false', 'off by default');
  const before = await page.evaluate(() => ({ mode: window.__earth.time.mode, cursor: window.__earth.time.cursorU, canvas: document.querySelector('.t-dens').toDataURL() }));
  await btn.click();
  await page.waitForTimeout(500);
  const on = await page.evaluate(() => ({
    pressed: document.querySelector('.t-axis').getAttribute('aria-pressed'),
    cls: document.querySelector('.time').classList.contains('is-axis'),
    eras: [...document.querySelectorAll('.t-era')].map((e) => e.textContent),
    canvas: document.querySelector('.t-dens').toDataURL(),
    counted: window.__earth.ctl.timeControl.citeCounted,
    mode: window.__earth.time.mode, cursor: window.__earth.time.cursorU,
  }));
  ok(on.pressed === 'true' && on.cls, 'the toggle puts the strip on the second axis');
  ok(on.eras.length > 2 && on.eras.every((e) => /^19\d0$/.test(e) || /^20\d0$/.test(e)), `its labels are decades of the cites (${JSON.stringify(on.eras)})`);
  ok(on.canvas !== before.canvas, 'the density is redrawn on his years');
  ok(on.counted > 1000, `it counts the cite years of what stands on the Earth (${on.counted})`);
  // the strip does not scrub the clock while it shows his years
  const box = await page.locator('.t-track').boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + 20);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ mode: window.__earth.time.mode, cursor: window.__earth.time.cursorU }));
  ok(after.mode === on.mode && after.cursor === on.cursor, 'a click on his axis leaves the clock where it was');
  await btn.click();
  await page.waitForTimeout(400);
  const off = await page.evaluate(() => ({ cls: document.querySelector('.time').classList.contains('is-axis'), canvas: document.querySelector('.t-dens').toDataURL(), eras: document.querySelectorAll('.t-era').length }));
  ok(!off.cls && off.canvas === before.canvas && off.eras >= 1, 'toggled back: the dated axis and its eras return unchanged');
  ok(logs.length === 0, `the axis: no console errors (${logs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\ntime marks: all green');
process.exit(fails.length ? 1 : 0);
