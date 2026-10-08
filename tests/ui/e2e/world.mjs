import { launch, open, look, waitTiles } from './lib.mjs';
const out = process.argv[2] ?? '.cache/screens/round2/probe.png';
const b = await launch('chromium');
const { page, logs } = await open(b);
await page.waitForTimeout(4000);
await page.screenshot({ path: out });
console.log(await page.evaluate(() => { const e = window.__earth.engine; return { base: e.baseKind, up: e.baseUploadMs, cam: e.cameraState, gl: e.renderer.capabilities.maxTextureSize }; }));
console.log(logs.join('\n'));
await b.close();
