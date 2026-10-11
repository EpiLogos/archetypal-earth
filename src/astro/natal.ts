// A birth chart computed in the browser (astronomy-engine, MIT), in the same shapes the local sidecar returns
// (`SidecarChart`, `BirthWindow`), so the sky layer and its chart overlay draw it unchanged — on any copy of the site,
// with nothing sent anywhere. Positions are tropical, geocentric, apparent, ecliptic and equinox of date; the window's
// planets and Earth are heliocentric, the Moon geocentric, as the sidecar's grids are.
//
// Honest limits, said in the lens: houses are equal houses from the Ascendant (not Placidus), and only when a birth
// time is given; with no time the chart is cast for local noon and has no Ascendant, Midheaven or houses.
import * as A from 'astronomy-engine';
import type { BirthWindow } from '../sky/sidecar';
import type { BodyKey, ChartPoint, SidecarChart, SkyColumns, SkyGrid } from '../types/sky';

export const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'] as const;
export type SignName = (typeof SIGNS)[number];

export const CHART_BODIES = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const;
export type ChartBody = (typeof CHART_BODIES)[number];

const BODY: Record<ChartBody | 'earth', A.Body> = {
  sun: A.Body.Sun, moon: A.Body.Moon, mercury: A.Body.Mercury, venus: A.Body.Venus, mars: A.Body.Mars, jupiter: A.Body.Jupiter,
  saturn: A.Body.Saturn, uranus: A.Body.Uranus, neptune: A.Body.Neptune, pluto: A.Body.Pluto, earth: A.Body.Earth,
};

/** What a person gives: a calendar date, a wall-clock time (or none), the clock's offset from UTC, and a place. */
export interface BirthData {
  /** YYYY-MM-DD, proleptic Gregorian */
  date: string;
  /** HH:MM on the local clock, or null when the time is not known */
  time: string | null;
  /** the local clock's offset from UTC, minutes east (UTC+1 → 60) */
  offsetMinutes: number;
  lat: number;
  lon: number;
  /** the place as the person named it (shown back to them, never sent) */
  place: string;
}

const DATE = /^(-?\d{1,4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

/** Problems with a birth, as plain sentences; empty when it can be cast. */
export function birthProblems(b: Partial<BirthData>): string[] {
  const out: string[] = [];
  const d = DATE.exec(b.date ?? '');
  if (!d) out.push('Give the date as a day, month and year.');
  else {
    const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
    const probe = new Date(Date.UTC(2000, m - 1, day));
    if (m < 1 || m > 12 || probe.getUTCMonth() !== m - 1 || (m === 2 && day === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)))) out.push('That date does not exist.');
    if (y < 1600 || y > 2400) out.push('The chart is computed for years 1600 to 2400.');
  }
  if (b.time !== null && b.time !== undefined) {
    const t = TIME.exec(b.time);
    if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) out.push('Give the time as hours and minutes, or say you do not know it.');
  }
  if (typeof b.lat !== 'number' || !Number.isFinite(b.lat) || Math.abs(b.lat) > 89.9) out.push('The latitude must lie between 89.9° south and north.');
  if (typeof b.lon !== 'number' || !Number.isFinite(b.lon) || Math.abs(b.lon) > 180) out.push('The longitude must lie between 180° west and east.');
  if (typeof b.offsetMinutes !== 'number' || !Number.isFinite(b.offsetMinutes) || Math.abs(b.offsetMinutes) > 14 * 60) out.push('The clock offset must be within 14 hours of UTC.');
  return out;
}

/** The instant of a birth, ms since the epoch (UTC). With no time, local noon. */
export function birthInstant(b: BirthData): number {
  const [, y, m, d] = DATE.exec(b.date)!.map(Number) as unknown as [string, number, number, number];
  const [hh, mm] = b.time ? b.time.split(':').map(Number) : [12, 0];
  const utc = new Date(0);
  utc.setUTCFullYear(y, m - 1, d);
  utc.setUTCHours(hh, mm, 0, 0);
  return utc.getTime() - b.offsetMinutes * 60_000;
}

