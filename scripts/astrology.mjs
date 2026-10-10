// The Astrology lens's data: curation/astrology.json (+ the sky's verified ties and Burt's planet quotes) →
// public/data/astrology.json (docs/MODES-RFC.md §3). Every quotation is placed in the read-only vault corpus by
// scripts/lib/cite.mjs, which writes its locator from the corpus. A curated quotation that will not place fails the
// build; a Burt quotation from the sky curation that will not place exactly in the corpus text is left out and named.
//   npm run astrology          regenerate
//   npm run astrology:check    verify the published file matches what the vault gives now
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

export function buildAstrology({ vault = DEFAULT_VAULT } = {}) {
  const cur = read('curation', 'astrology.json');
  const ties = read('curation', 'sky', 'ties.json');
  const burt = read('curation', 'sky', 'burt.json');
  const field = read('public', 'data', 'field.json');
  const load = workLoader(vault);
  const titles = workTitles(ROOT);
  const errors = [];
  const warnings = [];
  const cite = (qs, where) => citeQuotes(load, titles, qs, where, errors, warnings);
  const one = (q, where) => cite([q], where)[0];
  const exists = (t) => (t.type === 'family' ? field.families : field.archetypes).some((x) => x.id === t.id);

  const bodies = {};
  for (const key of cur.order.bodies) {
    const c = cur.bodies[key];
    if (!c) { errors.push(`order names ${key}, which has no entry`); continue; }
    // the field ties: Jung's own first, then the atlas's inferences and its own links, each labelled with its basis
    const rank = { jung: 0, inferred: 1, site: 2 };
    const fieldTies = ties.ties.filter((t) => t.body === key && exists(t.target))
      .sort((a, b) => rank[a.basis] - rank[b.basis])
      .map((t) => ({
        target: t.target, basis: t.basis, note: t.note,
        quotes: cite((t.cites ?? []).map((q) => ({ work: q.work, quote: q.quote, para: /^¶(\d+)/.exec(q.locator)?.[1] ? Number(/^¶(\d+)/.exec(q.locator)[1]) : undefined })), `tie ${key}→${t.target.id}`),
      }));
    // Burt's quotations on the planet, placed again in the corpus text (her pdf page names where to look)
    const burtQuotes = [];
    for (const e of burt.entries.filter((x) => x.subject === `planet:${key}`)) {
      const local = [];
      const placed = citeQuotes(load, titles, [{ work: 'burt-zodiac', quote: e.quote, page: e.pdfPage }], `burt ${key}`, local, warnings);
      if (local.length) { warnings.push(`left out (does not place exactly in the corpus text): ${local[0]}`); continue; }
      burtQuotes.push({ ...placed[0], voice: 'burt' });
    }
    bodies[key] = { key, name: c.name, line: c.line, quotes: cite(c.quotes, `body ${key}`), ties: fieldTies, burt: burtQuotes };
  }

  const signs = {};
  for (const [sign, q] of Object.entries(cur.signs)) signs[sign] = { ...one(q, `sign ${sign}`), voice: 'burt' };

  const people = cur.people.map((p) => ({ id: p.id, label: p.label, birth: p.birth, line: p.line, quote: one(p.quote, `person ${p.id}`) }));

  // the place list for the form: the sky's own sourced gazetteer, so a birth place is chosen here, never looked up online
  const sky = read('public', 'data', 'sky.json');
  const data = {
    version: 1,
    gazetteer: sky.gazetteer,
    frame: cite(cur.frame, 'frame'),
    pillars: one(cur.pillars, 'pillars'),
    order: { bodies: cur.order.bodies, line: cur.order.line, quote: one(cur.order.quote, 'order') },
    bodies,
    signs,
    people,
  };
  return { data, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { data, errors, warnings } = buildAstrology();
  for (const w of warnings) console.warn(`note: ${w}`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const out = path.join(ROOT, 'public', 'data', 'astrology.json');
  const text = `${JSON.stringify(data, null, 1)}\n`;
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { console.error('public/data/astrology.json differs from what the vault gives now: run npm run astrology'); process.exit(1); }
    console.log('astrology: verified');
  } else {
    fs.writeFileSync(out, text);
    const n = Object.values(data.bodies).reduce((a, b) => a + b.quotes.length + b.burt.length + b.ties.reduce((x, t) => x + t.quotes.length, 0), 0);
    console.log(`astrology: ${Object.keys(data.bodies).length} bodies, 12 signs, ${n + data.frame.length + 3} quotations placed`);
  }
}
