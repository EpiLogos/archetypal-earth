// Aion, the book: curation/aion/book.json → public/data/aionbook.json. A walk through CW9ii chapter by chapter, the way
// the Red Book mode walks Liber Novus: each chapter's quotations are placed in the read-only corpus by
// scripts/lib/cite.mjs (which writes the locator from the corpus; one it cannot place fails the build), and each chapter
// is linked to the events of the authored Aion readings whose own passages cite that chapter's paragraphs (derived from
// public/data/history.json and the corpus's chapter pages, never typed).
//   npm run aionbook | npm run aionbook:check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

export function buildAionBook({ root = ROOT, vault = DEFAULT_VAULT } = {}) {
  const cur = read('curation', 'aion', 'book.json');
  const field = read('public', 'data', 'field.json');
  const history = read('public', 'data', 'history.json');
  const load = workLoader(vault);
  const titles = workTitles(root);
  const errors = [];
  const warnings = [];
  const ok = { archetype: new Set(field.archetypes.map((a) => a.id)), family: new Set(field.families.map((f) => f.id)) };

  const chapters = cur.chapters.map((c) => {
    for (const s of c.subjects) if (!ok[s.type]?.has(s.id)) errors.push(`${c.id}: no ${s.type} ${s.id} in the field`);
    const quotes = citeQuotes(load, titles, c.quotes.map((q) => ({ work: cur.work, quote: q })), `aion-book ${c.id}`, errors, warnings);
    return { id: c.id, n: c.n, title: c.title, line: c.line, subjects: c.subjects, quotes };
  });

  // each chapter's span of pdf pages, from its own heading in the corpus ("## VI THE SIGN OF THE FISHES") to the next
  // chapter's; an event of the authored readings belongs to every chapter one of its cw09ii passages falls in
  const corpus = load(cur.work);
  const pageAt = (at) => { let best = null; for (const p of corpus.pages) { if (p.at <= at) best = p.page; else break; } return best; };
  const start = chapters.map((c) => {
    const head = `## ${c.id === 'foreword' ? '' : `${c.n} `}${c.title.toUpperCase()}`;
    const at = [`${head} `, `${head}\n`].map((h) => corpus.text.indexOf(h)).find((a) => a >= 0) ?? -1;
    if (at < 0) { errors.push(`${c.id}: no heading "${head}" in the corpus`); return NaN; }
    return pageAt(at);
  });
  const PAGE = /pdf p(\d+)/;
  chapters.forEach((c, i) => {
    c.pages = [start[i], (start[i + 1] ?? Infinity) - 1];
    if (c.pages[1] === Infinity) c.pages[1] = null;
    const seen = new Set();
    c.events = [];
    for (const r of history.readings) for (const e of r.events) {
      const hit = (e.passages ?? []).some((p) => { const n = Number(PAGE.exec(p.locator)?.[1]); return p.work === cur.work && n >= start[i] && n < (start[i + 1] ?? Infinity); });
      if (hit && !seen.has(`${r.id}:${e.id}`)) { seen.add(`${r.id}:${e.id}`); c.events.push({ reading: r.id, readingTitle: r.title, id: e.id, name: e.name, yearDisplay: e.yearDisplay }); }
    }
    for (const q of c.quotes) { const n = Number(PAGE.exec(q.cite.locator)?.[1]); if (!(n >= start[i] && n < (start[i + 1] ?? Infinity))) errors.push(`${c.id}: "${q.text?.slice(0, 50) ?? ''}" stands at ${q.cite.locator}, outside the chapter (pdf p${start[i]}–)`); }
  });
  return { data: { version: 1, work: cur.work, title: cur.title, line: cur.line, chapters }, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { data, errors, warnings } = buildAionBook();
  for (const w of warnings) console.warn(`note: ${w}`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const out = path.join(ROOT, 'public', 'data', 'aionbook.json');
  const text = `${JSON.stringify(data, null, 1)}\n`;
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { console.error('public/data/aionbook.json differs from what the vault gives now: run npm run aionbook'); process.exit(1); }
    console.log('aionbook: verified');
  } else {
    fs.writeFileSync(out, text);
    const q = data.chapters.reduce((n, c) => n + c.quotes.length, 0);
    const ev = data.chapters.reduce((n, c) => n + c.events.length, 0);
    console.log(`aionbook: ${data.chapters.length} chapters, ${q} quotations placed, ${ev} links to the readings' events`);
  }
}
