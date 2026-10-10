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

  it('round-trips through the hash query and drops what it cannot read', () => {
    const f = { works: ['cw12', 'cw09ii'], cultures: ['gnostic'], era: [-200, 400] as [number, number], kinds: ['dream' as const] };
    expect(parseFilter(filterQuery(f))).toEqual(f);
    expect(parseFilter('w=cw12&k=nonsense&e=abc&x=1')).toEqual({ works: ['cw12'] });
    expect(isEmpty(parseFilter(''))).toBe(true);
  });

  it('offers one removable chip per active value', () => {
    const cs = chips({ works: ['cw12'], era: [0, 499] }, { work: () => 'CW12', culture: (c) => c });
    expect(cs.map((c) => c.label)).toEqual(['CW12', '0–499']);
    expect(cs[0].without).toEqual({ era: [0, 499] });
    expect(cs[1].without).toEqual({ works: ['cw12'] });
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
    expect(stateEq(back(inLens('theory')), WORLD)).toBe(true);
  });

  it('the dynamical lens belongs to Theory; Aion and the Red Book are their own lenses', () => {
    expect(lensOf({ ...WORLD, dynamics: {} })).toBe('theory');
    expect(lensOf({ ...WORLD, history: { reading: 'jung-aion' } })).toBe('aion');
    expect(lensOf({ ...WORLD, redbook: {} })).toBe('redbook');
    expect(lensOf(WORLD)).toBe('field');
  });
});
