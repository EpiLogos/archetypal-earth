#!/usr/bin/env node
// People check (N17a). Every field of every person in curation/people.json is either
// sourced or blank with a reason; every sourced quotation is verbatim in the file or
// corpus page it cites; a portrait id exists in the image registers; every person has
// a work (curation/works.json author or voice, or the Book of Symbols editor) or
// occurrences (subject, or the surname in an occurrence's title or label).
// Usage: node scripts/people-check.mjs [--values]
// Exit 0 when clean, 1 otherwise. VAULT overrides the vault root.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = process.env.VAULT || join(homedir(), 'Documents/books/jung-archetypal-field');
const SHOW_VALUES = process.argv.includes('--values');
const FIELD_ORDER = ['name', 'born', 'died', 'role', 'portrait', 'birth', 'subjectKey'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readText = (p) => readFileSync(p, 'utf8');
// Quotation matching: typographic quotes and apostrophes fold to ASCII, whitespace
// collapses (corpus OCR breaks lines mid-sentence), case is ignored.
const norm = (s) => String(s)
  .replace(/[‘’ʼ]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseSource(src) {
  const s = String(src).trim();
  let m = s.match(/^corpus (\S+) p(\d+)(?:\s+“([^”]*)”)?/);
  if (m) return { kind: 'corpus', vol: m[1], page: Number(m[2]), phrase: m[3] ?? null };
  m = s.match(/^vault (\S+)(?:\s+“([^”]*)”)?/);
  if (m) return { kind: 'vault', file: m[1], phrase: m[2] ?? null };
  m = s.match(/^((?:curation|public)\/\S+?\.json)(?:\s+(?!“)(\S+))?(?:\s+“([^”]*)”)?/);
  if (m) return { kind: 'repo', file: m[1], path: m[2] ?? null, phrase: m[3] ?? null };
  return { kind: 'unparsed' };
}

function resolvePath(obj, path) {
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const t of tokens) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(t in cur)) return undefined;
    cur = cur[t];
  }
  return cur;
}

function checkSource(src) {
  const p = parseSource(src);
  if (p.kind === 'unparsed') return { ok: false, msg: `unparsed source: ${src}` };
  if (p.kind === 'corpus') {
    const f = join(ROOT, 'public/data/corpus', `${p.vol}.json`);
    if (!existsSync(f)) return { ok: false, msg: `no corpus volume ${p.vol}` };
    const page = readJson(f).pages.find((pg) => pg.p === p.page);
    if (!page) return { ok: false, msg: `${p.vol} has no page ${p.page}` };
    if (p.phrase && !norm(page.text).includes(norm(p.phrase))) return { ok: false, msg: `phrase not on ${p.vol} p${p.page}` };
    return { ok: true };
  }
  if (p.kind === 'vault') {
    const f = join(VAULT, p.file);
    if (!existsSync(f)) return { ok: false, msg: `no vault file ${p.file}` };
    if (p.phrase && !norm(readText(f)).includes(norm(p.phrase))) return { ok: false, msg: `phrase not in ${p.file}` };
    return { ok: true };
  }
  const f = join(ROOT, p.file);
  if (!existsSync(f)) return { ok: false, msg: `no file ${p.file}` };
  let hay;
  if (p.path) {
    const val = resolvePath(readJson(f), p.path);
    if (val === undefined) return { ok: false, msg: `path ${p.path} not in ${p.file}` };
    hay = typeof val === 'string' ? val : JSON.stringify(val);
  } else {
    hay = readText(f);
  }
  if (p.phrase && !norm(hay).includes(norm(p.phrase))) return { ok: false, msg: `phrase not in ${p.file}${p.path ? ' ' + p.path : ''}` };
  return { ok: true };
}

// Image registers: every registered id across images.json and images-ext*.json.
const dataDir = join(ROOT, 'public/data');
const imageIds = new Set();
for (const f of readdirSync(dataDir).filter((n) => /^images(-ext[\w-]*)?\.json$/.test(n))) {
  for (const cat of Object.values(readJson(join(dataDir, f)))) {
    if (cat && typeof cat === 'object') for (const k of Object.keys(cat)) imageIds.add(k);
  }
}

const people = readJson(join(ROOT, 'curation/people.json'));
const works = readJson(join(ROOT, 'curation/works.json')).works || {};
const bookOfSymbols = readJson(join(ROOT, 'curation/symbols/book-of-symbols.json'));
const field = readJson(join(ROOT, 'public/data/field.json'));
const astro = readJson(join(ROOT, 'curation/astrology.json'));
const occurrences = field.occurrences || [];

