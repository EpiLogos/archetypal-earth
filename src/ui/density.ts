// The time strip's density: how many presences stand at each point of the track. Pure, so the sum can be tested.
// `binCounts` is the raw count (every counted presence is in exactly one bin; its sum is the number counted), and
// `smooth` is the soft look the track draws over it.

export interface DensityInput {
  /** each occurrence's place on the shared time scale */
  u: ArrayLike<number>;
  /** 1 where the occurrence stands on the Earth: the strip counts only what the globe can show */
  located: ArrayLike<number>;
  /** the occurrences to count (a subject's members); null counts every occurrence */
  subset: readonly number[] | null;
  /** 1 where the lens's slice holds the occurrence and the filter passes it; null counts all */
  slice: ArrayLike<number> | null;
  fromU: number;
  toU: number;
  bins: number;
}

/** The raw count in each bin, and the total counted. */
export function binCounts(d: DensityInput): { counts: Float32Array; n: number } {
  const counts = new Float32Array(d.bins);
  let n = 0;
  const span = d.toU - d.fromU;
  const add = (i: number) => {
    if (!d.located[i]) return;
    if (d.slice && !d.slice[i]) return;
    const u = d.u[i];
    if (u < d.fromU || u > d.toU) return;
    const p = span > 0 ? (u - d.fromU) / span : 0;
    counts[Math.min(d.bins - 1, Math.floor(Math.max(0, Math.min(1, p)) * d.bins))]++;
    n++;
  };
  if (d.subset) d.subset.forEach(add);
  else for (let i = 0; i < d.u.length; i++) add(i);
  return { counts, n };
}

/** The soft look: each count spread over its neighbours with a short gaussian. */
export function smooth(counts: Float32Array): Float32Array {
  const out = new Float32Array(counts.length);
  for (let b = 0; b < counts.length; b++) {
    if (!counts[b]) continue;
    for (let k = -2; k <= 2; k++) {
      const j = b + k;
      if (j >= 0 && j < counts.length) out[j] += counts[b] * Math.exp(-(k * k) / 2.2);
    }
  }
  return out;
}

export interface CiteInput {
  /** each occurrence's Jung cites; `citeYear` is the first four-digit year of a cite's year (absent where none) */
  occ: ArrayLike<{ jung: readonly { citeYear?: number }[] }>;
  located: ArrayLike<number>;
  subset: readonly number[] | null;
  slice: ArrayLike<number> | null;
  /** the axis, in whole years, linear */
  fromYear: number;
  toYear: number;
  bins: number;
}

/**
 * Jung's second axis: the years he engaged with the material (the years of his cites), counted per occurrence and distinct
 * year, never on the field's own scale. Only what stands on the Earth and in the slice counts, as on the dated axis.
 */
export function citeCounts(d: CiteInput): { counts: Float32Array; n: number } {
  const counts = new Float32Array(d.bins);
  let n = 0;
  const span = d.toYear - d.fromYear;
  const add = (i: number) => {
    if (!d.located[i]) return;
    if (d.slice && !d.slice[i]) return;
    const seen = new Set<number>();
    for (const c of d.occ[i].jung) if (c.citeYear !== undefined) seen.add(c.citeYear);
    for (const y of seen) {
      if (y < d.fromYear || y > d.toYear) continue;
      counts[Math.min(d.bins - 1, Math.floor((span > 0 ? (y - d.fromYear) / span : 0) * d.bins))]++;
      n++;
    }
  };
  if (d.subset) d.subset.forEach(add);
  else for (let i = 0; i < d.occ.length; i++) add(i);
  return { counts, n };
}

/** The first and last year anything cites, or null when no cite carries a year. */
export function citeSpan(occ: ArrayLike<{ jung: readonly { citeYear?: number }[] }>): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < occ.length; i++) for (const c of occ[i].jung) if (c.citeYear !== undefined) { lo = Math.min(lo, c.citeYear); hi = Math.max(hi, c.citeYear); }
  return lo <= hi ? [lo, hi] : null;
}
