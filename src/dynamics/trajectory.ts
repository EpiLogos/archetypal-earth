// The field as dynamics, computed from the published data. PURE: no DOM, no clock, deterministic.
//   family  → basin           spectrum.position (s) → order parameter      occurrences by year → trajectory
//   parallelIds → companion trajectories
// Everything derived here is "drawn here": a measure of the published data, not a finding about Jung or Van Eenwyk.
//
// What is drawn is an ERA SERIES: the occurrences binned along the subject's own span, each bin's count-weighted mean
// s, lightly smoothed. Bins with no occurrence are gaps, never interpolated across. A midpoint crossing is marked only
// where the smoothed series crosses 0.5 with hysteresis and at least MIN_SIDE occurrences on each side.
// A subject whose era series does not vary is a single level: drawn as a band, not a trace.
import { subjectOccurrences, type Model, type Subject } from '../data/model';

export interface TrajPoint {
  /** index into model.occ */
  i: number;
  year: number;
  /** slider-position of the year on the shared scale */
  u: number;
  /** the occurrence's family's spectrum.position */
  s: number;
  familyId: string;
}

export interface Trajectory {
  subject: Subject;
  /** ordered by year (ties by occurrence index) */
  points: TrajPoint[];
}

export interface Basin {
  familyId: string;
  /** first and last year visited */
  from: number;
  to: number;
  fromU: number;
  toU: number;
  meanS: number;
  count: number;
}

export interface Companion extends Trajectory {
  /** how many parallel links ran from the subject's occurrences into this companion */
  links: number;
}

/** One era bin: its slider-position span, the count-weighted mean s (null when empty), and its occurrence count. */
export interface EraBin {
  u0: number;
  u1: number;
  mean: number | null;
  n: number;
}

/** A midpoint crossing that survives the sustained rule: the slider-position it is drawn at, and the occurrences on each side. */
export interface Crossing {
  u: number;
  before: number;
  after: number;
}

export const MIDPOINT = 0.5;
/** The subject's span is binned into this many eras. */
export const ERA_BINS = 40;
/** A side is entered only past the midpoint by this much (hysteresis), so a series hovering at 0.5 does not flicker. */
export const HYSTERESIS = 0.03;
/** A crossing counts only when at least this many occurrences lie on each side of it. */
export const MIN_SIDE = 5;
/** An era series whose spread (standard deviation of its bin means) is at most this is a single level, not a trace. */
export const VARIES = 0.03;

/** The subject's located occurrences in order of year, with the order parameter of each. */
export function trajectoryOf(m: Model, subject: Subject): Trajectory {
  const idx = subjectOccurrences(m, subject).slice().sort((a, b) => m.occ[a].year - m.occ[b].year || a - b);
  const points: TrajPoint[] = idx.map((i) => {
    const o = m.occ[i];
    const s = m.famById.get(o.familyId)?.spectrum.position ?? 0.5;
    return { i, year: o.year, u: m.u[i], s, familyId: o.familyId };
  });
  return { subject, points };
}

/** The basins a trajectory visits: distinct families in order of first visit, with their time span and mean s. */
export function basinsOf(traj: Trajectory): Basin[] {
  const acc = new Map<string, { from: number; to: number; fromU: number; toU: number; sum: number; count: number }>();
  for (const p of traj.points) {
    const a = acc.get(p.familyId);
    if (!a) acc.set(p.familyId, { from: p.year, to: p.year, fromU: p.u, toU: p.u, sum: p.s, count: 1 });
    else {
      a.from = Math.min(a.from, p.year);
      a.to = Math.max(a.to, p.year);
      a.fromU = Math.min(a.fromU, p.u);
      a.toU = Math.max(a.toU, p.u);
      a.sum += p.s;
      a.count++;
    }
  }
  return [...acc].map(([familyId, a]) => ({ familyId, from: a.from, to: a.to, fromU: a.fromU, toU: a.toU, meanS: a.sum / a.count, count: a.count }));
}

/**
 * Up to `max` correlated trajectories. Each occurrence's parallels that lie outside the subject are grouped by their
 * family; groups are ranked by the number of links into them (then by family id, for a stable order).
 */
export function companions(m: Model, traj: Trajectory, max = 3): Companion[] {
  const own = new Set(traj.points.map((p) => p.i));
  const subjectFamily = traj.subject.type === 'family' ? traj.subject.id : null;
  const groups = new Map<string, { links: number; members: Set<number> }>();
  for (const p of traj.points) {
    for (const pid of m.occ[p.i].parallelIds) {
      const j = m.occIndex.get(pid);
      if (j === undefined || own.has(j)) continue;
      const fam = m.occ[j].familyId;
      if (fam === subjectFamily) continue;
      let g = groups.get(fam);
      if (!g) groups.set(fam, (g = { links: 0, members: new Set() }));
      g.links++;
      g.members.add(j);
    }
  }
  return [...groups]
    .sort(([fa, a], [fb, b]) => b.links - a.links || (fa < fb ? -1 : fa > fb ? 1 : 0))
    .slice(0, Math.max(0, max))
    .map(([familyId, g]) => {
      const idx = [...g.members].sort((a, b) => m.occ[a].year - m.occ[b].year || a - b);
      const points: TrajPoint[] = idx.map((i) => ({ i, year: m.occ[i].year, u: m.u[i], s: m.famById.get(familyId)?.spectrum.position ?? 0.5, familyId }));
      return { subject: { type: 'family', id: familyId }, points, links: g.links };
    });
}

