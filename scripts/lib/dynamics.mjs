// The dynamical lens's data rail, pure core (docs/DYNAMICAL.md §5): curated concept choices become
// public/data/dynamics.json, and every quotation is matched VERBATIM against the vault corpus page it names.
//   · a Van Eenwyk quotation (voice V) is never typed in the site: the curation names its corpus work, page and match;
//     its cite is the printed page the corpus marker gives that pdf page (`print pNN`), and nothing else;
//   · a Jung quotation (voice J) is matched the same way and cited by its corpus locator, which must name the matched pdf page;
//   · a match is one bounded run of at least six words, found once on the page, and never spans a hyphen at a printed line
//     break (de-hyphenating would guess a word: the rail refuses rather than publish one it cannot be sure of);
//   · a mismatch, a missing page, an ambiguous match, or a changed corpus file is a loud failure that names the concept.
// The vault is read-only. Nothing here reads the vault unless a curated concept asks it to.
import { externalDigest, externalMarkdown } from './external.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createNormalizer } from './ocr.mjs';

// Quotations use the existing OCR module's safe mode: whitespace and ligatures only, never word repair (as aion.mjs).
const normalizer = createNormalizer({ freq: new Map(), english: new Set(), pairs: new Map() });
export const normalizePassage = (text) => normalizer.normalize(text, { mode: 'safe' }).text;

