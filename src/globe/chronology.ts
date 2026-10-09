// A subject's chronology: its located occurrences in date order, as a path of places, drawn along the cursor.
// Pure. The arcs (arcs.ts) take the path and the per-segment progress this file computes; nothing here touches the GPU.
import { angleBetween, type Vec3 } from '../data/geo';

/** ~300 km as an angle on the globe: occurrences nearer than this to the last place kept are the same place. */
export const CHRONO_MIN_ANGLE = 300 / 6371;
/** The most hops (arc segments) a chronology draws; its path is thinned to evenly spaced dates beyond this. */
export const CHRONO_MAX_HOPS = 28;

export interface ChronoPoint {
  /** slider-position of the occurrence's year (shared scale) */
  u: number;
  dir: Vec3;
}

/**
 * The places a subject passed through, in date order. An occurrence joins the path only when it lies further than
 * `minAngle` from the place last kept, so a place returned to in a row is one place. If the path has more than
 * `maxHops` hops, it is thinned to the places nearest to evenly spaced dates across its span (never repeating one).
 * Returns indices into `points`, in date order.
 */
export function chronologyPath(points: readonly ChronoPoint[], minAngle = CHRONO_MIN_ANGLE, maxHops = CHRONO_MAX_HOPS): number[] {
  const order = points.map((_, i) => i).sort((a, b) => points[a].u - points[b].u || a - b);
  const kept: number[] = [];
  for (const i of order) {
    if (!kept.length || angleBetween(points[kept[kept.length - 1]].dir, points[i].dir) > minAngle) kept.push(i);
  }
  const n = kept.length;
  if (n - 1 <= maxHops) return kept;

  // evenly spaced dates: for each target take the nearest kept place after the previous pick, leaving room for the rest
  const u0 = points[kept[0]].u;
  const u1 = points[kept[n - 1]].u;
  const picks: number[] = [];
  let p = 0;
  for (let k = 0; k <= maxHops; k++) {
    const target = u0 + ((u1 - u0) * k) / maxHops;
    while (p + 1 < n && Math.abs(points[kept[p + 1]].u - target) < Math.abs(points[kept[p]].u - target)) p++;
    const lo = picks.length ? picks[picks.length - 1] + 1 : 0;
    const hi = n - 1 - (maxHops - k);
    const q = Math.min(hi, Math.max(lo, p));
    picks.push(q);
    p = q;
  }
  return picks.map((j) => kept[j]);
}

export interface ChronoProgress {
  /** how far the arc has travelled, 0..1 (the head's place along it) */
  draw: number;
  /** how present the arc is, 0..1: it arrives from its origin's date and leaves once the cursor is a trail past its destination */
  alpha: number;
}

function sstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The state of every arc of a chronology at the cursor. `nodeU` are the path's slider-positions in date order;
 * arc k runs from node k-1 to node k and is returned at index k-1.
 *  - draw grows linearly from the origin's date and is whole once the cursor has passed the destination's date,
 *    so the head moves with the cursor; scrubbing back un-draws it. Reduced motion: no travel, whole from its origin.
 *  - alpha fades in over `ramp` from the origin's date and out over the trailing window once the cursor is past the
 *    destination, so the line migrates with the present. Pure in the cursor: scrubbing back retraces the same values.
 */
export function chronologyProgress(nodeU: ArrayLike<number>, cursorU: number, trail: number, ramp: number, reduced = false): ChronoProgress[] {
  const out: ChronoProgress[] = [];
  const tr = Math.max(trail, 1e-6);
  const rp = Math.max(ramp, 1e-6);
  for (let k = 1; k < nodeU.length; k++) {
    const o = nodeU[k - 1];
    const d = nodeU[k];
    const span = d - o;
    const draw = reduced || span <= 1e-9
      ? (cursorU >= o ? 1 : 0)
      : Math.min(1, Math.max(0, (cursorU - o) / span));
    const arrive = sstep(0, rp, cursorU - o);
    const leave = sstep(tr * 0.55, tr, cursorU - d);
    out.push({ draw, alpha: arrive * (1 - leave) });
  }
  return out;
}
