// The dynamical lens as a state: the Esc ladder, presence-compared equality, depth, and the hash round-trip.
import { describe, expect, it } from 'vitest';
import { back, depthOf, stateEq, WORLD, type AppState } from '../../src/state/store';
import { hashToState, stateToHash, type Resolver } from '../../src/state/router';

const serpent = { type: 'family', id: 'serpent' } as const;
const tree = { type: 'family', id: 'tree' } as const;
const self = { type: 'archetype', id: 'self' } as const;
const lens = (subject?: { type: 'family' | 'archetype'; id: string }): AppState => ({ view: { kind: 'world' }, deep: false, dynamics: subject ? { subject } : {} });

const r: Resolver = {
  hasArchetype: (id) => id === 'self',
  hasFamily: (id) => ['serpent', 'tree'].includes(id),
  hasCulture: (id) => id === 'norse',
  hasPlace: (id) => id === 'chartres',
  familyOf: (id) => (id.startsWith('serpent-') ? 'serpent' : undefined),
};

describe('the lens: the Esc ladder', () => {
  it('a subject climbs to the bare lens (the Self), and the bare lens closes onto the world', () => {
    const onSerpent = lens(serpent);
    const bare = back(onSerpent);
    expect(bare.dynamics).toEqual({});
    expect(bare.view.kind).toBe('world');
    expect(back(bare)).toEqual(WORLD);
  });

  it('the bare lens is never a trap: back() always leaves it', () => {
    expect(back(lens())).toEqual(WORLD);
  });
});

describe('the lens: equality is by presence and by subject', () => {
  it('a bare lens and the plain world differ, both ways', () => {
    expect(stateEq(lens(), WORLD)).toBe(false);
    expect(stateEq(WORLD, lens())).toBe(false);
  });

  it('a lens with no subject and a lens on a subject differ, both ways', () => {
    expect(stateEq(lens(), lens(serpent))).toBe(false);
    expect(stateEq(lens(serpent), lens())).toBe(false);
  });

  it('two lenses on the same subject are equal; on different subjects they differ', () => {
    expect(stateEq(lens(serpent), lens({ ...serpent }))).toBe(true);
    expect(stateEq(lens(serpent), lens(tree))).toBe(false);
    expect(stateEq(lens(), lens())).toBe(true);
  });

  it('the lens differs from Red Book and sky states of the same view', () => {
    expect(stateEq(lens(), { ...WORLD, redbook: {} })).toBe(false);
    expect(stateEq(lens(), { ...WORLD, sky: {} })).toBe(false);
  });
});

describe('the lens: depth', () => {
  it('the bare lens is one level, a subject two', () => {
    expect(depthOf(WORLD)).toBe(0);
    expect(depthOf(lens())).toBe(1);
    expect(depthOf(lens(serpent))).toBe(2);
  });
});

describe('the lens: hash route', () => {
  it('formats the bare lens and a subject with the focus route codes', () => {
    expect(stateToHash(lens())).toBe('#/dynamics');
    expect(stateToHash(lens(serpent))).toBe('#/dynamics/f/serpent');
    expect(stateToHash(lens(self))).toBe('#/dynamics/a/self');
  });

  it('round-trips the bare lens and each subject', () => {
    for (const s of [lens(), lens(serpent), lens(self)]) {
      const parsed = hashToState(stateToHash(s), r);
      expect(stateEq(parsed.state, s), stateToHash(s)).toBe(true);
      expect(parsed.state.view.kind).toBe('world');
    }
  });

  it('an unknown subject opens the bare lens, never the world', () => {
    expect(hashToState('#/dynamics/f/nope', r).state).toEqual(lens());
    expect(hashToState('#/dynamics/x/serpent', r).state).toEqual(lens());
    expect(hashToState('#/dynamics/f', r).state).toEqual(lens());
  });
});