const RENDERS = new Set(['lorenz', 'mandelbrot', 'julia']);
const CONCEPT_KEYS = new Set(['id', 'name', 'familyIds', 'quote', 'jung', 'render']);
const QUOTE_KEYS = new Set(['work', 'page', 'locator', 'match']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORK_KEY = /^[\w-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
// the corpus page marker, as scripts/lib/corpus.mjs reads it: <!-- work · pdf p110 · print p96 -->
const PAGE_RE = /^<!--\s*([\w-]+)\s*·\s*pdf p(\d+)(?:\s*·\s*print p([^\s>]+))?\s*-->\s*$/;
/** A match names one place on the page: at least this many words. */
export const MIN_WORDS = 6;
/** Internal only, never published: marks a hyphen that ends a printed line, so the matcher can refuse a span over it. */
const BREAK_MARK = '\u0001';
const WORD_CHAR = /[\p{L}\p{N}]/u;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Read one corpus file's pages for one work. Returns the page text by pdf page, the printed page label of each page
 * (`print pNN`, or null), and any page that is marked twice. A marker for another work ends the current page: its text
 * belongs to no page of this work.
 */
export function parseCorpusPages(raw, work) {
  const lines = raw.split(/\r?\n/);
  const pages = new Map();
  const labels = new Map();
  const duplicates = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(PAGE_RE);
    if (m) {
      if (m[1] !== work) { current = null; continue; }
      const page = Number(m[2]);
      if (pages.has(page)) { duplicates.push(page); current = null; continue; }
      current = [];
      pages.set(page, current);
      labels.set(page, m[3] ?? null);
      continue;
    }
    if (current) current.push(line);
  }
  const text = new Map([...pages].map(([page, ls]) => [page, ls.join('\n').replace(/\s+$/, '')]));
  return { pages: text, labels, duplicates };
}

/**
 * The normalized page, and the index in it of every hyphen that ends a printed line. A line-break hyphen is marked before
 * normalization and the mark removed after, so the page text is exactly what normalizePassage gives, with the breaks known.
 */
function pageText(raw) {
  const marked = normalizePassage(raw.replace(/-\n/g, `-${BREAK_MARK}\n`));
  const breaks = [];
  let out = '';
  for (const ch of marked) {
    if (ch === BREAK_MARK) { breaks.push(out.length - 1); continue; }
    out += ch;
  }
  return { hay: out, breaks };
}

/**
 * The verbatim test: the normalized match must occur exactly once in the normalized page, start and end at a word boundary,
 * be at least MIN_WORDS words, and not include a hyphen that ends a printed line.
 */
export function matchQuotation(pageTextIn, match) {
  const needle = normalizePassage(match);
  if (needle.split(' ').length < MIN_WORDS) return { ok: false, reason: `the match must be at least ${MIN_WORDS} words, so that it names one place on the page` };
  const { hay, breaks } = pageText(pageTextIn);
  const at = hay.indexOf(needle);
  if (at < 0) return { ok: false, reason: 'the match is not found verbatim on the page' };
  if (hay.indexOf(needle, at + 1) >= 0) return { ok: false, reason: 'the match occurs more than once on the page; it must be unique' };
  const end = at + needle.length;
  if ((at > 0 && WORD_CHAR.test(hay[at - 1])) || (end < hay.length && WORD_CHAR.test(hay[end]))) {
    return { ok: false, reason: 'the match begins or ends inside a word; it must start and end at a word boundary' };
  }
  if (breaks.some((h) => h >= at && h < end)) {
    return { ok: false, reason: 'the match spans a hyphen at a printed line break (e.g. "re- peats"); de-hyphenating would guess the word, so choose a match that avoids the break' };
  }
  return { ok: true, text: needle };
}

/**
 * Check the curation's shape and, when `families` is given, that every concept binds to a real family. Voices are
 * enforced: a quotation names a source of its own voice (V for quote, J for jung), so V never reads as Jung.
 */
export function validateCuration(curation, { families } = {}) {
  const errors = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  if (!isObj(curation)) return ['curation: expected an object'];
  if (curation.version !== 1) fail('curation', 'version must be 1');
  if (!isObj(curation.source)) fail('curation', 'source (the Van Eenwyk work) is required');
  else for (const k of ['work', 'author', 'year']) if (!isStr(curation.source[k])) fail('source', `${k} is required`);
  if (curation.sources !== undefined && !isObj(curation.sources)) fail('curation', 'sources must be an object');
  const sources = isObj(curation.sources) ? curation.sources : {};
  for (const [key, s] of Object.entries(sources)) {
    const w = `sources.${key}`;
    if (!WORK_KEY.test(key)) fail(w, 'the key must be a corpus work key');
    if (!isObj(s)) { fail(w, 'expected an object'); continue; }
    if (typeof s.file !== 'string' || !(s.file.startsWith('corpus/') || s.file === `_raw-ext/${key}/pages`) || s.file.split('/').includes('..')) fail(w, 'file must be a corpus/ path, or _raw-ext/<key>/pages, inside the vault');
    if (!SHA256.test(s.sha256 ?? '')) fail(w, 'sha256 must be the 64-character hex digest of the corpus file');
    if (!isStr(s.title)) fail(w, 'title is required');
    // a Van Eenwyk source carries its year; a Jung volume's essays span decades and the vault records no essay dates, so
    // its year may be left empty (the cite then names the volume and the ¶ alone)
    if (s.voice === 'V' ? !isStr(s.year) : typeof s.year !== 'string') fail(w, s.voice === 'V' ? 'year is required' : 'year must be a string (empty when the vault gives none)');
    if (s.voice !== 'V' && s.voice !== 'J') fail(w, 'voice must be "V" (Van Eenwyk) or "J" (Jung)');
  }
  const checkQuote = (q, label, voice, w) => {
    const where = `${w} ${label}`;
    if (!isObj(q)) { fail(where, 'is required and must be an object'); return; }
    for (const k of Object.keys(q)) if (!QUOTE_KEYS.has(k)) fail(where, `unknown field "${k}"`);
    const src = typeof q.work === 'string' ? sources[q.work] : undefined;
    if (!src) fail(where, `work ${q.work ?? ''} is not declared in sources`);
    else if (src.voice !== voice) fail(where, `work ${q.work} is voice ${src.voice}, not ${voice}: ${voice === 'V' ? 'a Van Eenwyk quotation' : 'a Jung quotation'} must name a voice ${voice} source`);
    if (!Number.isInteger(q.page) || q.page < 1) fail(where, 'page must be a pdf page number');
    if (!isStr(q.locator)) fail(where, 'locator (the cite shown) is required');
    if (!isStr(q.match)) fail(where, 'match is required');
    else if (q.match !== q.match.trim() || normalizePassage(q.match) !== q.match) fail(where, 'match must be written in its normalized form (single spaces, no ligatures)');
    else if (q.match.split(' ').length < MIN_WORDS) fail(where, `match must be at least ${MIN_WORDS} words, so that it names one place on the page`);
  };

  if (!Array.isArray(curation.concepts)) { fail('curation', 'concepts must be an array'); return errors; }
  const ids = new Set();
  curation.concepts.forEach((c, i) => {
    let w = `concepts[${i}]`;
    if (!isObj(c)) { fail(w, 'expected an object'); return; }
    if (isStr(c.id)) w = `concept ${c.id}`;
    for (const k of Object.keys(c)) if (!CONCEPT_KEYS.has(k)) fail(w, `unknown field "${k}"`);
    if (!SLUG.test(c.id ?? '')) fail(w, 'id must be a lowercase slug');
    else if (ids.has(c.id)) fail(w, 'duplicate id');
    else ids.add(c.id);
    if (!isStr(c.name)) fail(w, 'name is required');
    if (!Array.isArray(c.familyIds) || !c.familyIds.length || c.familyIds.some((f) => !isStr(f))) fail(w, 'familyIds must be a non-empty list of family ids');
    else if (families) for (const f of c.familyIds) if (!families.has(f)) fail(w, `unresolved family ${f}`);
    if (c.render !== undefined && !RENDERS.has(c.render)) fail(w, `render must be one of ${[...RENDERS].join(', ')}`);
    checkQuote(c.quote, 'quote', 'V', w);
    if (c.jung !== undefined) checkQuote(c.jung, 'jung', 'J', w);
  });
  return errors;
}

/**
 * Read every declared corpus file under the vault: the hash must be the curated one, and the file never written.
 * Returns the pages and printed labels by work key, and any error.
 */
export function loadSourcePages(curation, vault) {
  const errors = [];
  const pages = new Map();
  const labels = new Map();
  const root = path.resolve(vault);
  for (const [key, s] of Object.entries(curation.sources ?? {})) {
    const file = path.resolve(root, s.file);
    if (!file.startsWith(`${root}${path.sep}`)) { errors.push(`sources.${key}: file is outside the vault`); continue; }
    if (!fs.existsSync(file)) { errors.push(`sources.${key}: corpus file unavailable: ${file}`); continue; }
    // a work kept outside corpus/ is its page files, read in the corpus's shape and pinned by their digest
    const external = s.file.startsWith('_raw-ext/');
    const raw = external ? null : fs.readFileSync(file);
    const hash = external ? externalDigest(vault, key) : crypto.createHash('sha256').update(raw).digest('hex');
    if (hash !== s.sha256) errors.push(`sources.${key}: corpus file changed (sha256 ${hash}); recheck the curation before updating its hash`);
    const parsed = parseCorpusPages(external ? externalMarkdown(vault, key, s.title) : raw.toString('utf8'), key);
    for (const page of parsed.duplicates) errors.push(`sources.${key}: pdf page ${page} is marked twice in the corpus`);
    pages.set(key, parsed.pages);
    labels.set(key, parsed.labels);
  }
  return { pages, labels, errors };
}

/**
 * The published data from a curation and the corpus pages it names (pages: work key → pdf page → text; labels: work key →
 * pdf page → printed label). Returns { data, errors }: data is null whenever an error stands. Output has exactly the shape
 * of src/types/dynamics.ts.
 */
export function buildDynamics(curation, { families, pages, labels = new Map() }) {
  const errors = validateCuration(curation, { families });
  if (errors.length) return { data: null, errors };
  const concepts = [];
  for (const c of curation.concepts) {
    const where = `concept ${c.id}`;
    const quote = resolveQuote(curation, pages, labels, c.quote, 'V', `${where} quote`, errors);
    const jung = c.jung === undefined ? undefined : resolveQuote(curation, pages, labels, c.jung, 'J', `${where} jung`, errors);
    if (!quote || (c.jung !== undefined && !jung)) continue;
    const out = { id: c.id, name: c.name, quote, familyIds: [...c.familyIds] };
    if (jung) out.jung = jung;
    if (c.render !== undefined) out.render = c.render;
    concepts.push(out);
  }
  if (errors.length) return { data: null, errors };
  return { data: { version: 1, concepts }, errors: [] };
}

function resolveQuote(curation, pages, labels, q, voice, where, errors) {
  const src = curation.sources[q.work];
  const text = pages.get(q.work)?.get(q.page);
  if (text === undefined) { errors.push(`${where}: pdf page ${q.page} of ${q.work} is not in the corpus`); return null; }
  const m = matchQuotation(text, q.match);
  if (!m.ok) { errors.push(`${where}: ${m.reason} (pdf page ${q.page} of ${q.work})`); return null; }
  if (voice === 'V') {
    // a Van Eenwyk cite names the printed page the passage is on, as the corpus marker gives it: never a freehand locator
    const print = labels.get(q.work)?.get(q.page) ?? null;
    if (!print) { errors.push(`${where}: pdf page ${q.page} of ${q.work} has no printed page label, so the cite cannot name its page`); return null; }
    if (q.locator !== `p. ${print}`) { errors.push(`${where}: locator "${q.locator}" must be "p. ${print}", the printed page of pdf page ${q.page} of ${q.work}`); return null; }
  } else if (!new RegExp(`pdf p${q.page}(?!\\d)`).test(q.locator)) {
    // a Jung cite is his paragraph or page; it must name the pdf page the passage was matched on
    errors.push(`${where}: locator "${q.locator}" must name the matched page (pdf p${q.page})`);
    return null;
  }
  // the cite is the matched source's own title and year: a Van Eenwyk passage from any V source is cited to that source
  const cite = { workTitle: src.title, year: String(src.year), locator: q.locator };
  if (voice === 'J') cite.work = q.work;
  return { text: m.text, cite };
}

/** Validate, read the declared corpus files under `vault`, and build. Nothing is written here. */
export function buildFromVault(curation, { families, vault }) {
  const shape = validateCuration(curation, { families });
  if (shape.length) return { data: null, errors: shape };
  const { pages, labels, errors: corpusErrors } = loadSourcePages(curation, vault);
  const built = buildDynamics(curation, { families, pages, labels });
  const errors = [...corpusErrors, ...built.errors];
  // a corpus that has changed or is absent is a failure of the whole build: no data is returned beside an error
  return { data: errors.length ? null : built.data, errors };
}
