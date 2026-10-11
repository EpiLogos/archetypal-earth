// Gate (time pass T1–T3): the temporal lifecycle of a node, and the standing reading's seam (T2).
//   npx vite --port 5183 --strictPort &      EARTH_HEADLESS=1 node tests/ui/e2e/time-lifecycle.mjs
// (i)  in Aion, the standing event's own occurrences stay pickable with the cursor far from them (T2);
// (ii) one isolated node, scrubbed through not-yet / emerging / live / dissolving / after: the renders differ
//      in the expected direction (numbers printed; thresholds are loose on purpose: software GL, density glow);
// (iii) the all-time frame is deterministic and leaves no trace of a time visit.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open, look } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(HERE, '../../../.cache/screens/remediation-2026-10-09/time');
mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const FREEZE = () => {
  const e = window.__earth.engine;
  e.tiles.enabled = false;
  const u = e.presences.mesh.material.uniforms.uTime;
  Object.defineProperty(u, 'value', { get: () => 0, set: () => {}, configurable: true });
};
// time.on eases toward 1 (cursor) or 0 (all time); the frame rate under software GL is low, so poll rather than wait
const settleOn = (page, target) => page.waitForFunction((t) => (t === 1 ? window.__earth.time.on > 0.995 : window.__earth.time.on < 0.001), target, { timeout: 30000, polling: 100 });


// Radial luminance of the lifecycle crops (48x48 px, node at the centre), and the all-time before/after diff.
const PY_ANALYSIS = `
import json, math, sys
from PIL import Image
d = sys.argv[1]
def prof(path):
    im = Image.open(path).convert('RGB'); px = im.load(); W, H = im.size
    c, ring, bg = [], [], []
    cc, cb = [0, 0, 0], [0, 0, 0]
    for y in range(H):
        for x in range(W):
            r = math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2); v = sum(px[x, y]) / 3
            if r < 2.5:
                cc = [cc[k] + px[x, y][k] for k in range(3)]; c.append(v)
            elif 8 <= r < 12: ring.append(v)
            elif 12 <= r < 16:
                bg.append(v); cb = [cb[k] + px[x, y][k] for k in range(3)]
    m = lambda a: sum(a) / max(1, len(a))
    n = max(1, len(c)); nb = max(1, len(bg))
    dRB = (cc[0] - cc[2]) / n - (cb[0] - cb[2]) / nb
    return {'centre': m(c), 'ring': m(ring), 'bg': m(bg), 'dRB': dRB}
phases = {k: prof(d + '/' + k + '.png') for k in ['notyet', 'emerging', 'live', 'dissolving', 'after']}
A = Image.open(d + '/alltime-a.png').convert('RGB'); B = Image.open(d + '/alltime-b.png').convert('RGB')
PA, PB = A.load(), B.load(); W, H = A.size
diff = sum(1 for y in range(H) for x in range(W) if max(abs(PA[x, y][k] - PB[x, y][k]) for k in range(3)) > 2)
print(json.dumps({'phases': phases, 'allDiffPixels': diff}))
`;

const browser = await launch('chromium', { headed: false });

