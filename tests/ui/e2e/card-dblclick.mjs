// Gate: a double-click on a card surface opens its reading (audit W1, SPEC §9/§12/§17). Single-click controls are untouched,
// and a thumbnail double-click lands on its own step (the rail no longer re-centres between the two taps).
//   · reveal card (manifestation): dblclick → deep reading; close, links, disclosures ignore it; Escape closes the reading
//   · focus card: dblclick → deep reading; its 'Reading' link is the keyboard path
//   · thread strip: single tap jumps at once; dblclick on step 5 lands on 5 and opens its reading, with the rail held
//     still (run twice: with the rail's own transition, and with it removed, which re-creates the old i=5 → i=9 jump)
//   · strip caption: dblclick opens the current step's reading
//   · Red Book stop card: dblclick → the stop's core reading; Escape returns to the same Red Book stop (W1c)
//   · Aion event card: dblclick → the event's first occurrence as its core reading; Escape returns to the same event;
//     an epoch card and an event with no occurrence do nothing
//   · sky body card: dblclick → the body's descent target as its core reading; Escape returns to the same body
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
const history = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/history.json'), 'utf8'));
const redbook = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/redbook.json'), 'utf8'));
const sky = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/sky.json'), 'utf8'));
const occIds = new Set(field.occurrences.map((o) => o.id));
const aionReading = history.readings[0];
const aionEvent = aionReading.events.find((e) => (e.occurrenceIds ?? []).some((id) => occIds.has(id)));
const aionEventOcc = aionEvent.occurrenceIds.find((id) => occIds.has(id));
const aionBare = aionReading.events.find((e) => !(e.occurrenceIds ?? []).some((id) => occIds.has(id)));
const aionEpoch = aionReading.epochs.find((e) => !e.parentId);
// the null landing centres The Self: the folio its genesis row names (as modes-switch.mjs reads it)
const rbSelfStop = redbook.genesis.find((g) => g.target?.kind === 'archetype' && g.target.id === 'self').stopId;
const skyBody = 'venus';
const skyTarget = sky.bodies.find((b) => b.key === skyBody).ties.find((t) => t.basis !== 'site' && t.target)?.target;

