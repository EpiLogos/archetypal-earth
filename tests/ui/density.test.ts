import { describe, expect, it } from 'vitest';
import { binCounts, citeCounts, citeSpan, smooth } from '../../src/ui/density';

describe('the strip density', () => {
  const u = [0, 0.1, 0.5, 0.5, 0.9, 1];
  const located = [1, 1, 1, 0, 1, 1];

  it('counts each placed presence in exactly one bin', () => {
    const { counts, n } = binCounts({ u, located, subset: null, slice: null, fromU: 0, toU: 1, bins: 10 });
    expect(n).toBe(5);
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(5);
    expect(counts[9]).toBe(2);
  });

  it('leaves out what the slice does not hold, what is outside the range and what is not placed', () => {
    expect(binCounts({ u, located, subset: null, slice: [1, 0, 1, 1, 1, 0], fromU: 0, toU: 1, bins: 10 }).n).toBe(3);
    expect(binCounts({ u, located, subset: null, slice: null, fromU: 0.2, toU: 0.8, bins: 10 }).n).toBe(1);
    expect(binCounts({ u, located, subset: [2, 3, 4], slice: null, fromU: 0, toU: 1, bins: 10 }).n).toBe(2);
  });

  it('smooths a count over its neighbours without moving where it stands', () => {
    const s = smooth(Float32Array.from([0, 0, 0, 5, 0, 0, 0, 0]));
    expect(s[3]).toBe(5);
    expect(s[2]).toBeGreaterThan(0);
    expect(s[7]).toBe(0);
  });
});

describe('Jung\'s second axis', () => {
  const occ = [
    { jung: [{ citeYear: 1936 }, { citeYear: 1936 }, { citeYear: 1944 }] },
    { jung: [{ citeYear: 1944 }, {}] },
    { jung: [] },
    { jung: [{ citeYear: 1960 }] },
  ];
  const located = [1, 1, 1, 0];

  it('counts each distinct cite year of an occurrence once, and only what is placed', () => {
    const { counts, n } = citeCounts({ occ, located, subset: null, slice: null, fromYear: 1930, toYear: 1950, bins: 20 });
    expect(n).toBe(3);
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(3);
    expect(counts[6]).toBe(1);
    expect(counts[14]).toBe(2);
  });

  it('follows the slice and the subject, and leaves out a year off the axis', () => {
    expect(citeCounts({ occ, located, subset: null, slice: [1, 1, 0, 1], fromYear: 1930, toYear: 1950, bins: 20 }).n).toBe(3);
    expect(citeCounts({ occ, located, subset: null, slice: [1, 1, 1, 1], fromYear: 1940, toYear: 1950, bins: 20 }).n).toBe(2);
    expect(citeCounts({ occ, located, subset: [1], slice: null, fromYear: 1930, toYear: 1950, bins: 20 }).n).toBe(1);
  });

  it('spans the first and last year anything cites; none when no cite names a year', () => {
    expect(citeSpan(occ)).toEqual([1936, 1960]);
    expect(citeSpan([{ jung: [{}] }])).toBeNull();
  });
});
