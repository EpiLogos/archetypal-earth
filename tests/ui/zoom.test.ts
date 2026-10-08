import { describe, expect, it } from 'vitest';
import { angleBetween } from '../../src/data/geo';
import {
  anchorView, clampDist, degPerPixel, easeDist, MIN_DIST, rayThroughNdc, surfacePointAt, zoomedDist, type Lens, type View,
} from '../../src/globe/zoom';

const lens: Lens = { fovDeg: 38, aspect: 1.6, shiftX: 0, shiftY: 0 };
const shifted: Lens = { fovDeg: 38, aspect: 1.6, shiftX: -0.27, shiftY: 0.1 };

describe('screen ↔ sphere', () => {
  it('the screen centre looks at the sub-camera point', () => {
    const v: View = { lat: 20, lon: 40, dist: 3 };
    const hit = surfacePointAt(v, lens, 0, 0)!;
    const c = rayThroughNdc(v, lens, 0, 0);
    expect(hit).not.toBeNull();
    expect(c.d[0] * v.dist).toBeLessThan(0); // looks toward the origin
    // sub-camera direction
    const la = (20 * Math.PI) / 180, lo = (40 * Math.PI) / 180;
    const sub: [number, number, number] = [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
    expect(angleBetween(hit, sub)).toBeLessThan(1e-9);
  });

  it('a ray into space misses', () => {
    expect(surfacePointAt({ lat: 0, lon: 0, dist: 3 }, lens, 0.95, 0.9)).toBeNull();
  });
});

describe('cursor-anchored zoom', () => {
  const cases: { v: View; nx: number; ny: number; lens: Lens }[] = [
    { v: { lat: 10, lon: 20, dist: 3.8 }, nx: 0.25, ny: -0.1, lens },
    { v: { lat: -35, lon: 140, dist: 2.2 }, nx: -0.3, ny: 0.2, lens },
    { v: { lat: 48, lon: -100, dist: 1.4 }, nx: 0.1, ny: 0.15, lens },
    { v: { lat: 24, lon: 26, dist: 3.8 }, nx: -0.15, ny: 0.05, lens: shifted },
  ];
  for (const k of cases) {
    it(`keeps the point under the cursor (${k.v.lat},${k.v.lon} d=${k.v.dist})`, () => {
      const p = surfacePointAt(k.v, k.lens, k.nx, k.ny)!;
      expect(p).not.toBeNull();
      let v = k.v;
      // a run of exponential zoom steps in, then back out
      for (const d of [3.3, 2.6, 1.9, 1.3, 1.08, 1.5, 2.6, 4]) {
        const next = { ...v, dist: d };
        const ll = anchorView(next, k.lens, p, k.nx, k.ny)!;
        expect(ll).not.toBeNull();
        v = { ...next, ...ll };
        const under = surfacePointAt(v, k.lens, k.nx, k.ny)!;
        expect(angleBetween(under, p)).toBeLessThan(1e-5);
      }
    });
  }

  it('anchoring at the screen centre does not move the camera', () => {
    const v: View = { lat: 12, lon: -30, dist: 3 };
    const p = surfacePointAt(v, lens, 0, 0)!;
    const ll = anchorView({ ...v, dist: 1.5 }, lens, p, 0, 0)!;
    expect(ll.lat).toBeCloseTo(12, 6);
    expect(ll.lon).toBeCloseTo(-30, 6);
  });

  it('dragging: the grabbed point follows the pointer', () => {
    const v: View = { lat: 30, lon: 10, dist: 2 };
    const p = surfacePointAt(v, lens, 0.1, 0.1)!;
    const ll = anchorView(v, lens, p, -0.2, 0.0)!;
    const under = surfacePointAt({ ...v, ...ll }, lens, -0.2, 0.0)!;
    expect(angleBetween(under, p)).toBeLessThan(1e-5);
  });

  it('returns null when the cursor is off the globe', () => {
    const v: View = { lat: 0, lon: 0, dist: 3 };
    expect(anchorView(v, lens, [1, 0, 0], 0.98, 0.95)).toBeNull();
  });
});

describe('altitude clamps and exponential zoom', () => {
  it('clamps to the minimum and maximum distance', () => {
    expect(clampDist(1.0, 5.4)).toBe(MIN_DIST);
    expect(clampDist(9, 5.4)).toBe(5.4);
    expect(clampDist(3, 5.4)).toBe(3);
  });

  it('wheel zoom scales altitude, not distance, and is symmetric', () => {
    const d0 = 3.0;
    const inD = zoomedDist(d0, -100, false, 5.4);
    const outD = zoomedDist(inD, 100, false, 5.4);
    expect(inD).toBeLessThan(d0);
    expect(outD).toBeCloseTo(d0, 9);
    // same ratio of altitudes from different heights
    const r1 = (zoomedDist(2, -100, false, 5.4) - 1) / (2 - 1);
    const r2 = (zoomedDist(4, -100, false, 5.4) - 1) / (4 - 1);
    expect(r1).toBeCloseTo(r2, 9);
  });

  it('never leaves the allowed range however hard the wheel is spun', () => {
    let d = 3;
    for (let i = 0; i < 200; i++) d = zoomedDist(d, -500, false, 5.4);
    expect(d).toBe(MIN_DIST);
    for (let i = 0; i < 200; i++) d = zoomedDist(d, 500, true, 5.4);
    expect(d).toBe(5.4);
  });

  it('pinch has a stronger gain than the wheel for the same delta', () => {
    expect(1 - (zoomedDist(3, -10, true, 5.4) - 1) / 2).toBeGreaterThan(1 - (zoomedDist(3, -10, false, 5.4) - 1) / 2);
  });

  it('easing approaches the target monotonically without overshoot', () => {
    let d = 4;
    const target = 1.2;
    let prev = d;
    for (let i = 0; i < 400; i++) {
      d = easeDist(d, target, 1 / 60);
      expect(d).toBeLessThanOrEqual(prev + 1e-12);
      expect(d).toBeGreaterThanOrEqual(target - 1e-12);
      prev = d;
    }
    expect(d).toBe(target);
    // and outward
    d = 1.2;
    for (let i = 0; i < 400; i++) {
      const n = easeDist(d, 4, 1 / 60);
      expect(n).toBeGreaterThanOrEqual(d - 1e-12);
      expect(n).toBeLessThanOrEqual(4 + 1e-12);
      d = n;
    }
    expect(d).toBe(4);
  });

  it('easing is frame-rate independent', () => {
    let a = 4, b = 4;
    for (let i = 0; i < 30; i++) a = easeDist(a, 2, 1 / 60);
    for (let i = 0; i < 15; i++) b = easeDist(b, 2, 1 / 30);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('rotation speed scales with altitude', () => {
  it('is slower close in than far out, and proportional to altitude', () => {
    const near = degPerPixel(1.1, 38, 900);
    const mid = degPerPixel(2, 38, 900);
    const far = degPerPixel(3.8, 38, 900);
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
    expect(far / mid).toBeCloseTo(2.8, 6);
  });

  it('one screen height of drag at the surface covers the visible span', () => {
    // alt 1 → a screen height spans 2·tan(fov/2) globe radii at the surface
    const deg = degPerPixel(2, 38, 1000) * 1000;
    expect(deg).toBeCloseTo((2 * Math.tan((19 * Math.PI) / 180) * 180) / Math.PI, 5);
  });
});
