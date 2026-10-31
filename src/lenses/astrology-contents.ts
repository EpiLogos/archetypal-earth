// ASTROLOGY: the Contents of the lens (H5). The charts (the visitor's own and the curated one) and, under them, the planets of
// the chart that is walked, each with the sign and degree it stands at in that chart. A chart opens its birth sky (no reading:
// the sky is the thing); a planet opens its reading in the pane. Pure: the charts and the placements in, groups out.
import type { ContentsGroup } from '../ui/deep';

export interface ChartListing {
  id: string;
  label: string;
  /** the visitor's own chart is spoken to ("Your sky"); another is named ("Jung’s sky") */
  own: boolean;
}

export interface PlanetListing {
  key: string;
  name: string;
  /** where the planet stands in the walked chart, as the chart gives it ("Leo 12°") */
  placement: string;
}

export const skyName = (c: ChartListing): string => (c.own ? 'Your sky' : `${c.label}’s sky`);

/**
 * `at` is the route the lens stands at: `[]` the charts, `['sky']` the live sky, `[chart]` a birth sky, `[chart, body]` a planet.
 * `walked` is the chart whose planets are listed; it is the one the route names, else the visitor's own, else the curated one.
 */
export function astrologyContentsGroups(
  charts: readonly ChartListing[],
  walked: ChartListing | null,
  planets: readonly PlanetListing[],
  at: readonly string[],
  go: (path: string[]) => void,
): ContentsGroup[] {
  const onChart = (id: string) => at[0] === id && !at[1];
  return [
    {
      title: 'Charts',
      items: [
        { label: 'Charts', current: at.length === 0, onPick: () => go([]) },
        ...charts.map((c) => ({ label: skyName(c), current: onChart(c.id), onPick: () => go([c.id]) })),
      ],
    },
    ...(walked && planets.length
      ? [{
        title: walked.own ? 'Your planets' : `${walked.label}’s planets`,
        items: planets.map((p) => ({ label: p.name, note: p.placement, current: at[0] === walked.id && at[1] === p.key, onPick: () => go([walked.id, p.key]) })),
      }]
      : []),
  ];
}
