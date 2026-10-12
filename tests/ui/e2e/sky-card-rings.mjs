// Gate: the planet's tarot cards. A held planet floats its cards on two outer rings beyond the archetypes' two orbits
// (the decan wheel, each card at its decan's longitude; the rank ring, the four cards of its number with its Atu); a card
// opens its reading at the planet — no gaze at the Earth, no leaving the sky — and closing the reading leaves the rings.
// The outer planets carry what Crowley's list gives them (Pluto the Aces, Neptune the Twos), Uranus (the Abyss) none.
//   npx vite --port 5183 --strictPort &
//   node tests/ui/e2e/sky-card-rings.mjs [outdir]
import fs from 'node:fs';
import path from 'node:path';
import { launch, open } from './lib.mjs';

const out = process.argv[2];
if (out) fs.mkdirSync(out, { recursive: true });
let failed = 0;
const check = (ok, label, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); };

/** Hold a planet and wait for its approach to arrive and its card rings to stand. */
async function hold(page, key, { cards = true } = {}) {
  await page.evaluate((k) => window.__earth.ctl.openBody(k), key);
  await page.waitForFunction((k) => {
    const { engine } = window.__earth;
    const po = document.querySelector('.po');
    // (arrived: the camera at rest at the station — the approach's own ease finishes before a planet-to-planet move does)
    return engine.sky && engine.sky.approached === k && engine.sky.approach > 0.99 && document.body.dataset.skyPhase === 'approach' && po && !po.hidden && document.querySelectorAll('.po-sat').length > 0;
  }, key, { timeout: 60000 });
  if (cards) await page.waitForFunction(() => document.querySelectorAll('.po-card').length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
}

const state = (page) => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight;
  const cards = [...document.querySelectorAll('.po-card')].map((c) => {
    const r = c.getBoundingClientRect();
    return { ring: c.classList.contains('po-card-decan') ? 'decan' : 'rank', label: c.getAttribute('aria-label'), cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, op: Number(c.style.opacity) };
  });
  return { vw, vh, cards, phase: document.body.dataset.skyPhase, hash: location.hash, sats: document.querySelectorAll('.po-sat').length };
});

