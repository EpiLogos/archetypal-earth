import { describe, expect, it } from 'vitest';
import { subjectSpan, uSpan, TimeModel } from '../../src/state/timeModel';

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe('uSpan: the track a subject scopes to', () => {
  it('a single-year subject scopes nothing (no span)', () => {
    expect(uSpan([0.4])).toBeNull();
    expect(uSpan([0.4, 0.4, 0.4])).toBeNull();
  });

  it('an empty subject scopes nothing', () => {
    expect(uSpan([])).toBeNull();
  });

  it('pads the extent by 4% of the span on each side', () => {
    const s = uSpan([0.2, 0.6]);
    expect(s).not.toBeNull();
    near(s!.fromU, 0.2 - 0.016);
    near(s!.toU, 0.6 + 0.016);
  });

  it('never narrower than 3% of the full scale', () => {
    // two years a hair apart: the padded span would be tiny, so the track is widened about the middle
    const s = uSpan([0.5, 0.505]);
    expect(s).not.toBeNull();
    near(s!.toU - s!.fromU, 0.03);
    near((s!.fromU + s!.toU) / 2, 0.5025);
  });

  it('clamps to the scale at either end, keeping the minimum width', () => {
    const low = uSpan([0, 0.01]);
    expect(low!.fromU).toBe(0);
    near(low!.toU - low!.fromU, 0.03);
    const high = uSpan([0.99, 1]);
    expect(high!.toU).toBe(1);
    near(high!.toU - high!.fromU, 0.03);
  });

  it('the full scale is the full scale', () => {
    expect(uSpan([0, 1])).toEqual({ fromU: 0, toU: 1 });
  });

  it('ignores non-finite positions', () => {
    const s = uSpan([NaN, 0.2, 0.6]);
    near(s!.fromU, 0.184);
    near(s!.toU, 0.616);
    expect(uSpan([NaN, 0.3])).toBeNull();
  });

  it('for any spread of years the span is ordered, inside 0..1, wide enough, and holds every year', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + Math.floor(rnd() * 20);
      const us = Array.from({ length: n }, () => rnd() * (rnd() < 0.2 ? 0.02 : 1));
      const s = uSpan(us)!;
      expect(s.fromU).toBeGreaterThanOrEqual(0);
      expect(s.toU).toBeLessThanOrEqual(1);
      expect(s.toU).toBeGreaterThan(s.fromU);
      expect(s.toU - s.fromU).toBeGreaterThanOrEqual(Math.min(0.03, 1) - 1e-9);
      const lo = Math.min(...us), hi = Math.max(...us);
      expect(s.fromU).toBeLessThanOrEqual(lo + 1e-12);
      expect(s.toU).toBeGreaterThanOrEqual(hi - 1e-12);
    }
  });
});

describe('uSpan: bounded by the field\'s own extent, not the scale past its last year (audit #9)', () => {
  it('a padded span never runs past the field\'s last year', () => {
    // the field ends at u = 0.9 (the Aion-extended scale runs on to 1); a subject at 0.5..0.9 must not pad into the dead track
    const s = uSpan([0.5, 0.9], { fromU: 0, toU: 0.9 });
    expect(s!.toU).toBe(0.9);
    near(s!.toU - s!.fromU, 0.432);
    near(s!.fromU, 0.468);
  });
  it('the span holds the subject and stays inside the field at either end', () => {
    const low = uSpan([0.1, 0.2], { fromU: 0.1, toU: 0.9 });
    expect(low!.fromU).toBe(0.1);
    expect(low!.toU).toBeLessThanOrEqual(0.9);
    const high = uSpan([0.85, 0.9], { fromU: 0.1, toU: 0.9 });
    expect(high!.toU).toBe(0.9);
    expect(high!.fromU).toBeGreaterThanOrEqual(0.1);
  });
  it('for any spread of years, inside the given bounds, ordered, and holding every year', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const bounds = { fromU: 0.12, toU: 0.8 };
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + Math.floor(rnd() * 12);
      const us = Array.from({ length: n }, () => bounds.fromU + rnd() * (bounds.toU - bounds.fromU));
      const s = uSpan(us, bounds)!;
      expect(s.fromU).toBeGreaterThanOrEqual(bounds.fromU - 1e-12);
      expect(s.toU).toBeLessThanOrEqual(bounds.toU + 1e-12);
      expect(s.toU).toBeGreaterThan(s.fromU);
      expect(s.fromU).toBeLessThanOrEqual(Math.min(...us) + 1e-12);
      expect(s.toU).toBeGreaterThanOrEqual(Math.max(...us) - 1e-12);
    }
  });
});

describe('subjectSpan: the span of a subject\'s located occurrences', () => {
  // a model stub: only the positions matter; occurrences 1 and 3 belong to the subject
  const m = { u: [0.9, 0.2, 0.95, 0.6, 0.05] };

  it('reads the positions of the subject\'s occurrences only', () => {
    const s = subjectSpan(m, [1, 3]);
    near(s!.fromU, 0.2 - 0.016);
    near(s!.toU, 0.6 + 0.016);
  });

  it('a subject with one distinct year scopes nothing', () => {
    expect(subjectSpan({ u: [0.3, 0.3, 0.7] }, [0, 1])).toBeNull();
    expect(subjectSpan(m, [2])).toBeNull();
  });
});

describe('the cursor follows a scoped track', () => {
  it('a cursor outside the scoped range is clamped into it, and scrubbing stays inside', () => {
    const time = new TimeModel();
    time.scrub(0.9);
    time.setRange(0.2, 0.4);
    expect(time.cursorU).toBe(0.4);
    time.scrub(0.05);
    expect(time.cursorU).toBe(0.2);
    time.scrub(0.3);
    expect(time.cursorU).toBeCloseTo(0.3, 12);
  });

  it('in all-time mode the cursor goes to the new end of the range', () => {
    const time = new TimeModel();
    time.setRange(0.2, 0.4);
    expect(time.mode).toBe('all');
    expect(time.cursorU).toBe(0.4);
  });
});
