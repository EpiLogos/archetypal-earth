// Gate (UI cleanliness, SPEC §10 and §14): on the chrome, nothing overlaps. The era labels, the time readout, the play
// button and the sky caption are measured on every route at three widths, and the era labels must never overlap each
// other. (The corner credit this gate once walked now lives in the shell's menu footer, MODES-RFC §2.)
// Screenshots go to .cache/screens/remediation-2026-10-09/ui-clean/, named by UI_CLEAN_TAG (default 'after'):
// capture the 'before' state first with UI_CLEAN_TAG=before.
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 UI_CLEAN_TAG=before node tests/ui/e2e/ui-clean.mjs [chromium|webkit]
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const TAG = process.env.UI_CLEAN_TAG ?? 'after';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(ROOT, '.cache/screens/remediation-2026-10-09/ui-clean');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const ROUTES = ['#/', '#/sky', '#/redbook', '#/aion', '#/dynamics', '#/f/serpent'];

let failed = 0;
let passed = 0;
const check = (ok, label, detail = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Measure every UI box the walk watches and every pair of them that intersects.
 * A box counts only while it is visible: no display:none, no visibility:hidden, effective opacity of at least 0.05
 * (ancestors included), and a non-empty rect. Parent/child pairs are ignored.
 */
const snapshot = (page) => page.evaluate(() => {
  const effOpacity = (el) => {
    let o = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const visibleRect = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || effOpacity(el) < 0.05) return null;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1 ? r : null;
  };
  const items = [];
  const add = (label, el, kind) => {
    const r = visibleRect(el);
    if (r) items.push({ label, el, kind, x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom });
  };
  add('credit icon', document.querySelector('.credit-i'), 'credit');
  add('credit text', document.querySelector('.credit-t'), 'credit');
  add('credit link', document.querySelector('.credit-link'), 'credit');
  document.querySelectorAll('.t-era').forEach((e) => add(`era "${e.textContent}"`, e, 'era'));
  add('time readout', document.querySelector('.t-readout'), 'readout');
  add('play', document.querySelector('.t-play'), 'play');
  add('sky caption', document.querySelector('.sky-caption'), 'caption');

  // the smallest clear gap between two neighbouring visible era labels (left to right)
  const eras = items.filter((i) => i.kind === 'era').sort((p, q) => p.x - q.x);
  let minEraGap = null;
  for (let i = 1; i < eras.length; i++) {
    const gap = eras[i].x - eras[i - 1].right;
    minEraGap = minEraGap === null ? gap : Math.min(minEraGap, gap);
  }

  const boxes = items.map(({ label, x, y, w, h }) => ({ label, x, y, w, h }));
  const overlaps = [];
  const eps = 0.5;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const hit = a.x + eps < b.right && b.x + eps < a.right && a.y + eps < b.bottom && b.y + eps < a.bottom;
      if (hit) overlaps.push({ a: a.label, b: b.label, eraPair: a.kind === 'era' && b.kind === 'era' });
    }
  }
  const credit = {
    icon: !!document.querySelector('.credit-i') && getComputedStyle(document.querySelector('.credit-i')).display !== 'none',
    linkOpacity: document.querySelector('.credit-link') ? effOpacity(document.querySelector('.credit-link')) : null,
    focusWithin: !!document.querySelector('.credit:focus-within'),
  };
  return { boxes, overlaps, credit, minEraGap };
});

const printBoxes = (boxes) => {
  for (const b of boxes) {
    console.log(`    box ${b.label.padEnd(22)} x=${b.x.toFixed(0)} y=${b.y.toFixed(0)} ${b.w.toFixed(0)}×${b.h.toFixed(0)}`);
  }
};

const slug = (route) => (route === '#/' ? 'plain' : route.replace(/^#\//, '').replace(/\//g, '-'));

/**
 * Keyboard path to the credit: the search button is the DOM neighbour just before it, so focus it and press Tab until
 * the credit link has focus. Returns the credit stops in the order reached.
 */
const tabToCreditLink = async (page) => {
  await page.focus('#search-btn');
  const stops = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return { cls: '', inCredit: false };
      return { cls: a.classList.contains('credit-link') ? 'credit-link' : a.classList.contains('credit-i') ? 'credit-i' : a.closest('.credit') ? 'credit-anchor' : '', inCredit: !!a.closest('.credit') };
    });
    if (info.inCredit) stops.push(info.cls);
    if (info.cls === 'credit-link') return stops;
  }
  return stops;
};

const browser = await launch(kind, { headed: false });
try {
  for (const vp of VIEWPORTS) {
    const desktop = vp.width > 760;
    for (const route of ROUTES) {
      const tag = `${vp.width}x${vp.height} ${route}`;
      const name = `${TAG}-${vp.width}x${vp.height}-${slug(route)}`;
      const { ctx, page } = await open(browser, { ...vp, hash: route });
      // this headless GL renders at about 1 fps, so a 0.3 s fade takes many seconds: measure settled styles instead
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
      await page.waitForTimeout(1500);

      // ── idle: the credit is only its icon, the chrome stands as it is ───────────────────
      const idle = await snapshot(page);
      console.log(`[${tag}] idle`);
      printBoxes(idle.boxes);
      const idleEra = idle.overlaps.filter((o) => o.eraPair);
      check(idle.overlaps.length === 0, `${tag}: no two visible boxes intersect (idle)`,
        idle.overlaps.map((o) => `${o.a} × ${o.b}`).join(' | ') || 'none');
      check(idleEra.length === 0, `${tag}: era labels never overlap each other (idle)`,
        idleEra.map((o) => `${o.a} × ${o.b}`).join(' | ') || 'none');
      check(idle.minEraGap === null || idle.minEraGap >= 5.5, `${tag}: neighbouring era labels keep a 6 px gap (idle)`, `smallest gap ${idle.minEraGap === null ? 'n/a' : idle.minEraGap.toFixed(1) + ' px'}`);
      await page.screenshot({ path: resolve(OUT, `${name}.png`) });

      // the credits and the issue link moved into the shell's menu footer (MODES-RFC §2): no corner reveal to walk
      check(!(await page.$('.credit')), `${tag}: no corner credit (the credits are in the menu footer)`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
