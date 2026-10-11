// An archetype at full depth (Thread 6, the Great Mother as exemplar): curation/depth/<id>.json → public/data/depth.json.
// Quotations are placed in the read-only vault corpus by scripts/lib/cite.mjs; one that will not place fails. The author's
// instances come from the reading-pass records: every one whose quotation places on its page is kept, dated or not; where
// the reader marked the scan as damaged, the instance says so instead of being dropped.
//   npm run depth | npm run depth:check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader, locate, verify } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';
import { readRecords } from './harvest-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildDepth({ vault = DEFAULT_VAULT } = {}) {
  const dir = path.join(ROOT, 'curation', 'depth');
  const field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'field.json'), 'utf8'));
  const load = workLoader(vault);
  const titles = workTitles(ROOT);
  const errors = [];
  const warnings = [];
  const out = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const cur = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!field.archetypes.some((a) => a.id === cur.archetype)) { errors.push(`${file}: no archetype ${cur.archetype} in the field`); continue; }
    const sections = cur.sections.map((s) => {
      for (const f of s.families ?? []) if (!field.families.some((x) => x.id === f)) errors.push(`${file} ${s.id}: no family ${f}`);
      const quotes = citeQuotes(load, titles, s.quotes, `${cur.archetype}.${s.id}`, errors, warnings)
        .map((q, i) => (s.quotes[i]?.speaker ? { ...q, speaker: s.quotes[i].speaker } : q));
      return { id: s.id, title: s.title, line: s.line, quotes, families: s.families ?? [] };
    });
    // every instance record of the named volumes (optionally only some of its terms) whose quotation places on its page
    const families = new Set(field.families.map((f) => f.id));
    const seen = new Map();
    let unplaced = 0;
    for (const src of cur.instances.sources) {
      for (const { rec: r } of readRecords(vault, src.vol)) {
        if (!r || r.kind !== 'instance' || typeof r.quote !== 'string') continue;
        if (src.terms && !src.terms.includes(r.term)) continue;
        let loc = locate(load, src.vol, r.quote, { page: r.pdf_page });
        // a caption too short to name one place in the book still names its page: kept when its words stand there
        if (loc.error && Number.isInteger(r.pdf_page) && !verify(load, { work: src.vol, locator: `pdf p${r.pdf_page}`, quote: r.quote })) loc = { locator: `pdf p${r.pdf_page}`, page: r.pdf_page };
        if (loc.error) { unplaced++; continue; }
        const key = `${src.vol}|${loc.page}|${r.quote}`;
        const prev = seen.get(key);
        if (prev) { if (!prev.terms.includes(r.term)) prev.terms.push(r.term); continue; }
        seen.set(key, {
          ...(Number.isInteger(r.year_int) ? { year: r.year_int } : {}),
          yearDisplay: r.year_display ?? (Number.isInteger(r.year_int) ? String(r.year_int) : ''),
          place: r.place ?? '',
          locus: r.locus_type ?? '',
          terms: [r.term],
          text: r.quote,
          cite: { work: src.vol, workTitle: titles.get(src.vol) ?? src.vol, locator: loc.locator, ...(loc.print ? { print: loc.print } : {}) },
          ...(r.ocr || loc.scan ? { scan: true } : {}),
        });
      }
    }
    const all = [...seen.values()].map((x) => ({ ...x, families: x.terms.filter((t) => families.has(t)) }));
    const byPage = (a, b) => a.cite.work.localeCompare(b.cite.work) || Number(a.cite.locator.replace(/\D+/g, '')) - Number(b.cite.locator.replace(/\D+/g, ''));
    const dated = all.filter((x) => x.year !== undefined).sort((a, b) => a.year - b.year || byPage(a, b));
    const undated = all.filter((x) => x.year === undefined).sort(byPage);
    if (unplaced) warnings.push(`${cur.archetype}: ${unplaced} instance records whose quotation is too short to name one place, or does not place, are not shown`);
    const records = cur.instances.sources.reduce((n, s) => n + readRecords(vault, s.vol).length, 0);
    out[cur.archetype] = { archetype: cur.archetype, line: cur.line, sections, instances: { line: cur.instances.line, items: dated, undated }, records };
  }
  return { data: { version: 1, archetypes: out }, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { data, errors, warnings } = buildDepth();
  for (const w of warnings) console.warn(`note: ${w}`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const out = path.join(ROOT, 'public', 'data', 'depth.json');
  const text = `${JSON.stringify(data, null, 1)}\n`;
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { console.error('public/data/depth.json differs from what the vault gives now: run npm run depth'); process.exit(1); }
    console.log('depth: verified');
  } else {
    fs.writeFileSync(out, text);
    for (const [id, a] of Object.entries(data.archetypes)) console.log(`depth: ${id}: ${a.sections.reduce((n, s) => n + s.quotes.length, 0)} quotations placed, ${a.instances.items.length} dated instances, ${a.instances.undated.length} dated by era or not at all`);
  }
}
