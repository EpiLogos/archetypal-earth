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
  /**
   * The step's period-mates the walk does not stop at (a long thread is thinned to one step per period), and the
   * subject's occurrences with no recorded place, each attached to the step nearest it in time. Listed with the step,
   * so every occurrence of the subject is reached from its walk.
   */
  also: number[];
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

/** As thin(), but each pick keeps the rest of its time bucket. */
export function thinBuckets<T>(sorted: T[], max: number, prefer: (x: T) => boolean): { pick: T; rest: T[] }[] {
  if (sorted.length <= max) return sorted.map((pick) => ({ pick, rest: [] }));
  const out: { pick: T; rest: T[] }[] = [];
  for (let b = 0; b < max; b++) {
    const lo = Math.floor((b * sorted.length) / max);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * sorted.length) / max));
    const slice = sorted.slice(lo, hi);
    const pick = slice.find(prefer) ?? slice[Math.floor(slice.length / 2)];
    out.push({ pick, rest: slice.filter((x) => x !== pick) });
  }
  return out;
}

function subjectList(m: Model, type: 'family' | 'archetype' | 'parallels', id: string): number[] {
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
  return list;
}

export function threadOccurrences(m: Model, type: 'family' | 'archetype' | 'parallels', id: string): number[] {
  return threadBuckets(m, type, id).map((b) => b.pick);
}

/** The thread's steps (located, by year, thinned) with each step's bucket-mates, and the unplaced attached by year. */
function threadBuckets(m: Model, type: 'family' | 'archetype' | 'parallels', id: string): { pick: number; rest: number[] }[] {
  const list = subjectList(m, type, id);
  const byYear = (a: number, b: number) => m.occ[a].year - m.occ[b].year || a - b;
  const sorted = list.filter((i) => m.located[i]).sort(byYear);
  const buckets = thinBuckets(sorted, MAX_BY_TYPE[type], (i) => !!m.occ[i].image).map((b) => ({ pick: b.pick, rest: [...b.rest] }));
  if (buckets.length) {
    for (const i of list.filter((k) => !m.located[k]).sort(byYear)) {
      const y = m.occ[i].year;
      let best = 0;
      for (let k = 1; k < buckets.length; k++) if (Math.abs(m.occ[buckets[k].pick].year - y) < Math.abs(m.occ[buckets[best].pick].year - y)) best = k;
      buckets[best].rest.push(i);
    }
  }
  return buckets;
}

export function planThread(m: Model, type: 'family' | 'archetype' | 'parallels', id: string): ThreadStep[] {
  const buckets = threadBuckets(m, type, id);
  const steps: ThreadStep[] = [];
  for (let k = 0; k < buckets.length; k++) {
    const arc = k > 0 && angleBetween(m.dir[buckets[k - 1].pick], m.dir[buckets[k].pick]) > 0.012; // ~0.7°
    steps.push({ occ: buckets[k].pick, arcFromPrev: arc, also: buckets[k].rest });
  }
  return steps;
}
