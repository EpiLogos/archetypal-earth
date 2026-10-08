import { describe, expect, it } from 'vitest';
import { createTimeScale, formatYear, timeVisibility, DEFAULT_RAMP, DEFAULT_TRAIL } from '../../src/data/time';

describe('time scale', () => {
  const sc = createTimeScale(-3000, 1960);

  it('maps the end points to 0 and 1 and is monotonic', () => {
    expect(sc.toU(-3000)).toBe(0);
    expect(sc.toU(1960)).toBe(1);
    let prev = -1;
    for (let y = -3000; y <= 1960; y += 50) {
      const u = sc.toU(y);
      expect(u).toBeGreaterThan(prev);
      prev = u;
    }
  });

  it('compresses antiquity and expands 0–1960', () => {
    const ancient = sc.toU(0) - sc.toU(-3000); // 3000 years
    const modern = sc.toU(1960) - sc.toU(0); // 1960 years
    expect(ancient / 3000).toBeLessThan(modern / 1960 / 2);
    expect(modern).toBeGreaterThan(0.6);
  });

  it('round-trips through fromU', () => {
    for (const y of [-2500, -1000, -1, 0, 333, 1000, 1492, 1900]) {
      expect(sc.fromU(sc.toU(y))).toBeCloseTo(y, 3);
    }
  });

  it('adapts when the data range changes', () => {
    const wide = createTimeScale(-40000, 1960);
    expect(wide.toU(-40000)).toBe(0);
    expect(wide.toU(0)).toBeGreaterThan(0.2);
    const narrow = createTimeScale(1200, 1960);
    expect(narrow.toU(1200)).toBe(0);
    expect(narrow.toU(1960)).toBe(1);
    expect(narrow.toU(1500)).toBeGreaterThan(0);
  });

  it('names eras only within the range', () => {
    expect(sc.eras.map((e) => e.name)).toEqual(['Antiquity', 'Late antiquity', 'Middle Ages', 'Renaissance', 'Modern']);
    const modernOnly = createTimeScale(1500, 1960);
    expect(modernOnly.eras.map((e) => e.name)).toEqual(['Renaissance', 'Modern']);
  });

  it('formats years', () => {
    expect(formatYear(-3000)).toBe('3,000 BCE');
    expect(formatYear(1486.4)).toBe('1486');
  });
});

describe('time visibility', () => {
  const w = (cursorU: number, on = 1) => ({ on, cursorU, trail: DEFAULT_TRAIL, ramp: DEFAULT_RAMP });

  it('shows everything in "all time"', () => {
    expect(timeVisibility(0.1, w(0.5, 0))).toBe(1);
    expect(timeVisibility(0.9, w(0.2, 0))).toBe(1);
  });

  it('hides what has not happened yet', () => {
    expect(timeVisibility(0.6, w(0.5))).toBe(0);
  });

  it('fades in as the cursor reaches an occurrence', () => {
    const just = timeVisibility(0.5, w(0.5 + DEFAULT_RAMP / 2));
    const done = timeVisibility(0.5, w(0.5 + DEFAULT_RAMP * 2));
    expect(just).toBeGreaterThan(0);
    expect(just).toBeLessThan(1);
    expect(done).toBe(1);
  });

  it('fades over the trailing window', () => {
    const early = timeVisibility(0.5, w(0.5 + DEFAULT_TRAIL * 0.3));
    const late = timeVisibility(0.5, w(0.5 + DEFAULT_TRAIL * 0.8));
    const gone = timeVisibility(0.5, w(0.5 + DEFAULT_TRAIL * 1.2));
    expect(early).toBe(1);
    expect(late).toBeLessThan(1);
    expect(late).toBeGreaterThan(0);
    expect(gone).toBe(0);
  });

  it('blends between modes with `on`', () => {
    expect(timeVisibility(0.6, w(0.5, 0.5))).toBeCloseTo(0.5, 5);
  });
});
