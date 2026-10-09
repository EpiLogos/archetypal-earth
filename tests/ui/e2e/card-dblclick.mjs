// Gate: a double-click on a card surface opens its reading (audit W1, SPEC §9/§12/§17). Single-click controls are untouched,
// and a thumbnail double-click lands on its own step (the rail no longer re-centres between the two taps).
//   · reveal card (manifestation): dblclick → deep reading; close, links, disclosures ignore it; Escape closes the reading
//   · focus card: dblclick → deep reading; its 'Reading' link is the keyboard path
//   · thread strip: single tap jumps at once; dblclick on step 5 lands on 5 and opens its reading, with the rail held
//     still (run twice: with the rail's own transition, and with it removed, which re-creates the old i=5 → i=9 jump)
//   · strip caption: dblclick opens the current step's reading
//   · Red Book stop card and its Back path: NOT wired (audit W1c: Escape from a core reading does not return to the
//     Red Book stop; see the report). Those checks print GAP and do not fail the walk.
//   · no page errors
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/card-dblclick.mjs [chromium|webkit]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8'));
const serpentOcc = field.occurrences.find((o) => o.familyId === 'serpent' && o.geoPrecision !== 'none').id;

let failed = 0;
let gaps = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};
const gap = (ok, label, detail = '') => {
  if (!ok) gaps++;
  console.log(`${ok ? 'PASS' : 'GAP '} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

const state = (page) => page.evaluate(() => {
  const c = window.__earth.ctl;
  const deep = document.querySelector('section.deep:not(.passage)');
  return {
    hash: location.hash,
    kind: c.state.view.kind,
    deep: c.state.deep,
    deepOpen: document.body.classList.contains('deep-open') && !!deep && !deep.hidden,
    trail: !!c.state.trail,
    redbook: !!c.state.redbook,
    tourI: c.tour ? c.tour.i : null,
    selection: window.getSelection()?.toString() ?? '',
  };
});

/** Poll inside the page until `fn` holds (or give up quietly; the caller checks the state). */
const until = (page, fn, arg = null) => page.waitForFunction(fn, arg, { timeout: 8000, polling: 50 }).then(() => true, () => false);

const logs = [];
const track = (page) => page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

/** A real double-click at the centre of a locator, then the immediate state. */
async function dblclickAt(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}

/** Dispatch a dblclick event without the clicks: isolates the helper's control filter. */
const synthDblclick = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  return true;
}, selector);

const browser = await launch(kind, { headed: false });
try {
  // ── (i) the reveal card ─────────────────────────────────────────────────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/' });
    track(page);
    const hidden = await page.evaluate(() => { const r = document.querySelector('.reveal'); return { inert: r.inert, aria: r.getAttribute('aria-hidden') }; });
    check(hidden.inert && hidden.aria === 'true', 'the reveal card is inert and hidden from the a11y tree on the plain world', JSON.stringify(hidden));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: `#/o/${serpentOcc}` });
    track(page);
    await until(page, () => document.querySelector('.reveal')?.classList.contains('on') && !document.querySelector('.reveal').inert);
    const s0 = await state(page);
    check(s0.kind === 'manifest' && !s0.deep, 'a manifestation card stands, at the surface', `${s0.hash}`);
    const reading = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.reveal .rv-links button')].find((x) => x.textContent === 'Reading');
      return b ? { focusable: b.tabIndex >= 0 && !b.closest('[inert]'), inTree: b.closest('[aria-hidden="true"]') === null } : null;
    });
    check(!!reading && reading.focusable && reading.inTree, 'its keyboard path is the quiet \'Reading\' link (already in the foot, no new control)', JSON.stringify(reading));

    // controls and disclosures keep their own behaviour
    await synthDblclick(page, '.reveal .rv-close');
    await page.waitForTimeout(300);
    check(!(await state(page)).deep, 'a double-click on the close button does not open the reading');
    await synthDblclick(page, '.reveal .rv-links .link-quiet');
    await page.waitForTimeout(300);
    check(!(await state(page)).deep, 'a double-click on a link-quiet control does not open the reading');
    const hasSummary = await page.evaluate(() => !!document.querySelector('.reveal summary'));
    if (hasSummary) {
      await synthDblclick(page, '.reveal summary');
      await page.waitForTimeout(300);
      check(!(await state(page)).deep, 'a double-click on a disclosure summary does not open the reading');
    } else console.log(`SKIP ${kind} disclosure summary: this presence has no compact symbol reading`);

    // the gesture itself: a real double-click on the card text opens the reading, and leaves no word selected
    await page.locator('.reveal .rv-name').dblclick();
    const opened = await until(page, () => document.body.classList.contains('deep-open'));
    const s1 = await state(page);
    check(opened && s1.deep && s1.deepOpen, 'a double-click on the card text opens the deep reading for the same presence', `${s1.hash}`);
    check(s1.selection === '', 'the word selection the double-click made is cleared', `"${s1.selection}"`);
    check(s1.kind === 'manifest' && s1.hash.endsWith('/deep'), 'the reading is the same manifestation, at depth', s1.hash);

    // Escape steps back out of the reading to the card (the existing path)
    await page.keyboard.press('Escape');
    await until(page, () => !document.body.classList.contains('deep-open'));
    const s2 = await state(page);
    check(!s2.deep && s2.kind === 'manifest', 'Escape closes the reading back to the card', s2.hash);

    // the card's own single-click 'Reading' still works (unchanged)
    await page.locator('.reveal .rv-links button', { hasText: 'Reading' }).click();
    await until(page, () => document.body.classList.contains('deep-open'));
    check((await state(page)).deep, 'the single-click \'Reading\' link still opens the reading');
    await page.keyboard.press('Escape');
    await until(page, () => !document.body.classList.contains('deep-open'));

    // the focus card: its title opens the reading; the link stays the keyboard path
    await page.evaluate(() => { location.hash = '#/f/serpent'; });
    await until(page, () => document.querySelector('.focus-label')?.classList.contains('on') && window.__earth.ctl.state.view.kind === 'focus');
    await page.waitForTimeout(400);
    const f0 = await state(page);
    check(f0.kind === 'focus' && !f0.deep, 'a focus card stands for the family', f0.hash);
    await synthDblclick(page, '.focus-label .fl-links .link-quiet');
    await page.waitForTimeout(300);
    check(!(await state(page)).deep, 'a double-click on a focus-card link does not open the reading');
    await page.locator('.focus-label .fl-name').dblclick();
    const fOpen = await until(page, () => document.body.classList.contains('deep-open'));
    const f1 = await state(page);
    check(fOpen && f1.deep && f1.kind === 'focus', 'a double-click on the focus card opens the family reading', f1.hash);
    await page.keyboard.press('Escape');
    await until(page, () => !document.body.classList.contains('deep-open'));
    const hasFocusLink = await page.evaluate(() => [...document.querySelectorAll('.focus-label .fl-links button')].some((b) => b.textContent === 'Reading'));
    check(hasFocusLink, 'the focus card keeps its \'Reading\' link as the keyboard path');
    await ctx.close();
  }

  // ── (ii) the thread strip ───────────────────────────────────────────────
  for (const instant of [false, true]) {
    const label = instant ? 'rail without its transition (the old jump)' : 'rail with its own transition';
    const prepare = async (page) => {
      await until(page, () => window.__earth.ctl.tour && document.querySelectorAll('.st-frame').length >= 10);
      await page.evaluate(() => window.__earth.ctl.tourPause());
      if (instant) await page.addStyleTag({ content: '.st-rail { transition: none !important; }' });
      await page.waitForTimeout(1200);
    };
    const frameBox = (page, n) => page.locator('.st-frame').nth(n).boundingBox();

    {
      const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/t/serpent' });
      track(page);
      await prepare(page);
      const frames = await page.locator('.st-frame').count();
      check(frames >= 10, `the thread has ≥10 steps to walk (${label})`, `${frames} steps`);
      // a single tap jumps at once: the step is current in the same task as the click (frame 3 is inside the viewport)
      const b3 = await frameBox(page, 3);
      await page.mouse.click(b3.x + b3.width / 2, b3.y + b3.height / 2);
      const immediate = await page.evaluate(() => window.__earth.ctl.tour?.i);
      await page.waitForTimeout(800);
      const s = await state(page);
      check(immediate === 3 && s.tourI === 3 && !s.deep, `a single tap jumps to its step at once, without opening a reading (${label})`, `i=${immediate}, then ${s.tourI}`);
      await ctx.close();
    }
    {
      const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/t/serpent' });
      track(page);
      await prepare(page);
      const b5 = await frameBox(page, 5);
      await page.mouse.dblclick(b5.x + b5.width / 2, b5.y + b5.height / 2);
      await until(page, () => document.body.classList.contains('deep-open'));
      await page.waitForTimeout(900);
      const s = await state(page);
      check(s.tourI === 5, `a thumbnail double-click lands on its own step, 5 (not 9) (${label})`, `i=${s.tourI}`);
      check(s.deep && s.deepOpen && s.kind === 'manifest' && s.trail, `and opens that step's reading, within the thread (${label})`, s.hash);
      // the rail is centred on the step once the hold has passed
      const centred = await page.evaluate(() => {
        const rail = document.querySelector('.st-rail');
        const vp = rail.parentElement;
        const f = document.querySelectorAll('.st-frame')[window.__earth.ctl.tour.i];
        const max = Math.max(0, rail.scrollWidth - vp.clientWidth);
        const want = Math.max(0, Math.min(max, f.offsetLeft + f.offsetWidth / 2 - vp.clientWidth / 2));
        const m = /translate3d\((-?[\d.]+)px/.exec(rail.style.transform);
        return { want: Math.round(want), got: m ? Math.round(-parseFloat(m[1])) : null };
      });
      check(centred.got === centred.want, `the rail re-centres on that step once the hold passes (${label})`, `want ${centred.want}px, got ${centred.got}px`);
      await ctx.close();
    }
    if (!instant) {
      // the caption: its first tap opens the step's card and steps the strip aside (aion.css: body.thread-inspecting .strip),
      // so a second tap cannot land on the caption. The reading is reached from that card's double-click instead.
      const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/t/serpent' });
      track(page);
      await prepare(page);
      const b3 = await frameBox(page, 3);
      await page.mouse.click(b3.x + b3.width / 2, b3.y + b3.height / 2);
      await page.waitForTimeout(900);
      const cap = await page.locator('.st-caption').boundingBox();
      await page.mouse.click(cap.x + cap.width / 2, cap.y + cap.height / 2);
      await until(page, () => document.body.classList.contains('thread-inspecting'));
      await page.waitForTimeout(600);
      const card = await state(page);
      check(card.kind === 'manifest' && !card.deep && card.trail && card.tourI === 3, 'a caption tap opens the step\'s card inside the thread (unchanged)', card.hash);
      await page.locator('.reveal .rv-name').dblclick();
      await until(page, () => document.body.classList.contains('deep-open'));
      const s = await state(page);
      check(s.deep && s.kind === 'manifest' && s.trail && s.tourI === 3, 'a double-click on that card opens the reading, still within the thread', s.hash);
      await ctx.close();
    }
  }

  // ── (iii) the Red Book stop card: not wired (W1c), reported as GAPs ─────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/redbook' });
    track(page);
    await until(page, () => document.querySelector('.redbook .rv-name')?.textContent);
    await page.waitForTimeout(300);
    await page.locator('.redbook .rv-name').dblclick();
    await page.waitForTimeout(600);
    const rb = await state(page);
    gap(rb.kind === 'manifest' && rb.deep, 'a double-click on a Red Book stop opens its core reading (not wired yet)', rb.hash);
    // the Back machinery, probed directly: from the core reading of a stop, Escape should return to that Red Book stop
    const stop = await page.evaluate(async () => {
      const rb = await fetch('/data/redbook.json').then((r) => r.json());
      return rb.stops[3].id;
    });
    await page.evaluate((id) => {
      const c = window.__earth.ctl; const mdl = window.__earth.model; const o = mdl.occ[mdl.occIndex.get(id)];
      c.navigate({ view: { kind: 'manifest', occId: id, context: { type: 'family', id: o.familyId } }, deep: true });
    }, stop);
    await until(page, () => window.__earth.ctl.state.deep === true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const back = await state(page);
    gap(back.redbook, 'Escape from that core reading returns to the same Red Book stop', back.hash);
    await ctx.close();
  }
} finally {
  await browser.close();
}
check(!logs.some((l) => /pageerror/.test(l)), 'no page errors across the walk', logs.join(' | ').slice(0, 300));
console.log(`${gaps ? `${gaps} known gap(s) open (W1c, Red Book)` : 'no known gaps'}; ${failed ? `${failed} check(s) failed` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
