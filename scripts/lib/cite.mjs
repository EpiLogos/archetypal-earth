// The citation locator shared by the new lens generators (theory, astrology, practice framings, QL, Great Mother).
// A curated quotation names only its work and its exact words; this module finds where the words stand in the
// read-only vault corpus and writes the locator from the corpus itself: the pdf page they stand on and the nearest
// preceding ¶ marker. A quote that is not found, or found on more than one page, is a loud failure — never a guess.
// A `para` the curator expects (from a vault note) is checked against the corpus and reported when it disagrees.
import fs from 'node:fs';
import path from 'node:path';
import { createNormalizer } from './ocr.mjs';
import { externalMarkdown } from './external.mjs';

const normalizer = createNormalizer({ freq: new Map(), english: new Set(), pairs: new Map() });
/** Whitespace and ligature normalisation only: never word repair (the same safe mode the Aion rail uses). */
export const norm = (text) => normalizer.normalize(text, { mode: 'safe' }).text;

/** Locators the site prints and the passage sheet opens: "¶426 (pdf p284)" or "pdf p44". */
export const LOCATOR = /^(?:¶(\d+) \(pdf p(\d+)\)|pdf p(\d+))$/;

/**
 * One work, flattened for searching: page markers and ¶ markers are taken out of the text (so a quotation may run over
 * a page break or past a ¶ marker), and where each page and each ¶ begins is kept as an offset into the flat text.
 */
export function workLoader(vault) {
  const cache = new Map();
  return (work) => {
    if (cache.has(work)) return cache.get(work);
    const file = path.join(vault, 'corpus', `${work}.md`);
    let value = null;
    // a corpus volume, or a work the vault keeps outside corpus/ (_raw-ext), read in the corpus's own shape
    const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : externalMarkdown(vault, work);
    if (source !== null) {
      const text = norm(source);
      const re = new RegExp(`<!-- ${work} · pdf p(\\d+)(?: · print p([^\\s>]+))?[^>]*-->|<!--[^>]*-->|\\*\\*¶(\\d+)\\*\\*`, 'gu');
      const pages = [];
      const marks = [];
      let flat = '';
      let last = 0;
      for (const m of text.matchAll(re)) {
        flat += text.slice(last, m.index);
        last = m.index + m[0].length;
        if (m[1]) pages.push({ page: Number(m[1]), print: m[2] ?? null, at: flat.length });
        else if (m[3]) marks.push({ n: Number(m[3]), at: flat.length });
      }
      flat += text.slice(last);
      value = { text: flat, pages, marks };
    }
    cache.set(work, value);
    return value;
  };
}

/**
 * The printed page of a pdf page, shown only when the scan's own label agrees with its neighbours: at least two of the
 * three pages on either side carry numeric labels at the same pdf-to-print offset. A paragraph number misread as a
 * folio, or a lone label, fails that test and no printed page is shown.
 */
export function trustedPrint(corpus, idx) {
  const p = corpus.pages[idx];
  if (!p?.print || !/^\d+$/.test(p.print)) return null;
  const off = p.page - Number(p.print);
  let agree = 0;
  for (let j = Math.max(0, idx - 3); j <= Math.min(corpus.pages.length - 1, idx + 3); j++) {
    const q = corpus.pages[j];
    if (j !== idx && q.print && /^\d+$/.test(q.print) && q.page - Number(q.print) === off) agree++;
  }
  return agree >= 2 ? p.print : null;
}

/**
 * Letters and digits only, lower-cased, with a map back to the flat text: what a scan keeps of a sentence when it
 * drops spaces ("wasa", "forexample") or punctuation. l, i and 1 are one class (the classic misread: "seif" for "self").
 */
function skeleton(text, from, to) {
  let s = '';
  const at = [];
  for (let i = from; i < to; i++) {
    const ch = text[i].toLowerCase();
    if (/[\p{L}\p{N}]/u.test(ch)) { s += /[li1]/.test(ch) ? 'l' : ch; at.push(i); }
  }
  return { s, at };
}

/**
 * Place a quotation on one page despite scan damage: the page's letters must contain the quotation's letters in order,
 * with nothing between them but what the scan lost (spaces, punctuation) and no letter changed except l/i/1. Only
 * used where the curator names the page, so a loose match can never wander. Returns the offset or -1.
 */
function findOnPageThroughScan(corpus, idx, quote) {
  const start = corpus.pages[idx].at;
  const end = idx + 2 < corpus.pages.length ? corpus.pages[idx + 2].at : corpus.text.length; // may run onto the next page
  const page = skeleton(corpus.text, start, end);
  const needle = skeleton(quote, 0, quote.length).s;
  if (needle.length < 24) return -1;
  const i = page.s.indexOf(needle);
  if (i < 0 || page.s.indexOf(needle, i + 1) >= 0) return -1;
  return page.at[i] < (corpus.pages[idx + 1]?.at ?? Infinity) ? page.at[i] : -1;
}

