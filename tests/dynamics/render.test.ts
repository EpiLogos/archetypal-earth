import { describe, expect, it } from 'vitest';
import { escapeToRgba, juliaEscape, juliaTile, lorenzTrajectory, mandelbrotEscape, mandelbrotTile, projectLorenz } from '../../src/dynamics/render';

const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

describe('the Lorenz trajectory', () => {
  it('is deterministic: the same call gives the same bytes', () => {
    const a = lorenzTrajectory(4000);
    const b = lorenzTrajectory(4000);
    expect(bytes(a).equals(bytes(b))).toBe(true);
    expect(a.length).toBe(12000);
  });

  it('stays bounded after the transient', () => {
    const p = lorenzTrajectory(20000);
    for (let i = 0; i < p.length; i += 3) {
      expect(Math.abs(p[i])).toBeLessThan(30);
      expect(Math.abs(p[i + 1])).toBeLessThan(40);
      expect(p[i + 2]).toBeGreaterThan(0);
      expect(p[i + 2]).toBeLessThan(60);
    }
  });

  it('has two lobes: crossings of the plane z = ρ−1 occur on both sides of x = 0', () => {
    const p = lorenzTrajectory(40000);
    const plane = 27; // ρ − 1, where the two wings are joined
    let positive = 0, negative = 0;
    for (let i = 0; i + 1 < p.length / 3; i++) {
      const z0 = p[3 * i + 2] - plane, z1 = p[3 * (i + 1) + 2] - plane;
      if (z0 * z1 < 0) {
        if (p[3 * i] > 0) positive++;
        else negative++;
      }
    }
    expect(positive).toBeGreaterThan(0);
    expect(negative).toBeGreaterThan(0);
  });

  it('projects into the box, deterministically, with depth in 0..1', () => {
    const p = lorenzTrajectory(3000);
    const a = projectLorenz(p, 300, 200);
    const b = projectLorenz(p, 300, 200);
    expect(a.length).toBe(9000);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    for (let i = 0; i < a.length; i += 3) {
      expect(a[i]).toBeGreaterThanOrEqual(0);
      expect(a[i]).toBeLessThanOrEqual(300);
      expect(a[i + 1]).toBeGreaterThanOrEqual(0);
      expect(a[i + 1]).toBeLessThanOrEqual(200);
      expect(a[i + 2]).toBeGreaterThanOrEqual(0);
      expect(a[i + 2]).toBeLessThanOrEqual(1);
    }
  });
});

describe('the Mandelbrot set', () => {
  it('knows known membership: 0 and −1 are inside, 1+i is outside', () => {
    const maxIter = 200;
    expect(mandelbrotEscape(0, 0, maxIter)).toBe(maxIter);
    expect(mandelbrotEscape(-1, 0, maxIter)).toBe(maxIter);
    expect(mandelbrotEscape(1, 1, maxIter)).toBeLessThan(maxIter);
  });

  it('gives a tile of the right size and dtype, with counts in range', () => {
    const t = mandelbrotTile(40, 30, { maxIter: 80 });
    expect(t).toBeInstanceOf(Float32Array);
    expect(t.length).toBe(1200);
    for (const v of t) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(80);
    }
  });
});

describe('the Julia sets', () => {
  it('are symmetric under z ↦ −z, exactly (z² is unchanged by the sign)', () => {
    for (const [zr, zi] of [[0.3, 0.2], [-0.7, 0.1], [1.1, -0.4], [0.05, 0.9]]) {
      expect(juliaEscape(zr, zi, -0.8, 0.156)).toBe(juliaEscape(-zr, -zi, -0.8, 0.156));
    }
  });

  it('gives a tile symmetric about its centre: pixel (x,y) matches (w−1−x, h−1−y)', () => {
    for (const [w, h] of [[41, 31], [40, 30]]) {
      const t = juliaTile(w, h, [-0.4, 0.6], { maxIter: 60 });
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          expect(t[y * w + x]).toBe(t[(h - 1 - y) * w + (w - 1 - x)]);
        }
      }
    }
  });

  it('gives a tile of the right size and dtype', () => {
    const t = juliaTile(24, 16, [-0.8, 0.156], { maxIter: 50 });
    expect(t).toBeInstanceOf(Float32Array);
    expect(t.length).toBe(24 * 16);
  });
});

describe('the palette mapping', () => {
  it('maps a tile to RGBA bytes, with bounded points in the deep tone', () => {
    const iter = new Float32Array([10, 200, 5, 200]);
    const rgba = escapeToRgba(iter, 200, { core: '#ffffff', glow: '#4f78cf', fog: '#10193a', deep: '#020309' });
    expect(rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(rgba.length).toBe(16);
    expect([rgba[4 * 1], rgba[4 * 1 + 1], rgba[4 * 1 + 2]]).toEqual([2, 3, 9]);
    expect(rgba[4 * 1 + 3]).toBe(255);
  });
});
