// The reading-pass records for the three new texts, checked as the vault's own lint checks Jung's: every line is JSON,
// every record has the fields the protocol requires, and every quote stands verbatim on the pdf page it cites
// (whitespace and typography folded only). Read-only: reports, never edits.
//   node scripts/harvest-check.mjs [vol ...]      (default: the three new volumes)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader, verify } from './lib/cite.mjs';

const KINDS = new Set(['instance', 'definition', 'statement', 'connection', 'culture']);
export const NEW_VOLS = ['neumann-great-mother', 'neumann-origins', 'vonzfranz-number-time'];

export function readRecords(vault, vol) {
  const dir = path.join(vault, 'data', 'mentions', vol);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      try { out.push({ file: f, line: i + 1, rec: JSON.parse(line) }); } catch { out.push({ file: f, line: i + 1, rec: null }); }
    });
  }
  return out;
}

export function checkHarvest({ vault = DEFAULT_VAULT, vols = NEW_VOLS } = {}) {
  const load = workLoader(vault);
  const report = {};
  for (const vol of vols) {
    const rows = readRecords(vault, vol);
    const bad = [];
    const kinds = {};
    let verified = 0;
    for (const { file, line, rec } of rows) {
      const where = `${file}:${line}`;
      if (!rec) { bad.push(`${where}: not JSON`); continue; }
      kinds[rec.kind] = (kinds[rec.kind] ?? 0) + 1;
      if (!KINDS.has(rec.kind)) bad.push(`${where}: kind "${rec.kind}"`);
      if (rec.vol !== vol) bad.push(`${where}: vol "${rec.vol}"`);
      if (typeof rec.term !== 'string' || !rec.term) bad.push(`${where}: no term`);
      if (!Number.isInteger(rec.pdf_page)) { bad.push(`${where}: no pdf_page`); continue; }
      if (typeof rec.quote !== 'string' || rec.quote.length < 8) { bad.push(`${where}: no quote`); continue; }
      const err = verify(load, { work: vol, locator: `pdf p${rec.pdf_page}`, quote: rec.quote });
      if (err) bad.push(`${where}: ${err}`); else verified++;
    }
    report[vol] = { records: rows.length, verified, kinds, bad };
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const vols = process.argv.slice(2).length ? process.argv.slice(2) : NEW_VOLS;
  const report = checkHarvest({ vols });
  let failed = 0;
  for (const [vol, r] of Object.entries(report)) {
    console.log(`${vol}: ${r.records} records, ${r.verified} quotes verbatim on their page, ${r.bad.length} problems · ${JSON.stringify(r.kinds)}`);
    for (const b of r.bad.slice(0, 8)) console.log(`   ${b}`);
    failed += r.bad.length;
  }
  process.exit(failed ? 1 : 0);
}
