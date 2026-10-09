// Gate (Phase 3): sky anchors in the graph. Off by default and absent when off; on, the bodies stand on an outer ring at
// their true geocentric ecliptic longitudes, the Self keeps the centre, relation filters thin the strands, Reframe still
// frames everything, time playback and the local cap are untouched; the layout is reproducible.
//   npx vite --port 5183 --strictPort &
//   node tests/ui/e2e/sky-graph.mjs [chromium|webkit]
import { mkdirSync } from 'node:fs';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const shots = '.cache/sky/shots';
mkdirSync(shots, { recursive: true });
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};
const stats = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__earth.ctl.graph.stats)));
const world = (page, keys) => page.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, window.__earth.ctl.graph.worldOf(k)])), keys);
const openSettings = async (page) => {
  if (await page.locator('#graph-settings').isHidden()) await page.locator('.gvt-settings').click();
};
const sky = (page) => page.locator('.gvt-sky');
const turnOn = async (page) => {
  await openSettings(page);
  await sky(page).click();
  await page.waitForFunction(() => window.__earth.ctl.graph.stats.sky === 'on', null, { timeout: 15000 });
};
const settle = async (page, ticks = 500) => {
  await page.evaluate((n) => window.__earth.ctl.graph.settle(n), ticks);
  await page.waitForTimeout(400);
};
const FIELD_KEYS = ['a:self', 'a:hero', 'a:shadow', 'f:serpent'];

