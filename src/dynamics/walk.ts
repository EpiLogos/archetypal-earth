// The dynamical route's walk: the one `theory-route` walk of public/data/walks.json, stepped by the Walk runner. Its stops are
// the route's own, in the author's order (four movements, sixteen stops; nothing sorts them). When the walk file is absent, or has
// drifted from the route, the walk is drawn from the route itself, so the stepper never walks a different route than the Contents lists.
import type { DynamicsRoute } from '../types/dynamics';
import type { Walk } from '../types/walks';

const flat = (route: Pick<DynamicsRoute, 'movements'>) => route.movements.flatMap((m) => m.stops);

export function routeWalk(walks: ReadonlyMap<string, Walk>, route: Pick<DynamicsRoute, 'movements'>): Walk {
  const stops = flat(route);
  const w = walks.get('theory-route');
  if (w && w.stops.length === stops.length && w.stops.every((s, i) => s.subject?.id === stops[i].id)) return w;
  return {
    id: 'theory-route', kind: 'theory-route', title: 'The route through Van Eenwyk', source: 'dynamics-route.json#movements', ordered: 'curated',
    stops: stops.map((s) => ({ subject: { type: s.concept ? 'concept' as const : 'route-stop' as const, id: s.id } })),
  };
}
