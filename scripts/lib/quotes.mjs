// Shared by the lens generators: turn curated { work, quote, para? } into published cites, placed by the corpus itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMatches, locate } from './cite.mjs';
import { DEFAULT_VAULT } from './vault.mjs';
import { buildVocab, createNormalizer } from './ocr.mjs';
import { TRAILING_ELLIPSIS, abbreviatedBefore, sentenceEndsBeforeTrailingEllipsis, stripFootnoteMarkers } from './display.mjs';

export { stripFootnoteMarkers, sentenceEndsBeforeTrailingEllipsis } from './display.mjs';

/** A completed quotation may never run this far past the words the curator kept, on either side. */
const MAX_COMPLETION = 700;
const LEADING_ELLIPSIS = /^\s*(?:…+|\.{3,})\s*/u;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let damageScanCache;
/**
 * The scan-damage check ingest's residual gate runs (scripts/lib/ocr.mjs, the same vocabulary and the reviewed
 * exceptions), built once per process. A completion may never add damage its fragment did not already carry: a plate
 * caption or a page of list-type scan has no sentence boundary, so a sentence run can reach across it.
 */
function damageScan() {
  if (damageScanCache === undefined) {
    const exceptionsFile = path.join(ROOT, 'curation', 'ocr-exceptions.json');
    const exceptions = fs.existsSync(exceptionsFile) ? JSON.parse(fs.readFileSync(exceptionsFile, 'utf8')) : {};
    const normalizer = createNormalizer(buildVocab({ vault: DEFAULT_VAULT, cacheDir: path.join(ROOT, '.cache'), log: () => {} }), exceptions);
    damageScanCache = (t) => normalizer.scan(normalizer.normalize(t).text);
  }
  return damageScanCache;
}

/**
 * Words a sentence-completion may never add: note numbering run into the text ("…1929. 13 The Dream", "* 609 Catecheses"),
 * the editors' brackets and rubrics, and an all-caps plate caption ("FEMALE (por Clay…"). A sentence that reaches one
 * is not completed, and the fragment stands as the curator wrote it.
 */
