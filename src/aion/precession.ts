// The precession of the equinoxes — the astronomical ground under Aion. Pure: no DOM, no clock, no fetch.
//
// Primary model: Vondrák, Capitaine & Wallace (2011), "New precession expressions, valid for long time
// intervals", A&A 534, A22, with the corrigendum A&A 541, C1 (2012): the ecliptic pole (P_A, Q_A, Table 1) and the
// equator pole (X_A, Y_A, Table 2) as a polynomial plus periodic terms in Julian centuries from J2000.0. The
// periodic tables below are the published coefficients (arcseconds; periods in Julian centuries), including the
// corrigendum's Q_A cos term 198.296701. The equinox of date is the node of the two poles; the ecliptic of an epoch
// is the plane normal to its ecliptic pole.
//
// Cross-check: the IAU 2006 general precession in longitude p_A (Capitaine, Wallace & Chapront 2003, A&A 412, 567;
// adopted IAU 2006). It is a polynomial fitted near J2000.0, so it is *not* used for anything shown; it exists to
// show where the long-term model and the modern one agree, and where the polynomial ceases to be a model.
//
// Verified in tests/aion/precession.test.ts against the sidecar's golden ayanamsa table (public/data/sky.json
// `golden.ayanamsa`: Fagan–Bradley and Lahiri, −13000 … +13000 in 500-year steps plus −6, 0, 1900, 2000, 2026), whose
// values the sidecar computes through ERFA's `ltpecl`/`ltpequ`, an implementation of the same paper.
//
// Years in this file are calendar years in astronomical numbering carried as a plain number (1 BCE = 0): the display
// clock of the atlas numbers BCE years negatively and treats its own year 0 as the beginning of the Christian era, so
// the two differ by at most one year, 0.014° of precession, far inside the display's own approximation. The bridge is
// therefore the identity and is stated, not hidden (docs/PRECESSION-NOTES.md).

const AS2R = Math.PI / 180 / 3600;
const TWO_PI = Math.PI * 2;
export const J2000_JD = 2451545.0;
/** Julian-century length in days. */
const JC = 36525;
/** A mean rate of general precession, degrees per Julian year, used only to choose among 360° wraps. */
const MEAN_RATE_DEG_PER_YEAR = 360 / 25772;
/** The obliquity of the ecliptic at J2000.0 (IAU 2006), arcseconds: the pole series are referred to it. */
const EPS0 = 84381.406 * AS2R;

const PQ_POLY = [
    [5851.607687, -1600.8863],
    [-0.1189, 1.1689818],
    [-0.00028913, -2e-07],
    [1.01e-07, -4.37e-07],
  ] as const; // [P_A, Q_A] coefficients by power of T (arcsec per Julian century^n)

const PQ_PERIODIC = [
    [708.15, 2309.0, 1620.0, 492.2, 1183.0, 622.0, 882.0, 547.0],
    [-5486.751211, -17.127623, -617.517403, 413.44294, 78.614193, -180.732815, -87.676083, 46.140315],
    [-684.66156, 2446.28388, 399.671049, -356.652376, -186.387003, -316.80007, 198.296701, 101.135679],
    [667.66673, -2354.886252, -428.152441, 376.202861, 184.778874, 335.321713, -185.138669, -120.97283],
    [-5523.863691, -549.74745, -310.998056, 421.535876, -36.776172, -145.278396, -34.74445, 22.885731],
  ] as const; // rows: period (centuries), P cos, Q cos, P sin, Q sin

const XY_POLY = [
    [5453.282155, -73750.93035],
    [0.4252841, -0.7675452],
    [-0.00037173, -0.00018725],
    [-1.52e-07, 2.31e-07],
  ] as const;

