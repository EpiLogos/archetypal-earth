// Place lookup for the birth sky: the gazetteer first (instant, offline, sourced), the sidecar's geocoder only when the
// gazetteer has nothing the person means. Pure: matching is accent- and case-insensitive prefix-then-substring.
import type { GazetteerPlace, GeocodeResult } from '../types/sky';

/** Lowercase, accents folded, punctuation to spaces: "Zürich" and "zurich" meet. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** A place a person chose or typed: where it is, and where that knowledge came from. */
export interface ChosenPlace {
  name: string;
  lat: number;
  lon: number;
  source: 'gazetteer' | 'geocoder' | 'coordinates';
}

/** Matches for a typed query: names that begin with it first, then names (or countries) that contain it. */
export function findPlaces(places: GazetteerPlace[], query: string, limit = 6): GazetteerPlace[] {
  const q = fold(query);
  if (q.length < 1) return [];
  const starts: GazetteerPlace[] = [];
  const contains: GazetteerPlace[] = [];
  for (const p of places) {
    const n = fold(p.name);
    if (n.startsWith(q) || n.split(' ').some((w) => w.startsWith(q))) starts.push(p);
    else if (n.includes(q) || fold(p.country).startsWith(q)) contains.push(p);
  }
  const byName = (a: GazetteerPlace, b: GazetteerPlace) => a.name.localeCompare(b.name);
  return [...starts.sort(byName), ...contains.sort(byName)].slice(0, limit);
}

export const fromGazetteer = (p: GazetteerPlace): ChosenPlace => ({ name: `${p.name}, ${p.country}`, lat: p.lat, lon: p.lon, source: 'gazetteer' });

/** A geocoder answer is a long display name; keep the first three parts for the field, and say where it came from. */
export function fromGeocode(r: GeocodeResult): ChosenPlace {
  const short = r.name.split(',').map((x) => x.trim()).filter(Boolean);
  return { name: short.length > 3 ? `${short[0]}, ${short[short.length - 1]}` : r.name, lat: Number(r.lat.toFixed(4)), lon: Number(r.lon.toFixed(4)), source: 'geocoder' };
}

/** "47.37° N, 8.54° E" */
export function formatCoordinates(lat: number, lon: number): string {
  const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;
  return `${f(lat, 'N', 'S')}, ${f(lon, 'E', 'W')}`;
}