const browser = await launch('chromium', { headed: false });
for (const s of [{ name: 'desk', width: 1440, height: 900, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
  const { ctx, page, logs } = await open(browser, { width: s.width, height: s.height, mobile: s.mobile });

  await hold(page, 'mars');
  let st = await state(page);
  const decan = st.cards.filter((c) => c.ring === 'decan');
  const rank = st.cards.filter((c) => c.ring === 'rank');
  check(decan.length === 6 && rank.length === 6, `${s.name}: Mars floats its six decan cards and six on the rank ring`, `${decan.length} + ${rank.length}`);
  check(st.sats > 0, `${s.name}: the archetypes' two orbits are kept`, `${st.sats} satellites`);
  const inside = st.cards.every((c) => c.cx > 0 && c.cx < st.vw && c.cy > 0 && c.cy < st.vh);
  check(inside, `${s.name}: every card stands on screen`);
  check(st.cards.every((c) => c.op > 0.5), `${s.name}: every card is shown`);
  if (out) await page.screenshot({ path: path.join(out, `${s.name}-mars-rings.png`) });

  // a card opens at the planet: the sheet, the sign's glyph, and the sky stays held
  const hashBefore = st.hash;
  // (dispatched on the control itself: two cards may overlap on a phone, and a click at a point reaches the top one)
  await page.evaluate(() => document.querySelector('.po-card-decan').click());
  await page.waitForSelector('.lens-panel:not([hidden]) .cr', { timeout: 10000 });
  const reading = await page.evaluate(() => ({
    title: document.querySelector('.cr-title')?.textContent, sign: !!document.querySelector('.cr-sign svg'),
    tint: getComputedStyle(document.querySelector('.cr')).getPropertyValue('--cr-tint').trim(),
    cites: [...document.querySelectorAll('.cr .lq-cite')].map((c) => c.textContent), phase: document.body.dataset.skyPhase, hash: location.hash,
  }));
  check(reading.title === 'Two of Wands', `${s.name}: the first decan card opens its reading`, reading.title);
  check(reading.sign && /rgb/.test(reading.tint), `${s.name}: the sign's glyph and its band hue tint the sheet`, reading.tint);
  check(reading.cites.length >= 2 && reading.cites.every((c) => /pdf p\d+/.test(c)), `${s.name}: the reading rests on placed quotations`, reading.cites.slice(0, 2).join(' | '));
  check(reading.phase === 'approach' && reading.hash === hashBefore, `${s.name}: it stays at the planet — no gaze at the Earth, no route change`, `${reading.phase} ${reading.hash}`);
  if (out) await page.screenshot({ path: path.join(out, `${s.name}-mars-card.png`) });

  // closing the reading leaves the rings standing
  await page.click('.lens-panel .lp-close');
  await page.waitForTimeout(700);
  st = await state(page);
  check(st.cards.length === 12 && st.phase === 'approach', `${s.name}: closing the reading returns to the planet with its rings`, `${st.cards.length} cards, ${st.phase}`);

  // the outer planets carry what Crowley's list gives them
  await hold(page, 'pluto');
  st = await state(page);
  check(st.cards.length === 4 && st.cards.every((c) => /Ace of/.test(c.label)), `${s.name}: Pluto, the primum mobile, floats the four Aces`, st.cards.map((c) => c.label.split(':')[0]).join(', '));
  await hold(page, 'uranus', { cards: false });
  await page.waitForFunction(() => [...document.querySelectorAll('.po-sat')].some((x) => x.textContent === 'The Abyss'), null, { timeout: 15000 });
  st = await state(page);
  check(st.cards.length === 0 && st.sats > 0, `${s.name}: Uranus has archetypes and no card`, `${st.cards.length} cards, ${st.sats} satellites`);
  // …and the Abyss Crowley's list gives it, as the words alone
  await page.locator('.po-sat', { hasText: 'The Abyss' }).click({ force: true });
  await page.waitForSelector('.lens-panel:not([hidden])', { timeout: 10000 });
  const abyss = await page.evaluate(() => document.querySelector('.lens-panel .lp-body')?.innerText ?? '');
  check(/Abyss/.test(abyss) && /Herschel/.test(abyss) && /pdf p111/.test(abyss), `${s.name}: the Abyss reads from Crowley's words, placed`, abyss.slice(0, 60).replace(/\n/g, ' '));
  await page.click('.lens-panel .lp-close');

  // the Earth, held like any body (the camera goes in to it): the four elements beside it, the Tens and its elemental Atu round it
  await page.evaluate(() => window.__earth.ctl.openBody('terra'));
  await page.waitForFunction(() => window.__earth.engine.sky?.approached === 'terra' && document.body.dataset.skyPhase === 'approach' && document.querySelectorAll('.po-card').length >= 8 && !document.querySelector('.po')?.hidden, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  st = await state(page);
  const earthSats = await page.evaluate(() => [...document.querySelectorAll('.po-sat')].map((x) => x.textContent));
  check(st.cards.length === 8 && st.phase === 'approach', `${s.name}: the Earth floats the four Tens and its four elemental Atu`, `${st.cards.length} cards, ${st.phase}`);
  check(['Fire', 'Water', 'Air', 'Earth'].every((e) => earthSats.includes(e)), `${s.name}: the four elements stand at the Earth`, earthSats.join(', '));
  check(st.cards.every((c) => c.cx > 0 && c.cx < st.vw && c.cy > 0 && c.cy < st.vh), `${s.name}: the Earth's cards stand on screen`);
  if (out) await page.screenshot({ path: path.join(out, `${s.name}-earth-rings.png`) });

  // a card's own page says where it hangs: the sky tie the cards give the reveal (a fresh page: no sky behind it)
  const p2 = await ctx.newPage();
  await p2.goto(`${process.env.EARTH_URL ?? 'http://localhost:5183/'}#/f/thoth-five-of-cups`, { waitUntil: 'load' });
  await p2.waitForFunction(() => /See in sky/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  const seen = await p2.evaluate(() => (document.body.innerText.match(/See in sky \([^)]+\)/g) ?? []));
  check(seen.some((t) => /Mars/.test(t)), `${s.name}: a card's reveal offers "See in sky" at its planet`, seen.join(', '));
  await p2.close();

  check(logs.filter((l) => !/ephemeris|sidecar|sky camera:/i.test(l)).length === 0, `${s.name}: no console errors`, logs.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
