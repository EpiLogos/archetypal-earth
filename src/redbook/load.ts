import type { Field } from '../types/field';
import type { RedBook } from '../types/redbook';

/** Load the published Red Book data. Missing data must never become invented content. */
export async function loadRedbook(): Promise<RedBook | null> {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/data/redbook.json`);
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) return null;
    const redbook = await response.json() as RedBook;
    if (!Array.isArray(redbook.stops) || !redbook.stops.length || !Array.isArray(redbook.sections) || !Array.isArray(redbook.genesis)) return null;
    return redbook;
  } catch {
    return null;
  }
}

/**
 * Where the facsimile is served (this machine's dev server: the Norton plates never enter git or a build), a Red Book
 * instance's picture is its own folio in Jung's hand, not a picture from elsewhere standing for it. Every surface reads
 * `occurrence.image`, so the folio is set there once, before the model is built.
 */
export function useFolios(field: Field, redbook: RedBook): number {
  const byId = new Map(field.occurrences.map((o) => [o.id, o]));
  const prefix = redbook.plates.urlPrefix.replace(/^\//, '');
  let n = 0;
  for (const s of redbook.stops) {
    const o = byId.get(s.id);
    if (!o || !s.plate) continue;
    const [width, height] = s.plateSize ?? [0, 0];
    o.image = { src: `${prefix}${s.plate}`, thumb: `${prefix}${s.plate}`, width, height, title: 'Liber Novus', credit: redbook.plates.credit ?? '', license: redbook.plates.license ?? '', sourceUrl: '' };
    n++;
  }
  return n;
}
