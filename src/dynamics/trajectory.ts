// The field as dynamics, computed from the published data. PURE: no DOM, no clock, deterministic.
//   family  → basin           spectrum.position (s) → order parameter      occurrences by year → trajectory
//   parallelIds → companion trajectories         s crossing 0.5 with a large jump → transition (V: phase transition)
// Everything derived here is "drawn here": a measure of the published data, not a finding about Jung or Van Eenwyk.
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

/** A crossing of the midpoint (side changes at 0.5) with a jump of at least this size. */
export const TRANSITION_JUMP = 0.15;
export const MIDPOINT = 0.5;

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

const side = (s: number) => (s >= MIDPOINT ? 1 : 0);

/**
 * Indices j (into traj.points) such that the pair (j−1, j) crosses the midpoint with a jump of at least
 * TRANSITION_JUMP. Only consecutive pairs ever qualify.
 */
export function transitions(traj: Trajectory): number[] {
  const out: number[] = [];
  const p = traj.points;
  for (let j = 1; j < p.length; j++) {
    if (side(p[j - 1].s) !== side(p[j].s) && Math.abs(p[j].s - p[j - 1].s) >= TRANSITION_JUMP) out.push(j);
  }
  return out;
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

/** Evenly spaced points, endpoints kept, deterministic. Returns the trajectory unchanged when it is short enough. */
export function downsample(traj: Trajectory, maxPoints: number): Trajectory {
  const n = traj.points.length;
  const k = Math.max(2, Math.floor(maxPoints));
  if (n <= k) return traj;
  const points: TrajPoint[] = [];
  for (let j = 0; j < k; j++) points.push(traj.points[Math.round((j * (n - 1)) / (k - 1))]);
  return { subject: traj.subject, points };
}

/**
 * The order parameter at a point on the shared scale, interpolated linearly between the neighbouring occurrences.
 * Null before the first occurrence; held at the last value after it.
 */
export function sAt(points: readonly TrajPoint[], u: number): number | null {
  const n = points.length;
  if (!n || u < points[0].u) return null;
  if (u >= points[n - 1].u) return points[n - 1].s;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].u <= u) lo = mid;
    else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const t = b.u === a.u ? 0 : (u - a.u) / (b.u - a.u);
  return a.s + (b.s - a.s) * t;
}
