// Gate: the dynamical lens (DynamicsView + PhaseStrip), walked on a standalone harness page over the dev server.
//   · the strip draws for the Self and for 'serpent' (non-blank pixels);
//   · the cursor point moves when the shared clock's cursor moves;
//   · V marks stand only at midpoint transitions, and each carries the V title;
//   · the card and heading carry no sentences of the mode's own (names, the field's one-liners and labels only);
//   · inactive = hidden + inert + aria-hidden, and out of the document's voice;
//   · reduced motion: no animated trail;
//   · the Lorenz hero is non-blank and identical across two renders;
//   · the strip sits above the time track and lines up with it; the card sits above the strip; no horizontal scroll;
//   · the concept card renders only from data (the placeholder fixture), and not without it.
// Screenshots: .cache/screens/remediation-2026-10-09/dynamics/
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/dynamics-view.mjs
import fs from 'node:fs';
import { launch, URL as APP_URL } from './lib.mjs';

const BASE = APP_URL.replace(/\/$/, '');
const HARNESS = `${BASE}/tests/ui/e2e/dynamics-harness.html`;
const SHOTS = '/home/user/archetypal-earth/.cache/screens/remediation-2026-10-09/dynamics';
const V_TITLE = "Van Eenwyk's reading — not Jung's";
fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const SELF = 'archetype:self';
const SERPENT = 'family:serpent';
const ABRAXAS = 'family:abraxas';

const browser = await launch();
const errors = [];

