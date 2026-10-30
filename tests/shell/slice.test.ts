// S2, S3, S5: the slice reads the lens contract. The filter offers only the dimensions that vary inside the lens's slice, the
// count is placed-and-in-slice, the two new facets (whose experience, which ring of the sky) round-trip through the address,
// and the strip's density counts the filtered in-lens set. The expected numbers are measured from the raw field.json here, by a
// different derivation from the code under test.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { lensContract, type LensData } from '../../src/lenses/contract';
import { chips, filterQuery, isEmpty, maskOf, parseFilter, passes, type FieldFilter } from '../../src/shell/filter';
import { sliceCount, sliceMask } from '../../src/shell/slice';
import { hashToState, hashWithFilter } from '../../src/state/router';
import { binCounts, citeCounts, citeSpan } from '../../src/ui/density';
import { inLens, WORLD } from '../../src/state/store';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const json = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8')) as T;
const field = json<Field>('field.json');
const m = buildModel(field, undefined, undefined, { works: json('works.json'), people: json('people.json'), walks: json('walks.json') });
const data: LensData = { dynamics: json('dynamics.json'), history: json('history.json'), redbook: json('redbook.json'), alchemy: json('alchemy.json'), symbols: json('symbols.json') };
const placed = (o: { geoPrecision: string; lat: number; lon: number }) => o.geoPrecision !== 'none' && Number.isFinite(o.lat) && Number.isFinite(o.lon);

describe('the two new facets', () => {
  it('whose: Jung\'s own occurrences are 82 in the field, a patient\'s 662', () => {
    const count = (f: FieldFilter) => field.occurrences.filter((o) => passes(o, f)).length;
    expect(count({ subjects: ['jung'] })).toBe(field.occurrences.filter((o) => o.subject === 'jung').length);
    expect(count({ subjects: ['jung'] })).toBe(82);
    expect(count({ subjects: ['patient-anon'] })).toBe(662);
    expect(count({ subjects: ['jung', 'patient-anon'] })).toBe(744);
  });

  it('sky ring: an occurrence passes when any of its sky loci is on the ring', () => {
    const count = (f: FieldFilter) => field.occurrences.filter((o) => passes(o, f)).length;
    const raw = (r: string) => field.occurrences.filter((o) => (o.sky ?? []).some((l) => l.ring === r)).length;
    for (const r of ['body', 'zodiac', 'rank', 'wheel', 'pole'] as const) expect(count({ rings: [r] })).toBe(raw(r));
    expect(count({ rings: ['zodiac'] })).toBeGreaterThan(0);
  });

  it('round-trips through the hash query with the six it had, and drops what it cannot read', () => {
    const f: FieldFilter = { works: ['cw12'], cultures: ['gnostic'], era: [-200, 400], kinds: ['dream'], archetypes: ['self'], theoretics: ['psychoid'], subjects: ['jung', 'patient-anon'], rings: ['zodiac', 'pole'] };
    expect(filterQuery(f)).toContain('s=jung,patient-anon');
    expect(filterQuery(f)).toContain('r=zodiac,pole');
    expect(parseFilter(filterQuery(f))).toEqual(f);
    expect(parseFilter('s=jung&r=zodiac')).toEqual({ subjects: ['jung'], rings: ['zodiac'] });
    expect(parseFilter('s=nobody&r=orbit')).toEqual({});
    expect(isEmpty({ subjects: ['jung'] })).toBe(false);
    expect(isEmpty({ rings: ['body'] })).toBe(false);
  });

  it('rides in the address of any lens, and the lens reads back with it', () => {
    const f: FieldFilter = { subjects: ['jung'], rings: ['zodiac'] };
    for (const state of [WORLD, inLens('dreams'), { ...WORLD, redbook: {} }]) {
      const h = hashWithFilter(state, f);
      expect(h.endsWith(`?${filterQuery(f)}`)).toBe(true);
      expect(hashToState(h, { hasArchetype: () => true, hasTheoretic: () => true, hasFamily: () => true, hasCulture: () => true, hasPlace: () => false, familyOf: () => undefined, hasBody: () => false }).filter).toEqual(f);
    }
  });

  it('has one removable chip per value', () => {
    const names = { work: (w: string) => w, culture: (c: string) => c, archetype: (a: string) => a, theoretic: (t: string) => t };
    const cs = chips({ subjects: ['jung'], rings: ['zodiac'] }, names);
    expect(cs).toHaveLength(2);
    expect(cs[0].without).toEqual({ rings: ['zodiac'] });
    expect(cs[1].without).toEqual({ subjects: ['jung'] });
  });
});

