// URL hash <-> state, so every state is linkable and Back works.
import type { Subject } from '../data/model';
import { WORLD, type AppState, type ThreadTarget } from './store';

export interface Resolver {
  hasArchetype(id: string): boolean;
  hasFamily(id: string): boolean;
  hasCulture(id: string): boolean;
  hasPlace(id: string): boolean;
  /** family id of an occurrence, or undefined when it doesn't exist */
  familyOf(occId: string): string | undefined;
}

export interface Parsed {
  state: AppState;
  /** a time cursor requested by the hash (#/y/1600) */
  year?: number;
}

const enc = encodeURIComponent;

export function stateToHash(s: AppState): string {
  const v = s.view;
  const deep = s.deep ? '/deep' : '';
  switch (v.kind) {
    case 'world':
      return '#/';
    case 'focus': {
      const k = { archetype: 'a', family: 'f', culture: 'c', place: 'p' }[v.subject.type];
      return `#/${k}/${enc(v.subject.id)}${deep}`;
    }
    case 'manifest':
      return `#/o/${enc(v.occId)}${deep}`;
    case 'thread': {
      const t = v.target;
      // `#/t/serpent` is the short form for a family thread
      if (t.type === 'family') return `#/t/${enc(t.id)}${deep}`;
      return `#/t/${t.type === 'archetype' ? 'a' : 'p'}/${enc(t.id)}${deep}`;
    }
  }
}

export function hashToState(hash: string, r: Resolver): Parsed {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  if (!parts.length) return { state: WORLD };
  const deep = parts[parts.length - 1] === 'deep';
  if (deep) parts.pop();
  const [kind, a, b] = parts;
  const withDeep = (state: AppState): Parsed => ({ state: { view: state.view, deep } });
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
      else if (a && !b) {
        if (r.hasFamily(a)) target = { type: 'family', id: a };
        else if (r.hasArchetype(a)) target = { type: 'archetype', id: a };
      }
      if (target) {
        let from: AppState['view'];
        if (target.type === 'parallels') from = { kind: 'manifest', occId: target.id, context: { type: 'family', id: r.familyOf(target.id)! } };
        else from = { kind: 'focus', subject: { type: target.type, id: target.id } };
        return withDeep({ view: { kind: 'thread', target, from }, deep: false });
      }
      break;
    }
    case 'y': {
      const y = Number(a);
      if (Number.isFinite(y)) return { state: WORLD, year: y };
      break;
    }
  }
  return { state: WORLD };
}
