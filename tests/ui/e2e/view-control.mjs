// H3: the View control (Earth | Graph | Sky) is a readout of the camera, and a click asks for the transition the gesture makes.
//   - it reads the route and `data-sky-phase`: Earth, then Sky once the route is in the sky, Sky through the descent, Earth when settled
//   - a click on Sky lifts the camera, on Earth drops it, on Graph takes the graph; the M/S/G keys and a zoom gesture move it the same way
//   - ⚙ answers while the graph's settings or a lens's Options stand on screen, and hides when nothing does
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/view-control.mjs
import { launch, open } from './lib.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };
const b = await launch('chromium');

const read = (page) => page.evaluate(() => {
  const vc = document.querySelector('.view-control');
  const on = vc?.querySelector('.vc-seg[aria-pressed="true"]');
  const gear = document.querySelector('.vc-gear');
  return {
    present: !!vc && vc.getBoundingClientRect().width > 0, view: vc?.dataset.view, pressed: on?.dataset.view, shown: on?.querySelector('.vc-name')?.textContent,
    phase: document.body.dataset.skyPhase ?? null, sky: !!window.__earth.ctl.state.sky, graph: !!window.__earth.ctl.state.graph,
    gear: !!gear && !gear.hidden && gear.getBoundingClientRect().width > 0, hash: location.hash,
  };
});
const click = (page, v) => page.locator(`.view-control [data-view="${v}"]`).click();
const settle = (page, ms = 1500) => page.waitForTimeout(ms);
const until = (page, fn, ms = 14000) => page.waitForFunction(fn, null, { timeout: ms }).then(() => true, () => false);

{
  const { ctx, page, logs } = await open(b, { width: 1440, height: 900, hash: '#/' });
  await settle(page, 2500);
  let r = await read(page);
  ok(r.present && r.view === 'earth' && r.pressed === 'earth' && r.shown === 'Earth', `the Field shows Earth, named (${r.view} / ${r.shown})`);
  ok(!r.gear, 'the ⚙ is hidden while nothing answers it');

  // graph
  await click(page, 'graph');
  await settle(page, 2000);
  r = await read(page);
  ok(r.view === 'graph' && r.graph && await page.evaluate(() => document.body.classList.contains('mode-graph')), `Graph takes the graph (${r.view})`);
  ok(r.gear, 'the ⚙ shows in the graph');
  await page.locator('.vc-gear').click();
  ok(await page.locator('#graph-settings').isVisible(), 'the ⚙ opens the graph settings');
  await page.keyboard.press('Escape');
  await click(page, 'earth');
  await settle(page, 2000);
  r = await read(page);
  ok(r.view === 'earth' && !r.graph, 'Earth takes the graph back to the Earth');

  // sky: the lift
  await click(page, 'sky');
  ok(await until(page, () => window.__earth.ctl.state.sky && document.querySelector('.view-control')?.dataset.view === 'sky'), 'a click on Sky puts the route in the sky and the control reads Sky');
  await settle(page, 4500);
  r = await read(page);
  ok(r.view === 'sky' && r.sky && ['system', 'approach', 'return', 'gaze'].includes(r.phase), `it holds Sky while the camera stands in the sky (phase ${r.phase})`);
  ok(/#\/sky/.test(r.hash), `the route is the live sky (${r.hash})`);

  // the descent: the control keeps reading Sky until the camera settles
  await click(page, 'earth');
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const x = await read(page);
    seen.add(`${x.phase}:${x.view}`);
    if (x.phase === 'settled' && x.view === 'earth') break;
    await page.waitForTimeout(150);
  }
  r = await read(page);
  ok(r.view === 'earth' && !r.sky, `a click on Earth drops the camera and ends at Earth (${[...seen].join(' ')})`);
  ok(!seen.has('descend:earth'), 'it never reads Earth while the camera is still descending');

  // the keys and the zoom move the same readout
  await page.keyboard.press('s');
  ok(await until(page, () => document.querySelector('.view-control')?.dataset.view === 'sky'), 'the S key reads as Sky');
  await settle(page, 3500);
  await click(page, 'earth');
  ok(await until(page, () => document.body.dataset.skyPhase === 'settled' && document.querySelector('.view-control')?.dataset.view === 'earth', 14000), 'and Earth again by the control');
  await page.keyboard.press('g');
  ok(await until(page, () => document.querySelector('.view-control')?.dataset.view === 'graph'), 'the G key reads as Graph');
  await page.keyboard.press('g');
  await settle(page, 1500);

  // a lens's Options answer the ⚙
  await page.goto(page.url().replace(/#.*$/, '#/aion')); await page.reload();
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'));
  await settle(page, 3500);
  r = await read(page);
  ok(!r.present, 'a lens with a camera of its own (Aion) carries no View control');
  ok(!r.gear, 'and, with its reading chosen in the Contents, nothing for the ⚙ to answer');
  // a lens that still carries Options: they answer the ⚙
  await page.goto(page.url().replace(/#.*$/, '#/texts')); await page.reload();
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done'));
  await settle(page, 3500);
  r = await read(page);
  ok(r.gear, 'a lens with Options (Texts) has them answer the ⚙');
  await page.locator('.vc-gear').click();
  ok(await page.evaluate(() => !!document.querySelector('details.mode-options[open]')), 'the ⚙ opens the lens Options');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !document.querySelector('details.mode-options[open]')), 'and Escape closes them');
  ok(logs.length === 0, `no console errors (${logs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// the gesture: zooming out of the Earth enters the sky, and the control reads it
{
  const { ctx, page, logs } = await open(b, { width: 1440, height: 900, hash: '#/' });
  await settle(page, 2500);
  await page.mouse.move(720, 450);
  let sky = false;
  for (let i = 0; i < 40 && !sky; i++) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(120);
    sky = await page.evaluate(() => !!window.__earth.ctl.state.sky);
  }
  await settle(page, 2500);
  const r = await read(page);
  ok(sky && r.view === 'sky', `zooming out enters the sky and the control reads Sky (route sky ${sky}, view ${r.view}, phase ${r.phase})`);
  ok(logs.length === 0, `no console errors (${logs.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// a phone: the control fits beside the lens button and its segments are touch targets
{
  const { ctx, page } = await open(b, { width: 390, height: 844, hash: '#/', mobile: true });
  await settle(page, 2500);
  const m = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); const q = e?.getBoundingClientRect(); return q ? { l: q.left, r: q.right, w: q.width, h: q.height } : null; };
    return { lens: r('.sh-lens'), segs: r('.vc-segs'), corner: r('.sh-corner'), seg: r('.vc-seg'), over: document.documentElement.scrollWidth - innerWidth };
  });
  ok(m.segs && m.lens && m.segs.l >= m.lens.r - 1 && m.segs.r <= m.corner.l, `390: Earth | Graph | Sky sit between the lens button and the corner (${JSON.stringify(m.segs)})`);
  ok(m.seg && m.seg.h >= 43.5 && m.seg.w >= 43.5, `390: a segment is a 44px touch target (${m.seg?.w}×${m.seg?.h})`);
  ok(m.over <= 0, '390: no horizontal overflow');
  await ctx.close();
}
await b.close();
console.log(fails.length ? `${fails.length} failed` : 'all ok');
process.exit(fails.length ? 1 : 0);
