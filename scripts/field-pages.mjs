// The field pages: curation/field-pages/<name>.json → public/data/field-pages.json. One file per node of the field (a family,
// an archetype or a theoretic): its reading line, its sections of placed quotations and the subjects it bears on. The join
// cites (curation/joins.json, when it exists) are placed the same way and published under `joins` by join id. Every
// quotation is placed in the read-only corpus by scripts/lib/cite.mjs (through scripts/lib/quotes.mjs), exactly as
// theory-pages does; one it cannot place exactly once fails the build. Nothing is written into the vault.
//   npm run field-pages          regenerate
//   npm run field-pages:check    verify the published file matches what the vault gives now
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = ['family', 'archetype', 'theoretic'];

/** Quotations the cite rail can read: a work and a string. Anything else is named and left out, never guessed at. */
function wellFormed(quotes, where, errors) {
  if (!Array.isArray(quotes)) { errors.push(`${where}: quotes must be a list`); return []; }
  return quotes.filter((q) => {
    if (q && typeof q.work === 'string' && typeof q.quote === 'string') return true;
    errors.push(`${where}: a quotation needs a work and its quote as strings`);
    return false;
  });
}

/** joins.json: an array of joins, or { "joins": [...] }. Anything else is an error, never a silent empty file. */
function readJoins(curation) {
  const file = path.join(curation, 'joins.json');
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.joins)) return raw.joins;
  return undefined;
}

/**
 * `field` may be handed in (the ingest builds the pages for its attestations before field.json exists, from the nodes it
 * holds in memory); `curation` is the curation directory (the ingest's own, which a test may point at a copy).
 */
export function buildFieldPages({ root = ROOT, vault = DEFAULT_VAULT, curation = path.join(root, 'curation'), field: given = null } = {}) {
  const dir = path.join(curation, 'field-pages');
  const field = given ?? JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'field.json'), 'utf8'));
  const load = workLoader(vault);
  const titles = workTitles(root);
  const errors = [];
  const warnings = [];
  const nodes = {
    family: new Set(field.families.map((n) => n.id)),
    archetype: new Set(field.archetypes.map((n) => n.id)),
    theoretic: new Set(field.theoretics.map((n) => n.id)),
  };
  const pages = {};
  const seen = new Set();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const file of files) {
    const cur = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (cur.version !== 1) { errors.push(`${file}: version must be 1`); continue; }
    if (!TYPES.includes(cur.type)) { errors.push(`${file}: type must be one of ${TYPES.join(', ')}`); continue; }
    const key = `${cur.type}:${cur.id}`;
    if (!nodes[cur.type].has(cur.id)) { errors.push(`${file}: no ${cur.type} ${cur.id} in the field`); continue; }
    if (seen.has(key)) { errors.push(`${file}: a second page for ${key}`); continue; }
    seen.add(key);
    if (typeof cur.line !== 'string') errors.push(`${file}: line must be a sentence`);
    if (!Array.isArray(cur.sections)) errors.push(`${key}: sections must be a list`);
    const sectionIds = new Set();
    const sections = [];
    for (const s of Array.isArray(cur.sections) ? cur.sections : []) {
      if (sectionIds.has(s.id)) { errors.push(`${key}: a second section ${s.id}`); continue; }
      sectionIds.add(s.id);
      const quotes = citeQuotes(load, titles, wellFormed(s.quotes, `${key}.${s.id}`, errors), `${key}.${s.id}`, errors, warnings);
      sections.push({ id: s.id, title: s.title, line: s.line, quotes });
    }
    const subjects = cur.subjects ?? [];
    for (const l of subjects) {
      if (!nodes[l.type]?.has(l.id)) errors.push(`${key}: no ${l.type} ${l.id} in the field`);
    }
    pages[key] = { type: cur.type, id: cur.id, line: cur.line, sections, subjects };
  }

  // the join cites: placed and published by join id. A join id the field does not carry is named as a warning (the ingest
  // may have dropped it) and still published; a cite that will not place is an error.
  const joins = {};
  const list = readJoins(curation);
  if (list === undefined) errors.push('joins.json: expected an array of joins, or { "joins": [...] }');
  const fieldJoins = new Set((field.joins ?? []).map((j) => j.id));
  const joinSeen = new Set();
  for (const j of list ?? []) {
    if (!j?.id) { errors.push('joins.json: a join without an id'); continue; }
    if (joinSeen.has(j.id)) { errors.push(`joins.json: a second join ${j.id}`); continue; }
    joinSeen.add(j.id);
    if (!fieldJoins.has(j.id)) warnings.push(`join ${j.id} is not in the field's joins (the ingest may have dropped it)`);
    if (!Array.isArray(j.cites) || j.cites.length === 0) continue;
    joins[j.id] = citeQuotes(load, titles, wellFormed(j.cites, `join ${j.id}`, errors), `join ${j.id}`, errors, warnings);
  }

  // keys sorted so the published file is the same whatever order the files were read in
  const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return { data: { version: 1, pages: sortKeys(pages), joins: sortKeys(joins) }, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { data, errors, warnings } = buildFieldPages();
  for (const w of warnings) console.warn(`note: ${w}`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const out = path.join(ROOT, 'public', 'data', 'field-pages.json');
  const text = `${JSON.stringify(data, null, 1)}\n`;
  const counts = `${Object.keys(data.pages).length} pages, ${Object.keys(data.joins).length} joins`;
  if (check) {
    if (!fs.existsSync(out)) { console.error(`public/data/field-pages.json is absent (the vault gives ${counts}): run npm run field-pages`); process.exit(1); }
    if (fs.readFileSync(out, 'utf8') !== text) { console.error('public/data/field-pages.json differs from what the vault gives now: run npm run field-pages'); process.exit(1); }
    console.log('field-pages: verified');
  } else {
    fs.writeFileSync(out, text);
    const n = Object.values(data.pages).reduce((k, p) => k + p.sections.reduce((m, s) => m + s.quotes.length, 0), 0)
      + Object.values(data.joins).reduce((k, qs) => k + qs.length, 0);
    console.log(`field-pages: ${counts}, ${n} quotations placed`);
  }
}
