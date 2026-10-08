// Frame-rate on a real GPU: headed Chromium (Metal via ANGLE), 1440x900 @ DPR 2.
//   node tests/ui/e2e/perf.mjs [scenario...]
import { launch, open, look } from './lib.mjs';
const kind = process.env.PERF_BROWSER ?? 'chromium';
const only = process.argv.slice(2);
const b = await launch(kind, { headed: true });
const SECS = 5;
const results = [];

async function measure(page, label, drive) {
  await page.evaluate(() => {
    window.__ft = { t: [], on: true, rendered: window.__earth.engine.renderer.info.render.frame };
    const work = window.__ft.work = {};
    const engine = window.__earth.engine;
    for (const [object, method, label] of [[engine.renderer, 'render', 'render'], [engine.renderer, 'initTexture', 'textureUpload'], [engine.tiles, 'upload', 'tileUpload']]) {
      const operation = object[method].bind(object);
      object[method] = (...args) => {
        const start = performance.now();
        const result = operation(...args);
        work[label] = Math.max(work[label] ?? 0, performance.now() - start);
        return result;
      };
    }
    const until = performance.now() + 5000;
    let last = performance.now();
    const loop = (now) => {
      if (!window.__ft.on) return;
      window.__ft.t.push(now - last); last = now;
      if (now < until) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const t0 = Date.now();
  await drive(t0 + SECS * 1000);
  const rest = SECS * 1000 - (Date.now() - t0);
  if (rest > 0) await page.waitForTimeout(rest);
  const t = await page.evaluate(() => { window.__ft.on = false; return window.__ft.t; });
  const renderedFrames = await page.evaluate(() => window.__earth.engine.renderer.info.render.frame - window.__ft.rendered);
  const maximumWorkMs = await page.evaluate(() => Object.fromEntries(Object.entries(window.__ft.work).map(([label, ms]) => [label, +ms.toFixed(1)])));
  const s = [...t].sort((a, c) => a - c);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const med = q(0.5);
  const long = t.filter((x) => x > 50).length;
  const out = { scenario: label, sampleMs: +t.reduce((a, v) => a + v, 0).toFixed(1), frames: t.length, renderedFrames, medianMs: +med.toFixed(1), fps: +(1000 / med).toFixed(1), p95Ms: +q(0.95).toFixed(1), p99Ms: +q(0.99).toFixed(1), maxMs: +s[s.length - 1].toFixed(1), over50: long, over33: t.filter((x) => x > 33.4).length, maximumWorkMs };
  results.push(out);
  console.log(JSON.stringify(out));
  return out;
}

const want = (n) => !only.length || only.includes(n);
const fresh = async () => {
  const o = await open(b, { width: 1440, height: 900, dpr: 2 });
  await o.page.waitForTimeout(4500); // let the hi-res base land
  return o;
};
const info = async (page) => console.log(JSON.stringify(await page.evaluate(() => { const e = window.__earth.engine; const gl = e.renderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?', base: e.baseKind, upload: e.baseUploadMs, dpr: devicePixelRatio, size: [innerWidth, innerHeight] }; })));

if (want('idle')) {
  const { ctx, page } = await fresh();
  await info(page);
  await measure(page, 'world idle (auto-rotate)', async () => {});
  await ctx.close();
}
if (want('rotate')) {
  const { ctx, page } = await fresh();
  await measure(page, 'continuous rotation (drag)', async () => {
    await page.mouse.move(500, 450); await page.mouse.down();
    const t0 = Date.now(); let i = 0;
    while (Date.now() - t0 < SECS * 1000 - 200) { i++; await page.mouse.move(720 + Math.cos(i / 14) * 260, 450 + Math.sin(i / 14) * 160); await page.waitForTimeout(8); }
    await page.mouse.up();
  });
  await ctx.close();
}
if (want('zoom')) {
  const { ctx, page } = await fresh();
  await look(page, 41, 14, 1.8, 300);
  await measure(page, 'deep zoom, tiles streaming', async (until) => {
    await page.mouse.move(760, 420);
    for (let i = 0; i < 40 && Date.now() < until; i++) { await page.mouse.wheel(0, i < 25 ? -90 : 30); await page.waitForTimeout(70); }
  });
  console.log(JSON.stringify(await page.evaluate(() => { const e = window.__earth.engine; return { ...e.tiles.stats, levels: e.tiles.levels(), camera: e.cameraState, paused: e.paused, running: e.running }; })));
  await ctx.close();
}
if (want('pan-close')) {
  const { ctx, page } = await fresh();
  await look(page, 41, 14, 1.25, 4000);
  await measure(page, 'pan at regional zoom (tiles streaming)', async (until) => {
    await page.mouse.move(400, 450); await page.mouse.down();
    for (let i = 0; i < 100 && Date.now() < until; i++) { await page.mouse.move(400 + i * 8, 450 + Math.sin(i / 8) * 60); await page.waitForTimeout(40); }
    await page.mouse.up();
  });
  console.log(JSON.stringify(await page.evaluate(() => { const e = window.__earth.engine; return { ...e.tiles.stats, levels: e.tiles.levels(), camera: e.cameraState, paused: e.paused, running: e.running }; })));
  await ctx.close();
}
if (want('focus')) {
  const { ctx, page } = await fresh();
  await measure(page, 'focus transition (serpent)', async () => { await page.evaluate(() => { location.hash = '#/f/serpent'; }); });
  await ctx.close();
}
if (want('thread')) {
  const { ctx, page } = await fresh();
  await measure(page, 'thread tour (serpent)', async () => { await page.evaluate(() => { location.hash = '#/t/serpent'; }); });
  await ctx.close();
}
await b.close();
const failed = results.filter((r) => r.fps < 55 || r.over50 > 0 || r.renderedFrames < 150 || Object.values(r.maximumWorkMs).some((ms) => ms > 50));
console.log(JSON.stringify({ browser: kind, targetFps: 55, maximumFrameMs: 50, passed: failed.length === 0, failingScenarios: failed.map((r) => r.scenario) }));
if (failed.length) process.exitCode = 1;