const browser = await launch(kind, { headed: false });
try {
  // ── off by default, and the field is exactly what it was ──
  const { page, logs } = await open(browser, { width: 1440, height: 900, hash: '#/graph' });
  await page.waitForFunction(() => window.__earth.ctl.graph.isVisible);
  await page.waitForTimeout(1500);
  const s0 = await stats(page);
  check(s0.sky === 'off' && s0.bodies === 0 && s0.skyEdges === 0, 'Sky anchors are off by default: no body, no sky strand', JSON.stringify({ sky: s0.sky, bodies: s0.bodies }));
  await openSettings(page);
  check((await sky(page).getAttribute('aria-pressed')) === 'false', 'the Settings toggle reads off');
  const fieldNodes = s0.nodes;
  await page.keyboard.press('Escape');

  // ── on: bodies, ring, longitudes ──
  await turnOn(page);
  const s1 = await stats(page);
  check(s1.bodies === 10, 'ten bodies hang from the graph (the Earth is where we stand)', `bodies=${s1.bodies}`);
  check(s1.nodes === fieldNodes + 10, 'the field keeps every node it had', `${fieldNodes} → ${s1.nodes}`);
  check(s1.skyEdges > 0, 'each recorded tie becomes a strand', `skyEdges=${s1.skyEdges}`);
  await settle(page);
  const keys = ['b:sun', 'b:moon', 'b:mars', 'b:pluto'];
  const w = await world(page, [...FIELD_KEYS, ...keys]);
  const truth = await page.evaluate(async () => {
    const { SkyEphemeris } = await import('/src/sky/ephemeris.ts');
    const d = await (await fetch('/data/sky.json')).json();
    const e = new SkyEphemeris(d);
    const ms = Date.now();
    return Object.fromEntries(['sun', 'moon', 'mars', 'pluto'].map((k) => [k, e.geo(k, ms).lon]));
  });
  for (const k of ['sun', 'moon', 'mars', 'pluto']) {
    const p = w[`b:${k}`];
    const r = Math.hypot(p.x, p.y);
    const lon = ((Math.atan2(-p.y, p.x) * 180) / Math.PI + 360) % 360;
    const dl = Math.abs(((lon - truth[k] + 540) % 360) - 180);
    check(Math.abs(r - 560) < 1 && dl < 0.5, `${k} stands on the ring at its ecliptic longitude`, `r=${r.toFixed(1)} lon=${lon.toFixed(2)} true=${truth[k].toFixed(2)}`);
  }
  check(Math.hypot(w['a:self'].x, w['a:self'].y) < 45, 'the Self holds the centre', JSON.stringify(w['a:self']));
  const fam = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    const out = {};
    for (const k of ['f:serpent']) out[k] = g.worldOf(k);
    return out;
  });
  check(Object.values(fam).every((p) => p && Math.hypot(p.x, p.y) < 560 * 1.2), 'forms hang near or inside the ring (drawn toward the body they are tied to, never flung away)', JSON.stringify(fam));
  await page.screenshot({ path: `${shots}/${kind}-graph-sky.png` });

  // ── the caption is a sentence, and states the moment ──
  await openSettings(page);
  const note = await page.locator('.gvt-sky-note').textContent();
  check(/geocentric ecliptic longitudes, as of \d{4}-\d\d-\d\d \d\d:\d\d UTC/.test(note ?? ''), 'the Settings panel states what the ring is and when', note);
  await page.keyboard.press('Escape');

  // ── Reframe frames everything, bodies included ──
  await openSettings(page);
  await page.getByRole('button', { name: 'Reframe graph' }).click();
  await page.waitForTimeout(2500);
  const inView = await page.evaluate(() => {
    const g = window.__earth.ctl.graph;
    const r = document.querySelector('.gv-canvas').getBoundingClientRect();
    return ['sun', 'moon', 'mars', 'pluto', 'venus', 'saturn'].map((k) => {
      const p = g.screenOf(`b:${k}`);
      return { k, ok: p.x > 8 && p.x < r.width - 8 && p.y > 8 && p.y < r.height - 8 };
    });
  });
  check(inView.every((b) => b.ok), 'after Reframe every body is in the frame', JSON.stringify(inView.filter((b) => !b.ok)));

  // ── relation filters thin the sky's strands ──
  const all = (await stats(page)).skyEdges;
  await openSettings(page);
  await page.getByRole('button', { name: 'Inferred', exact: true }).click();
  await page.getByRole('button', { name: 'Read here', exact: true }).click();
  const jungOnly = (await stats(page)).skyEdges;
  check(jungOnly < all && jungOnly > 0, 'with only Jung\u2019s relations on, only Jung\u2019s sky ties remain', `${all} → ${jungOnly}`);
  await page.getByRole('button', { name: 'Jung', exact: true }).click();
  const none = await stats(page);
  check(none.skyEdges === 0 && none.bodies === 10, 'with every relation off no strand remains, but the ring stays', `skyEdges=${none.skyEdges} bodies=${none.bodies}`);
  for (const n of ['Jung', 'Inferred', 'Read here']) await page.getByRole('button', { name: n, exact: true }).click();
  check((await stats(page)).skyEdges === all, 'turning them back restores the strands');
  await page.keyboard.press('Escape');

  // ── time playback is unbroken ──
  await page.getByRole('button', { name: 'Play history', exact: true }).click();
  await page.waitForTimeout(1500);
  const play = await stats(page);
  check(play.bodies === 10 && play.bodyLive === 1, 'while history plays the sky stays, undimmed', JSON.stringify({ bodies: play.bodies, live: play.bodyLive }));
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  // ── a click on a body leaves the graph for the sky card ──
  await page.evaluate(() => { const g = window.__earth.ctl.graph; window.__sunPt = g.screenOf('b:sun'); });
  const pt = await page.evaluate(() => window.__sunPt);
  const box = await page.locator('.gv-canvas').boundingBox();
  await page.mouse.click(box.x + pt.x, box.y + pt.y);
  await page.waitForTimeout(700);
  const st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__earth.ctl.state)));
  check(st.sky?.body === 'sun' && !st.graph, 'choosing a body opens it in the sky', JSON.stringify({ sky: st.sky, graph: st.graph }));

  // ── back in the graph the anchors stand as left; then off removes them ──
  await page.evaluate(() => { location.hash = '#/graph'; });
  await page.waitForFunction(() => window.__earth.ctl.graph.isVisible);
  await page.waitForTimeout(800);
  check((await stats(page)).bodies === 10, 'the anchors survive leaving and returning');
  await openSettings(page);
  await sky(page).click();
  await page.waitForTimeout(500);
  const off = await stats(page);
  check(off.sky === 'off' && off.bodies === 0 && off.skyEdges === 0 && off.nodes === fieldNodes, 'turning them off takes the sky down and leaves the field', JSON.stringify({ nodes: off.nodes, fieldNodes }));
  check(logs.length === 0, 'no console errors or warnings', logs.join(' | '));
  await page.context().close();

  // ── local graph: ordinary neighbours, the cap holds ──
  {
    const { page: lp, logs: ll } = await open(browser, { width: 1440, height: 900, hash: '#/graph/a/self' });
    await lp.waitForFunction(() => window.__earth.ctl.graph.isVisible);
    await turnOn(lp);
    await openSettings(lp);
    for (let i = 0; i < 2; i++) await lp.getByRole('button', { name: 'More steps from the subject' }).click();
    await lp.waitForTimeout(800);
    const ls = await stats(lp);
    check(ls.mode === 'local' && ls.depth === 3 && ls.nodes <= 520, 'at three steps the local graph keeps its ceiling with the sky on', JSON.stringify({ nodes: ls.nodes, bodies: ls.bodies }));
    await settle(lp, 300);
    const sunLocal = await world(lp, ['b:sun']);
    check(!sunLocal['b:sun'] || Math.abs(Math.hypot(sunLocal['b:sun'].x, sunLocal['b:sun'].y) - 560) > 1 || ls.bodies === 0, 'in a local graph a body is an ordinary neighbour, not held to the ring');
    await lp.screenshot({ path: `${shots}/${kind}-graph-sky-local.png` });
    check(ll.length === 0, 'no console errors or warnings (local)', ll.join(' | '));
    await lp.context().close();
  }

  // ── the layout is reproducible ──
  const layouts = [];
  for (let run = 0; run < 2; run++) {
    const { page: rp } = await open(browser, { width: 1440, height: 900, hash: '#/graph' });
    await rp.waitForFunction(() => window.__earth.ctl.graph.isVisible);
    await turnOn(rp);
    await settle(rp, 700);
    layouts.push(await world(rp, [...FIELD_KEYS, 'b:sun', 'b:mars']));
    await rp.context().close();
  }
  const dist = (k) => Math.hypot(layouts[0][k].x - layouts[1][k].x, layouts[0][k].y - layouts[1][k].y);
  const bodyWorst = Math.max(dist('b:sun'), dist('b:mars'));
  const fieldWorst = Math.max(...FIELD_KEYS.map(dist));
  check(bodyWorst < 0.5, 'the ring is exactly reproducible: a body stands where its longitude says', `worst Δ=${bodyWorst.toFixed(3)}`);
  // the simulation steps with the frame clock, so the settled field differs by a few units between sessions; the
  // arrangement (who is near what) must not
  check(fieldWorst < 25, 'two fresh sessions settle the field into the same arrangement (within 25 graph units of a 1100-unit span)', `worst Δ=${fieldWorst.toFixed(2)}`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
