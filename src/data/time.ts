// The non-linear time scale and the visibility curve of the time control.
// Pure — mirrored in GLSL (src/globe/presences.ts) with identical constants.

export interface Era {
  name: string;
  from: number; // year
  to: number;
}

export interface TimeScale {
  yearMin: number;
  yearMax: number;
  /** year -> slider position 0..1 (ancient compressed, 0..1960 expanded) */
  toU(year: number): number;
  fromU(u: number): number;
  eras: Era[];
}

// Anchors: [year, relative position]. Ancient spans are squeezed, the
// 0 CE .. 1960 stretch gets ~70% of the track.
const KNOTS: [number, number][] = [
  [-1000, 0.1],
  [0, 0.26],
  [500, 0.4],
  [1000, 0.55],
  [1500, 0.75],
];

export function createTimeScale(yearMin: number, yearMax: number): TimeScale {
  const lo = Math.min(yearMin, yearMax - 1);
  const hi = Math.max(yearMax, lo + 1);
  const pts: [number, number][] = [[lo, 0]];
  for (const k of KNOTS) if (k[0] > lo + 1 && k[0] < hi - 1) pts.push(k);
  pts.push([hi, 1]);
  const xs = pts.map((p) => p[0]);
  // spread the surviving knots over exactly 0..1, keeping their relative spacing
  const u0 = pts[0][1];
  const span = pts[pts.length - 1][1] - u0 || 1;
  const us = pts.map((p) => (p[1] - u0) / span);

  const toU = (year: number): number => {
    if (year <= xs[0]) return 0;
    if (year >= xs[xs.length - 1]) return 1;
    let i = 1;
    while (i < xs.length - 1 && year > xs[i]) i++;
    const t = (year - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return us[i - 1] + (us[i] - us[i - 1]) * t;
  };
  const fromU = (u: number): number => {
    if (u <= 0) return xs[0];
    if (u >= 1) return xs[xs.length - 1];
    let i = 1;
    while (i < us.length - 1 && u > us[i]) i++;
    const t = (u - us[i - 1]) / (us[i] - us[i - 1]);
    return xs[i - 1] + (xs[i] - xs[i - 1]) * t;
  };

  const eraDefs: [string, number, number][] = [
    ['Antiquity', -Infinity, 250],
    ['Late antiquity', 250, 750],
    ['Middle Ages', 750, 1400],
    ['Renaissance', 1400, 1700],
    ['Modern', 1700, Infinity],
  ];
  const eras: Era[] = [];
  for (const [name, f, t] of eraDefs) {
    const from = Math.max(f, lo);
    const to = Math.min(t, hi);
    if (to - from > 1) eras.push({ name, from, to });
  }
  return { yearMin: lo, yearMax: hi, toU, fromU, eras };
}

export interface TimeWindow {
  /** 0 = show everything, 1 = windowed by the cursor (animated between) */
  on: number;
  cursorU: number;
  /** width of the trailing window in u-space */
  trail: number;
  /** fade-in ramp width in u-space */
  ramp: number;
}

export const DEFAULT_TRAIL = 0.17;
export const DEFAULT_RAMP = 0.022;

function sstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * How present an occurrence at slider-position `u` is for the given window.
 * Appears as the cursor reaches it, fades over the trailing window.
 * Identical formula runs in the vertex shader (TIME_GLSL, timeVis); the points use presenceWeights
 * below, which keeps this function's on-mix, and the density field still uses it as is.
 */
export function timeVisibility(u: number, w: TimeWindow): number {
  const d = w.cursorU - u;
  const fin = sstep(0, w.ramp, d);
  const fout = 1 - sstep(w.trail * 0.55, w.trail, d);
  const windowed = fin * fout;
  return 1 + (windowed - 1) * w.on;
}

// ── T2: the standing reading is never time-gated ─────────────────────────
/** Emphasis (aRel) at which an occurrence is "standing": the reading's own, held in view at all times. */
export const STANDING_REL = 1.55;
/** The lift is eased over this rel band just below STANDING_REL, so eased emphasis never pops. Related (1.5) stays below it. */
const STANDING_BAND = 0.03;

/** 0 for ordinary occurrences, 1 for standing ones (rel >= STANDING_REL), smooth across the band. Mirrored in GLSL (standingWeight). */
export function standingWeight(rel: number): number {
  return sstep(STANDING_REL - STANDING_BAND, STANDING_REL, rel);
}

/**
 * The visibility the rest of the system should use for an occurrence: a standing occurrence is always
 * visible (vis 1) whatever the cursor; any other keeps its time visibility. Mirrored in GLSL (timeVisRel).
 */
export function effectiveVisibility(vis: number, rel: number): number {
  return vis + (1 - vis) * standingWeight(rel);
}

// ── T1: the per-node lifecycle, a function of d = cursor - u alone ───────
/** Emergence lasts 1.5 ramps. Dissolution runs from 0.55 trail to trail (as the fade always did). */
export const EMERGE_RAMPS = 1.5;
/** Alpha of a node before its date: a barely-there cool pinprick. */
export const PIN_ALPHA = 0.1;
/** Alpha of a node after it has dissolved: a small warm-grey dot ("it has been"). */
export const AFTER_ALPHA = 0.16;
/** Alpha of an attentionally receded node: the small hollow ring (unchanged look). */
export const GHOST_ALPHA = 0.32;

export interface PresenceCurve {
  /** 0 before the node's date, rising to 1 across the emergence window, 1 until dissolution */
  arrive: number;
  /** 0 while present, rising to 1 across the dissolution window, 1 once dissolved */
  leave: number;
  /** amplitude of the single emergence ring (0 outside emergence) */
  ring: number;
  /** radius of that ring: 0 at the core, 1 at its outer reach */
  ringR: number;
}

/**
 * The temporal part of a node's look. Pure in d: scrubbing back and forth retraces the same curve.
 * Standing occurrences (rel >= STANDING_REL) get no time curve (arrive 1, leave 0, no ring).
 * Mirrored in GLSL as presenceCurve (TIME_GLSL); keep the constants identical.
 */
export function presenceCurve(d: number, w: TimeWindow, rel: number): PresenceCurve {
  const on = w.on * (1 - standingWeight(rel));
  const e = Math.max(1e-6, w.ramp * EMERGE_RAMPS);
  const arrive = sstep(0, e, d);
  const leave = sstep(w.trail * 0.55, w.trail, d);
  const t = Math.min(1, Math.max(0, d / e));
  const ring = sstep(0, 0.3, t) * Math.pow(1 - t, 1.5);
  const ringR = 1 - Math.pow(1 - t, 3);
  return {
    arrive: 1 + (arrive - 1) * on,
    leave: leave * on,
    ring: ring * on,
    ringR,
  };
}

/** Attentional focus of a node (the emphasis ramp): 1 in focus, 0 receded. Mirrored in GLSL (presence vertex). */
export function attentionWeight(rel: number): number {
  return sstep(0.42, 0.78, rel);
}

export interface PresenceWeights extends PresenceCurve {
  /** temporal presence: 1 inside the window, 0 before arrival and after dissolution */
  present: number;
  /** attentional focus (0 receded .. 1 in focus) */
  focus: number;
  /** alpha of the live/attentional blend: present, and a receded node at GHOST_ALPHA */
  alpha: number;
  /** temporal absence before the date (the pinprick), 0..1 */
  pin: number;
  /** temporal absence after dissolution (the warm dot), 0..1 */
  after: number;
}

/** Every weight the presence vertex/fragment shaders use for one node, from d and its rel. Mirrors PRESENCE_VERT. */
export function presenceWeights(d: number, w: TimeWindow, rel: number): PresenceWeights {
  const c = presenceCurve(d, w, rel);
  const focus = attentionWeight(rel);
  const present = c.arrive * (1 - c.leave);
  return {
    ...c,
    present,
    focus,
    alpha: (GHOST_ALPHA + (1 - GHOST_ALPHA) * focus) * present,
    pin: 1 - c.arrive,
    after: c.leave,
  };
}

export type PresenceState = 'notYet' | 'emerging' | 'live' | 'dissolving' | 'after';

/** The phase of an ordinary node by d alone (window on = 1). Boundaries are half-open: [from, to). */
export function presenceState(d: number, w: TimeWindow): PresenceState {
  const e = w.ramp * EMERGE_RAMPS;
  if (d < 0) return 'notYet';
  if (d < e) return 'emerging';
  if (d < w.trail * 0.55) return 'live';
  if (d < w.trail) return 'dissolving';
  return 'after';
}

/** "~1486", "44 BCE", "3000 BCE" for a year number (scrubber read-out). */
export function formatYear(year: number): string {
  const y = Math.round(year);
  if (y < 0) return `${Math.abs(y).toLocaleString('en')} BCE`;
  if (y === 0) return '1 BCE';
  return `${y}`;
}
