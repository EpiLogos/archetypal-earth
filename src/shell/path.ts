// The Path (H4): the way up from where the visitor stands, each crumb a number of steps back. A crumb is not a link to a
// state of its own: it is `back` (store.ts) applied that many times, which is what Escape and a panel's ✕ do one step at a
// time, so a crumb, Escape and ✕ can never disagree about what "up" is.
import { back, stateEq, type AppState } from '../state/store';
import type { Subject } from '../data/model';

/** `subject` is null for the whole field. */
export interface Crumb { subject: Subject | null; steps: number }

/** `back`, `steps` times. */
export function upBy(s: AppState, steps: number): AppState {
  let cur = s;
  for (let i = 0; i < steps; i++) {
    const next = back(cur);
    if (stateEq(next, cur)) break;
    cur = next;
  }
  return cur;
}

/** Where a state stands, as one subject (null: the whole field), or undefined where the step is not a place (a lens's own route). */
function placeOf(s: AppState): { key: string; subject: Subject | null } | undefined {
  if (s.lens || s.history || s.redbook || s.dynamics || s.sky) return undefined;
  const v = s.view;
  if (v.kind === 'world') return { key: 'field', subject: null };
  if (v.kind === 'focus') return { key: `${v.subject.type}:${v.subject.id}`, subject: v.subject };
  // an occurrence is a place of its own; the subject it was opened under is the crumb it stands for
  if (v.kind === 'manifest') return { key: `o:${v.occId}`, subject: v.context };
  return undefined;
}

/**
 * The places up from `s`, nearest first, ending at the whole field. A step that only closes a reading (or a thread's
 * view) is a step on the way, counted in `steps`, but not a crumb: it leaves the visitor at the place they already stand.
 */
export function pathOf(s: AppState): Crumb[] {
  const out: Crumb[] = [];
  let seen = placeOf(s)?.key;
  let cur = s;
  for (let steps = 1; steps <= 32; steps++) {
    const next = back(cur);
    if (stateEq(next, cur)) break;
    cur = next;
    const at = placeOf(cur);
    if (!at || at.key === seen) continue;
    seen = at.key;
    out.push({ subject: at.subject, steps });
  }
  return out;
}

/** The steps from `s` to a crumb's place, read now (a reading opened since the crumb was drawn is one more step), or undefined when it is no longer on the path. */
export function stepsTo(s: AppState, subject: Subject | null): number | undefined {
  return pathOf(s).find((c) => (subject === null ? c.subject === null : !!c.subject && c.subject.type === subject.type && c.subject.id === subject.id))?.steps;
}
