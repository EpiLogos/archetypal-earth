import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error Plain ESM generator is the same source-acceptance code used by the CLI.
import { generateSymbols, loadSymbolsCuration, validateSymbols, verifySymbolsSource } from '../../scripts/symbols.mjs';
// @ts-expect-error Plain ESM engine shared with the CLI.
import { runOracle } from '../../scripts/lib/quote-oracle.mjs';
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

  it('ships the reviewed quotations reproducibly with only existing field families', () => {
    expect(generateSymbols({ root: ROOT, check: true })).toMatchObject({ entries: 43, source: 'book-of-symbols' });
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

  it('rejects empty quotations, a leftover paraphrase body and incomplete citation arrays', () => {
    const changed = copy(symbols());
    changed.entries[0].quotes = [];
    (changed.entries[2] as unknown as { body: string[] }).body = ['A paraphrase paragraph the atlas wrote about the entry, long enough to look like prose.'];
    changed.entries[1].pdfPages = [];
    expect(validateSymbols(changed, { field })).toEqual(expect.arrayContaining([
      expect.stringContaining('missing quotations'), expect.stringContaining('paraphrase'), expect.stringContaining('page pairs incomplete'),
    ]));
  });

  it('rejects a quotation that cites a page the entry does not, or whose printed and pdf pages disagree', () => {
    const changed = copy(symbols());
    changed.entries[0].quotes[0].pdfPage = changed.entries[1].pdfPages[0];
    changed.entries[3].quotes[0].page += 1;
    expect(validateSymbols(changed, { field })).toEqual(expect.arrayContaining([expect.stringContaining('quotation cites a page')]));
  });

  it('ships short quotations, each with its printed and pdf page: no paraphrase, no private page text, no plates', () => {
    const data = symbols();
    const find = (id: string) => data.entries.find((entry) => entry.familyId === id)!;
    expect(find('cross').title).toBe('Crucifixion');
    expect(find('fire').pages).toEqual([84]);
    for (const e of data.entries) {
      expect(e.quotes.length, e.familyId).toBeGreaterThanOrEqual(2);
      expect(e.quotes.length, e.familyId).toBeLessThanOrEqual(6);
      expect(e, e.familyId).not.toHaveProperty('body');
      for (const q of e.quotes) {
        expect(q.text.length, e.familyId).toBeGreaterThanOrEqual(40);
        expect(q.text.length, e.familyId).toBeLessThanOrEqual(400);
        expect(q.pdfPage, e.familyId).toBe(q.page + 4);
      }
    }
    expect(JSON.stringify(data)).not.toContain('textSha256');
    expect(JSON.stringify(data)).not.toContain('data:image');
    expect(JSON.stringify(data)).not.toContain('evidence');
  });
});

describe('the oracle reads the Book of Symbols quotations from the PDF, at check time', () => {
  const dataDir = path.join(ROOT, 'public/data');
  const own = () => runOracle(dataDir, { only: (r: { dataset: string }) => r.dataset === 'symbols.json' }).results.filter((r: { dataset: string }) => r.dataset === 'symbols.json');

  it('43 of 43 entries carry quotations, and every one is verbatim on its cited pdf page', () => {
    const data = symbols();
    const results = own();
    expect(results.length).toBe(data.entries.reduce((n, e) => n + e.quotes.length, 0));
    expect(results.filter((r: { pass: boolean }) => !r.pass).map((r: { id: string; cls: string }) => `${r.id} ${r.cls}`)).toEqual([]);
    expect(new Set(results.map((r: { cls: string }) => r.cls))).toEqual(new Set(['exact']));
    const covered = new Set(results.map((r: { id: string }) => r.id.split('#')[0]));
    expect(covered.size).toBe(43);
    expect(covered).toEqual(new Set(data.entries.map((e) => e.familyId)));
  }, 120_000);

  it('fails a quotation the page does not carry, and a quotation cited to the wrong page', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-oracle-'));
    try {
      fs.symlinkSync(path.join(dataDir, 'corpus'), path.join(dir, 'corpus'));
      const data = symbols();
      data.entries[0].quotes[0].text = 'The egg is a thing the book never says on this page, nor anywhere else at all.';
      data.entries[1].quotes[0].pdfPage = data.entries[5].quotes[0].pdfPage;
      fs.writeFileSync(path.join(dir, 'symbols.json'), JSON.stringify(data));
      fs.writeFileSync(path.join(dir, 'field.json'), JSON.stringify({ occurrences: [], families: [], archetypes: [], theoretics: [] }));
      const bad = runOracle(dir).results.filter((r: { pass: boolean }) => !r.pass).map((r: { id: string; cls: string }) => r.id);
      expect(bad).toEqual(expect.arrayContaining([`${data.entries[0].familyId}#0`, `${data.entries[1].familyId}#0`]));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
