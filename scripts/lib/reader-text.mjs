// What a reader is shown of an instance's body and title, out of the vault's note. The vault keeps its own bookkeeping in
// the same paragraphs as the reading: its plate inventory ("PLATE (p0046.jpg = LS p.15): …"), which pass recorded the
// locus, that a quotation keeps the scan's noise, "(as printed)", "(OCR-garbled)", which chunk a passage came from, what
// "the vault" keeps or tracks. None of that is the reader's. A paragraph that is only bookkeeping goes; bookkeeping inside a
// sentence of content is cut from it; a sentence that is only bookkeeping goes.

const PLATE_PARAGRAPH = /^\**\s*PLATES?\b\s*[(:][^\n]*?\bp\d{4}\.jpg/i;
const PLATE_INVENTORY = /\**\s*\bPLATES?\s*[(:]\s*p\d{4}\.jpg/i;
const PLATE_ASIDE = /\s*\(plates? verified against p\d{4}\.jpg\)/gi;
const NOTE_PARAGRAPH = /^(Source:[^\n]*reading pass\.?|The quotation is verbatim from the scan\b.*|.*\bthe reading pass dates and places the locus\b.*)$/i;

/** Words that make a parenthetical the vault's note. */
const NOTE_WORDS = /\bOCR\b|\bmentions? record\b|garbled|\bas printed\b|\bas given\b|reading[- ]pass|\bthe scan\b|\bnoise\b|verified (?:against|on)\b|\bchunks?\b|\bplate (?:image|render)\b|\bdescribed from the image\b/i;

/** Bookkeeping phrases inside a sentence that otherwise carries the reading. */
const NOTE_PHRASES = [
  /\s*,?\s*(?:in|of) this very chunk(?:\s*\([^)]*\))?/gi,
  /\s+(?:opening|in|from) this (?:seminar )?chunk\b/gi,
  /\s+that runs through the chunk\b/gi,
  /\s+in the vault's longer arc,?/gi,
  /\bthe chunk's\b/gi,
  /,?\s*and stands in [^,.;]*?the vault already tracks\b/gi,
  /\s*[—–-]\s*the latter already harvested from [\w-]+/gi,
  /,?\s*(?:the latter )?already harvested from [\w-]+/gi,
];

/** A sentence that only reports on the scan, the vault's records or its chunks. */
const NOTE_SENTENCE = new RegExp([
  /\bOCR\b/, /\bflag(?:ged)? (?:in|for)\b/, /\bmention record\b/, /\b(?:kept|preserved) verbatim\b/,
  /\bin (?:this|the) chunk\b/, /\bchunk text\b/, /\bthe chunk (?:opens|breaks|carries)\b/, /\bthis chunk\b/, /\bchunk c\d/, /\bearlier chunk\b/,
  /\b(?:this|the|our) vault\b(?!\s+of\b)/, /\bvault's\b/, /\bfor the vault\b/, /\bin the vault\b/, /\bvault (?:reading|locus)\b/i, /\bearly-vault\b/, /\bexisting vault\b/,
  /\balready tracks\b/, /\bverified (?:against|on) (?:the )?plate\b/, /\brecorded here as\b/i, /\bsubject jung\b/,
].map((r) => r.source).join('|'), 'i');

/** Remove each parenthetical (balanced, nested ones whole) whose words are the vault's notes; a bracketed note likewise. */
export function withoutAsides(text) {
  // a bracketed note on the scan: words it lost stand as an editorial ellipsis, any other note goes
  let out = String(text).replace(/\[[^\]]*\blost\b[^\]]*\bOCR\b[^\]]*\]/gi, '[…]').replace(/\s*\[[^\]]*\bOCR\b[^\]]*\]/g, '');
  for (let guard = 0; guard < 12; guard++) {
    let changed = false;
    let depth = 0, start = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === '(') { if (depth++ === 0) start = i; }
      else if (out[i] === ')' && depth > 0 && --depth === 0) {
        if (NOTE_WORDS.test(out.slice(start, i + 1))) { out = out.slice(0, start).replace(/\s+$/, '') + out.slice(i + 1); changed = true; break; }
      }
    }
    // an aside the vault left unclosed runs to the end of the text
    if (!changed && depth > 0 && start >= 0 && NOTE_WORDS.test(out.slice(start))) { out = out.slice(0, start).replace(/\s+$/, ''); changed = true; }
    if (!changed) break;
  }
  // "B.C. (as printed)." loses its aside and keeps one full stop; an ellipsis stays whole
  return out.replace(/\s+([.,;:])/g, '$1').replace(/(?<!\.)\.\.(?!\.)/g, '.').trim();
}

