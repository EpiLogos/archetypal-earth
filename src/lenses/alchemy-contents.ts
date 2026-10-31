// ALCHEMY: the Contents of the lens (H5) and its stage walk (S9). The Contents are the opus (its overview, then the four stages),
// the operations, the matter and the elements; the stages are walked by the Walk runner over the `alchemy-stages` walk of
// public/data/walks.json, in the opus's own order (nigredo, albedo, citrinitas, rubedo: nothing sorts them). When the walk file is
// absent, or has drifted from the opus, the walk is drawn from the opus itself, so the stepper never walks a different opus than the
// Contents list.
import type { Walk } from '../types/walks';
import type { ContentsGroup } from '../ui/deep';
import type { AlchemyRoute } from './alchemy-route';

/** What the Contents read of the published data: the names of the opus's stages, its operations and its matter, in the data's order. */
export interface AlchemyNames {
  stages: readonly { id: string; name: string }[];
  operations: readonly { id: string; name: string }[];
  matter: readonly { id: string; name: string }[];
}

export function stagesWalk(walks: ReadonlyMap<string, Walk>, stages: readonly { id: string }[]): Walk {
  const w = walks.get('alchemy-stages');
  if (w && w.stops.length === stages.length && w.stops.every((s, i) => s.subject?.id === stages[i].id)) return w;
  return {
    id: 'alchemy-stages', kind: 'alchemy-stages', title: 'The opus, stage by stage', source: 'alchemy.json#opus.stages', ordered: 'curated',
    stops: stages.map((s) => ({ subject: { type: 'stage' as const, id: s.id } })),
  };
}

/**
 * The Contents: the opus whole and its stages, the operations and the matter (each with its list first), the elements. `at` is the route the lens stands at;
 * the entry it names is marked.
 */
export function alchemyContentsGroups(names: AlchemyNames, at: AlchemyRoute | null, go: (path: string[]) => void): ContentsGroup[] {
  const onOpus = at?.section === 'opus';
  return [
    {
      title: 'The opus',
      items: [
        { label: 'The whole opus', current: onOpus && at.stage === undefined, onPick: () => go([]) },
        ...names.stages.map((s, i) => ({ label: s.name, note: String(i + 1), current: onOpus && at.stage === s.id, onPick: () => go(['opus', s.id]) })),
      ],
    },
    {
      title: 'Operations',
      items: [
        { label: 'All operations', current: at?.section === 'operations' && at.id === undefined, onPick: () => go(['operations']) },
        ...names.operations.map((o) => ({ label: o.name, current: at?.section === 'operations' && at.id === o.id, onPick: () => go(['operations', o.id]) })),
      ],
    },
    {
      title: 'Matter',
      items: [
        { label: 'All matter', current: at?.section === 'matter' && at.id === undefined, onPick: () => go(['matter']) },
        ...names.matter.map((x) => ({ label: x.name, current: at?.section === 'matter' && at.id === x.id, onPick: () => go(['matter', x.id]) })),
      ],
    },
    { title: 'Elements', items: [{ label: 'The elements', current: at?.section === 'elements', onPick: () => go(['elements']) }] },
  ];
}
