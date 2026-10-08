// The five-state machine of the experience, as pure transitions.
// World · Focus · Manifestation · Thread · (Deep is a reading layer over any).
import type { Subject } from '../data/model';

export interface ThreadTarget {
  type: 'family' | 'archetype' | 'parallels';
  id: string;
}

export type View =
  | { kind: 'world' }
  | { kind: 'focus'; subject: Subject }
  | { kind: 'manifest'; occId: string; context: Subject }
  | { kind: 'thread'; target: ThreadTarget; from: View };

export interface AppState {
  view: View;
  deep: boolean;
}

export const WORLD: AppState = { view: { kind: 'world' }, deep: false };

export function focusOn(_s: AppState, subject: Subject): AppState {
  return { view: { kind: 'focus', subject }, deep: false };
}

/** Select an occurrence. `fallbackContext` is its family, used when no focus is standing. */
export function manifest(s: AppState, occId: string, fallbackContext: Subject): AppState {
  const v = s.view;
  let context = fallbackContext;
  if (v.kind === 'focus') context = v.subject;
  else if (v.kind === 'manifest') context = v.context;
  else if (v.kind === 'thread') context = threadSubject(v.target, fallbackContext);
  return { view: { kind: 'manifest', occId, context }, deep: false };
}

export function threadSubject(t: ThreadTarget, fallback: Subject): Subject {
  if (t.type === 'family') return { type: 'family', id: t.id };
  if (t.type === 'archetype') return { type: 'archetype', id: t.id };
  return fallback;
}

export function startThread(s: AppState, target: ThreadTarget): AppState {
  const v = s.view;
  const from: View = v.kind === 'thread' ? v.from : v;
  return { view: { kind: 'thread', target, from }, deep: false };
}

export function setDeep(s: AppState, deep: boolean): AppState {
  if (s.view.kind === 'world') return s;
  return { view: s.view, deep };
}

/** One step back: deep → manifestation → focus → world (thread → where it began). */
export function back(s: AppState): AppState {
  if (s.deep) return { view: s.view, deep: false };
  const v = s.view;
  switch (v.kind) {
    case 'world':
      return s;
    case 'focus':
      return WORLD;
    case 'manifest':
      return { view: { kind: 'focus', subject: v.context }, deep: false };
    case 'thread':
      return { view: v.from, deep: false };
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
  return a.deep === b.deep && viewEq(a.view, b.view);
}

/** Depth used to decide whether a move is an ascent (zoom out) or descent. */
export function depthOf(s: AppState): number {
  const base = { world: 0, focus: 1, thread: 2, manifest: 2 }[s.view.kind];
  return base + (s.deep ? 1 : 0);
}
