import { launch, open, look } from './lib.mjs';
const dir = '.cache/screens/round2';
const b = await launch('chromium');
const { page, logs } = await open(b);
await page.waitForTimeout(3500);
const occ = await page.evaluate(() => {
  const { model, ctl } = window.__earth;
  let best = -1, bd = 1e9;
  model.occ.forEach((o, i) => { if (!model.located[i] || o.geoPrecision !== 'place') return; const d = Math.hypot(o.lat - 38, o.lon - 22); if (d < bd) { bd = d; best = i; } });
  const o = model.occ[best];
  location.hash = '#/o/' + encodeURIComponent(o.id);
  return { id: o.id, lat: o.lat, lon: o.lon, label: o.label };
});
console.log(occ);
await page.waitForTimeout(4500);
await page.screenshot({ path: `${dir}/ring-centre.png` });
// the point at various angles from the sub-camera point, east of it
for (const [name, dlon, dist] of [['ring-mid', 38, 3.2], ['ring-limb', 68, 3.2], ['ring-limb2', 80, 3.2], ['ring-near', 0, 1.3], ['ring-near-limb', 22, 1.3]]) {
  await page.evaluate(([o, dl, d]) => { const { engine } = window.__earth; engine.rig.interacted = true; engine.rig.flyTo(o.lat, o.lon - dl, d, { instant: true }); }, [occ, dlon, dist]);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${dir}/${name}.png` });
}
console.log(await page.evaluate(() => { const e = window.__earth.engine; const u = e.earth.mesh.material.uniforms; return { base: e.baseKind, mix: u.uHiMix.value, lo: u.uBaseLo.value.image?.width, hi: u.uBaseHi.value.image?.width, aniso: u.uBaseHi.value.anisotropy }; }));
console.log(logs.join('\n'));
await b.close();
