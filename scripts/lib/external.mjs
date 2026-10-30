// Works the vault keeps outside corpus/, read in the corpus's own shape. Two places hold their page files, one file per pdf
// page (NNN is the pdf page):
//   - `_raw-ext/<work>/pages/NNN.txt` (the default; Van Eenwyk, Crowley): NNN counts from 0 at the cover, as the vault's own
//     figure manifest counts it. The vault reads them as an external lens.
//   - a register entry's `source` (curation/external.json), e.g. `_raw/redbook/pages` for Liber Novus: NNN is the pdf page,
//     and the entry's `pdf` range names the pages the volume holds. A pdf page in that range with no file has no text layer:
//     it is kept, empty, flagged `noText`. Its printed page is the pdf page less the entry's `printOffset`.
// This module gives every one the corpus's own shape — the same markdown with page markers — so the citation locator, the
// corpus index and the dynamics rail read them exactly as they read a corpus volume. Nothing is written to the vault.
//
// A page's running head ("44 Chaos", "The Shadow Side of Symbols 89", a bare "112", a title line over "29", or a bare
// number at the foot of a chapter opening) is taken out of the text and kept as the page's printed label; whether a label is shown
// is decided later by its agreement with its neighbours (cite.mjs trustedPrint), never here. A volume with a `printOffset`
// takes its labels from the offset instead, and takes out only the Red Book's own running heads ("194 I LIBER NOVUS").
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { trustedPrint } from './cite.mjs';

/** The site's register of external works: key → title, the vault note that describes the book, and where its pages sit. */
export function externalRegister(root) {
  const file = path.join(root, 'curation', 'external.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).works ?? {} : {};
}

/** The directory of a work's page files: the register entry's `source` (vault-relative), else `_raw-ext/<work>/pages`. */
export function externalDir(vault, work, entry = {}) {
  return path.join(vault, entry.source ?? path.join('_raw-ext', work, 'pages'));
}

/** The page files in pdf order, or null when the work has none. */
export function externalFiles(vault, work, entry = {}) {
  const dir = externalDir(vault, work, entry);
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).filter((f) => /^\d+\.txt$/.test(f)).sort((a, b) => Number(a.slice(0, -4)) - Number(b.slice(0, -4)));
}

const NUM = /^\s*(\d{1,3})\s*$/;
const HEAD_LEAD = /^(\d{1,3})\s+(\S.{0,58})$/;
const HEAD_TRAIL = /^(\S.{0,58}?)\s+(\d{1,3})$/;

// The Red Book's running heads, as the OCR reads them: "194 I LIBER NOVUS", "2IO I LIBER NOVUS", "234 , LIBER PRIMUS fol. ii(v) / iii(r)",
// "260 I LIBER SECUNDUS 3/6", "RESOLUTION I 255", "224 I" (the head's title lost), "336 I SCRUTINIES", and a lone "Scrutinies".
const RED_BOOK_HEAD = [
  /^\s*[0-9IlOoSB]{1,4}\s*[,.]?\s*I?\s+(?:LIBER|SCRUTINIES)\b.*$/,
  /^\s*\d{3}\s+I\s*$/,
  /^\s*RESOLUTION\s+I\s+\d{1,3}\s*$/,
  /^\s*Scrutinies\s*$/,
];

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

/** A page's text with the Red Book's running head (its first line, when it is one) taken out. */
export function stripRedBookHead(raw) {
  const lines = raw.replace(/\r/g, '').split('\n');
  const i = lines.findIndex((l) => l.trim() !== '');
  if (i >= 0 && RED_BOOK_HEAD.some((re) => re.test(lines[i]))) lines.splice(i, 1);
  return lines.join('\n').trim();
}

/**
 * The work as corpus markdown: a front matter carrying its title, then `<!-- work · pdf pN · print pM -->` pages. A register
 * entry with a `pdf` range is read by its own rule (fixedOffsetMarkdown); any other by the running heads (splitHead).
 */
export function externalMarkdown(vault, work, title, entry = {}) {
  if (Array.isArray(entry.pdf)) return fixedOffsetMarkdown(vault, work, title, entry);
  const files = externalFiles(vault, work, entry);
  if (!files) return null;
  const source = entry.source ?? `_raw-ext/${work}/pages`;
  const out = ['---', JSON.stringify({ vol: work, title: title ?? work, source, tier: 'external' }, null, 1), '---', ''];
  const pages = files.map((f) => ({ page: Number(f.slice(0, -4)), ...splitHead(fs.readFileSync(path.join(externalDir(vault, work, entry), f), 'utf8')) }));
  // a running head's number is written as the printed page only where it agrees with its neighbours
  const probe = { pages: pages.map((p) => ({ page: p.page, print: p.print })) };
  pages.forEach((p, i) => {
    const print = trustedPrint(probe, i);
    out.push(`<!-- ${work} · pdf p${p.page}${print ? ` · print p${print}` : ''} -->`, '', p.text, '');
  });
  return out.join('\n');
}

/**
 * A volume whose pages are one file per pdf page in `pdf` = [from, to]: every pdf page of the range is present. The printed
 * label is the pdf page less `printOffset` (the Red Book: its running heads read pdf − 31 wherever they are legible, checked
 * against the 30 Oct recon's samples and the heads of the pages built here). A page with no file carries no text layer: it is kept empty and
 * marked `· no text layer` in its marker, so the corpus reader can say why it is empty.
 */
function fixedOffsetMarkdown(vault, work, title, entry) {
  const files = externalFiles(vault, work, entry);
  if (!files) return null;
  const [from, to] = entry.pdf;
  const byPage = new Map(files.map((f) => [Number(f.slice(0, -4)), f]));
  const dir = externalDir(vault, work, entry);
  const out = ['---', JSON.stringify({ vol: work, title: title ?? work, source: entry.source, tier: 'external' }, null, 1), '---', ''];
  for (let p = from; p <= to; p++) {
    const f = byPage.get(p);
    const text = f ? stripRedBookHead(fs.readFileSync(path.join(dir, f), 'utf8')) : '';
    const print = entry.printOffset !== undefined ? p - entry.printOffset : null;
    out.push(`<!-- ${work} · pdf p${p}${print ? ` · print p${print}` : ''}${f ? '' : ' · no text layer'} -->`, '', text, '');
  }
  return out.join('\n');
}

/** The digest of the work's page files, in pdf order (the dynamics rail pins a source by it). */
export function externalDigest(vault, work, entry = {}) {
  const files = externalFiles(vault, work, entry);
  if (!files) return null;
  const h = createHash('sha256');
  for (const f of files) h.update(fs.readFileSync(path.join(externalDir(vault, work, entry), f)));
  return h.digest('hex');
}
