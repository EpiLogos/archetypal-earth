// N9: the Work and the Person have doors. `#/w/<id>` is a Work, `#/p/<id>` a Person (a Place first where an id is both, and
// the data test keeps the two apart); the old `?w=` filter key keeps meaning "cited from"; no route carries anything personal.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { focusOn, WORLD } from '../../src/state/store';
import { hashToState, stateToHash, type Resolver } from '../../src/state/router';
import { passes } from '../../src/shell/filter';
import type { Field } from '../../src/types/field';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const field = json('public/data/field.json') as Field;
const model = buildModel(field, undefined, undefined, { works: json('public/data/works.json'), people: json('public/data/people.json') });
const r: Resolver = {
  hasArchetype: (id) => model.archById.has(id),
  hasTheoretic: (id) => model.theoById.has(id),
  hasFamily: (id) => model.famById.has(id),
  hasCulture: (id) => model.cultureById.has(id),
  hasPlace: (id) => model.places.has(id),
  hasWork: (id) => model.workById.has(id),
  hasPerson: (id) => model.personById.has(id),
  familyOf: (id) => { const i = model.occIndex.get(id); return i === undefined ? undefined : model.occ[i].familyId; },
};

describe('#/w/<id> and #/p/<id>', () => {
  it('a Work and a Person write the short forms', () => {
    expect(stateToHash(focusOn(WORLD, { type: 'work', id: 'cw12' }))).toBe('#/w/cw12');
    expect(stateToHash(focusOn(WORLD, { type: 'person', id: 'jung' }))).toBe('#/p/jung');
  });

  it('every Work and every Person round-trips through the hash (focus, deep, and in the dynamics lens)', () => {
    const subjects = [
      ...[...model.workById.keys()].map((id) => ({ type: 'work' as const, id })),
      ...[...model.personById.keys()].map((id) => ({ type: 'person' as const, id })),
    ];
    expect(subjects.length).toBe(43 + 13);
    for (const subject of subjects) {
      const s = focusOn(WORLD, subject);
      const back = hashToState(stateToHash(s), r).state;
      expect(back.view, subject.id).toEqual({ kind: 'focus', subject });
      const deep = { ...s, deep: true };
      expect(hashToState(stateToHash(deep), r).state).toEqual(deep);
      const dyn = { ...WORLD, dynamics: { subject } };
      expect(hashToState(stateToHash(dyn), r).state, `dynamics ${subject.id}`).toEqual(dyn);
    }
  });

  it('an unknown id, or a resolver that does not know Works or People, is the world', () => {
    expect(hashToState('#/w/nonesuch', r).state).toEqual(WORLD);
    expect(hashToState('#/p/nonesuch', r).state).toEqual(WORLD);
    const { hasWork: _w, hasPerson: _p, ...old } = r;
    expect(hashToState('#/w/cw12', old).state).toEqual(WORLD);
    expect(hashToState('#/p/jung', old).state).toEqual(WORLD);
    // the old routes are untouched by a resolver that has no such methods
    expect(hashToState('#/a/self', old).state.view).toEqual({ kind: 'focus', subject: { type: 'archetype', id: 'self' } });
  });

  it('a Place wins an id that is both; no Person has the id of a Place in this field', () => {
    const clash: Resolver = { ...r, hasPlace: (id) => id === 'jung', hasPerson: (id) => id === 'jung' };
    expect(hashToState('#/p/jung', clash).state.view).toEqual({ kind: 'focus', subject: { type: 'place', id: 'jung' } });
    for (const id of model.personById.keys()) expect(model.places.has(id), id).toBe(false);
  });

  it('a Work is read off the hash by its own id, and the other cite keys are not doors', () => {
    expect(hashToState('#/w/liber-novus', r).state.view).toEqual({ kind: 'focus', subject: { type: 'work', id: 'liber-novus' } });
    expect(hashToState('#/w/redbook', r).state).toEqual(WORLD);
  });
});

describe('the old ?w= filter key keeps working', () => {
  it('parses beside a Work door and beside the old routes', () => {
    expect(hashToState('#/a/self?w=cw12,redbook', r).filter).toEqual({ works: ['cw12', 'redbook'] });
    const both = hashToState('#/w/cw12?w=cw09ii', r);
    expect(both.state.view).toEqual({ kind: 'focus', subject: { type: 'work', id: 'cw12' } });
    expect(both.filter).toEqual({ works: ['cw09ii'] });
  });

  it('still reads a cite by the key the field gives it (redbook), unfolded', () => {
    const o = field.occurrences.find((x) => x.jung.some((c) => c.work === 'redbook'))!;
    expect(passes(o, { works: ['redbook'] })).toBe(true);
    const cw = field.occurrences.find((x) => x.jung.some((c) => c.work === 'cw12'))!;
    expect(passes(cw, { works: ['cw12'] })).toBe(true);
    expect(passes(cw, { works: ['cw09ii'] })).toBe(cw.jung.some((c) => c.work === 'cw09ii'));
  });
});

describe('nothing personal in a route', () => {
  it('a Work or Person hash holds only the registry id, whatever the state', () => {
    for (const id of model.personById.keys()) expect(stateToHash(focusOn(WORLD, { type: 'person', id }))).toBe(`#/p/${encodeURIComponent(id)}`);
    for (const id of model.workById.keys()) expect(stateToHash(focusOn(WORLD, { type: 'work', id }))).toBe(`#/w/${encodeURIComponent(id)}`);
  });

  it('the router has no route that names a birth, a dream or a trail: the only birth in a hash is the old prefill link, which opens a form and saves nothing', () => {
    const src = readFileSync(new URL('../../src/state/router.ts', import.meta.url), 'utf8');
    // no personal collection is read or written by the router
    for (const word of ['practice', 'engagement', 'dream', 'localStorage', 'IndexedDB']) expect(src.includes(word), word).toBe(false);
    // and the hash it writes for a state never carries a birth (stateToHash has no `birth` branch)
    const writer = src.slice(src.indexOf('export function stateToHash'), src.indexOf('export function hashToState'));
    expect(/\bbirth\b|\blat\b|\blon\b/i.test(writer)).toBe(false);
  });
});
