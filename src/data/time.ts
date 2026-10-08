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
 * Identical formula runs in the vertex shader.
 */
export function timeVisibility(u: number, w: TimeWindow): number {
  const d = w.cursorU - u;
  const fin = sstep(0, w.ramp, d);
  const fout = 1 - sstep(w.trail * 0.55, w.trail, d);
  const windowed = fin * fout;
  return 1 + (windowed - 1) * w.on;
}

/** "~1486", "44 BCE", "3000 BCE" for a year number (scrubber read-out). */
export function formatYear(year: number): string {
  const y = Math.round(year);
  if (y < 0) return `${Math.abs(y).toLocaleString('en')} BCE`;
  if (y === 0) return '1 BCE';
  return `${y}`;
}
