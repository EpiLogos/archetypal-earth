import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFixture } from '../../src/dev/fixture';
import { buildModel } from '../../src/data/model';
import { buildSearchIndex, search } from '../../src/data/search';
import { resultImage } from '../../src/ui/search';
import { engagementName } from '../../src/ui/you';
import type { PeopleData } from '../../src/types/people';
import type { WorksData } from '../../src/types/works';

const read = <T>(f: string) => JSON.parse(readFileSync(`public/data/${f}`, 'utf8')) as T;
const model = buildModel(buildFixture(), undefined, undefined, { works: read<WorksData>('works.json'), people: read<PeopleData>('people.json') });
const index = buildSearchIndex(model);

describe('search results for texts and people', () => {
  it('a Work and a Person are results with a label and a sub-line', () => {
    const w = search(index, 'Psychology and Alchemy').find((r) => r.kind === 'work');
    expect(w?.label).toMatch(/Psychology and Alchemy/);
    expect(w?.sub).toMatch(/^work/);
    const p = search(index, 'Jung').find((r) => r.kind === 'person');
    expect(p?.label).toBe('C. G. Jung');
  });

  it('a person whose record holds a portrait file resolves it; one without gets none (never invented)', () => {
    const jung = search(index, 'C. G. Jung').find((r) => r.kind === 'person')!;
    const img = resultImage(index, jung);
    expect(img?.src).toBe('/img/jung-portrait.jpg');
    expect(img?.credit).toBeTruthy();
    const pauli = search(index, 'Pauli').find((r) => r.kind === 'person')!;
    expect(resultImage(index, pauli)).toBeUndefined();
  });
});

describe('the visitor\'s record names what it holds', () => {
  it('a registry subject by its name, an occurrence by its label, one of their own records by its kind', () => {
    expect(engagementName(model, { type: 'work', id: 'cw12' })).toMatch(/Alchemy/);
    expect(engagementName(model, { type: 'person', id: 'jung' })).toBe('C. G. Jung');
    expect(engagementName(model, { type: 'dream', id: 'x' })).toBe('a dream');
    expect(engagementName(model, { type: 'occurrence', id: 'no-such' })).toBe('an instance');
  });
});
