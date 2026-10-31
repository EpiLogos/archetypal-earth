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
const NOTE_WORDS = /\bOCR\b|garbled|\bas printed\b|\bas given\b|reading[- ]pass|\bthe scan\b|\bnoise\b|verified (?:against|on)\b|\bchunks?\b|\bplate (?:image|render)\b|\bdescribed from the image\b/i;

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
  return out.replace(/\s+([.,;:])/g, '$1').trim();
}

/** Cut bookkeeping phrases from sentences of content, then drop the sentences that are only bookkeeping. */
export function withoutNoteSentences(text) {
  let out = String(text);
  for (const re of NOTE_PHRASES) out = out.replace(re, (m) => (/^the chunk's$/i.test(m.trim()) ? 'the' : ''));
  out = out.replace(/^Vault reading:\s*(\p{L})/u, (_, c) => c.toUpperCase());
  const parts = out.split(/(?<=[.!?][”"’']?)\s+(?=[A-Z“"(])/);
  return parts.filter((x) => !NOTE_SENTENCE.test(x)).join(' ').replace(/\s+([.,;:])/g, '$1').trim();
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
    const text = withoutNoteSentences(withoutAsides((at < 0 ? p : p.slice(0, at)).replace(PLATE_ASIDE, '')));
    if (text) kept.push(text);
  }
  return kept;
}
