// Canvas painting for the native renders. Takes a 2D context; nothing here reads the DOM or the clock, so the same
// inputs paint the same pixels. The attractors are drawn here, as illustrations (see render.ts).
import type { RGB } from '../data/palette';
import type { Palette } from '../types/field';
import { escapeToRgba, juliaTile, lorenzTrajectory, mandelbrotTile, paletteRgb, projectLorenz } from './render';

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

/** Lorenz: a luminous trail, older points dimmer, drawn over the palette's deep tone. */
export function paintLorenz(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, opts: { points?: number } = {}): void {
  const p = paletteRgb(palette);
  ctx.save();
  ctx.fillStyle = css(p.deep);
  ctx.fillRect(0, 0, w, h);
  const xy = projectLorenz(lorenzTrajectory(opts.points ?? 12000), w, h);
  const n = xy.length / 3;
  const width = Math.max(1, Math.min(w, h) / 380);
  const chunks = 48;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const pass of [{ scale: 3.2, alpha: 0.12 }, { scale: 1, alpha: 1 }]) {
    ctx.lineWidth = width * pass.scale;
    for (let k = 0; k < chunks; k++) {
      const from = Math.floor((k * n) / chunks);
      const to = Math.min(n - 1, Math.floor(((k + 1) * n) / chunks) + 1);
      const t = k / (chunks - 1);
      const colour = mix(p.glow, p.core, t);
      ctx.strokeStyle = css(colour, Math.min(1, pass.alpha * (0.06 + 0.94 * t * t)));
      ctx.beginPath();
      ctx.moveTo(xy[3 * from], xy[3 * from + 1]);
      for (let i = from + 1; i <= to; i++) ctx.lineTo(xy[3 * i], xy[3 * i + 1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function blit(ctx: CanvasRenderingContext2D, w: number, h: number, iter: Float32Array, maxIter: number, palette: Palette): void {
  const img = ctx.createImageData(w, h);
  img.data.set(escapeToRgba(iter, maxIter, palette));
  ctx.putImageData(img, 0, 0);
}

export function paintMandelbrot(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, opts: { maxIter?: number; centre?: [number, number]; span?: number } = {}): void {
  const maxIter = opts.maxIter ?? 200;
  blit(ctx, w, h, mandelbrotTile(w, h, { ...opts, maxIter }), maxIter, palette);
}

/** A Julia set for the constant c (a default that sits on the set's connected dendrites). */
export function paintJulia(ctx: CanvasRenderingContext2D, w: number, h: number, palette: Palette, c: [number, number] = [-0.8, 0.156], opts: { maxIter?: number; span?: number } = {}): void {
  const maxIter = opts.maxIter ?? 160;
  blit(ctx, w, h, juliaTile(w, h, c, { ...opts, maxIter }), maxIter, palette);
}

