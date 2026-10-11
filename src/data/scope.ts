// A mode's own set on the globe. Every mode (Aion's reading, the Red Book's walk, a lens's subject) has presences that
// are its own; the field around them used to stay drawn at a faint 7% everywhere, which made every mode as busy as the
// whole field. A scope ranks the presences in three: the mode's own (full), the nearby ones one hop away (the same
// symbol family, or a parallel: dimmed, and counted as "nearby"), and the rest, set aside (not drawn, not pickable).
// The shell names what a scope shows and offers the whole field back.
import type { Model } from './model';

/** Emphasis levels (the engine's presence relevance): above 1 lifts, below 0.035 is not drawn. */
export const SCOPE_LEVEL = { own: 1.5, nearby: 0.16, aside: 0 } as const;

export interface ScopeInfo {
  /** what the mode calls its set, for the shell's line ("this reading", "the Red Book's walk") */
  label: string;
  own: number;
  nearby: number;
}

export interface Scope {
  rel: Float32Array;
  info: ScopeInfo;
}

/**
 * The relevance array for a mode whose own presences are `own`. `level` lifts them (default SCOPE_LEVEL.own);
 * `selected` is lifted above the rest. Presences with no place are left at 1 (they are not drawn on the globe).
 */
export function scopeOf(m: Model, own: Iterable<number>, label: string, opts: { level?: number; selected?: number; nearby?: boolean } = {}): Scope {
  const n = m.occ.length;
  const rel = new Float32Array(n).fill(SCOPE_LEVEL.aside);
  const level = opts.level ?? SCOPE_LEVEL.own;
  const ownSet = new Set<number>();
  for (const i of own) ownSet.add(i);
  if (opts.nearby !== false) {
    const fams = new Set<string>();
    for (const i of ownSet) fams.add(m.occ[i].familyId);
    for (const f of fams) for (const i of m.famOcc.get(f) ?? []) if (!ownSet.has(i) && rel[i] === SCOPE_LEVEL.aside) rel[i] = SCOPE_LEVEL.nearby;
    for (const i of ownSet) for (const pid of m.occ[i].parallelIds) {
      const j = m.occIndex.get(pid);
      if (j !== undefined && !ownSet.has(j) && rel[j] === SCOPE_LEVEL.aside) rel[j] = SCOPE_LEVEL.nearby;
    }
  }
  let ownPlaced = 0;
  const NEAR = Math.fround(SCOPE_LEVEL.nearby); // the array is Float32: compare in its precision
  for (const i of ownSet) { rel[i] = level; if (m.located[i]) ownPlaced++; }
  if (opts.selected !== undefined && opts.selected >= 0) rel[opts.selected] = 2.4;
  for (let i = 0; i < n; i++) if (!m.located[i]) rel[i] = 1;
  let nearbyPlaced = 0;
  for (let i = 0; i < n; i++) if (m.located[i] && rel[i] === NEAR) nearbyPlaced++;
  return { rel, info: { label, own: ownPlaced, nearby: nearbyPlaced } };
}