const APPARATUS = /[.!?”"’)\]]\s*\d{1,3}\s+[A-Z“"(]|\*\s*\d|\[\s*(?:Cf|Ed|Trans|Ibid|See)\b|EDITORS|\b[A-Z]{4,}\b|\b[Ii]bid\b/;

const CAPTION_DATE = /\b(centur(?:y|ies)|cent\.|c\.|ca\.|circa|B\.C\.|A\.D\.|wc\.|ws\.|\d{3,4})\b/i;

/**
 * Whether a cited text is a plate caption (an object label as printed), not a sentence of the author's. Two signs: most
 * of its words are capitals (a printed heading or label), or it is a short comma-list label, dated or unterminated
 * ("Clay, Ur, c. 3000 B.C.", "Terra cotta, Peru, pre-Columbian"). A caption is shown as one, never in quotation marks.
 */
export function isPlateCaption(text) {
  const t = String(text ?? '').trim();
  const words = t.match(/[A-Za-z][A-Za-z'’-]*/g)?.filter((w) => w.length >= 2) ?? [];
  if (!words.length) return false;
  const capitals = words.filter((w) => w === w.toUpperCase() && w.length >= 2).length;
  if (capitals / words.length >= 0.5) return true;
  if (t.split(/\s+/).length > 10) return false;
  return CAPTION_DATE.test(t) || (t.includes(',') && !/[.!?…]["”’')\]]*$/.test(t));
}

/** The index of the pdf page a flat-text offset falls on (-1 before the first page marker). */
function pageIndexAt(pages, offset) {
  let idx = -1;
  for (let i = 0; i < pages.length && pages[i].at <= offset; i++) idx = i;
  return idx;
}

/** The words a quotation keeps: no trailing or leading ellipsis (the harvest's own trims), trimmed at the edges. */
function stemOf(quote) {
  let t = quote.trim().replace(LEADING_ELLIPSIS, '');
  const tail = TRAILING_ELLIPSIS.exec(t);
  if (tail) t = t.slice(0, t.length - tail[0].length);
  return t.trimEnd();
}

/** Where the sentence that `start` falls in begins (an offset in `text`), or null when no sentence start is in reach. */
function sentenceStartBefore(text, start) {
  const from = Math.max(0, start - MAX_COMPLETION);
  // the probe runs one character past the stem so a boundary right before it can see the stem's first letter
  const probe = text.slice(from, start + 1);
  let begin = null;
  // a footnote digit glued to the stop ("…Mother.”43") belongs to the stop, not to the next sentence
  for (const m of probe.matchAll(/([.!?]+[”"’')\]]*(?:\d{1,3}(?: \d{1,3})*)?)(\s+)(?=[“"‘'(\p{Lu}¶*])/gu)) {
    if (m[1][0] === '.' && abbreviatedBefore(probe, m.index)) continue;
    begin = from + m.index + m[1].length + m[2].length;
  }
  if (begin === null && from === 0) return 0;
  return begin;
}

/** Where the sentence the corpus runs into ends (an offset in `room`), or null where the corpus itself pauses first. */
function sentenceEndIn(room) {
  // the stop may carry the scan's glued footnote digits ("…Mother.”43"): they are part of the stop, never the next words
  for (const m of room.matchAll(/([.!?…]+[”"’')\]]*)(\d{1,3}(?: \d{1,3})*)?(?=[\s“"‘'“(¶*]|$)/gu)) {
    const stop = m[1];
    if (/\.\s?\.\s?\./.test(room.slice(0, m.index + 1)) || room.slice(0, m.index).includes('…')) return null;
    const stopEnd = m.index + m[0].length;
    const after = room.slice(stopEnd);
    const next = after.match(/^(\s*)(\S{0,24})/u);
    if (/[”"’']$/.test(stop) && next && !next[1] && !/[\s.,;:!?)]/u.test(next[2][0] ?? '')) continue;
    if (stop[0] === '.' && abbreviatedBefore(room, m.index)) continue;
    // the corpus's own pause (an ellipsis) is no sentence end: the completion stops short of it, as the curation did
    if (!/[.!?][”"’')\]]*$/.test(stop)) return null;
    if (!next || !next[2] || /[?!…]/.test(stop) || /^[“"'’«(\d\p{Lu}¶*]/u.test(next[2])) return stopEnd;
  }
  return null;
}

/**
 * Complete a DISPLAYED quotation that is a fragment, at either end. The reading-pass harvest trims a quotation to a
 * window (≤280 characters) and the curation keeps the trim, so the words stand mid-sentence, or stop before the
 * sentence does. The stem's words name one place in the corpus; the display is extended, with the corpus's own words
 * and never a paraphrase, back to the sentence's start and forward to its end. The result is always a contiguous run
 * of the corpus text. A quotation that cannot be found, is found more than once, starts inside a word, runs past the
 * budget, or meets a corpus-native pause is left exactly as it stood, with the reason said.
 */
export function completeQuote(load, work, quote) {
  if (typeof quote !== 'string') return { text: quote, done: false, reason: 'not a string' };
  const corpus = load(work);
  if (!corpus) return { text: quote, done: false, reason: 'no corpus for the work' };
  const stem = stemOf(quote);
  if (stem.split(/\s+/).length < 5) return { text: quote, done: false, stem, reason: 'the stem is too short to name one place' };
  if (/\b[A-Z]{4,}\b/.test(stem)) return { text: quote, done: false, stem, reason: 'the fragment is an all-caps caption, not a sentence' };
  const matches = findMatches(corpus.text, stem);
  if (matches.length === 0) return { text: quote, done: false, stem, reason: 'the stem is not in the corpus' };
  if (matches.length > 1) return { text: quote, done: false, stem, reason: 'the stem names more than one place' };
  const at = matches[0].index;
  const to = at + matches[0][0].length;
  if (at > 0 && /\p{L}/u.test(corpus.text[at - 1]) && /\p{L}/u.test(stem[0])) return { text: quote, done: false, stem, reason: 'the stem begins inside a word' };
  const begin = sentenceStartBefore(corpus.text, at);
  if (begin === null) return { text: quote, done: false, stem, reason: 'no sentence start in reach' };
  // a stem that already ends its sentence keeps the words as they stand: what follows is the scan's footnote, not more text
  const stemEndsSentence = /[.!?…][”"’')\]]*$/.test(stem) && !(stem.endsWith('.') && abbreviatedBefore(stem, stem.length - 1));
  const end = stemEndsSentence ? 0 : sentenceEndIn(corpus.text.slice(to, to + MAX_COMPLETION));
  if (end === null) return { text: quote, done: false, stem, reason: 'the corpus itself pauses before the sentence ends' };
  // a completed quotation stands on the page it cites: a sentence that runs over a page break is not completed
  if (pageIndexAt(corpus.pages, begin) !== pageIndexAt(corpus.pages, to + end - 1)) return { text: quote, done: false, stem, reason: 'the sentence runs over a page break' };
  if (APPARATUS.test(corpus.text.slice(begin, at)) || APPARATUS.test(corpus.text.slice(to, to + end))) return { text: quote, done: false, stem, reason: 'the sentence runs into a note, editorial bracket or caption' };
  // footnote digits glued to the corpus's sentences and the flat text's ¶ anchors are bookkeeping, cleaned as the stem is
  const cleaned = stripFootnoteMarkers(corpus.text.slice(begin, to + end).replace(/\s+/g, ' ').replace(/\*\*¶\d+\*\*\s*/g, '')).trim();
  if (cleaned.length > MAX_COMPLETION * 2) return { text: quote, done: false, stem, reason: 'the sentence runs past the budget' };
  if (begin === at && end === 0) return { text: quote, done: false, stem, reason: 'already a whole sentence' };
  if (damageScan()(cleaned).length > damageScan()(stem).length) return { text: quote, done: false, stem, reason: 'the sentence carries scan damage its fragment does not' };
  return { text: cleaned, done: true, stem, reason: 'completed to the corpus sentence' };
}

/**
 * A cite line names the book, not its catalogue entry: a title carrying "(Author, year)" is a secondary work whose
 * author the voice chip already shows, so the parenthesis and the subtitle are dropped there. Jung's titles stay whole.
 */
const citeTitle = (t) => {
  const m = /^(.*?)\s*\([^()]+,\s*\d{4}\)$/.exec(t);
  return m ? m[1].split(':')[0].trim() : t;
};

/** Work keys → display titles, from the corpus index the ingest already built (falls back to the key). */
export function workTitles(root) {
  const file = path.join(root, 'public', 'data', 'corpus', 'index.json');
  const map = new Map();
  if (fs.existsSync(file)) for (const w of JSON.parse(fs.readFileSync(file, 'utf8')).works) map.set(w.work, citeTitle(w.title));
  return map;
}

/**
 * Place each quotation; push failures to `errors`, disagreements with the vault note's ¶ to `warnings`. Where the
 * corpus marker and the note disagree the locator is the pdf page alone, so no ¶ is ever printed that the corpus
 * contradicts; where the scan merely lost the marker, the note's ¶ stands (locate()).
 *
 * The DISPLAYED string is also cleaned here, at the one choke point every placed-quote generator shares: a trailing
 * trim (the reading pass's ≤280-character harvest) is completed from the corpus sentence it cut, and the scan's glued
 * footnote digits are stripped. Placement runs on the curator's words exactly as given — a quote is only completed
 * when the corpus itself yields the sentence, so what is placed is always verbatim; a quote that will not place is
 * dropped with an error, never guessed.
 */
export function citeQuotes(load, titles, quotes, where, errors, warnings) {
  const out = [];
  for (const q of quotes) {
    const completed = completeQuote(load, q.work, q.quote);
    if (completed.done) warnings.push(`${where}: completed a fragment to its corpus sentence: "${q.quote.slice(0, 40)}" -> "${completed.text.slice(0, 40)}"`);
    const display = stripFootnoteMarkers(completed.text);
    if (display !== q.quote) warnings.push(`${where}: display text cleaned (footnote markers or trailing trim): "${q.quote.slice(0, 40)}"`);
    // placement always names the curator's own words: the stem (the quote without a trailing trim's ellipsis) stands
    // verbatim in the corpus and names one place; a completed sentence is corpus text too, but the stem is what was
    // chosen, and it can never name two pages where the whole sentence names one
    const target = completed.stem && completed.stem.split(/\s+/).length >= 5 ? completed.stem : q.quote;
    const r = locate(load, q.work, target, { para: q.para, page: q.page, pageOnly: q.pageOnly });
    if (r.error) { errors.push(`${where}: ${r.error}`); continue; }
    let locator = r.locator;
    if (r.warning) { warnings.push(`${where}: ${r.warning}`); locator = `pdf p${r.page}`; }
    if (r.note) warnings.push(`${where}: ${r.note}`);
    if (r.scan) warnings.push(`${where}: ${q.work} pdf p${r.page}: placed through scan damage (the printed words; the scan joins or misreads letters)`);
    // the printed page is shown only where the scan's label agrees with its neighbours (trustedPrint)
    // `voice` names whose words these are when not the volume author's; `scan` says a curated quotation is kept as a
    // damaged scan reads it (attested by the curator, never a hand repair)
    out.push({ text: display, cite: { work: q.work, workTitle: titles.get(q.work) ?? q.work, locator, ...(r.print ? { print: r.print } : {}) }, ...(q.voice ? { voice: q.voice } : {}), ...(q.scan ? { scan: true } : {}), ...(isPlateCaption(display) ? { caption: true } : {}) });
  }
  return out;
}
