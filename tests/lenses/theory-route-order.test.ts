import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DynamicsRoute } from '../../src/types/dynamics';

// G2, characterisation: the Theory lens's routes are curated walks. Their order is the author's, not a sort of the
// ids, the data's key order or the year: the dynamical route is four movements and sixteen stops; the Number walk is
// the QL positions #0 to #5. A generator, a "derived walk" or a later Walk runner may carry them but never reorder them.

const json = (rel: string) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));

const CURATED: Record<string, string[]> = {
  energy: ['alternating-current', 'homoclinic-point', 'stuck-attractor'],
  chaos: ['cascade-into-chaos', 'chaotic-edge', 'strange-attractor', 'phase-transition'],
  symbol: ['symmetry-building', 'symbol-emergence', 'self-organization', 'relationship', 'manifold', 'mandala-attractor', 'fractal-irreducibility'],
  return: ['neumann-stages', 'ql-cycle'],
};

describe('the dynamical route keeps its curated order', () => {
  const served = json('public/data/dynamics-route.json') as DynamicsRoute;
  const authored = json('curation/dynamics-route.json') as DynamicsRoute;

  it('serves four movements in the authored order, and the stops of each in the authored order', () => {
    expect(served.movements.map((m) => m.id)).toEqual(Object.keys(CURATED));
    for (const m of served.movements) expect(m.stops.map((s) => s.id)).toEqual(CURATED[m.id]);
  });

  it('is the authored file\'s order exactly (movements and stops), not a re-sort', () => {
    expect(authored.movements.map((m) => m.id)).toEqual(served.movements.map((m) => m.id));
    expect(authored.movements.flatMap((m) => m.stops.map((s) => s.id ?? s.concept))).toEqual(served.movements.flatMap((m) => m.stops.map((s) => s.id)));
  });

  it('is not alphabetical, so a sort would be seen: the walk\'s order is a choice', () => {
    const ids = served.movements.flatMap((m) => m.stops.map((s) => s.id));
    expect(ids).toHaveLength(16);
    expect([...ids].sort()).not.toEqual(ids);
  });

  it('numbers its movements in the order they stand', () => {
    expect(served.movements.map((m) => m.n)).toEqual(authored.movements.map((m) => m.n));
  });
});

describe('the Number walk keeps the QL positions in order', () => {
  const numbers = json('public/data/theory.json').number.numbers as { n: number; position: string }[];
  it('is one to six at #0 to #5, in that order', () => {
    expect(numbers.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(numbers.map((r) => r.position)).toEqual(['#0', '#1', '#2', '#3', '#4', '#5']);
  });
});
