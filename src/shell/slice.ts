// The slice (S2, S5): what the filter's count and the time strip's density are counted over. It is the lens's slice
// (`LensContract.slice`) taken through the field filter, and only what stands on the Earth is counted: the number a
// visitor reads under the filter is the number of presences the globe can show.
//
// Pure: the Model, the contract and the filter in, numbers and masks out.
import type { Model } from '../data/model';
import type { LensContract } from '../lenses/contract';
import { passes, type FieldFilter } from './filter';

type Sliced = Pick<LensContract, 'slice'>;

/** How many of the lens's slice pass the filter and stand on the Earth. */
export function sliceCount(m: Model, c: Sliced, f: FieldFilter): number {
  let n = 0;
  for (const i of c.slice) if (m.located[i] && passes(m.occ[i], f, m.tags[i], m.workKey)) n++;
  return n;
}

/**
 * 1 for every occurrence the lens's slice holds and the filter passes, 0 for the rest: what the strip's density counts.
 * Null when nothing narrows the field (the slice is all of it and no filter stands), so the strip counts everything.
 */
export function sliceMask(m: Model, c: Sliced | null, filterMask: Float32Array | null): Uint8Array | null {
  const whole = !c || c.slice.length === m.occ.length;
  if (whole && !filterMask) return null;
  const out = new Uint8Array(m.occ.length);
  if (whole) { for (let i = 0; i < out.length; i++) out[i] = filterMask![i] > 0 ? 1 : 0; return out; }
  for (const i of c!.slice) if (!filterMask || filterMask[i] > 0) out[i] = 1;
  return out;
}