/** Local mean time's offset at a longitude, minutes (what clocks kept before standard time zones). */
export function meanTimeOffset(lon: number): number {
  return Math.round(lon * 4);
}

/**
 * The offset this device's own time zone had at that wall-clock moment (daylight saving included). A fair default for
 * someone born where they live now; the lens says so and lets it be changed.
 */
export function deviceOffset(date: string, time: string | null): number {
  const d = DATE.exec(date);
  if (!d) return -new Date().getTimezoneOffset();
  const [hh, mm] = time && TIME.test(time) ? time.split(':').map(Number) : [12, 0];
  return -new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hh, mm).getTimezoneOffset();
}

const wrap = (x: number) => ((x % 360) + 360) % 360;
const rad = Math.PI / 180;

function eclipticOfDate(v: A.Vector): { lon: number; lat: number; r: number } {
  const e = A.Ecliptic(v);
  return { lon: wrap(e.elon), lat: e.elat, r: Math.hypot(v.x, v.y, v.z) };
}

/** Apparent geocentric ecliptic position of a body at an instant. */
export function geoPosition(key: ChartBody, ms: number): { lon: number; lat: number; r: number } {
  const date = new Date(ms);
  if (key === 'moon') return eclipticOfDate(A.GeoMoon(date));
  return eclipticOfDate(A.GeoVector(BODY[key], date, true));
}

function helioPosition(key: ChartBody | 'earth', ms: number) {
  return eclipticOfDate(A.HelioVector(BODY[key], new Date(ms)));
}

export function point(lon: number, retrograde = false): ChartPoint {
  const l = wrap(lon);
  const signIndex = Math.min(11, Math.floor(l / 30));
  const degree = Math.min(29.999999, l - signIndex * 30);
  return { lon: signIndex * 30 + degree, sign: SIGNS[signIndex], signIndex, degree, retrograde, house: null };
}

/** Greenwich apparent sidereal time, degrees. */
export function gastDeg(ms: number): number {
  return wrap(A.SiderealTime(new Date(ms)) * 15);
}

function trueObliquity(ms: number): number {
  return A.e_tilt(A.MakeTime(new Date(ms))).tobl;
}

/** Ascendant and Midheaven longitudes for an instant and a place (tropical, of date). */
export function angles(ms: number, lat: number, lon: number): { asc: number; mc: number } {
  const ramc = wrap(gastDeg(ms) + lon) * rad;
  const eps = trueObliquity(ms) * rad;
  const phi = lat * rad;
  const mc = wrap(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(eps)) / rad);
  const asc = wrap(Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))) / rad);
  return { asc, mc };
}

/** The major aspects and their orbs, stated here and in the lens; at least as wide as every aspect the sidecar's golden charts name. */
export const ASPECTS: { type: string; angle: number; orb: number }[] = [
  { type: 'conjunction', angle: 0, orb: 10 },
  { type: 'opposition', angle: 180, orb: 10 },
  { type: 'trine', angle: 120, orb: 8 },
  { type: 'square', angle: 90, orb: 5 },
  { type: 'sextile', angle: 60, orb: 7 },
];

export function aspectsOf(lons: Partial<Record<ChartBody, number>>): SidecarChart['aspects'] {
  const keys = CHART_BODIES.filter((k) => lons[k] !== undefined);
  const out: SidecarChart['aspects'] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      let d = Math.abs(lons[keys[i]]! - lons[keys[j]]!) % 360;
      if (d > 180) d = 360 - d;
      for (const a of ASPECTS) {
        const orb = Math.abs(d - a.angle);
        if (orb <= a.orb) { out.push({ a: keys[i], b: keys[j], type: a.type, orb }); break; }
      }
    }
  }
  return out;
}

