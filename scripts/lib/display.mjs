// Display-side text hygiene for published quotations: the scan's footnote digits and the
// reading-pass protocol's trailing trims are bookkeeping, not Jung's words. The corpus keeps
// them exactly as scanned — it is the court of appeal — so everything here works on the
// DISPLAYED string only, at the bake, and every rule fails open: when in doubt, leave the
// text alone. A missed marker is acceptable; a mangled sentence is not.

/** Sentence-final punctuation that a printed footnote marker may hang on. */
const SENT = '[.!?…]+';
const CLOSING_QUOTE = '[”"’\']?';

// Bibliographic words a digit may legitimately follow ("nn.24", "pp.387", "ch.5", "noten.1"): these are note
// references, never glued footnote markers. The list is whole words only — a word that merely ENDS with one of these
// letters is not protected ("self.5", "moon.37", "Koran.27" are the classic glued markers).
const ABBREV_WORDS = new Set(['n', 'nn', 'p', 'pp', 'v', 'vv', 'ver', 'vers', 'no', 'nos', 'ch', 'chs', 'para', 'par', 'fig', 'figs', 'pl', 'fn', 'fol', 'fols', 'col', 'cols', 'll', 'op', 'ed', 'eds', 'vol', 'vols', 'sec', 'sq', 'qq', 'cf', 'ca', 'r', 'vpt', 'tr', 'trans', 'note', 'notes', 'noten', 'footnote', 'ft']);

/**
 * Strip the scan's glued footnote markers from a DISPLAYED string.
 *   "a traditional mantic significance.43"  -> "... significance."
 *   "the conclusions of Silberer.9"         -> "... Silberer."
 *   "…,”74 the Pythagorean tetraktys,75"    -> "…," the Pythagorean tetraktys,"
 *   "world.” 2"                             -> "world.”"
 * Never touched: years, decimals, ratios, "paragraph 440", "pp. 75s.", "¶452", "1 to 9",
 * "n.83", "ch. II nn.24-25" — a digit is only removed when it hangs directly on sentence
 * punctuation (or a closing quote after it) with no space, and nothing word-like follows.
 */
export function stripFootnoteMarkers(s) {
  if (typeof s !== 'string' || !s || !/\d/.test(s)) return s;
  let t = s;
  // 1. word + sentence punctuation [+ closing quote] + attached digits, with any space-separated repeats
  //    ("significance.43", "Silberer.9", "facts.43 44"): the digits vanish, the words and their punctuation stay.
  //    The repeat run is separated by a plain space only — a digit after a line break begins the scan's footnote
  //    section, which is not part of the sentence
  t = t.replace(new RegExp(`([\\p{Ll}][\\p{Ll}'’]*)(${SENT})(${CLOSING_QUOTE})(\\d{1,3}(?: \\d{1,3})*)(?![\\p{L}\\d])`, 'gu'), (m, w, punct, q, digits) => {
    if (ABBREV_WORDS.has(w.toLowerCase())) return m;
    return w + punct + q;
  });
  // 2. punctuation run + closing quote + attached digits ("…,”74"): the tail of rule 1 where a
  //    comma or an ellipsis sits between the sentence marks and the quote
  t = t.replace(new RegExp(`(${SENT}[,.!?…]*)([”"’'])(\\d{1,3})(?![\\p{L}\\d])`, 'gu'), (m, punct, q) => {
    // a bare comma after a word is rule 3's business; here the punctuation run must already be sentence-final
    if (!/[.!?…]/.test(punct)) return m;
    return punct + q;
  });
  // 3. word + comma + attached digits ("tetraktys,75"): safe because a real list keeps a space
  //    after its comma ("May 29, 1913") and this rule demands the digits touch the comma
  t = t.replace(new RegExp(`([\\p{Ll}][\\p{Ll}'’]*)(${CLOSING_QUOTE}),(\\d{1,3})(?![\\p{L}\\d,\\-–—])`, 'gu'), (m, w, q, digits) => {
    if (ABBREV_WORDS.has(w.toLowerCase())) return m;
    return w + q + ',';
  });
  // 4. sentence punctuation + closing quote + SPACE + 1-2 digits + boundary ("of nature.” 2"):
  //    the spaced marker. Calibrated on the corpus (266 markers against 1 real number): the digit only leaves when
  //    the text ends, punctuation or a new sentence follows — a lowercase word after it ("waited." 2 hours) keeps it
  t = t.replace(new RegExp(`(${SENT})([”’]) (\\d{1,2})(?=\\s*[.,;:!?]|\\s*\$|(?:\\s+)(?![a-zäöüà-ÿ])[^\\s])`, 'gu'), (m, punct, q, digits, off, whole) => {
    // (?=...) alone cannot see past the digits to the next word, so the lookahead admits digits and the word after
    // them is judged here: "2 The next" strips, "2 hours" stays
    const rest = whole.slice(off + m.length);
    if (/^\s*[a-zäöüà-ÿ]/u.test(rest)) return m;
    return punct + q;
  });
  // 5. word [+ comma] + CLOSING quote + digits attached ("quaternio,”18", “he said ’93”-style years excepted by the
  //    curly-quote requirement): the marker hangs on the quote itself. Curly closes only — an opening “ or a straight
  //    " before digits may be quoting a number — and the digits must touch the quote, since real numbers keep a space
  //    ("apples,” 18 oranges" stays)
  t = t.replace(new RegExp(`([\\p{Ll}][\\p{Ll}'’]*)((?:,)?[”’])(\\d{1,3}(?: \\d{1,3})*)(?![\\p{L}\\d])`, 'gu'), (m, w, q) => {
    if (ABBREV_WORDS.has(w.toLowerCase())) return m;
    return w + q;
  });
  return t;
}

/** A trailing ellipsis and any closing quote it sits inside of, captured off the end of a string. */
/** Whether the period at `dot` closes an abbreviation or a single initial ("cf.", "p.", "J."), so it ends no sentence. */
export function abbreviatedBefore(text, dot) {
  const word = /([\p{L}.]+)$/u.exec(text.slice(0, dot))?.[1] ?? '';
  return ABBREV_WORDS.has(word.toLowerCase()) || /^\p{L}$/u.test(word);
}

export const TRAILING_ELLIPSIS = /(?:\s*[…]+|\s*\.{3,}|\s*\.\s\.\s\.)\s*[”"’']?\s*$/u;

/** True when a string ends in an ellipsis that follows a complete sentence (an intentional trailing omission — keep). */
export function sentenceEndsBeforeTrailingEllipsis(s) {
  const m = TRAILING_ELLIPSIS.exec(s.trimEnd());
  if (!m) return false;
  return /[.!?;][”"’')\]]*$/u.test(s.slice(0, s.length - m[0].length).trimEnd());
}
