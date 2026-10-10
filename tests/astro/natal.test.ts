import { describe, expect, it } from 'vitest';
import golden from '../sky/golden/birth.json';
import sky from '../../public/data/sky.json';
import { angles, birthInstant, birthProblems, CHART_BODIES, meanTimeOffset, natalChart, natalWindow, type BirthData } from '../../src/astro/natal';
import { SkyEphemeris } from '../../src/sky/ephemeris';
import { dataWithWindow, chartProblems } from '../../src/sky/sidecar';
import type { SidecarChart, SkyData } from '../../src/types/sky';

// The golden charts were computed by the local sidecar (Swiss Ephemeris via Kerykeion). The browser's chart must agree.
const cases = golden.cases.map((c) => c.chart as unknown as SidecarChart);
const birthOf = (c: SidecarChart): BirthData => {
  const [date, time] = c.input.local.split('T');
  return { date, time, offsetMinutes: c.input.utcOffsetMinutes, lat: c.input.lat, lon: c.input.lon, place: '' };
};
const sep = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

describe('the browser natal chart agrees with the sidecar', () => {
  for (const g of cases) {
    // the golden's utc comes from the tz database (seconds included for local mean time); cast at exactly that instant
    const b = birthOf(g);
    const shift = (Date.parse(g.utc) - birthInstant(b)) / 60_000;
    const at: BirthData = { ...b, offsetMinutes: b.offsetMinutes - shift };
    const c = natalChart(at);
    it(`${g.input.local} at ${g.input.lat}, ${g.input.lon}: every body within 0.02°, same sign and motion`, () => {
      for (const k of CHART_BODIES) {
        expect(sep(c.bodies[k]!.lon, g.bodies[k]!.lon), k).toBeLessThan(0.02);
        expect(c.bodies[k]!.sign, k).toBe(g.bodies[k]!.sign);
        expect(c.bodies[k]!.retrograde, k).toBe(g.bodies[k]!.retrograde);
      }
    });
    it(`${g.input.local}: Ascendant and Midheaven within 0.05°, sidereal time within 0.01°`, () => {
      expect(sep(c.angles.ascendant.lon, g.angles.ascendant.lon)).toBeLessThan(0.05);
      expect(sep(c.angles.midheaven.lon, g.angles.midheaven.lon)).toBeLessThan(0.05);
      expect(sep(c.gmst, g.gmst)).toBeLessThan(0.01);
    });
    it(`${g.input.local}: the same aspects the sidecar names`, () => {
      const key = (a: { a: string; b: string; type: string }) => [a.a, a.b].sort().join('-') + ':' + a.type;
      const mine = new Set(c.aspects.map(key));
      const theirs = g.aspects.filter((a) => CHART_BODIES.includes(a.a as never) && CHART_BODIES.includes(a.b as never)).map(key);
      for (const t of theirs) expect(mine.has(t), t).toBe(true);
    });
    it(`${g.input.local}: keeps the chart contract the page codes to`, () => {
      expect(chartProblems(c)).toEqual([]);
    });
  }
});

describe('the window feeds the sky layer unchanged', () => {
  it('the generated sky’s interpolator reads it and puts the Moon where the chart does', () => {
    const g = cases[0];
    const ms = Date.parse(g.utc);
    const eph = new SkyEphemeris(dataWithWindow(sky as unknown as SkyData, natalWindow(ms)));
    expect(eph.covers(ms)).toBe(true);
    expect(sep(eph.geo('moon', ms)!.lon, g.bodies.moon!.lon)).toBeLessThan(0.05);
    expect(sep(eph.geo('mars', ms)!.lon, g.bodies.mars!.lon)).toBeLessThan(0.05);
  });
});

describe('births the form accepts', () => {
  it('refuses what cannot be cast, in plain words', () => {
    expect(birthProblems({ date: '1990-02-30', time: null, offsetMinutes: 0, lat: 0, lon: 0 })).toContain('That date does not exist.');
    expect(birthProblems({ date: '1990-01-01', time: '25:00', offsetMinutes: 0, lat: 0, lon: 0 }).length).toBe(1);
    expect(birthProblems({ date: '1990-01-01', time: null, offsetMinutes: 0, lat: 95, lon: 0 }).length).toBe(1);
    expect(birthProblems({ date: '1875-07-26', time: null, offsetMinutes: 37, lat: 47.6, lon: 9.32 })).toEqual([]);
  });
  it('with no time, casts local noon and draws no angles', () => {
    const c = natalChart({ date: '1875-07-26', time: null, offsetMinutes: meanTimeOffset(9.32), lat: 47.6, lon: 9.32, place: 'Kesswil' });
    expect(c.timeKnown).toBe(false);
    expect(c.approximate).toBe(true);
    expect(c.utc).toBe('1875-07-26T11:23:00Z');
    expect(c.bodies.sun!.sign).toBe('Leo');
  });
  it('the angles move with the place as they should (the Midheaven does not depend on latitude)', () => {
    const ms = Date.UTC(2000, 0, 1, 12);
    expect(sep(angles(ms, 10, 0).mc, angles(ms, 60, 0).mc)).toBeLessThan(1e-9);
    expect(sep(angles(ms, 10, 0).asc, angles(ms, 60, 0).asc)).toBeGreaterThan(1);
  });
});
