import { describe, expect, it } from 'vitest';
import { CHRONO_MAX_HOPS, CHRONO_MIN_ANGLE, chronologyPath, chronologyProgress, type ChronoPoint } from '../../src/globe/chronology';
import { dirFromLatLon, type Vec3 } from '../../src/data/geo';
import { DEFAULT_RAMP, DEFAULT_TRAIL } from '../../src/data/time';

const pt = (u: number, lat: number, lon: number): ChronoPoint => ({ u, dir: dirFromLatLon(lat, lon) as Vec3 });

describe('chronologyPath: the places a subject passed through, in date order', () => {
  it('orders the located occurrences by date, whatever order they arrive in', () => {
    const pts = [pt(0.7, 0, 0), pt(0.2, 0, 60), pt(0.5, 0, 120)];
    expect(chronologyPath(pts).map((i) => pts[i].u)).toEqual([0.2, 0.5, 0.7]);
  });

  it('keeps one place for occurrences within ~300 km of the last place kept', () => {
    // three occurrences within a few tens of km of one another, then a distant place
    const pts = [pt(0.1, 41.9, 12.5), pt(0.2, 41.95, 12.52), pt(0.3, 41.9, 12.45), pt(0.4, 37.98, 23.72)];
    const path = chronologyPath(pts);
    expect(path.map((i) => pts[i].u)).toEqual([0.1, 0.4]);
  });

  it('a place returned to after another is a new hop, not a duplicate', () => {
    const pts = [pt(0.1, 41.9, 12.5), pt(0.2, 37.98, 23.72), pt(0.3, 41.9, 12.5)];
    expect(chronologyPath(pts)).toHaveLength(3);
  });

  it('the dedupe threshold is ~300 km as an angle on the globe', () => {
    expect(CHRONO_MIN_ANGLE * 6371).toBeCloseTo(300, 6);
  });

  it('returns every place when the path is within the hop cap', () => {
    const pts = Array.from({ length: CHRONO_MAX_HOPS + 1 }, (_, k) => pt(k / 100, 0, k * 4));
    expect(chronologyPath(pts)).toHaveLength(CHRONO_MAX_HOPS + 1);
  });

  it('caps a long path at the hop cap, choosing places nearest to evenly spaced dates', () => {
    // 100 places a little over 3.5 degrees apart on the equator (well past 300 km), dated evenly
    const N = 100;
    const pts = Array.from({ length: N }, (_, k) => pt(k / (N - 1), 0, k * 3.6));
    const path = chronologyPath(pts);
    expect(path).toHaveLength(CHRONO_MAX_HOPS + 1);
    // strictly increasing: no place is repeated and the order is the date order
    for (let k = 1; k < path.length; k++) expect(path[k]).toBeGreaterThan(path[k - 1]);
    expect(path[0]).toBe(0);
    expect(path[path.length - 1]).toBe(N - 1);
    // each chosen date is the nearest available to its evenly spaced target (within one sample)
    for (let k = 0; k < path.length; k++) {
      const target = (k * (N - 1)) / CHRONO_MAX_HOPS;
      expect(Math.abs(path[k] - target)).toBeLessThanOrEqual(1);
    }
  });

  it('is empty for an empty subject', () => {
    expect(chronologyPath([])).toEqual([]);
  });
});

