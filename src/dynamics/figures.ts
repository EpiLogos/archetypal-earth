// The route's figures: each of Van Eenwyk's terms drawn as the dynamical system it names, natively, here. Every figure
// is a computed illustration of a named system (a limit cycle, the logistic map, the Lorenz system …), captioned with
// that system and "drawn here"; none reproduces a plate of the book, and none claims anything about Jung, Van Eenwyk or
// Neumann. The pure parts (the systems' numbers) are exported for the unit tests; painting takes a 2D context and a
// time in seconds, so the same t paints the same frame, and a still frame (reduced motion) is just one t.
import type { RGB } from '../data/palette';
import type { Palette } from '../types/field';
import { juliaTile, lorenzTrajectory, mandelbrotTile, paletteRgb, projectLorenz } from './render';

export type FigureId = 'limit-cycle' | 'homoclinic' | 'stuck' | 'cascade' | 'edge' | 'lorenz' | 'flip' | 'pitchfork'
  | 'window' | 'focus' | 'sync' | 'saddle' | 'julia' | 'mandelbrot' | 'landscape' | 'torus';

type P = { core: RGB; glow: RGB; fog: RGB; deep: RGB };
type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, p: P, dpr: number) => void;

export interface Figure {
  /** names the system drawn, never the subject or the concept */
  caption: string;
  /** a figure that moves (a still one paints once) */
  animated: boolean;
  /** the moment a still frame (reduced motion) shows: a settled, representative state */
  still: number;
  draw: Draw;
}

const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const INK: RGB = [0.86, 0.89, 0.97];