const XY_PERIODIC = [
    [256.75, 708.15, 274.2, 241.45, 2309.0, 492.2, 396.1, 288.9, 231.1, 1610.0, 620.0, 157.87, 220.3, 1200.0],
    [-819.940624, -8444.676815, 2600.009459, 2755.17563, -167.659835, 871.855056, 44.769698, -512.313065, -819.415595, -538.071099, -189.793622, -402.922932, 179.516345, -9.814756],
    [75004.344875, 624.033993, 1251.136893, -1102.212834, -2660.66498, 699.291817, 153.16722, -950.865637, 499.754645, -145.18821, 558.116553, -23.923029, -165.405086, 9.344131],
    [81491.287984, 787.163481, 1251.296102, -1257.950837, -2966.79973, 639.744522, 131.600209, -445.040117, 584.522874, -89.756563, 524.42963, -13.549067, -210.157124, -44.919798],
    [1558.515853, 7774.939698, -2219.534038, -2523.969396, 247.850422, -846.485643, -1393.124055, 368.526116, 749.045012, 444.704518, 235.934465, 374.049623, -171.33018, -22.899655],
  ] as const; // rows: period, X cos, Y cos, X sin, Y sin

type Vec3 = readonly [number, number, number];

/** A polynomial in T plus periodic terms, for both components of a pole series: [first, second], arcseconds. */
function series(poly: readonly (readonly number[])[], per: readonly (readonly number[])[], t: number): [number, number] {
  let a = 0;
  let b = 0;
  const [period, aCos, bCos, aSin, bSin] = per;
  for (let i = 0; i < period.length; i++) {
    const arg = (TWO_PI * t) / period[i];
    const c = Math.cos(arg);
    const s = Math.sin(arg);
    a += c * aCos[i] + s * aSin[i];
    b += c * bCos[i] + s * bSin[i];
  }
  let w = 1;
  for (const p of poly) { a += p[0] * w; b += p[1] * w; w *= t; }
  return [a, b];
}

/** Unit vector of the mean ecliptic pole of date, in the J2000.0 mean-equator frame (Vondrák 2011, P_A and Q_A). */
export function eclipticPole(jdTT: number): Vec3 {
  const t = (jdTT - J2000_JD) / JC;
  const [pa, qa] = series(PQ_POLY, PQ_PERIODIC, t);
  const p = pa * AS2R;
  const q = qa * AS2R;
  const zz = 1 - p * p - q * q;
  const z = zz > 0 ? Math.sqrt(zz) : 0;
  const se = Math.sin(EPS0);
  const ce = Math.cos(EPS0);
  return [p, -q * ce - z * se, -q * se + z * ce];
}

/** Unit vector of the mean equator pole of date, in the J2000.0 mean-equator frame (Vondrák 2011, X_A and Y_A). */
export function equatorPole(jdTT: number): Vec3 {
  const t = (jdTT - J2000_JD) / JC;
  const [xa, ya] = series(XY_POLY, XY_PERIODIC, t);
  const x = xa * AS2R;
  const y = ya * AS2R;
  const w = x * x + y * y;
  return [x, y, w < 1 ? Math.sqrt(1 - w) : 0];
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };

/** The mean vernal equinox of date: the ascending node of the equator on the ecliptic, as a unit vector. */
export function equinoxDirection(jdTT: number): Vec3 {
  return unit(cross(eclipticPole(jdTT), equatorPole(jdTT)));
}

/** The ecliptic of an epoch as a frame (x toward its own equinox, z its pole) in the J2000.0 mean-equator frame. */
function eclipticFrame(jdTT: number): { x: Vec3; y: Vec3 } {
  const z = eclipticPole(jdTT);
  const x = equinoxDirection(jdTT);
  return { x, y: cross(z, x) };
}

/** Mean obliquity of date, degrees: the angle between the two poles (the same figure the sidecar's frame uses). */
export function meanObliquityDeg(jdTT: number): number {
  const d = Math.max(-1, Math.min(1, dot(eclipticPole(jdTT), equatorPole(jdTT))));
  return (Math.acos(d) * 180) / Math.PI;
}

/** `angle` (any real) moved by whole turns to lie within half a turn of `near`. */
function unwrapNear(angle: number, near: number): number {
  return angle + 360 * Math.round((near - angle) / 360);
}

