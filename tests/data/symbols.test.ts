import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error Plain ESM generator is the same source-acceptance code used by the CLI.
import { generateSymbols, loadSymbolsCuration, validateSymbols, verifySymbolsSource } from '../../scripts/symbols.mjs';
import type { Symbols } from '../../src/types/symbols';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const field: Field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8'));
const curated = loadSymbolsCuration(ROOT);
const copy = <T,>(value: T): T => structuredClone(value);
const symbols = (): Symbols => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/symbols.json'), 'utf8'));

describe('Book of Symbols source layer', () => {
  it('verifies the actual PDF revision, cited page text, editors and imprint', () => {
    // Missing source is a failure; this acceptance check is never mocked or skipped.
    expect(verifySymbolsSource(curated)).toEqual([]);
  }, 180_000);

  it('ships the reviewed paraphrases reproducibly with only existing field families', () => {
    expect(generateSymbols({ root: ROOT, check: true })).toMatchObject({ entries: 29, source: 'book-of-symbols' });
    expect(validateSymbols(symbols(), { field })).toEqual([]);
    expect(symbols().entries).toEqual(curated.entries.map(({ evidence: _evidence, ...entry }: { evidence: unknown }) => entry));
  });

  it('rejects an unknown family, invented comparison and duplicate family note', () => {
    const changed = copy(symbols());
    changed.entries[0].familyId = 'not-an-existing-family';
    changed.entries[1].resonances.push('invented-symbol');
    changed.entries.push(copy(changed.entries[1]));
    expect(validateSymbols(changed, { field })).toEqual(expect.arrayContaining([
      expect.stringContaining('unresolved family'), expect.stringContaining('unresolved or self comparison'), expect.stringContaining('duplicate family'),
    ]));
  });

  it('rejects swapped printed/PDF citations, missing scans and out-of-range pages', () => {
    const changed = copy(symbols());
    changed.entries[0].pages[0] = 18;
    changed.entries[1].pdfPages[0] = 817;
    changed.entries[2].pages[0] = 82;
    expect(validateSymbols(changed, { field })).toEqual(expect.arrayContaining([
      expect.stringContaining('incorrect printed/PDF page binding'), expect.stringContaining('PDF page outside source'),
    ]));
  });

  it('rejects page evidence that was moved or replaced with a fabricated witness', () => {
    const changed = copy(curated);
    changed.entries[0].evidence[0].pdfPage = changed.entries[1].evidence[0].pdfPage;
    changed.entries[1].evidence[0].anchor = 'The source proves the atlas predicts the future.';
    expect(verifySymbolsSource(changed)).toEqual(expect.arrayContaining([
      expect.stringContaining('citation differs from source page evidence'), expect.stringContaining('actual source page fingerprint mismatch'), expect.stringContaining('source witness absent'),
    ]));
  });

  it('rejects unreviewed source revisions and missing title/imprint provenance', () => {
    const changed = copy(curated);
    changed.source.sha256 = '0'.repeat(64);
    changed.metadataEvidence[0].anchor = 'An invented editor';
    expect(verifySymbolsSource(changed)).toEqual(expect.arrayContaining([
      expect.stringContaining('source revision changed'), expect.stringContaining('source witness absent'),
    ]));
  });

  it('rejects empty notes and incomplete citation arrays', () => {
    const changed = copy(symbols());
    changed.entries[0].body = [];
    changed.entries[1].pdfPages = [];
    expect(validateSymbols(changed, { field })).toEqual(expect.arrayContaining([
      expect.stringContaining('missing substantive paraphrase'), expect.stringContaining('page pairs incomplete'),
    ]));
  });

  it('keeps culturally particular and editorial readings visible, without private page text or plates', () => {
    const data = symbols();
    const find = (id: string) => data.entries.find((entry) => entry.familyId === id)!;
    expect(find('cross').title).toBe('Crucifixion');
    expect(find('cross').body.join(' ')).toContain('Christian');
    expect(find('mandala').body.join(' ')).toContain('editorial comparison');
    expect(find('fire').pages).toEqual([84]);
    expect(find('fire').body.join(' ')).toContain('missing opening');
    expect(JSON.stringify(data)).not.toContain('textSha256');
    expect(JSON.stringify(data)).not.toContain('data:image');
    expect(JSON.stringify(data)).not.toContain('evidence');
  });
});