function ground(ctx: CanvasRenderingContext2D, w: number, h: number, p: P) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = css(p.deep);
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, css(p.fog, 0.55));
  g.addColorStop(1, css(p.deep, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** A uniform map from a model box into the canvas, centred, with a margin. */
function fit(w: number, h: number, x0: number, x1: number, y0: number, y1: number, margin = 0.08) {
  const s = Math.min((w * (1 - 2 * margin)) / (x1 - x0), (h * (1 - 2 * margin)) / (y1 - y0));
  const cx = w / 2 - ((x0 + x1) / 2) * s;
  const cy = h / 2 + ((y0 + y1) / 2) * s;
  return { X: (x: number) => cx + x * s, Y: (y: number) => cy - y * s, s };
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, dpr: number, align: CanvasTextAlign = 'center', alpha = 0.72) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = `${Math.round(10.5 * dpr)}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = css(INK, alpha);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
  g.addColorStop(0, css(c, 0.9));
  g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css(mix(c, [1, 1, 1], 0.6));
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** A polyline of model points, glowing (a wide faint pass under a fine one). */
function trail(ctx: CanvasRenderingContext2D, pts: ArrayLike<number>, X: (x: number) => number, Y: (y: number) => number, from: number, to: number, c: RGB, width: number, alpha: number) {
  if (to - from < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const pass of [{ k: 3.2, a: 0.14 }, { k: 1, a: 1 }]) {
    ctx.lineWidth = width * pass.k;
    ctx.strokeStyle = css(c, alpha * pass.a);
    ctx.beginPath();
    ctx.moveTo(X(pts[2 * from]), Y(pts[2 * from + 1]));
    for (let i = from + 1; i < to; i++) ctx.lineTo(X(pts[2 * i]), Y(pts[2 * i + 1]));
    ctx.stroke();
  }
  ctx.restore();
}

// ── the systems (pure) ───────────────────────────────────────────────────────────────────────────────────────

type Field2 = (x: number, y: number) => [number, number];

/** RK4 for a planar field: n points (x, y interleaved), dt apart, from (x, y). */
export function integrate(f: Field2, x: number, y: number, n: number, dt: number): Float64Array {
  const out = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    out[2 * i] = x; out[2 * i + 1] = y;
    const [a1, b1] = f(x, y);
    const [a2, b2] = f(x + 0.5 * dt * a1, y + 0.5 * dt * b1);
    const [a3, b3] = f(x + 0.5 * dt * a2, y + 0.5 * dt * b2);
    const [a4, b4] = f(x + dt * a3, y + dt * b3);
    x += (dt / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
    y += (dt / 6) * (b1 + 2 * b2 + 2 * b3 + b4);
  }
  return out;
}

/** Van der Pol: every orbit but the fixed point settles onto one limit cycle. */
export const vanDerPol = (mu: number): Field2 => (x, y) => [y, mu * (1 - x * x) * y - x];
/** The unforced, undamped Duffing oscillator x'' = x − x³: a saddle at 0 joined to itself by two homoclinic loops. */
export const duffing: Field2 = (x, y) => [y, x - x * x * x];
export const duffingEnergy = (x: number, y: number) => (y * y) / 2 - (x * x) / 2 + (x ** 4) / 4;

/**
 * The logistic map x → r·x·(1 − x): after a transient, the states the orbit from x₀ = 0.5 visits at drive r (rounded,
 * deduplicated). A period-2^k drive returns 2^k states; chaos returns many.
 */
export function logisticStates(r: number, transient = 600, keep = 256): number[] {
  let x = 0.5;
  for (let i = 0; i < transient; i++) x = r * x * (1 - x);
  const seen = new Set<number>();
  for (let i = 0; i < keep; i++) { x = r * x * (1 - x); seen.add(Math.round(x * 1e6) / 1e6); }
  return [...seen].sort((a, b) => a - b);
}

/** Two phase oscillators coupled symmetrically by k: returns their phase difference over n steps of dt. */
export function coupledPhases(w1: number, w2: number, k: (t: number) => number, n: number, dt: number): Float64Array {
  const out = new Float64Array(3 * n);
  let a = 0, b = Math.PI * 0.7;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    out[3 * i] = a; out[3 * i + 1] = b; out[3 * i + 2] = t;
    const kk = k(t);
    const da = w1 + kk * Math.sin(b - a);
    const db = w2 + kk * Math.sin(a - b);
    a += da * dt; b += db * dt;
  }
  return out;
}

// ── caches (by size, so a resize repaints from scratch) ───────────────────────────────────────────────────────

const cache = new Map<string, HTMLCanvasElement | Float64Array | Float32Array>();
function cached<T extends HTMLCanvasElement | Float64Array | Float32Array>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (!v) { v = make(); cache.set(key, v); if (cache.size > 40) cache.delete(cache.keys().next().value!); }
  return v;
}
function offscreen(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) paint(ctx);
  return c;
}
const palKey = (p: P) => p.core.join(',') + p.glow.join(',');

// ── the figures ──────────────────────────────────────────────────────────────────────────────────────────────

const VDP_MU = 1.2;
const limitCycle: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  const { X, Y } = fit(w, h, -3.4, 3.4, -4, 4, 0.1);
  const f = vanDerPol(VDP_MU);
  const starts: [number, number][] = [[0.08, 0], [-0.1, 0.12], [3.3, 3.6], [-3.3, -3.6], [0.4, -3.8], [-0.5, 3.8]];
  const runs = starts.map(([x, y], i) => cached(`vdp${i}`, () => integrate(f, x, y, 1600, 0.012)));
  const cycle = cached('vdp-cycle', () => integrate(f, 2, 0, 2400, 0.012).slice(2 * 1600));
  const reveal = Math.min(1, (t % 14) / 9);
  runs.forEach((r, i) => trail(ctx, r, X, Y, 0, Math.floor((r.length / 2) * reveal), mix(p.glow, p.core, i / 6), dpr * 0.8, 0.5));
  trail(ctx, cycle, X, Y, 0, cycle.length / 2, p.core, dpr * 1.3, 0.85);
  const n = cycle.length / 2;
  const k = Math.floor((t * 60) % n);
  dot(ctx, X(cycle[2 * k]), Y(cycle[2 * k + 1]), 2.6 * dpr, p.core);
  label(ctx, '← the unconscious', 8 * dpr, h - 12 * dpr, dpr, 'left', 0.6);
  label(ctx, 'consciousness →', w - 8 * dpr, h - 12 * dpr, dpr, 'right', 0.6);
};

const homoclinic: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  const { X, Y } = fit(w, h, -1.9, 1.9, -1.25, 1.25, 0.08);
  // level sets of the energy: closed orbits inside each loop, wide ones outside, the two loops themselves bright
  const level = (E: number, alpha: number, c: RGB, width: number) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = css(c, alpha);
    ctx.lineWidth = width;
    for (const sgn of [1, -1]) {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= 600; i++) {
        const x = -1.9 + (3.8 * i) / 600;
        const v = 2 * (E + (x * x) / 2 - (x ** 4) / 4);
        if (v < 0) { pen = false; continue; }
        const y = sgn * Math.sqrt(v);
        if (!pen) { ctx.moveTo(X(x), Y(y)); pen = true; } else ctx.lineTo(X(x), Y(y));
      }
      ctx.stroke();
    }
    ctx.restore();
  };
  for (const E of [-0.2, -0.12, -0.05, 0.08, 0.22, 0.4]) level(E, 0.22, p.glow, dpr);
  level(0, 0.9, p.core, dpr * 1.5);
  // a path just outside the loops: it runs both, slowing almost to a stop at the saddle each time
  // starting at x = 0.02 with energy 0.0008, just above the loops' own 0
  const run = cached('duff', () => integrate(duffing, 0.02, Math.sqrt(2 * (0.0008 + 0.0002 - 0.00000004)), 9000, 0.01));
  const n = run.length / 2;
  const k = Math.floor((t * 90) % n);
  trail(ctx, run, X, Y, Math.max(0, k - 140), k + 1, p.core, dpr * 1.6, 0.9);
  dot(ctx, X(run[2 * k]), Y(run[2 * k + 1]), 2.6 * dpr, p.core);
  dot(ctx, X(0), Y(0), 1.6 * dpr, INK);
  label(ctx, 'the saddle', X(0), Y(-0.16), dpr);
};

const stuck: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  // left: one deep valley and a ball rocking in it; right: its phase loop, drawn over itself
  const half = w * 0.55;
  const L = fit(half, h, -1.6, 1.6, -0.2, 2.6, 0.12);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = css(p.glow, 0.85);
  ctx.lineWidth = 1.4 * dpr;
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) { const x = -1.6 + (3.2 * i) / 200; const y = x * x; i ? ctx.lineTo(L.X(x), L.Y(y)) : ctx.moveTo(L.X(x), L.Y(y)); }
  ctx.stroke();
  ctx.restore();
  const amp = 0.32;
  const x = amp * Math.sin(t * 2.1);
  dot(ctx, L.X(x), L.Y(x * x) - 5 * dpr, 4 * dpr, p.core);
  const R = fit(w - half, h, -0.6, 0.6, -0.8, 0.8, 0.16);
  ctx.save();
  ctx.translate(half, 0);
  for (let k = 0; k < 6; k++) {
    ctx.strokeStyle = css(p.core, 0.12 + 0.12 * k);
    ctx.lineWidth = dpr * (1 + k * 0.15);
    ctx.beginPath();
    ctx.ellipse(R.X(0), R.Y(0), amp * R.s, amp * 2.1 * R.s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  dot(ctx, R.X(x), R.Y(amp * 2.1 * Math.cos(t * 2.1)), 2.4 * dpr, p.core);
  ctx.restore();
};

/** The logistic map's bifurcation diagram over [r0, r1], as an image, cached by size and palette. */
function bifurcation(w: number, h: number, r0: number, r1: number, p: P, y0 = 0, y1 = 1): HTMLCanvasElement {
  return cached(`bif${w}x${h}:${r0}:${r1}:${y0}:${palKey(p)}`, () => offscreen(w, h, (c) => {
    const img = c.createImageData(w, h);
    const acc = new Float32Array(w * h);
    for (let px = 0; px < w; px++) {
      const r = r0 + ((r1 - r0) * px) / (w - 1);
      let x = 0.5;
      for (let i = 0; i < 400; i++) x = r * x * (1 - x);
      for (let i = 0; i < 360; i++) {
        x = r * x * (1 - x);
        const py = Math.round((1 - (x - y0) / (y1 - y0)) * (h - 1));
        if (py >= 0 && py < h) acc[py * w + px] += 1;
      }
    }
    for (let i = 0; i < w * h; i++) {
      const a = Math.min(1, Math.sqrt(acc[i] / 5));
      const col = mix(p.glow, mix(p.core, [1, 1, 1], 0.35), a);
      img.data[4 * i] = col[0] * 255 * a; img.data[4 * i + 1] = col[1] * 255 * a; img.data[4 * i + 2] = col[2] * 255 * a; img.data[4 * i + 3] = 255 * Math.min(1, a * 1.4);
    }
    c.putImageData(img, 0, 0);
  }));
}

function logisticFigure(r0: number, r1: number, mark?: { r: number; text: string }, y0 = 0, y1 = 1): Draw {
  return (ctx, w, h, t, p, dpr) => {
    ground(ctx, w, h, p);
    const pad = Math.round(0.06 * h);
    const bw = w - 2 * pad, bh = h - 2 * pad;
    ctx.drawImage(bifurcation(bw, bh, r0, r1, p, y0, y1), pad, pad);
    const xr = (r: number) => pad + ((r - r0) / (r1 - r0)) * bw;
    const yx = (x: number) => pad + (1 - (x - y0) / (y1 - y0)) * bh;
    if (mark) {
      ctx.save();
      ctx.strokeStyle = css(INK, 0.5);
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(xr(mark.r), pad); ctx.lineTo(xr(mark.r), h - pad); ctx.stroke();
      ctx.restore();
      label(ctx, mark.text, xr(mark.r), pad * 0.55, dpr);
    }
    // the sweep: one drive at a time, its states lit, rising and falling slowly across the diagram
    const s = 0.5 - 0.5 * Math.cos((t / 12) * Math.PI * 2);
    const r = r0 + (r1 - r0) * (0.02 + 0.96 * s);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = css(p.core, 0.35);
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(xr(r), pad); ctx.lineTo(xr(r), h - pad); ctx.stroke();
    ctx.restore();
    const states = logisticStates(r, 500, 96);
    for (const x of states.slice(0, 96)) if (x >= y0 && x <= y1) dot(ctx, xr(r), yx(x), 1.5 * dpr, p.core);
    label(ctx, 'drive →', w - pad, h - pad * 0.45, dpr, 'right', 0.5);
  };
}

const lorenzStatic = (w: number, h: number, p: P, top = 1) => cached(`lor${w}x${h}:${top}:${palKey(p)}`, () => offscreen(w, Math.round(h * top), (c) => {
  const xy = projectLorenz(lorenzTrajectory(14000), w, Math.round(h * top));
  c.globalCompositeOperation = 'lighter';
  c.lineWidth = Math.max(1, Math.min(w, h) / 420);
  c.strokeStyle = css(p.glow, 0.32);
  c.beginPath();
  c.moveTo(xy[0], xy[1]);
  for (let i = 1; i < xy.length / 3; i++) c.lineTo(xy[3 * i], xy[3 * i + 1]);
  c.stroke();
})) as HTMLCanvasElement;

function lorenzHead(ctx: CanvasRenderingContext2D, w: number, hh: number, t: number, p: P, dpr: number) {
  const pts = cached('lor-pts', () => lorenzTrajectory(14000));
  const xy = cached(`lor-xy${w}x${hh}`, () => projectLorenz(pts as Float64Array, w, hh));
  const n = xy.length / 3;
  const k = Math.floor((t * 160) % n);
  const from = Math.max(0, k - 700);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  for (let j = from + 1; j <= k; j += 6) {
    const a = (j - from) / (k - from + 1);
    ctx.strokeStyle = css(mix(p.glow, p.core, a), a * 0.9);
    ctx.lineWidth = dpr * (0.6 + a * 1.6);
    ctx.beginPath();
    ctx.moveTo(xy[3 * (j - 1)], xy[3 * (j - 1) + 1]);
    for (let q = j; q < Math.min(k + 1, j + 7); q++) ctx.lineTo(xy[3 * q], xy[3 * q + 1]);
    ctx.stroke();
  }
  ctx.restore();
  dot(ctx, xy[3 * k], xy[3 * k + 1], 2.4 * dpr, p.core);
  return { k, pts: pts as Float64Array };
}

const lorenz: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  ctx.drawImage(lorenzStatic(w, h, p), 0, 0);
  lorenzHead(ctx, w, h, t, p, dpr);
};

const flip: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  const top = 0.66;
  const hh = Math.round(h * top);
  ctx.drawImage(lorenzStatic(w, h, p, top), 0, 0);
  const { k, pts } = lorenzHead(ctx, w, hh, t, p, dpr);
  // below: x(t), the side the path is on; each crossing of zero is a turn into the other wing
  const y0 = hh + (h - hh) / 2;
  const amp = (h - hh) * 0.36;
  const span = 2600;
  const from = Math.max(0, k - span);
  ctx.save();
  ctx.strokeStyle = css(INK, 0.18);
  ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.moveTo(w * 0.04, y0); ctx.lineTo(w * 0.96, y0); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = css(p.core, 0.85);
  ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath();
  const X = (i: number) => w * 0.04 + ((i - (k - span)) / span) * w * 0.92;
  for (let i = from; i <= k; i += 3) { const y = y0 - (pts[3 * i] / 20) * amp; i === from ? ctx.moveTo(X(i), y) : ctx.lineTo(X(i), y); }
  ctx.stroke();
  for (let i = from + 1; i <= k; i++) {
    if (Math.sign(pts[3 * i]) !== Math.sign(pts[3 * (i - 1)])) {
      ctx.strokeStyle = css(INK, 0.6);
      ctx.beginPath(); ctx.moveTo(X(i), y0 - 5 * dpr); ctx.lineTo(X(i), y0 + 5 * dpr); ctx.stroke();
    }
  }
  ctx.restore();
};

const pitchfork: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  const a = -0.9 + 1.9 * (0.5 - 0.5 * Math.cos((t / 10) * Math.PI * 2)); // −0.9 … 1.0 and back
  const lw = w * 0.6;
  const L = fit(lw, h, -1.7, 1.7, -0.45, 1.3, 0.1);
  const V = (x: number) => (x ** 4) / 4 - (a * x * x) / 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = css(p.glow, 0.9);
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  for (let i = 0; i <= 240; i++) { const x = -1.7 + (3.4 * i) / 240; i ? ctx.lineTo(L.X(x), L.Y(V(x))) : ctx.moveTo(L.X(x), L.Y(V(x))); }
  ctx.stroke();
  ctx.restore();
  const m = a > 0 ? Math.sqrt(a) : 0;
  for (const x of a > 0 ? [-m, m] : [0]) dot(ctx, L.X(x), L.Y(V(x)) - 5 * dpr, 3.4 * dpr, p.core);
  // right: the pitchfork itself, where the valleys lie as the drive rises, and where it stands now
  const R = fit(w - lw, h, -1, 1.05, -1.15, 1.15, 0.16);
  ctx.save();
  ctx.translate(lw, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 1.3 * dpr;
  ctx.strokeStyle = css(p.core, 0.8);
  ctx.beginPath(); ctx.moveTo(R.X(-1), R.Y(0)); ctx.lineTo(R.X(0), R.Y(0)); ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= 80; i++) { const b = (1.05 * i) / 80; i ? ctx.lineTo(R.X(b), R.Y(Math.sqrt(b))) : ctx.moveTo(R.X(b), R.Y(0)); }
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= 80; i++) { const b = (1.05 * i) / 80; i ? ctx.lineTo(R.X(b), R.Y(-Math.sqrt(b))) : ctx.moveTo(R.X(b), R.Y(0)); }
  ctx.stroke();
  ctx.setLineDash([3 * dpr, 4 * dpr]);
  ctx.strokeStyle = css(p.core, 0.35);
  ctx.beginPath(); ctx.moveTo(R.X(0), R.Y(0)); ctx.lineTo(R.X(1.05), R.Y(0)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = css(INK, 0.35);
  ctx.beginPath(); ctx.moveTo(R.X(a), R.Y(-1.15)); ctx.lineTo(R.X(a), R.Y(1.15)); ctx.stroke();
  ctx.restore();
  for (const y of a > 0 ? [-m, m] : [0]) dot(ctx, lw + R.X(a), R.Y(y), 2 * dpr, p.core);
  label(ctx, 'tension →', w - 6 * dpr, h - 10 * dpr, dpr, 'right', 0.5);
};

const focus: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  const { X, Y } = fit(w, h, -1.25, 1.25, -1.25, 1.25, 0.08);
  // a damped rotation, knocked off centre every few seconds (always the same knocks), returning each time
  const period = 4.5;
  const k = Math.floor(t / period);
  const local = t - k * period;
  const ang = k * 2.39996;
  const r0 = 0.75 + 0.3 * ((k * 0.618) % 1);
  const decay = 0.32;
  const pts: number[] = [];
  for (let s = 0; s <= local; s += 1 / 60) {
    const r = r0 * Math.exp(-decay * s * 2.2);
    pts.push(r * Math.cos(ang + s * 3.2), r * Math.sin(ang + s * 3.2));
  }
  // the earlier returns, faint
  for (let j = 1; j <= 3; j++) {
    const kk = k - j;
    if (kk < 0) break;
    const a2 = kk * 2.39996, rr = 0.75 + 0.3 * ((kk * 0.618) % 1);
    const old: number[] = [];
    for (let s = 0; s <= period; s += 1 / 30) { const r = rr * Math.exp(-decay * s * 2.2); old.push(r * Math.cos(a2 + s * 3.2), r * Math.sin(a2 + s * 3.2)); }
    trail(ctx, old, X, Y, 0, old.length / 2, p.glow, dpr * 0.8, 0.28 / j);
  }
  trail(ctx, pts, X, Y, 0, pts.length / 2, p.core, dpr * 1.4, 0.9);
  const n = pts.length / 2;
  if (n) dot(ctx, X(pts[2 * n - 2]), Y(pts[2 * n - 1]), 2.6 * dpr, p.core);
  dot(ctx, X(0), Y(0), 2 * dpr, INK);
  label(ctx, 'the centre', X(0), Y(-0.12), dpr);
};

const sync: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  const cycle = 24;
  const dt = 1 / 60;
  const run = cached('sync', () => coupledPhases(1.6, 2.15, (s) => Math.max(0, ((s % cycle) - 5) / 12) * 0.62, Math.round((cycle * 2) / dt), dt)) as Float64Array;
  const k = Math.min(run.length / 3 - 1, Math.floor((t % cycle) / dt) + Math.round(cycle / dt));
  const a = run[3 * k], b = run[3 * k + 1];
  const R = Math.min(w * 0.17, h * 0.25);
  const cy = h * 0.36;
  const centres = [w * 0.3, w * 0.7];
  [a, b].forEach((th, i) => {
    const cx = centres[i];
    ctx.save();
    ctx.strokeStyle = css(p.glow, 0.55);
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    dot(ctx, cx + R * Math.cos(th - Math.PI / 2), cy + R * Math.sin(th - Math.PI / 2), 3 * dpr, p.core);
  });
  // below: the difference between them — wandering while they run apart, still once they keep step
  const y0 = h * 0.82, amp = h * 0.1;
  const span = Math.round(12 / dt);
  ctx.save();
  ctx.strokeStyle = css(INK, 0.18);
  ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.moveTo(w * 0.06, y0); ctx.lineTo(w * 0.94, y0); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = css(p.core, 0.85);
  ctx.lineWidth = 1.3 * dpr;
  ctx.beginPath();
  for (let i = Math.max(0, k - span), first = true; i <= k; i += 2) {
    const x = w * 0.06 + ((i - (k - span)) / span) * w * 0.88;
    const y = y0 - Math.sin(run[3 * i + 1] - run[3 * i]) * amp;
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
  label(ctx, 'how far apart they are', w * 0.06, y0 - amp - 8 * dpr, dpr, 'left', 0.5);
};

const saddle: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  const { X, Y } = fit(w, h, -1.6, 1.6, -1.2, 1.2, 0.06);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // the flow x' = x, y' = −y: hyperbolas, in along one axis and out along the other
  ctx.strokeStyle = css(p.glow, 0.3);
  ctx.lineWidth = dpr;
  for (const c of [0.05, 0.14, 0.28, 0.5]) for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) { const x = 0.02 + (1.6 * i) / 120; const y = c / x; if (y > 1.3) continue; ctx.lineTo(X(sx * x), Y(sy * y)); }
    ctx.stroke();
  }
  ctx.strokeStyle = css(p.core, 0.8);
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(X(-1.6), Y(0)); ctx.lineTo(X(1.6), Y(0)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(X(0), Y(-1.2)); ctx.lineTo(X(0), Y(1.2)); ctx.stroke();
  ctx.restore();
  // particles: in from above and below, out to either side
  for (let j = 0; j < 10; j++) {
    const ph = ((t / 5 + j / 10) % 1);
    const s = ph * 5 - 2.5;
    const x0 = 0.04 * (j % 2 ? 1 : -1) * (1 + (j % 5) * 0.4);
    const y0 = 1.2 * (j < 5 ? 1 : -1);
    const tt = s + 2.5;
    const x = x0 * Math.exp(tt), y = y0 * Math.exp(-tt);
    if (Math.abs(x) < 1.6) dot(ctx, X(x), Y(y), 1.8 * dpr, p.core);
  }
  label(ctx, 'stable', X(0.1), Y(1.08), dpr, 'left', 0.55);
  label(ctx, 'unstable', X(1.5), Y(0.09), dpr, 'right', 0.55);
};

/**
 * An escape-time tile drawn dark: only the boundary (where escape is slow) lights, rising from the ground through the
 * glow to the core, so a pale palette still reads as light on the night of the card. Bounded points keep the ground.
 */
function fractal(iter: Float32Array, maxIter: number, w: number, h: number, p: P, gamma = 2.4): HTMLCanvasElement {
  return offscreen(w, h, (c) => {
    const img = c.createImageData(w, h);
    const top = Math.log(1 + maxIter);
    for (let i = 0; i < iter.length; i++) {
      const v = iter[i];
      let col: RGB;
      if (v >= maxIter) col = mix(p.deep, p.fog, 0.35);
      else {
        const t = Math.pow(Math.log(1 + v) / top, gamma);
        col = t < 0.5 ? mix(p.deep, p.glow, t * 2) : mix(p.glow, mix(p.core, [1, 1, 1], 0.3), (t - 0.5) * 2);
      }
      img.data[4 * i] = col[0] * 255; img.data[4 * i + 1] = col[1] * 255; img.data[4 * i + 2] = col[2] * 255; img.data[4 * i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  });
}
const JULIA_C: [number, number] = [-0.4, 0.6];

/** A Julia or Mandelbrot tile at a chosen centre and span, so the card can be moved through. */
export function paintFractal(ctx: CanvasRenderingContext2D, w: number, h: number, kind: 'julia' | 'mandelbrot', centre: [number, number], span: number, p: P, coarse: boolean) {
  const maxIter = kind === 'mandelbrot' ? (coarse ? 80 : 280) : (coarse ? 60 : 200);
  const gamma = kind === 'mandelbrot' ? 4.2 : 2.4;
  const iter = kind === 'julia'
    ? juliaTile(w, h, JULIA_C, { centre, span, maxIter })
    : mandelbrotTile(w, h, { centre, span, maxIter });
  ctx.drawImage(fractal(iter, maxIter, w, h, p, gamma), 0, 0);
}

const juliaFig: Draw = (ctx, w, h, _t, p) => paintFractal(ctx, w, h, 'julia', [0, 0], 3.1, p, false);
const mandelFig: Draw = (ctx, w, h, _t, p) => paintFractal(ctx, w, h, 'mandelbrot', [-0.7453, 0.1127], 0.02, p, false);

/** Neumann's three named stages: one valley, two, one again on higher ground (the headings are his chapter titles). */
const STAGES = ['The Uroboros', 'The Separation of the World Parents', 'Transformation'];
const landscape: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  const { X, Y } = fit(w, h, -1.8, 1.8, -0.6, 1.9, 0.1);
  const cyc = 18;
  const s = (t % cyc) / cyc; // 0 … 1
  // a: the split (one valley → two → one), lift: the ground the last valley stands on
  const a = s < 0.33 ? -0.8 + (s / 0.33) * 1.8 : s < 0.66 ? 1 : 1 - ((s - 0.66) / 0.34) * 1.8;
  const lift = s < 0.66 ? 0 : ((s - 0.66) / 0.34) * 0.75;
  const V = (x: number, aa: number, l: number) => (x ** 4) / 4 - (aa * x * x) / 2 + l;
  const curve = (aa: number, l: number, c: RGB, alpha: number, width: number) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = css(c, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) { const x = -1.8 + (3.6 * i) / 240; const y = V(x, aa, l); i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)); }
    ctx.stroke();
    ctx.restore();
  };
  // where it has been, faint: the round beginning and, once reached, the split
  curve(-0.8, 0, p.glow, 0.18, dpr);
  if (s > 0.33) curve(1, 0, p.glow, 0.14, dpr);
  curve(a, lift, p.core, 0.95, 1.7 * dpr);
  const m = a > 0 ? Math.sqrt(a) : 0;
  for (const x of a > 0 ? [-m, m] : [0]) dot(ctx, X(x), Y(V(x, a, lift)) - 5 * dpr, 3.2 * dpr, p.core);
  const stage = s < 0.22 ? 0 : s < 0.72 ? 1 : 2;
  label(ctx, `${['I', 'II', 'III'][stage]} · ${STAGES[stage]}`, w / 2, h - 12 * dpr, dpr, 'center', 0.9);
};

const torus: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  const R = 1, r = 0.42, tilt = 1.05;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const S = Math.min(w, h) * 0.34;
  const proj = (u: number, v: number) => {
    const x = (R + r * Math.cos(v)) * Math.cos(u);
    const y = (R + r * Math.cos(v)) * Math.sin(u);
    const z = r * Math.sin(v);
    const y2 = y * ct - z * st, z2 = y * st + z * ct;
    return [w / 2 + x * S, h / 2 + y2 * S * 0.9, z2] as const;
  };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = css(p.glow, 0.12);
  ctx.lineWidth = dpr;
  for (let i = 0; i < 16; i++) {
    const u = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    for (let j = 0; j <= 48; j++) { const [x, y] = proj(u, (j / 48) * Math.PI * 2); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
  for (let j = 0; j < 6; j++) {
    const v = (j / 6) * Math.PI * 2;
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) { const [x, y] = proj((i / 96) * Math.PI * 2, v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
  ctx.restore();
  // the winding: round the tube (2 + φ) times for each time round the ring, an irrational ratio, so it never closes
  const ratio = 2 + (1 + Math.sqrt(5)) / 2;
  const PER = 360; // steps per turn of the ring
  const turns = 0.35 + ((t * 0.05) % 2.4);
  const steps = Math.max(2, Math.floor(turns * PER));
  const wind = (i: number) => { const u = (i / PER) * Math.PI * 2; return proj(u, u * ratio); };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  let prev = wind(0);
  for (let i = 1; i <= steps; i++) {
    const q = wind(i);
    const age = i / steps;
    const front = (q[2] + 1) / 2;
    ctx.strokeStyle = css(mix(p.glow, p.core, age), (0.35 + 0.65 * age) * (0.35 + 0.65 * front));
    ctx.lineWidth = dpr * (0.8 + 1.1 * age);
    ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    prev = q;
  }
  ctx.restore();
  const head = wind(steps);
  dot(ctx, head[0], head[1], 2.6 * dpr, p.core);
};

/**
 * The square of the four positions, folded twice: opposite edges meet to make a cylinder, then the cylinder's ends
 * meet to make the torus the winding runs on. Positions 1–4 travel with the sheet. Same night and the same light as
 * the winding.
 */
const fold: Draw = (ctx, w, h, t, p, dpr) => {
  ground(ctx, w, h, p);
  const cyc = 18;
  const s = (t % cyc) / cyc;
  const ease = (x: number) => x * x * (3 - 2 * x);
  // hold the square, curl one pair of edges into a cylinder, hold that, then bend the ends together
  const s1 = s < 0.2 ? 0 : s < 0.42 ? ease((s - 0.2) / 0.22) : 1;
  const s2 = s < 0.56 ? 0 : s < 0.82 ? ease((s - 0.56) / 0.26) : 1;
  const R = 1, r = 0.42, tilt = 1.05, half = 1.15;
  const ct = Math.cos(tilt), stn = Math.sin(tilt);
  const S = Math.min(w, h) * 0.34;
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
  // The sheet curls about its horizontal axis (arc length kept), turns enough that the tube reads as round,
  // then that tube bends until its ends meet and the ring opens to the same torus the winding is drawn on.
  const model = (u: number, v: number): [number, number, number] => {
    const d = (v / Math.PI - 1) * half;
    const axis = (u / Math.PI - 1) * half;
    const edge = Math.PI * s1;
    let yC: number;
    let zC: number;
    if (edge < 1e-3) {
      yC = 0;
      zC = d;
    } else {
      const ang = (d / half) * edge;
      const rho = half / edge;
      const center = rho * (1 - Math.cos(edge)) * 0.5;
      yC = rho * (1 - Math.cos(ang)) - center;
      zC = rho * Math.sin(ang);
    }
    const yaw = 0.85 * s1 * (1 - s2);
    const xY = axis * Math.cos(yaw) - yC * Math.sin(yaw);
    const yY = axis * Math.sin(yaw) + yC * Math.cos(yaw);
    if (s2 <= 0) return [xY, yY, zC];
    const rho0 = half / Math.PI;
    const yT = rho0 * Math.cos(v);
    const zT = -rho0 * Math.sin(v);
    const span = Math.PI * Math.min(s2 / 0.72, 1);
    const theta = (axis / half) * span;
    const Rb = span < 1e-3 ? 1 : half / span;
    const bx = span < 1e-3 ? axis : (Rb + yT) * Math.sin(theta);
    const by = span < 1e-3 ? yT : (Rb + yT) * Math.cos(theta) - Rb;
    const yw = 0.85 * (1 - Math.min(s2 / 0.35, 1));
    const xW = bx * Math.cos(yw) - by * Math.sin(yw);
    const yW = bx * Math.sin(yw) + by * Math.cos(yw);
    const grow = s2 < 0.72 ? 0 : ease((s2 - 0.72) / 0.28);
    const tor: [number, number, number] = [
      (R + r * Math.cos(v)) * Math.cos(u),
      (R + r * Math.cos(v)) * Math.sin(u),
      r * Math.sin(v),
    ];
    return [lerp(xW, tor[0], grow), lerp(yW, tor[1], grow), lerp(zT, tor[2], grow)];
  };
  const proj = (u: number, v: number) => {
    const [x, y, z] = model(u, v);
    const y2 = y * ct - z * stn, z2 = y * stn + z * ct;
    return [w / 2 + x * S, h / 2 + y2 * S * 0.9, z2] as const;
  };
  const stroke = (samples: Array<readonly [number, number, number]>, c: RGB, alpha: number, width: number) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const front = Math.max(0, Math.min(1, ((a[2] + b[2]) / 2 + 1.6) / 3.2));
      ctx.strokeStyle = css(c, alpha * (0.28 + 0.72 * front));
      ctx.lineWidth = width * (0.7 + 0.45 * front);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.restore();
  };
  const ring = (fixed: 'u' | 'v', value: number, n: number) => {
    const out: Array<readonly [number, number, number]> = [];
    for (let i = 0; i <= n; i++) {
      const q = (i / n) * Math.PI * 2;
      out.push(fixed === 'u' ? proj(value, q) : proj(q, value));
    }
    return out;
  };
  // once a pair of edges has met, draw that loop once
  const uN = s2 > 0.92 ? 6 : 7;
  const vN = s1 > 0.92 ? 6 : 7;
  for (let i = 0; i < uN; i++) stroke(ring('u', (i / 6) * Math.PI * 2, 56), p.glow, 0.42, dpr);
  for (let j = 0; j < vN; j++) stroke(ring('v', (j / 6) * Math.PI * 2, 72), p.glow, 0.42, dpr);
  const joiningEnds = s2 > 0.02;
  const progress = joiningEnds ? s2 : s1;
  if (progress < 0.98) {
    const which = joiningEnds ? 'u' : 'v';
    const seamA = 0.4 + 0.55 * (1 - progress);
    stroke(ring(which, 0, 72), p.core, seamA, 1.45 * dpr);
    stroke(ring(which, Math.PI * 2 * 0.998, 72), p.core, seamA, 1.45 * dpr);
  }
  // the four corners. They become one point on the torus, so the names sit in a fan and stay readable.
  const corners: Array<[string, number, number, number, number]> = [
    ['1', 0, 0, -12, 10],
    ['2', Math.PI * 2 * 0.998, 0, 12, 10],
    ['3', Math.PI * 2 * 0.998, Math.PI * 2 * 0.998, 12, -12],
    ['4', 0, Math.PI * 2 * 0.998, -12, -12],
  ];
  for (const [name, u, v, ox, oy] of corners) {
    const [x, y] = proj(u, v);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css(p.core, 0.95);
    ctx.beginPath();
    ctx.arc(x, y, 2.1 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    label(ctx, name, x + ox * dpr, y + oy * dpr, dpr, 'center', 0.92);
  }
};

/** The construction that precedes the winding: not a route stop of its own, so it is not in {@link FIGURES}. */
export const construction: Figure = { caption: '', animated: true, still: 1.5, draw: fold };

export const FIGURES: Record<FigureId, Figure> = {
  'limit-cycle': { caption: 'Van der Pol oscillator: a limit cycle · drawn here', animated: true, still: 11, draw: limitCycle },
  homoclinic: { caption: 'Duffing oscillator: two homoclinic loops through a saddle · drawn here', animated: true, still: 40, draw: homoclinic },
  stuck: { caption: 'One deep potential well and its closed orbit · drawn here', animated: true, still: 0.6, draw: stuck },
  cascade: { caption: 'Logistic map: period doubling into chaos · drawn here', animated: true, still: 4.2, draw: logisticFigure(2.8, 4) },
  edge: { caption: 'Logistic map at the onset of chaos · drawn here', animated: true, still: 5.4, draw: logisticFigure(3.44, 3.7, { r: 3.5699456, text: 'the edge' }) },
  lorenz: { caption: 'Lorenz attractor · drawn here', animated: true, still: 60, draw: lorenz },
  flip: { caption: 'Lorenz attractor: the switches between its wings · drawn here', animated: true, still: 60, draw: flip },
  pitchfork: { caption: 'Pitchfork bifurcation: one valley becomes two · drawn here', animated: true, still: 4.4, draw: pitchfork },
  window: { caption: 'Logistic map: a window of order inside chaos · drawn here', animated: true, still: 5.2, draw: logisticFigure(3.8, 3.87, { r: 3.8284, text: 'three states' }, 0.12, 1) },
  focus: { caption: 'A stable spiral, knocked off centre · drawn here', animated: true, still: 9.8, draw: focus },
  sync: { caption: 'Two coupled oscillators falling into step · drawn here', animated: true, still: 22, draw: sync },
  saddle: { caption: 'A saddle: its stable and unstable manifolds · drawn here', animated: true, still: 2.3, draw: saddle },
  julia: { caption: 'Julia set · drawn here', animated: false, still: 0, draw: juliaFig },
  mandelbrot: { caption: 'Mandelbrot set, at its edge · drawn here', animated: false, still: 0, draw: mandelFig },
  landscape: { caption: 'Neumann’s stages, drawn here as a changing potential (the drawing is not his)', animated: true, still: 13, draw: landscape },
  torus: { caption: 'A winding on a torus that never closes · drawn here', animated: true, still: 30, draw: torus },
};

/** The figure for an id, or the Lorenz attractor for one this build does not know. */
export const figureOf = (id: string | undefined): Figure => FIGURES[(id ?? 'lorenz') as FigureId] ?? FIGURES.lorenz;

export const paletteOf = (p: Palette): P => paletteRgb(p);
