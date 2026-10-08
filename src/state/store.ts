// The five-state machine of the experience, as pure transitions.
// World · Focus · Manifestation · Thread · (Deep is a reading layer over any).
import type { Subject } from '../data/model';
import type { BodyKey } from '../types/sky';

export interface ThreadTarget {
  type: 'family' | 'archetype' | 'parallels';
  id: string;
}

/** The sky layer's state: which body is open, or which birth moment is standing. Orthogonal to the field's views. */
export interface SkyState {
  body?: BodyKey;
  /** a birth sky: wall-clock time (YYYY-MM-DDTHH:MM) at the place; the sidecar resolves the timezone */
  birth?: { local: string; lat: number; lon: number };
  /** the field culture the bodies' names and characters are read through (cultures.json); absent: the Greco-Roman default */
  culture?: string;
}

export type View =
  | { kind: 'world' }
  | { kind: 'focus'; subject: Subject; /** the subjects drilled through to arrive here, outermost first (a link route, never in the hash) */ crumbs?: Subject[] }
  | { kind: 'manifest'; occId: string; context: Subject }
  | { kind: 'thread'; target: ThreadTarget; from: View };

export interface AppState {
  view: View;
  deep: boolean;
  /** the graph mode: a second view of the same field (absent = the globe) */
  graph?: true;
  /** the sky: the same scene pulled back past the Moon to the whole system (a flag, as `graph` is, but it needs the world view) */
  sky?: SkyState;
  history?: { reading: string; selection?: { kind: 'epoch' | 'event' | 'thread'; id: string } };
  /** The live path remains standing while one of its presences is inspected. */
  trail?: Extract<View, { kind: 'thread' }>;
}

export const WORLD: AppState = { view: { kind: 'world' }, deep: false };

/** Carry the mode of `from` onto a fresh state. */
function inMode(from: AppState, next: AppState): AppState {
  return from.graph ? { ...next, graph: true } : next;
}

export function focusOn(s: AppState, subject: Subject): AppState {
  return inMode(s, { view: { kind: 'focus', subject, crumbs: focusCrumbs(s) }, deep: false });
}

/** The route drilled through to reach a focus: what stood focused one level up. A manifestation leaves its context; the world leaves no crumb. */
function focusCrumbs(s: AppState): Subject[] | undefined {
  const v = s.view;
  if (v.kind === 'focus') {
    const crumbs = [...(v.crumbs ?? []), v.subject];
    return crumbs.slice(Math.max(0, crumbs.length - 3));
  }
  if (v.kind === 'manifest') return [v.context];
  return undefined;
}

/** Switch between the globe and the graph, keeping what is in view (a thread has no graph: it returns to where it began). */
export function withMode(s: AppState, graph: boolean): AppState {
  const view = s.view.kind === 'thread' ? s.view.from : s.view;
  // the sky is a scale of the globe: the graph has none, so switching modes leaves it
  return graph ? { view, deep: s.deep, graph: true } : { view, deep: s.deep };
}

/** Select an occurrence. `fallbackContext` is its family, used when no focus is standing. */
export function manifest(s: AppState, occId: string, fallbackContext: Subject): AppState {
  const v = s.view;
  let context = fallbackContext;
  if (v.kind === 'focus') context = v.subject;
  else if (v.kind === 'manifest') context = v.context;
  else if (v.kind === 'thread') context = threadSubject(v.target, fallbackContext);
  const trail = v.kind === 'thread' ? v : s.trail;
  return trail ? { view: { kind: 'manifest', occId, context }, deep: false, trail } : inMode(s, { view: { kind: 'manifest', occId, context }, deep: false });
}

export function threadSubject(t: ThreadTarget, fallback: Subject): Subject {
  if (t.type === 'family') return { type: 'family', id: t.id };
  if (t.type === 'archetype') return { type: 'archetype', id: t.id };
  return fallback;
}

export function startThread(s: AppState, target: ThreadTarget): AppState {
  const v = s.view;
  const from: View = v.kind === 'thread' ? v.from : v;
  // a thread travels the globe: it leaves the graph
  return { view: { kind: 'thread', target, from }, deep: false };
}

/** Enter (or change) the sky. The sky stands over the world view: any focus is left behind, the field stays as it was. */
export function inSky(sky: SkyState = {}): AppState {
  return { view: { kind: 'world' }, deep: false, sky };
}

export function skyEq(a: SkyState | undefined, b: SkyState | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.body === b.body && a.culture === b.culture && a.birth?.local === b.birth?.local && a.birth?.lat === b.birth?.lat && a.birth?.lon === b.birth?.lon;
}

export function setDeep(s: AppState, deep: boolean): AppState {
  if (s.view.kind === 'world') return s;
  return { ...s, deep };
}

/** One step back: deep → manifestation → focus (up the drilled route) → world (thread → where it began). */
export function back(s: AppState): AppState {
  if (s.deep) return { ...s, deep: false };
  if (s.sky) {
    // a card closes onto the sky; the sky closes onto the Earth
    if (s.sky.body) return inSky({ ...(s.sky.birth ? { birth: s.sky.birth } : {}), ...(s.sky.culture ? { culture: s.sky.culture } : {}) });
    return WORLD;
  }
  if (s.history) return s.history.selection ? { ...s, history: { reading: s.history.reading } } : WORLD;
  const v = s.view;
  switch (v.kind) {
    case 'world':
      return s;
    case 'focus': {
      const crumbs = v.crumbs ?? [];
      if (crumbs.length) {
        const up = crumbs[crumbs.length - 1];
        return inMode(s, { view: { kind: 'focus', subject: up, crumbs: crumbs.slice(0, -1) }, deep: false });
      }
      return inMode(s, WORLD);
    }
    case 'manifest':
      if (s.trail) return { view: s.trail, deep: false };
      return inMode(s, { view: { kind: 'focus', subject: v.context }, deep: false });
    case 'thread':
      return inMode(s, { view: v.from, deep: false });
  }
}

export function subjectEq(a: Subject, b: Subject): boolean {
  return a.type === b.type && a.id === b.id;
}

export function viewEq(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'world':
      return true;
    case 'focus':
      return subjectEq(a.subject, (b as typeof a).subject);
    case 'manifest':
      return a.occId === (b as typeof a).occId;
    case 'thread': {
      const t = b as typeof a;
      return a.target.type === t.target.type && a.target.id === t.target.id;
    }
  }
}

export function stateEq(a: AppState, b: AppState): boolean {
  return a.deep === b.deep && !!a.graph === !!b.graph && viewEq(a.view, b.view) && skyEq(a.sky, b.sky)
    && a.history?.reading === b.history?.reading
    && a.history?.selection?.kind === b.history?.selection?.kind
    && a.history?.selection?.id === b.history?.selection?.id
    && ((!a.trail && !b.trail) || (!!a.trail && !!b.trail && viewEq(a.trail, b.trail)));
}

/** Depth used to decide whether a move is an ascent (zoom out) or descent. */
export function depthOf(s: AppState): number {
  const base = { world: 0, focus: 1, thread: 2, manifest: 2 }[s.view.kind];
  return base + (s.sky ? 1 + (s.sky.body ? 1 : 0) : 0) + (s.deep ? 1 : 0);
}
