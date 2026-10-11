import { describe, expect, it } from 'vitest';
import { composeLook, composeStation, projectNdc, type Frame } from '../../src/sky/compose';
import { ndcOf } from '../../src/sky/stages';
import type { Vec3 } from '../../src/data/geo';

const DESK: Frame = { fovDeg: 45, aspect: 1.6, shiftX: 0, shiftY: 0, margin: 0.78 };
const PHONE: Frame = { ...DESK, aspect: 0.5 };
const rad = (d: number) => (d * Math.PI) / 180;
const dist3 = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** The planet at 900 R⊕ from the Earth, the Earth at the origin: the scene of the spec's cases. */
const EARTH: Vec3 = [0, 0, 0];
const PLANET: Vec3 = [900, 0, 0];
const PLANET_R = 11;
const EARTH_R = 1;

const pair = (cam: Vec3, frame: Frame) => ({ cam, a: PLANET, aRadius: PLANET_R, b: EARTH, bRadius: EARTH_R, frame });
/** Station about the planet (the gaze) or about the Earth (the return); `center` is one of the two bodies. */
const station = (center: Vec3, dist: number, currentDir: Vec3, frame: Frame) => ({
  a: PLANET, aRadius: PLANET_R, b: EARTH, bRadius: EARTH_R, frame, center, dist, currentDir,
});
const unitOf = (p: Vec3): Vec3 => { const l = dist3(p, [0, 0, 0]); return [p[0] / l, p[1] / l, p[2] / l]; };

