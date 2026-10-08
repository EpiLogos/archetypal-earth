import { launch, open, look } from './lib.mjs';
const dir = '.cache/screens/round2';
const kind = process.argv[2] ?? 'chromium';
const only = process.argv[3];
const b = await launch(kind);
const run = async (name, fn, opts = {}) => {
  if (only && !name.startsWith(only)) return;
  const { ctx, page, logs } = await open(b, opts);
  await fn(page);
  await page.screenshot({ path: `${dir}/${name}.png` });
  if (logs.length) console.log(name, logs.join(' | '));
  await ctx.close();
};
const pre = kind === 'webkit' ? 'webkit-' : '';
await run(`${pre}world`, async (p) => { await p.waitForTimeout(4500); });
if (kind === 'webkit') {
  const { page, logs } = await open(b);
  await page.waitForTimeout(4000);
  await page.keyboard.press('/');
  await page.waitForTimeout(500);
  await page.keyboard.type('serpent');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/webkit-search.png` });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${dir}/webkit-focus.png` });
  const info = await page.evaluate(() => ({ hash: location.hash, fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family), tiles: window.__earth.engine.tiles.stats, base: window.__earth.engine.baseKind, gl: window.__earth.engine.renderer.getContext().getParameter(window.__earth.engine.renderer.getContext().VERSION) }));
  console.log(JSON.stringify(info));
  console.log(logs.join('\n'));
  await b.close();
  process.exit(0);
}
for (const [name, h] of [['focus-serpent', '#/f/serpent'], ['focus-self', '#/a/self'], ['focus-shadow', '#/a/shadow']]) {
  await run(name, async (p) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(5200); });
}
await run('time-scrubbed', async (p) => {
  await p.evaluate(() => { const { time, model } = window.__earth; time.scrub(model.scale.toU(-400)); time.pause(); });
  await p.waitForTimeout(3500);
});
await run('time-scrubbed-focus', async (p) => {
  await p.evaluate(() => { location.hash = '#/f/serpent'; });
  await p.waitForTimeout(4500);
  await p.evaluate(() => { const { time, model } = window.__earth; time.scrub(model.scale.toU(800)); time.pause(); });
  await p.waitForTimeout(3000);
});
await run('thread', async (p) => { await p.evaluate(() => { location.hash = '#/t/serpent'; }); await p.waitForTimeout(9000); });
await run('world-mobile', async (p) => { await p.waitForTimeout(4500); }, { width: 390, height: 844, dpr: 2, mobile: true });
await run('focus-serpent-mobile', async (p) => { await p.evaluate(() => { location.hash = '#/f/serpent'; }); await p.waitForTimeout(5200); }, { width: 390, height: 844, dpr: 2, mobile: true });
await run('search', async (p) => { await p.waitForTimeout(2500); await p.keyboard.press('/'); await p.waitForTimeout(500); await p.keyboard.type('mother'); await p.waitForTimeout(900); });
await b.close();
