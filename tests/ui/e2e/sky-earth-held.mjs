// Gate: the Earth is a held body like any other, and the modes keep their own ground.
//   - Clicked in the sky, the Earth is gone in to (the camera's distance only falls), not read as the whole sky.
//   - Held, it stands as the Astrology body at its station with its cards round it, and zooming in toward it stays in
//     Astrology down to the Field's own edge; past that edge the Field is entered once, by a descent, with no re-entry.
//   - A card's reading, a planet pick from the Earth and the Earth pick from a planet are moves in the sky.
//   - On a zoom out, the cards of every held body (the Sun included, whose glow is bright at any distance) shrink with the
//     body and give way; none stays a fixed size over a point.
//   npx vite --port 5183 --strictPort &
//   node tests/ui/e2e/sky-earth-held.mjs [outdir]
import fs from 'node:fs';
import path from 'node:path';
import { launch, open } from './lib.mjs';

const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
let failed = 0;
const check = (ok, label, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); };

const read = (page) => page.evaluate(() => {
  const { engine } = window.__earth;
  const cards = [...document.querySelectorAll('.po-card')];
  const shown = cards.filter((c) => Number(c.style.opacity) > 0.3);
  const root = document.querySelector('.po');
  return {
    dist: engine.rig.dist, stage: engine.stageDist, approached: engine.sky?.approached ?? null, approach: engine.sky?.approach ?? 0,
    phase: document.body.dataset.skyPhase, hash: location.hash, cards: cards.length, shown: shown.length,
    cardH: shown.length ? parseFloat(shown[0].style.getPropertyValue('--ch')) : 0,
    rootOp: root && !root.hidden ? Number(root.style.opacity) : 0,
    clickable: cards.filter((c) => c.style.pointerEvents === 'auto').length,
  };
});

/** Wait for the sky camera to be at rest at a body. */
const arrived = (page, key) => page.waitForFunction((k) => {
  const { engine } = window.__earth;
  return engine.sky?.approached === k && engine.sky.approach > 0.99 && document.body.dataset.skyPhase === 'approach' && !document.querySelector('.po')?.hidden;
}, key, { timeout: 60000 });

/** Install a recorder of the route and phase, and of the camera's distance, once a frame. */
const record = (page) => page.evaluate(() => {
  const { engine } = window.__earth;
  window.__rec = [];
  engine.onFrame(() => window.__rec.push({ hash: location.hash, phase: document.body.dataset.skyPhase, dist: engine.rig.dist, cam: engine.camera.position.length() }));
});