describe('composeLook', () => {
  it('turns to frame a planet and the Earth from the anti-Earth side without occluding them', () => {
    const cam: Vec3 = [PLANET[0] + 40 * Math.cos(rad(20)), 40 * Math.sin(rad(20)), 0];
    const r = composeLook(pair(cam, DESK));
    expect(r.ok).toBe(true);
    expect(r.occluded).toBe(false);
    expect(Math.abs(r.ndcA.x)).toBeLessThan(0.78);
    expect(Math.abs(r.ndcA.y)).toBeLessThan(0.78);
    expect(Math.abs(r.ndcB.x)).toBeLessThan(0.78);
    expect(Math.abs(r.ndcB.y)).toBeLessThan(0.78);
    // the look point is on the segment planet→Earth, and the view runs along the bisector of the two directions
    expect(r.look[1]).toBeCloseTo(0, 9);
    expect(r.look[0]).toBeGreaterThan(0);
    expect(r.look[0]).toBeLessThan(PLANET[0]);
  });

  it('is occluded when the camera sits exactly behind the planet on the Earth line', () => {
    const r = composeLook(pair([940, 0, 0], DESK));
    expect(r.occluded).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.sepDeg).toBeCloseTo(0, 6);
  });

  it('is never framed from between the two bodies, where one lies behind the lens', () => {
    const r = composeLook(pair([380.4, 0, 0], DESK));
    expect(r.sepDeg).toBeCloseTo(180, 6);
    expect(r.behind).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('is not framed when a 120° pair is held by turning alone', () => {
    const h = 450 / Math.tan(rad(60));
    const r = composeLook(pair([450, h, 0], DESK));
    expect(r.sepDeg).toBeCloseTo(120, 6);
    expect(r.occluded).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe('composeStation', () => {
  it('swings a camera behind the planet to a clear station, by a small angle', () => {
    const s = composeStation(station(PLANET, 40, [1, 0, 0], DESK));
    expect(s.ok).toBe(true);
    expect(s.swingDeg).toBeGreaterThan(0);
    expect(s.swingDeg).toBeLessThan(60);
    const cam = [PLANET[0] + 40 * s.dir[0], PLANET[1] + 40 * s.dir[1], PLANET[2] + 40 * s.dir[2]] as Vec3;
    expect(composeLook(pair(cam, DESK)).ok).toBe(true);
  });

  it('swings a 120° pair in to a framed station, keeping the distance to the centre', () => {
    const h = 450 / Math.tan(rad(60));
    const cam: Vec3 = [450, h, 0];
    const dist = dist3(cam, PLANET);
    const s = composeStation(station(PLANET, dist, unitOf([cam[0] - PLANET[0], cam[1] - PLANET[1], cam[2] - PLANET[2]]), DESK));
    expect(s.ok).toBe(true);
    expect(s.swingDeg).toBeGreaterThan(0);
    const moved: Vec3 = [PLANET[0] + dist * s.dir[0], PLANET[1] + dist * s.dir[1], PLANET[2] + dist * s.dir[2]];
    expect(dist3(moved, PLANET)).toBeCloseTo(dist, 6);
    expect(composeLook(pair(moved, DESK)).ok).toBe(true);
  });

  it('returns a unit direction at exactly the given distance from its centre', () => {
    const cases = [
      station(PLANET, 40, [1, 0, 0], DESK),
      station(PLANET, 519.6, unitOf([-450, 259.8, 0]), DESK),
      station(EARTH, 510, [-1, 0, 0], DESK),
    ];
    for (const c of cases) {
      const s = composeStation(c);
      expect(Math.hypot(s.dir[0], s.dir[1], s.dir[2])).toBeCloseTo(1, 9);
      const cam: Vec3 = [c.center[0] + c.dist * s.dir[0], c.center[1] + c.dist * s.dir[1], c.center[2] + c.dist * s.dir[2]];
      expect(dist3(cam, c.center)).toBeCloseTo(c.dist, 6);
    }
  });

  it('keeps a camera that already frames the pair where it is (swing 0)', () => {
    const cam: Vec3 = [PLANET[0] + 40 * Math.cos(rad(20)), 40 * Math.sin(rad(20)), 0];
    const dir = unitOf([cam[0] - PLANET[0], cam[1] - PLANET[1], cam[2] - PLANET[2]]);
    const s = composeStation(station(PLANET, 40, dir, DESK));
    expect(s.ok).toBe(true);
    expect(s.swingDeg).toBe(0);
    expect(s.dir[0]).toBeCloseTo(dir[0], 12);
    expect(s.dir[1]).toBeCloseTo(dir[1], 12);
    expect(s.dir[2]).toBeCloseTo(dir[2], 12);
  });

  it('centred on the Earth (the return), it finds a framed station behind the Earth', () => {
    const s = composeStation(station(EARTH, 510, [-1, 0, 0], DESK));
    expect(s.ok).toBe(true);
    const cam: Vec3 = [510 * s.dir[0], 510 * s.dir[1], 510 * s.dir[2]];
    expect(composeLook(pair(cam, DESK)).ok).toBe(true);
  });

  it('a narrow phone frame is still satisfiable, and needs at least the desktop swing', () => {
    const desk = composeStation(station(PLANET, 40, [1, 0, 0], DESK));
    const phone = composeStation(station(PLANET, 40, [1, 0, 0], PHONE));
    expect(phone.ok).toBe(true);
    expect(phone.swingDeg).toBeGreaterThanOrEqual(desk.swingDeg);

    const h = 450 / Math.tan(rad(60));
    const wide = composeStation(station(PLANET, 519.6, unitOf([-450, h, 0]), PHONE));
    expect(wide.ok).toBe(true);
    expect(wide.swingDeg).toBeGreaterThanOrEqual(composeStation(station(PLANET, 519.6, unitOf([-450, h, 0]), DESK)).swingDeg);
  });
});

describe('projectNdc', () => {
  it('shifts the projection by exactly the rig\'s principal-point shift', () => {
    const cam: Vec3 = [0, 0, 10];
    const look: Vec3 = [0, 0, 0];
    const p: Vec3 = [1, 2, 0];
    const base = projectNdc(cam, look, [0, 1, 0], p, DESK);
    const shifted = projectNdc(cam, look, [0, 1, 0], p, { ...DESK, shiftX: -0.22 });
    expect(shifted.x - base.x).toBeCloseTo(-0.22, 12);
    expect(shifted.y - base.y).toBeCloseTo(0, 12);
    expect(shifted.depth).toBeCloseTo(base.depth, 12);
    const both = projectNdc(cam, look, [0, 1, 0], p, { ...DESK, shiftX: 0.1, shiftY: -0.3 });
    expect(both.x - base.x).toBeCloseTo(0.1, 12);
    expect(both.y - base.y).toBeCloseTo(-0.3, 12);
  });

  it('carries the shift into composeLook\'s NDC without moving the look point', () => {
    const cam: Vec3 = [940, 40, 0];
    const plain = composeLook(pair(cam, DESK));
    const shifted = composeLook(pair(cam, { ...DESK, shiftX: -0.22 }));
    expect(shifted.look).toEqual(plain.look);
    expect(shifted.ndcA.x - plain.ndcA.x).toBeCloseTo(-0.22, 12);
    expect(shifted.ndcB.x - plain.ndcB.x).toBeCloseTo(-0.22, 12);
  });

  it('agrees with stages.ndcOf, the camera basis the existing pair framing uses', () => {
    const focus: Vec3 = [1, 2, 3];
    const camDir = unitOf([0.3, 0.5, 0.8]);
    const dist = 5;
    const point: Vec3 = [4, -1, 2];
    const frame: Frame = { fovDeg: 40, aspect: 1.3, shiftX: 0, shiftY: 0, margin: 0.78 };
    const cam: Vec3 = [focus[0] + dist * camDir[0], focus[1] + dist * camDir[1], focus[2] + dist * camDir[2]];
    const mine = projectNdc(cam, focus, [0, 1, 0], point, frame);
    const theirs = ndcOf(point, focus, camDir, dist, 1.3, 40);
    expect(mine.x).toBeCloseTo(theirs.x, 9);
    expect(mine.y).toBeCloseTo(theirs.y, 9);
    expect(mine.depth).toBeCloseTo(theirs.depth, 9);
  });
});
