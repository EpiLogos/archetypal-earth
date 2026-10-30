// H1, second half: the layout contract. The regions of the screen (shell/layout.ts names them) never share area, at
// 1440×900 and 390×844, across the states a visitor passes through: the Field, a focus, its reading, the wide reading,
// Contents, Aion, the Red Book, the Texts. A region is measured as drawn: shown, and not faded out.
//   EARTH_HEADED=0 EARTH_URL=http://localhost:5294/ node tests/ui/e2e/layout-contract.mjs
import { launch, open } from './lib.mjs';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) fails.push(msg); };
const b = await launch('chromium');

const STATES = [
  ['the Field', '#/', null],
  ['a focus', '#/a/self', null],
  ['its reading', '#/a/self/deep', null],
  ['the wide reading', '#/a/self/deep', async (page) => { await page.locator('.deep .pane-tool:visible').click({ timeout: 2000 }).catch(() => {}); }],
  ['Contents', '#/a/self', async (page) => { await page.evaluate(() => window.__earth.ctl.deep.showContents('Contents', [{ items: [{ label: 'One', onPick() {} }] }])); }],
  ['the graph', '#/graph', null],
  ['the sky', '#/sky', null],
  ['Aion', '#/aion', null],
  ['the Red Book', '#/redbook', null],
  ['the Texts', '#/texts', null],
  ['a Work', '#/', async (page) => { await page.evaluate(() => { const c = window.__earth.ctl; const id = [...window.__earth.model.workById.keys()][0]; c.openSubject({ type: 'work', id }); }); }],
];

const measure = (page) => page.evaluate(async () => {
  const { REGIONS, overlapping } = await import('/src/shell/layout.ts');
  const shown = (e) => {
    for (let n = e; n && n !== document.body; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return false;
    }
    return true;
  };
  const boxes = [];
  for (const [id, sels] of Object.entries(REGIONS)) {
    for (const sel of sels) for (const e of document.querySelectorAll(sel)) {
      if (!shown(e)) continue;
      const q = e.getBoundingClientRect();
      if (q.width < 4 || q.height < 4) continue;
      boxes.push({ id: `${id}${sel === REGIONS[id][0] ? '' : `(${sel})`}`, x: q.x, y: q.y, w: q.width, h: q.height });
    }
  }
  return { boxes, pairs: overlapping(boxes) };
});

for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  for (const [name, hash, act] of STATES) {
    const { ctx, page, logs } = await open(b, { width: w, height: h, hash, mobile });
    await page.waitForTimeout(3500);
    if (act) { await act(page); await page.waitForTimeout(1800); }
    const r = await measure(page);
    const note = r.pairs.map(([a, c]) => {
      const A = r.boxes.find((x) => x.id === a), C = r.boxes.find((x) => x.id === c);
      return `${a} [${[A.x, A.y, A.w, A.h].map(Math.round)}] × ${c} [${[C.x, C.y, C.w, C.h].map(Math.round)}]`;
    }).join('; ');
    ok(r.pairs.length === 0, `${w}×${h} ${name}: ${r.boxes.length} regions, none overlap${note ? ` — ${note}` : ''}`);
    ok(logs.length === 0, `${w}×${h} ${name}: no console errors (${logs.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
}
await b.close();
console.log(fails.length ? `${fails.length} failed` : 'all ok');
process.exit(fails.length ? 1 : 0);
