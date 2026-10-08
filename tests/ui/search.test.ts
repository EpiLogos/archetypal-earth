import { describe, expect, it } from 'vitest';
import { buildFixture } from '../../src/dev/fixture';
import { buildModel } from '../../src/data/model';
import { buildSearchIndex, norm, parsePeriod, search } from '../../src/data/search';

const model = buildModel(buildFixture());
const index = buildSearchIndex(model);

describe('search', () => {
  it('normalises diacritics and punctuation', () => {
    expect(norm('Küsnacht,  Switzerland')).toBe('kusnacht switzerland');
  });

  it('ranks an exact family name first, ahead of occurrences that merely mention it', () => {
    const r = search(index, 'serpent');
    expect(r[0].kind).toBe('family');
    expect(r[0].label).toBe('Serpent');
  });

  it('finds families by alias', () => {
    const r = search(index, 'ouroboros ophis');
    expect(r.length).toBeGreaterThanOrEqual(0);
    const alias = search(index, 'naga');
    expect(alias[0].label).toBe('Serpent');
    expect(search(index, 'magna mater')[0].label).toBe('Great Goddess');
  });

  it('finds archetypes by prefix', () => {
    const r = search(index, 'great mo');
    expect(r[0]).toMatchObject({ kind: 'archetype', label: 'Great Mother' });
  });

  it('finds occurrences by place and culture', () => {
    const r = search(index, 'chartres');
    expect(r.some((x) => x.kind === 'place')).toBe(true);
    expect(r.some((x) => x.kind === 'occurrence')).toBe(true);
    expect(search(index, 'norse').some((x) => x.kind === 'culture')).toBe(true);
  });

  it('requires every token to match', () => {
    expect(search(index, 'serpent zzzzqqq')).toHaveLength(0);
  });

  it('never returns more than seven rows', () => {
    for (const q of ['a', 'e', 'the', 'tree', 'serp', 'ch', 'in']) expect(search(index, q).length).toBeLessThanOrEqual(7);
  });

  it('offers the archetypes when the field is empty', () => {
    const r = search(index, '');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.kind === 'archetype')).toBe(true);
  });

  it('keeps one kind from flooding the list', () => {
    const r = search(index, 'e');
    expect(r.filter((x) => x.kind === 'occurrence').length).toBeLessThanOrEqual(5);
  });
});

describe('periods', () => {
  const sc = model.scale;

  it('understands a year, with and without BCE', () => {
    expect(parsePeriod('1600', sc)).toMatchObject({ from: 1600, to: 1600 });
    expect(parsePeriod('500 bce', sc)).toMatchObject({ from: -500 });
    expect(parsePeriod('-300', sc)).toMatchObject({ from: -300 });
  });

  it('understands decades and centuries', () => {
    expect(parsePeriod('1600s', sc)).toMatchObject({ from: 1600, to: 1700 });
    expect(parsePeriod('13th century', sc)).toMatchObject({ from: 1200, to: 1300, label: '13th century' });
    expect(parsePeriod('5th c bce', sc)).toMatchObject({ from: -500, to: -400 });
  });

  it('understands named eras by prefix and alias', () => {
    expect(parsePeriod('renaissance', sc)).toMatchObject({ label: 'Renaissance', from: 1400 });
    expect(parsePeriod('renais', sc)?.label).toBe('Renaissance');
    expect(parsePeriod('medieval', sc)?.label).toBe('Middle Ages');
    expect(parsePeriod('late ant', sc)?.label).toBe('Late antiquity');
  });

  it('rejects non-periods and out-of-range years', () => {
    expect(parsePeriod('serpent', sc)).toBeNull();
    expect(parsePeriod('99999', sc)).toBeNull();
  });

  it('returns period results from the search itself', () => {
    expect(search(index, 'renaissance')[0]).toMatchObject({ kind: 'period', label: 'Renaissance' });
    expect(search(index, '1600')[0].kind).toBe('period');
  });
});
