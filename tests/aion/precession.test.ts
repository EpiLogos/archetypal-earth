import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  accumulatedPrecession, AYANAMSA, ayanamsa, CONSTELLATION_NAMES, conventionTicks, entersAfter, equinoxPlace, generalPrecessionIau2006,
  IAU_BOUNDARIES, J2000_JD, jdOfYear, meanObliquityDeg, stayNear, stays, type AyanamsaKey,
} from '../../src/aion/precession';
import type { SkyData } from '../../src/types/sky';

const sky = JSON.parse(readFileSync(new URL('../../public/data/sky.json', import.meta.url), 'utf8')) as SkyData;
const golden = sky.golden.ayanamsa;
const wrapDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const ARCMIN = 1 / 60;

describe('the calendar', () => {
  it('reproduces every Julian Date in the golden table (proleptic Gregorian, 1 January 12:00)', () => {
    for (const row of golden.table) expect(jdOfYear(row.year), `year ${row.year}`).toBeCloseTo(row.jd, 6);
    expect(jdOfYear(2000)).toBe(2451545);
  });
});

describe('the ayanamsa definitions are the sidecar\u2019s', () => {
  it('match golden.ayanamsa.definitions exactly', () => {
    for (const key of Object.keys(AYANAMSA) as AyanamsaKey[]) {
      expect(AYANAMSA[key].valueDeg).toBe(golden.definitions[key].valueDeg);
      expect(AYANAMSA[key].epochJdTT).toBe(golden.definitions[key].epochJdTT);
    }
  });
  it('are by construction exact at their own epoch', () => {
    for (const key of Object.keys(AYANAMSA) as AyanamsaKey[]) expect(ayanamsa(AYANAMSA[key].epochJdTT, key)).toBeCloseTo(AYANAMSA[key].valueDeg, 9);
  });
});

describe('Vondr\u00e1k 2011 against the golden table across \u00b113 millennia', () => {
  const rows = golden.table;
  it('has the table the plan asks for: 500-year steps from \u221213000 to +13000, and \u22126, 0, 1900, 2000, 2026', () => {
    const years = rows.map((r) => r.year);
    for (let y = -13000; y <= 13000; y += 500) expect(years).toContain(y);
    for (const y of [-6, 0, 1900, 2000, 2026]) expect(years).toContain(y);
  });
  for (const key of ['fagan-bradley', 'lahiri'] as const) {
    it(`${key}: every row within an arcminute (worst case reported)`, () => {
      let worst = 0;
      let at = 0;
      for (const row of rows) {
        const d = wrapDiff(ayanamsa(row.jd, key), row[key]);
        if (d > worst) { worst = d; at = row.year; }
      }
      expect(at).toBeTypeOf('number');
      expect(worst).toBeLessThan(ARCMIN);
    });
  }
});

describe('IAU 2006 cross-check', () => {
  it('is zero at J2000.0 and 5028.796195\u2033 per century at first order', () => {
    expect(generalPrecessionIau2006(J2000_JD)).toBe(0);
    const c = generalPrecessionIau2006(J2000_JD + 36525);
    expect(c * 3600).toBeCloseTo(5028.796195 + 1.1054348 + 0.00007964 - 0.000023857 - 0.0000000383, 6);
  });
  it('agrees with the long-term model within 2\u2033 from 2000 BCE to 4000 CE', () => {
    for (const y of [-2000, -1000, 0, 1000, 1800, 1900, 1950, 2000, 2026, 2050, 2100, 3000, 4000]) {
      const jd = jdOfYear(y);
      const d = Math.abs(generalPrecessionIau2006(jd) - accumulatedPrecession(jd, J2000_JD)) * 3600;
      expect(d, `year ${y}`).toBeLessThan(2);
    }
  });
  it('leaves it beyond that, as a polynomial must: about 10\u2032 at \u221213000 and 17\u2032 at +13000', () => {
    const off = (y: number) => Math.abs(generalPrecessionIau2006(jdOfYear(y)) - accumulatedPrecession(jdOfYear(y), J2000_JD)) * 3600;
    expect(off(-13000)).toBeGreaterThan(500);
    expect(off(-13000)).toBeLessThan(700);
    expect(off(13000)).toBeGreaterThan(900);
    expect(off(13000)).toBeLessThan(1100);
    expect(off(-3000)).toBeGreaterThan(2);
  });
});

