import { describe, expect, it } from 'vitest';
import { centreStrength, chargeReach, chargeStrength, DEFAULT_FORCES, FORCE_ROWS, linkDistance, linkStrength, type Forces } from '../../src/graph/forces';
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
