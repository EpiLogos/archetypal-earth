#!/usr/bin/env node
// Prove the Jung cite-year axis (plan S7): every cite of every occurrence (public/data/field.json, occurrences[].jung[]) that has a
// four-digit year in its `year` string carries `citeYear`, the first such year; the rest carry none and are listed here. Exits 1
// when a cite's citeYear disagrees with its string.
//   node scripts/verify-cite-years.mjs            print the count and the unparsed cites
//   node scripts/verify-cite-years.mjs --json     the same, as JSON
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { citeYear } from './lib/cite-year.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** { cites, parsed, unparsed: [{ id, work, year }], wrong: [..] } over a field. */
export function verifyCiteYears(field) {
  let cites = 0;
  let parsed = 0;
  const unparsed = [];
  const wrong = [];
  for (const o of field.occurrences) {
    for (const c of o.jung) {
      cites++;
      const want = citeYear(c.year);
      if (want === null) {
        unparsed.push({ id: o.id, work: c.work, year: c.year });
        if (c.citeYear !== undefined) wrong.push(`${o.id} ${c.work}: citeYear ${c.citeYear} on a year string with none ("${c.year}")`);
      } else {
        parsed++;
        if (c.citeYear !== want) wrong.push(`${o.id} ${c.work}: citeYear ${c.citeYear} but "${c.year}" gives ${want}`);
      }
    }
  }
  return { cites, parsed, unparsed, wrong };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'field.json'), 'utf8'));
  const r = verifyCiteYears(field);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(`cite years: ${r.parsed} of ${r.cites} cites carry a year`);
    for (const u of r.unparsed) console.log(`  unparsed: ${u.id} [${u.work}] "${u.year}"`);
    for (const w of r.wrong) console.error(`  WRONG: ${w}`);
  }
  process.exitCode = r.wrong.length ? 1 : 0;
}