let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
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
    redbookStop: c.state.redbook?.stop ?? null,
    occId: c.state.view.kind === 'manifest' ? c.state.view.occId : null,
    subject: c.state.view.kind === 'focus' ? `${c.state.view.subject.type}/${c.state.view.subject.id}` : null,
    aion: c.state.history ? { reading: c.state.history.reading, selection: c.state.history.selection ?? null } : null,
    sky: c.state.sky ? (c.state.sky.body ?? '') : null,
    from: !!c.state.from,
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

    // the hero plate is a gesture surface too: a double-click on the image opens the reading
    await page.locator('.reveal .rv-hero').dblclick({ position: { x: 40, y: 40 } });
    const heroOpen = await until(page, () => document.body.classList.contains('deep-open'));
    check(heroOpen && (await state(page)).deep, 'a double-click on the hero plate opens the deep reading');
    await page.keyboard.press('Escape');
    await until(page, () => !document.body.classList.contains('deep-open'));
    await page.waitForTimeout(700); // the card settles back from the reading before its text is pointed at

    // a word in a paragraph is the reader's to select (audit W1 follow-up): its double-click selects the word and opens nothing
    const word = await page.evaluate(() => {
      const p = document.querySelector('.reveal .rv-para');
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const m = /\b[A-Za-z]{4,}(?:['’][a-z]+)?/.exec(node.data); // a word, with its possessive: the browser selects both
        if (!m) continue;
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const r = range.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: m[0] };
      }
      return null;
    });
    if (word) {
      await page.mouse.dblclick(word.x, word.y);
      await page.waitForTimeout(400);
      const sw = await state(page);
      check(sw.selection.trim() === word.text && !sw.deep && !sw.deepOpen, 'a double-click on a word in a paragraph selects that word and does not open the reading', `selected "${sw.selection}", deep ${sw.deep}`);
    } else check(false, 'a paragraph of the card holds a word to double-click');

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

  // ── (iii) the Red Book folio card: dblclick → its core reading; Escape → the same folio (W1c) ───────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: '#/redbook' });
    track(page);
    await until(page, () => document.querySelector('.redbook .rv-name')?.textContent);
    await page.waitForTimeout(300);
    const before = await state(page);
    const landingName = await page.locator('.redbook .rv-name').textContent();
    check(before.redbook && before.redbookStop === null && before.kind === 'world', 'the Red Book stands on its null landing before the gesture', before.hash);
    await page.locator('.redbook .rv-name').dblclick();
    await until(page, () => window.__earth.ctl.state.deep === true && window.__earth.ctl.state.view.kind === 'manifest');
    await page.waitForTimeout(500);
    const rb = await state(page);
    check(rb.kind === 'manifest' && rb.deep && rb.deepOpen && rb.from, 'a double-click on a Red Book folio opens that folio\'s core reading, at depth', rb.hash);
    const landedOn = rb.occId;
    check(landedOn === rbSelfStop, 'the reading is the standing folio\'s own occurrence (The Self\'s folio on the null landing)', `${landedOn}`);
    await page.keyboard.press('Escape');
    await until(page, () => window.__earth.ctl.state.redbook && !window.__earth.ctl.state.deep);
    await page.waitForTimeout(500);
    const back = await state(page);
    const backName = await page.locator('.redbook .rv-name').textContent();
    check(back.redbook && !back.deep && !back.from && backName === landingName, 'Escape returns to the Red Book folio the reader was on (the null landing), and the memory is spent', `${back.hash}, "${backName}"`);
    // the same walk, from a folio the reader walked to: the return is to that folio, not the landing
    await page.keyboard.press('ArrowRight');
    await until(page, (id) => !!window.__earth.ctl.state.redbook?.stop && window.__earth.ctl.state.redbook.stop !== id, landedOn);
    await page.waitForTimeout(500);
    const next = await state(page);
    await page.locator('.redbook .rv-name').dblclick();
    await until(page, () => window.__earth.ctl.state.deep === true && window.__earth.ctl.state.view.kind === 'manifest');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await until(page, () => window.__earth.ctl.state.redbook && !window.__earth.ctl.state.deep);
    await page.waitForTimeout(500);
    const back2 = await state(page);
    check(back2.redbookStop === next.redbookStop && back2.redbookStop !== landedOn, 'after walking on, Escape returns to the folio the reader was on', `${back2.redbookStop}`);
    await ctx.close();
  }

  // ── (iv) the Aion event card: dblclick → its occurrence's core reading; Escape → the same event ───────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: `#/aion/${aionReading.id}/event/${aionEvent.id}` });
    track(page);
    await until(page, (name) => document.querySelector('.aion-card .rv-name')?.textContent === name, aionEvent.name);
    await page.waitForTimeout(500);
    const a0 = await state(page);
    check(a0.aion?.selection?.id === aionEvent.id, 'the Aion event card stands for the event', a0.hash);
    await page.locator('.aion-card .rv-name').dblclick();
    await until(page, () => window.__earth.ctl.state.deep === true && window.__earth.ctl.state.view.kind === 'manifest');
    await page.waitForTimeout(500);
    const a1 = await state(page);
    check(a1.occId === aionEventOcc && a1.deep && a1.deepOpen && !a1.aion, 'a double-click on the event card opens its first occurrence as the core reading', `${a1.hash}`);
    await page.keyboard.press('Escape');
    await until(page, () => window.__earth.ctl.state.history && !window.__earth.ctl.state.deep);
    await page.waitForTimeout(500);
    const a2 = await state(page);
    check(a2.aion?.reading === aionReading.id && a2.aion?.selection?.id === aionEvent.id && !a2.from, 'Escape returns to the same Aion event', a2.hash);

    // an event whose occurrence is not in the field does nothing (never an invented target)
    if (aionBare) {
      await page.evaluate((hash) => { location.hash = hash; }, `#/aion/${aionReading.id}/event/${aionBare.id}`);
      await until(page, (id) => window.__earth.ctl.state.aion?.selection?.id === id, aionBare.id);
      await page.waitForTimeout(500);
      await page.locator('.aion-card .rv-name').dblclick();
      await page.waitForTimeout(500);
      const bare = await state(page);
      check(!bare.deep && bare.kind === 'world' && bare.aion?.selection?.id === aionBare.id, 'an event with no occurrence in the field opens nothing', bare.hash);
    } else console.log(`SKIP ${kind} event without occurrence: none in ${aionReading.id}`);

    // an epoch card has no occurrence of its own: its double-click does nothing
    await page.evaluate((hash) => { location.hash = hash; }, `#/aion/${aionReading.id}/epoch/${aionEpoch.id}`);
    await until(page, (id) => window.__earth.ctl.state.aion?.selection?.id === id, aionEpoch.id);
    await page.waitForTimeout(500);
    await page.locator('.aion-card .rv-name').dblclick();
    await page.waitForTimeout(500);
    const ep = await state(page);
    check(!ep.deep && ep.kind === 'world' && ep.aion?.selection?.id === aionEpoch.id, 'an epoch card\'s double-click opens nothing', ep.hash);
    await ctx.close();
  }

  // ── (v) the sky body card: dblclick → its descent target as the core reading; Escape → the same body ─────
  {
    const { ctx, page } = await open(browser, { width: 1280, height: 800, hash: `#/sky/${skyBody}` });
    track(page);
    await until(page, () => document.querySelector('.sky-card.on .rv-name')?.textContent);
    await page.waitForTimeout(600);
    const k0 = await state(page);
    check(k0.sky === skyBody, 'the sky body card stands for the body', k0.hash);
    await page.locator('.sky-card .rv-name').dblclick();
    await until(page, () => window.__earth.ctl.state.deep === true && window.__earth.ctl.state.view.kind === 'focus');
    await page.waitForTimeout(500);
    const k1 = await state(page);
    check(k1.subject === `${skyTarget.type}/${skyTarget.id}` && k1.deep && k1.deepOpen && !k1.sky, 'a double-click on the body card opens its descent target as the core reading', `${k1.subject}, ${k1.hash}`);
    await page.keyboard.press('Escape');
    await until(page, () => window.__earth.ctl.state.sky && !window.__earth.ctl.state.deep);
    await page.waitForTimeout(500);
    const k2 = await state(page);
    check(k2.sky === skyBody && !k2.from, 'Escape returns to the same sky body', k2.hash);
    await ctx.close();
  }
} finally {
  await browser.close();
}
check(!logs.some((l) => /pageerror/.test(l)), 'no page errors across the walk', logs.join(' | ').slice(0, 300));
console.log(`${failed ? `${failed} check(s) failed` : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