// ── (i) Aion: the standing event's occurrences under a far cursor ─────────────────────────────────────────
{
  const { ctx, page, logs } = await open(browser, { hash: '#/aion/jung-aion/event/denderah-zodiac', width: 1200, height: 800 });
  try {
    await page.evaluate(FREEZE);
    await page.waitForSelector('section.aion .aion-card:not([hidden])', { timeout: 30000 });
    await page.waitForFunction(() => {
      const { engine, model } = window.__earth;
      for (let i = 0; i < engine.presences.rel.length; i++) if (model.located[i] && engine.presences.rel[i] >= 1.55) return true;
      return false;
    }, null, { timeout: 30000, polling: 200 });
    await page.waitForTimeout(800);
    const standing = await page.evaluate(() => {
      const { engine, model } = window.__earth;
      const idx = [];
      for (let i = 0; i < engine.presences.rel.length; i++) if (model.located[i] && engine.presences.rel[i] >= 1.55) idx.push(i);
      return { idx, us: idx.map((i) => model.u[i]), years: idx.map((i) => model.occ[i].year) };
    });
    check(standing.idx.length > 0, 'aion: the standing event has located occurrences on the field', `${standing.idx.length} occurrences, years ${Math.min(...standing.years)}..${Math.max(...standing.years)}`);

    // the far cursor: whichever end of the scale is furthest from every standing occurrence
    const far = [0.02, 0.98].map((c) => ({ c, gap: Math.min(...standing.us.map((u) => Math.abs(c - u))) })).sort((a, b) => b.gap - a.gap)[0].c;
    await page.evaluate((c) => window.__earth.time.scrub(c), far);
    await settleOn(page, 1);
    await page.waitForTimeout(800);

    const r = await page.evaluate((idx) => {
      const { engine, model, time } = window.__earth;
      const S = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
      const out = { facing: 0, hits: 0, exact: 0, oldSkips: 0 };
      for (const i of idx) {
        const q = { x: 0, y: 0, facing: 0 };
        engine.project(model.dir[i], q, 1.0);
        if (q.facing <= 0.02) continue;
        out.facing++;
        // the pre-T2 gate: timeVisibility < 0.5 skipped the pick. Count the occurrences that gate would have dropped.
        const d = time.cursorU - model.u[i];
        const vis = S(0, 0.022, d) * (1 - S(time.trail * 0.55, time.trail, d));
        if (vis < 0.5) out.oldSkips++;
        const hit = engine.presences.pick(q.x, q.y, engine.camera, engine.width, engine.height, 12);
        if (idx.includes(hit)) out.hits++;
        if (hit === i) out.exact++;
      }
      return out;
    }, standing.idx);
    console.log(`     cursor u=${far}; facing standing occurrences ${r.facing}; pre-T2 gate would drop ${r.oldSkips}; pick returns a standing occurrence for ${r.hits}; exact ${r.exact}`);
    check(r.facing >= 1, 'aion: at least one standing occurrence faces the viewer');
    check(r.oldSkips === r.facing, 'aion: the scenario is the bug (the old vis<0.5 gate would drop every standing occurrence here)', `${r.oldSkips}/${r.facing}`);
    check(r.facing >= 1 && r.hits >= Math.ceil(0.8 * r.facing), 'aion (T2): standing occurrences are pickable with the cursor far away', `${r.hits}/${r.facing} picked`);
    const errs = logs.filter((l) => /shader|compile|GLSL/i.test(l));
    check(errs.length === 0, 'aion: no shader compile errors', errs.slice(0, 2).join(' | '));
  } finally {
    await ctx.close();
  }
}

