// Gate: the Red Book card, walked stop by stop (all 37, by the arrow key and the rail), against the card rules:
//   · every stop has a figure.plate hero;
//   · the first content block after the name is a visible blockquote.dp-def (no click needed);
//   · no paragraph is plate inventory (PLATE / PLATES / Plate), whole or merged into its prose;
//   · no footer carries a raw work slug (liber-novus, redbook, memories) or a cw key;
//   · the Aion card is not visible and not in the accessibility tree while the Red Book stands;
//   · the genesis table keeps the same rules.
// Screenshots: .cache/screens/remediation-2026-10-09/redbook/
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/redbook-cards.mjs [chromium|webkit]
import fs from 'node:fs';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const SHOTS = '/home/user/archetypal-earth/.cache/screens/remediation-2026-10-09/redbook';
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Everything the rules need, read from the live page. */
const snapshot = () => {
  const inA11y = (node) => {
    if (!node || !node.isConnected) return false;
    for (let n = node; n; n = n.parentElement) {
      if (n.hidden || n.inert || n.getAttribute('aria-hidden') === 'true' || getComputedStyle(n).display === 'none') return false;
    }
    return node.getBoundingClientRect().height > 0;
  };
  const card = document.querySelector('.redbook .rb-card');
  const name = card?.querySelector('.rv-name');
  const next = name?.nextElementSibling ?? null;
  const hero = card?.querySelector('figure.plate.rv-hero') ?? null;
  const paragraphs = [...(card?.querySelectorAll('p') ?? [])].map((p) => p.textContent.trim());
  const footers = [...(card?.querySelectorAll('footer') ?? [])].map((f) => f.textContent.trim());
  const aionCards = [...document.querySelectorAll('section.aion .aion-card')];
  return {
    progress: document.querySelector('.rb-progress')?.textContent ?? '',
    name: name?.textContent ?? '',
    hero: !!hero,
    heroState: hero ? (hero.classList.contains('loaded') ? 'image' : hero.classList.contains('plate-empty') ? 'tonal' : 'pending') : 'none',
    firstBlock: next ? next.tagName.toLowerCase() + (next.classList.contains('dp-def') ? '.dp-def' : '') : '',
    firstBlockVisible: inA11y(next),
    leaks: paragraphs.filter((t) => /^PLATES?\b/.test(t) || /\bPLATES?\s*[(:]\s*p\d{4}\.jpg/i.test(t)),
    footers,
    slugs: footers.filter((t) => /liber-novus|redbook|memories|\bcw\d/i.test(t)),
    cardVisible: inA11y(card),
    aionVisible: aionCards.some(inA11y),
    pageErrors: 0,
  };
};

const browser = await launch(kind, { headed: false });
try {
  const { ctx, page, logs } = await open(browser, { width: 1280, height: 800, hash: '#/redbook' });
  await page.evaluate(() => { window.__earth.engine.rig.interacted = true; document.body.classList.add('interacted'); });
  await page.waitForSelector('.redbook .rb-card .rv-name', { timeout: 20000 });
  await page.waitForTimeout(800);

  const start = await page.evaluate(() => document.querySelector('.rb-progress')?.textContent ?? '');
  const total = Number(start.split('/')[1]?.trim());
  check(total === 37, 'the walk has 37 stops', `progress "${start}"`);
  const first = Number(start.split('/')[0]);
  const seen = new Set();
  const tonal = [];
  const images = [];

  for (let step = 0; step < total; step++) {
    const expected = `${((first - 1 + step) % total) + 1} / ${total}`;
    // the hero is an image or a tonal plate: wait for the image to settle (or fail) before reading the card
    await page.waitForFunction(() => {
      const h = document.querySelector('.redbook .rb-card figure.plate.rv-hero');
      return !h || h.classList.contains('loaded') || h.classList.contains('plate-empty') || h.classList.contains('plate-failed');
    }, null, { timeout: 4000 }).catch(() => {});
    const s = await page.evaluate(snapshot);
    const tag = `stop ${s.progress}`;
    seen.add(s.progress);
    check(s.progress === expected, `${tag} is in walk order`, `expected ${expected}`);
    check(s.hero, `${tag} has a figure.plate hero`, s.heroState);
    if (s.heroState === 'tonal') tonal.push(s.progress);
    if (s.heroState === 'image') images.push(s.progress);
    check(s.firstBlock === 'blockquote.dp-def' && s.firstBlockVisible, `${tag} leads with an open blockquote.dp-def`, `first block "${s.firstBlock}" visible ${s.firstBlockVisible} after "${s.name}"`);
    check(s.leaks.length === 0, `${tag} carries no plate inventory`, s.leaks.join(' | ').slice(0, 160));
    check(s.slugs.length === 0, `${tag} has no raw slug in a footer`, s.slugs.join(' | ').slice(0, 160));
    check(s.cardVisible && !s.aionVisible, `${tag} shows the Red Book card and no Aion card`, `red book in a11y ${s.cardVisible}, aion in a11y ${s.aionVisible}`);
    if (s.heroState === 'image' && images.length === 1) await page.screenshot({ path: `${SHOTS}/stop-image-${s.progress.split(' ')[0]}.png` });
    if (s.heroState === 'tonal' && tonal.length === 1) await page.screenshot({ path: `${SHOTS}/stop-tonal-${s.progress.split(' ')[0]}.png` });
    if (step < total - 1) {
      const nextExpected = `${((first - 1 + step + 1) % total) + 1} / ${total}`;
      // the arrow key walks (the controller's keyboard path); step 5 walks by the rail's own button instead
      if (step === 5) await page.click('.rb-rail button[aria-label="Next folio"]');
      else await page.keyboard.press('ArrowRight');
      await page.waitForFunction((t) => document.querySelector('.rb-progress')?.textContent === t, nextExpected, { timeout: 5000 }).catch(() => {});
    }
  }
  check(seen.size === total, 'every one of the 37 stops was visited', `${seen.size} distinct`);
  check(tonal.length === 0, 'no stop is a tonal plate without an image', tonal.length ? tonal.join(', ') : 'all stops carry an image');
  console.log(`INFO ${kind} hero images loaded on ${images.length}/${total} stops; tonal ${tonal.length}`);

  // the landing shot, after the walk, is the genesis table
  await page.click('.rb-modes button:nth-child(2)');
  await page.waitForSelector('.rb-genesis', { timeout: 5000 });
  await page.waitForTimeout(400);
  const genesis = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.redbook .rb-card .rb-genesis')];
    return rows.map((r) => ({
      name: r.querySelector('.rb-genesis-name strong')?.textContent ?? '',
      quoteFirst: r.firstElementChild?.tagName === 'P' && r.querySelector('blockquote.dp-def') !== null,
      footer: r.querySelector('footer')?.textContent ?? '',
      doctrine: r.querySelector('.rb-doctrine')?.textContent ?? '',
      stop: r.querySelector('.rb-genesis-stop')?.textContent ?? '',
    }));
  });
  check(genesis.length >= 14, 'the genesis table carries every row', `${genesis.length} rows`);
  for (const row of genesis) {
    check(!/liber-novus|redbook|memories/i.test(row.footer) && /^Jung · /.test(row.footer), `genesis "${row.name}" cites through the core voice`, row.footer);
    check(!/\bcw\d|sem-\d/i.test(row.doctrine), `genesis "${row.name}" doctrine carries no raw work key`);
  }
  await page.screenshot({ path: `${SHOTS}/genesis.png` });
  check(!logs.some((l) => /pageerror/i.test(l)), 'no page errors during the walk', logs.filter((l) => /pageerror/i.test(l)).join(' | ').slice(0, 300));
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
