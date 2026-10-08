// Generate the distinct Book of Symbols layer from reviewed paraphrases and the actual PDF.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = new Map();
const HASH = /^[a-f0-9]{64}$/;
export const normalizePage = (text) => text.replace(/\s+/gu, ' ').trim();
const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');

export function loadSymbolsCuration(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, 'curation/symbols/book-of-symbols.json'), 'utf8'));
}

/** Validate source metadata, substantive notes, exact page pairs and all live field links. */
export function validateSymbols(symbols, { field } = {}) {
  const errors = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  const nonempty = (value) => typeof value === 'string' && !!value.trim();
  const list = (value, where) => {
    if (!Array.isArray(value)) { fail(where, 'expected array'); return []; }
    return value;
  };
  if (!symbols || typeof symbols !== 'object') return ['symbols: expected object'];
  for (const key of ['id', 'title', 'editor', 'sourcePath']) if (!nonempty(symbols.source?.[key])) fail('source', `missing ${key}`);
  const source = symbols.source || {};
  if (!Number.isInteger(source.year) || source.year < 1) fail('source', 'invalid publication year');
  if (!HASH.test(source.sha256 || '')) fail('source', 'missing source revision hash');
  if (!Number.isInteger(source.pageCount) || source.pageCount < 1) fail('source', 'invalid PDF page count');
  const known = field ? new Set(field.families.map((f) => f.id)) : null;
  const seen = new Set();
  const entries = list(symbols.entries, 'entries');
  if (!entries.length) fail('entries', 'missing source notes');
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') { fail('entry', 'expected object'); continue; }
    const where = entry.familyId || 'entry';
    if (!nonempty(entry.familyId) || (known && !known.has(entry.familyId))) fail(where, 'unresolved family');
    if (seen.has(entry.familyId)) fail(where, 'duplicate family');
    seen.add(entry.familyId);
    if (!nonempty(entry.title)) fail(where, 'missing source entry title');
    const pages = list(entry.pages, `${where}.pages`);
    const pdfPages = list(entry.pdfPages, `${where}.pdfPages`);
    if (!pages.length || pages.length !== pdfPages.length) fail(where, 'printed/PDF page pairs incomplete');
    for (let i = 0; i < pages.length; i++) {
      if (!Number.isInteger(pages[i]) || pages[i] < 1 || pages[i] > source.pageCount - 4) fail(where, 'printed page outside source');
      if (!Number.isInteger(pdfPages[i]) || pdfPages[i] < 1 || pdfPages[i] > source.pageCount) fail(where, 'PDF page outside source');
      // This pinned edition has four preliminary scans. Missing 82–83 are not cited.
      if (pdfPages[i] !== pages[i] + 4 || [82, 83].includes(pages[i])) fail(where, 'incorrect printed/PDF page binding');
      if (i && (pages[i] <= pages[i - 1] || pdfPages[i] <= pdfPages[i - 1])) fail(where, 'page pairs not strictly ordered');
    }
    const body = list(entry.body, `${where}.body`);
    if (!body.length) fail(where, 'missing substantive paraphrase');
    for (const para of body) if (!nonempty(para) || para.trim().length < 60) fail(where, 'missing substantive paraphrase');
    const resonances = list(entry.resonances, `${where}.resonances`);
    if (new Set(resonances).size !== resonances.length) fail(where, 'duplicate comparison');
    for (const id of resonances) if (!nonempty(id) || id === entry.familyId || (known && !known.has(id))) fail(where, `unresolved or self comparison ${id}`);
  }
  return errors;
}

