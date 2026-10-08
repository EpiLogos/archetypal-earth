import { launch, open } from './lib.mjs';
const hash = process.argv[2] ?? '#/f/serpent';
const wait = +(process.argv[3] ?? 6000);
const b = await launch('chromium');
const { page } = await open(b, { width: 1440, height: 900, dpr: 2 });
await page.waitForTimeout(wait === 6000 ? 6000 : 500);
await page.evaluate(() => {
  window.__loaf = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push({ dur: Math.round(e.duration), blocking: Math.round(e.blockingDuration), render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0), scripts: e.scripts.map((s) => ({ d: Math.round(s.duration), src: (s.sourceURL || '').split('/').slice(-2).join('/'), fn: s.sourceFunctionName, inv: s.invoker, t: s.invokerType })) }); }).observe({ type: 'long-animation-frame', buffered: true });
});
await page.evaluate((h) => { location.hash = h; }, hash);
await page.waitForTimeout(6000);
console.log(JSON.stringify(await page.evaluate(() => window.__loaf), null, 0).replace(/\},\{"dur"/g, '},\n{"dur"'));
await b.close();
