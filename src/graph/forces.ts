// The layout's four forces, as the person sets them (as in Obsidian's graph). Each is a multiplier on the graph's own
// strength for that force, so 1 is the arrangement as drawn. These are pure functions of the settings: the live
// simulation is re-set from them in place when a slider moves, and the tests can read what each force does.
import type { GEdge } from './build';

export interface Forces {
  /** Centre: the pull toward the heart. More gathers the field together. */
  centre: number;
  /** Repel: how hard the forms push each other away. More spreads the field out. */
  repel: number;
  /** Link force: how hard a tie holds its two ends. More draws linked forms closer. */
  link: number;
  /** Link distance: how far apart a tie holds its ends. More lengthens every link. */
  distance: number;
}

/** The arrangement as it has always been drawn: the old gravity of 0.8 acted on the centre and the repulsion, link space 1.25. */
export const DEFAULT_FORCES: Forces = { centre: 0.8, repel: 0.8, link: 1, distance: 1.25 };

/** The sliders, in the order they are shown. The tooltips say what each does, so they are read as the truth. */
export const FORCE_ROWS: { key: keyof Forces; label: string; min: number; max: number; step: number; tip: string }[] = [
  { key: 'centre', label: 'Centre', min: 0.2, max: 6, step: 0.1, tip: 'How strongly the field is drawn to its heart. More gathers it together.' },
  { key: 'repel', label: 'Repel', min: 0.3, max: 2, step: 0.05, tip: 'How hard the forms push each other apart. More spreads the field out.' },
  { key: 'link', label: 'Link force', min: 0.3, max: 2.5, step: 0.05, tip: 'How hard each tie holds its two forms. More draws linked forms closer.' },
  { key: 'distance', label: 'Link distance', min: 0.7, max: 1.8, step: 0.05, tip: 'How far apart each tie holds its two ends. More lengthens every link.' },
];

/**
 * The pull toward the heart. A local graph has a small base of its own, so that Centre visibly gathers the
 * neighbourhood (the subject is pinned; the rest are drawn toward the heart), but far less than the whole field.
 */
export function centreStrength(local: boolean, f: Forces): number {
  return (local ? 0.004 : 0.018) * f.centre;
}

/** The readout of a force, as a multiple of the arrangement as drawn: 1.00× at rest, whatever the stored value is. */
export function forceMultiple(key: keyof Forces, value: number): number {
  return value / DEFAULT_FORCES[key];
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Time-aware layout (audit T1): a tie or an instance holds its two ends harder when both are live under the
 * cursor, and lets go of a ghost. `on` is 1 while the cursor is scrubbing and exactly 0 in 'all time', where the
 * factor is 1 and nothing changes. Monotone in both liveness values; 0.25 at the weakest.
 */
export function liveFactor(liveS: number, liveT: number, on: number): number {
  const raw = 0.25 + 0.75 * clamp01(liveS) * clamp01(liveT);
  return 1 + (raw - 1) * clamp01(on);
}

/** The push of an occurrence scales with its liveness: a ghost repels half as hard and gathers about its form. Exactly 1 when `on` is 0. */
export function dustLiveFactor(kind: string, live: number, on: number): number {
  if (kind !== 'occurrence') return 1;
  const raw = 0.5 + 0.5 * clamp01(live);
  return 1 + (raw - 1) * clamp01(on);
}

/** The push between nodes: negative (repulsive). The Self and the archetypes push hardest; the dust hardly at all. */
export function chargeStrength(kind: string, prime: boolean, rank: number, local: boolean, f: Forces): number {
  const gr = (local ? 1.2 : 1) * f.repel;
  if (kind === 'archetype') return -(prime ? 1500 : 880) * gr;
  if (kind === 'family') return -(90 + 170 * rank) * gr;
  if (kind === 'body') return -60 * f.repel;
  return -13 * gr;
}

/** How far the push reaches: wider when the links are asked to be longer. */
export function chargeReach(f: Forces): number {
  return 780 * Math.max(1, f.distance);
}

/** How far apart a tie wants its two ends, by its kind and whose word it is. */
export function linkDistance(e: GEdge, local: boolean, f: Forces): number {
  const d = (local ? 1.18 : 1) * f.distance;
  switch (e.kind) {
    case 'tie': return (e.basis === 'jung' ? 92 : e.basis === 'inferred' ? 118 : 148) * d;
    case 'sky': return (e.basis === 'jung' ? 150 : e.basis === 'inferred' ? 190 : 240) * d;
    case 'instance': return (local ? 30 : 17) * Math.max(f.distance, 1);
    case 'co': return 80 * d;
    default: return 96 * d;
  }
}

/** How hard a tie holds its ends. A tie to the Self is drawn but never drags the Self from the centre. */
export function linkStrength(e: GEdge, toPrime: boolean, f: Forces): number {
  let s: number;
  switch (e.kind) {
    case 'tie': s = e.basis === 'jung' ? 0.5 : e.basis === 'inferred' ? 0.26 : 0.12; break;
    case 'sky': s = toPrime ? 0.004 : e.basis === 'jung' ? 0.2 : e.basis === 'inferred' ? 0.1 : 0.05; break;
    case 'instance': s = 0.85; break;
    case 'co': s = 0.05; break;
    default: s = 0.035;
  }
  return s * f.link;
}
