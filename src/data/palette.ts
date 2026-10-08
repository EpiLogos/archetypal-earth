// Palette maths: hex <-> rgb, eased blending between atmospheres. Pure.
import type { Palette } from '../types/field';

export type RGB = [number, number, number]; // 0..1
export interface RGBPalette {
  core: RGB;
  glow: RGB;
  fog: RGB;
  deep: RGB;
  /** instinct (0) .. spirit (1) */
  spectrum: number;
}

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(c: RGB): string {
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${q(c[0])}${q(c[1])}${q(c[2])}`;
}

export function rgbCss(c: RGB, a = 1): string {
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return a >= 1 ? `rgb(${q(c[0])} ${q(c[1])} ${q(c[2])})` : `rgb(${q(c[0])} ${q(c[1])} ${q(c[2])} / ${a})`;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpRgb(a: RGB, b: RGB, t: number, out: RGB = [0, 0, 0]): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export function toRgbPalette(p: Palette, spectrum: number): RGBPalette {
  return { core: hexToRgb(p.core), glow: hexToRgb(p.glow), fog: hexToRgb(p.fog), deep: hexToRgb(p.deep), spectrum };
}

export function clonePalette(p: RGBPalette): RGBPalette {
  return { core: [...p.core], glow: [...p.glow], fog: [...p.fog], deep: [...p.deep], spectrum: p.spectrum };
}

/** Blend two palettes into `out` (allocation-free when out is supplied). */
export function mixPalette(a: RGBPalette, b: RGBPalette, t: number, out: RGBPalette): RGBPalette {
  lerpRgb(a.core, b.core, t, out.core);
  lerpRgb(a.glow, b.glow, t, out.glow);
  lerpRgb(a.fog, b.fog, t, out.fog);
  lerpRgb(a.deep, b.deep, t, out.deep);
  out.spectrum = lerp(a.spectrum, b.spectrum, t);
  return out;
}

/** Weighted average of palettes (used for culture / place subjects). */
export function averagePalettes(ps: { p: RGBPalette; w: number }[]): RGBPalette | null {
  let total = 0;
  for (const x of ps) total += x.w;
  if (!ps.length || total <= 0) return null;
  const out: RGBPalette = { core: [0, 0, 0], glow: [0, 0, 0], fog: [0, 0, 0], deep: [0, 0, 0], spectrum: 0 };
  for (const { p, w } of ps) {
    const k = w / total;
    for (const key of ['core', 'glow', 'fog', 'deep'] as const) {
      for (let i = 0; i < 3; i++) out[key][i] += p[key][i] * k;
    }
    out.spectrum += p.spectrum * k;
  }
  return out;
}

/** The resting world atmosphere: cool starlight over deep indigo. */
export const WORLD_PALETTE: RGBPalette = {
  core: hexToRgb('#c3d2f2'),
  glow: hexToRgb('#4f78cf'),
  fog: hexToRgb('#10193a'),
  deep: hexToRgb('#02030a'),
  spectrum: 0.55,
};

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
