// Drives the real rig with real input and checks the point under the cursor stays put.
import { launch, open, look } from './lib.mjs';
const b = await launch('chromium');
const { page, logs } = await open(b, { width: 1440, height: 900 });
await page.waitForTimeout(3000);
const under = (x, y) => page.evaluate(async ([x, y]) => {
  const z = await import('/src/globe/zoom.ts');
  const { engine } = window.__earth;
  const r = engine.rig;
  const lens = { fovDeg: engine.camera.fov, aspect: engine.camera.aspect, shiftX: r.shiftX, shiftY: r.shiftY };
  return z.surfacePointAt({ lat: r.lat, lon: r.lon, dist: r.dist }, lens, (x / innerWidth) * 2 - 1, 1 - (y / innerHeight) * 2);
}, [x, y]);
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
const cam = () => page.evaluate(() => { const r = window.__earth.engine.rig; return { lat: +r.lat.toFixed(2), lon: +r.lon.toFixed(2), dist: +r.dist.toFixed(3) }; });

await look(page, 30, 20, 3.4, 500);
// 1 — wheel zoom in at an off-centre cursor
const cx = 930, cy = 330;
const p0 = await under(cx, cy);
await page.mouse.move(cx, cy);
let worst = 0;
for (let i = 0; i < 24; i++) {
  await page.mouse.wheel(0, -90);
  await page.waitForTimeout(40);
  const p = await under(cx, cy);
  if (p0 && p) worst = Math.max(worst, ang(p0, p));
}
await page.waitForTimeout(900);
const p1 = await under(cx, cy);
console.log('wheel-in   cam', await cam(), 'drift under cursor (deg): max during', worst.toFixed(4), 'final', p0 && p1 ? ang(p0, p1).toFixed(4) : 'n/a');
// zoom out
for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(30); }
await page.waitForTimeout(1200);
const p2 = await under(cx, cy);
console.log('wheel-out  cam', await cam(), 'cursor still on globe:', !!p2);
// 2 — clamps
for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(16); }
await page.waitForTimeout(1500);
console.log('min clamp  cam', await cam());
for (let i = 0; i < 80; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(16); }
await page.waitForTimeout(2000);
console.log('max clamp  cam', await cam(), 'maxDist', await page.evaluate(() => window.__earth.engine.rig.maxDist));
// 3 — trackpad pinch = wheel + ctrlKey
await look(page, 30, 20, 3.4, 400);
await page.mouse.move(cx, cy);
const q0 = await under(cx, cy);
await page.keyboard.down('Control');
for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -6); await page.waitForTimeout(16); }
await page.keyboard.up('Control');
await page.waitForTimeout(900);
const q1 = await under(cx, cy);
console.log('ctrl-pinch cam', await cam(), 'final drift', q0 && q1 ? ang(q0, q1).toFixed(4) : 'n/a');
// 4 — drag: the grabbed point follows the pointer
await look(page, 30, 20, 2.2, 400);
const g0 = await under(700, 450);
await page.mouse.move(700, 450);
await page.mouse.down();
for (let i = 1; i <= 20; i++) { await page.mouse.move(700 + i * 12, 450 + i * 4); await page.waitForTimeout(16); }
const g1 = await under(940, 530);
console.log('drag       grabbed point vs pointer (deg):', g0 && g1 ? ang(g0, g1).toFixed(4) : 'n/a');
await page.mouse.up();
await page.waitForTimeout(1500);
console.log('after fling', await cam());
// 5 — double click zooms toward the point
await look(page, 20, 30, 3.0, 400);
const d0 = await under(980, 600);
await page.mouse.dblclick(980, 600);
await page.waitForTimeout(1400);
const d1 = await under(980, 600);
console.log('dblclick   cam', await cam(), 'drift', d0 && d1 ? ang(d0, d1).toFixed(4) : 'n/a');
// 6 — user input cancels a flight smoothly
await page.evaluate(() => { const r = window.__earth.engine.rig; r.flyTo(-20, 120, 1.6); });
await page.waitForTimeout(500);
const f0 = await cam();
await page.mouse.move(700, 450);
await page.mouse.wheel(0, -100);
await page.waitForTimeout(60);
console.log('flight cancelled by wheel:', !(await page.evaluate(() => window.__earth.engine.rig.flying)), 'cam before', f0, 'after', await cam());
console.log(logs.join('\n'));
await b.close();
