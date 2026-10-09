import { describe, expect, it } from 'vitest';
import { clampZoom, Coast, COAST_HALF_LIFE, COAST_MAX_SPEED, COAST_MIN_SPEED, frameSeconds, isCamera, isDoubleClick } from '../../src/graph/motion';

// B1: a frame stamped before the view woke used to advance the camera by a negative step (and blow k up).
describe('the camera clock', () => {
  it('never advances a frame backwards, and never by more than 60 ms', () => {
    expect(frameSeconds(-3000)).toBe(0.001);
    expect(frameSeconds(0)).toBe(0.001);
    expect(frameSeconds(16)).toBeCloseTo(0.016, 6);
    expect(frameSeconds(1000)).toBe(0.06);
  });

  it('falls back to a 60 fps frame when the time is not a number', () => {
    expect(frameSeconds(Number.NaN)).toBe(0.016);
    expect(frameSeconds(Number.POSITIVE_INFINITY)).toBe(0.016);
  });

  it('keeps the zoom inside the extent and refuses a camera that is not finite', () => {
    expect(clampZoom(0.01)).toBe(0.1);
    expect(clampZoom(50)).toBe(9);
    expect(clampZoom(2)).toBe(2);
    expect(isCamera(1, 2, 1)).toBe(true);
    expect(isCamera(Number.NaN, 0, 1)).toBe(false);
    expect(isCamera(0, Number.POSITIVE_INFINITY, 1)).toBe(false);
    expect(isCamera(0, 0, 0)).toBe(false);
    expect(isCamera(0, 0, Number.NaN)).toBe(false);
  });
});

// B3: the second click of a double-click is recognised by where and when, not by what lies under the pointer.
describe('double-click', () => {
  const at = (x: number, y: number, t: number) => ({ x, y, t });
  it('is two clicks within 12 px and 450 ms', () => {
    expect(isDoubleClick(at(100, 100, 0), at(103, 100, 250))).toBe(true);
    expect(isDoubleClick(at(100, 100, 0), at(112, 100, 450))).toBe(true);
  });
  it('is not a click that came late or landed elsewhere', () => {
    expect(isDoubleClick(at(100, 100, 0), at(100, 100, 500))).toBe(false);
    expect(isDoubleClick(at(100, 100, 0), at(113, 100, 100))).toBe(false);
    expect(isDoubleClick(at(100, 100, 300), at(100, 100, 100))).toBe(false);
  });
});

// B10: the pan carries on after the pointer lets go, decaying; it never coasts for a stopped pointer or under reduced motion.
// A pointer moving at `px` per 16 ms, sampled to the release at time `end`.
const flick = (c: Coast, px: number, end: number, n = 5) => {
  for (let i = 0; i <= n; i++) c.record(px, 0, end - (n - i) * 16);
};
describe('pan inertia', () => {
  it('starts from a fast pan, and only from one that is still moving at release', () => {
    const c = new Coast();
    flick(c, 12, 1000); // 750 px/s
    expect(c.release(1000)).toBe(true);
    expect(c.moving).toBe(true);
    expect(c.vx).toBeGreaterThan(COAST_MIN_SPEED);
    expect(c.vx).toBeCloseTo(750, 6);
  });

  it('is zero for stale samples: a pointer that stopped before the release does not coast', () => {
    const c = new Coast();
    flick(c, 16, 1000);
    expect(c.release(1000 + 150)).toBe(false);
    expect(c.moving).toBe(false);
    expect(c.vx).toBe(0);
    expect(c.vy).toBe(0);
  });

  it('does not coast for a slow settle below the speed threshold', () => {
    const c = new Coast();
    flick(c, 1, 1000); // about 60 px/s
    expect(c.release(1000)).toBe(false);
    expect(c.moving).toBe(false);
  });

  it('caps a violent flick, so the field cannot leave the screen in a second', () => {
    const c = new Coast();
    flick(c, 80, 1000); // 5000 px/s
    expect(c.release(1000)).toBe(true);
    expect(Math.hypot(c.vx, c.vy)).toBeCloseTo(COAST_MAX_SPEED, 6);
  });

  it('decays monotonically, halving over the half-life, and displaces by the integral of its speed', () => {
    const c = new Coast();
    flick(c, 16, 1000);
    c.release(1000);
    const v0 = c.vx;
    const dt = 1 / 60;
    let last = Infinity;
    let total = 0;
    let frames = 0;
    while (c.moving && frames < 2000) {
      const before = Math.hypot(c.vx, c.vy);
      const d = c.step(dt);
      expect(Math.hypot(c.vx, c.vy)).toBeLessThan(before + 1e-12);
      expect(Math.hypot(d.dx, d.dy)).toBeLessThanOrEqual(last + 1e-9);
      last = Math.hypot(d.dx, d.dy);
      total += d.dx;
      frames++;
    }
    // the coast's total distance is v0 * h / ln 2, however the frames fall; it ends short by what it would still move below the stop speed
    const ideal = (v0 * COAST_HALF_LIFE) / Math.LN2;
    expect(total).toBeLessThanOrEqual(ideal + 1e-6);
    expect(ideal - total).toBeLessThan(3 * COAST_HALF_LIFE / Math.LN2 + 1e-6);
    expect(frames).toBeLessThan(2000);
  });

  it('halves its speed over one half-life, whatever the step', () => {
    const c = new Coast();
    flick(c, 16, 1000);
    c.release(1000);
    const v0 = c.vx;
    c.step(COAST_HALF_LIFE / 2);
    c.step(COAST_HALF_LIFE / 2);
    expect(c.vx).toBeCloseTo(v0 / 2, 6);
  });

  it('stops once a 60 fps frame would move less than 0.05 px', () => {
    const c = new Coast();
    flick(c, 16, 1000);
    c.release(1000);
    for (let i = 0; i < 2000 && c.moving; i++) c.step(1 / 60);
    expect(c.moving).toBe(false);
    expect(c.vx).toBe(0);
  });

  it('never coasts under reduced motion, and records nothing to coast with', () => {
    const c = new Coast(true);
    flick(c, 40, 1000);
    expect(c.release(1000)).toBe(false);
    expect(c.moving).toBe(false);
  });

  it('is cancelled at once by stop(), and ignores a non-finite delta or time', () => {
    const c = new Coast();
    flick(c, 16, 1000);
    c.release(1000);
    c.stop();
    expect(c.moving).toBe(false);
    c.record(Number.NaN, 4, 1000);
    c.record(4, 4, Number.POSITIVE_INFINITY);
    expect(c.release(1000)).toBe(false);
    const d = new Coast();
    d.vx = 500;
    expect(d.step(Number.NaN)).toEqual({ dx: 0, dy: 0 });
    expect(d.step(-1)).toEqual({ dx: 0, dy: 0 });
  });
});
