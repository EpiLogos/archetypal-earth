// Real browser acceptance of graph settings, time playback and path inspection.
// Run against the live dev server with QUALITY_BROWSER=webkit or chromium.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { launch, open, URL } from './lib.mjs';

const kind = process.env.QUALITY_BROWSER ?? 'webkit';
const directory = '.cache/screens/quality-finish';
await mkdir(directory, { recursive: true });
const browser = await launch(kind);
try {
  const { page, logs } = await open(browser, { width: 1440, height: 900, hash: '#/graph/a/self' });
  await page.waitForTimeout(3000);
  const graphStats = () => page.evaluate(() => window.__earth.ctl.graph.stats);
  const before = await graphStats();
  assert.equal(before.mode, 'local');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = await page.locator('#graph-settings').boundingBox();
  const track = await page.locator('.t-track').boundingBox();
  assert(panel && track && panel.y + panel.height < track.y, 'Graph settings must clear the time control');
  assert(panel.width < 300, 'Graph settings should remain compact');
  await page.getByRole('button', { name: 'More steps from the subject' }).click();
  assert.equal((await graphStats()).depth, 2);
  assert((await graphStats()).nodes > before.nodes, 'Two steps should reveal the real manifestations');
  await page.getByRole('button', { name: 'Occurrences', exact: true }).click();
  assert.equal((await graphStats()).occurrences, false);
  await page.getByRole('button', { name: 'Inferred', exact: true }).click();
  await page.getByRole('button', { name: 'Read here', exact: true }).click();
  assert.deepEqual((await graphStats()).tieBases, ['jung']);
  await page.screenshot({ path: `${directory}/${kind}-graph-settings.png` });
  await page.getByRole('button', { name: 'Inferred', exact: true }).click();
  await page.getByRole('button', { name: 'Read here', exact: true }).click();
  await page.getByRole('button', { name: 'Occurrences', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#graph-settings').isVisible(), false);
  // the mode pill is the way back to the Earth from the graph (the On Earth button it replaces is gone)
  await page.locator('.mode-switch').click();
  await page.waitForFunction(() => !document.body.classList.contains('mode-graph'));
  assert(await page.evaluate(() => document.querySelector('.gv').inert), 'Hidden graph controls must be inert');
  assert.equal(await page.locator('.gv').getAttribute('aria-hidden'), 'true');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__earth?.engine?.presences && document.getElementById('loading')?.classList.contains('done'));
  await page.waitForTimeout(5000);
  if (await page.locator('#intro:not(.dismissed)').count()) await page.getByRole('button', { name: 'Enter the globe' }).click();
  await page.getByRole('button', { name: 'Play history', exact: true }).click();
  const start = await page.evaluate(() => ({ cursor: window.__earth.time.cursorU, from: window.__earth.time.fromU, to: window.__earth.time.toU }));
  await page.waitForTimeout(1200);
  const playback = await page.evaluate(() => {
    const { engine, time, model } = window.__earth;
    return { playing: time.playing, cursor: time.cursorU, shaderCursor: engine.shared.cursor.value, blend: engine.shared.timeOn.value, fromYear: model.scale.fromU(time.fromU), toYear: model.scale.fromU(time.toU), min: model.field.meta.yearMin, max: model.field.meta.yearMax };
  });
  assert(playback.playing && playback.cursor > start.cursor, 'Play should advance the globe clock');
  assert.equal(playback.cursor, playback.shaderCursor, 'Rendered presences must use the advancing clock');
  assert(playback.blend > 0.9, 'The live time window must be active');
  assert(Math.abs(playback.fromYear - playback.min) < 1e-6);
  assert(Math.abs(playback.toYear - playback.max) < 1e-6);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // let the frame already in flight land: the property under test is a frozen clock, not the click's latency
  await page.waitForTimeout(150);
  const yearBefore = await page.locator('.t-track').getAttribute('aria-valuenow');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.t-track').getAttribute('aria-valuenow'), yearBefore);
  await page.locator('.t-track').focus();
  await page.keyboard.press('End');
  await page.evaluate(() => { location.hash = '#/t/serpent'; });
  await page.waitForFunction(() => window.__earth.ctl.tour?.i >= 0);
  await page.getByRole('button', { name: 'Pause tour', exact: true }).click();
  const tour = await page.evaluate(() => {
    const { ctl, engine } = window.__earth;
    window.__qualityTour = ctl.tour;
    return { index: ctl.tour.i, arcs: engine.arcs.steps, occurrence: ctl.model?.occ?.[ctl.tour.steps[ctl.tour.i].occ]?.id };
  });
  await page.getByRole('button', { name: 'Open this presence', exact: true }).click();
  await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'manifest');
  assert(await page.evaluate(() => !!window.__earth.ctl.state.trail), 'Inspecting a path node must retain the path');
  assert.equal(await page.evaluate(() => window.__earth.engine.arcs.steps), tour.arcs);
  await page.screenshot({ path: `${directory}/${kind}-path-inspection.png` });
  await page.locator('.reveal').getByRole('button', { name: 'Reading', exact: true }).click();
  await page.waitForFunction(() => window.__earth.ctl.state.deep);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__earth.ctl.state.deep);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__earth.ctl.state.view.kind === 'thread');
  const retained = await page.evaluate(() => ({ same: window.__earth.ctl.tour === window.__qualityTour, index: window.__earth.ctl.tour.i }));
  assert(retained.same && retained.index === tour.index, 'Returning must keep the same tour and current step');
  await page.getByRole('button', { name: 'Resume tour', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__earth.ctl.tour.playing), true);
  assert.deepEqual(logs, [], 'No browser errors or warnings are allowed in the real walk');
  console.log(JSON.stringify({ browser: kind, graph: before, playback, retainedPath: retained, warnings: logs }));
  await page.context().close();

  const mobile = await open(browser, { width: 390, height: 844, dpr: 2, mobile: true, hash: '#/graph/a/self' });
  await mobile.page.getByRole('button', { name: 'Settings', exact: true }).click();
  const mobilePanel = await mobile.page.locator('#graph-settings').boundingBox();
  const mobileTrack = await mobile.page.locator('.t-track').boundingBox();
  assert(mobilePanel.x >= 0 && mobilePanel.x + mobilePanel.width <= 390 && mobilePanel.y + mobilePanel.height < mobileTrack.y);
  await mobile.page.screenshot({ path: `${directory}/${kind}-graph-settings-mobile.png` });
  assert.deepEqual(mobile.logs, []);
  await mobile.ctx.close();
} finally {
  await browser.close();
}
