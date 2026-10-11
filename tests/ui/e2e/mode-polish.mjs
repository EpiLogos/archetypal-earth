// Gate: the mode polish (audit W5, SPEC §10). Three things a person sees and reads:
//   · the deep link '#/aion' opens the same default reading the Aion switch opens, and closing it works (W5a)
//   · the Red Book names the book or the folio in the tab title, and every mode gives it back on leaving (W5b)
//   · the four switches stand in one row, Dynamics · Red Book · Sky · Aion, with equal gaps, clear of the mode pill and
//     the search glyph at 1280×800, 1440×900 and 390×844; Tab follows that order; aria-pressed tells the truth
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/mode-polish.mjs [chromium|webkit]
// Screenshots of the row land in .cache/screens/remediation-2026-10-09/switch-row/ (after-<width>.png).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const history = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/history.json'), 'utf8'));
const field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8'));
const shots = path.join(ROOT, '.cache/screens/remediation-2026-10-09/switch-row');
fs.mkdirSync(shots, { recursive: true });
const defaultReading = history.readings[0];
const plainTitle = 'An Archetypal Earth';

let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

const state = (page) => page.evaluate(() => {
  const c = window.__earth.ctl;
  return {
    hash: location.hash,
    kind: c.state.view.kind,
    aion: c.state.history?.reading ?? null,
    redbook: !!c.state.redbook,
    dynamics: !!c.state.dynamics,
    sky: !!c.state.sky,
    title: document.title,
  };
});
const until = (page, fn, arg = null) => page.waitForFunction(fn, arg, { timeout: 12000, polling: 50 }).then(() => true, () => false);

