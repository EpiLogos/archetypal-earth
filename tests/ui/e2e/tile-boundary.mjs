// Real GPU regression: zooming into an off-centre parent patch must retain detail.
import assert from 'node:assert/strict';
import { launch, open, look, waitTiles } from './lib.mjs';

const kind = process.env.QUALITY_BROWSER ?? 'webkit';
const browser = await launch(kind);
try {
  const { page, logs } = await open(browser);
  await page.waitForTimeout(4500);
  for (const [lat, lon, dist] of [[41.9677, 15.7647, 1.05324], [46.5, 9, 1.05], [22, 79, 1.05]]) {
    await look(page, lat, lon, dist, 500);
    const tiles = await waitTiles(page, 12000);
    assert(tiles.wanted > 0 && tiles.drawn > 0, `Detail must cover the closest view at ${lat},${lon}: ${JSON.stringify(tiles)}`);
    assert.equal(tiles.failed, 0);
    console.log(JSON.stringify({ browser: kind, lat, lon, dist, tiles }));
  }
  assert.deepEqual(logs, []);
} finally {
  await browser.close();
}
