// Gate (remediation C1/C3/C4): the Aion card. Every card carries its hero slot (an image, or a tonal plate when there is
// none); the key passage is the first open blockquote, visible without a click, cited in the field's own voice; the
// remaining passages sit in "More from the text"; and no excuse-narration or raw yearDisplay suffix reaches the reader.
//   npx vite --port 5183 --strictPort &      EARTH_HEADLESS=1 node tests/ui/e2e/aion-cards.mjs [chromium|webkit]
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.cache/screens/remediation-2026-10-09/aion');
mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

// Excuse-narration and metadata that the text pass removed. Matched against everything a card shows.
const REMOVED = [
  /the atlas/i, /this atlas/i, /the vault/i, /not softened/i, /S-correction/, /kept beside/i, /\(S\)/, /\(J\)/,
  /\(S[,)]/, /\(J[,)]/, /\(not in (the )?corpus\)/i, /\brows?\b/i, /\bfn\d+/i,
  /display choice/i, /approximate midpoint/i, /approximate marker/i, /display marker/i, /astronomical anchors/i,
  /existing field dating/i, /lower-bound display/i, /THE forecast/, /Aion — /, /Label law/i, /site.s summary/i,
];

/** Everything a reader sees on the card, and in the Browse event list, as text. */
const readerText = (page) => page.evaluate(() => {
  const card = document.querySelector('section.aion .aion-card');
  const browse = [...document.querySelectorAll('.aion-browse option')].map((o) => o.textContent);
  return { card: card ? card.innerText : '', browse: browse.join('\n') };
});

const SCENES = [
  { hash: '#/aion/jung-aion/epoch/pisces-first-fish', name: 'epoch-pisces-first-fish', kind: 'epoch' },
  { hash: '#/aion/jung-aion/epoch/taurus', name: 'epoch-taurus-tonal', kind: 'epoch' },
  { hash: '#/aion/jung-aion/event/denderah-zodiac', name: 'event-denderah-image', kind: 'event' },
  { hash: '#/aion/jung-aion/event/aion-published', name: 'event-aion-published-tonal', kind: 'event' },
  { hash: '#/aion/jung-aion/event/christ-first-fish', name: 'event-christ-key-passage', kind: 'event' },
  { hash: '#/aion/jung-aion/event/valentinus-shadow', name: 'event-valentinus', kind: 'event' },
  { hash: '#/aion/jung-turn/event/turn-wotan-essay-1936', name: 'turn-wotan-essay', kind: 'event' },
  { hash: '#/aion/jung-aquarius-horizon/event/aqh-1950-union-of-opposites', name: 'horizon-union-of-opposites', kind: 'event' },
];

const browser = await launch(kind, { headed: false });
const seen = [];
try {
  for (const scene of SCENES) {
    const { ctx, page, logs } = await open(browser, { hash: scene.hash });
    try {
      await page.waitForSelector('section.aion .aion-card:not([hidden]) .rv-text', { timeout: 30000 });
      await page.waitForTimeout(2600); // the camera flies to an event; let the card settle
      // scoped to the Aion section: the Red Book view also renders an 'aion-card' aside in the same document
      const card = page.locator('section.aion .aion-card:not([hidden])');
      const heroes = await card.locator('figure.plate.rv-hero').count();
      const tonal = await card.locator('figure.plate.rv-hero.plate-empty').count();
      check(heroes === 1, `${scene.name}: a hero plate is present on the card`, `${heroes} hero, ${tonal ? 'tonal' : 'image'}`);
      // the hero sits before the text, in the same slot for epochs and events
      const heroFirst = await page.evaluate(() => {
        const body = document.querySelector('.aion-card .rv-body');
        return body && body.firstElementChild && body.firstElementChild.matches('figure.plate.rv-hero');
      });
      check(!!heroFirst, `${scene.name}: the hero is the first thing in the card body`);

      const key = card.locator('blockquote.dp-def').first();
      const keyCount = await card.locator('blockquote.dp-def').count();
      check(keyCount >= 1 && (await key.isVisible()), `${scene.name}: the key passage is an open blockquote, visible with no click`, `${keyCount} blockquote`);
      const footer = (await key.locator('footer').textContent())?.trim() ?? '';
      // a ¶ cite is the norm; a passage whose source has no ¶ marker keeps its pdf-page locator (AION-SOURCES), with no parenthesis noise
      const paragraph = /^Jung · .* · ¶\d/.test(footer);
      const pdfOnly = /^Jung · .* · pdf p\d+ [JS]$/.test(footer);
      check((paragraph || pdfOnly) && !/cw0?9ii/i.test(footer) && !/\(pdf/i.test(footer), `${scene.name}: the cite reads in the field's voice`, `${footer}${pdfOnly ? '  [pdf-page locator: the source has no ¶ marker]' : ''}`);
      const quoteText = (await key.locator('p').first().textContent())?.trim() ?? '';
      check(quoteText.length > 20, `${scene.name}: the key passage is verbatim text`, quoteText.slice(0, 70) + '…');

      const more = await card.locator('details.aion-sources summary').allTextContents();
      check(more.every((t) => t.trim() === 'More from the text'), `${scene.name}: remaining passages are filed under 'More from the text'`, more.join(' | ') || 'none');

      // every body paragraph is a finished sentence: a terminal stop (or a closing quotation after one), a capital, no ';' ending
      const bodyParas = (await card.locator('.rv-text > p.rv-para:not(.aion-lede)').allTextContents()).map((t) => t.trim());
      const fragments = bodyParas.filter((t) => /;$/.test(t) || !/[.!?…]["”’)\]]*$/.test(t) || /^[a-z]/.test(t));
      check(bodyParas.length > 0 && fragments.length === 0, `${scene.name}: every body paragraph is a finished sentence`, fragments.join(' | ') || `${bodyParas.length} paragraph(s)`);

      const { card: text, browse } = await readerText(page);
      const hits = [...REMOVED.map((re) => re.exec(text + '\n' + browse)?.[0]).filter(Boolean)];
      check(hits.length === 0, `${scene.name}: no excuse-narration or metadata suffix reaches the reader`, hits.join(', ') || 'clean');
      check(!/cw09ii|cw10 ¶|\bcw\d/i.test(text), `${scene.name}: no raw work key in the card`);

      check(logs.filter((l) => /pageerror/.test(l)).length === 0, `${scene.name}: no page errors`, logs.filter((l) => /pageerror/.test(l)).join(' | '));
      await page.screenshot({ path: path.join(SHOTS, `${scene.name}.png`), fullPage: false });
      seen.push({ scene: scene.name, footer, heroes, tonal, quote: quoteText.slice(0, 60) });
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(seen, null, 1));
console.log(failed ? `${failed} FAIL` : 'ALL PASS');
process.exitCode = failed ? 1 : 0;
