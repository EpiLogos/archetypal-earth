// The client's only astronomy: cubic interpolation of the grids the sidecar generated (public/data/sky.json).
// No second ephemeris lives here — a moment outside the generated span has no position and says so
// (`null`), and the caller labels it. Pure, golden-tested against the sidecar's off-grid probe epoch.
import type { BodyKey, SkyColumns, SkyData, SkyGrid } from '../types/sky';

export interface SkyPoint {
  /** ecliptic longitude of date, degrees 0..360 */
  lon: number;
  lat: number;
  /** au (the Moon's is geocentric au; planets' and Earth's are heliocentric) */
  r: number;
}

const HOUR = 3_600_000;

/** One sampled quantity set, longitudes unwrapped so interpolation never crosses 360° → 0°. */
class Series {
  readonly t0: number;
  readonly step: number;
  readonly count: number;
  private lon: Float64Array;
  private lat: Float64Array;
  private r: Float64Array;

  constructor(grid: Pick<SkyGrid, 'start' | 'stepHours' | 'count'>, cols: SkyColumns) {
    this.t0 = Date.parse(grid.start);
    this.step = grid.stepHours * HOUR;
    this.count = grid.count;
    this.lon = new Float64Array(cols.lon.length);
    let prev = cols.lon[0];
    let offset = 0;
    for (let i = 0; i < cols.lon.length; i++) {
      const d = cols.lon[i] - prev;
      if (d < -180) offset += 360; else if (d > 180) offset -= 360;
      prev = cols.lon[i];
      this.lon[i] = cols.lon[i] + offset;
    }
    this.lat = Float64Array.from(cols.lat);
    this.r = Float64Array.from(cols.r);
  }

  get end(): number {
    return this.t0 + (this.count - 1) * this.step;
  }

  covers(ms: number): boolean {
    return ms >= this.t0 && ms <= this.end;
  }

  private hermite(a: Float64Array, i: number, u: number): number {
    const n = a.length;
    const p0 = a[Math.max(0, i - 1)];
    const p1 = a[i];
    const p2 = a[Math.min(n - 1, i + 1)];
    const p3 = a[Math.min(n - 1, i + 2)];
    const m1 = (p2 - p0) / (i === 0 ? 1 : 2);
    const m2 = (p3 - p1) / (i + 1 >= n - 1 ? 1 : 2);
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
  }

  at(ms: number, out: SkyPoint): SkyPoint | null {
    if (!this.covers(ms)) return null;
    const f = (ms - this.t0) / this.step;
    const i = Math.min(this.count - 2, Math.floor(f));
    const u = f - i;
    const lon = this.hermite(this.lon, i, u);
    out.lon = ((lon % 360) + 360) % 360;
    out.lat = this.hermite(this.lat, i, u);
    out.r = this.hermite(this.r, i, u);
    return out;
  }
}

export class SkyEphemeris {
  readonly from: number;
  readonly to: number;
  private helioSeries = new Map<BodyKey, Series>();
  private moonSeries: Series;

  constructor(readonly data: SkyData) {
    for (const [key, cols] of Object.entries(data.planets.bodies)) this.helioSeries.set(key as BodyKey, new Series(data.planets, cols!));
    this.moonSeries = new Series(data.moon, data.moon.bodies.moon!);
    this.from = Math.max(this.helioSeries.get('earth')!.t0, this.moonSeries.t0);
    this.to = Math.min(this.helioSeries.get('earth')!.end, this.moonSeries.end);
  }

  /** True when every position is available at this instant. */
  covers(ms: number): boolean {
    return ms >= this.from && ms <= this.to;
  }

  /** Nearest instant the generated grids can answer for, and whether `ms` was inside them. */
  clamp(ms: number): { ms: number; inside: boolean } {
    return { ms: Math.min(this.to, Math.max(this.from, ms)), inside: this.covers(ms) };
  }

  /** Heliocentric ecliptic of date: planets and Earth. */
  helio(key: BodyKey, ms: number, out: SkyPoint = { lon: 0, lat: 0, r: 0 }): SkyPoint | null {
    return this.helioSeries.get(key)?.at(ms, out) ?? null;
  }

  /** Geocentric ecliptic of date. */
  moon(ms: number, out: SkyPoint = { lon: 0, lat: 0, r: 0 }): SkyPoint | null {
    return this.moonSeries.at(ms, out);
  }

  /** The Sun as seen from Earth: the Earth's heliocentric position turned around. */
  sunGeo(ms: number, out: SkyPoint = { lon: 0, lat: 0, r: 0 }): SkyPoint | null {
    const e = this.helio('earth', ms, out);
    if (!e) return null;
    e.lon = (e.lon + 180) % 360;
    e.lat = -e.lat;
    return e;
  }

  /**
   * Geocentric ecliptic of date for any body but the Earth (the observer): the heliocentric vectors subtracted.
   * This is the longitude an astronomer calls "in Gemini 14°" — tropical, of date.
   */
  geo(key: BodyKey, ms: number, out: SkyPoint = { lon: 0, lat: 0, r: 0 }): SkyPoint | null {
    if (key === 'earth') return null;
    if (key === 'moon') return this.moon(ms, out);
    if (key === 'sun') return this.sunGeo(ms, out);
    const b = this.helio(key, ms);
    const e = this.helio('earth', ms);
    if (!b || !e) return null;
    const rad = Math.PI / 180;
    const vec = (p: SkyPoint): [number, number, number] => [p.r * Math.cos(p.lat * rad) * Math.cos(p.lon * rad), p.r * Math.cos(p.lat * rad) * Math.sin(p.lon * rad), p.r * Math.sin(p.lat * rad)];
    const vb = vec(b);
    const ve = vec(e);
    const d: [number, number, number] = [vb[0] - ve[0], vb[1] - ve[1], vb[2] - ve[2]];
    const r = Math.hypot(d[0], d[1], d[2]);
    out.lon = ((Math.atan2(d[1], d[0]) / rad) + 360) % 360;
    out.lat = Math.asin(d[2] / r) / rad;
    out.r = r;
    return out;
  }

  /** The Moon's actual geocentric path for one revolution centred on `ms`, as ecliptic samples (for its ring). */
  moonPath(ms: number, samples = 96, periodDays = 27.321661): SkyPoint[] | null {
    const half = (periodDays * 86_400_000) / 2;
    const t0 = Math.min(this.to - 2 * half, Math.max(this.from, ms - half));
    if (t0 + 2 * half > this.to) return null;
    const out: SkyPoint[] = [];
    for (let i = 0; i < samples; i++) {
      const p = this.moon(t0 + (i / samples) * 2 * half);
      if (!p) return null;
      out.push(p);
    }
    return out;
  }
}
