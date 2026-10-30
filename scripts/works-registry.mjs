#!/usr/bin/env node
// The Work registry. Every Jung cite names its text by key (`cite.work`). curation/works.json folds those keys into
// Work records (a record's `aliases` are the other keys of the same text), and this script:
//   - resolves every cite key in public/data/field.json and in every other dataset under public/data/;
//   - places each field cite on a corpus page, in the way the passage sheet reads a locator (¶ through the volume's
//     paragraph anchors, else `pdf p`); a `pdf pp` range is not read (corpus.ts:43 reads `pdf p` only; N10 changes that);
//   - writes public/data/works-index.json: each Work's cites in page order, and the cites that cannot be placed.
//
//   node scripts/works-registry.mjs          write public/data/works-index.json
//   node scripts/works-registry.mjs --check  fail on an unresolved key, a Work without an author or kind, a year that its
//                                            named page does not state, a corpus file with no single owner, a chapter
//                                            outside its volume or out of order, or a works-index.json that is stale

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKS = path.join(ROOT, 'curation', 'works.json');
const CHAPTERS = path.join(ROOT, 'curation', 'work-chapters.json');
const DATA = path.join(ROOT, 'public', 'data');
const CORPUS = path.join(DATA, 'corpus');
const INDEX = path.join(DATA, 'works-index.json');

export const KINDS = new Set([
  'collected-volume', 'seminar', 'lectures', 'book', 'anthology', 'letters', 'memoir', 'manuscript', 'secondary', 'deck', 'dictionary',
]);
// the only Works with a reading lens of their own
const LENSES = { 'cw09ii': 'aion', 'liber-novus': 'redbook' };

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

export function loadWorks() {
  return readJson(WORKS).works;
}

/** Every cite key (the record id and each alias) → its Work id. A key that names two Works is an error. */
export function keyMap(works) {
  const map = new Map();
  const errors = [];
  for (const [id, w] of Object.entries(works)) {
    for (const key of [id, ...(w.aliases ?? [])]) {
      if (map.has(key) && map.get(key) !== id) errors.push(`key "${key}" names both ${map.get(key)} and ${id}`);
      else map.set(key, id);
    }
  }
  return { map, errors };
}

const volumes = new Map();
/** A corpus volume (public/data/corpus/<file>), or null when the Work has none. */
export function volume(file) {
  if (!file) return null;
  if (!volumes.has(file)) {
    const p = path.join(CORPUS, file);
    volumes.set(file, fs.existsSync(p) ? readJson(p) : null);
  }
  return volumes.get(file);
}

/**
 * Where a locator sits in a volume. A ¶ is read through the volume's paragraph anchors (the one on the cited pdf page
 * when several match), a `pdf p N` is read as page N. Returns { kind: 'para' | 'pdf', page } or null.
 */
export function placeCite(vol, locator) {
  const loc = String(locator ?? '');
  const para = /¶\s*(\d+)/.exec(loc);
  const pdf = /pdf\s*p\.?\s*(\d+)/.exec(loc);
  if (vol && para) {
    let cands = (vol.paras ?? []).filter((x) => x.para === Number(para[1]));
    if (pdf) {
      const onPage = cands.filter((x) => x.p === Number(pdf[1]));
      if (onPage.length) cands = onPage;
    }
    if (cands.length) return { kind: 'para', page: cands[0].p };
  }
  if (pdf) return { kind: 'pdf', page: Number(pdf[1]) };
  return null;
}

function walk(node, visit) {
  if (Array.isArray(node)) for (const n of node) walk(n, visit);
  else if (node && typeof node === 'object') {
    visit(node);
    for (const v of Object.values(node)) walk(v, visit);
  }
}

/**
 * The cites of the field (one per occurrence cite, with the occurrence id) and every `work`-keyed object in the other
 * datasets under public/data/ (theory, depth, practice and the rest), with their locators where they carry one.
 */
