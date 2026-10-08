import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Field } from '../../src/types/field';
import { buildModel } from '../../src/data/model';
import { buildSearchIndex, search } from '../../src/data/search';

// Against the real ingested field: whole-phrase names outrank word-by-word hits.
const field = JSON.parse(readFileSync(new URL('../../public/data/field.json', import.meta.url), 'utf8')) as Field;
const index = buildSearchIndex(buildModel(field));

describe('search on the ingested field', () => {
  it('puts the Great Mother archetype first for its own name', () => {
    expect(search(index, 'great mother')[0].key).toBe('a:great-mother');
  });
  it('puts the Wise Old Man archetype first for its own name', () => {
    expect(search(index, 'wise old man')[0].key).toBe('a:wise-old-man');
  });
});
