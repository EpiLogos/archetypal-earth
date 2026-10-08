// A chart, read as plainly as it was given: where each body stood, in which sign, which way it was moving, and the
// aspects the sidecar found. Nothing here interprets the chart. Jung's reading lives on the body's own card; this is
// the astronomical statement the card is entered from. The framing sentence is fixed (decision 51) and so are its limits.
import type { BodyKey, ChartPoint, SidecarChart, SkyBody } from '../types/sky';
import type { SkyEphemeris } from './ephemeris';
import { signOf } from './frames';

/** The one sentence this feature says about itself. Fixed text, not a setting. */
export const BIRTH_FRAMING = 'the sky at that moment, read in Jung\u2019s keys';

/** What the birth sky is not: stated beside the framing, never softened. */
export const BIRTH_LIMITS = 'It states where the Sun, Moon and planets stood and links each to what Jung wrote of it. It makes no forecast and passes no verdict on a person.';

/** "Leo 2°57′" from a longitude. */
export function placeInSign(lon: number): string {
  const s = signOf(lon);
  return `${s.sign} ${s.degree}°${String(s.minute).padStart(2, '0')}′`;
}

export interface ChartRow {
  key: BodyKey;
  name: string;
  lon: number;
  /** "Leo 2°57′" */
  place: string;
  retrograde: boolean;
}

/** One row per body of the chart, in the atlas's order (Sun, Moon, then the planets outward). */
export function chartRows(chart: SidecarChart, bodies: Pick<SkyBody, 'key' | 'name' | 'order'>[], nameOf: (k: BodyKey) => string = (k) => bodies.find((b) => b.key === k)?.name ?? k): ChartRow[] {
  const order: BodyKey[] = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
  return order.flatMap((key) => {
    const p: ChartPoint | undefined = chart.bodies[key];
    return p ? [{ key, name: nameOf(key), lon: p.lon, place: placeInSign(p.lon), retrograde: p.retrograde }] : [];
  });
}

/** An aspect, in words: "Sun trine Moon, orb 1.4°". */
export function describeAspect(a: SidecarChart['aspects'][number], nameOf: (k: BodyKey) => string): string {
  return `${nameOf(a.a as BodyKey)} ${a.type} ${nameOf(a.b as BodyKey)} · orb ${a.orb.toFixed(1)}°`;
}

/** The instant of the chart, ms since the Unix epoch. */
export const chartMoment = (chart: SidecarChart): number => Date.parse(chart.utc);

const offsetText = (min: number): string => {
  const sign = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
};

/** "1975-07-26 14:30 Europe/London (UTC+1) = 1975-07-26 13:30 UTC" — how the wall clock became the instant. */
export function describeInstant(chart: SidecarChart): string {
  const local = chart.input.local.replace('T', ' ');
  const utc = chart.utc.replace('T', ' ').replace(/:\d{2}Z$/, ' UTC');
  const off = chart.input.utcOffsetMinutes;
  // a clock set to local mean time has an offset in odd minutes; the sidecar gives it to the minute, and so do we
  return `${local} ${chart.input.tz} (${offsetText(off)}) = ${utc}`;
}

/** Pre-1900 local times are approximate, and the chart says so wherever it speaks. */
export function approximationNote(chart: SidecarChart): string | null {
  return chart.approximate ? `Approximate: ${chart.approximateReason ?? 'before 1900 the civil clock is not reliable'}` : null;
}

/** The Moon's phase at the chart's instant, from the sidecar's own words. */
export function chartMoonPhase(chart: SidecarChart): string | null {
  return chart.moon ? `${chart.moon.name} Moon${chart.moon.stage ? `, ${chart.moon.stage}` : ''}` : null;
}

/**
 * How far the diagram's own positions (the birth window's grids) stand from the chart's longitudes, per body, degrees.
 * Both come from the one sidecar; the difference is only light-time and aberration (Sun and Moon are apparent in the
 * chart, geometric in the grids). Used to pin that the bodies fly to the longitudes the chart states.
 */
export function chartAgreement(chart: SidecarChart, eph: SkyEphemeris): Partial<Record<BodyKey, number>> {
  const ms = chartMoment(chart);
  const out: Partial<Record<BodyKey, number>> = {};
  for (const [key, p] of Object.entries(chart.bodies) as [BodyKey, ChartPoint][]) {
    const g = eph.geo(key, ms);
    if (g) out[key] = Math.abs((((g.lon - p.lon) % 360) + 540) % 360 - 180);
  }
  return out;
}
