// The quote oracle's engine: every record the app presents as a quotation, resolved to the corpus pages it cites and
// checked to be verbatim there. Plain ESM shared by scripts/quote-oracle.mjs (the gate) and tests/data/quote-oracle.test.ts.
//
// The stated normalisation, applied to BOTH sides (the quotation and the corpus page), so that only the words are compared:
//   - Unicode NFKC (ligatures ﬁ ﬂ ﬀ …, full-width forms, the ellipsis character … becomes ...), soft hyphens removed;
//   - the scan's glued footnote digits folded away on both sides (display.mjs stripFootnoteMarkers, the fold the build's own
//     verifier applies), the corpus's ¶ anchors removed, editorial square brackets dropped (their words stay);
//   - every quote mark, single or double, curly or straight, is one mark (the vault nests a quotation's inner "…" as '…');
//     every dash (– — ‒ ― −) is a hyphen;
//   - a hyphen at a line end folds into the word: "dedi-\ncated" -> "dedicated" (the scan keeps line-end hyphens; a quotation
//     that kept the break as "dedi- cated" folds the same way);
//   - a slash is a space (verse lines are set "a / b" in a quotation and run on in the corpus); runs of whitespace are one space;
//     case is folded.
// Two more folds apply only as a named fallback, reported as class "scan" with a scanKind, because they are the scan's own furniture:
//   - scanKind "page-break": a quotation that runs over a page break skips what the scan sets between the two halves: a footnote block and
//     a folio at the foot of the first page (at most BREAK_TAIL characters), a running head at the top of the next (at most BREAK_HEAD);
//     a word the break divides ("gov-" / "ernment") is rejoined;
//   - scanKind "notes": a footnote call the scan leaves in the page ("river,” 31 probably", "marble4", "souls21", "Goddessl86-it"), a doubled opening mark and a stray
//     middle dot are not part of the words;
//     it is folded out of the page only, so a quotation that carries a number the page lacks does not pass.
// An ellipsis ("…", "...", ". . .") splits a quotation into fragments; each fragment must stand, in order, on the cited pages
// (or on the page that follows one of them: a quotation runs over a page break).
import fs from 'node:fs';
import path from 'node:path';
import { stripFootnoteMarkers } from './display.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// normalisation and fragments
// ---------------------------------------------------------------------------------------------------------------------

