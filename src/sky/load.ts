import type { SkyData } from '../types/sky';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/** Load the generated sky data. Missing data never becomes invented content: the caller labels its absence. */
export async function loadSky(): Promise<SkyData> {
  const res = await fetch(`${BASE}/data/sky.json`);
  const type = res.headers.get('content-type') ?? '';
  // vite's dev server answers unknown paths with index.html (200) — treat as absent
  if (!res.ok || type.includes('text/html')) throw new Error(`The sky data could not be loaded (HTTP ${res.status} ${type}).`);
  const sky = (await res.json()) as SkyData;
  if (!sky?.bodies?.length || !sky.planets || !sky.moon || !sky.orbits) throw new Error('The sky data is incomplete.');
  return sky;
}
