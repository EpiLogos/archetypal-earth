import { describe, expect, it } from 'vitest';
import { chips, filterQuery, isEmpty, maskOf, parseFilter, passes } from '../../src/shell/filter';
import { hashToState, hashWithFilter, stateToHash, type Resolver } from '../../src/state/router';
import { back, inLens, stateEq, WORLD } from '../../src/state/store';
import { lensOf } from '../../src/shell/lens';
import type { Occurrence } from '../../src/types/field';

const occ = (id: string, over: Partial<Occurrence>): Occurrence => ({
  id, title: id, label: id, familyId: 'serpent', coFamilyIds: [], locusType: 'artifact', subject: 'n/a', cultureIds: [], place: '', lat: 0, lon: 0,
  geoPrecision: 'place', year: 0, yearDisplay: '', jung: [], body: [], parallelIds: [], ...over,
});
const A = occ('a', { jung: [{ work: 'cw12', workTitle: 'Psychology and Alchemy (CW12)', year: '1944', locator: '¶1' }], cultureIds: ['gnostic'], year: 200, locusType: 'artifact' });
const B = occ('b', { jung: [{ work: 'sem-visions', workTitle: 'Visions', year: '1930', locator: 'pdf p1' }], cultureIds: ['modern-european'], year: 1931, locusType: 'vision' });

const r: Resolver = {
  hasArchetype: (id) => id === 'self', hasFamily: (id) => id === 'serpent', hasCulture: (id) => id === 'gnostic', hasPlace: () => false,
  hasTheoretic: () => false,
  familyOf: (id) => (id === 'a' ? 'serpent' : undefined),
};

describe('the field filter', () => {
  it('passes only what every set dimension allows', () => {
    expect(passes(A, {})).toBe(true);
    expect(passes(A, { works: ['cw12'] })).toBe(true);
    expect(passes(B, { works: ['cw12'] })).toBe(false);
    expect(passes(A, { cultures: ['gnostic'], era: [0, 499] })).toBe(true);
    expect(passes(A, { cultures: ['gnostic'], era: [500, 1499] })).toBe(false);
    expect(passes(B, { kinds: ['dream', 'vision'] })).toBe(true);
    expect(passes(A, { kinds: ['dream', 'vision'] })).toBe(false);
  });

  it('builds a mask, or none for the whole field', () => {
    expect(maskOf([A, B], {})).toBeNull();
    expect(Array.from(maskOf([A, B], { works: ['sem-visions'] })!)).toEqual([0, 1]);
  });

  it('slices the field by what governs an occurrence: its family\'s archetype and the concept it answers to', () => {
    const tagsA = { archetypes: ['self', 'shadow'], theoretics: ['psychoid'] };
    const tagsB = { archetypes: ['great-mother'], theoretics: ['individuation'] };
    expect(passes(A, { archetypes: ['self'] }, tagsA)).toBe(true);
    expect(passes(B, { archetypes: ['self'] }, tagsB)).toBe(false);
    expect(passes(B, { archetypes: ['great-mother', 'self'] }, tagsB)).toBe(true);
    expect(passes(A, { theoretics: ['psychoid'] }, tagsA)).toBe(true);
    expect(passes(B, { theoretics: ['psychoid'] }, tagsB)).toBe(false);
    // every set dimension holds together: the concept and the kind must both allow it
    expect(passes(A, { theoretics: ['psychoid'], kinds: ['vision'] }, tagsA)).toBe(false);
    // the question is unanswerable without the tags, so it passes nothing — never everything
    expect(passes(A, { archetypes: ['self'] })).toBe(false);
    expect(passes(A, { theoretics: ['psychoid'] })).toBe(false);
    // and a mask carries the tags through
    expect(Array.from(maskOf([A, B], { archetypes: ['self'] }, [tagsA, tagsB])!)).toEqual([1, 0]);
  });

  it('round-trips through the hash query and drops what it cannot read', () => {
    const f = { works: ['cw12', 'cw09ii'], cultures: ['gnostic'], era: [-200, 400] as [number, number], kinds: ['dream' as const], archetypes: ['self', 'great-mother'], theoretics: ['psychoid'] };
    expect(parseFilter(filterQuery(f))).toEqual(f);
    expect(parseFilter('w=cw12&k=nonsense&e=abc&x=1')).toEqual({ works: ['cw12'] });
    expect(isEmpty(parseFilter(''))).toBe(true);
  });

  it('offers one removable chip per active value', () => {
    const cs = chips({ works: ['cw12'], era: [0, 499] }, { work: () => 'CW12', culture: (c) => c, archetype: (a) => a, theoretic: (t) => t });
    expect(cs.map((c) => c.label)).toEqual(['CW12', '0–499']);
    expect(cs[0].without).toEqual({ era: [0, 499] });
    expect(cs[1].without).toEqual({ works: ['cw12'] });
    const subs = chips({ archetypes: ['self'], theoretics: ['psychoid'] }, { work: (w) => w, culture: (c) => c, archetype: () => 'The Self', theoretic: () => 'The Psychoid' });
    expect(subs.map((c) => c.label)).toEqual(['The Self', 'The Psychoid']);
    expect(subs[0].without).toEqual({ theoretics: ['psychoid'] });
    expect(subs[1].without).toEqual({ archetypes: ['self'] });
  });
});

describe('lens routes', () => {
  it('a panel lens is linkable with its sub-route, and carries no personal data', () => {
    expect(stateToHash(inLens('theory', ['energy']))).toBe('#/theory/energy');
    const p = hashToState('#/theory/energy', r);
    expect(stateEq(p.state, inLens('theory', ['energy']))).toBe(true);
    expect(lensOf(p.state)).toBe('theory');
  });

  it('a filter rides after the route and does not disturb it', () => {
    const p = hashToState('#/a/self?w=cw12&e=0..499', r);
    expect(p.state.view).toEqual({ kind: 'focus', subject: { type: 'archetype', id: 'self' } });
    expect(p.filter).toEqual({ works: ['cw12'], era: [0, 499] });
    expect(hashWithFilter(p.state, p.filter)).toBe('#/a/self?w=cw12&e=0..499');
    expect(hashToState('#/', r).filter).toEqual({});
  });

  it('Back climbs a lens route, then closes the lens', () => {
    const s = inLens('theory', ['energy']);
    expect(stateEq(back(s), inLens('theory'))).toBe(true);
    // a bare Theory lens closes onto the theory's own landing (the dynamical route the Options wait on), not
    // straight to the World — store.back() states why
    expect(stateEq(back(inLens('theory')), { view: { kind: 'world' }, deep: false, dynamics: {} })).toBe(true);
    expect(stateEq(back(inLens('astrology')), WORLD)).toBe(true);
  });

  it('the dynamical lens belongs to Theory; Aion and the Red Book are their own lenses', () => {
    expect(lensOf({ ...WORLD, dynamics: {} })).toBe('theory');
    expect(lensOf({ ...WORLD, history: { reading: 'jung-aion' } })).toBe('aion');
    expect(lensOf({ ...WORLD, redbook: {} })).toBe('redbook');
    expect(lensOf(WORLD)).toBe('field');
  });
});
