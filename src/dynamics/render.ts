// Native attractor renders: PURE and deterministic (no DOM, no Math.random, no clock).
// These are generative illustrations of the named systems, drawn here. They are not reproductions of any
// published plate, and they claim nothing about Jung or Van Eenwyk.
import { hexToRgb, type RGB } from '../data/palette';
import type { Palette } from '../types/field';

// ── Lorenz ─────────────────────────────────────────────────────────────────────────────────────────────

export interface LorenzOpts {
  sigma?: number;
  rho?: number;
  beta?: number;
  start?: [number, number, number];
  /** RK4 steps discarded before the first kept point (the transient). */
  transient?: number;
}

/**
 * `n` points of the Lorenz system, RK4, one step (dt) apart, after the transient. Interleaved x,y,z in a Float64Array
 * of length 3n. The start is fixed (default (1,1,1)), so the same call always returns the same numbers.
 */
export function lorenzTrajectory(n: number, dt = 0.005, opts: LorenzOpts = {}): Float64Array {
  const sigma = opts.sigma ?? 10;
  const rho = opts.rho ?? 28;
  const beta = opts.beta ?? 8 / 3;
  const transient = opts.transient ?? 2000;
  const [sx, sy, sz] = opts.start ?? [1, 1, 1];
  const out = new Float64Array(3 * Math.max(0, Math.floor(n)));
  let x = sx, y = sy, z = sz;
  // one RK4 step; written out so the hot loop allocates nothing
  const step = () => {
    const f = (a: number, b: number, c: number): [number, number, number] => [sigma * (b - a), a * (rho - c) - b, a * b - beta * c];
    const k1 = f(x, y, z);
    const k2 = f(x + 0.5 * dt * k1[0], y + 0.5 * dt * k1[1], z + 0.5 * dt * k1[2]);
    const k3 = f(x + 0.5 * dt * k2[0], y + 0.5 * dt * k2[1], z + 0.5 * dt * k2[2]);
    const k4 = f(x + dt * k3[0], y + dt * k3[1], z + dt * k3[2]);
    x += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    z += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
  };
  for (let i = 0; i < transient; i++) step();
  for (let i = 0; i < out.length / 3; i++) {
    out[3 * i] = x;
    out[3 * i + 1] = y;
    out[3 * i + 2] = z;
    step();
  }
  return out;
}

/**
 * Project interleaved Lorenz points into a w×h box: an oblique view that keeps both lobes apart (rotation `angle`
 * about the z-axis, z drawn upward). Output: interleaved sx, sy, depth (depth in 0..1, far to near).
 * The fit uses the points' own extent, so the picture fills the box the same way every time.
 */
export function projectLorenz(points: Float64Array, w: number, h: number, opts: { angle?: number; margin?: number } = {}): Float32Array {
  const angle = opts.angle ?? 0.6;
  const margin = opts.margin ?? 0.06;
  const c = Math.cos(angle), s = Math.sin(angle);
  const n = Math.floor(points.length / 3);
  const out = new Float32Array(3 * n);
  if (!n) return out;
  const X = new Float64Array(n), Y = new Float64Array(n), D = new Float64Array(n);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = points[3 * i], y = points[3 * i + 1], z = points[3 * i + 2];
    const px = x * c - y * s, py = z, pd = x * s + y * c;
    X[i] = px; Y[i] = py; D[i] = pd;
    if (px < x0) x0 = px; if (px > x1) x1 = px;
    if (py < y0) y0 = py; if (py > y1) y1 = py;
    if (pd < d0) d0 = pd; if (pd > d1) d1 = pd;
  }
  const spanX = Math.max(x1 - x0, 1e-9), spanY = Math.max(y1 - y0, 1e-9), spanD = Math.max(d1 - d0, 1e-9);
  const k = Math.min((w * (1 - 2 * margin)) / spanX, (h * (1 - 2 * margin)) / spanY);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (let i = 0; i < n; i++) {
    out[3 * i] = w / 2 + (X[i] - cx) * k;
    out[3 * i + 1] = h / 2 - (Y[i] - cy) * k;
    out[3 * i + 2] = (D[i] - d0) / spanD;
  }
  return out;
}

// ── Mandelbrot and Julia ──────────────────────────────────────────────────────────────────────────────

