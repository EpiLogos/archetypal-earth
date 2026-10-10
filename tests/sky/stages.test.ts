import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AU_IN_EARTH_RADII, APPROACH_BODIES, APPROACH_FILL, COMPRESSION, EARTH_RADIUS_KM, SKY_ENTER, SKY_EXIT, SKY_EXTENT, SKY_OVERSHOOT, STAGE_EDGES, approachDist,
  compressAu, depthPlanes, handoffFocusWeight, isApproachBody, skyMaxDist, stageDistance, stageOf, stageWeights, surfaceWeight, systemHomeDist, LEGACY_DEPTH_MAX,
} from '../../src/sky/stages';

/** Every body's true radius, as the generator wrote it (public/data/sky.json). */
const BODIES = (JSON.parse(readFileSync(new URL('../../public/data/sky.json', import.meta.url), 'utf8')) as {
  bodies: { key: string; radiusKm: number }[];
}).bodies;

describe('stages', () => {
  it('are a pure function of distance with the edges the spec names', () => {
    expect(stageOf(5)).toBe('earth');
    expect(stageOf(STAGE_EDGES.lunar)).toBe('lunar');
    expect(stageOf(STAGE_EDGES.handoff)).toBe('handoff');
    expect(stageOf(STAGE_EDGES.system)).toBe('system');
  });

  it('weights are in [0,1] and monotone through the handoff', () => {
    let prev = stageWeights(10).handoff;
    let prevFocus = stageWeights(10).focus;
    for (let d = 10; d < 12000; d *= 1.15) {
      const w = stageWeights(d);
      for (const v of Object.values(w)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(w.handoff).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(w.focus).toBeGreaterThanOrEqual(prevFocus - 1e-12);
      prev = w.handoff;
      prevFocus = w.focus;
    }
    expect(stageWeights(100).handoff).toBe(0);
    expect(stageWeights(5000).handoff).toBe(1);
  });

  it('the look-at\'s share of the Sun is 0 across the Earth and lunar stages, and 1 once the Sun is the subject', () => {
    for (const d of [1.05, 6, 40, 300, 600]) expect(stageWeights(d).focus).toBe(0);
    expect(stageWeights(3000).focus).toBe(1);
    expect(stageWeights(5000).focus).toBe(1);
    expect(handoffFocusWeight(900)).toBeGreaterThan(0);
    expect(handoffFocusWeight(900)).toBeLessThan(1);
  });

  it('entry and exit thresholds have hysteresis, so a hovering wheel cannot flicker the sky', () => {
    expect(SKY_EXIT).toBeLessThan(SKY_ENTER);
  });

  it('inside the Earth stage the depth planes are exactly the atlas\'s own expressions', () => {
    for (const d of [1.06, 1.5, 2.4, 3.1, 5.4, LEGACY_DEPTH_MAX]) {
      const legacy = { near: Math.max(0.003, (d - 1) * 0.28), far: d + 3.2 };
      expect(depthPlanes(d, true)).toEqual(legacy);
      expect(depthPlanes(d, false)).toEqual(legacy);
    }
  });

  it('the far plane holds the whole sky once the Earth is a point', () => {
    expect(depthPlanes(9000, true).far).toBeGreaterThan(9000 + SKY_EXTENT);
  });

  it('the surface layers are fully on over the Earth stage and fully off before the handoff', () => {
    expect(surfaceWeight(5.4)).toBe(1);
    expect(surfaceWeight(6)).toBe(1);
    expect(surfaceWeight(36)).toBe(0);
    expect(surfaceWeight(200)).toBe(0);
  });

  it('radial compression is monotone, states its factor, and keeps Neptune inside the extent', () => {
    expect(compressAu(1)).toBeCloseTo(COMPRESSION.K, 9);
    expect(compressAu(30.1)).toBeLessThan(SKY_EXTENT);
    expect(compressAu(31)).toBeGreaterThan(compressAu(30));
    expect(AU_IN_EARTH_RADII).toBeCloseTo(23481, -1);
  });

  it('the system home frames the whole extent for narrow and wide viewports', () => {
    for (const aspect of [0.5, 1, 1.6, 2.4]) {
      expect(systemHomeDist(aspect, 45)).toBeGreaterThanOrEqual(9000);
      expect(skyMaxDist(aspect, 45)).toBeGreaterThan(systemHomeDist(aspect, 45));
    }
  });

  it('pins the pull-back\'s overshoot past the system home at 1.35× (it was 2.2×: a dead zone, audit S3 (c))', () => {
    // 1.35 leaves room to read the system's extent past its own framing; 2.2 left ~1.2 home-distances of nothing to see.
    expect(SKY_OVERSHOOT).toBe(1.35);
    for (const aspect of [0.46, 1, 1.6, 2.2]) {
      expect(skyMaxDist(aspect, 38)).toBeCloseTo(systemHomeDist(aspect, 38) * 1.35, 9);
    }
  });
});

const FOV = 38;
const radiusOf = (key: string) => BODIES.find((b) => b.key === key)!.radiusKm;

describe('the approach to a body', () => {
  it('the Sun and the planets approach; Earth and the Moon keep their own framing', () => {
    expect([...APPROACH_BODIES].sort()).toEqual(['jupiter', 'mars', 'mercury', 'neptune', 'pluto', 'saturn', 'sun', 'uranus', 'venus']);
    expect(isApproachBody('earth')).toBe(false);
    expect(isApproachBody('moon')).toBe(false);
  });

  it('is finite and monotone in the radius for every body in the data, on any viewport', () => {
    const sorted = [...BODIES].sort((a, b) => a.radiusKm - b.radiusKm);
    for (const aspect of [0.46, 1, 1.6, 2.4]) {
      for (const fov of [38, 60, 90]) {
        let prev = 0;
        for (const b of sorted) {
          const d = approachDist(b.radiusKm, fov, aspect);
          expect(Number.isFinite(d)).toBe(true);
          expect(d).toBeGreaterThanOrEqual(prev - 1e-12);
          prev = d;
        }
      }
    }
  });

  it('places the disc at the fill of the viewport height: the silhouette\'s half-angle has tan α = fill·tan(fov/2)', () => {
    const t = Math.tan((FOV * Math.PI) / 360);
    for (const key of APPROACH_BODIES) {
      const d = approachDist(radiusOf(key), FOV, 1.6);
      const trueRad = radiusOf(key) / EARTH_RADIUS_KM;
      const fraction = Math.tan(Math.asin(trueRad / d)) / t;
      expect(fraction).toBeCloseTo(APPROACH_FILL, 9);
    }
  });

  it('gives sensible distances for the Sun (huge) and Mercury (tiny), and clears the sphere of the camera', () => {
    const sun = approachDist(radiusOf('sun'), FOV, 1.6);
    const mercury = approachDist(radiusOf('mercury'), FOV, 1.6);
    expect(sun).toBeGreaterThan(900);
    expect(sun).toBeLessThan(1300);
    expect(mercury).toBeGreaterThan(3);
    expect(mercury).toBeLessThan(5);
    // a wide field: the fill alone would put the camera inside the sphere's clearance, the 2.6-radius floor holds
    const wideD = approachDist(radiusOf('mars'), 120, 1.6);
    expect(wideD).toBeGreaterThanOrEqual(2.6 * (radiusOf('mars') / EARTH_RADIUS_KM) - 1e-12);
  });

  it('on a narrow viewport the disc keeps within the width as well (less than the height fill)', () => {
    const wide = approachDist(radiusOf('mars'), FOV, 1.6);
    const narrow = approachDist(radiusOf('mars'), FOV, 0.46);
    expect(narrow).toBeGreaterThan(wide);
  });
});

describe('the stage distance while a body is approached', () => {
  it('is exactly the rig distance while no body is approached, so every existing view is unchanged', () => {
    for (let d = 1.05; d <= 40; d *= 1.03) {
      for (const c of [0.5, 1.2, 40, 900, 3000, 9000]) expect(stageDistance(d, c, 0)).toBe(d);
    }
    for (const d of [60, 600, 2000, 9000, 20000]) expect(stageDistance(d, 1.23, 0)).toBe(d);
  });

  it('blends in log space from the rig distance to the system edge, monotone in the approach', () => {
    let prev = 5;
    for (let a = 0; a <= 1 + 1e-9; a += 0.05) {
      const s = stageDistance(5, 1500, a);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s;
    }
    expect(stageDistance(5, 1500, 1)).toBeCloseTo(STAGE_EDGES.system, 6);
  });

  it('floors at the system edge, and never reads closer than the rig distance', () => {
    expect(stageDistance(5, 1500, 1)).toBeCloseTo(STAGE_EDGES.system, 6);
    expect(stageDistance(5, 4200, 1)).toBeCloseTo(4200, 6);
    expect(stageDistance(9000, 100, 1)).toBeCloseTo(9000, 6);
    expect(stageDistance(5, 1500, 2)).toBeCloseTo(STAGE_EDGES.system, 6);
    expect(stageDistance(5, 1500, -1)).toBe(5);
  });

  it('reads the system stage at full approach, for a close planet and for the Sun', () => {
    for (const d of [1.5, 6, 300]) for (const c of [0, 900, 1500]) expect(stageOf(stageDistance(d, c, 1))).toBe('system');
  });
});

describe('the near plane while a body is approached', () => {
  it('follows the focus when approached, never farther than the atlas\'s own, and is the atlas\'s own at approach 0', () => {
    for (const d of [1500, 3000, 6000]) {
      const own = depthPlanes(d, true);
      expect(depthPlanes(d, true, 3.7, 0)).toEqual(own);
      const near = depthPlanes(d, true, 3.7, 1);
      expect(near.near).toBeLessThanOrEqual(own.near);
      expect(near.near).toBeCloseTo(Math.max(0.003, (3.7 - 1) * 0.28), 12);
      expect(near.far).toBe(own.far);
    }
  });

  it('clears a body drawn at its approach distance, for the Sun and every planet', () => {
    for (const key of APPROACH_BODIES) {
      const d = approachDist(radiusOf(key), FOV, 1.6);
      const { near } = depthPlanes(1500, true, d, 1);
      expect(near).toBeLessThan(d * 0.5);
    }
  });
});
