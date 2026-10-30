// S7 data: Jung's engagement year of every cite (occurrence.jung[].citeYear), parsed from the cite's year string. 3,221 of 3,228
// cites name a four-digit year; the other seven are listed by scripts/verify-cite-years.mjs and carry none.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-expect-error plain ESM script
import { citeYear } from '../../scripts/lib/cite-year.mjs';
// @ts-expect-error plain ESM script
import { verifyCiteYears } from '../../scripts/verify-cite-years.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8'));

describe('the cite-year axis', () => {
  it('reads the first four-digit year of a cite string, and none from a string without one', () => {
    expect(citeYear('1936/44')).toBe(1936);
    expect(citeYear('1911–12/1952')).toBe(1911);
    expect(citeYear('1970 (English 1974)')).toBe(1970);
    expect(citeYear('~1932')).toBe(1932);
    expect(citeYear('index')).toBeNull();
    expect(citeYear('Psychology and Alchemy ¶¶315f. — pin tbd')).toBeNull();
    expect(citeYear('')).toBeNull();
  });

  it('3,221 of the 3,228 cites carry citeYear, the seven others none, and every citeYear agrees with its string', () => {
    const r = verifyCiteYears(field);
    expect(r.cites).toBe(3228);
    expect(r.parsed).toBe(3221);
    expect(r.unparsed.length).toBe(7);
    expect(r.wrong).toEqual([]);
  });

  it('scripts/verify-cite-years.mjs exits 0 and lists the seven unparsed cites', () => {
    const run = spawnSync('node', [path.join(ROOT, 'scripts/verify-cite-years.mjs')], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('3221 of 3228');
    expect(run.stdout.match(/unparsed:/g)?.length).toBe(7);
  });
});