describe('chronologyProgress: each arc, from the cursor', () => {
  // three places: arc 0 runs 0.2 -> 0.4, arc 1 runs 0.4 -> 0.6
  const nodes = [0.2, 0.4, 0.6];
  const at = (c: number, reduced = false) => chronologyProgress(nodes, c, DEFAULT_TRAIL, DEFAULT_RAMP, reduced);

  it('has one entry per arc and none for a path with fewer than two places', () => {
    expect(at(0.5)).toHaveLength(2);
    expect(chronologyProgress([0.3], 0.5, DEFAULT_TRAIL, DEFAULT_RAMP)).toEqual([]);
    expect(chronologyProgress([], 0.5, DEFAULT_TRAIL, DEFAULT_RAMP)).toEqual([]);
  });

  it('nothing is drawn before the first arc begins, and nothing is present', () => {
    for (const p of at(0.1)) { expect(p.draw).toBe(0); expect(p.alpha).toBe(0); }
  });

  it('an arc travels in proportion to how far the cursor has passed its destination date', () => {
    // midway between 0.2 and 0.4 the first arc is half drawn; the second has not begun
    const mid = at(0.3);
    expect(mid[0].draw).toBeCloseTo(0.5, 9);
    expect(mid[1].draw).toBe(0);
    // the cursor at 0.5 is a quarter of the way along the second arc
    expect(at(0.5)[1].draw).toBeCloseTo(0.5, 9);
  });

  it('arcs are whole once the cursor has passed their destination', () => {
    const late = at(0.7);
    expect(late[0].draw).toBe(1);
    expect(late[1].draw).toBe(1);
  });

  it('the total travel never falls as the cursor moves forward', () => {
    let prev = -1;
    for (let c = 0; c <= 0.8; c += 0.01) {
      const travel = at(c).reduce((s, p) => s + p.draw, 0);
      expect(travel).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = travel;
    }
  });

  it('scrubbing back retraces the same values (the state is a function of the cursor alone)', () => {
    const forward = [0.25, 0.35, 0.45, 0.55].map((c) => at(c));
    const back = [0.55, 0.45, 0.35, 0.25].map((c) => at(c));
    expect(back.reverse()).toEqual(forward);
    // and scrubbing back un-draws the second arc
    expect(at(0.5)[1].draw).toBeGreaterThan(0);
    expect(at(0.41)[1].draw).toBeLessThan(at(0.5)[1].draw);
    expect(at(0.39)[1].draw).toBe(0);
  });

  it('arcs fade in from their origin over the ramp', () => {
    expect(at(0.2)[0].alpha).toBe(0);
    expect(at(0.2 + DEFAULT_RAMP)[0].alpha).toBeCloseTo(1, 9);
    expect(at(0.2 + DEFAULT_RAMP / 2)[0].alpha).toBeGreaterThan(0);
    expect(at(0.2 + DEFAULT_RAMP / 2)[0].alpha).toBeLessThan(1);
  });

  it('an arc leaves once the cursor is a trail past its destination, so the line migrates with the present', () => {
    // destination of arc 0 is 0.4: at 0.4 + trail it is gone; just inside the window it is still there
    expect(at(0.4 + DEFAULT_TRAIL)[0].alpha).toBe(0);
    expect(at(0.4 + DEFAULT_TRAIL * 0.3)[0].alpha).toBeCloseTo(1, 9);
    // its progress is kept: it is still whole, only no longer present
    expect(at(0.4 + DEFAULT_TRAIL)[0].draw).toBe(1);
  });

  it('reduced motion: an arc is whole from its origin (fade only, no travel)', () => {
    const p = at(0.3, true);
    expect(p[0].draw).toBe(1);
    expect(p[1].draw).toBe(0);
    expect(at(0.41, true)[1].draw).toBe(1);
  });

  it('an arc between places on one date is drawn at once on reaching that date', () => {
    const same = chronologyProgress([0.5, 0.5], 0.49, DEFAULT_TRAIL, DEFAULT_RAMP);
    expect(same[0].draw).toBe(0);
    expect(chronologyProgress([0.5, 0.5], 0.5, DEFAULT_TRAIL, DEFAULT_RAMP)[0].draw).toBe(1);
  });

  it('values stay within 0..1', () => {
    for (let c = -0.1; c <= 1.1; c += 0.02) {
      for (const p of at(c)) {
        expect(p.draw).toBeGreaterThanOrEqual(0);
        expect(p.draw).toBeLessThanOrEqual(1);
        expect(p.alpha).toBeGreaterThanOrEqual(0);
        expect(p.alpha).toBeLessThanOrEqual(1);
      }
    }
  });
});
