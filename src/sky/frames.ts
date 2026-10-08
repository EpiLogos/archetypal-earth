// Coordinate frames of the sky layer: pure maths, no three.js, no DOM.
//
// The scene is Earth-fixed (ECEF, Earth radius = 1; +Y is the north pole, lon 0 faces +X, east is −Z: see
// data/geo.ts). The sky is inertial. A body at ecliptic (λ, β) of date reaches the scene through
//   ecliptic → equatorial (rotate about the vernal point by the obliquity ε)
//   → scene (the equatorial longitude α becomes the Earth-fixed longitude α − GMST).
// The whole chain is linear, so a group can carry it as one matrix (`sceneBasis`).
import { latLonFromDir, type Vec3 } from '../data/geo';

const D2R = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
/** Julian date of the Unix epoch */
const JD_UNIX = 2440587.5;

export const julianDate = (ms: number): number => ms / MS_PER_DAY + JD_UNIX;
/** Julian centuries since J2000.0 */
export const centuries = (ms: number): number => (julianDate(ms) - 2451545.0) / 36525;

/** Greenwich mean sidereal time in degrees, 0..360 (Meeus, Astronomical Algorithms, eq. 12.4). */
export function gmstDeg(ms: number): number {
  const d = julianDate(ms) - 2451545.0;
  const T = d / 36525;
  const g = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000;
  return ((g % 360) + 360) % 360;
}

/** Mean obliquity of the ecliptic of date, degrees (IAU 2006, truncated to the cubic term). */
export function obliquityDeg(ms: number): number {
  const T = centuries(ms);
  // 84381.406″ − 46.836769″ T − 0.0001831″ T² + 0.00200340″ T³
  return 23.439279444 - 0.013010214 * T - 0.000000050861 * T * T + 0.0000005565 * T * T * T;
}

/** Spherical ecliptic (λ°, β°, r) to Cartesian ecliptic axes: x to the vernal point, z to the ecliptic north. */
export function eclipticVector(lonDeg: number, latDeg: number, r: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const lo = lonDeg * D2R;
  const la = latDeg * D2R;
  const c = Math.cos(la) * r;
  out[0] = c * Math.cos(lo);
  out[1] = c * Math.sin(lo);
  out[2] = Math.sin(la) * r;
  return out;
}

/** Ecliptic Cartesian → scene axes, for the given GMST and obliquity (degrees). */
export function sceneFromEcliptic(v: Vec3, gmst: number, eps: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const ce = Math.cos(eps * D2R);
  const se = Math.sin(eps * D2R);
  // equatorial
  const X = v[0];
  const Y = v[1] * ce - v[2] * se;
  const Z = v[1] * se + v[2] * ce;
  const cg = Math.cos(gmst * D2R);
  const sg = Math.sin(gmst * D2R);
  out[0] = X * cg + Y * sg;
  out[1] = Z;
  out[2] = -(Y * cg - X * sg);
  return out;
}

/** The columns of the linear map ecliptic → scene, ready for a matrix `makeBasis`. */
export function sceneBasis(gmst: number, eps: number): [Vec3, Vec3, Vec3] {
  return [
    sceneFromEcliptic([1, 0, 0], gmst, eps),
    sceneFromEcliptic([0, 1, 0], gmst, eps),
    sceneFromEcliptic([0, 0, 1], gmst, eps),
  ];
}

/** Scene position of the point at ecliptic (λ, β, r), straight through the chain. */
export function sceneFromSpherical(lonDeg: number, latDeg: number, r: number, gmst: number, eps: number, out: Vec3 = [0, 0, 0]): Vec3 {
  return sceneFromEcliptic(eclipticVector(lonDeg, latDeg, r), gmst, eps, out);
}

/** Wrap degrees to (−180, 180]. */
export function wrap180(deg: number): number {
  const w = ((deg + 180) % 360 + 360) % 360 - 180;
  return w === -180 ? 180 : w;
}

/** Sub-point of a direction on the scene: the Earth-fixed (lat, lon) under an inertial equatorial direction. */
export function subPoint(raDeg: number, decDeg: number, gmst: number): { lat: number; lon: number } {
  return { lat: decDeg, lon: wrap180(raDeg - gmst) };
}

/** Tropical sign and degree within it for an ecliptic longitude: the label convention of the sky (never a prediction). */
export const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'] as const;
export function signOf(lonDeg: number): { sign: (typeof SIGNS)[number]; degree: number; minute: number } {
  const l = ((lonDeg % 360) + 360) % 360;
  const i = Math.floor(l / 30);
  const within = l - i * 30;
  return { sign: SIGNS[i], degree: Math.floor(within), minute: Math.floor((within % 1) * 60) };
}

/**
 * The Earth-fixed (lat, lon) from which the camera sits to see the system from `elevation`° above the ecliptic,
 * toward ecliptic longitude `lon`°: the default orientation of the system view, for the given moment.
 */
export function systemViewLatLon(lon: number, elevation: number, gmst: number, eps: number): { lat: number; lon: number } {
  const v = sceneFromEcliptic(eclipticVector(lon, elevation, 1), gmst, eps);
  return latLonFromDir(v);
}
