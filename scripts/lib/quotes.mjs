// Shared by the lens generators: turn curated { work, quote, para? } into published cites, placed by the corpus itself.
import fs from 'node:fs';
import path from 'node:path';
import { findMatches, locate } from './cite.mjs';
import { TRAILING_ELLIPSIS, sentenceEndsBeforeTrailingEllipsis, stripFootnoteMarkers } from './display.mjs';

export { stripFootnoteMarkers, sentenceEndsBeforeTrailingEllipsis } from './display.mjs';

/** A completed or cleaned display string may never run this far past the words the curator kept. */
const MAX_COMPLETION = 600;

/**
 * Complete a DISPLAYED quotation whose text tails off into an ellipsis mid-thought (the reading-pass harvest's
 * ≤280-character trims). The corpus holds the full sentence: the stem's words name one place in it, and the display
 * is extended forward — with the corpus's own words, never a paraphrase — to that sentence's end. A quote that cannot
 * be found, is found more than once, runs past the budget, or reaches a corpus-native ellipsis (Jung's own, or an
 * editorial omission) is left exactly as it stood, with the reason said.
 */
export function completeTrailingQuote(load, work, quote) {
  if (typeof quote !== 'string') return { text: quote, done: false, reason: 'not a string' };
  const trimmed = quote.trimEnd();
  const tail = TRAILING_ELLIPSIS.exec(trimmed);
  if (!tail) return { text: quote, done: false, reason: 'no trailing ellipsis' };
  if (sentenceEndsBeforeTrailingEllipsis(trimmed)) return { text: quote, done: false, reason: 'a sentence ends before the ellipsis' };
  const stem = trimmed.slice(0, trimmed.length - tail[0].length).trimEnd();
  if (stem.split(/\s+/).length < 5) return { text: quote, done: false, reason: 'the stem is too short to name one place' };
  const corpus = load(work);
  if (!corpus) return { text: quote, done: false, stem, reason: 'no corpus for the work' };
  const matches = findMatches(corpus.text, stem);
  if (matches.length === 0) return { text: quote, done: false, stem, reason: 'the stem is not in the corpus' };
  if (matches.length > 1) return { text: quote, done: false, stem, reason: 'the stem names more than one place' };
  const room = corpus.text.slice(matches[0].index + matches[0][0].length, matches[0].index + matches[0][0].length + MAX_COMPLETION);
  // the corpus itself pauses where the trim began (Jung's own ellipsis, or an editorial omission): nothing to complete
  // to. A terminator ends the sentence only when the text stops there or the next word can start one: footnote digits
  // glued after the period do not hide the end ("...teres.30 **¶553**"), an abbreviation's period before a lowercase
  // word is not an end, and a closing quote run straight into a dash opens someone else's sentence — all declined.
  let end = null;
  for (const m of room.matchAll(/[.!?…]+[”"’')\]]*(?=[\s\d“"‘'“(¶*]|$)/gu)) {
    if (/\.\s?\.\s?\./.test(room.slice(0, m.index + 1)) || room.slice(0, m.index).includes('…')) break; // the corpus pauses first
    const after = room.slice(m.index + m[0].length);
    const next = after.match(/^(\s*)(\S{0,24})/u);
    if (/[”"’']$/.test(m[0]) && next && !next[1] && !/[\s.,;:!?)]/u.test(next[2][0] ?? '')) continue; // quote closed, narration dashes on
    if (!next || !next[2] || m[0].match(/[?!…]/) || /^[“"'’«(\d\p{Lu}¶*]/u.test(next[2])) { end = m; break; }
  }
  if (!end || !/[.!?][”"’')\]]*$/.test(end[0])) return { text: quote, done: false, stem, reason: 'the corpus itself pauses here (its own ellipsis or no sentence end in reach)' };
  const addition = room.slice(0, end.index + end[0].length).trim();
  if (!/\p{L}/u.test(addition)) return { text: quote, done: false, stem, reason: 'nothing but punctuation would be added' };
  // the completion is corpus text: it may carry the scan's glued footnote digits and the flat text's ¶ anchors —
  // both are bookkeeping, so the displayed words are cleaned the same way the stem was. The trim may have cut right
  // before a comma, so the join only takes a space when the corpus's own words do not carry their punctuation.
  const joined = /^[,.!?;:’”]/.test(addition) ? `${stem}${addition}` : `${stem} ${addition}`;
  const cleaned = stripFootnoteMarkers(joined.replace(/\s+/g, ' ').replace(/\*\*¶\d+\*\*\s*/g, '')).trim();
  return { text: cleaned, done: true, stem, reason: 'completed to the corpus sentence end' };
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
    const completed = completeTrailingQuote(load, q.work, q.quote);
    if (completed.done) warnings.push(`${where}: completed a trailing trim from the corpus: "${q.quote.slice(-40)}" -> "${completed.text.slice(-40)}"`);
    const display = stripFootnoteMarkers(completed.text);
    if (display !== q.quote) warnings.push(`${where}: display text cleaned (footnote markers or trailing trim): "${q.quote.slice(0, 40)}"`);
    // placement always names the curator's own words: the stem (the quote without a trailing trim's ellipsis) stands
    // verbatim in the corpus and names one place; a completed sentence is corpus text too, but the stem is what was
    // chosen, and it can never name two pages where the whole sentence names one
    const target = completed.stem && completed.stem.split(/\s+/).length >= 5 ? completed.stem : q.quote;
    const r = locate(load, q.work, target, { para: q.para, page: q.page });
    if (r.error) { errors.push(`${where}: ${r.error}`); continue; }
    let locator = r.locator;
    if (r.warning) { warnings.push(`${where}: ${r.warning}`); locator = `pdf p${r.page}`; }
    if (r.note) warnings.push(`${where}: ${r.note}`);
    if (r.scan) warnings.push(`${where}: ${q.work} pdf p${r.page}: placed through scan damage (the printed words; the scan joins or misreads letters)`);
    // the printed page is shown only where the scan's label agrees with its neighbours (trustedPrint)
    out.push({ text: display, cite: { work: q.work, workTitle: titles.get(q.work) ?? q.work, locator, ...(r.print ? { print: r.print } : {}) }, ...(q.voice ? { voice: q.voice } : {}) });
  }
  return out;
}
