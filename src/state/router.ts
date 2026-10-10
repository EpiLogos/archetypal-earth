// URL hash <-> state, so every state is linkable and Back works.
import type { Subject } from '../data/model';
import { PANEL_LENSES, WORLD, type AppState, type PanelLensId, type ThreadTarget } from './store';
import { filterQuery, parseFilter, type FieldFilter } from '../shell/filter';

export interface Resolver {
  hasArchetype(id: string): boolean;
  hasFamily(id: string): boolean;
  hasCulture(id: string): boolean;
  hasPlace(id: string): boolean;
  /** family id of an occurrence, or undefined when it doesn't exist */
  familyOf(occId: string): string | undefined;
  hasReading?(id: string): boolean;
  hasHistorySelection?(reading: string, kind: string, id: string): boolean;
  hasRedBookStop?(id: string): boolean;
  hasBody?(id: string): boolean;
  /** the reading Aion opens on when no reading is named (the same one its switch opens) */
  defaultReading?(): string | undefined;
}

export interface Parsed {
  state: AppState;
  /** a time cursor requested by the hash (#/y/1600) */
  year?: number;
  /** the field filter the hash carries after `?` (empty when none) */
  filter: FieldFilter;
}

/** The hash for a state with the field filter appended (`#/a/self?w=cw12`). */
export function hashWithFilter(s: AppState, f: FieldFilter): string {
  const q = filterQuery(f);
  return q ? `${stateToHash(s)}?${q}` : stateToHash(s);
}

const enc = encodeURIComponent;

/** The reading Aion opens on when no reading is named: the first of the authored readings. The switch and `#/aion` both use it. */
export function defaultReadingId(readings: readonly { id: string }[]): string | undefined {
  return readings[0]?.id;
}

/** `#/sky`, `#/sky/<body>`, `#/sky/birth/<local>/<lat>/<lon>`, each optionally ending `/c/<culture>`: the sky is linkable at every depth. */
const num = (n: number) => String(Number(n.toFixed(4)));

export function stateToHash(s: AppState): string {
  if (s.lens) return `#/${s.lens.id}${s.lens.path.map((p) => `/${enc(p)}`).join('')}`;
  if (s.sky) {
    const tail = `${s.sky.body ? `/${enc(s.sky.body)}` : ''}${s.sky.culture ? `/c/${enc(s.sky.culture)}` : ''}`;
    if (s.sky.birth) return `#/sky/birth/${enc(s.sky.birth.local)}/${num(s.sky.birth.lat)}/${num(s.sky.birth.lon)}${tail}`;
    return `#/sky${tail}`;
  }
  if (s.history) {
    const h = s.history;
    return `#/aion/${enc(h.reading)}${h.selection ? `/${h.selection.kind}/${enc(h.selection.id)}` : ''}`;
  }
  if (s.redbook) {
    const rb = s.redbook;
    return `#/redbook${rb.genesis ? '/genesis' : rb.stop ? `/${enc(rb.stop)}` : ''}`;
  }
  if (s.dynamics) {
    // the lens: #/dynamics (the Self), or #/dynamics/<a|f|c|p>/<id> for a subject, the focus route's own codes
    const sub = s.dynamics.subject;
    return `#/dynamics${sub ? `/${{ archetype: 'a', family: 'f', culture: 'c', place: 'p' }[sub.type]}/${enc(sub.id)}` : ''}`;
  }
  if (s.trail && s.view.kind === 'manifest') {
    return `${stateToHash({ view: s.trail, deep: false })}/o/${enc(s.view.occId)}${s.deep ? '/deep' : ''}`;
  }
  const v = s.view;
  const deep = s.deep ? '/deep' : '';
  // the graph is a view marker in front of the usual route: #/graph, #/graph/a/self, #/graph/f/serpent
  const g = s.graph && v.kind !== 'thread' ? '/graph' : '';
  switch (v.kind) {
    case 'world':
      return g ? '#/graph' : '#/';
    case 'focus': {
      const k = { archetype: 'a', family: 'f', culture: 'c', place: 'p' }[v.subject.type];
      return `#${g}/${k}/${enc(v.subject.id)}${deep}`;
    }
    case 'manifest':
      return `#${g}/o/${enc(v.occId)}${deep}`;
    case 'thread': {
      const t = v.target;
      // `#/t/serpent` is the short form for a family thread
      if (t.type === 'family') return `#/t/${enc(t.id)}${deep}`;
      return `#/t/${t.type === 'archetype' ? 'a' : 'p'}/${enc(t.id)}${deep}`;
    }
  }
}

export function hashToState(hash: string, r: Resolver): Parsed {
  const q = hash.indexOf('?');
  const filter = q >= 0 ? parseFilter(hash.slice(q + 1)) : {};
  const parsed = routeToState(q >= 0 ? hash.slice(0, q) : hash, r);
  return { ...parsed, filter };
}

