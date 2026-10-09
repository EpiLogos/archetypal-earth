// Gate (image credits, reader-visible): the plate caption and the source line show a clean credit, never a Wikimedia
// donor sentence, a raw URL, a doubled 'Unknown', or a Wikidata 'QS:' dump (SPEC §14). The data is untouched; the clean-up
// is at display time (src/ui/credit.ts).
//   · #/f/phallus/deep (its credit is the Met's donor sentence): the caption reads 'Metropolitan Museum of Art · CC0'
//     and its title attribute carries the same line unclipped
//   · 30 sampled entities across archetypes, families and occurrences (the known-bad credits first, then the rest, evenly
//     spaced): no visible caption or source line matches the bad patterns; no image alt does either
//   · no page errors
//   npx vite --port 5183 --strictPort &
//   EARTH_HEADLESS=1 node tests/ui/e2e/credits.mjs [chromium|webkit]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, open } from './lib.mjs';

const kind = process.argv[2] ?? 'chromium';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const images = JSON.parse(readFileSync(path.join(ROOT, 'public/data/images.json'), 'utf8'));

let failed = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** What a reader must never see in a credit, source line or alt text. */
const BAD = /https?:|donated to|Unknown (author|artist|source) Unknown|QS:/;

const ENTITIES = [];
for (const [group, prefix] of [['archetypes', 'a'], ['families', 'f'], ['occurrences', 'o']]) {
  for (const [id, ref] of Object.entries(images[group])) {
    ENTITIES.push({ group, id, hash: `#/${prefix}/${encodeURIComponent(id)}/deep`, credit: ref.credit ?? '', title: ref.title ?? '' });
  }
}

/** n items spread evenly across the list, in order. */
const evenly = (list, n) => {
  const k = Math.min(n, list.length);
  return Array.from({ length: k }, (_, i) => list[Math.floor((i * list.length) / k)]);
};

const badCredit = ENTITIES.filter((e) => BAD.test(e.credit));
const qsTitle = ENTITIES.filter((e) => /QS:/.test(e.title));
const phallus = ENTITIES.find((e) => e.hash === '#/f/phallus/deep');
const picked = [];
for (const e of [phallus, ...evenly(badCredit, 12), ...evenly(qsTitle, 6), ...evenly(ENTITIES, 30)]) {
  if (e && !picked.includes(e)) picked.push(e);
}
const SAMPLE = picked.slice(0, 30);

/** The open reading's caption, source line and image alt text, as a reader gets them. */
const readReading = (page) => page.evaluate(() => {
  const art = document.querySelector('section.deep:not(.passage) .dp-article');
  if (!art || !art.children.length) return null;
  const captions = [...art.querySelectorAll('figcaption.plate-credit')].map((f) => ({
    text: f.textContent.trim(),
    title: f.getAttribute('title') ?? '',
    shown: f.getClientRects().length > 0,
  }));
  const sources = [...art.querySelectorAll('.dp-source')].map((p) =>
    [...p.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').replace(/\s*—\s*$/, '').trim());
  const alts = [...art.querySelectorAll('figure.plate img')].map((i) => i.getAttribute('alt') ?? '');
  return { captions, sources, alts, plates: art.querySelectorAll('figure.plate').length };
});

const browser = await launch(kind, { headed: false });
let logs = [];
try {
  const { ctx, page, logs: pageLogs } = await open(browser, { hash: SAMPLE[0].hash });
  logs = pageLogs;
  const seenCaptions = new Map();
  const badFound = [];
  let withPlate = 0;
  let captionCount = 0;
  let sourceCount = 0;
  let rendered = 0;

  for (const [i, e] of SAMPLE.entries()) {
    if (i > 0) {
      await page.evaluate((h) => { location.hash = h; }, e.hash);
      await page.waitForFunction((h) => location.hash === h && !!document.querySelector('section.deep:not(.passage) .dp-article > *'), e.hash, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(350);
    }
    const r = await readReading(page);
    if (!r) continue;
    rendered++;
    if (r.plates) withPlate++;
    for (const c of r.captions) {
      captionCount++;
      if (c.shown) seenCaptions.set(c.text, (seenCaptions.get(c.text) ?? 0) + 1);
      if (BAD.test(c.text)) badFound.push(`${e.group}/${e.id} caption ${JSON.stringify(c.text)}`);
      if (BAD.test(c.title)) badFound.push(`${e.group}/${e.id} caption title ${JSON.stringify(c.title)}`);
    }
    for (const s of r.sources) {
      sourceCount++;
      if (BAD.test(s)) badFound.push(`${e.group}/${e.id} source line ${JSON.stringify(s)}`);
    }
    for (const a of r.alts) if (BAD.test(a)) badFound.push(`${e.group}/${e.id} alt ${JSON.stringify(a)}`);

    if (e === phallus) {
      const cap = r.captions[0];
      check(!!cap && cap.text === 'Metropolitan Museum of Art · CC0', 'phallus: the caption reads the Met credit and licence', cap ? JSON.stringify(cap.text) : 'no caption');
      check(!!cap && cap.title === 'Metropolitan Museum of Art · CC0', 'phallus: the caption title carries the same line unclipped', cap ? JSON.stringify(cap.title) : 'no caption');
    }
  }

  check(rendered === SAMPLE.length, 'every sampled entity opens its reading', `${rendered} of ${SAMPLE.length}`);
  check(badFound.length === 0, 'no visible credit, source line or alt matches the bad patterns', badFound.slice(0, 5).join(' | ') || 'none');
  console.log(`sampled ${SAMPLE.length} entities: ${withPlate} with an image plate, ${captionCount} captions, ${sourceCount} source lines; bad patterns found: ${badFound.length}`);
  console.log('distinct shown captions (first 12):');
  for (const [text, n] of [...seenCaptions].slice(0, 12)) console.log(`  ${n}× ${text}`);
  await ctx.close();
} finally {
  await browser.close();
}

check(logs.filter((l) => l.startsWith('pageerror')).length === 0, 'no page errors', logs.filter((l) => l.startsWith('pageerror')).slice(0, 3).join(' | ') || 'none');
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
