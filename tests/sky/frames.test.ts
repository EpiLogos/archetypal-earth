import { describe, expect, it } from 'vitest';
import sky from '../../public/data/sky.json';
import type { SkyData } from '../../src/types/sky';
import { eclipticVector, gmstDeg, obliquityDeg, sceneFromEcliptic, signOf, systemViewLatLon, wrap180 } from '../../src/sky/frames';
import { latLonFromDir } from '../../src/data/geo';

const data = sky as unknown as SkyData;
const ok = data.golden.epochs.filter((e) => e.status === 'ok');

describe('frames: the ecliptic of date → the Earth-fixed scene', () => {
  it('has golden epochs to stand on', () => {
    expect(ok.length).toBeGreaterThanOrEqual(3);
  });

  // the client keeps mean sidereal time; the sidecar's is apparent, and the two differ by the equation of the
  // equinoxes (never more than ~1.2 s = 0.005°) — far below a pixel of the Earth
  it('GMST agrees with the sidecar at every golden epoch (to 0.006°, the equation of the equinoxes)', () => {
    for (const e of ok) {
      const d = wrap180(gmstDeg(Date.parse(e.iso)) - e.gmst!);
      expect(Math.abs(d), e.label).toBeLessThan(0.006);
    }
  });

  it('the Sun in the scene stands over the sidecar\'s subsolar point (to 0.05°)', () => {
    for (const e of ok) {
      const ms = Date.parse(e.iso);
      const v = sceneFromEcliptic(eclipticVector(e.sun!.lon, e.sun!.lat, 1), gmstDeg(ms), obliquityDeg(ms));
      const ll = latLonFromDir(v);
      expect(Math.abs(ll.lat - e.subsolar!.lat), `${e.label} lat`).toBeLessThan(0.05);
      expect(Math.abs(wrap180(ll.lon - e.subsolar!.lon)), `${e.label} lon`).toBeLessThan(0.05);
    }
  });

  it('the Moon in the scene stands over the sidecar\'s sublunar point (to 0.1° — the sidecar refers to the true pole)', () => {
    for (const e of ok) {
      const ms = Date.parse(e.iso);
      const v = sceneFromEcliptic(eclipticVector(e.moon!.lon, e.moon!.lat, 1), gmstDeg(ms), obliquityDeg(ms));
      const ll = latLonFromDir(v);
      expect(Math.abs(ll.lat - e.sublunar!.lat), `${e.label} lat`).toBeLessThan(0.1);
      expect(Math.abs(wrap180(ll.lon - e.sublunar!.lon)), `${e.label} lon`).toBeLessThan(0.1);
    }
  });

  it('obliquity is the IAU 2006 value at J2000', () => {
    expect(obliquityDeg(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(23.439279, 5);
  });

  it('the scene frame is orthonormal: the ecliptic pole stays a unit vector', () => {
    const v = sceneFromEcliptic([0, 0, 1], 123.4, 23.44);
    expect(Math.hypot(...v)).toBeCloseTo(1, 12);
  });

  it('the default system view looks down from the north side of the ecliptic', () => {
    const ms = Date.UTC(2026, 9, 8, 12);
    const g = gmstDeg(ms);
    const eps = obliquityDeg(ms);
    const ll = systemViewLatLon(250, 38, g, eps);
    const dir = sceneFromEcliptic(eclipticVector(250, 38, 1), g, eps);
    const pole = sceneFromEcliptic([0, 0, 1], g, eps);
    const cos = dir[0] * pole[0] + dir[1] * pole[1] + dir[2] * pole[2];
    expect(Math.asin(cos) * (180 / Math.PI)).toBeCloseTo(38, 6);
    expect(Math.abs(ll.lat)).toBeLessThanOrEqual(90);
  });

  it('names the sign of a longitude', () => {
    expect(signOf(0).sign).toBe('Aries');
    expect(signOf(359.99).sign).toBe('Pisces');
    expect(signOf(280.37)).toMatchObject({ sign: 'Capricorn', degree: 10 });
  });
});