function routeToState(hash: string, r: Resolver): Omit<Parsed, 'filter'> {
  let parts: string[];
  try { parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((p) => decodeURIComponent(p)); }
  catch { return { state: WORLD }; }
  if (!parts.length) return { state: WORLD };
  if ((PANEL_LENSES as readonly string[]).includes(parts[0])) {
    return { state: { view: { kind: 'world' }, deep: false, lens: { id: parts[0] as PanelLensId, path: parts.slice(1, 4) } } };
  }
  if (parts[0] === 'sky') {
    const sky: NonNullable<AppState['sky']> = {};
    let rest = parts.slice(1);
    if (rest[0] === 'birth') {
      const [, local, la, lo] = rest;
      const lat = Number(la);
      const lon = Number(lo);
      if (local && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) && la !== undefined && lo !== undefined && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        sky.birth = { local, lat, lon };
        rest = rest.slice(4);
      } else rest = [];
    }
    if (rest[0] && r.hasBody?.(rest[0])) { sky.body = rest[0] as NonNullable<AppState['sky']>['body']; rest = rest.slice(1); }
    if (rest[0] === 'c' && rest[1] && r.hasCulture(rest[1])) sky.culture = rest[1];
    return { state: { view: { kind: 'world' }, deep: false, sky } };
  }
  if (parts[0] === 'redbook') {
    const rb: NonNullable<AppState['redbook']> = {};
    if (parts[1] === 'genesis') rb.genesis = true;
    else if (parts[1] && r.hasRedBookStop?.(parts[1])) rb.stop = parts[1];
    return { state: { view: { kind: 'world' }, deep: false, redbook: rb } };
  }
  if (parts[0] === 'dynamics') {
    // an unknown subject is the lens with the Self, never a silent world
    const [, k, id] = parts;
    const subject: Subject | undefined = !id ? undefined
      : k === 'a' && r.hasArchetype(id) ? { type: 'archetype', id }
      : k === 'f' && r.hasFamily(id) ? { type: 'family', id }
      : k === 'c' && r.hasCulture(id) ? { type: 'culture', id }
      : k === 'p' && r.hasPlace(id) ? { type: 'place', id }
      : undefined;
    return { state: { view: { kind: 'world' }, deep: false, dynamics: subject ? { subject } : {} } };
  }
  if (parts[0] === 'aion') {
    // `#/aion` alone is the default reading, as the switch opens it; `#/aion/<reading>[/<kind>/<id>]` names one
    const [, named, kind, id] = parts;
    const reading = named ?? r.defaultReading?.();
    if (!reading || !r.hasReading?.(reading)) return { state: WORLD };
    const selection: NonNullable<AppState['history']>['selection'] = (kind === 'epoch' || kind === 'event' || kind === 'thread') && id && r.hasHistorySelection?.(reading, kind, id) ? { kind, id } : undefined;
    return { state: { view: { kind: 'world' }, deep: false, history: { reading, ...(selection ? { selection } : {}) } } };
  }
  const graph = parts[0] === 'graph';
  if (graph) parts.shift();
  const deep = parts[parts.length - 1] === 'deep';
  if (deep) parts.pop();
  const [kind, a, b] = parts;
  // a thread travels the globe, so `#/graph/t/...` falls back to the globe
  const withDeep = (state: AppState): Omit<Parsed, "filter"> => ({ state: { view: state.view, deep, ...(graph && state.view.kind !== 'thread' ? { graph: true as const } : {}) } });
  if (graph && !kind) return { state: { view: { kind: 'world' }, deep: false, graph: true } };
  const focusState = (subject: Subject): AppState => ({ view: { kind: 'focus', subject }, deep: false });

  switch (kind) {
    case 'a':
      if (a && r.hasArchetype(a)) return withDeep(focusState({ type: 'archetype', id: a }));
      break;
    case 'f':
      if (a && r.hasFamily(a)) return withDeep(focusState({ type: 'family', id: a }));
      break;
    case 'c':
      if (a && r.hasCulture(a)) return withDeep(focusState({ type: 'culture', id: a }));
      break;
    case 'p':
      if (a && r.hasPlace(a)) return withDeep(focusState({ type: 'place', id: a }));
      break;
    case 'o': {
      const fam = a ? r.familyOf(a) : undefined;
      if (a && fam) return withDeep({ view: { kind: 'manifest', occId: a, context: { type: 'family', id: fam } }, deep: false });
      break;
    }
    case 't': {
      let target: ThreadTarget | null = null;
      if (a === 'a' && b && r.hasArchetype(b)) target = { type: 'archetype', id: b };
      else if (a === 'f' && b && r.hasFamily(b)) target = { type: 'family', id: b };
      else if (a === 'p' && b && r.familyOf(b)) target = { type: 'parallels', id: b };
      else if (a && (!b || b === 'o')) {
        if (r.hasFamily(a)) target = { type: 'family', id: a };
        else if (r.hasArchetype(a)) target = { type: 'archetype', id: a };
      }
      if (target) {
        let from: AppState['view'];
        if (target.type === 'parallels') from = { kind: 'manifest', occId: target.id, context: { type: 'family', id: r.familyOf(target.id)! } };
        else from = { kind: 'focus', subject: { type: target.type, id: target.id } };
        const thread = { kind: 'thread' as const, target, from };
        const openAt = parts.indexOf('o', 2);
        const occurrence = openAt >= 0 ? parts[openAt + 1] : undefined;
        const family = occurrence ? r.familyOf(occurrence) : undefined;
        if (occurrence && family) return { state: { view: { kind: 'manifest', occId: occurrence, context: { type: 'family', id: family } }, trail: thread, deep } };
        return withDeep({ view: thread, deep: false });
      }
      break;
    }
    case 'y': {
      const y = Number(a);
      if (Number.isFinite(y)) return { state: graph ? { view: { kind: 'world' }, deep: false, graph: true } : WORLD, year: y };
      break;
    }
  }
  return { state: graph ? { view: { kind: 'world' }, deep: false, graph: true } : WORLD };
}
