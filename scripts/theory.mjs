// The Theory lens's data: curation/theory.json → public/data/theory.json (docs/MODES-RFC.md §3).
// Every quotation is placed in the read-only vault corpus by scripts/lib/cite.mjs, which writes its locator from the
// corpus; a quotation it cannot place exactly once fails the build. A ¶ is printed only where the corpus's nearest
// marker agrees with the vault note's ¶; otherwise the pdf page alone (the Aion convention).
//   npm run theory          regenerate
//   npm run theory:check    verify the published file matches what the vault gives now
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader, locate } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildTheory({ root = ROOT, vault = DEFAULT_VAULT } = {}) {
  const curation = JSON.parse(fs.readFileSync(path.join(root, 'curation', 'theory.json'), 'utf8'));
  const field = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'field.json'), 'utf8'));
  const load = workLoader(vault);
  const titles = workTitles(root);
  const errors = [];
  const warnings = [];
  const families = new Set(field.families.map((f) => f.id));
  const archetypes = new Set(field.archetypes.map((a) => a.id));
  const sections = curation.sections.map((s) => {
    for (const l of s.links ?? []) {
      if (l.type === 'family' && !families.has(l.id)) errors.push(`${s.id}: no family ${l.id} in the field`);
      if (l.type === 'archetype' && !archetypes.has(l.id)) errors.push(`${s.id}: no archetype ${l.id} in the field`);
    }
    const quotes = citeQuotes(load, titles, s.quotes, s.id, errors, warnings);
    return { id: s.id, name: s.name, line: s.line, quotes, links: s.links ?? [] };
  });
  return { data: { version: 1, sections }, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { data, errors, warnings } = buildTheory();
  for (const w of warnings) console.warn(`note: ${w}`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const out = path.join(ROOT, 'public', 'data', 'theory.json');
  const text = `${JSON.stringify(data, null, 1)}\n`;
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { console.error('public/data/theory.json differs from what the vault gives now: run npm run theory'); process.exit(1); }
    console.log('theory: verified');
  } else {
    fs.writeFileSync(out, text);
    console.log(`theory: ${data.sections.length} sections, ${data.sections.reduce((n, s) => n + s.quotes.length, 0)} quotations placed`);
  }
}
