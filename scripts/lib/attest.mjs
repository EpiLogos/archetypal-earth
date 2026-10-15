// Attestations: the occurrences of the families curation admits on its own (synthesised families with a reading page).
//
// A family the vault has no note for — a sign, a decan, a sephira, a card of the deck, an element, a function — used to
// reach the field as a node with no occurrence at all, and the interface described the absence. The plan (D7, E3, A2)
// said they are attested: Crowley's description of the card, Burt's chapter of the sign, Jung's passages on the element.
// Each is one occurrence per family per work, built here from the page the family already carries, and from nothing else:
//   quote    one placed quotation of the page, verbatim, chosen by a fixed rule (the longest under 280 characters that is
//            not a bare heading or plate caption; failing that, the shortest);
//   body     the lines of the page's sections that hold that work's quotations;
//   cite     the work, the pages as the cite rail printed them;
//   date     the work's own (Jung's volumes by the field's cites; the others from curation/works.json);
//   sky      where lib/sky-address.mjs puts the family, when it puts it anywhere;
//   Earth    only for the Aces and Princesses, and only the region Crowley names (curation/sky/earth.json).
// Nothing here is typed that a source did not say, and nothing is invented to fill a node: a family with no page has no
// attestation and is a finding for the gate, not something to dress.

const LAST = /\d{4}|\d{2}/g;

/** The last year a Jung cite-year string names: "1943-54" → 1954, "1911–12/1952" → 1952, "1936/44" → 1944. */
export function lastYear(s) {
  const toks = String(s).match(LAST) ?? [];
  let century = null;
  let last = null;
  let first = null;
  for (const t of toks) {
    let y;
    if (t.length === 4) { y = Number(t); century = Math.floor(y / 100) * 100; }
    else if (century !== null) { y = century + Number(t); }
    else continue;
    if (first === null) first = y;
    last = y;
  }
  return last === null ? null : { year: last, from: first };
}

/**
 * work key → { year, display, range?, voice? }. Jung's volumes by the field's own cites (the modal year string a volume
 * is cited under, its last year representing it; the span of all its cite years as the range); every other work from
 * curation/works.json, which wins where it names a work.
 */
export function workDates(occurrences, curated) {
  const strings = new Map();
  for (const o of occurrences) {
    for (const c of o.jung ?? []) {
      if (!c.work || !c.year) continue;
      const m = strings.get(c.work) ?? new Map();
      m.set(c.year, (m.get(c.year) ?? 0) + 1);
      strings.set(c.work, m);
    }
  }
  const out = new Map();
  for (const [work, m] of strings) {
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]));
    const modal = ranked[0][0];
    const y = lastYear(modal);
    if (!y) continue;
    const all = [...m.keys()].map(lastYear).filter(Boolean);
    const lo = Math.min(...all.map((x) => x.from));
    const hi = Math.max(...all.map((x) => x.year));
    out.set(work, { year: y.year, display: modal.replace(/-/g, '–'), ...(lo < hi ? { range: [lo, hi] } : {}) });
  }
  for (const [work, w] of Object.entries(curated?.works ?? {})) {
    const have = out.get(work);
    if (w.year !== undefined) out.set(work, { year: w.year, display: String(w.display ?? w.year), ...(w.voice ? { voice: w.voice } : {}) });
    else if (have && w.voice) out.set(work, { ...have, voice: w.voice });
  }
  return out;
}

/** "Psychology and Alchemy (CW12)" → "Psychology and Alchemy"; "The Book of Thoth: A Short Essay…" → "The Book of Thoth". */
export function shortWork(title) {
  return String(title ?? '').replace(/\s*\([^)]*\)\s*$/, '').split(':')[0].trim();
}

