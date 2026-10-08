// The page's one conversation with the local ephemeris sidecar for a birth sky: the chart, the place lookup, and the
// short window of positions around the birth moment. The sidecar computes; this file only asks, checks the answer
// against the contract in src/types/sky.ts, and says plainly why it could not. Nothing here touches the DOM or three.
//
// A deployed copy of the site never calls: `local` is false and every ask is refused up front (the same rule the live
// clock follows). Whatever the sidecar returns is validated before it is believed — a malformed chart is an error, not a
// chart with holes.
import { BODY_KEYS } from '../types/sky';
import type { BodyKey, GeocodeResult, SidecarChart, SkyColumns, SkyData, SkyGrid } from '../types/sky';

export type SidecarFailure =
  /** this page may not talk to a sidecar (a deployed site) */
  | 'not-local'
  /** nothing answered at the sidecar's address */
  | 'absent'
  /** the instant lies outside the kernel the sidecar loaded (DE440, 1549–2650) */
  | 'out-of-range'
  /** the sidecar refused the input (a date that does not exist, a place with no time zone, …) */
  | 'bad-input'
  /** the place lookup could not reach its service */
  | 'geocoder'
  /** the sidecar answered, but not in the shape the contract promises */
  | 'unsupported';

export class SidecarError extends Error {
  constructor(readonly kind: SidecarFailure, message: string) {
    super(message);
    this.name = 'SidecarError';
  }
}

export interface SidecarOptions {
  base: string;
  local: boolean;
  fetch?: typeof fetch;
  /** ms before a call gives up; the geocoder is slower (it asks a public service) */
  timeout?: number;
  geocodeTimeout?: number;
}

/** The place and the wall-clock moment a birth sky is asked for. */
export interface BirthInput {
  /** `YYYY-MM-DDTHH:MM`, wall-clock time at the place: the sidecar resolves the zone */
  local: string;
  lat: number;
  lon: number;
}

/** `YYYY-MM-DDTHH:MM` and a place, from the strings a form holds. Null when it is not a moment that can exist. */
export function parseBirthInput(date: string, time: string, lat: number, lon: number): BirthInput | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  // the calendar date must exist (Feb 30 is not a date), and the clock must be a clock
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  if (h > 23 || mi > 59) return null;
  return { local: `${date}T${time}`, lat, lon };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Check a chart against the contract the page codes to (`SidecarChart`): every field the page reads is present and
 * the right kind, longitudes are in range, every body the field knows as a classical or modern planet is there.
 * Returns the problems found; an empty list is a chart the page may use.
 */
export function chartProblems(c: unknown): string[] {
  const out: string[] = [];
  const o = c as Partial<SidecarChart> | null;
  if (!o || typeof o !== 'object') return ['the chart is not an object'];
  const point = (p: unknown, where: string) => {
    const q = p as Record<string, unknown> | null;
    if (!q || typeof q !== 'object') { out.push(`${where}: missing`); return; }
    if (!isNum(q.lon) || q.lon < 0 || q.lon >= 360) out.push(`${where}.lon: expected 0 ≤ lon < 360`);
    if (typeof q.sign !== 'string') out.push(`${where}.sign: expected string`);
    if (!isNum(q.signIndex) || q.signIndex < 0 || q.signIndex > 11) out.push(`${where}.signIndex: expected 0..11`);
    if (!isNum(q.degree) || q.degree < 0 || q.degree >= 30) out.push(`${where}.degree: expected 0 ≤ degree < 30`);
    if (typeof q.retrograde !== 'boolean') out.push(`${where}.retrograde: expected boolean`);
    // a point's sign and degree must agree with its longitude: the sidecar's own two statements of one fact
    if (isNum(q.lon) && isNum(q.signIndex) && isNum(q.degree) && Math.abs(q.signIndex * 30 + q.degree - q.lon) > 1e-6) out.push(`${where}: sign and degree disagree with lon`);
  };
  const inp = o.input as Partial<SidecarChart['input']> | undefined;
  if (!inp || typeof inp.local !== 'string' || !isNum(inp.lat) || !isNum(inp.lon) || typeof inp.tz !== 'string' || !isNum(inp.utcOffsetMinutes)) out.push('input: expected local, lat, lon, tz, utcOffsetMinutes');
  if (typeof o.utc !== 'string' || !Number.isFinite(Date.parse(o.utc))) out.push('utc: expected an ISO instant');
  if (!isNum(o.jd)) out.push('jd: expected number');
  if (typeof o.approximate !== 'boolean') out.push('approximate: expected boolean');
  if (o.approximate && typeof o.approximateReason !== 'string') out.push('approximateReason: an approximate chart states why');
  if (!Array.isArray(o.warnings)) out.push('warnings: expected array');
  if (o.zodiac !== 'tropical') out.push('zodiac: expected "tropical" (the page labels longitudes as such)');
  if (!o.bodies || typeof o.bodies !== 'object') out.push('bodies: missing');
  else for (const k of BODY_KEYS) if (k !== 'earth') point((o.bodies as Record<string, unknown>)[k], `bodies.${k}`);
  point(o.angles?.ascendant, 'angles.ascendant');
  point(o.angles?.midheaven, 'angles.midheaven');
  if (!o.houses || typeof o.houses.effective !== 'string' || !Array.isArray(o.houses.cusps) || o.houses.cusps.length !== 12 || !o.houses.cusps.every((x) => isNum(x) && x >= 0 && x < 360)) out.push('houses: expected effective system and 12 cusp longitudes');
  if (!Array.isArray(o.aspects)) out.push('aspects: expected array');
  else o.aspects.forEach((a, i) => { if (typeof a?.a !== 'string' || typeof a?.b !== 'string' || typeof a?.type !== 'string' || !isNum(a?.orb)) out.push(`aspects[${i}]: expected a, b, type, orb`); });
  return out;
}

