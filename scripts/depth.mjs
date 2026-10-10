// An archetype at full depth (Thread 6, the Great Mother as exemplar): curation/depth/<id>.json → public/data/depth.json.
// Quotations are placed in the read-only vault corpus by scripts/lib/cite.mjs; one that will not place fails. The author's
// dated instances come from the reading-pass records, kept only when the quote places exactly and carries no scan damage.
//   npm run depth | npm run depth:check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader, verify } from './lib/cite.mjs';
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
    const vol = cur.instances.vol;
    const instances = readRecords(vault, vol)
      .map((r) => r.rec)
      .filter((r) => r && r.kind === 'instance' && Number.isInteger(r.year_int) && !r.ocr && typeof r.quote === 'string' && r.quote.split(/\s+/).length >= 4)
      .filter((r) => !verify(load, { work: vol, locator: `pdf p${r.pdf_page}`, quote: r.quote }))
      .sort((a, b) => a.year_int - b.year_int || a.pdf_page - b.pdf_page)
      .map((r) => ({ year: r.year_int, yearDisplay: r.year_display ?? String(r.year_int), place: r.place ?? '', note: r.note ?? '', text: r.quote, cite: { work: vol, workTitle: titles.get(vol) ?? vol, locator: `pdf p${r.pdf_page}` } }));
    const records = readRecords(vault, vol).length + readRecords(vault, 'neumann-origins').length;
    out[cur.archetype] = { archetype: cur.archetype, line: cur.line, sections, instances: { line: cur.instances.line, items: instances }, records };
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
    for (const [id, a] of Object.entries(data.archetypes)) console.log(`depth: ${id}: ${a.sections.reduce((n, s) => n + s.quotes.length, 0)} quotations placed, ${a.instances.items.length} dated instances`);
  }
}