// Work names: every works.json author and voice (split on "/"), plus the Book of Symbols editors.
const workNames = [];
for (const w of Object.values(works)) {
  for (const n of [w.author, w.voice]) if (n) workNames.push(...String(n).split('/').map((x) => x.trim()));
}
const symbolsEditors = String(bookOfSymbols.source?.editor || '').split(';').map((x) => x.trim()).filter(Boolean);

const failures = [];
const fail = (msg) => failures.push(msg);
const rows = [];

for (const [key, person] of Object.entries(people.people || {})) {
  const id = person.id;
  if (id !== key) fail(`${key}: id ${id} does not match its key`);
  const sources = person.sources || {};
  const reasons = person.reasons || {};
  const fields = Object.keys(person).filter((k) => !['id', 'sources', 'reasons'].includes(k));
  const cells = {};
  for (const f of fields) {
    const val = person[f];
    const src = sources[f] ?? null;
    if (!(f in sources)) fail(`${id}.${f}: no sources entry`);
    if (val === null || val === undefined) {
      if (!reasons[f] || !String(reasons[f]).trim()) { fail(`${id}.${f}: blank with no reason`); cells[f] = 'X'; }
      else cells[f] = 'R';
      continue;
    }
    if (!src) { fail(`${id}.${f}: filled with no source`); cells[f] = 'X'; continue; }
    const r = checkSource(src);
    if (!r.ok) { fail(`${id}.${f}: ${r.msg}`); cells[f] = 'X'; continue; }
    if (f === 'portrait' && !imageIds.has(val)) { fail(`${id}.portrait: ${val} is not an image id in images.json or images-ext*.json`); cells[f] = 'X'; continue; }
    cells[f] = 'S';
  }
  // A Jung birth copied from astrology.json must equal the source record, portrait included.
  if (person.birth) {
    const a = astro.people?.find((x) => x.id === id);
    if (!a) fail(`${id}.birth: no ${id} record in curation/astrology.json to copy from`);
    else {
      const { portrait: bp, ...bRest } = person.birth;
      const { portrait: ap, ...aRest } = a.birth;
      if (JSON.stringify(bRest) !== JSON.stringify(aRest) || JSON.stringify(bp) !== JSON.stringify(a.portrait)) {
        fail(`${id}.birth: differs from curation/astrology.json people[0]`);
      }
    }
  }
  // Works and occurrences.
  const surname = String(person.name).replace(/[.,]+$/, '').split(/\s+/).pop();
  const re = new RegExp(`\\b${escapeRe(surname)}\\b`, 'i');
  const workCount = workNames.filter((n) => re.test(n)).length + symbolsEditors.filter((n) => re.test(n)).length;
  const occCount = occurrences.filter((o) =>
    (person.subjectKey && o.subject === person.subjectKey) || re.test(o.title || '') || re.test(o.label || '')
  ).length;
  if (workCount === 0 && occCount === 0) fail(`${id}: no work and no occurrences`);
  rows.push({ id, workCount, occCount, cells, person });
}

// Table.
const pad = (s, n) => String(s).padEnd(n);
const cols = FIELD_ORDER.filter((f) => rows.some((r) => f in r.cells));
console.log(`people-check: ${rows.length} people, ${rows.reduce((s, r) => s + Object.keys(r.cells).length, 0)} fields`);
console.log(`S = sourced and verified, R = blank with a reason, X = failed`);
console.log('');
console.log(pad('id', 16) + pad('works', 7) + pad('occ', 6) + cols.map((c) => pad(c, 11)).join(''));
for (const r of rows) {
  console.log(pad(r.id, 16) + pad(r.workCount, 7) + pad(r.occCount, 6) + cols.map((c) => pad(r.cells[c] ?? '-', 11)).join(''));
}
if (SHOW_VALUES) {
  console.log('');
  for (const r of rows) {
    for (const f of Object.keys(r.cells)) {
      const v = r.person[f];
      const shown = typeof v === 'object' && v !== null ? '{...}' : JSON.stringify(v);
      const tail = r.cells[f] === 'R' ? `reason: ${r.person.reasons[f]}` : `source: ${r.person.sources[f]}`;
      console.log(`${r.id}.${f} = ${shown}  [${r.cells[f]}] ${tail}`);
    }
  }
}
console.log('');
console.log(`subjectKey "jung": ${occurrences.filter((o) => o.subject === 'jung').length} occurrences carry subject jung`);
if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\nall checks pass');