function findPython(explicit) {
  // plain python3 first, then the versioned interpreters a dependency runtime may have installed pypdf into
  const candidates = [explicit || process.env.SYMBOLS_PYTHON, 'python3', 'python3.13', 'python3.12'];
  // Discover a bundled dependency Python from the installed tool directory, if available.
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (fs.existsSync(path.join(dir, 'pdfinfo'))) candidates.push(path.resolve(dir, '../../python/bin/python3'));
  }
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    const result = spawnSync(candidate, ['-c', 'import pypdf'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  // an explicitly asked-for runtime is never silently swapped for another one
  if (explicit || process.env.SYMBOLS_PYTHON) throw new Error(`SYMBOLS_PYTHON (${explicit || process.env.SYMBOLS_PYTHON}) has no pypdf; fix it or unset it.`);
  throw new Error('PDF verification requires Python with pypdf; set SYMBOLS_PYTHON to the dependency runtime.');
}

function inspectPdf(pdfPath, pdfPages, python) {
  const stat = fs.statSync(pdfPath);
  const key = `${pdfPath}:${stat.size}:${stat.mtimeMs}`;
  const existing = CACHE.get(key);
  const missing = pdfPages.filter((n) => !existing?.pages[n]);
  if (existing && !missing.length) return existing;
  const hash = existing?.hash || digest(fs.readFileSync(pdfPath));
  const executable = findPython(python);
  const script = `import sys,json\nfrom pypdf import PdfReader\nrequest=json.load(sys.stdin)\nreader=PdfReader(request['path'])\nprint(json.dumps({'pageCount':len(reader.pages),'pages':{str(n):(reader.pages[n-1].extract_text() or '') for n in request['pages'] if 1 <= n <= len(reader.pages)}}))`;
  const result = spawnSync(executable, ['-c', script], {
    input: JSON.stringify({ path: pdfPath, pages: missing }), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Could not read source PDF: ${result.stderr?.trim() || result.error?.message || 'unknown PDF error'}`);
  const extracted = JSON.parse(result.stdout);
  const inspected = { hash, pageCount: extracted.pageCount, pages: { ...existing?.pages, ...extracted.pages } };
  CACHE.set(key, inspected);
  return inspected;
}

/** Read the private source itself. Fingerprints are evidence of page identity, not prose truth. */
export function verifySymbolsSource(curated, { pdfPath = process.env.SYMBOLS_PDF || curated.source?.sourcePath, python } = {}) {
  const errors = [];
  if (curated.schema !== 1) errors.push('curation: unsupported schema');
  if (!pdfPath || !fs.existsSync(pdfPath)) return [...errors, 'source PDF unavailable; provide SYMBOLS_PDF with the reviewed edition'];
  const evidencePages = curated.entries?.flatMap((e) => (e.evidence || []).map((p) => p.pdfPage)) || [];
  const metadataPages = (curated.metadataEvidence || []).map((p) => p.pdfPage);
  const requested = [...new Set([...evidencePages, ...metadataPages, 86, 87, 88, 89])].filter(Number.isInteger).sort((a, b) => a - b);
  let pdf;
  try { pdf = inspectPdf(pdfPath, requested, python); } catch (error) { return [...errors, error.message]; }
  if (pdf.hash !== curated.source.sha256) errors.push('source revision changed; recheck the book before updating its hash');
  if (pdf.pageCount !== curated.source.pageCount) errors.push('PDF page count differs from the reviewed edition');
  if (!curated.metadataEvidence?.length) errors.push('source: missing imprint/editor evidence');
  for (const witness of curated.metadataEvidence || []) {
    if (!witness.anchor?.trim() || !normalizePage(pdf.pages[witness.pdfPage] || '').includes(normalizePage(witness.anchor))) errors.push(`metadata PDF ${witness.pdfPage}: source witness absent`);
  }
  for (const entry of curated.entries || []) {
    const where = entry.familyId;
    if (!Array.isArray(entry.evidence) || entry.evidence.length !== entry.pages?.length) { errors.push(`${where}: source page evidence incomplete`); continue; }
    entry.evidence.forEach((witness, i) => {
      if (witness.printedPage !== entry.pages[i] || witness.pdfPage !== entry.pdfPages[i]) errors.push(`${where}: citation differs from source page evidence`);
      const text = normalizePage(pdf.pages[witness.pdfPage] || '');
      if (!HASH.test(witness.textSha256 || '') || digest(text) !== witness.textSha256) errors.push(`${where}: actual source page fingerprint mismatch (PDF ${witness.pdfPage})`);
      if (!witness.anchor?.trim() || !text.includes(normalizePage(witness.anchor))) errors.push(`${where}: source witness absent (PDF ${witness.pdfPage})`);
    });
  }
  // Verify the scan defect rather than assuming or silently repairing missing pages.
  const fireDuplicates = [86, 88].every((n) => {
    const text = normalizePage(pdf.pages[n] || '');
    return text.includes('Agni') && /\b84$/.test(text);
  }) && [87, 89].every((n) => normalizePage(pdf.pages[n] || '').includes('Passing Through the Fire of Purgatory'));
  // The duplicate scans have different OCR ordering; compare their visible witnesses.
  if (!fireDuplicates) errors.push('reviewed duplicate Fire scan witnesses absent; recheck pagination');
  return errors;
}

export function generateSymbols({ root = ROOT, check = false, pdfPath, python } = {}) {
  const curated = loadSymbolsCuration(root);
  const field = JSON.parse(fs.readFileSync(path.join(root, 'public/data/field.json'), 'utf8'));
  const symbols = {
    source: curated.source,
    entries: curated.entries.map(({ evidence, ...entry }) => entry),
  };
  const errors = [...validateSymbols(symbols, { field }), ...verifySymbolsSource(curated, { pdfPath, python })];
  if (errors.length) throw new Error(errors.join('\n'));
  const generated = `${JSON.stringify(symbols, null, 2)}\n`;
  const output = path.join(root, 'public/data/symbols.json');
  if (check) {
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== generated) throw new Error('Generated symbols.json differs from reviewed curation; run npm run symbols.');
  } else fs.writeFileSync(output, generated);
  return { entries: symbols.entries.length, sourcePages: new Set(symbols.entries.flatMap((e) => e.pdfPages)).size, source: symbols.source.id };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check')) { console.error('Usage: node scripts/symbols.mjs [--check]'); process.exitCode = 1; }
  else try { console.log(JSON.stringify(generateSymbols({ check: args.includes('--check') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
