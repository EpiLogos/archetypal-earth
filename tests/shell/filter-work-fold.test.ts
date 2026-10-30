import { describe, expect, it } from 'vitest';
import { buildFixture } from '../../src/dev/fixture';
import { buildModel } from '../../src/data/model';
import { maskOf, passes } from '../../src/shell/filter';
import type { Occurrence } from '../../src/types/field';
import type { WorksData } from '../../src/types/works';

const occ = (id: string, work: string): Occurrence => ({
  id, title: id, label: id, familyId: 'serpent', coFamilyIds: [], locusType: 'artifact', subject: 'n/a', cultureIds: [], place: '', lat: 0, lon: 0,
  geoPrecision: 'place', year: 0, yearDisplay: '', jung: [{ work, workTitle: work, year: '1913', locator: 'pdf p1' }], body: [], parallelIds: [], ...{},
});
// the Red Book is cited under two keys: the registry folds them to one Work
const works = { schema: 1, works: [{ id: 'liber-novus', title: 'Liber Novus', kind: 'manuscript', author: 'jung', voice: 'Jung', aliases: ['redbook'], chapters: [], chaptersDerived: false, cites: 2, occurrences: 2, ties: { archetypes: [], theoretics: [], families: [] } }] } as unknown as WorksData;
const model = buildModel(buildFixture(), undefined, undefined, { works });
const A = occ('a', 'redbook');
const B = occ('b', 'liber-novus');
const C = occ('c', 'cw12');

describe('the Source filter folds a cite key through the registry', () => {
  it('?w=liber-novus and ?w=redbook slice the same text', () => {
    for (const key of ['liber-novus', 'redbook']) {
      expect(passes(A, { works: [key] }, undefined, model.workKey)).toBe(true);
      expect(passes(B, { works: [key] }, undefined, model.workKey)).toBe(true);
      expect(passes(C, { works: [key] }, undefined, model.workKey)).toBe(false);
    }
  });

  it('a key the registry does not hold stands for itself, and no registry changes nothing', () => {
    expect(passes(C, { works: ['cw12'] }, undefined, model.workKey)).toBe(true);
    expect(passes(A, { works: ['cw12'] }, undefined, model.workKey)).toBe(false);
    expect(passes(A, { works: ['redbook'] })).toBe(true);
    expect(passes(B, { works: ['redbook'] })).toBe(false);
  });

  it('the engine mask folds the same way', () => {
    expect(Array.from(maskOf([A, B, C], { works: ['redbook'] }, undefined, model.workKey)!)).toEqual([1, 1, 0]);
  });
});