/**
 * Accumulated precession in ecliptic longitude from epoch `t0` to `jd` (degrees, Julian Dates in TT): how far the
 * vernal equinox of `jd` has regressed along the *fixed* mean ecliptic of `t0`. Positive after `t0`, negative before,
 * and continuous across the whole span — it is not reduced to 0…360, so a boundary crossing can be found by bisection.
 * (The sidecar's "Method B" — non-additive in t0, because the ecliptic itself tilts.)
 */
export function accumulatedPrecession(jd: number, t0: number): number {
  const e0 = eclipticFrame(t0);
  const eq = equinoxDirection(jd);
  const lam = (Math.atan2(dot(e0.y, eq), dot(e0.x, eq)) * 180) / Math.PI;
  return unwrapNear(-lam, ((jd - t0) / 365.25) * MEAN_RATE_DEG_PER_YEAR);
}

/** IAU 2006 general precession in longitude p_A from J2000.0, degrees (a polynomial: valid near J2000.0 only). */
export function generalPrecessionIau2006(jdTT: number): number {
  const t = (jdTT - J2000_JD) / JC;
  const arcsec = ((((-0.0000000383 * t - 0.000023857) * t + 0.00007964) * t + 1.1054348) * t + 5028.796195) * t;
  return arcsec / 3600;
}

// ── time ───────────────────────────────────────────────────────────────

/**
 * Julian Date of 1 January, 12:00, proleptic Gregorian, astronomical year numbering; the fraction of a year is added at
 * the Gregorian mean length. Treated as TT: the UT/TT difference is about 8 days at −13000 (≈ 1″ of precession) and
 * under a minute near the present, far inside the tolerance of every figure shown.
 */
export function jdOfYear(year: number): number {
  const whole = Math.floor(year);
  const frac = year - whole;
  // shift into positive years by whole 400-year cycles (146097 days) so the integer algorithm holds
  const cycles = whole < -4700 ? Math.ceil((-4700 - whole) / 400) : 0;
  const y = whole + cycles * 400;
  // January: a = floor((14 − 1) / 12) = 1, so the shifted year is y + 4799 and the shifted month 1 + 12 − 3 = 10
  const y2 = y + 4799;
  const m2 = 10;
  const jdn = 1 + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
  return jdn - cycles * 146097 + frac * 365.2425;
}

// ── ayanamsa ───────────────────────────────────────────────────────────

/**
 * Two named sidereal zero points. The value is the ayanamsa — the longitude of the tropical equinox of date measured
 * from the sidereal zero — at the epoch given (JD, TT); both are conventions fixed by their authors, not measurements.
 * Pinned equal to the sidecar's `golden.ayanamsa.definitions` by the tests.
 */
export const AYANAMSA = {
  'fagan-bradley': { name: 'Fagan–Bradley', valueDeg: 24.042044444444457, epochJdTT: 2433282.42345905 },
  lahiri: { name: 'Lahiri', valueDeg: 23.85709166666667, epochJdTT: 2451545.0 },
} as const;
export type AyanamsaKey = keyof typeof AYANAMSA;

/** The ayanamsa at `jd` (TT), degrees, unwrapped: its definition value plus the precession accumulated since its epoch. */
export function ayanamsa(jd: number, key: AyanamsaKey): number {
  const def = AYANAMSA[key];
  return def.valueDeg + accumulatedPrecession(jd, def.epochJdTT);
}

// ── the constellation boundaries (IAU) ─────────────────────────────────

/**
 * The thirteen IAU (Delporte, 1930) constellation boundaries along the ecliptic, on the mean ecliptic and equinox of
 * J2000.0 (longitude of each crossing, degrees). Read through Skyfield's constellation map by the sidecar and pinned
 * equal to `golden.constellationBoundaries` by the tests. The stars' own motion since 1875 is ignored.
 */
export const IAU_BOUNDARIES = [
  { lon: 28.6889, from: 'Psc', to: 'Ari' },
  { lon: 53.4192, from: 'Ari', to: 'Tau' },
  { lon: 90.1417, from: 'Tau', to: 'Gem' },
  { lon: 117.9892, from: 'Gem', to: 'Cnc' },
  { lon: 138.0395, from: 'Cnc', to: 'Leo' },
  { lon: 173.8522, from: 'Leo', to: 'Vir' },
  { lon: 217.8121, from: 'Vir', to: 'Lib' },
  { lon: 241.0403, from: 'Lib', to: 'Sco' },
  { lon: 247.6397, from: 'Sco', to: 'Oph' },
  { lon: 266.2393, from: 'Oph', to: 'Sgr' },
  { lon: 299.6573, from: 'Sgr', to: 'Cap' },
  { lon: 327.4887, from: 'Cap', to: 'Aqr' },
  { lon: 351.6526, from: 'Aqr', to: 'Psc' },
] as const;