export interface EscapeOpts {
  maxIter?: number;
  /** Centre of the view in the complex plane: [re, im]. */
  centre?: [number, number];
  /** Width of the view in complex units, across the longer side of the tile. */
  span?: number;
}

const LN2 = Math.LN2;

/** Smoothed escape count of c under z ↦ z² + c; `maxIter` when the orbit stays bounded (inside). */
export function mandelbrotEscape(cr: number, ci: number, maxIter = 200): number {
  return escape(0, 0, cr, ci, maxIter);
}

/** Smoothed escape count of z under z ↦ z² + c with a fixed c; `maxIter` when bounded. */
export function juliaEscape(zr: number, zi: number, cr: number, ci: number, maxIter = 200): number {
  return escape(zr, zi, cr, ci, maxIter);
}

function escape(zr0: number, zi0: number, cr: number, ci: number, maxIter: number): number {
  let zr = zr0, zi = zi0;
  for (let n = 0; n < maxIter; n++) {
    const zr2 = zr * zr, zi2 = zi * zi;
    if (zr2 + zi2 > 4) {
      // smoothed count: n + 1 − log₂(ln |z|), with |z| > 2 so the inner log is positive
      const lnMod = Math.log(Math.sqrt(zr2 + zi2));
      return n + 1 - Math.log(lnMod) / LN2;
    }
    zi = 2 * zr * zi + ci;
    zr = zr2 - zi2 + cr;
  }
  return maxIter;
}

/**
 * Pixel centres are symmetric about the tile's centre: pixel (x, y) and (w−1−x, h−1−y) map to z and −z exactly
 * when the centre is the origin. The tile is row-major, length w·h.
 */
function tile(w: number, h: number, centre: [number, number], span: number, f: (re: number, im: number) => number): Float32Array {
  const out = new Float32Array(Math.max(0, w * h));
  const step = span / (Math.max(w, h) - 1 || 1);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    const im = centre[1] - (y - cy) * step;
    for (let x = 0; x < w; x++) {
      const re = centre[0] + (x - cx) * step;
      out[y * w + x] = f(re, im);
    }
  }
  return out;
}

export function mandelbrotTile(w: number, h: number, opts: EscapeOpts = {}): Float32Array {
  const maxIter = opts.maxIter ?? 200;
  return tile(w, h, opts.centre ?? [-0.6, 0], opts.span ?? 3.1, (re, im) => mandelbrotEscape(re, im, maxIter));
}

export function juliaTile(w: number, h: number, c: [number, number], opts: EscapeOpts = {}): Float32Array {
  const maxIter = opts.maxIter ?? 160;
  return tile(w, h, opts.centre ?? [0, 0], opts.span ?? 3, (re, im) => juliaEscape(re, im, c[0], c[1], maxIter));
}

// ── palette mapping ───────────────────────────────────────────────────────────────────────────────────

/** The palette as RGB, for the mappings below. */
export function paletteRgb(p: Palette): { core: RGB; glow: RGB; fog: RGB; deep: RGB } {
  return { core: hexToRgb(p.core), glow: hexToRgb(p.glow), fog: hexToRgb(p.fog), deep: hexToRgb(p.deep) };
}

/**
 * An escape-time tile as RGBA: bounded points take the palette's deep tone; the rest run fog → glow → core on a
 * log scale, so the boundary (where counts are high) reads brightest.
 */
export function escapeToRgba(iter: Float32Array, maxIter: number, palette: Palette): Uint8ClampedArray {
  const p = paletteRgb(palette);
  const out = new Uint8ClampedArray(iter.length * 4);
  const top = Math.log(1 + maxIter);
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let i = 0; i < iter.length; i++) {
    const v = iter[i];
    let r: number, g: number, b: number;
    if (v >= maxIter) {
      [r, g, b] = p.deep;
    } else {
      const t = Math.min(1, Math.max(0, Math.log(1 + v) / top));
      const [a, c, k] = t < 0.5 ? [p.fog, p.glow, t * 2] : [p.glow, p.core, (t - 0.5) * 2];
      r = a[0] + (c[0] - a[0]) * k;
      g = a[1] + (c[1] - a[1]) * k;
      b = a[2] + (c[2] - a[2]) * k;
    }
    out[4 * i] = q(r);
    out[4 * i + 1] = q(g);
    out[4 * i + 2] = q(b);
    out[4 * i + 3] = 255;
  }
  return out;
}