/** Cut bookkeeping phrases from sentences of content, then drop the sentences that are only bookkeeping. */
export function withoutNoteSentences(text) {
  let out = String(text);
  for (const re of NOTE_PHRASES) out = out.replace(re, (m) => (/^the chunk's$/i.test(m.trim()) ? 'the' : ''));
  out = out.replace(/^Vault reading:\s*(\p{L})/u, (_, c) => c.toUpperCase());
  const parts = out.split(/(?<=[.!?][”"’']?)\s+(?=[A-Z“"(])/);
  return parts.filter((x) => !NOTE_SENTENCE.test(x)).join(' ').replace(/\s+([.,;:])/g, '$1').trim();
}

/** A parenthesis that only says which pdf page a thing is on: "(pdf p178)", "(pdf pp. 23–58)", "(pdf p24, p79 and p139)". */
const PDF_ASIDE = /\s*\(\s*(?:cf\.\s*)?(?:[a-z][a-z0-9-]*\s+(?:¶\?\s+)?)?pdf\s+pp?\.?\s*\d(?:[\d\s,;–\-]|\bp\.?(?=\s*\d)|\band\b|&)*\)/gi;
/** The pdf page at the head of an aside that goes on to say something: "(pdf p1483, on the hero …)" keeps "(on the hero …)". */
const PDF_LEAD = /\(\s*(?:[a-z][a-z0-9-]*\s+)?pdf\s+pp?\.?\s*\d[\d–\-]*\s*[,;:]\s*/gi;
/** A pdf page at the tail of an aside that says something first: "(v.26, sem-kundalini pdf p165)" keeps "(v.26)". */
const PDF_TAIL = /(?:\s*[,;]\s*|(?<=["”'’])\s+)(?:[a-z][a-z0-9-]*\s+)?(?:footnote\s+)?pdf\s+pp?\.?\s*\d[\d–\-]*(?=\s*[);])/gi;
/** A voice's name with the pdf page before its quotation: "Crowley, pdf p175: “…”" reads "Crowley: “…”". */
const PDF_BYLINE = /^([A-Z][\w ]{0,30}),\s*pdf\s+pp?\.?\s*\d[\d–\-]*\s*:/;

/** A sentence that indexes pages rather than reading them ("Burt, chapter on Aries: pdf p23, p24 and p37."): it quotes
 *  nothing and ends on the pdf pages it lists once its asides are gone. A sentence that quotes is the reading, and keeps its words. */
const INDEX_SENTENCE = /\bpdf\s+pp?\.?\s*\d[^"“”()]{0,60}$/i;
const QUOTES = /["“”]/;
/** A sentence that only names what a quotation is about: "Crowley on the title; on Mars in Leo." Jung's own "on" lines in an
 *  instance's body can carry the reading ("Jung on the numbers: 5 + 6 + 8 = 19 …"), so there only Crowley's and Burt's go. */
const CAPTION_SENTENCE = /^(?:Crowley|Burt)\s+on\b/;
/** Over a section's quotations every "<voice> on …" line is a caption of them ("Jung on the ram: Dream Analysis seminar …"). */
const SECTION_CAPTION = /^(?:Crowley|Burt|Jung)\s+on\b/;

/** Text the reader is shown with the pdf pages taken out: the cite under a quotation says where it is, the prose does not. */
export function withoutPdfPages(text) {
  const out = String(text).replace(PDF_ASIDE, '').replace(PDF_LEAD, '(');
  const parts = out.split(/(?<=[.!?][”"’']?)\s+(?=[A-Z“"(])/).filter((x) => !(INDEX_SENTENCE.test(x) && !QUOTES.test(x)));
  return parts.join(' ').replace(PDF_TAIL, '').replace(PDF_BYLINE, '$1:').replace(/\s+([.,;:])/g, '$1').trim();
}

/** A paragraph's text without its pdf pages and without the sentences that only caption a quotation. */
export function readerLine(text) {
  const parts = withoutPdfPages(text).split(/(?<=[.!?][”"’']?)\s+(?=[A-Z“"(])/);
  return parts.filter((x) => !CAPTION_SENTENCE.test(x)).join(' ').trim();
}

/** A page's or a section's line over its quotations: a caption of them goes (the title already says what they are about). */
export function readerSectionLine(text) {
  const out = withoutPdfPages(text);
  return SECTION_CAPTION.test(out) ? '' : out;
}

/** A cite's locator without the vault's note on it: "pdf p80 (print ¶¶ 350-352 — unmarked in chunk)" -> "pdf p80 (print ¶¶ 350-352)". */
export function readerLocator(locator) {
  return String(locator).replace(/\s*[—–;]\s*[^—–;()]*(?:\bchunk\b|\bOCR\b)[^—–;()]*/g, '').trim();
}

/** A place as the reader is shown it: the harvest's account of how it inferred the place goes, and a place it could not
 *  read is no place; a "?" stays, as the reading's own doubt about where. */
export function readerPlace(place) {
  const out = withoutAsides(place).replace(/\s*\([^()]*\binferred\b[^()]*\)/gi, '').trim();
  return /^(not given|not legible|unknown|n\/a)$/i.test(out) ? '' : out;
}

/** An instance's title, without the vault's asides. */
export function readerTitle(title) {
  return withoutAsides(title);
}

/** An instance's body paragraphs as the reader is shown them. */
export function readerBody(paragraphs) {
  const kept = [];
  for (const p of paragraphs) {
    if (PLATE_PARAGRAPH.test(p.trim()) || NOTE_PARAGRAPH.test(p.trim())) continue;
    const at = p.search(PLATE_INVENTORY);
    const text = readerLine(withoutNoteSentences(withoutAsides((at < 0 ? p : p.slice(0, at)).replace(PLATE_ASIDE, ''))));
    if (text) kept.push(text);
  }
  return kept;
}
