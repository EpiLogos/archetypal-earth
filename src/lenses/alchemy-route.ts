// The Alchemy lens's routes, pure (no DOM): #/alchemy, #/alchemy/opus/<stage>, #/alchemy/operations[/<id>],
// #/alchemy/matter[/<id>], #/alchemy/elements (ProjectCentral/docs/MODES-RFC.md §5). An id the data does not name stands
// at its section, never a blank page; `opus` alone is the overview, as the Opus tab is.

export type AlchemyRoute =
  | { section: 'opus'; stage?: string }
  | { section: 'operations'; id?: string }
  | { section: 'matter'; id?: string }
  | { section: 'elements' };

/** The ids the published data names, in the order the lens walks them. */
export interface AlchemyIds {
  stages: readonly string[];
  operations: readonly string[];
  matter: readonly string[];
}

/** The route a lens path stands at. Unknown sections and ids fall back to the nearest section that exists. */
export function parseAlchemyRoute(path: readonly string[], ids: AlchemyIds): AlchemyRoute {
  const [section, id] = path;
  if (section === 'operations') return id !== undefined && ids.operations.includes(id) ? { section, id } : { section };
  if (section === 'matter') return id !== undefined && ids.matter.includes(id) ? { section, id } : { section };
  if (section === 'elements') return { section };
  if (section === 'opus' && id !== undefined && ids.stages.includes(id)) return { section, stage: id };
  return { section: 'opus' };
}

/** The lens path a route is written as (the inverse of parseAlchemyRoute for every route it can stand at). */
export function alchemyPath(route: AlchemyRoute): string[] {
  switch (route.section) {
    case 'opus': return route.stage !== undefined ? ['opus', route.stage] : [];
    case 'operations': return route.id !== undefined ? ['operations', route.id] : ['operations'];
    case 'matter': return route.id !== undefined ? ['matter', route.id] : ['matter'];
    case 'elements': return ['elements'];
  }
}
