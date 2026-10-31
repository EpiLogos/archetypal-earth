// The Red Book's walk: the one `redbook` walk of public/data/walks.json, stepped by the Walk runner. The folio rail and the
// pane's stepper show the same stops in the same order as the curated descent (redbook.json), which is the order the book is
// read in. When the walk file is absent, or has drifted from the curated stops, the walk is drawn from the stops themselves, so the
// rail never shows a different book than the Contents lists.
import type { Model } from '../data/model';
import type { RedBook } from '../types/redbook';
import type { Walk } from '../types/walks';

const sameStops = (w: Walk, rb: Pick<RedBook, 'stops'>) => w.stops.length === rb.stops.length && w.stops.every((s, i) => s.subject?.id === rb.stops[i].id);

export function redbookWalk(m: Pick<Model, 'walkById' | 'occIndex' | 'occ'>, rb: Pick<RedBook, 'stops'>): Walk {
  const w = m.walkById.get('redbook');
  if (w && sameStops(w, rb)) return w;
  return {
    id: 'redbook', kind: 'redbook', title: 'Liber Novus, folio by folio', source: 'redbook.json#stops', ordered: 'curated',
    stops: rb.stops.map((s) => {
      const i = m.occIndex.get(s.id);
      const o = i === undefined ? undefined : m.occ[i];
      return { subject: { type: 'occurrence' as const, id: s.id }, ...(o ? { year: o.year } : {}), ...(o && Number.isFinite(o.lat) && Number.isFinite(o.lon) ? { place: { lat: o.lat, lon: o.lon } } : {}) };
    }),
  };
}
