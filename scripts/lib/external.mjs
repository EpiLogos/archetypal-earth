// Works the vault keeps outside corpus/: `_raw-ext/<work>/pages/NNN.txt`, one file per pdf page (NNN is the pdf page,
// counted from 0 at the cover, as the vault's own figure manifest counts it). The vault reads them as an external lens
// (Van Eenwyk). This module gives them the corpus's own shape — the same markdown with page markers — so the citation
// locator, the corpus index and the dynamics rail read them exactly as they read a corpus volume. Nothing is written
// to the vault.
//
// A page's running head ("44 Chaos", "The Shadow Side of Symbols 89", a bare "112", a title line over "29", or a bare
// number at the foot of a chapter opening) is taken out of the text and kept as the page's printed label; whether a label is shown
// is decided later by its agreement with its neighbours (cite.mjs trustedPrint), never here.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { trustedPrint } from './cite.mjs';

/** The site's register of external works: key → title and the vault note that describes the book. */
export function externalRegister(root) {
  const file = path.join(root, 'curation', 'external.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).works ?? {} : {};
}

export function externalDir(vault, work) {
  return path.join(vault, '_raw-ext', work, 'pages');
}

/** The page files in pdf order, or null when the work has none. */
export function externalFiles(vault, work) {
  const dir = externalDir(vault, work);
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).filter((f) => /^\d+\.txt$/.test(f)).sort((a, b) => Number(a.slice(0, -4)) - Number(b.slice(0, -4)));
}

const NUM = /^\s*(\d{1,3})\s*$/;
const HEAD_LEAD = /^(\d{1,3})\s+(\S.{0,58})$/;
const HEAD_TRAIL = /^(\S.{0,58}?)\s+(\d{1,3})$/;

/** One page's text with its running head taken out, and the printed label the head carried (or null). */
export function splitHead(raw) {
  const lines = raw.replace(/\r/g, '').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  let print = null;
  const first = (lines[0] ?? '').trim();
  const second = (lines[1] ?? '').trim();
  let m;
  if ((m = NUM.exec(first))) { print = m[1]; lines.shift(); }
  else if ((m = HEAD_LEAD.exec(first)) && !/[.;:,]$/.test(first)) { print = m[1]; lines.shift(); }
  else if ((m = HEAD_TRAIL.exec(first)) && !/[.;:,]\s*\d+$/.test(first) && !/^(appendix|chapter|part|plate|figure)\s+\d+$/i.test(first)) { print = m[2]; lines.shift(); }
  else if (first && first.length <= 60 && (m = NUM.exec(second))) { print = m[1]; lines.splice(1, 1); }
  else if (lines.length > 1 && (m = NUM.exec(lines[lines.length - 1]))) { print = m[1]; lines.pop(); }
  return { text: lines.join('\n').trim(), print };
}

/** The work as corpus markdown: a front matter carrying its title, then `<!-- work · pdf pN · print pM -->` pages. */
export function externalMarkdown(vault, work, title) {
  const files = externalFiles(vault, work);
  if (!files) return null;
  const out = ['---', JSON.stringify({ vol: work, title: title ?? work, source: `_raw-ext/${work}/pages`, tier: 'external' }, null, 1), '---', ''];
  const pages = files.map((f) => ({ page: Number(f.slice(0, -4)), ...splitHead(fs.readFileSync(path.join(externalDir(vault, work), f), 'utf8')) }));
  // a running head's number is written as the printed page only where it agrees with its neighbours
  const probe = { pages: pages.map((p) => ({ page: p.page, print: p.print })) };
  pages.forEach((p, i) => {
    const print = trustedPrint(probe, i);
    out.push(`<!-- ${work} · pdf p${p.page}${print ? ` · print p${print}` : ''} -->`, '', p.text, '');
  });
  return out.join('\n');
}

/** The digest of the work's page files, in pdf order (the dynamics rail pins a source by it). */
export function externalDigest(vault, work) {
  const files = externalFiles(vault, work);
  if (!files) return null;
  const h = createHash('sha256');
  for (const f of files) h.update(fs.readFileSync(path.join(externalDir(vault, work), f)));
  return h.digest('hex');
}