function moonPhaseName(elong: number): { name: string; major: string; stage: string } {
  const e = wrap(elong);
  const names = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  const name = names[Math.floor(((e + 22.5) % 360) / 45)];
  const major = ['New Moon', 'First Quarter', 'Full Moon', 'Last Quarter'][Math.floor(((e + 45) % 360) / 90)];
  return { name, major, stage: e < 180 ? 'waxing' : 'waning' };
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

/** The chart for a birth, in the sidecar's contract (plus `timeKnown`). */
export function natalChart(b: BirthData): SidecarChart & { timeKnown: boolean } {
  const ms = birthInstant(b);
  const lons: Partial<Record<ChartBody, number>> = {};
  const bodies: SidecarChart['bodies'] = {};
  for (const k of CHART_BODIES) {
    const now = geoPosition(k, ms).lon;
    // retrograde: the apparent longitude decreasing over a day either side
    let speed = geoPosition(k, ms + 43_200_000).lon - geoPosition(k, ms - 43_200_000).lon;
    if (speed > 180) speed -= 360; else if (speed < -180) speed += 360;
    lons[k] = now;
    bodies[k as BodyKey] = point(now, speed < 0);
  }
  const timeKnown = !!b.time;
  const ang = angles(ms, b.lat, b.lon);
  const cusps = Array.from({ length: 12 }, (_, i) => wrap(ang.asc + 30 * i));
  const sun = lons.sun!;
  const moon = lons.moon!;
  const year = Number(DATE.exec(b.date)![1]);
  const sign = b.offsetMinutes < 0 ? '-' : '+';
  const off = `UTC${sign}${Math.floor(Math.abs(b.offsetMinutes) / 60)}${Math.abs(b.offsetMinutes) % 60 ? `:${pad(Math.abs(b.offsetMinutes) % 60)}` : ''}`;
  const jd = ms / 86_400_000 + 2_440_587.5;
  return {
    input: { local: `${b.date}T${b.time ?? '12:00'}`, lat: b.lat, lon: b.lon, tz: off, utcOffsetMinutes: b.offsetMinutes },
    utc: iso(ms),
    jd,
    approximate: year < 1900 || !timeKnown,
    approximateReason: !timeKnown
      ? 'No birth time was given, so the chart is cast for local noon: the Moon may be up to about 7° from where it stood, and there is no Ascendant, Midheaven or house.'
      : year < 1900 ? 'Before 1900 clocks were not standardised; the offset given is the one used, and local mean time is the usual choice.' : null,
    warnings: [],
    zodiac: 'tropical',
    bodies,
    angles: { ascendant: point(ang.asc), midheaven: point(ang.mc) },
    houses: { requested: 'Equal', effective: 'Equal (from the Ascendant)', cusps },
    aspects: aspectsOf(lons),
    moon: moonPhaseName(moon - sun),
    gmst: gastDeg(ms),
    timeKnown,
  };
}

/** How far either side of the moment the window reaches, and its steps (the sidecar's own). */
const WINDOW_DAYS = 16;
const PLANET_STEP_HOURS = 48;
const MOON_STEP_HOURS = 6;
const HELIO: (ChartBody | 'earth')[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'earth'];

/** Positions for ±16 days around an instant, shaped as the sidecar's window, so SkyEphemeris reads it unchanged. */
export function natalWindow(ms: number): BirthWindow {
  const half = WINDOW_DAYS * 86_400_000;
  const start = ms - half;
  const grid = (keys: (ChartBody | 'earth')[], stepHours: number, at: (k: ChartBody | 'earth', t: number) => { lon: number; lat: number; r: number }): SkyGrid => {
    const count = (2 * WINDOW_DAYS * 24) / stepHours + 1;
    const bodies: Partial<Record<BodyKey, SkyColumns>> = {};
    for (const k of keys) {
      const col: SkyColumns = { lon: [], lat: [], r: [] };
      for (let i = 0; i < count; i++) {
        const p = at(k, start + i * stepHours * 3_600_000);
        col.lon.push(p.lon); col.lat.push(p.lat); col.r.push(p.r);
      }
      bodies[k as BodyKey] = col;
    }
    return { start: iso(start), stepHours, count, bodies };
  };
  return {
    planets: grid(HELIO, PLANET_STEP_HOURS, (k, t) => helioPosition(k, t)),
    moon: grid(['moon'], MOON_STEP_HOURS, (_k, t) => geoPosition('moon', t)),
    from: iso(start),
    to: iso(ms + half),
  };
}

export const _internal = { moonPhaseName, trueObliquity };