export function normalise(s) {
  let t = stripFootnoteMarkers(String(s ?? ''));
  t = t.normalize('NFKC');
  t = t.replace(/­/g, '');
  t = t.replace(/\*\*¶\d+\*\*/g, ' ');
  t = t.replace(/[“”„‟«»‘’‚‛′`´']/g, '"');
  t = t.replace(/[–—‒―−]/g, '-');
  t = t.replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2');
  t = t.replace(/[\[\]]/g, '');
  t = t.replace(/\s*\/\s*/g, ' '); // a verse line break set as " / " (the corpus runs the lines on, or keeps a bare "/")
  t = t.replace(/\s+/g, ' ');
  return t.toLowerCase().trim();
}

/** Letters and digits only: spacing and punctuation damage is invisible to it (reported as scan damage, never as verbatim). */
export const skeleton = (s) => normalise(s).replace(/[^\p{L}\p{N}]+/gu, '');

const MIN_FRAGMENT = 12; // characters (normalised): a shorter fragment cannot name a place

/** The fragments of a quotation split at its ellipses, or null when it has none. */
export function fragmentsOf(text) {
  const raw = String(text ?? '');
  if (!/…|\.{3}|\.\s\.\s\./.test(raw)) return null;
  return raw
    .split(/\s*\[?\s*(?:…|\.{3,}|\.\s\.\s\.(?:\s\.)?)\s*\]?\s*/)
    .map((s) => s.trim())
    .filter((s) => normalise(s).length >= MIN_FRAGMENT);
}

// ---------------------------------------------------------------------------------------------------------------------
// locators
// ---------------------------------------------------------------------------------------------------------------------

const NUM = String.raw`\d+(?:\s*[–—-]\s*\d+)?`;
// "pdf p12", "pdf pp12–14", "pdf pp 62, 64–66", "pdf p. 5": the page list after "pdf p" / "pdf pp"
const PDF_RUN = new RegExp(String.raw`pdf\s*pp?\.?\s*(${NUM}(?:\s*,\s*${NUM})*)`, 'gi');
// "p. 67", "pp. 67–68", "p. 9" not preceded by "pdf": the book's printed pages
const PRINT_RUN = new RegExp(String.raw`(?<![A-Za-z])pp?\.\s*(${NUM}(?:\s*,\s*${NUM})*)`, 'gi');
const MAX_RANGE = 120;

function expandList(list) {
  const out = [];
  for (const part of list.split(',')) {
    const m = /^\s*(\d+)(?:\s*[–—-]\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (b < a || b - a > MAX_RANGE) { out.push(a); continue; }
    for (let p = a; p <= b; p++) out.push(p);
  }
  return out;
}

/**
 * What a locator names: `pdf` (pdf pages, ranges and lists expanded: "pdf pp62, 64–66" -> 62 63? no: 62, 64, 65, 66), `printed`
 * (printed pages, used only where no pdf page is named) and `paras` (¶ numbers, informational).
 */
export function parseLocator(locator) {
  const s = String(locator ?? '');
  const pdf = [];
  for (const m of s.matchAll(PDF_RUN)) for (const p of expandList(m[1])) if (!pdf.includes(p)) pdf.push(p);
  const printed = [];
  const without = s.replace(PDF_RUN, ' ');
  for (const m of without.matchAll(PRINT_RUN)) for (const p of expandList(m[1])) if (!printed.includes(String(p))) printed.push(String(p));
  const paras = [...s.matchAll(/¶+\s*(\d+)(?:\s*[–—-]\s*(\d+))?/g)].flatMap((m) => (m[2] ? [Number(m[1]), Number(m[2])] : [Number(m[1])]));
  return { pdf, printed, paras };
}

// ---------------------------------------------------------------------------------------------------------------------
// corpus
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One volume prepared for matching: the normalised pages joined by a space, with where each page starts. Three views of the
 * same text are searched, each with a map back to offsets in the first: `flat` (the words as they stand), `compact` (no
 * spaces or hyphens: a damaged scan splits words, "Th e psychoid", and breaks a dash at a line end) and `skeleton` (letters and digits only: punctuation differs too).
 */
export function prepareVolume(doc) {
  const pages = doc.pages.map((pg) => ({ p: pg.p, print: pg.print ?? null }));
  let flat = '';
  const starts = [];
  for (const pg of doc.pages) { starts.push(flat.length); flat += normalise(pg.text) + ' '; }
  const paraPages = new Map();
  for (const x of doc.paras ?? []) {
    const l = paraPages.get(x.para) ?? [];
    if (!l.includes(x.p)) l.push(x.p);
    paraPages.set(x.para, l);
  }
  const views = {};
  const reduce = (keep) => {
    let text = '';
    const map = [];
    for (let i = 0; i < flat.length; i++) if (keep.test(flat[i])) { text += flat[i]; map.push(i); }
    return { text, map };
  };
  const vol = {
    work: doc.work,
    source: doc.pages,
    pages,
    flat,
    starts,
    paraPages,
    byPdf: new Map(pages.map((pg, i) => [pg.p, i])),
    pageIndexAt(off) {
      let lo = 0, hi = starts.length - 1, best = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= off) { best = mid; lo = mid + 1; } else hi = mid - 1; }
      return best;
    },
    /** 'flat' | 'compact' | 'skeleton' -> { text, map } (map: offset in the view -> offset in flat), built on first use */
    view(name) {
      if (name === 'flat') return { text: flat, map: null };
      return (views[name] ??= reduce(name === 'compact' ? /[^\s-]/ : /[\p{L}\p{N}]/u));
    },
  };
  return vol;
}

/** Lazy per-work loader over a corpus directory (public/data/corpus). A work with no file is null. A cite key that the index
 * gives as an alias of a volume's Work (curation/works.json: redbook → liber-novus) reads that volume. */
export function corpusLoader(dir) {
  const cache = new Map();
  let index = null;
  const loader = (work) => {
    if (cache.has(work)) return cache.get(work);
    let volume = work;
    try { volume = loader.index().works.find((w) => (w.aliases ?? []).includes(work))?.work ?? work; } catch { /* no index: the key itself */ }
    const file = path.join(dir, `${volume}.json`);
    let vol = null;
    if (/^[\w-]+$/.test(volume) && volume !== 'index' && fs.existsSync(file)) vol = prepareVolume(JSON.parse(fs.readFileSync(file, 'utf8')));
    cache.set(work, vol);
    return vol;
  };
  loader.index = () => (index ??= JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')));
  return loader;
}

// ---------------------------------------------------------------------------------------------------------------------
// matching one quotation against one cite
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The pdf pages a locator names in a volume. Order of authority: the pdf pages it names; else the printed pages (mapped
 * through the volume's own `print` labels); else the ¶ numbers (mapped through the volume's ¶ anchors).
 * Returns { pages: number[], via: 'pdf' | 'printed' | 'para' | null, missing: number[] }.
 */
export function citedPages(vol, locator) {
  const { pdf, printed, paras } = parseLocator(locator);
  if (pdf.length) return { pages: pdf.filter((p) => vol.byPdf.has(p)), via: 'pdf', missing: pdf.filter((p) => !vol.byPdf.has(p)) };
  if (printed.length) {
    const pages = vol.pages.filter((pg) => pg.print !== null && printed.includes(String(pg.print))).map((pg) => pg.p);
    return { pages, via: 'printed', missing: pages.length ? [] : printed.map(Number) };
  }
  if (paras.length) {
    const pages = [...new Set(paras.flatMap((n) => vol.paraPages.get(n) ?? []))];
    return { pages, via: 'para', missing: pages.length ? [] : paras };
  }
  return { pages: [], via: null, missing: [] };
}


/** the words with the scan's footnote calls taken out (the named fallback "notes"): digits glued to a word or its closing mark, and a
 * lone 1-3 digit number set after a sentence mark or a name inside a sentence before a word ("river,” 31 probably", "Canistris 40 afford"). Applied to the PAGE only: a quotation that
 * carries a number the page does not is not matched by this fold. */
export function normaliseNotes(s) {
  let t = String(s ?? '').normalize('NFKC');
  t = t.replace(/(?<=\p{Ll}{3})[lI1]\d{2,3}(?=[-–—]\p{L})/gu, ''); // "Goddessl86-it": the call read as a letter and digits
  t = t.replace(/(?<=\p{Ll}{2}[\]”"')]*[,.:;!?]?[\]”"')]*)\d{1,3}(?![\p{L}\d])/gu, '');
  t = t.replace(/(?<=\p{Ll}{2}[,;:.?!][”"’')\]]*|[”"’')\]]|\p{Ll}\s+\p{Lu}\p{Ll}+)\s+\d{1,3}\s+(?=\p{L})/gu, ' ');
  t = t.replace(/(?<=\p{Ll}\s+\p{Lu}\p{Ll}+)\s+\d{1,3}(?=[-–—]\p{L})/gu, ''); // "Magdeburg 39-approached"
  t = t.replace(/(['"‘’“”])\1+/g, '$1'); // a doubled mark: ''Apage
  // a lone number between plain words that the same page opens a footnote line with ("churinga 70 of ..." and a line "70 Spencer ...")
  const noteNumbers = [...t.matchAll(/^[ \t]*(\d{1,3})[ \t]+\S/gm)].map((m) => m[1]);
  if (noteNumbers.length) t = t.replace(new RegExp(String.raw`(?<=\S)[ \t]+(?:${[...new Set(noteNumbers)].join('|')})(?=\s+\p{L})`, 'gu'), '');
  t = t.replace(/(^|\s)·(?=\s)/g, '$1'); // a stray middle dot
  t = t.replace(/(?<=\p{L})\^(?=\s|[,.;:])/gu, ''); // a caret for a footnote mark: Cabiri^
  return normalise(t);
}

const BREAK_TAIL = 1600; // characters of footnotes and folio the scan may set at the foot of the page a quotation leaves
const BREAK_HEAD = 60; // characters of running head the scan may set at the top of the page it enters
const MAX_BREAKS = 3;

/** the page texts of a volume under one fold ('flat' = normalise, 'notes' = normaliseNotes), built on first use */
function pageTexts(vol, kind) {
  vol.pageTextCache ??= {};
  if (!vol.pageTextCache[kind]) {
    const f = kind === 'flat' ? normalise : normaliseNotes;
    const squash = kind === 'notes-compact' ? (x) => x.replace(/[\s-]+/g, '') : (x) => x;
    vol.pageTextCache[kind] = vol.source.map((pg) => squash(f(pg.text)));
  }
  return vol.pageTextCache[kind];
}

const commonPrefix = (a, b) => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
};

/**
 * Match the needles in order, allowing each to run over page breaks as the scan makes them (see the header). A needle starts on one of the
 * `allowed` pdf pages. Returns { crossed } (whether any break was crossed) or null. The first fragment may start anywhere; each later one
 * starts at or after the end of the one before.
 */
function bridged(vol, kind, needles, allowed) {
  const texts = pageTexts(vol, kind);
  const pageNo = (i) => vol.pages[i].p;
  /** walk q from (pi, off); returns { pi, off, crossed } at its end, or null */
  const walk = (pi, off, q, crossed, breaks) => {
    const text = texts[pi];
    const L = commonPrefix(q, text.slice(off));
    if (L >= q.length) return { pi, off: off + L, crossed };
    if (pi + 1 >= texts.length || breaks >= MAX_BREAKS) return null;
    if (pageNo(pi + 1) !== pageNo(pi) + 1) return null;
    if (text.length - (off + L) > BREAK_TAIL) return null;
    const rest = q.slice(L).replace(/^\s+/, '');
    if (rest.length < 4) return null;
    const head = texts[pi + 1].slice(0, BREAK_HEAD + 16);
    const key = rest.slice(0, 16);
    for (let h = head.indexOf(key); h >= 0; h = head.indexOf(key, h + 1)) {
      const r = walk(pi + 1, h, rest, true, breaks + 1);
      if (r) return r;
    }
    return null;
  };
  /** the first place q stands at or after (pi, off), starting on an allowed page */
  const find = (q, from) => {
    const key = q.slice(0, Math.min(q.length, 24));
    for (let pi = from.pi; pi < texts.length; pi++) {
      if (!allowed.has(pageNo(pi))) continue;
      const text = texts[pi];
      for (let at = text.indexOf(key, pi === from.pi ? from.off : 0); at >= 0; at = text.indexOf(key, at + 1)) {
        const r = walk(pi, at, q, false, 0);
        if (r) return r;
      }
    }
    // the page break may fall inside the first words: look for a shorter start in the foot of the page
    for (let pi = from.pi; pi < texts.length; pi++) {
      if (!allowed.has(pageNo(pi))) continue;
      const text = texts[pi];
      const floor = Math.max(pi === from.pi ? from.off : 0, text.length - BREAK_TAIL - 40);
      for (const k of [16, 8, 3]) {
        if (q.length <= k) continue;
        for (let at = text.indexOf(q.slice(0, k), floor); at >= 0; at = text.indexOf(q.slice(0, k), at + 1)) {
          const r = walk(pi, at, q, false, 0);
          if (r) return r;
        }
      }
    }
    return null;
  };
  let pos = { pi: 0, off: 0 };
  let crossed = false;
  for (const raw of needles) {
    const q0 = normalise(raw).trim(); // the quotation is read as it stands: only the page's furniture is folded away
    const q = kind === 'notes-compact' ? q0.replace(/[\s-]+/g, '') : q0;
    if (q.length < 3) return null;
    const r = find(q, pos);
    if (!r) return null;
    pos = { pi: r.pi, off: r.off };
    crossed ||= r.crossed;
  }
  return { crossed };
}

const needleOf = (view, s) => (view === 'flat' ? normalise(s) : view === 'compact' ? normalise(s).replace(/[\s-]+/g, '') : skeleton(s));

/**
 * Where the needles stand, in order, in one view of the volume, each starting on an allowed page (any page when `allowed` is
 * null). Returns the flat offset of the first needle, or null.
 */
function chain(vol, view, needles, allowed) {
  const { text, map } = vol.view(view);
  const flatOff = (i) => (map ? map[i] : i);
  const pageOf = (i) => vol.pages[vol.pageIndexAt(flatOff(i))].p;
  const ok = (i) => allowed === null || allowed.has(pageOf(i));
  const next = (needle, from) => {
    for (let i = text.indexOf(needle, from); i >= 0; i = text.indexOf(needle, i + 1)) if (ok(i)) return i;
    return -1;
  };
  for (let first = next(needles[0], 0); first >= 0; first = next(needles[0], first + 1)) {
    let pos = first + needles[0].length;
    let good = true;
    for (let k = 1; k < needles.length; k++) {
      const at = next(needles[k], pos);
      if (at < 0) { good = false; break; }
      pos = at + needles[k].length;
    }
    if (good) return flatOff(first);
  }
  return null;
}

/** every flat offset where a single needle stands in a view (for naming the nearest page) */
function allHits(vol, view, needle) {
  const { text, map } = vol.view(view);
  const out = [];
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) out.push(map ? map[i] : i);
  return out;
}

/** a normalised quotation without the punctuation it closes on (the cited sentence goes on, or ends otherwise) */
const trimEnd = (n) => n.replace(/[\s.,;:!?"')*-]+$/, '');

const trimLast = (ns) => ns.map((n, i) => (i === ns.length - 1 ? trimEnd(n) : n));

const MIN_LOOSE = 20; // characters: a shorter reading cannot be told from chance in the compact and letters-only views

/**
 * Match one quotation to the pages a cite names. Result `cls`:
 *   exact | ellipsis        verbatim on the cited pages (the start on a cited page; it may run over the page break)
 *   scan                    verbatim but for spaces or hyphens the scan split or joined ("Th e psychoid"): the printed words, a damaged scan
 *   ending-only             verbatim except for the punctuation the quotation closes on (the cited sentence goes on: "intelligence." for
 *                           "intelligence, wherever it might be found")
 *   letters-only            the letters and digits agree but other punctuation differs (scan marks, a changed word division)
 *   wrong-page-adjacent     verbatim, but one page from a cited page (`foundPdf`, `delta`)
 *   wrong-page-elsewhere    verbatim, but further away in the same volume (`foundPdf`)
 *   not-verbatim            nowhere in the volume
 *   printed-only            verbatim, but the cite names a printed page, not a pdf page: it cannot open the passage
 *   no-locator              the cite names no page
 *   locator-unresolved      the cite names a page or ¶ the volume does not hold (`foundPdf` says where the words stand, if anywhere)
 *   too-short               nothing to check
 * (no-corpus, for a work with no volume, is decided by the caller.)
 */
export function matchQuote(vol, text, locator) {
  const full = normalise(text);
  if (full.length < 3) return { cls: 'too-short' };
  const cited = citedPages(vol, locator);
  const frags = fragmentsOf(text);
  const parts = frags && frags.length ? frags : null;
  const verdict = (cls, extra = {}) => ({ cls, citedVia: cited.via, ...extra });
  const pageAt = (off) => vol.pages[vol.pageIndexAt(off)].p;

  // the pages a start may stand on: the cited ones (a ¶ may run over its page, so a ¶ cite also allows the next page)
  const on = new Set(cited.pages.flatMap((p) => (cited.via === 'para' ? [p, p + 1] : [p])));
  const run = new Set(cited.pages.flatMap((p) => [p, p + 1])); // a fragment after an ellipsis may run over to the next page

  const tries = [
    ['exact', 'flat', [needleOf('flat', text)], on, 0],
    ...(parts ? [['ellipsis', 'flat', parts.map((x) => needleOf('flat', x)), run, 0]] : []),
    ['scan', 'compact', [needleOf('compact', text)], on, MIN_LOOSE],
    ...(parts ? [['scan', 'compact', parts.map((x) => needleOf('compact', x)), run, MIN_LOOSE]] : []),
    ['scan', 'bridge-flat', [text], on, MIN_LOOSE],
    ...(parts ? [['scan', 'bridge-flat', parts, run, MIN_LOOSE]] : []),
    ['scan', 'bridge-notes', [text], on, MIN_LOOSE],
    ...(parts ? [['scan', 'bridge-notes', parts, run, MIN_LOOSE]] : []),
    ['scan', 'bridge-notes-compact', [text], on, MIN_LOOSE],
    ...(parts ? [['scan', 'bridge-notes-compact', parts, run, MIN_LOOSE]] : []),
    ['ending-only', 'flat', [trimEnd(needleOf('flat', text))], on, MIN_LOOSE],
    ['ending-only', 'compact', [trimEnd(needleOf('compact', text))], on, MIN_LOOSE],
    ...(parts ? [['ending-only', 'flat', trimLast(parts.map((x) => needleOf('flat', x))), run, MIN_LOOSE]] : []),
    ...(parts ? [['ending-only', 'compact', trimLast(parts.map((x) => needleOf('compact', x))), run, MIN_LOOSE]] : []),
    ['letters-only', 'skeleton', [needleOf('skeleton', text)], on, MIN_LOOSE],
    ...(parts ? [['letters-only', 'skeleton', parts.map((x) => needleOf('skeleton', x)), run, MIN_LOOSE]] : []),
  ];

  if (cited.via === null) {
    // no page named at all: say where the words stand, if anywhere
    for (const [cls, view, needles, , min] of tries) {
      if (view.startsWith('bridge-')) continue;
      if (needles.some((n) => n.length < Math.max(min, 3))) continue;
      const at = chain(vol, view, needles, null);
      if (at !== null) return verdict('no-locator', { foundPdf: pageAt(at), foundAs: cls });
    }
    return verdict('no-locator');
  }
  const unresolved = !cited.pages.length; // the cite names a page or ¶ this volume does not hold

  for (const [cls, view, needles, allowed, min] of tries) {
    if (unresolved) break;
    if (view.startsWith('bridge-')) {
      if (needles.reduce((n, x) => n + normalise(x).length, 0) < min) continue; // ellipsis fragments are each short; the whole must be long enough to name a place
      const kind = view.slice('bridge-'.length);
      const hit = bridged(vol, kind, needles, allowed);
      if (hit && (hit.crossed || kind !== 'flat')) {
        const base = kind === 'flat' ? 'page-break' : kind === 'notes' ? 'notes' : 'notes+spacing';
        return verdict('scan', { scanKind: hit.crossed && kind !== 'flat' ? `${base}+page-break` : base, ...(cited.via === 'printed' ? { pdfPages: cited.pages } : {}) });
      }
      continue;
    }
    if (needles.some((n) => n.length < Math.max(min, 3))) continue;
    if (chain(vol, view, needles, allowed) !== null) {
      // a printed-page cite holds the words but opens nothing
      return verdict(cited.via === 'printed' && (cls === 'exact' || cls === 'ellipsis') ? 'printed-only' : cls, cited.via === 'printed' ? { pdfPages: cited.pages } : {});
    }
  }

  // not on the cited pages: where else in the volume, and how far
  const nearest = (offs) => {
    let best = null;
    for (const o of offs) for (const c of cited.pages) { const d = Math.abs(pageAt(o) - c); if (best === null || d < best.d) best = { d, foundPdf: pageAt(o) }; }
    return best;
  };
  for (const [cls, view, needles, , min] of tries) {
    if (view.startsWith('bridge-')) continue;
    if (needles.some((n) => n.length < Math.max(min, 3))) continue;
    let offs;
    if (needles.length === 1) offs = allHits(vol, view, needles[0]);
    else { const at = chain(vol, view, needles, null); offs = at === null ? [] : [at]; }
    if (!offs.length) continue;
    if (unresolved) return verdict('locator-unresolved', { foundPdf: pageAt(offs[0]), foundAs: cls, missing: cited.missing });
    const n = nearest(offs);
    return verdict(n.d === 1 ? 'wrong-page-adjacent' : 'wrong-page-elsewhere', { foundPdf: n.foundPdf, delta: n.d, foundAs: cls });
  }
  return verdict('not-verbatim');
}

/** the pdf pages a printed-page locator stands for in a volume (so a fix can name the page) */
export function printedToPdf(vol, locator) {
  const { printed } = parseLocator(locator);
  return vol.pages.filter((pg) => pg.print !== null && printed.includes(String(pg.print))).map((pg) => pg.p);
}

// ---------------------------------------------------------------------------------------------------------------------
// records: every place the app presents a quotation
// ---------------------------------------------------------------------------------------------------------------------

/** Verdict classes that pass the gate. */
export const PASSING = new Set(['exact', 'ellipsis', 'scan']);

function workFromTitle(index, workTitle) {
  const lc = String(workTitle ?? '').toLowerCase();
  const hit = index.works.find((w) => lc && w.title.toLowerCase() === lc) ?? index.works.find((w) => lc.length > 6 && lc.includes(w.title.toLowerCase().split(':')[0].trim()) && w.title.split(':')[0].trim().length > 6);
  return hit ? hit.work : null;
}

function workFromCiteString(index, cite) {
  const cw = /\(?CW\s?(\d{1,2})(i{1,3}|ii|i)?\)?/i.exec(cite);
  if (cw) {
    const w = `cw${String(cw[1]).padStart(2, '0')}${(cw[2] ?? '').toLowerCase()}`;
    if (index.works.some((x) => x.work === w)) return w;
  }
  // a leading key names its volume's Work, or one of that Work's aliases (redbook → liber-novus)
  const lead = /^([a-z0-9-]+)\s/.exec(String(cite));
  if (lead && index.works.some((x) => x.work === lead[1] || (x.aliases ?? []).includes(lead[1]))) return lead[1];
  return workFromTitle(index, cite) ?? null;
}

/**
 * Walk the published datasets (public/data/*.json) and return every quotation-shaped record, each with its cites:
 *   { dataset, id, text, voice, cites: [{ work, locator }], shape }
 * `dataset` is the file ("depth.json"); field.json is split into "field.json#occurrences" and "field.json#definitions".
 * `id` is stable: an occurrence's own id, `family:<id>` / `archetype:<id>` / `theoretic:<id>` for a definition, else the
 * file and the JSON path. The generic walk is shape-driven; `unclassified` lists nodes that look like quotations
 * (a text with a cite beside it) but match no shape, so a new dataset cannot slip past the oracle unseen.
 */
export function collectRecords(dataDir, { index } = {}) {
  const idx = index ?? JSON.parse(fs.readFileSync(path.join(dataDir, 'corpus', 'index.json'), 'utf8'));
  const records = [];
  const unclassified = [];
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json') && !/^images/.test(f) && !['field.stats.json', 'sky.ties.json'].includes(f)).sort();
  for (const file of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    const add = (rec) => records.push(rec);

    if (file === 'field.json') {
      for (const o of doc.occurrences ?? []) {
        if (typeof o.quote !== 'string' || !o.quote) continue;
        if (o.quoteKind === 'paraphrase') continue; // demoted (curation/quote-fixes.json): labelled paraphrase, no longer presented as a quotation
        const cites = (o.jung ?? []).filter((c) => c.work).map((c) => ({ work: c.work, locator: c.locator ?? '' }));
        add({ dataset: 'field.json#occurrences', id: o.id, text: o.quote, voice: null, cites, shape: 'occurrence' });
      }
      for (const [kind, list] of [['family', doc.families], ['archetype', doc.archetypes], ['theoretic', doc.theoretics]]) {
        for (const x of list ?? []) {
          if (!x.definition?.text) continue;
          if (x.definition.quoteKind === 'paraphrase') continue; // demoted: labelled paraphrase
          const cite = String(x.definition.cite ?? '');
          const work = workFromCiteString(idx, cite);
          add({ dataset: 'field.json#definitions', id: `${kind}:${x.id}`, text: x.definition.text, voice: null, cites: work ? [{ work, locator: cite }] : [{ work: null, locator: cite }], shape: 'definition' });
        }
      }
      continue;
    }

    if (file === 'redbook.json') {
      // the Red Book's genesis words: shown as the words of the text, cited "redbook pdf pN"; the Red Book has no corpus volume
      for (const g of doc.genesis ?? []) {
        if (typeof g.words !== 'string') continue;
        const m = /^(\S+)\s+(.*)$/.exec(String(g.cite ?? ''));
        add({ dataset: file, id: `${file}#genesis.${g.id}`, text: g.words, voice: null, cites: [{ work: m ? m[1] : null, locator: m ? m[2] : String(g.cite ?? '') }], shape: 'genesis' });
      }
      continue;
    }

    const walk = (node, p) => {
      if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
      if (!node || typeof node !== 'object') return;
      const q = typeof node.text === 'string' ? node.text : typeof node.quote === 'string' ? node.quote : null;
      const id = `${file}#${p}`;
      let shaped = false;
      if (q !== null && node.cite && typeof node.cite === 'object' && node.cite.work && node.cite.locator) {
        add({ dataset: file, id, text: q, voice: node.voice ?? null, cites: [{ work: node.cite.work, locator: node.cite.locator }], shape: 'cite-object' });
        shaped = true;
      } else if (q !== null && node.cite && typeof node.cite === 'object' && node.cite.locator) {
        // a cite naming a work by title (dynamics.json's Van Eenwyk quotes)
        add({ dataset: file, id, text: q, voice: node.voice ?? null, cites: [{ work: workFromTitle(idx, node.cite.workTitle), locator: node.cite.locator }], shape: 'cite-title' });
        shaped = true;
      } else if (q !== null && typeof node.cite === 'string') {
        add({ dataset: file, id, text: q, voice: null, cites: [{ work: workFromCiteString(idx, node.cite), locator: node.cite }], shape: 'cite-string' });
        shaped = true;
      } else if (q !== null && node.work && node.locator) {
        add({ dataset: file, id, text: q, voice: node.voice ?? null, cites: [{ work: node.work, locator: node.locator }], shape: 'work-locator' });
        shaped = true;
      } else if (file === 'sky.json' && typeof node.text === 'string' && typeof node.page === 'number' && !node.cite && !node.work) {
        // the zodiac volume's quotations carry the pdf page and no work key
        add({ dataset: file, id, text: node.text, voice: 'Burt', cites: [{ work: 'burt-zodiac', locator: `pdf p${node.page}` }], shape: 'sky-burt' });
        shaped = true;
      }
      if (!shaped && q !== null && (node.cite !== undefined || node.locator !== undefined)) unclassified.push({ dataset: file, id });
      for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walk(v, p ? `${p}.${k}` : k);
    };
    walk(doc, '');
  }
  return { records, unclassified };
}