export const CONSTELLATION_NAMES: Readonly<Record<string, string>> = {
  Ari: 'Aries', Tau: 'Taurus', Gem: 'Gemini', Cnc: 'Cancer', Leo: 'Leo', Vir: 'Virgo', Lib: 'Libra', Sco: 'Scorpius',
  Oph: 'Ophiuchus', Sgr: 'Sagittarius', Cap: 'Capricornus', Aqr: 'Aquarius', Psc: 'Pisces',
};

/** The twelve equal signs, by 30° sector from the zero point. */
export const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'] as const;

// ── conventions ────────────────────────────────────────────────────────

/** Jung's month: the 2 143 years of an equal twelfth of the precessional cycle, as Aion ¶149 n.84 counts it. */
export const JUNG_MONTH_YEARS = 2143;

export type Convention = 'jung-equal' | 'fagan-bradley' | 'lahiri' | 'iau';
export const CONVENTIONS: readonly Convention[] = ['jung-equal', 'fagan-bradley', 'lahiri', 'iau'];

export interface ConventionInfo {
  label: string;
  /** one plain sentence: what the zero point and the boundaries are */
  frame: string;
  /** equal 30° signs or the 13 unequal IAU constellations */
  equal: boolean;
}

export const CONVENTION_INFO: Readonly<Record<Convention, ConventionInfo>> = {
  'jung-equal': { label: 'Jung’s equal months', equal: true,
    frame: `Twelve equal months of ${JUNG_MONTH_YEARS.toLocaleString('en')} years, counted back from the beginning of the Christian era: the arithmetic of Aion ¶149 n.84, and the display clock’s own boundaries for Taurus and Aries. No measurement of the sky enters.` },
  'fagan-bradley': { label: 'Fagan–Bradley sidereal', equal: true,
    frame: `Twelve equal 30° signs from a sidereal zero point fixed by the Fagan–Bradley convention (${AYANAMSA['fagan-bradley'].valueDeg.toFixed(4)}° at 1950.0). An astrologers’ convention, chosen rather than observed.` },
  lahiri: { label: 'Lahiri sidereal', equal: true,
    frame: `Twelve equal 30° signs from the sidereal zero point of the Lahiri (Chitrapaksha) convention (${AYANAMSA.lahiri.valueDeg.toFixed(4)}° at J2000.0). Also chosen rather than observed.` },
  iau: { label: 'IAU constellations', equal: false,
    frame: 'The thirteen constellations the ecliptic crosses, at the boundaries the IAU fixed (Delporte, 1930), measured on the J2000.0 ecliptic. Unequal in width; the stars’ own motion is ignored.' },
};

/** Where the vernal equinox stands in a convention's own frame. */
export interface EquinoxPlace {
  convention: Convention;
  /** degrees, 0…360, in the convention's frame (sidereal; or on the J2000.0 ecliptic; or Jung's months from year 0) */
  longitude: number;
  /** the sign or constellation the equinox is in, by name */
  name: string;
  /** index in the convention's sequence (0 = Aries / Psc→Ari side) */
  index: number;
}

const wrap360 = (x: number): number => ((x % 360) + 360) % 360;

function iauSegment(lon: number): { name: string; index: number } {
  // segment k lies from IAU_BOUNDARIES[k].lon up to IAU_BOUNDARIES[k+1].lon and carries the `to` name of boundary k
  if (lon < IAU_BOUNDARIES[0].lon || lon >= IAU_BOUNDARIES[IAU_BOUNDARIES.length - 1].lon) return { name: 'Pisces', index: IAU_BOUNDARIES.length };
  for (let k = IAU_BOUNDARIES.length - 2; k >= 0; k--) if (lon >= IAU_BOUNDARIES[k].lon) return { name: CONSTELLATION_NAMES[IAU_BOUNDARIES[k].to], index: k };
  return { name: 'Pisces', index: IAU_BOUNDARIES.length };
}

