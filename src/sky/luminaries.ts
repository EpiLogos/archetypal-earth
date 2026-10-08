// The Sun and the Moon as the Earth sees them: where the Sun is overhead, how lit the Moon is, when Sun and Moon next
// stand together or opposed. Pure functions of the generated grids (SkyEphemeris) — the client's only astronomy — and
// golden-tested against the sidecar at named instants (tests/sky/luminaries.test.ts).
import type { SkyEphemeris, SkyPoint } from './ephemeris';
import type { Vec3 } from '../data/geo';
import { eclipticVector, gmstDeg, obliquityDeg, sceneFromEcliptic } from './frames';

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
const DAY = 86_400_000;

const wrap360 = (d: number) => ((d % 360) + 360) % 360;
const wrap180 = (d: number) => wrap360(d + 180) - 180;

/** The unit direction from the Earth's centre to the Sun in scene axes (Earth-fixed, +Y north), or null outside the generated span. */
export function sunScene(eph: SkyEphemeris, ms: number, out: Vec3 = [0, 0, 0]): Vec3 | null {
  if (!eph.covers(ms)) return null;
  const s = eph.sunGeo(ms);
  if (!s) return null;
  return sceneFromEcliptic(eclipticVector(s.lon, s.lat, 1), gmstDeg(ms), obliquityDeg(ms), out);
}

/** The point on the Earth with the Sun at its zenith: latitude is the Sun's declination, longitude its right ascension less GMST. */
export function subsolarPoint(eph: SkyEphemeris, ms: number): { lat: number; lon: number } | null {
  const v = sunScene(eph, ms);
  if (!v) return null;
  return { lat: Math.asin(Math.max(-1, Math.min(1, v[1]))) * R2D, lon: Math.atan2(-v[2], v[0]) * R2D };
}

export type PhaseName = 'new' | 'waxing crescent' | 'first quarter' | 'waxing gibbous' | 'full' | 'waning gibbous' | 'last quarter' | 'waning crescent';

const PHASES: PhaseName[] = ['new', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full', 'waning gibbous', 'last quarter', 'waning crescent'];

/** The eight conventional names, each centred on a multiple of 45° of elongation. */
export const phaseName = (elongation: number): PhaseName => PHASES[Math.floor((wrap360(elongation) + 22.5) / 45) % 8];

export interface MoonPhase {
  /** Moon's ecliptic longitude east of the Sun, 0..360° (0 = conjunction, 180 = opposition) */
  elongation: number;
  /** fraction of the disc lit as seen from the Earth, 0..1, from the true angular separation */
  illuminated: number;
  waxing: boolean;
  name: PhaseName;
}

export function moonPhase(eph: SkyEphemeris, ms: number): MoonPhase | null {
  if (!eph.covers(ms)) return null;
  const sun = eph.sunGeo(ms);
  const moon = eph.moon(ms);
  if (!sun || !moon) return null;
  const elongation = wrap360(moon.lon - sun.lon);
  // the angle between the two directions, not just their longitudes: the Moon wanders up to 5° off the ecliptic
  const cosPsi = Math.cos(moon.lat * D2R) * Math.cos(sun.lat * D2R) * Math.cos(elongation * D2R) + Math.sin(moon.lat * D2R) * Math.sin(sun.lat * D2R);
  return { elongation, illuminated: (1 - cosPsi) / 2, waxing: elongation < 180, name: phaseName(elongation) };
}

const elongationAt = (eph: SkyEphemeris, ms: number): number => {
  const sun = eph.sunGeo(ms, { lon: 0, lat: 0, r: 0 } as SkyPoint)!;
  const moon = eph.moon(ms, { lon: 0, lat: 0, r: 0 } as SkyPoint)!;
  return wrap360(moon.lon - sun.lon);
};

/** Signed distance of the elongation from a target (0 or 180), −180..180, rising through zero as the Moon overtakes it. */
const offset = (eph: SkyEphemeris, ms: number, target: number) => wrap180(elongationAt(eph, ms) - target);

function findCrossing(eph: SkyEphemeris, from: number, to: number, target: number): number | null {
  const step = 3 * 3_600_000;
  let a = from;
  let fa = offset(eph, a, target);
  for (let t = from + step; t <= to + step; t += step) {
    const b = Math.min(t, to);
    const fb = offset(eph, b, target);
    // the Moon gains on the Sun, so the offset rises through zero; a jump of the wrap is not a crossing
    if (fa < 0 && fb >= 0 && fb - fa < 90) {
      let lo = a;
      let hi = b;
      for (let i = 0; i < 48; i++) {
        const mid = (lo + hi) / 2;
        if (offset(eph, mid, target) < 0) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    a = b;
    fa = fb;
    if (b >= to) break;
  }
  return null;
}

export interface Syzygies {
  /** the next instant the Moon's ecliptic longitude equals the Sun's (the new Moon), or null beyond the generated span */
  conjunction: number | null;
  /** the next instant it differs by 180° (the full Moon) */
  opposition: number | null;
}

/** The next conjunction and opposition after `ms`, found on the generated grids to well under a minute. */
export function nextSyzygies(eph: SkyEphemeris, ms: number): Syzygies {
  const to = Math.min(eph.to, ms + 31 * DAY);
  if (ms < eph.from || ms > eph.to) return { conjunction: null, opposition: null };
  return { conjunction: findCrossing(eph, ms, to, 0), opposition: findCrossing(eph, ms, to, 180) };
}