async function open(viewport, { mobile = false, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`${HARNESS}${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__dy?.ready, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  return { ctx, page };
}

/** Pixels of the strip's canvas: how many are not transparent. */
const stripInk = (page) => page.evaluate(() => {
  const c = document.querySelector('.dy-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n;
});

/** A hash of the hero canvas's pixels, and how many of them are lit. */
const heroPixels = (page) => page.evaluate(() => {
  const c = document.querySelector('.dy-hero-canvas');
  if (!c || !c.width) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261, lit = 0;
  const colours = new Set();
  for (let i = 0; i < d.length; i++) {
    h ^= d[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    if (colours.size < 64) colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  return { hash: h.toString(16), lit, colours: colours.size, w: c.width, h: c.height };
});

const settle = (page, ms = 250) => page.waitForTimeout(ms);

// ── 1. the strip draws for the Self and for the serpent, and each mode's markers are the transitions ───────────
for (const [label, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  const { ctx, page } = await open(viewport, { mobile });
  await page.evaluate((v) => window.__dy.show(v), SELF);
  await settle(page, 400);
  const selfInk = await stripInk(page);
  check(selfInk > 500, `${label}: the strip draws the Self`, `${selfInk} inked pixels`);
  const heading = await page.textContent('.dy-heading h1');
  check(heading === 'The Self', `${label}: the heading names the Self`, `"${heading}"`);
  const marks = await page.$$eval('.dy-v', (els) => els.map((e) => ({ text: e.textContent, title: e.title, u: Number(e.dataset.u), n: Number(e.dataset.n) })));
  const transitions = await page.evaluate((s) => window.__dy.transitionCount(s), SELF);
  check(marks.length > 0 && marks.every((m) => m.text === 'V' && m.title === V_TITLE), `${label}: the Self carries V marks with the V title`, `${marks.length} marks`);
  check(marks.reduce((n, m) => n + m.n, 0) === transitions, `${label}: every midpoint transition is covered by exactly one mark`, `${transitions} transitions`);
  const mids = await page.evaluate((s) => window.__dy.transitionMids(s), SELF);
  const lo = Math.min(...mids), hi = Math.max(...mids);
  check(marks.every((m) => m.u >= lo - 1e-6 && m.u <= hi + 1e-6), `${label}: marks stand only within the transitions' span`);
  await settle(page, 0);
  await page.screenshot({ path: `${SHOTS}/${label}-self.png` });

  await page.evaluate((v) => window.__dy.show(v), SERPENT);
  await settle(page, 400);
  const serpentInk = await stripInk(page);
  check(serpentInk > 300, `${label}: the strip draws the serpent`, `${serpentInk} inked pixels`);
  const serpentMarks = await page.$$eval('.dy-v', (els) => els.length);
  check(serpentMarks === 0, `${label}: the serpent (flat in s) carries no V mark`, `${serpentMarks} marks`);
  const serpentHeading = await page.textContent('.dy-heading h1');
  check(serpentHeading === 'Serpent', `${label}: the heading names the serpent`, `"${serpentHeading}"`);
  await page.screenshot({ path: `${SHOTS}/${label}-serpent.png` });

  // the strip sits above the time track and lines up with it; the card sits above the strip; nothing scrolls sideways
  const geo = await page.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const strip = r('.dy-strip'), track = r('.t-track'), card = r('.dy-card');
    return {
      stripBottomGap: track.top - strip.bottom,
      leftDelta: Math.abs(strip.left - track.left),
      rightDelta: Math.abs(strip.right - track.right),
      cardAboveStrip: strip.top - card.bottom,
      cardTop: card.top,
      cardInside: card.left >= 0 && card.right <= window.innerWidth + 0.5 && card.top >= 0,
      scrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 0.5,
    };
  });
  check(geo.stripBottomGap >= 0 && geo.stripBottomGap <= 16, `${label}: the strip stands just above the time track`, `gap ${geo.stripBottomGap.toFixed(1)}px`);
  check(geo.leftDelta <= 1.5 && geo.rightDelta <= 1.5, `${label}: the strip lines up with the time track`, `Δleft ${geo.leftDelta.toFixed(1)}, Δright ${geo.rightDelta.toFixed(1)}`);
  check(geo.cardAboveStrip >= 0 && geo.cardAboveStrip <= 24, `${label}: the reveal card stands above the strip`, `gap ${geo.cardAboveStrip.toFixed(1)}px`);
  check(geo.cardInside, `${label}: the reveal card is inside the viewport`, `card top ${geo.cardTop.toFixed(0)}px`);
  check(!geo.scrollsSideways, `${label}: no horizontal page scroll`);

  // the hero: non-blank, and the same pixels on a second render
  await page.evaluate((v) => window.__dy.show(v), SELF);
  await settle(page, 300);
  const first = await heroPixels(page);
  await page.evaluate(() => window.__dy.hide());
  await page.evaluate((v) => window.__dy.show(v), SELF);
  await settle(page, 300);
  const second = await heroPixels(page);
  check(first && first.lit > 500 && first.colours > 12, `${label}: the Lorenz hero is drawn (non-blank)`, first ? `${first.lit} lit, ${first.colours} colours` : 'no hero');
  check(first && second && first.hash === second.hash, `${label}: the hero is identical across two renders`, first && second ? `${first.hash} = ${second.hash}` : '');
  await page.screenshot({ path: `${SHOTS}/${label}-self-card.png` });
  await ctx.close();
}

// ── 2. the cursor point follows the shared clock; reduced motion removes the trail ───────────────────────────────
{
  const { ctx, page } = await open({ width: 1440, height: 900 });
  await page.evaluate((v) => window.__dy.show(v), SELF);
  // two clock positions inside the Self's own span (the point rides the line; before its first occurrence there is none)
  const [u0, u1] = await page.evaluate((v) => window.__dy.span(v), SELF);
  const at = (f) => u0 + (u1 - u0) * f;
  // the controller's frame calls update(dt); the harness's own frame loop is too slow here to be relied on, so the walk calls it
  const tick = () => page.evaluate(() => window.__dy.view.update(0));
  await page.evaluate((u) => window.__dy.scrub(u), at(0.3));
  await tick();
  const a = await page.evaluate(() => window.__dy.view.strip.inspect());
  await page.evaluate((u) => window.__dy.scrub(u), at(0.6));
  await tick();
  const b = await page.evaluate(() => window.__dy.view.strip.inspect());
  check(a.cursor && b.cursor && b.cursor.x > a.cursor.x, 'the cursor point moves right as the clock moves on', a.cursor && b.cursor ? `x ${a.cursor.x.toFixed(1)} → ${b.cursor.x.toFixed(1)}` : 'no cursor');
  check(a.trailPoints > 0 && !a.reducedMotion, 'with motion allowed, the cursor carries a short trail', `${a.trailPoints} points`);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate((u) => window.__dy.scrub(u), at(0.45));
  await tick();
  const reduced = await page.evaluate(() => window.__dy.view.strip.inspect());
  check(reduced.reducedMotion && reduced.trailPoints === 0 && reduced.cursor, 'under reduced motion there is no trail, only the point', `trail ${reduced.trailPoints}`);
  await ctx.close();
}