/** The vernal equinox in a convention at a calendar year (fractional years allowed). */
export function equinoxPlace(convention: Convention, year: number): EquinoxPlace {
  if (convention === 'jung-equal') {
    const month = Math.floor(year / JUNG_MONTH_YEARS);
    const index = (((11 - month) % 12) + 12) % 12;
    return { convention, longitude: wrap360((-year * 360) / (12 * JUNG_MONTH_YEARS)), name: SIGNS[index], index };
  }
  const jd = jdOfYear(year);
  if (convention === 'iau') {
    const longitude = wrap360(-accumulatedPrecession(jd, J2000_JD));
    const seg = iauSegment(longitude);
    return { convention, longitude, ...seg };
  }
  const longitude = wrap360(-ayanamsa(jd, convention));
  const index = Math.floor(longitude / 30) % 12;
  return { convention, longitude, name: SIGNS[index], index };
}

/** The boundary ticks a convention draws, in its own frame: longitude and the name of the sector that begins there. */
export function conventionTicks(convention: Convention): { longitude: number; name: string }[] {
  if (convention === 'iau') return IAU_BOUNDARIES.map((b) => ({ longitude: b.lon, name: CONSTELLATION_NAMES[b.to] }));
  return SIGNS.map((name, i) => ({ longitude: i * 30, name }));
}

/** One contiguous stay of the equinox in a sign or constellation: from the year it enters to the year it leaves. */
export interface Stay {
  name: string;
  from: number;
  to: number;
}

const stayCache = new Map<Convention, Stay[]>();
const SCAN_FROM = -13000;
const SCAN_TO = 13000;

/**
 * Every stay of the equinox within ±13 000 years, in order, to a thousandth of a year. The first and last stay are
 * cut by the scan's edges. (Scanned every 10 years, then bisected where the sign changes.)
 */
export function stays(convention: Convention): Stay[] {
  const cached = stayCache.get(convention);
  if (cached) return cached;
  const out: Stay[] = [];
  if (convention === 'jung-equal') {
    for (let k = Math.floor(SCAN_FROM / JUNG_MONTH_YEARS); k <= Math.floor(SCAN_TO / JUNG_MONTH_YEARS); k++) {
      out.push({ name: SIGNS[(((11 - k) % 12) + 12) % 12], from: k * JUNG_MONTH_YEARS, to: (k + 1) * JUNG_MONTH_YEARS });
    }
  } else {
    let y = SCAN_FROM;
    let cur = equinoxPlace(convention, y);
    let from = y;
    while (y < SCAN_TO) {
      const next = Math.min(SCAN_TO, y + 10);
      const p = equinoxPlace(convention, next);
      if (p.name !== cur.name) {
        let lo = y;
        let hi = next;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (equinoxPlace(convention, mid).name === cur.name) lo = mid; else hi = mid;
        }
        const at = (lo + hi) / 2;
        out.push({ name: cur.name, from, to: at });
        from = at;
        cur = equinoxPlace(convention, hi);
      }
      y = next;
    }
    out.push({ name: cur.name, from, to: SCAN_TO });
  }
  stayCache.set(convention, out);
  return out;
}

/** The stay in `name` nearest to a calendar year (the one containing it, or the closest in time). */
export function stayNear(convention: Convention, name: string, year: number): Stay | undefined {
  let best: Stay | undefined;
  let bestD = Infinity;
  for (const s of stays(convention)) {
    if (s.name !== name) continue;
    const d = year >= s.from && year < s.to ? 0 : Math.min(Math.abs(year - s.from), Math.abs(year - s.to));
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

/** The year the equinox first enters `name` after `year` — a calculation under the convention, nothing more. */
export function entersAfter(convention: Convention, name: string, year: number): number | undefined {
  return stays(convention).find((s) => s.name === name && s.from > year)?.from;
}
