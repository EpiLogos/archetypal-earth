import { describe, expect, it } from 'vitest';
import { centreStrength, chargeReach, chargeStrength, DEFAULT_FORCES, dustLiveFactor, FORCE_ROWS, forceMultiple, linkDistance, linkStrength, liveFactor, type Forces } from '../../src/graph/forces';
import type { GEdge } from '../../src/graph/build';

const tie = (basis: 'jung' | 'inferred' | 'site'): GEdge => ({ s: 0, t: 1, kind: 'tie', basis });
const co: GEdge = { s: 0, t: 1, kind: 'co' };

describe('the four forces', () => {
  it('draws the default arrangement as it always was', () => {
    expect(centreStrength(false, DEFAULT_FORCES)).toBeCloseTo(0.018 * 0.8, 9);
    expect(chargeStrength('archetype', true, 0, false, DEFAULT_FORCES)).toBeCloseTo(-1500 * 0.8, 9);
    expect(linkDistance(tie('jung'), false, DEFAULT_FORCES)).toBeCloseTo(92 * 1.25, 9);
    expect(linkStrength(tie('jung'), false, DEFAULT_FORCES)).toBeCloseTo(0.5, 9);
  });

  // B5 (the inversion): more 'centre' used to strengthen the repulsion too, so the field spread out.
  it('Centre never repels: raising it leaves the push between forms untouched', () => {
    const more: Forces = { ...DEFAULT_FORCES, centre: 2 };
    expect(chargeStrength('family', false, 0.5, false, more)).toBe(chargeStrength('family', false, 0.5, false, DEFAULT_FORCES));
    expect(centreStrength(false, more)).toBeGreaterThan(centreStrength(false, DEFAULT_FORCES));
  });

  it('Repel raises the push and leaves the centre alone', () => {
    const more: Forces = { ...DEFAULT_FORCES, repel: 1.6 };
    expect(Math.abs(chargeStrength('family', false, 0.5, false, more))).toBeGreaterThan(Math.abs(chargeStrength('family', false, 0.5, false, DEFAULT_FORCES)));
    expect(centreStrength(false, more)).toBe(centreStrength(false, DEFAULT_FORCES));
  });

  it('Link force holds the ends harder; Link distance only lengthens them', () => {
    const f: Forces = { ...DEFAULT_FORCES, link: 1.8 };
    expect(linkStrength(tie('inferred'), false, f)).toBeGreaterThan(linkStrength(tie('inferred'), false, DEFAULT_FORCES));
    expect(linkDistance(tie('inferred'), false, f)).toBe(linkDistance(tie('inferred'), false, DEFAULT_FORCES));
    const d: Forces = { ...DEFAULT_FORCES, distance: 1.6 };
    expect(linkDistance(co, false, d)).toBeGreaterThan(linkDistance(co, false, DEFAULT_FORCES));
    expect(linkStrength(co, false, d)).toBe(linkStrength(co, false, DEFAULT_FORCES));
    expect(chargeReach(d)).toBeGreaterThan(chargeReach(DEFAULT_FORCES));
  });

  it('a tie to the Self is drawn but never drags it from the centre, whatever the link force', () => {
    const sky: GEdge = { s: 0, t: 1, kind: 'sky', basis: 'jung' };
    expect(linkStrength(sky, true, { ...DEFAULT_FORCES, link: 2.5 })).toBeLessThanOrEqual(0.004 * 2.5 + 1e-9);
  });

  it('every slider starts on its own grid, inside its range, and says what it does', () => {
    expect(FORCE_ROWS.map((r) => r.key)).toEqual(['centre', 'repel', 'link', 'distance']);
    for (const r of FORCE_ROWS) {
      const v = DEFAULT_FORCES[r.key];
      expect(v).toBeGreaterThanOrEqual(r.min);
      expect(v).toBeLessThanOrEqual(r.max);
      expect(Math.abs((v - r.min) / r.step - Math.round((v - r.min) / r.step))).toBeLessThan(1e-9);
      expect(r.tip.length).toBeGreaterThan(20);
    }
  });
});

// B7 (centre in a local graph): the subject-held neighbourhood used to have no pull at all, so Centre did nothing there.
describe('Centre in a local graph', () => {
  it('has a small base of its own, so the slider gathers the neighbourhood', () => {
    expect(centreStrength(true, DEFAULT_FORCES)).toBeCloseTo(0.004 * 0.8, 9);
    expect(centreStrength(true, DEFAULT_FORCES)).toBeGreaterThan(0);
  });

  it('rises with Centre, and stays well below the whole field\'s pull at the same setting', () => {
    const more: Forces = { ...DEFAULT_FORCES, centre: 6 };
    expect(centreStrength(true, more)).toBeGreaterThan(centreStrength(true, DEFAULT_FORCES) * 7);
    expect(centreStrength(true, more)).toBeLessThan(centreStrength(false, more) / 4);
  });
});

// B8 (time-aware layout): the factor is exactly 1 in 'all time', and monotone in liveness while the cursor scrubs.
describe('the live factor', () => {
  it('is exactly 1 when the cursor is not scrubbing, whatever the liveness', () => {
    for (const a of [0, 0.05, 0.5, 1]) for (const b of [0, 0.26, 1]) expect(liveFactor(a, b, 0)).toBe(1);
    for (const a of [0, 0.5, 1]) expect(dustLiveFactor('occurrence', a, 0)).toBe(1);
  });

  it('is monotone in each end\'s liveness, and spans 0.25 (both ghosts) to 1 (both live)', () => {
    expect(liveFactor(1, 1, 1)).toBeCloseTo(1, 12);
    expect(liveFactor(0, 0, 1)).toBeCloseTo(0.25, 12);
    expect(liveFactor(0.2, 0.9, 1)).toBeLessThan(liveFactor(0.6, 0.9, 1));
    expect(liveFactor(0.6, 0.2, 1)).toBeLessThan(liveFactor(0.6, 0.9, 1));
    let prev = -Infinity;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const f = liveFactor(x, 0.8, 1);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('a ghost repels half as hard as a live occurrence, and only occurrences change', () => {
    expect(dustLiveFactor('occurrence', 1, 1)).toBeCloseTo(1, 12);
    expect(dustLiveFactor('occurrence', 0, 1)).toBeCloseTo(0.5, 12);
    expect(dustLiveFactor('family', 0, 1)).toBe(1);
    expect(dustLiveFactor('archetype', 0, 1)).toBe(1);
  });

  it('treats a non-finite liveness as a ghost, never as a number that breaks the layout', () => {
    expect(Number.isFinite(liveFactor(Number.NaN, 1, 1))).toBe(true);
    expect(liveFactor(Number.NaN, 1, 1)).toBeCloseTo(0.25, 12);
  });
});

// B9 (the readouts): every force reads 1.00× at rest, so the sheet is honest about what the default is.
describe('the readouts', () => {
  it('show each default as 1.00× and scale the rest from it', () => {
    for (const r of FORCE_ROWS) expect(forceMultiple(r.key, DEFAULT_FORCES[r.key]).toFixed(2)).toBe('1.00');
    expect(forceMultiple('centre', 1.6)).toBeCloseTo(2, 9);
  });
});
