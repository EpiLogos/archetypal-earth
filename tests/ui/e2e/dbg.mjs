import { launch, open, look } from './lib.mjs';
const b = await launch('chromium');
const { page, logs } = await open(b);
await page.waitForTimeout(6000);
const clip = { x: 300, y: 180, width: 300, height: 220 };
for (const d of [2.6, 3.2, 3.8]) {
  await look(page, 40, 10, d, 1200);
  await page.screenshot({ path: `.cache/screens/round2/dbg-${d}.png`, clip });
}
await b.close();