/** The chart, or an error naming every way it broke the contract. */
export function validateChart(c: unknown): SidecarChart {
  const problems = chartProblems(c);
  if (problems.length) throw new SidecarError('unsupported', `The sidecar's chart does not match its contract: ${problems.join('; ')}`);
  return c as SidecarChart;
}

/** How far either side of the birth moment the window of positions reaches: enough for the Moon's whole ring. */
export const WINDOW_DAYS = 16;
const PLANET_STEP_HOURS = 48;
const MOON_STEP_HOURS = 6;
const HELIO: BodyKey[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'earth'];

/** A window of the sidecar's own grids around one instant, shaped as the generated sky is, so SkyEphemeris reads it as is. */
export interface BirthWindow {
  planets: SkyGrid;
  moon: SkyGrid;
  from: string;
  to: string;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

function checkGrid(g: SkyGrid, bodies: string[], where: string) {
  if (!g || typeof g.start !== 'string' || !isNum(g.stepHours) || !isNum(g.count) || !g.bodies) throw new SidecarError('unsupported', `The sidecar's ${where} grid is malformed.`);
  for (const b of bodies) {
    const col = g.bodies[b as BodyKey] as SkyColumns | undefined;
    if (!col || [col.lon, col.lat, col.r].some((a) => !Array.isArray(a) || a.length !== g.count || a.some((x) => !isNum(x)))) throw new SidecarError('unsupported', `The sidecar's ${where} grid has a malformed ${b} column.`);
  }
}

/** The data a SkyEphemeris needs, with its grids replaced by a birth window (everything else — rings, bodies — is the generated sky's). */
export function dataWithWindow(base: SkyData, w: BirthWindow): SkyData {
  return { ...base, planets: w.planets, moon: w.moon, meta: { ...base.meta, span: { from: w.from, to: w.to } } };
}

export class SidecarClient {
  private readonly o: Required<SidecarOptions>;

  constructor(o: SidecarOptions) {
    this.o = { fetch: (...a) => globalThis.fetch(...a), timeout: 8000, geocodeTimeout: 12000, ...o };
  }

  private async get<T>(path: string, params: Record<string, string | number>, timeout = this.o.timeout): Promise<T> {
    if (!this.o.local) throw new SidecarError('not-local', 'The ephemeris sidecar is only reachable when the site runs beside it, on this machine.');
    const url = `${this.o.base}${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    let res: Response;
    try {
      res = await this.o.fetch(url, { signal: ctl.signal });
    } catch {
      throw new SidecarError('absent', 'The ephemeris sidecar is not running (start it with ephemeris/run.sh).');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail: { error?: string; message?: string } | string | undefined;
      try { detail = ((await res.json()) as { detail?: typeof detail }).detail; } catch { /* the body was not JSON */ }
      const d = detail && typeof detail === 'object' ? detail : undefined;
      if (d?.error === 'outside-ephemeris-range') throw new SidecarError('out-of-range', `${d.message ?? 'That instant'} — the sky is computed only within the JPL DE440 ephemeris, 1549–2650.`);
      if (d?.error === 'geocoder-unreachable') throw new SidecarError('geocoder', 'The place lookup could not reach its service; choose a listed place or enter the coordinates.');
      if (res.status === 422) throw new SidecarError('bad-input', typeof detail === 'string' ? detail : d?.message ?? 'The sidecar did not accept that input.');
      throw new SidecarError('unsupported', `The sidecar answered ${res.status}.`);
    }
    try { return (await res.json()) as T; } catch { throw new SidecarError('unsupported', 'The sidecar did not answer with JSON.'); }
  }

  /** Is anything there? True only for an answer that names itself as the ephemeris sidecar. */
  async available(): Promise<boolean> {
    try {
      const p = await this.get<{ name?: string }>('/ping', {}, 2500);
      return typeof p.name === 'string' && p.name.includes('ephemeris');
    } catch {
      return false;
    }
  }

  async chart(b: BirthInput): Promise<SidecarChart> {
    return validateChart(await this.get('/chart', { local: b.local, lat: b.lat, lon: b.lon }));
  }

  async geocode(q: string): Promise<GeocodeResult[]> {
    const r = await this.get<{ results?: GeocodeResult[] }>('/geocode', { q }, this.o.geocodeTimeout);
    if (!Array.isArray(r.results)) throw new SidecarError('unsupported', 'The place lookup did not answer in the expected shape.');
    return r.results.filter((x) => typeof x?.name === 'string' && isNum(x.lat) && isNum(x.lon) && Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180);
  }

  /** The sidecar's positions for ±WINDOW_DAYS around an instant: planets and Earth heliocentric, the Moon geocentric. */
  async window(centreMs: number): Promise<BirthWindow> {
    const half = WINDOW_DAYS * 86_400_000;
    const start = iso(centreMs - half);
    const [planets, moon] = await Promise.all([
      this.get<SkyGrid>('/positions', { start, stepHours: PLANET_STEP_HOURS, count: (2 * WINDOW_DAYS * 24) / PLANET_STEP_HOURS + 1, bodies: HELIO.join(','), frame: 'helio' }),
      this.get<SkyGrid>('/positions', { start, stepHours: MOON_STEP_HOURS, count: (2 * WINDOW_DAYS * 24) / MOON_STEP_HOURS + 1, bodies: 'moon', frame: 'geo' }),
    ]);
    checkGrid(planets, HELIO, 'planet');
    checkGrid(moon, ['moon'], 'Moon');
    return { planets, moon, from: iso(centreMs - half), to: iso(centreMs + half) };
  }
}