const browser = await launch(kind, { headed: false });
try {
  // ── W5a: '#/aion' is the default reading, as the switch opens it ──────────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/aion' });
    await until(page, () => document.querySelector('.aion') && !document.querySelector('.aion').hidden && window.__earth.ctl.state.history);
    await page.waitForTimeout(600);
    const s = await state(page);
    check(s.aion === defaultReading.id, 'a fresh #/aion lands on the default Aion reading (not the plain globe)', `${s.hash}, reading ${s.aion}`);
    check(s.hash === `#/aion/${defaultReading.id}`, 'the link settles to the reading it names', s.hash);
    const visible = await page.evaluate(() => { const a = document.querySelector('.aion'); return !!a && !a.hidden && a.getBoundingClientRect().height > 0 && !!document.querySelector('.aion-heading h1, .aion-heading .fl-name, .aion-heading select'); });
    check(visible, 'the Aion panel is visible with its heading');
    const pressed = await page.evaluate(() => document.querySelector('.aion-switch')?.getAttribute('aria-pressed'));
    check(pressed === 'true', 'the Aion switch reads as pressed for that reading', `aria-pressed ${pressed}`);
    await page.keyboard.press('Escape');
    await until(page, () => !window.__earth.ctl.state.history);
    await page.waitForTimeout(500);
    const e = await state(page);
    check(!e.aion && e.kind === 'world' && !(await page.evaluate(() => document.querySelector('.aion')?.hidden === false)), 'Escape closes the default reading (no trap)', e.hash);
    await ctx.close();
  }
  {
    // the switch and the link agree: the switch from the plain globe lands on the same hash
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.click('.aion-switch');
    await until(page, () => location.hash === `#/aion/${defaultReading.id}`);
    const sw = await state(page);
    check(sw.hash === `#/aion/${defaultReading.id}` && sw.aion === defaultReading.id, 'the Aion switch opens the same reading the link names', sw.hash);
    await ctx.close();
  }

  // ── W5b: the tab title names the book, the folio or the reading; every mode gives it back ───────────────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/' });
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.click('.rb-switch');
    await until(page, () => location.hash.startsWith('#/redbook') && document.querySelector('.redbook .rv-name')?.textContent);
    await page.waitForTimeout(500);
    const folio = await page.evaluate(() => document.querySelector('.redbook .rv-name')?.textContent);
    const rb1 = await state(page);
    check(rb1.title === `${folio} — ${plainTitle}`, 'the Red Book names its folio in the tab title', `"${rb1.title}"`);
    await page.locator('.rb-rail button', { hasText: '→' }).click();
    await until(page, () => document.querySelector('.redbook .rv-name')?.textContent !== folio);
    await page.waitForTimeout(400);
    const folio2 = await page.evaluate(() => document.querySelector('.redbook .rv-name')?.textContent);
    const rb2 = await state(page);
    check(rb2.title === `${folio2} — ${plainTitle}`, 'the title follows the folio as the walk turns it', `"${rb2.title}"`);
    await page.click('.aion-switch');
    await until(page, () => window.__earth.ctl.state.history && !window.__earth.ctl.state.redbook);
    await page.waitForTimeout(500);
    const aion = await state(page);
    const expectTitle = `${defaultReading.title} · ${defaultReading.author} — ${plainTitle}`;
    check(aion.title === expectTitle && !aion.redbook, 'Red Book → Aion: the title is the reading\'s, the Red Book gone', `"${aion.title}"`);
    await page.click('.rb-switch');
    await until(page, () => window.__earth.ctl.state.redbook && !window.__earth.ctl.state.history);
    await page.waitForTimeout(500);
    const rb3 = await state(page);
    const folio3 = await page.evaluate(() => document.querySelector('.redbook .rv-name')?.textContent);
    check(rb3.title === `${folio3} — ${plainTitle}`, 'Aion → Red Book: the title is the folio\'s again', `"${rb3.title}"`);
    await page.keyboard.press('Escape');
    await until(page, () => !window.__earth.ctl.state.redbook);
    await page.waitForTimeout(600);
    const plain = await state(page);
    check(plain.title === plainTitle && plain.kind === 'world', 'leaving the Red Book for the plain world gives the title back', `"${plain.title}" ${plain.hash}`);
    await ctx.close();
  }

  // ── the switch row: one row, even gaps, clear of the pill and the search, in reading order ───────────────
  for (const [w, h, tag, mobile] of [[1280, 800, '1280x800', false], [1440, 900, '1440x900', false], [390, 844, '390x844', true]]) {
    const { ctx, page } = await open(browser, { width: w, height: h, mobile });
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
      return { dy: box('.dy-switch'), rb: box('.rb-switch'), sky: box('.sky-switch'), aion: box('.aion-switch'), pill: box('.mode-switch'), search: box('#search-btn'), row: box('.mode-row'), overflowX: document.documentElement.scrollWidth - innerWidth };
    });
    const four = [m.dy, m.rb, m.sky, m.aion];
    const gaps = four.slice(1).map((s, i) => s.l - four[i].r);
    check(four.every(Boolean) && gaps.every((g) => Math.abs(g - gaps[0]) <= 2), `${tag}: the four switches are one row with equal gaps (±2 px)`, `gaps ${gaps.map((g) => g.toFixed(1)).join(', ')} px`);
    check(four.every((s, i) => i === 0 || Math.abs(s.t - four[0].t) <= 2), `${tag}: the four share one baseline`, four.map((s) => s.t.toFixed(1)).join(', '));
    const rowRight = Math.max(...four.map((s) => s.r));
    check(m.pill && rowRight <= m.pill.l - 6, `${tag}: the row clears the mode pill`, `row right ${rowRight.toFixed(1)}, pill left ${m.pill?.l.toFixed(1)}`);
    check(m.pill && m.search && m.pill.r <= m.search.l, `${tag}: the pill and the search glyph do not overlap`, `pill right ${m.pill?.r.toFixed(1)}, search left ${m.search?.l.toFixed(1)}`);
    check(m.overflowX <= 0, `${tag}: no horizontal page scroll`, `overflow ${m.overflowX}`);
    await page.screenshot({ path: path.join(shots, `after-${tag}.png`) });
    if (tag === '1280x800') {
      // Tab follows the eye: the four switches are reached in reading order, one after another
      await page.evaluate(() => document.activeElement?.blur());
      const seen = [];
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        const cls = await page.evaluate(() => document.activeElement?.className ?? '');
        seen.push(cls);
      }
      const names = ['dy-switch', 'rb-switch', 'sky-switch', 'aion-switch'];
      const at = names.map((n) => seen.findIndex((c) => String(c).split(/\s+/).includes(n)));
      const ordered = at.every((x) => x >= 0) && at.every((x, i) => i === 0 || x === at[i - 1] + 1);
      check(ordered, 'Tab reaches Dynamics, Red Book, Sky, Aion in that order, one after another', `positions ${at.join(', ')}`);
    }
    await ctx.close();
  }

  // ── aria-pressed tells the truth in each mode ─────────────────────────────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/' });
    const pressed = () => page.evaluate(() => Object.fromEntries(['dy-switch', 'rb-switch', 'sky-switch', 'aion-switch'].map((c) => [c.replace('-switch', ''), document.querySelector(`.${c}`)?.getAttribute('aria-pressed')])));
    const plainP = await pressed();
    check(Object.values(plainP).every((v) => v === 'false'), 'on the plain globe, no switch is pressed', JSON.stringify(plainP));
    await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
    await page.click('.dy-switch');
    await until(page, () => window.__earth.ctl.state.dynamics);
    await page.waitForTimeout(400);
    const dyP = await pressed();
    check(dyP.dy === 'true' && dyP.rb === 'false' && dyP.aion === 'false' && dyP.sky === 'false', 'in the lens only Dynamics is pressed', JSON.stringify(dyP));
    await page.click('.dy-switch'); // the lens closes first: the sky switch stands still inside it
    await until(page, () => !window.__earth.ctl.state.dynamics);
    await page.waitForTimeout(400);
    await page.click('.sky-switch');
    await until(page, () => window.__earth.ctl.state.sky && !window.__earth.ctl.state.dynamics);
    await page.waitForTimeout(400);
    const skyP = await pressed();
    check(skyP.sky === 'true' && skyP.dy === 'false', 'in the sky only Sky is pressed', JSON.stringify(skyP));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