// ── 3. the card and heading carry no sentences of the mode's own ──────────────────────────────────────────────
for (const subject of [SELF, SERPENT, ABRAXAS]) {
  const { ctx, page } = await open({ width: 1440, height: 900 });
  await page.evaluate((v) => window.__dy.show(v), subject);
  await settle(page, 250);
  const allowed = await page.evaluate((v) => window.__dy.allowedText(v), subject);
  const texts = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.querySelector('.dynamics'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    return out;
  });
  const stray = texts.filter((t) => !allowed.includes(t));
  check(stray.length === 0, `no sentences of the mode's own for ${subject}`, stray.length ? `stray: ${JSON.stringify(stray.slice(0, 5))}` : `${texts.length} labels`);
  const hasConcept = await page.$('.dy-quote');
  check(!hasConcept, `no concept card without concept data (${subject})`);
  await ctx.close();
}

// ── 4. concept data renders one V concept at a time, with its J pair, from the data only ─────────────────────────
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, { query: '?concepts=1' });
  await page.evaluate((v) => window.__dy.show(v), SELF);
  await settle(page, 300);
  const quotes = await page.$$eval('.dy-card .dy-quote', (els) => els.map((e) => ({ text: e.querySelector('p').textContent, marks: [...e.querySelectorAll('.dy-chip')].map((c) => c.textContent + '|' + c.title) })));
  check(quotes.length === 2, 'the Self (which visits the serpent) shows the concept: a V and a J quotation', `${quotes.length} quotations`);
  check(quotes[0]?.marks[0] === `V|${V_TITLE}` && quotes[1]?.marks[0] === "J|Asserted in Jung's own text", 'each quotation carries its voice mark with its title');
  check(quotes.every((q) => q.text.startsWith('PLACEHOLDER')), 'the concept text comes only from the data');
  await page.screenshot({ path: `${SHOTS}/desktop-self-concept.png` });
  await page.evaluate((v) => window.__dy.show(v), ABRAXAS);
  await settle(page, 200);
  check((await page.$$('.dy-card .dy-quote')).length === 0, 'a subject that visits none of the concept families shows no concept card');
  await ctx.close();
}

// ── 5. inactive: hidden, inert and out of the accessibility tree; the body class goes with it ───────────────────
{
  const { ctx, page } = await open({ width: 1440, height: 900 });
  await page.evaluate((v) => window.__dy.show(v), SELF);
  await page.evaluate(() => window.__dy.hide());
  await settle(page, 100);
  const down = await page.evaluate(() => {
    const root = document.querySelector('.dynamics');
    return { hidden: root.hidden, inert: root.inert, aria: root.getAttribute('aria-hidden'), display: getComputedStyle(root).display, body: document.body.classList.contains('dynamics-mode') };
  });
  check(down.hidden && down.inert && down.aria === 'true' && down.display === 'none' && !down.body, 'inactive: hidden, inert, aria-hidden, display none', JSON.stringify(down));
  await page.evaluate((v) => window.__dy.show(v), SELF);
  const up = await page.evaluate(() => {
    const root = document.querySelector('.dynamics');
    return { hidden: root.hidden, inert: root.inert, aria: root.getAttribute('aria-hidden'), body: document.body.classList.contains('dynamics-mode') };
  });
  check(!up.hidden && !up.inert && up.aria === null && up.body, 'active: shown, out of inert, no aria-hidden', JSON.stringify(up));
  await ctx.close();
}

await browser.close();
const relevant = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
check(relevant.length === 0, 'no page errors or console errors', relevant.slice(0, 3).join(' | '));
console.log(failed ? `\n${failed} check(s) failed` : '\nall dynamics-view checks passed');
process.exit(failed ? 1 : 0);