const browser = await launch('chromium', { headed: false });
for (const s of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const { ctx, page, logs } = await open(browser, { width: s.width, height: s.height, mobile: s.mobile, hash: '#/astrology' });
  await page.waitForFunction(() => window.__earth.engine.sky && document.body.dataset.skyPhase !== undefined, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // 1. the Earth clicked on the canvas, from the whole sky: the camera goes in, never out
  const before = await read(page);
  const at = await page.evaluate(() => window.__earth.engine.sky.screenDisc('terra'));
  check(!!at && at.on, `${s.name}: the Earth stands in the whole sky`, JSON.stringify(at));
  await record(page);
  // its name where the sky shows it, else the point itself where nothing stands over it (a phone's whole sky is crowded: on
  // some dates the Sun's name and Mars's tap target cover the Earth's point, and the pick is theirs)
  const name = page.locator('.sky-label.on', { hasText: /^(Terra|Earth)$/ });
  const cover = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? '', [at.x, at.y]);
  if (await name.count()) await name.first().click();
  else if (!/sky-label/.test(cover)) await page.mouse.click(at.x, at.y);
  else await page.evaluate(() => window.__earth.ctl.openBody('terra'));
  await arrived(page, 'terra');
  await page.waitForTimeout(1200);
  let st = await read(page);
  const rec = await page.evaluate(() => window.__rec);
  const maxCam = Math.max(...rec.map((r) => r.cam));
  check(/#\/sky\/terra$/.test(st.hash), `${s.name}: the Earth is held in Astrology`, st.hash);
  check(maxCam <= rec[0].cam * 1.05, `${s.name}: the camera only goes in (never out to the whole sky first)`, `start ${rec[0].cam.toFixed(0)}, peak ${maxCam.toFixed(0)}`);
  check(st.dist > 5.6 && st.dist < 20, `${s.name}: it stands at the Earth's station, clear of the Field's edge`, `${st.dist.toFixed(1)} R⊕`);
  check(st.shown === 8 && st.rootOp > 0.9, `${s.name}: its eight cards stand, whole`, `${st.shown} cards, ${st.rootOp}`);
  check(st.clickable === 8, `${s.name}: and take a click`, `${st.clickable}`);
  if (out) await page.screenshot({ path: path.join(out, `${s.name}-earth-held.png`) });

  // 2. a card opens at the Earth; the sky stays held
  await page.evaluate(() => document.querySelector('.po-card').click());
  await page.waitForSelector('.lens-panel:not([hidden]) .cr', { timeout: 10000 });
  st = await read(page);
  check(st.phase === 'approach' && /#\/sky\/terra$/.test(st.hash), `${s.name}: a card reads at the Earth, no gaze and no route change`, `${st.phase} ${st.hash}`);
  await page.click('.lens-panel .lp-close');
  await page.waitForTimeout(700);

  // 3. zoom in toward the Earth: still Astrology with the cards, until the Field's own edge
  await page.mouse.move(s.width / 2, s.height / 2);
  const trace = [];
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(500);
    const r = await read(page);
    trace.push(r);
    if (!/#\/sky\/terra$/.test(r.hash)) break;
  }
  const last = trace[trace.length - 1];
  const stillHeld = trace.filter((r) => r.dist > 5.7);
  check(stillHeld.length > 0 && stillHeld.every((r) => /#\/sky\/terra$/.test(r.hash) && r.shown === 8), `${s.name}: zooming in stays the Earth's Astrology, cards standing`, trace.map((r) => `${r.dist.toFixed(1)}:${r.shown}`).join(' '));

  // 4. past the edge: the Field is entered once, by a descent, and the sky does not come back
  await record(page);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(350); }
  await page.waitForFunction(() => document.body.dataset.skyPhase === 'settled', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const rec2 = await page.evaluate(() => window.__rec);
  const hashes = [...new Set(rec2.map((r) => r.hash))];
  st = await read(page);
  check(st.hash === '#/' && st.phase === 'settled', `${s.name}: past the edge it is the Field, settled`, `${st.hash} ${st.phase}`);
  check(hashes.length <= 2 && !hashes.includes('#/sky'), `${s.name}: the sky is not re-entered on the way`, hashes.join(' → '));

  // 5. the Field's See in sky: the Earth again, entered in to its station
  await page.evaluate(() => window.__earth.ctl.openBody('terra'));
  await arrived(page, 'terra');
  st = await read(page);
  check(st.dist > 5.6 && st.dist < 20 && st.shown === 8, `${s.name}: from the Field, "See in sky" returns to the held Earth`, `${st.dist.toFixed(1)} R⊕, ${st.shown} cards`);

  // 6. the Earth to a planet and back: moves in the sky, never a return down to the Earth
  await record(page);
  await page.evaluate(() => window.__earth.ctl.openBody('mars'));
  await arrived(page, 'mars');
  const toMars = await page.evaluate(() => window.__rec.map((r) => r.phase));
  check(!toMars.includes('return') && !toMars.includes('descend'), `${s.name}: Earth to Mars is one move in the sky`, [...new Set(toMars)].join(' → '));
  await record(page);
  await page.evaluate(() => window.__earth.ctl.openBody('terra'));
  await arrived(page, 'terra');
  const toEarth = await page.evaluate(() => window.__rec);
  const farthest = Math.max(...toEarth.map((r) => r.cam));
  check(!toEarth.some((r) => r.phase === 'return' || r.phase === 'descend'), `${s.name}: Mars to the Earth is one move in the sky`, [...new Set(toEarth.map((r) => r.phase))].join(' → '));
  st = await read(page);
  check(st.dist > 5.6 && st.dist < 20, `${s.name}: and ends at the Earth's station`, `${st.dist.toFixed(1)} R⊕ (farthest ${farthest.toFixed(0)})`);

  // 7. every held body's cards shrink with it and give way on a zoom out — the Sun's glow included
  for (const key of ['sun', 'mars', 'terra']) {
    await page.evaluate((k) => window.__earth.ctl.openBody(k), key);
    await arrived(page, key);
    await page.waitForFunction(() => document.querySelectorAll('.po-card').length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const held = await read(page);
    await page.mouse.move(s.width / 2, s.height / 2);
    const sizes = [held.cardH];
    let gone = false;
    for (let i = 0; i < 14 && !gone; i++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(450);
      const r = await read(page);
      sizes.push(r.cardH || 0);
      gone = r.rootOp < 0.05;
    }
    const mono = sizes.every((h, i) => i === 0 || h <= sizes[i - 1] + 0.5);
    check(gone && mono && sizes.some((h) => h > 0 && h < held.cardH * 0.6), `${s.name}: ${key}'s cards shrink with it and give way on a zoom out`, sizes.map((h) => Math.round(h)).join(' '));
  }

  check(logs.filter((l) => !/ephemeris|sidecar|sky camera:/i.test(l)).length === 0, `${s.name}: no console errors`, logs.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
