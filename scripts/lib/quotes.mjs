// Shared by the lens generators: turn curated { work, quote, para? } into published cites, placed by the corpus itself.
import fs from 'node:fs';
import path from 'node:path';
import { locate } from './cite.mjs';

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
 * does not support.
 */
export function citeQuotes(load, titles, quotes, where, errors, warnings) {
  const out = [];
  for (const q of quotes) {
    const r = locate(load, q.work, q.quote, { para: q.para, page: q.page });
    if (r.error) { errors.push(`${where}: ${r.error}`); continue; }
    let locator = r.locator;
    if (r.warning) { warnings.push(`${where}: ${r.warning}`); locator = `pdf p${r.page}`; }
    // the corpus's printed-page labels are not trusted for display (some are paragraph numbers the scan misread as
    // folios): the pdf page is the locator, and the passage sheet shows the page itself
    out.push({ text: q.quote, cite: { work: q.work, workTitle: titles.get(q.work) ?? q.work, locator }, ...(q.voice ? { voice: q.voice } : {}) });
  }
  return out;
}