const LOWER = /[a-z]/;
const BARE = /^[A-Z0-9 ,.'’:;()\-–—·]+$/;

/**
 * A quotation that reads whole: it opens on a capital or an opening quote (not a parenthesis, not mid-sentence), its
 * quotation marks pair, and the scan has not stacked them ("system’”’;”"). The cite rail keeps the corpus's words exactly,
 * so a damaged one is passed over for a clean one when the page has both, never repaired.
 */
export function reads(text) {
  if (!/^[A-Z“"‘']/.test(text.trim())) return false;
  if (/[”’“‘"']{3,}/.test(text)) return false;
  const open = (text.match(/[“‘]/g) || []).length;
  const close = (text.match(/[”’]/g) || []).length;
  const straight = (text.match(/"/g) || []).length;
  // an apostrophe is a ’ too: only a closing mark in excess of what was opened counts as a stray
  if (straight % 2) return false;
  return close - open <= (text.match(/\w’\w/g) || []).length + (text.match(/s’(?!\w)/g) || []).length;
}

/** One placed quotation to stand for a work on a family: see the file's head for the rule. */
export function chooseQuote(quotes) {
  const real = quotes.filter((q) => !q.caption && !BARE.test(q.text) && LOWER.test(q.text));
  const base = real.length ? real : quotes;
  const clean = base.filter((q) => reads(q.text));
  const pool = clean.length ? clean : base;
  const fit = pool.filter((q) => q.text.length <= 280);
  if (fit.length) return fit.slice().sort((a, b) => b.text.length - a.text.length)[0];
  return pool.slice().sort((a, b) => a.text.length - b.text.length)[0];
}

/**
 * The distinct locators of a work's quotes as one line: the displayed quotation's own first (it stands on that page, so the
 * cite never names pages it is not on), then the rest of the page's in page order, at most six in all.
 */
export function locatorLine(quotes, chosen) {
  const seen = [];
  const add = (l) => { if (l && !seen.includes(l)) seen.push(l); };
  add(chosen?.cite?.locator);
  for (const q of quotes) add(q.cite?.locator);
  return seen.slice(0, 6).join('; ');
}

/**
 * The attestations of a field page set. `pages` = field-pages data (`pages` keyed `family:<id>`, sections of placed
 * quotes); `include(id)` says which families are attested (the synthesised ones); `loci(id)` their sky placement;
 * `earthOf(id)` { place, quote, pole } for an Ace or Princess; `dates` from workDates.
 */
export function buildAttestations({ pages, include, loci, earthOf, dates, titleOf, familyName }) {
  const out = [];
  const missing = [];
  for (const [key, page] of Object.entries(pages).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!key.startsWith('family:')) continue;
    const id = key.slice('family:'.length);
    if (!include(id)) continue;
    const byWork = new Map();
    for (const s of page.sections) {
      for (const q of s.quotes) {
        const w = q.cite?.work;
        if (!w) continue;
        if (!byWork.has(w)) byWork.set(w, { quotes: [], lines: [] });
        const g = byWork.get(w);
        g.quotes.push(q);
        if (s.line && !g.lines.includes(s.line)) g.lines.push(s.line);
      }
    }
    if (!byWork.size) { missing.push(id); continue; }
    const earth = earthOf?.(id) ?? null;
    for (const [work, g] of [...byWork.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const d = dates.get(work);
      if (!d) { missing.push(`${id}: no date for ${work}`); continue; }
      const q = chooseQuote(g.quotes);
      const body = g.lines.slice(0, 3);
      const locator = locatorLine(g.quotes, q);
      const cite = { work, workTitle: titleOf(work), year: d.display, locator };
      // whose words the displayed quotation is: its own voice when it is not Jung's (a letter of Pauli's in the
      // correspondence), else the work's
      const voice = q.voice && q.voice !== 'Jung' ? q.voice : d.voice;
      if (voice) cite.voice = voice;
      const a = {
        id: `${id}-in-${work}`,
        familyId: id,
        work,
        title: `${familyName(id)} — ${shortWork(titleOf(work))}`,
        year: d.year,
        yearDisplay: d.display,
        ...(d.range ? { yearRange: d.range } : {}),
        quote: q.text,
        ...(q.caption ? { caption: true } : {}),
        body,
        jung: [cite],
        sky: loci(id) ?? [],
      };
      // Crowley's own region for an Ace or a Princess rides on the work that says it
      if (earth && voice === 'Crowley') {
        a.place = earth.place;
        a.body = [...body, `Crowley, pdf p${earth.page}: “${earth.quote}”`, ...(earth.pole ? [`Crowley, pdf p${earth.page}: “${earth.pole}”`] : [])];
        const at = `pdf p${earth.page}`;
        if (!locator.split('; ').includes(at)) cite.locator = [locator, at].filter(Boolean).join('; ');
      }
      out.push(a);
    }
  }
  return { attestations: out, missing };
}
