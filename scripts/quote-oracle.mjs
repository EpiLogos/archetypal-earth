#!/usr/bin/env node
// The quote oracle. Every record the app presents as a quotation (public/data/*.json) is resolved to the corpus pages it
// cites (public/data/corpus/) and must be verbatim there, after the stated normalisation in scripts/lib/quote-oracle.mjs.
//
//   node scripts/quote-oracle.mjs            the per-dataset table, the failure classes, the report; exit 0
//   node scripts/quote-oracle.mjs --check    the gate: exit 1 when a failing record is not in curation/quote-oracle-exceptions.json
//
// Options: --data DIR (default public/data) · --report FILE (default ProjectCentral/now/tmp/quote-oracle-report.json; "-" for none)
//          --exceptions FILE · --list CLASS[,CLASS] (print those records) · --dataset NAME (restrict the list)
// A failing record gets one of these classes: ending-only (verbatim but for the punctuation it closes on), letters-only (letters agree, other punctuation differs), wrong-page-adjacent,
// wrong-page-elsewhere (verbatim in the volume, on another page; the page is reported), other-cite (verbatim on a later cite of
// the record, not the primary one), not-verbatim, no-corpus, printed-only (the cite names a printed page, which opens nothing),
// locator-unresolved, no-locator. Exceptions are reviewed, each with a reason; the file starts empty and only shrinks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOracle, tabulate } from './lib/quote-oracle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);

const DATA = path.resolve(opt('--data', path.join(ROOT, 'public', 'data')));
const EXC_FILE = path.resolve(opt('--exceptions', path.join(ROOT, 'curation', 'quote-oracle-exceptions.json')));
const REPORT = opt('--report', path.join(ROOT, 'ProjectCentral', 'now', 'tmp', 'quote-oracle-report.json'));
const CHECK = flag('--check');

function readExceptions(file) {
  if (!fs.existsSync(file)) return { list: [], problems: [] };
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(doc.exceptions) ? doc.exceptions : [];
  const problems = [];
  if (doc.version !== 1) problems.push(`${path.basename(file)}: "version" must be 1`);
  list.forEach((e, i) => {
    for (const k of ['dataset', 'id', 'reason']) if (typeof e?.[k] !== 'string' || !e[k].trim()) problems.push(`${path.basename(file)}: exceptions[${i}] needs a non-empty "${k}"`);
  });
  return { list, problems };
}

const { list: exceptions, problems } = readExceptions(EXC_FILE);
const { results, unclassified, stale } = runOracle(DATA, { exceptions });
const table = tabulate(results);

const FAIL_COLS = ['ending-only', 'letters-only', 'wrong-page-adjacent', 'wrong-page-elsewhere', 'other-cite', 'not-verbatim', 'no-corpus', 'printed-only', 'locator-unresolved', 'no-locator', 'too-short', 'no-cite'];
const cols = FAIL_COLS.filter((c) => results.some((r) => !r.pass && r.cls === c));
const short = { 'ending-only': 'ending', 'letters-only': 'letters', 'wrong-page-adjacent': 'adjacent', 'wrong-page-elsewhere': 'elsewhere', 'other-cite': 'other-cite', 'not-verbatim': 'not-verb', 'no-corpus': 'no-corpus', 'printed-only': 'printed', 'locator-unresolved': 'unresolved', 'no-locator': 'no-loc', 'too-short': 'short', 'no-cite': 'no-cite' };
const pad = (s, n) => String(s).padStart(n);

const out = [];
out.push(['dataset'.padEnd(26), pad('records', 8), pad('pass', 6), pad('exact', 6), pad('ellips', 6), pad('scan', 5), pad('FAIL', 6), ...cols.map((c) => pad(short[c], 10))].join(' '));
const sum = { records: 0, pass: 0, exact: 0, ellipsis: 0, scan: 0, fail: 0, by: {} };
for (const t of table) {
  const fails = t.records - t.pass;
  out.push([t.dataset.padEnd(26), pad(t.records, 8), pad(t.pass, 6), pad(t.exact, 6), pad(t.ellipsis, 6), pad(t.scan, 5), pad(fails, 6), ...cols.map((c) => pad(t.fail[c] ?? 0, 10))].join(' '));
  sum.records += t.records; sum.pass += t.pass; sum.exact += t.exact; sum.ellipsis += t.ellipsis; sum.scan += t.scan; sum.fail += fails;
  for (const [c, n] of Object.entries(t.fail)) sum.by[c] = (sum.by[c] ?? 0) + n;
}
out.push(['TOTAL'.padEnd(26), pad(sum.records, 8), pad(sum.pass, 6), pad(sum.exact, 6), pad(sum.ellipsis, 6), pad(sum.scan, 5), pad(sum.fail, 6), ...cols.map((c) => pad(sum.by[c] ?? 0, 10))].join(' '));
console.log(out.join('\n'));

const failing = results.filter((r) => !r.pass);
const unexcepted = failing.filter((r) => r.excepted === undefined);
console.log(`\n${results.length} quotations checked: ${sum.pass} verbatim on the cited pages, ${failing.length} not (${failing.length - unexcepted.length} excepted, ${unexcepted.length} red).`);
console.log('failure classes: ' + (Object.entries(sum.by).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ') || 'none'));
const pages = failing.filter((r) => r.cls.startsWith('wrong-page'));
if (pages.length) {
  const d = {};
  for (const r of pages) { const k = r.delta === 1 ? 'one page off' : 'further away'; d[k] = (d[k] ?? 0) + 1; }
  console.log(`wrong page, but verbatim elsewhere in the volume: ${JSON.stringify(d)}`);
}
if (unclassified.length) console.log(`UNCLASSIFIED quotation-shaped nodes (a text with a cite that matches no known shape): ${unclassified.length}`);
if (stale.length) console.log(`stale exceptions (the record now passes or is gone): ${stale.length}`);
for (const p of problems) console.log(`exceptions file: ${p}`);

const wanted = opt('--list', null);
if (wanted) {
  const classes = new Set(wanted.split(','));
  const only = opt('--dataset', null);
  for (const r of failing.filter((x) => classes.has(x.cls) && (!only || x.dataset === only))) {
    console.log(`${r.cls}\t${r.dataset}\t${r.id}\t${r.work ?? '-'} ${r.locator ?? ''}${r.foundPdf !== undefined ? `\tfound pdf p${r.foundPdf}` : ''}${r.citeIndex ? `\tcite #${r.citeIndex}` : ''}`);
  }
}

if (REPORT !== '-') {
  const file = path.resolve(REPORT);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    data: path.relative(ROOT, DATA) || '.',
    totals: { records: sum.records, pass: sum.pass, fail: failing.length, excepted: failing.length - unexcepted.length, red: unexcepted.length, byClass: sum.by },
    datasets: table.map((t) => ({ dataset: t.dataset, records: t.records, pass: t.pass, exact: t.exact, ellipsis: t.ellipsis, scan: t.scan, fail: t.fail })),
    unclassified,
    staleExceptions: stale,
    exceptionProblems: problems,
    failures: failing,
  };
  fs.writeFileSync(file, JSON.stringify(report, null, 1) + '\n');
  console.log(`report: ${path.relative(ROOT, file)}`);
}

if (CHECK) {
  const bad = unexcepted.length + unclassified.length + stale.length + problems.length;
  if (bad) {
    console.error(`quote-oracle --check: RED (${unexcepted.length} failing quotations not in the exceptions file, ${unclassified.length} unclassified, ${stale.length} stale exceptions, ${problems.length} exception-file problems)`);
    process.exit(1);
  }
  console.log('quote-oracle --check: green');
}
