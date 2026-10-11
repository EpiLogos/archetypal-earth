// The number archetypes' pages: curation/numbers.json + curation/ql.json → public/data/numbers.json. One to six are
// archetypes of the field (admitted in curation/archetypes.json, synthesised), tied to the Self; their pages carry the
// QL walk material (one address: curation/ql.json, composed here — never copied), Jung's own number material from
// curation/numbers.json, and the egg block, three witnesses to one image. Every quotation is placed in the read-only
// corpus by scripts/lib/cite.mjs, which writes its locator from the corpus; one it cannot place exactly once fails the
// build. The site's stages are the QL's own count and are marked QL wherever they are shown.
//   npm run numbers          regenerate
//   npm run numbers:check    verify the published file matches what the vault gives now
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The number archetypes, in the field's own order; a page names an archetype the field must actually hold. */
const IDS = ['one', 'two', 'three', 'four', 'five', 'six'];
/** W is the published site, cited by its section (ProjectCentral/docs/ql-reference.md); S1–S4 are the earlier notes. */
const QL_SOURCE = /^(?:S[1-4]|W § (?:I|II|III|IV|V|VI))$/;

export function buildNumbers({ root = ROOT, vault = DEFAULT_VAULT } = {}) {
  const cur = JSON.parse(fs.readFileSync(path.join(root, 'curation', 'numbers.json'), 'utf8'));
  const archetypes = JSON.parse(fs.readFileSync(path.join(root, 'curation', 'archetypes.json'), 'utf8')).archetypes;
  const ql = JSON.parse(fs.readFileSync(path.join(root, 'curation', 'ql.json'), 'utf8'));
  const field = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'field.json'), 'utf8'));
  const load = workLoader(vault);
  const titles = workTitles(root);
  const errors = [];
  const warnings = [];
  const inField = new Set(field.archetypes.map((a) => a.id));
  const families = new Set(field.families.map((f) => f.id));
  const theoretics = new Set(field.theoretics.map((t) => t.id));
  const many = (qs, where) => citeQuotes(load, titles, qs, where, errors, warnings);
  const qlText = (x, where) => { if (!x || !QL_SOURCE.test(x.source ?? '') || !x.text) errors.push(`${where}: a QL formulation needs its text and one of the sources in ProjectCentral/docs/ql-reference.md`); return x; };
  const subjectsOk = (list, where) => {
    for (const l of list ?? []) {
      if ((l.type === 'family' && !families.has(l.id)) || (l.type === 'archetype' && !inField.has(l.id)) || (l.type === 'theoretic' && !theoretics.has(l.id))) errors.push(`${where}: no ${l.type} ${l.id} in the field`);
    }
    return list ?? [];
  };
  for (const id of IDS) {
    if (!archetypes[id]) errors.push(`curation/archetypes.json has no ${id}: the number archetypes are curated there`);
    else if (!archetypes[id].synthesised) errors.push(`archetype ${id} is not synthesised: the vault's own note would win it back`);
    if (!inField.has(id)) errors.push(`archetype ${id} is not in the field (run npm run ingest)`);
    if (!cur.numbers[id]?.sections?.length) errors.push(`curation/numbers.json has no page for ${id}`);
  }
  const walk = new Map(ql.numbers.map((n) => [IDS[n.n - 1], n]));
  const pages = {};
  for (const id of IDS) {
    const c = cur.numbers[id] ?? { sections: [] };
    const w = walk.get(id);
    if (!w) { errors.push(`${id}: curation/ql.json has no position ${IDS.indexOf(id) + 1}`); continue; }
    // the walk's own quotations, split by whose words they are: von Franz's under her name, Jung's under his — the
    // four voices are never mixed, and a heading that says "von Franz" may not stand over Jung's sentence
    const walkQuotes = many(w.quotes, `numbers.${id}.vonFranz`);
    pages[id] = {
      n: w.n,
      position: w.position,
      ql: qlText(w.ql, `numbers.${id}`),
      gloss: qlText(w.gloss, `numbers.${id} gloss`),
      line: c.line ?? w.line,
      vonFranz: walkQuotes.filter((q) => q.cite.work.startsWith('vonzfranz')),
      jung: walkQuotes.filter((q) => !q.cite.work.startsWith('vonzfranz')),
      sections: c.sections.map((s) => ({ id: s.id, title: s.title, line: s.line, quotes: many(s.quotes, `numbers.${id}.${s.id}`) })),
      subjects: subjectsOk(w.subjects, `numbers.${id}.subjects`),
    };
  }
  const egg = {
    stages: cur.stages,
    dream: many([cur.egg.dream], 'egg.dream')[0],
    footnote: many(cur.egg.footnote, 'egg.footnote'),
    mandala: many(cur.egg.mandala, 'egg.mandala'),
  };
  if (!QL_SOURCE.test(cur.stages?.source ?? '')) errors.push('egg.stages: the six stages are the site\'s count and need one of the QL sources');
  return { data: { version: 1, line: cur.line, egg, pages }, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { data, errors, warnings } = buildNumbers();
  for (const w of warnings) console.warn(`note: ${w}`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const out = path.join(ROOT, 'public', 'data', 'numbers.json');
  const text = `${JSON.stringify(data, null, 1)}\n`;
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { console.error('public/data/numbers.json differs from what the vault gives now: run npm run numbers'); process.exit(1); }
    console.log('numbers: verified');
  } else {
    fs.writeFileSync(out, text);
    const n = Object.values(data.pages).reduce((k, p) => k + p.vonFranz.length + p.jung.length + p.sections.reduce((m, s) => m + s.quotes.length, 0), 0);
    console.log(`numbers: ${Object.keys(data.pages).length} number archetype pages, ${n} quotations placed, the egg block with ${data.egg.footnote.length + data.egg.mandala.length + 1} witnesses`);
  }
}
