// Planning a thread: which occurrences, in what order, with which arcs.
import type { Model } from './model';
import { angleBetween } from './geo';

export const THREAD_MAX = 26;
/** an archetype spans many forms: a thinner thread keeps the arcs from tangling */
const MAX_BY_TYPE = { family: THREAD_MAX, archetype: 16, parallels: 12 } as const;

export interface ThreadStep {
  occ: number;
  /** whether an arc leads here from the previous step */
  arcFromPrev: boolean;
}

/** Thin a time-sorted list to at most `max`, preferring image-bearing entries per time bucket. */
export function thin<T>(sorted: T[], max: number, prefer: (x: T) => boolean): T[] {
  if (sorted.length <= max) return sorted.slice();
  const out: T[] = [];
  for (let b = 0; b < max; b++) {
    const lo = Math.floor((b * sorted.length) / max);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * sorted.length) / max));
    const slice = sorted.slice(lo, hi);
    out.push(slice.find(prefer) ?? slice[Math.floor(slice.length / 2)]);
  }
  return out;
}

export function threadOccurrences(m: Model, type: 'family' | 'archetype' | 'parallels', id: string): number[] {
  let list: number[] = [];
  if (type === 'family') list = m.famOcc.get(id) ?? [];
  else if (type === 'archetype') list = m.archOcc.get(id) ?? [];
  else {
    const i = m.occIndex.get(id);
    if (i !== undefined) {
      const set = new Set<number>([i]);
      for (const pid of m.occ[i].parallelIds) {
        const j = m.occIndex.get(pid);
        if (j !== undefined) set.add(j);
      }
      list = [...set];
    }
  }
  const sorted = list.filter((i) => m.located[i]).sort((a, b) => m.occ[a].year - m.occ[b].year || a - b);
  return thin(sorted, MAX_BY_TYPE[type], (i) => !!m.occ[i].image);
}

export function planThread(m: Model, type: 'family' | 'archetype' | 'parallels', id: string): ThreadStep[] {
  const idx = threadOccurrences(m, type, id);
  const steps: ThreadStep[] = [];
  for (let k = 0; k < idx.length; k++) {
    const arc = k > 0 && angleBetween(m.dir[idx[k - 1]], m.dir[idx[k]]) > 0.012; // ~0.7°
    steps.push({ occ: idx[k], arcFromPrev: arc });
  }
  return steps;
}
