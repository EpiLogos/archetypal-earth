import { describe, expect, it } from 'vitest';
import {
  AU_IN_EARTH_RADII, COMPRESSION, SKY_ENTER, SKY_EXIT, SKY_EXTENT, STAGE_EDGES, compressAu, depthPlanes, skyMaxDist, stageOf,
  stageWeights, surfaceWeight, systemHomeDist, LEGACY_DEPTH_MAX,
} from '../../src/sky/stages';

describe('stages', () => {
  it('are a pure function of distance with the edges the spec names', () => {
    expect(stageOf(5)).toBe('earth');
    expect(stageOf(STAGE_EDGES.lunar)).toBe('lunar');
    expect(stageOf(STAGE_EDGES.handoff)).toBe('handoff');
    expect(stageOf(STAGE_EDGES.system)).toBe('system');
  });

  it('weights are in [0,1] and monotone through the handoff', () => {
    let prev = stageWeights(10).handoff;
    for (let d = 10; d < 12000; d *= 1.15) {
      const w = stageWeights(d);
      for (const v of Object.values(w)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(w.handoff).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = w.handoff;
    }
    expect(stageWeights(100).handoff).toBe(0);
    expect(stageWeights(5000).handoff).toBe(1);
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
});