// ---------------------------------------------------------------------------------------------------------------------
// judging a record
// ---------------------------------------------------------------------------------------------------------------------

const BAD_ORDER = ['ending-only', 'letters-only', 'wrong-page-adjacent', 'wrong-page-elsewhere', 'printed-only', 'no-locator', 'locator-unresolved', 'not-verbatim', 'too-short', 'no-corpus'];

/**
 * Judge one record against the corpus. The gate is the PRIMARY cite (the first): the cite shown beside the quotation must
 * hold its words. When only a later cite of the same record holds them the verdict is `other-cite` (with `citeIndex`), a
 * failure with a one-line fix (promote that cite).
 */
export function judge(record, load) {
  const per = record.cites.map((c) => {
    if (!c.work) return { cls: 'no-corpus', work: null };
    const vol = load(c.work);
    if (!vol) return { cls: 'no-corpus', work: c.work };
    return { ...matchQuote(vol, record.text, c.locator), work: c.work };
  });
  if (!per.length) return { cls: 'no-cite', cite: null, per };
  const primary = per[0];
  if (PASSING.has(primary.cls)) return { ...primary, citeIndex: 0, cite: record.cites[0] };
  const other = per.findIndex((r, i) => i > 0 && PASSING.has(r.cls));
  if (other > 0) return { cls: 'other-cite', citeIndex: other, cite: record.cites[other], work: per[other].work, primaryCls: primary.cls, per };
  // the worst-informed failure is the primary's; a later cite that could say more (a corpus work) refines "no corpus"
  if (primary.cls === 'no-corpus') {
    const better = per.slice(1).filter((r) => r.cls !== 'no-corpus').sort((a, b) => BAD_ORDER.indexOf(a.cls) - BAD_ORDER.indexOf(b.cls))[0];
    if (better) return { ...better, cite: record.cites[per.indexOf(better)], citeIndex: per.indexOf(better), primaryCls: 'no-corpus', per };
  }
  return { ...primary, citeIndex: 0, cite: record.cites[0], per };
}

