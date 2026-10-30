import { describe, expect, it } from 'vitest';
import { hashToState, hashWithFilter, type Resolver } from '../../src/state/router';
import { focusOn, inLens, stateEq, WORLD, type AppState } from '../../src/state/store';
import { lensOf } from '../../src/shell/lens';
import { filterEq, filterQuery, parseFilter, type FieldFilter } from '../../src/shell/filter';

// G2, characterisation: the field filter is one filter for every lens (MODES-RFC §4). Changing lens must neither drop
// it nor rewrite it: every lens's route carries the same query after it, and reading that hash back gives the same
// lens and the same filter. (The controller keeps `filter` outside the lens state; tests/ui/e2e/guards-g2.mjs walks
// the same thing in a browser.)

const r: Resolver = {
  hasArchetype: (id) => id === 'self', hasFamily: (id) => id === 'serpent', hasCulture: (id) => id === 'gnostic', hasPlace: () => false,
  hasTheoretic: () => false, familyOf: () => undefined, hasBody: () => false,
  defaultReading: () => 'jung-aion',
  hasReading: (id) => id === 'jung-aion',
  hasHistorySelection: () => true,
};

const FILTER: FieldFilter = { works: ['cw12', 'cw09ii'], cultures: ['gnostic'], era: [-200, 400], kinds: ['dream'], archetypes: ['self'], theoretics: ['psychoid'] };

/** One state per lens the shell offers, as the router names it. */
const LENSES: [string, AppState][] = [
  ['field', focusOn(WORLD, { type: 'archetype', id: 'self' })],
  ['theory', inLens('theory', ['number'])],
  ['alchemy', inLens('alchemy')],
  ['astrology', inLens('astrology')],
  ['dreams', inLens('dreams')],
  ['symbols', inLens('symbols')],
  ['coincidences', inLens('coincidences')],
  ['aion', { ...WORLD, history: { reading: 'jung-aion' } }],
  ['redbook', { ...WORLD, redbook: {} }],
  ['theory', { ...WORLD, dynamics: {} }],
];

describe('the field filter across a lens change', () => {
  it.each(LENSES)('%s: the route carries the filter after it, and reading it back gives the same lens and filter', (id, state) => {
    const hash = hashWithFilter(state, FILTER);
    expect(hash.endsWith(`?${filterQuery(FILTER)}`)).toBe(true);
    const back = hashToState(hash, r);
    expect(filterEq(back.filter, FILTER)).toBe(true);
    expect(lensOf(back.state)).toBe(id);
    expect(stateEq(back.state, state)).toBe(true);
  });

  it('changing lens with the same filter changes only the route, never the filter', () => {
    const queries = new Set(LENSES.map(([, s]) => hashWithFilter(s, FILTER).split('?')[1]));
    expect(queries.size).toBe(1);
    expect(parseFilter([...queries][0])).toEqual(FILTER);
  });

  it('an empty filter adds no query to any lens\'s route', () => {
    for (const [, s] of LENSES) expect(hashWithFilter(s, {}).includes('?')).toBe(false);
  });
});
