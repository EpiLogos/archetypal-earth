// The practice tools' framing: curation/practice.json → public/data/practice.json (docs/MODES-RFC.md §8).
// Every quotation is placed in the read-only vault corpus by scripts/lib/cite.mjs; one that will not place fails.
//   npm run practice | npm run practice:check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildPractice({ vault = DEFAULT_VAULT } = {}) {
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, 'curation', 'practice.json'), 'utf8'));
  const load = workLoader(vault);
  const titles = workTitles(ROOT);
  const errors = [];
  const warnings = [];
  const many = (qs, where) => citeQuotes(load, titles, qs, where, errors, warnings);
  const one = (q, where) => many([q], where)[0];
  const data = {
    version: 1,
    dreams: { method: many(cur.dreams.method, 'dreams.method'), portrait: one(cur.dreams.portrait, 'dreams.portrait'), compensation: many(cur.dreams.compensation, 'dreams.compensation') },
    coincidences: { definition: one(cur.coincidences.definition, 'coincidences.definition'), factors: many(cur.coincidences.factors, 'coincidences.factors'), series: many(cur.coincidences.series, 'coincidences.series') },
  };
  return { data, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { data, errors, warnings } = buildPractice();
  for (const w of warnings) console.warn(`note: ${w}`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const out = path.join(ROOT, 'public', 'data', 'practice.json');
  const text = `${JSON.stringify(data, null, 1)}\n`;
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { console.error('public/data/practice.json differs from what the vault gives now: run npm run practice'); process.exit(1); }
    console.log('practice: verified');
  } else { fs.writeFileSync(out, text); console.log('practice: quotations placed'); }
}