/** Run the whole oracle over a data directory. */
export function runOracle(dataDir, { exceptions = [], only } = {}) {
  const load = corpusLoader(path.join(dataDir, 'corpus'));
  const { records, unclassified } = collectRecords(dataDir, { index: load.index() });
  const excepted = new Map(exceptions.map((e) => [`${e.dataset}\u0000${e.id}`, e]));
  const results = [];
  for (const rec of records) {
    if (only && !only(rec)) continue;
    const j = judge(rec, load);
    const pass = PASSING.has(j.cls);
    const exc = !pass ? excepted.get(`${rec.dataset}\u0000${rec.id}`) : undefined;
    results.push({
      dataset: rec.dataset,
      id: rec.id,
      shape: rec.shape,
      pass,
      cls: j.cls,
      ...(j.primaryCls ? { primaryCls: j.primaryCls } : {}),
      citeIndex: j.citeIndex ?? null,
      work: rec.cites[0]?.work ?? null,
      locator: rec.cites[0]?.locator ?? null,
      ...(j.foundPdf !== undefined ? { foundPdf: j.foundPdf } : {}),
      ...(j.delta !== undefined ? { delta: j.delta } : {}),
      ...(j.foundAs ? { foundAs: j.foundAs } : {}),
      ...(exc ? { excepted: exc.reason } : {}),
      text: rec.text.length > 160 ? `${rec.text.slice(0, 157)}...` : rec.text,
    });
  }
  const used = new Set(results.filter((r) => r.excepted !== undefined).map((r) => `${r.dataset}\u0000${r.id}`));
  const stale = exceptions.filter((e) => !used.has(`${e.dataset}\u0000${e.id}`));
  return { results, unclassified, stale };
}

/** Per-dataset table: records, passes, and a count per failing class. */
export function tabulate(results) {
  const by = new Map();
  for (const r of results) {
    const t = by.get(r.dataset) ?? { dataset: r.dataset, records: 0, pass: 0, exact: 0, ellipsis: 0, scan: 0, fail: {} };
    t.records++;
    if (r.pass) { t.pass++; t[r.cls]++; } else t.fail[r.cls] = (t.fail[r.cls] ?? 0) + 1;
    by.set(r.dataset, t);
  }
  return [...by.values()].sort((a, b) => a.dataset.localeCompare(b.dataset));
}
