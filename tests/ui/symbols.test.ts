import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import type { Field } from '../../src/types/field';
import type { Symbols } from '../../src/types/symbols';
const field = JSON.parse(readFileSync(new URL('../../public/data/field.json', import.meta.url), 'utf8')) as Field;
const symbols = JSON.parse(readFileSync(new URL('../../public/data/symbols.json', import.meta.url), 'utf8')) as Symbols;

describe('the real Book of Symbols layer', () => {
  it('adds distinct source readings without rewriting Jung records, canonical ties, dates or counts', () => {
    const before = JSON.stringify(field);
    const model = buildModel(field, undefined, symbols);
    expect(model.symbols.size).toBe(symbols.entries.length);
    expect(JSON.stringify(model.field)).toBe(before);
    expect(model.occ.length).toBe(field.meta.counts.occurrences);
    expect(model.symbolSource?.id).toBe('book-of-symbols');
    for (const entry of symbols.entries) {
      expect(model.famById.has(entry.familyId)).toBe(true);
      expect(model.symbols.get(entry.familyId)?.pages).toEqual(entry.pages);
      for (const related of entry.resonances) expect(model.famById.has(related)).toBe(true);
    }
  });
  it('keeps the Jung atlas operative without an optional symbolic source', () => {
    const model = buildModel(field);
    expect(model.symbols.size).toBe(0);
    expect(model.symbolSource).toBeUndefined();
    expect(model.occIndex.size).toBe(field.occurrences.length);
  });
});
