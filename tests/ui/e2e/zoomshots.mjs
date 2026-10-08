import { launch, open, look, waitTiles } from './lib.mjs';
const dir = '.cache/screens/round2';
const b = await launch('chromium');
const { page, logs } = await open(b);
await page.waitForTimeout(3500);
for (const [name, lat, lon, dist] of [['med-world', 38, 18, 3.2], ['med-mid', 38, 18, 1.8], ['med-close', 40.5, 14, 1.2], ['india-close', 22, 79, 1.2], ['alps-min', 46.5, 9, 1.06]]) {
  await look(page, lat, lon, dist, 600);
  const s = await waitTiles(page);
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(name, JSON.stringify(s), JSON.stringify(await page.evaluate(() => window.__earth.engine.tiles.levels())));
}
console.log(logs.join('\n'));
await b.close();