function pageOf(corpus, at) {
  let lo = 0, hi = corpus.pages.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (corpus.pages[mid].at <= at) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Every place the words stand, any run of whitespace between them matching any other (a removed marker leaves a gap). */
function findAll(hay, needle) {
  // typography only is folded (curly and straight quotes, the three dashes); every letter must still match
  const fold = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['‘’]/g, "['‘’]").replace(/["“”]/g, '["“”]').replace(/[-–—]/g, '[-–—]');
  const words = needle.split(/\s+/).filter(Boolean).map(fold);
  const re = new RegExp(words.join('\\s+'), 'gu');
  return [...hay.matchAll(re)].map((m) => m.index);
}

/**
 * Find a quotation in a work. Returns { locator, page, para, print } or { error }. Markdown emphasis and the
 * corpus's own ¶ markers inside a quote's span are tolerated by stripping them from both sides.
 */
export function locate(load, work, quote, { para: expect, page: onPage } = {}) {
  const corpus = load(work);
  if (!corpus) return { error: `${work}: corpus file missing` };
  const needle = norm(quote).replace(/\*\*¶\d+\*\*\s*/g, '').trim();
  if (needle.split(' ').length < 5) return { error: `${work}: a quotation needs at least five words to name one place` };
  let hits = findAll(corpus.text, needle);
  let scan = false;
  // a curated page chooses among repeats (a chapter title also printed in the contents); it must still be found there
  if (onPage !== undefined && onPage !== null) {
    hits = hits.filter((h) => corpus.pages[pageOf(corpus, h)]?.page === onPage);
    if (!hits.length) {
      // the printed words, read from the book, against a damaged scan of the same page: placed through the damage, and said so
      const idx = corpus.pages.findIndex((p) => p.page === onPage);
      const at = idx >= 0 ? findOnPageThroughScan(corpus, idx, needle) : -1;
      if (at < 0) return { error: `${work}: quotation not found on pdf p${onPage}: "${quote.slice(0, 70)}…"` };
      hits = [at];
      scan = true;
    }
  }
  if (!hits.length) return { error: `${work}: quotation not found verbatim: "${quote.slice(0, 70)}…"` };
  const pageIdx = [...new Set(hits.map((h) => pageOf(corpus, h)))];
  if (pageIdx.length > 1) return { error: `${work}: quotation found on ${pageIdx.length} pages; lengthen it so it names one: "${quote.slice(0, 70)}…"` };
  const at = hits[0];
  const pg = corpus.pages[pageIdx[0]];
  if (!pg) return { error: `${work}: quotation stands before the first page marker` };
  // a quotation that runs over a page break is cited at the page it starts on (the passage sheet shows the next page too)
  const near = [...corpus.marks].reverse().find((k) => k.at < at);
  // a ¶ is cited only when its marker stands on the same page or the quotation's page is inside the same paragraph run
  let para = near && near.at >= (corpus.pages[Math.max(0, pageIdx[0] - 3)]?.at ?? 0) ? near.n : null;
  let note;
  if (expect !== undefined && expect !== null && para !== expect) {
    // The scan drops ¶ markers. The vault note's ¶ stands when the corpus leaves room for it: the marker before the
    // quotation is lower, the next one after it is higher, and no marker for that ¶ stands anywhere in the volume.
    const next = corpus.marks.find((k) => k.at > at && (!near || k.n > near.n));
    const gap = (!near || near.n < expect) && (!next || next.n > expect) && !corpus.marks.some((k) => k.n === expect);
    if (gap) { note = `${work}: ¶${expect} (the vault note) — its marker is missing from the scan, between ${near ? `¶${near.n}` : 'the start'} and ${next ? `¶${next.n}` : 'the end'}`; para = expect; }
  }
  const locator = para !== null ? `¶${para} (pdf p${pg.page})` : `pdf p${pg.page}`;
  const out = { locator, page: pg.page, para, print: trustedPrint(corpus, pageIdx[0]), ...(scan ? { scan: true } : {}), ...(note ? { note } : {}) };
  if (expect !== undefined && expect !== null && para !== expect) out.warning = `${work}: the vault note cites ¶${expect}; the corpus marker before the quotation is ${para === null ? 'none nearby' : `¶${para}`} (cited by its pdf page alone)`;
  return out;
}

/** Verify a cite that already carries a locator: the quotation must start on the cited page (it may run onto the next). */
export function verify(load, { work, locator, quote }) {
  const m = LOCATOR.exec(locator);
  if (!m) return `${work} ${locator}: unreadable locator`;
  const page = Number(m[2] ?? m[3]);
  const corpus = load(work);
  if (!corpus) return `${work}: corpus file missing`;
  const idx = corpus.pages.findIndex((p) => p.page === page);
  if (idx < 0) return `${work}: pdf p${page} not in the corpus`;
  const start = corpus.pages[idx].at;
  const end = idx + 1 < corpus.pages.length ? corpus.pages[idx + 1].at : corpus.text.length;
  const needle = norm(quote).replace(/\*\*¶\d+\*\*\s*/g, '').trim();
  if (findAll(corpus.text, needle).some((at) => at >= start && at < end)) return null;
  // the same scan-damage reading locate() allows on a named page
  return findOnPageThroughScan(corpus, idx, needle) >= 0 ? null : `${work} ${locator}: quotation not verbatim on the cited page: "${quote.slice(0, 60)}…"`;
}
