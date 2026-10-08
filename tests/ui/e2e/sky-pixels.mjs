// Gate: the Earth stage is pixel-identical with and without the sky layer.
//
// Builds a second dev server from the pre-sky source snapshot (.cache/sky/baseline-src.tgz — the tree as it stood
// before any sky change), renders the same Earth-mode poses in both with the engine stepped deterministically, and
// diffs the screenshots in the browser. Any differing pixel is a failure; the count and the first position are printed.
//
//   npx vite --port 5183 --strictPort &      (the current tree)
//   node tests/ui/e2e/sky-pixels.mjs [chromium|webkit]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, open, URL as CURRENT } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const root = resolve(new globalThis.URL('../../..', import.meta.url).pathname);
const tgz = join(root, '.cache/sky/baseline-src.tgz');
if (!existsSync(tgz)) throw new Error(`baseline snapshot missing: ${tgz}`);

const PORT = 5184;
const dir = mkdtempSync(join(tmpdir(), 'earth-baseline-'));
execFileSync('tar', ['xzf', tgz, '-C', dir]);
symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
for (const f of ['vite.config.ts', 'tsconfig.json']) copyFileSync(join(root, f), join(dir, f));
for (const sub of ['img', 'textures']) symlinkSync(join(root, 'public', sub), join(dir, 'public', sub));
mkdirSync(join(dir, '.cache'), { recursive: true });

const server = spawn(join(root, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
let up = false;
for (let i = 0; i < 100 && !up; i++) {
  await new Promise((r) => setTimeout(r, 200));
  up = await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false);
}
if (!up) { server.kill(); throw new Error(`baseline vite did not start:\n${log}`); }

const POSES = [
  [24, 26, 5.4], [48, 10, 3.2], [-20, -60, 2.0], [35, 139, 1.3], [-33, 151, 1.08], [5, 80, 4.4], [70, -40, 2.6],
];

async function render(page, [lat, lon, dist]) {
  await page.evaluate(([la, lo, d]) => {
    const { engine } = window.__earth;
    engine.rig.interacted = true;
    document.body.classList.add('interacted');
    engine.rig.flyTo(la, lo, d, { instant: true });
  }, [lat, lon, dist]);
  // the engine is stepped by hand from here (advance stops the real-time loop): let tiles stream in between steps
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.__earth.engine.advance(0.4));
    await page.waitForTimeout(350);
  }
  await page.evaluate(() => { window.__earth.engine.elapsed = 50; window.__earth.engine.advance(4); });
  return page.screenshot();
}

async function diff(browser, a, b) {
  const page = await browser.newPage();
  const res = await page.evaluate(async ([x, y]) => {
    const load = (s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    const px = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height); };
    const A = px(ia), B = px(ib);
    if (A.width !== B.width || A.height !== B.height) return { size: false };
    let n = 0, max = 0, first = null;
    for (let i = 0; i < A.data.length; i += 4) {
      const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
      if (d) { n++; if (d > max) max = d; if (!first) first = [(i / 4) % A.width, Math.floor(i / 4 / A.width)]; }
    }
    return { size: true, n, max, first };
  }, [a.toString('base64'), b.toString('base64')]);
  await page.close();
  return res;
}

let failed = 0;
const browser = await launch(kind, { headed: false });
try {
  const cur = await open(browser, { width: 1280, height: 800 });
  const base = await open(browser, { width: 1280, height: 800 });
  await base.page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await base.page.waitForFunction(() => window.__earth?.engine?.presences && document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 });
  // the current page must have its sky loaded and attached: the gate is for the worst case
  await cur.page.evaluate(() => window.__earth.engine.rig.flyTo(0, 0, 5, { instant: true }));
  await cur.page.waitForFunction(() => !!window.__earth.engine.sky, null, { timeout: 15000 });
  console.log(`engine.sky attached: ${await cur.page.evaluate(() => !!window.__earth.engine.sky)}  (baseline: ${await base.page.evaluate(() => !!window.__earth.engine.sky)})`);
  for (const pose of POSES) {
    const [a, b] = [await render(cur.page, pose), await render(base.page, pose)];
    const r = await diff(browser, a, b);
    const ok = r.size && r.n === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} pose(lat ${pose[0]}, lon ${pose[1]}, dist ${pose[2]}): ${r.size ? `${r.n} differing pixels, max channel delta ${r.max}${r.first ? `, first at ${r.first}` : ''}` : 'screenshot sizes differ'}`);
  }
  // negative control: the diff must be able to fail — a half-degree of latitude has to show
  const [ca, cb] = [await render(cur.page, POSES[0]), await render(base.page, [POSES[0][0] + 0.5, POSES[0][1], POSES[0][2]])];
  const ctl = await diff(browser, ca, cb);
  const sees = ctl.size && ctl.n > 0;
  if (!sees) failed++;
  console.log(`${sees ? 'PASS' : 'FAIL'} control: a 0.5° offset is detected (${ctl.n} differing pixels)`);
} finally {
  await browser.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