export function collectCites(data = DATA) {
  const field = readJson(path.join(data, 'field.json'));
  const fieldCites = [];
  for (const o of field.occurrences) {
    for (const c of o.jung ?? []) fieldCites.push({ id: o.id, work: c.work, locator: c.locator ?? '', year: c.year ?? '' });
  }
  const other = [];
  for (const f of fs.readdirSync(data).sort()) {
    if (!f.endsWith('.json') || f === 'field.json' || f === 'works-index.json') continue;
    walk(readJson(path.join(data, f)), (o) => {
      if (typeof o.work === 'string') other.push({ dataset: f, work: o.work, locator: typeof o.locator === 'string' ? o.locator : '' });
    });
  }
  return { fieldCites, other };
}

/** The works-index: per Work, its field cites in page order and the field cites that cannot be placed. */
export function buildIndex(works, fieldCites) {
  const { map } = keyMap(works);
  const out = { schema: 1, source: 'public/data/field.json', total: fieldCites.length, ordered: 0, unresolved: 0, works: {} };
  for (const id of Object.keys(works).sort()) out.works[id] = { cites: [], unresolved: [] };
  for (const c of fieldCites) {
    const id = map.get(c.work);
    if (!id) throw new Error(`cite key "${c.work}" on ${c.id} resolves to no Work`);
    const placed = placeCite(volume(works[id].corpus), c.locator);
    if (placed) {
      out.works[id].cites.push({ id: c.id, kind: placed.kind, page: placed.page });
      out.ordered += 1;
    } else {
      out.works[id].unresolved.push({ id: c.id, locator: c.locator });
      out.unresolved += 1;
    }
  }
  for (const w of Object.values(out.works)) {
    w.cites.sort((a, b) => a.page - b.page || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  if (out.ordered + out.unresolved !== out.total) throw new Error(`ordered ${out.ordered} + unresolved ${out.unresolved} != ${out.total}`);
  return out;
}

const serialise = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

function checkYear(id, w, errors) {
  const m = /p\.\s*(\d+)/.exec(w.yearSource ?? '');
  if (!m) return errors.push(`${id}: year ${w.year} has no yearSource naming its page`);
  const vol = volume(w.corpus);
  const pg = vol?.pages.find((p) => p.p === Number(m[1]));
  if (!pg) return errors.push(`${id}: yearSource names p.${m[1]}, which is not in the corpus volume`);
  if (!new RegExp(`(^|\\D)${w.year}(\\D|$)`).test(pg.text)) errors.push(`${id}: p.${m[1]} does not state ${w.year}`);
}

function checkChapters(works, errors) {
  if (!fs.existsSync(CHAPTERS)) return errors.push('curation/work-chapters.json is missing');
  const { works: chapters } = readJson(CHAPTERS);
  for (const [id, w] of Object.entries(works)) {
    if (w.corpus && !chapters[id]) errors.push(`${id}: a corpus volume with no chapter entry`);
  }
  for (const [id, c] of Object.entries(chapters)) {
    if (!works[id]) {
      errors.push(`chapters: ${id} is not a Work`);
      continue;
    }
    if (typeof c.derived !== 'boolean') errors.push(`${id}: derived must be true or false`);
    const vol = volume(works[id].corpus);
    const pages = vol ? vol.pages.map((p) => p.p) : null;
    const lo = pages ? Math.min(...pages) : 1;
    const hi = pages ? Math.max(...pages) : Infinity;
    let prev = -Infinity;
    for (const e of c.chapters) {
      if (!nonEmpty(e.title) || !Number.isInteger(e.page)) errors.push(`${id}: chapter needs a title and an integer page`);
      else if (e.page < lo || e.page > hi) errors.push(`${id}: page ${e.page} "${e.title}" is outside ${lo}-${hi}`);
      else if (e.page < prev) errors.push(`${id}: page ${e.page} "${e.title}" comes after ${prev}`);
      prev = Math.max(prev, e.page);
    }
  }
}

export function check() {
  const errors = [];
  const works = loadWorks();
  const { map, errors: keyErrors } = keyMap(works);
  errors.push(...keyErrors);

  for (const [id, w] of Object.entries(works)) {
    if (!/^[a-z0-9-]+$/.test(id)) errors.push(`${id}: a Work id is a lower-case slug`);
    if (!nonEmpty(w.title)) errors.push(`${id}: no title`);
    if (!KINDS.has(w.kind)) errors.push(`${id}: kind "${w.kind}" is not in the vocabulary`);
    if (!nonEmpty(w.author)) errors.push(`${id}: no author`);
    if (w.corpus && !fs.existsSync(path.join(CORPUS, w.corpus))) errors.push(`${id}: corpus file ${w.corpus} is missing`);
    if (w.lens !== undefined && LENSES[id] !== w.lens) errors.push(`${id}: lens "${w.lens}" is not one of its lenses`);
    if (w.year !== undefined) checkYear(id, w, errors);
  }

  const corpusIndex = readJson(path.join(CORPUS, 'index.json')).works;
  for (const e of corpusIndex) {
    const owners = Object.entries(works).filter(([, w]) => w.corpus === e.file).map(([id]) => id);
    if (owners.length !== 1) errors.push(`corpus ${e.file}: claimed by ${owners.length} Works (${owners.join(', ') || 'none'})`);
    else if (owners[0] !== e.work) errors.push(`corpus ${e.file}: its Work is ${owners[0]}, the index says ${e.work}`);
  }

  const { fieldCites, other } = collectCites();
  const unresolvedKeys = new Set();
  for (const c of [...fieldCites, ...other]) if (!map.has(c.work)) unresolvedKeys.add(c.work);
  for (const k of [...unresolvedKeys].sort()) errors.push(`cite key "${k}" resolves to no Work`);

  const built = buildIndex(works, fieldCites);
  const onDisk = fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf8') : null;
  if (onDisk !== serialise(built)) errors.push('public/data/works-index.json is stale: run node scripts/works-registry.mjs');

  checkChapters(works, errors);

  const fieldKeys = new Set(fieldCites.map((c) => c.work));
  const counts = {
    works: Object.keys(works).length,
    aliases: Object.values(works).reduce((n, w) => n + (w.aliases ?? []).length, 0),
    fieldKeys: fieldKeys.size,
    fieldKeysResolved: [...fieldKeys].filter((k) => map.has(k)).length,
    otherCites: other.length,
    otherCitesUnresolved: other.filter((c) => !map.has(c.work)).length,
    authors: Object.values(works).filter((w) => nonEmpty(w.author)).length,
    corpusClaimed: corpusIndex.length,
    years: Object.values(works).filter((w) => w.year !== undefined).length,
    cites: built.total,
    ordered: built.ordered,
    unresolved: built.unresolved,
  };
  return { errors, counts, built };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const { errors, counts } = check();
    console.log(`works: ${counts.works} records, ${counts.aliases} aliases, ${counts.authors} with an author`);
    console.log(`field cite keys: ${counts.fieldKeysResolved}/${counts.fieldKeys} resolved; other datasets: ${counts.otherCites - counts.otherCitesUnresolved}/${counts.otherCites} cites resolved`);
    console.log(`corpus volumes claimed: ${counts.corpusClaimed}; years with a page: ${counts.years}`);
    console.log(`cites: ${counts.cites}; ordered ${counts.ordered} + unresolved ${counts.unresolved}`);
    if (errors.length) {
      console.error(`\n${errors.length} problem(s):`);
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log('works-registry: ok');
    return;
  }
  const works = loadWorks();
  const { map } = keyMap(works);
  const { fieldCites, other } = collectCites();
  const unresolved = [...new Set([...fieldCites, ...other].map((c) => c.work).filter((k) => !map.has(k)))].sort();
  if (unresolved.length) {
    for (const k of unresolved) console.error(`  - cite key "${k}" resolves to no Work`);
    process.exit(1);
  }
  const built = buildIndex(works, fieldCites);
  fs.writeFileSync(INDEX, serialise(built));
  console.log(`wrote ${path.relative(ROOT, INDEX)}: ${built.total} cites, ordered ${built.ordered}, unresolved ${built.unresolved}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
