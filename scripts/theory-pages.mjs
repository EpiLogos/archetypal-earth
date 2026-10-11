// The theory nodes' pages: curation/theory-pages/<concept>.json → public/data/theory-pages.json. One file per concept of
// the theoretics tier, one published file, rendered where the node is focused (the deep layer's own blocks). Every
// quotation is placed in the read-only corpus by scripts/lib/cite.mjs, which writes its locator from the corpus; one it
// cannot place exactly once fails the build. A ¶ is printed only where the corpus's own markers confirm it (the Aion
// convention); where they cannot, the pdf page alone is cited and the generator says so. A `scan` on a curated quotation
// says the sentence is kept as the damaged scan reads it — never repaired by hand.
//   npm run theory-pages          regenerate
//   npm run theory-pages:check    verify the published file matches what the vault gives now
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildTheoryPages({ root = ROOT, vault = DEFAULT_VAULT } = {}) {
  const dir = path.join(root, 'curation', 'theory-pages');
  const field = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'field.json'), 'utf8'));
  const load = workLoader(vault);
  const titles = workTitles(root);
  const errors = [];
  const warnings = [];
  const concepts = new Map(field.theoretics.map((t) => [t.id, t]));
  const archetypes = new Set(field.archetypes.map((a) => a.id));
  const families = new Set(field.families.map((f) => f.id));
  const pages = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const cur = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!concepts.has(cur.concept)) { errors.push(`${file}: no theoretic ${cur.concept} in the field`); continue; }
    if (pages[cur.concept]) { errors.push(`${file}: a second page for ${cur.concept}`); continue; }
    const sections = cur.sections.map((s) => {
      const quotes = citeQuotes(load, titles, s.quotes, `${cur.concept}.${s.id}`, errors, warnings);
      return { id: s.id, title: s.title, line: s.line, quotes };
    });
    const subjects = cur.subjects ?? [];
    for (const l of subjects) {
      if (l.type === 'archetype' && !archetypes.has(l.id)) errors.push(`${cur.concept}: no archetype ${l.id} in the field`);
      if (l.type === 'family' && !families.has(l.id)) errors.push(`${cur.concept}: no family ${l.id} in the field`);
      if (l.type === 'theoretic' && !concepts.has(l.id)) errors.push(`${cur.concept}: no theoretic ${l.id} in the field`);
    }
    pages[cur.concept] = { concept: cur.concept, line: cur.line, sections, subjects };
  }
  // every node of the tier has a page — a missing one is named, never quietly skipped (the tests hold it loud)
  for (const t of field.theoretics) if (!pages[t.id]) warnings.push(`${t.id}: no page under curation/theory-pages/`);
  return { data: { version: 1, pages }, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { data, errors, warnings } = buildTheoryPages();
  for (const w of warnings) console.warn(`note: ${w}`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const out = path.join(ROOT, 'public', 'data', 'theory-pages.json');
  const text = `${JSON.stringify(data, null, 1)}\n`;
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { console.error('public/data/theory-pages.json differs from what the vault gives now: run npm run theory-pages'); process.exit(1); }
    console.log('theory-pages: verified');
  } else {
    fs.writeFileSync(out, text);
    const n = Object.values(data.pages).reduce((k, p) => k + p.sections.reduce((m, s) => m + s.quotes.length, 0), 0);
    console.log(`theory-pages: ${Object.keys(data.pages).length} pages, ${n} quotations placed`);
  }
}