describe('the pole geometry', () => {
  it('has the IAU 2006 mean obliquity at J2000.0 and a slowly falling obliquity today', () => {
    expect(meanObliquityDeg(J2000_JD)).toBeCloseTo(84381.406 / 3600, 5);
    expect(meanObliquityDeg(jdOfYear(2026))).toBeLessThan(meanObliquityDeg(J2000_JD));
  });
  it('accumulates monotonically forward and passes half a turn without wrapping', () => {
    let prev = -Infinity;
    for (let y = -13000; y <= 13000; y += 250) {
      const a = accumulatedPrecession(jdOfYear(y), J2000_JD);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
    expect(accumulatedPrecession(jdOfYear(13000), J2000_JD) - accumulatedPrecession(jdOfYear(-13000), J2000_JD)).toBeGreaterThan(300);
  });
});

describe('the IAU boundaries are the sidecar\u2019s', () => {
  it('match golden.constellationBoundaries one for one, including Aqr/Psc at 351.65\u00b0', () => {
    expect(IAU_BOUNDARIES.length).toBe(sky.golden.constellationBoundaries.length);
    IAU_BOUNDARIES.forEach((b, i) => {
      expect(b.lon).toBe(sky.golden.constellationBoundaries[i].lon);
      expect(b.from).toBe(sky.golden.constellationBoundaries[i].from);
      expect(b.to).toBe(sky.golden.constellationBoundaries[i].to);
      expect(CONSTELLATION_NAMES[b.to]).toBeTruthy();
    });
    expect(IAU_BOUNDARIES[IAU_BOUNDARIES.length - 1]).toMatchObject({ lon: 351.6526, from: 'Aqr', to: 'Psc' });
  });
});

describe('conventions: where the equinox stands, and when it moves', () => {
  it('stands in Pisces at J2000 under every convention', () => {
    for (const c of ['jung-equal', 'fagan-bradley', 'lahiri', 'iau'] as const) expect(equinoxPlace(c, 2000).name, c).toBe('Pisces');
  });
  it('walks backward: the longitude falls as years pass, in every convention', () => {
    for (const c of ['jung-equal', 'fagan-bradley', 'lahiri', 'iau'] as const) {
      const a = equinoxPlace(c, 1000).longitude;
      const b = equinoxPlace(c, 1100).longitude;
      expect(wrapDiff(a, b)).toBeGreaterThan(0);
      expect(((a - b) % 360 + 360) % 360, c).toBeGreaterThan(0);
      expect(((a - b) % 360 + 360) % 360, c).toBeLessThan(10);
    }
  });
  it('Jung\u2019s months run in 2 143-year steps from year 0, Pisces first', () => {
    const s = stays('jung-equal');
    const pisces = s.find((x) => x.name === 'Pisces' && x.from === 0)!;
    expect(pisces.to).toBe(2143);
    expect(equinoxPlace('jung-equal', -1).name).toBe('Aries');
    expect(equinoxPlace('jung-equal', -2143).name).toBe('Aries'); // the display's own half-open boundary: Aries from \u22122143
    expect(equinoxPlace('jung-equal', -2144).name).toBe('Taurus');
    expect(equinoxPlace('jung-equal', -4287).name).toBe('Gemini');
    expect(equinoxPlace('jung-equal', 2143).name).toBe('Aquarius');
    expect(equinoxPlace('jung-equal', 0).name).toBe('Pisces');
  });
  it('the IAU constellations put the equinox in Aries about 1865 BCE\u201368 BCE, Pisces to about 2597 CE', () => {
    const pisces = stayNear('iau', 'Pisces', 1000)!;
    const aries = stayNear('iau', 'Aries', -1000)!;
    expect(pisces.from).toBeGreaterThan(-75);
    expect(pisces.from).toBeLessThan(-60);
    expect(pisces.to).toBeGreaterThan(2590);
    expect(pisces.to).toBeLessThan(2605);
    expect(aries.from).toBeGreaterThan(-1880);
    expect(aries.from).toBeLessThan(-1850);
    expect(aries.to).toBeCloseTo(pisces.from, 3);
    expect(entersAfter('iau', 'Aquarius', 2000)).toBeCloseTo(pisces.to, 3);
  });
  it('the sidereal conventions enter Pisces when the ayanamsa passes 0\u00b0 and Aquarius at 30\u00b0', () => {
    for (const key of ['fagan-bradley', 'lahiri'] as const) {
      const p = stayNear(key, 'Pisces', 1000)!;
      expect(ayanamsa(jdOfYear(p.from), key)).toBeCloseTo(0, 3);
      expect(ayanamsa(jdOfYear(p.to), key)).toBeCloseTo(30, 3);
    }
  });
  it('the conventions disagree by centuries about the same sign \u2014 that is the finding, not a defect', () => {
    const starts = (['fagan-bradley', 'lahiri', 'iau'] as const).map((c) => stayNear(c, 'Pisces', 1000)!.from);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(250);
  });
  it('ticks: twelve equal signs, or thirteen constellations', () => {
    expect(conventionTicks('lahiri').length).toBe(12);
    expect(conventionTicks('iau').length).toBe(13);
    expect(conventionTicks('iau').find((t) => t.name === 'Pisces')!.longitude).toBe(351.6526);
  });
});
