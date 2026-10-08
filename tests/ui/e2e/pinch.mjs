import { launch, open, look } from './lib.mjs';
const b = await launch('chromium');
const { page, logs } = await open(b, { width: 390, height: 844, dpr: 2, mobile: true });
await page.waitForTimeout(3000);
await look(page, 30, 20, 3.4, 400);
const res = await page.evaluate(async () => {
  const z = await import('/src/globe/zoom.ts');
  const { engine } = window.__earth;
  const r = engine.rig;
  const cv = engine.renderer.domElement;
  const under = (x, y) => z.surfacePointAt({ lat: r.lat, lon: r.lon, dist: r.dist }, { fovDeg: engine.camera.fov, aspect: engine.camera.aspect, shiftX: r.shiftX, shiftY: r.shiftY }, (x / innerWidth) * 2 - 1, 1 - (y / innerHeight) * 2);
  const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, button: 0, isPrimary: id === 1 }));
  const mid = [195, 420];
  const p0 = under(...mid);
  ev('pointerdown', 1, 160, 420); ev('pointerdown', 2, 230, 420);
  const out = { start: r.dist };
  for (let i = 1; i <= 20; i++) { ev('pointermove', 1, 160 - i * 3, 420); ev('pointermove', 2, 230 + i * 3, 420); r.update(1 / 60); }
  const p1 = under(...mid);
  const ang = Math.acos(Math.min(1, p0[0] * p1[0] + p0[1] * p1[1] + p0[2] * p1[2])) * 180 / Math.PI;
  ev('pointerup', 1, 100, 420); ev('pointerup', 2, 290, 420);
  return { ...out, end: r.dist, driftDeg: ang };
});
console.log(res);
console.log(logs.join('\n'));
await b.close();