describe('the filter offers what varies inside the lens', () => {
  it('the Red Book has no era dimension and no whose facet: its 37 folios are one era and all Jung\'s own', () => {
    const c = lensContract('redbook', m, data);
    expect(c.dimensions).not.toContain('era');
    expect(c.dimensions).not.toContain('subjects');
    expect(c.dimensions).not.toContain('rings');
    expect(c.dimensions).toContain('works');
  });

  it('the Field offers all eight; Theory and Aion hold no sky ring, so offer none', () => {
    expect(lensContract('field', m, data).dimensions).toEqual(['works', 'cultures', 'era', 'kinds', 'archetypes', 'theoretics', 'subjects', 'rings']);
    expect(lensContract('theory', m, data).dimensions).not.toContain('rings');
    expect(lensContract('aion', m, data).dimensions).not.toContain('rings');
    expect(lensContract('theory', m, data).dimensions).toContain('subjects');
  });

  it('the pills a facet offers are the values the slice holds', () => {
    expect(lensContract('redbook', m, data).facets).toEqual({ subjects: ['jung'], rings: [] });
    expect(lensContract('alchemy', m, data).facets.rings).toEqual(['body']);
    expect(lensContract('field', m, data).facets).toEqual({ subjects: ['jung', 'patient-anon'], rings: ['body', 'zodiac', 'rank', 'wheel', 'pole'] });
  });

  it('Astrology slices the occurrences that hang in the sky; Dreams and Coincidences slice the whole field', () => {
    const a = lensContract('astrology', m, data);
    expect(a.slice.length).toBe(field.occurrences.filter((o) => (o.sky?.length ?? 0) > 0).length);
    expect(a.dimensions).toContain('rings');
    expect(lensContract('dreams', m, data).slice.length).toBe(field.occurrences.length);
    expect(lensContract('coincidences', m, data).slice.length).toBe(field.occurrences.length);
  });
});

describe('the count is placed and in the slice', () => {
  it('the Red Book under no filter counts at most its 37 (not the field\'s 3,085)', () => {
    const n = sliceCount(m, lensContract('redbook', m, data), {});
    expect(n).toBeLessThanOrEqual(37);
    expect(n).toBe(37);
  });

  it('the Field under no filter counts what stands on the Earth, not the unplaced', () => {
    const n = sliceCount(m, lensContract('field', m, data), {});
    expect(n).toBe(field.occurrences.filter(placed).length);
    expect(n).toBeLessThan(field.occurrences.length);
  });

  it('a filter counts only the placed, in-slice ones that pass it', () => {
    const f: FieldFilter = { subjects: ['jung'] };
    for (const id of ['field', 'redbook', 'aion', 'theory'] as const) {
      const c = lensContract(id, m, data);
      const want = c.slice.filter((i) => placed(field.occurrences[i]) && field.occurrences[i].subject === 'jung').length;
      expect(sliceCount(m, c, f), id).toBe(want);
    }
    // an era the Red Book is not in leaves it empty, honestly
    expect(sliceCount(m, lensContract('redbook', m, data), { era: [-3000, 1500] })).toBe(0);
  });
});

describe('the strip counts the filtered in-lens set', () => {
  const full = { u: m.u, located: m.located, fromU: Math.min(...m.u), toU: Math.max(...m.u) + 1, bins: 160 };

  it('with no filter and the whole field, it counts every placed occurrence', () => {
    expect(sliceMask(m, lensContract('field', m, data), null)).toBeNull();
    expect(binCounts({ ...full, subset: null, slice: null }).n).toBe(field.occurrences.filter(placed).length);
  });

  it('Σ density = passing and placed, under a filter', () => {
    const f: FieldFilter = { subjects: ['patient-anon'] };
    const mask = maskOf(m.occ, f, m.tags, m.workKey);
    const { counts, n } = binCounts({ ...full, subset: null, slice: sliceMask(m, lensContract('field', m, data), mask) });
    const want = field.occurrences.filter((o) => placed(o) && o.subject === 'patient-anon').length;
    expect(n).toBe(want);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(want);
  });

  it('inside a lens it counts the lens\'s slice through the filter: the Red Book strip holds its folios only', () => {
    const c = lensContract('redbook', m, data);
    expect(binCounts({ ...full, subset: null, slice: sliceMask(m, c, null) }).n).toBe(37);
    const mask = maskOf(m.occ, { works: ['redbook'] }, m.tags, m.workKey);
    const n = binCounts({ ...full, subset: null, slice: sliceMask(m, c, mask) }).n;
    const want = c.slice.filter((i) => placed(field.occurrences[i]) && passes(field.occurrences[i], { works: ['redbook'] }, m.tags[i], m.workKey)).length;
    expect(n).toBe(want);
  });

  it('a subject\'s overlay follows the same slice', () => {
    const c = lensContract('aion', m, data);
    const subset = c.slice.slice(0, 200);
    const mask = maskOf(m.occ, { subjects: ['patient-anon'] }, m.tags, m.workKey);
    const { n } = binCounts({ ...full, subset, slice: sliceMask(m, c, mask) });
    expect(n).toBe(subset.filter((i) => placed(field.occurrences[i]) && field.occurrences[i].subject === 'patient-anon').length);
  });
});

describe('Jung\'s cite-year axis over the field', () => {
  it('spans the years the cites carry, and counts each placed occurrence\'s distinct cite years', () => {
    const years = field.occurrences.flatMap((o) => o.jung.map((c) => c.citeYear)).filter((y): y is number => y !== undefined);
    expect(years.length).toBe(3221);
    const span = citeSpan(m.occ)!;
    expect(span).toEqual([Math.min(...years), Math.max(...years)]);
    const want = field.occurrences.reduce((n, o) => (placed(o) ? n + new Set(o.jung.map((c) => c.citeYear).filter((y) => y !== undefined)).size : n), 0);
    expect(citeCounts({ occ: m.occ, located: m.located, subset: null, slice: null, fromYear: span[0], toYear: span[1], bins: 160 }).n).toBe(want);
  });
});