/**
 * The era series of a trajectory: its occurrences binned into `bins` equal slices of `span` (slider-positions; by default
 * the trajectory's own first-to-last span). Each bin carries the count-weighted mean s of its occurrences, or null when
 * it holds none. Occurrences outside the span are not counted. A span of zero width is one bin.
 */
export function eraSeries(traj: { points: readonly TrajPoint[] }, bins = ERA_BINS, span?: { fromU: number; toU: number }): EraBin[] {
  const pts = traj.points;
  if (!pts.length) return [];
  const a = span ? span.fromU : pts[0].u;
  const b = span ? span.toU : pts[pts.length - 1].u;
  const k = Math.max(1, Math.floor(bins));
  if (!(b > a)) {
    let sum = 0;
    let n = 0;
    for (const p of pts) if (p.u >= a - 1e-12 && p.u <= b + 1e-12) { sum += p.s; n++; }
    return [{ u0: a, u1: b, mean: n ? sum / n : null, n }];
  }
  const width = (b - a) / k;
  const sum = new Float64Array(k);
  const n = new Int32Array(k);
  for (const p of pts) {
    if (p.u < a || p.u > b) continue;
    const j = Math.min(k - 1, Math.max(0, Math.floor((p.u - a) / width)));
    sum[j] += p.s;
    n[j]++;
  }
  const out: EraBin[] = [];
  for (let j = 0; j < k; j++) {
    out.push({ u0: a + j * width, u1: j === k - 1 ? b : a + (j + 1) * width, mean: n[j] ? sum[j] / n[j] : null, n: n[j] });
  }
  return out;
}

/**
 * The drawn series: each non-empty bin's mean averaged with its non-empty neighbours (weights 1, 2, 1, each weighted by
 * its count). Empty bins stay empty; nothing is filled in across them.
 */
export function smoothEra(bins: readonly EraBin[]): EraBin[] {
  return bins.map((b, k) => {
    if (b.mean === null) return { ...b };
    let num = 0;
    let den = 0;
    for (let j = k - 1; j <= k + 1; j++) {
      const o = bins[j];
      if (!o || o.mean === null) continue;
      const w = (j === k ? 2 : 1) * o.n;
      num += w * o.mean;
      den += w;
    }
    return { ...b, mean: num / den };
  });
}

/** The spread of an era series: the standard deviation of its non-empty bin means. Zero for fewer than two. */
export function spreadOf(bins: readonly EraBin[]): number {
  const v = bins.filter((b) => b.mean !== null).map((b) => b.mean as number);
  if (v.length < 2 || Math.max(...v) - Math.min(...v) < 1e-12) return 0;
  const mu = v.reduce((x, y) => x + y, 0) / v.length;
  return Math.sqrt(v.reduce((x, y) => x + (y - mu) * (y - mu), 0) / v.length);
}

/** Whether an era series varies enough to be drawn as a trace (otherwise it is a single level: a band). */
export const variesEnough = (bins: readonly EraBin[]) => spreadOf(bins) > VARIES;

/**
 * The midpoint crossings that survive. The smoothed series is read as runs of one side each: a bin enters the high side
 * at ≥ 0.5 + HYSTERESIS and the low side at ≤ 0.5 − HYSTERESIS; bins in between belong to no side. A crossing is the
 * boundary between two runs, and it survives only when the run on each side holds at least MIN_SIDE occurrences.
 * It is placed midway between the last bin of the old run and the first of the new.
 */
export function sustainedCrossings(series: readonly EraBin[]): Crossing[] {
  const lo = MIDPOINT - HYSTERESIS;
  const hi = MIDPOINT + HYSTERESIS;
  type Run = { side: 1 | -1; n: number; firstU: number; lastU: number };
  const runs: Run[] = [];
  for (const b of series) {
    if (b.mean === null || b.n === 0) continue;
    const side = b.mean >= hi ? 1 : b.mean <= lo ? -1 : 0;
    if (!side) continue;
    const mid = (b.u0 + b.u1) / 2;
    const last = runs[runs.length - 1];
    if (last && last.side === side) {
      last.n += b.n;
      last.lastU = mid;
    } else runs.push({ side, n: b.n, firstU: mid, lastU: mid });
  }
  const out: Crossing[] = [];
  for (let r = 1; r < runs.length; r++) {
    const before = runs[r - 1];
    const after = runs[r];
    if (before.n >= MIN_SIDE && after.n >= MIN_SIDE) out.push({ u: (before.lastU + after.firstU) / 2, before: before.n, after: after.n });
  }
  return out;
}

/**
 * The drawn value at a slider-position. Linear between the centres of neighbouring non-empty eras, held within an era
 * whose neighbour is empty. Inside an empty era there is no value (null): nothing is interpolated across a gap. Before
 * the first occurrence there is none; after the last, the trajectory has ended and holds where it ended.
 */
export function seriesAt(series: readonly EraBin[], u: number): number | null {
  const n = series.length;
  if (!n || u < series[0].u0) return null;
  if (u > series[n - 1].u1) {
    for (let j = n - 1; j >= 0; j--) if (series[j].mean !== null) return series[j].mean;
    return null;
  }
  let k = 0;
  for (let j = 0; j < n; j++) if (u >= series[j].u0) k = j;
  const b = series[k];
  if (b.mean === null) return null;
  const c = (b.u0 + b.u1) / 2;
  const o = series[u < c ? k - 1 : k + 1];
  if (!o || o.mean === null) return b.mean;
  const co = (o.u0 + o.u1) / 2;
  if (co === c) return b.mean;
  return b.mean + (o.mean - b.mean) * ((u - c) / (co - c));
}
