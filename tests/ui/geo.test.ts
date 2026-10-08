import { describe, expect, it } from 'vitest';
import { angleBetween, dirFromLatLon, fitDistance, latLonFromDir, slerp, spreadOf, worldDistance, wrapLon } from '../../src/data/geo';

describe('geo', () => {
  it('round-trips lat/lon', () => {
    for (const [lat, lon] of [[0, 0], [48.4, 1.5], [-33, 151], [64, -21.9], [0, 179]]) {
      const r = latLonFromDir(dirFromLatLon(lat, lon));
      expect(r.lat).toBeCloseTo(lat, 6);
      expect(r.lon).toBeCloseTo(lon, 6);
    }
  });

  it('matches the three.js sphere convention (lon 0 at +x, lon 90E at -z)', () => {
    expect(dirFromLatLon(0, 0)[0]).toBeCloseTo(1);
    expect(dirFromLatLon(0, 90)[2]).toBeCloseTo(-1);
    expect(dirFromLatLon(90, 0)[1]).toBeCloseTo(1);
  });

  it('slerps along the great circle', () => {
    const a = dirFromLatLon(0, 0);
    const b = dirFromLatLon(0, 90);
    const m = slerp(a, b, 0.5);
    expect(latLonFromDir(m).lon).toBeCloseTo(45, 5);
    expect(angleBetween(a, m)).toBeCloseTo(Math.PI / 4, 5);
  });

  it('crosses the dateline the short way', () => {
    const m = slerp(dirFromLatLon(0, 170), dirFromLatLon(0, -170), 0.5);
    expect(Math.abs(latLonFromDir(m).lon)).toBeCloseTo(180, 4);
  });

  it('wraps longitude', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(180)).toBe(180);
  });

  it('frames a distribution: centre and a robust radius', () => {
    const pts = [dirFromLatLon(48, 2), dirFromLatLon(50, 10), dirFromLatLon(45, -2), dirFromLatLon(52, 5), dirFromLatLon(47, 8), dirFromLatLon(49, 4)];
    const s = spreadOf(pts)!;
    expect(s.lat).toBeGreaterThan(45);
    expect(s.lat).toBeLessThan(52);
    expect(s.radius).toBeLessThan(0.15);
    // one far outlier must not blow up the radius
    const many = Array.from({ length: 20 }, (_, i) => dirFromLatLon(48 + (i % 4), 2 + (i % 5)));
    const withOutlier = spreadOf([...many, dirFromLatLon(-35, 150)])!;
    expect(withOutlier.radius).toBeLessThan(0.4);
    expect(spreadOf([])).toBeNull();
  });

  it('chooses a closer camera for a tighter cluster', () => {
    const tight = fitDistance(0.1, 38);
    const wide = fitDistance(0.9, 38);
    expect(tight).toBeLessThan(wide);
    expect(wide).toBeLessThanOrEqual(3.4);
    expect(tight).toBeGreaterThanOrEqual(1.22);
  });

  it('pulls the camera back further on a portrait screen so the world still fits', () => {
    const landscape = worldDistance(1.6, 38);
    const portrait = worldDistance(0.46, 38);
    expect(landscape).toBeGreaterThan(3);
    expect(landscape).toBeLessThan(5);
    expect(portrait).toBeGreaterThan(landscape);
  });
});
