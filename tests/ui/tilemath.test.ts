import { describe, expect, it } from 'vitest';
import { childrenOf, focalPx, latOfY, lonOfX, parentOf, tileKey, tileScreenSize, tileUrl, yOfLat } from '../../src/globe/tilemath';

describe('tile arithmetic', () => {
  it('covers the world edge to edge', () => {
    expect(lonOfX(3, 0)).toBe(-180);
    expect(lonOfX(3, 8)).toBe(180);
    expect(latOfY(0, 0)).toBeCloseTo(85.0511, 3);
    expect(latOfY(0, 1)).toBeCloseTo(-85.0511, 3);
    expect(latOfY(4, 8)).toBeCloseTo(0, 9);
  });

  it('yOfLat inverts latOfY', () => {
    for (const lat of [-80, -33.3, 0, 12.5, 48.85, 80]) {
      expect(latOfY(7, yOfLat(7, lat))).toBeCloseTo(lat, 6);
    }
  });

  it('parents and children agree', () => {
    for (const c of childrenOf(5, 17, 12)) expect(parentOf(c[0], c[1], c[2])).toEqual([5, 17, 12]);
    expect(parentOf(0, 0, 0)).toBeNull();
    // a child tile is half as wide
    const w = lonOfX(5, 18) - lonOfX(5, 17);
    expect(lonOfX(6, 35) - lonOfX(6, 34)).toBeCloseTo(w / 2, 9);
  });

  it('builds the GIBS url with row before column', () => {
    expect(tileUrl(5, 12, 17)).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/5/17/12.jpeg');
    expect(tileKey(5, 12, 17)).toBe('5/12/17');
  });

  it('screen size halves per level, narrows with latitude and shrinks with distance', () => {
    const f = focalPx(38, 900);
    const a = tileScreenSize(6, 0, 1.5, f);
    expect(tileScreenSize(7, 0, 1.5, f)).toBeCloseTo(a / 2, 9);
    expect(tileScreenSize(6, 60, 1.5, f)).toBeCloseTo(a / 2, 9);
    expect(tileScreenSize(6, 0, 3, f)).toBeCloseTo(a / 2, 9);
  });
});
