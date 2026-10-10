// vault corpus/*.md -> public/data/corpus/{index.json,<work>}.json
//
// The vault's normalized volumes are read-only; this turns them into the
// structured passage index the site serves for citation deep links —
// "cw12 ¶452 (pdf p350)" must open the actual passage. Layout per work:
//   chapters : the ## headings, with their page and offset into that page [optional]
//   pages    : full page text, keyed by pdf page (print label kept)
//   paras    : ¶ anchors as spans (off/len) into their page's text
// Offsets index into the page text itself, so no passage text is stored twice.
// The vault's own citation spine (data/paragraphs.jsonl) is used as a check,
// never as a source: spans come from the corpus files alone.
import fs from 'node:fs';
import path from 'node:path';
import { trustedPrint } from './cite.mjs';
import { externalMarkdown } from './external.mjs';

const PAGE_RE = /^<!--\s*([\w-]+)\s*·\s*pdf p(\d+)(?:\s*·\s*print p([^\s>]+))?\s*-->\s*$/;
const PARA_RE = /\*\*¶(\d+)\*\*/g;
const slug = (s) => s
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'chapter';

/** Work key → the title in each corpus file's own front matter (the manifest does not list every work). */
export function corpusTitles(vault) {
  const dir = path.join(vault, 'corpus');
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const fd = fs.openSync(path.join(dir, f), 'r');
    const buf = Buffer.alloc(4096);
    const head = buf.subarray(0, fs.readSync(fd, buf, 0, 4096, 0)).toString('utf8');
    fs.closeSync(fd);
    const t = /^\s*"title"\s*:\s*"((?:[^"\\]|\\.)+)"/m.exec(head);
    if (t) out[f.replace(/\.md$/, '')] = JSON.parse(`"${t[1]}"`);
  }
  return out;
}

/** Parse one volume's markdown into { title, chapters, pages, paras }. */
export function parseCorpusMarkdown(work, raw) {
  const lines = raw.split('\n');
  const chapters = [];
  const pages = [];
  let title = '';
  let cur = null; // { p, print, ch, lines: [] }
  const closePage = () => {
    if (!cur) return;
    const text = cur.lines.join('\n').replace(/\s+$/, '');
    pages.push({ p: cur.p, ...(cur.print ? { print: cur.print } : {}), ...(cur.ch ? { ch: cur.ch } : {}), text });
    cur = null;
  };
  for (const line of lines) {
    const m = line.match(PAGE_RE);
    if (m && m[1] === work) {
      closePage();
      cur = { p: Number(m[2]), print: m[3] || null, ch: chapters.length ? chapters[chapters.length - 1].id : null, lines: [] };
      continue;
    }
    if (!cur) { // anything before the first page marker: the file's front matter, whose title is the work's own
      const t = !title && /^\s*"title"\s*:\s*"((?:[^"\\]|\\.)+)"/.exec(line);
      if (t) title = JSON.parse(`"${t[1]}"`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const dup = chapters.filter((c) => c.id === slug(heading[2])).length;
      const id0 = slug(heading[2]);
      const id = dup ? `${id0}-${dup + 1}` : id0;
      // a chapter starts mid-page: the page keeps the chapter it opened with,
      // the heading's exact spot is recorded for the passage view
      const off = cur.lines.join('\n').length + (cur.lines.length ? 1 : 0);
      chapters.push({ id, title: heading[2], p: cur.p, off });
      cur.chPending = id;
      continue;
    }
    if (cur.chPending) { cur.ch = cur.chPending; cur.chPending = null; }
    cur.lines.push(line);
  }
  closePage();
  // ¶ anchors as spans into their own page text
  const paras = [];
  for (const pg of pages) {
    const marks = [...pg.text.matchAll(PARA_RE)].map((m) => ({ para: Number(m[1]), off: m.index }));
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].off : pg.text.length;
      let len = end - mk.off;
      while (len > 0 && /\s/.test(pg.text[mk.off + len - 1])) len--;
      paras.push({ para: mk.para, p: pg.p, off: mk.off, len });
    });
  }
  paras.sort((a, b) => a.p - b.p || a.off - b.off);
  return { title, chapters, pages, paras };
}

/** Compare the built index against the vault's citation spine. Differences are reported, not repaired. */
export function checkAgainstSpine(built, spineLines, log) {
  let checked = 0;
  const missing = [];
  for (const line of spineLines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const b = built.get(rec.vol);
    if (!b || rec.para == null) continue;
    checked++;
    const at = b.paras.some((p) => p.para === rec.para && Math.abs(p.p - rec.pdf_page) <= 1);
    if (!at) missing.push(`${rec.vol} ¶${rec.para} (spine pdf p${rec.pdf_page})`);
  }
  log(`citation spine: ${checked} entries cross-checked, ${missing.length} not found at their cited page`);
  if (missing.length) log(`  (first few) ${missing.slice(0, 8).join(' · ')}`);
  return { checked, missing: missing.length };
}

/** Build every volume and write public/data/corpus/. Returns the summary for stats. */
export function buildCorpusIndex({ vault, outDir, manifest = [], spineLines = [], externals = {}, log = () => {} }) {
  const srcDir = path.join(vault, 'corpus');
  if (!fs.existsSync(srcDir)) throw new Error(`no corpus at ${srcDir}`);
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md')).sort();
  const titles = Object.fromEntries(manifest.map((m) => [m.vol, m.title]));
  fs.mkdirSync(outDir, { recursive: true });
  const works = [];
  const built = new Map();
  // the corpus volumes, then the works the vault keeps outside corpus/ (external.mjs), read in the same shape
  const sources = [
    ...files.map((f) => ({ work: f.replace(/\.md$/, ''), read: () => fs.readFileSync(path.join(srcDir, f), 'utf8') })),
    ...Object.entries(externals).filter(([w]) => !files.includes(`${w}.md`)).map(([work, x]) => ({ work, read: () => externalMarkdown(vault, work, x.title) })),
  ];
  for (const { work, read } of sources) {
    const raw = read();
    if (raw === null) { log(`corpus ${work}: no pages in the vault (skipped)`); continue; }
    const parsed = parseCorpusMarkdown(work, raw);
    // a printed page is kept only where the scan's label agrees with its neighbours (cite.mjs trustedPrint)
    const probe = { pages: parsed.pages.map((pg) => ({ page: pg.p, print: pg.print ?? null })) };
    parsed.pages = parsed.pages.map((pg, i) => {
      const keep = trustedPrint(probe, i);
      const { print, ...rest } = pg;
      return keep ? { ...rest, print: keep } : rest;
    });
    const doc = {
      work,
      title: titles[work] || parsed.title || work,
      chapters: parsed.chapters,
      pages: parsed.pages,
      paras: parsed.paras,
    };
    fs.writeFileSync(path.join(outDir, `${work}.json`), JSON.stringify(doc));
    built.set(work, parsed);
    works.push({ work, title: doc.title, file: `${work}.json`, pages: parsed.pages.length, paras: parsed.paras.length, chapters: parsed.chapters.length });
    log(`corpus ${work}: ${parsed.pages.length} pages, ${parsed.paras.length} ¶ anchors, ${parsed.chapters.length} chapters`);
  }
  const index = { generatedAt: new Date().toISOString(), vaultPath: vault, works };
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
  const spine = spineLines.length ? checkAgainstSpine(built, spineLines, log) : null;
  return { works: works.length, pages: works.reduce((s, w) => s + w.pages, 0), paras: works.reduce((s, w) => s + w.paras, 0), spine };
}