// ── (ii) one isolated node through the five phases ───────────────────────────────────────────────────────────
{
  const { ctx, page, logs } = await open(browser, { hash: '', width: 1200, height: 800 });
  try {
    await page.evaluate(FREEZE);
    await page.evaluate(() => window.__earth.time.setAll());
    await look(page, 30, 20, 1.9, 2500);
    const node = await page.evaluate(() => {
      const { engine, model } = window.__earth;
      const q = { x: 0, y: 0, facing: 0 };
      const cands = [];
      for (let i = 0; i < model.occ.length; i++) {
        if (!model.located[i] || model.occ[i].geoPrecision !== 'place') continue;
        engine.project(model.dir[i], q, 1.0);
        if (q.facing < 0.3 || q.x < 200 || q.x > 1000 || q.y < 150 || q.y > 650) continue;
        cands.push({ i, x: q.x, y: q.y, u: model.u[i] });
      }
      const isolated = cands.filter((c) => c.u > 0.05 && c.u < 0.95 && !cands.some((o) => o.i !== c.i && Math.hypot(o.x - c.x, o.y - c.y) < 40));
      return isolated[0] ?? null;
    });
    check(!!node, 'lifecycle: an isolated place-precision node is on screen', node ? `occurrence ${node.i} at u=${node.u.toFixed(4)}` : 'none');
    if (!node) throw new Error('no isolated node in the pose');

    const E = 0.022 * 1.5;
    const phases = [
      ['notyet', -0.02],
      ['emerging', E * 0.5],
      ['live', 0.06],
      ['dissolving', 0.12],
      ['after', 0.22],
    ];
    const names = [];
    for (const [name, d] of phases) {
      await page.evaluate(([u, dd]) => window.__earth.time.scrub(u + dd), [node.u, d]);
      await settleOn(page, 1);
      await page.waitForTimeout(700);
      // re-project: the globe is still settling, the node may have moved
      const at = await page.evaluate((i) => {
        const { engine, model } = window.__earth;
        const q = { x: 0, y: 0, facing: 0 };
        engine.project(model.dir[i], q, 1.0);
        return { x: q.x, y: q.y };
      }, node.i);
      const clip = { x: Math.round(at.x) - 24, y: Math.round(at.y) - 24, width: 48, height: 48 };
      await page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip });
      names.push([name, path.join(SHOTS, `${name}.png`)]);
      console.log(`     ${name.padEnd(10)} d=${d.toFixed(4)} cursor=${(node.u + d).toFixed(4)} node at ${at.x.toFixed(1)},${at.y.toFixed(1)}`);
    }

    // the all-time frame, twice, with a time visit in between: nothing should linger
    await page.evaluate(() => window.__earth.time.setAll());
    await settleOn(page, 0);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, 'alltime-a.png') });
    await page.evaluate((u) => window.__earth.time.scrub(u), node.u + 0.06);
    await settleOn(page, 1);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__earth.time.setAll());
    await settleOn(page, 0);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, 'alltime-b.png') });

    const res = spawnSync('python3', ['-I', '-W', 'ignore', '-c', PY_ANALYSIS, SHOTS], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`analysis failed: ${res.stderr}`);
    const a = JSON.parse(res.stdout);
    console.log('     radial luminance, presence crop (centre 0-3 px, ring 8-12 px, background 12-16 px):');
    for (const [k, v] of Object.entries(a.phases)) console.log(`       ${k.padEnd(10)} centre ${v.centre.toFixed(1)}  ring ${v.ring.toFixed(1)}  bg ${v.bg.toFixed(1)}  centre-bg ${(v.centre - v.bg).toFixed(1)}  ring-bg ${(v.ring - v.bg).toFixed(1)}  R-B offset ${v.dRB.toFixed(1)}`);
    const P = a.phases;
    const dc = (k) => P[k].centre - P[k].bg;
    check(dc('notyet') < 14, 'lifecycle: not yet is barely there (a pinprick)', `centre-bg ${dc('notyet').toFixed(1)}`);
    check(dc('after') > dc('notyet'), 'lifecycle: after the date-window the dot is brighter than not-yet (plainly "it has been")', `after ${dc('after').toFixed(1)} vs not-yet ${dc('notyet').toFixed(1)}`);
    check(dc('live') > 80, 'lifecycle: live is the brightest presence', `centre-bg ${dc('live').toFixed(1)}`);
    check(dc('live') > dc('dissolving'), 'lifecycle: dissolving is dimmer than live', `${dc('dissolving').toFixed(1)} < ${dc('live').toFixed(1)}`);
    // the cool tint of the pinprick is faint at alpha 0.10 (inside the background's own variation); the warm dot must read warmer than it
    check(P.after.dRB > P.notyet.dRB + 2, 'lifecycle: the after-dot reads warmer than the not-yet pinprick (colour offset from the background)', `R-B offset: not-yet ${P.notyet.dRB.toFixed(1)}, after ${P.after.dRB.toFixed(1)}`);
    check(dc('emerging') > 25 && (P.emerging.ring - P.emerging.bg) > 2, 'lifecycle: emerging has a core and a ring outside it', `core ${dc('emerging').toFixed(1)}, ring ${(P.emerging.ring - P.emerging.bg).toFixed(1)}`);
    check(a.allDiffPixels < 40, 'all time: the frame is the same before and after a time visit', `${a.allDiffPixels} pixels differ by >2`);
    const errs = logs.filter((l) => /shader|compile|GLSL/i.test(l));
    check(errs.length === 0, 'lifecycle: no shader compile errors', errs.slice(0, 2).join(' | '));
  } finally {
    await ctx.close();
  }
}

await browser.close();
console.log(failed ? `${failed} FAILED` : 'all time-lifecycle checks passed');
process.exit(failed ? 1 : 0);
