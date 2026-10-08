import { describe, expect, it } from 'vitest';
import { averagePalettes, clonePalette, easeInOutCubic, hexToRgb, mixPalette, rgbToHex, toRgbPalette, WORLD_PALETTE } from '../../src/data/palette';

describe('palette interpolation', () => {
  it('round-trips hex', () => {
    expect(rgbToHex(hexToRgb('#4f78cf'))).toBe('#4f78cf');
    expect(rgbToHex(hexToRgb('#abc'))).toBe('#aabbcc');
  });

  const a = toRgbPalette({ core: '#000000', glow: '#000000', fog: '#000000', deep: '#000000' }, 0);
  const b = toRgbPalette({ core: '#ffffff', glow: '#ff0000', fog: '#00ff00', deep: '#0000ff' }, 1);

  it('hits both ends and blends the midpoint, including the spectrum', () => {
    const out = clonePalette(a);
    mixPalette(a, b, 0, out);
    expect(rgbToHex(out.core)).toBe('#000000');
    mixPalette(a, b, 1, out);
    expect(rgbToHex(out.fog)).toBe('#00ff00');
    mixPalette(a, b, 0.5, out);
    expect(out.core[0]).toBeCloseTo(0.5);
    expect(out.spectrum).toBeCloseTo(0.5);
  });

  it('does not mutate its inputs', () => {
    const out = clonePalette(a);
    mixPalette(a, b, 0.7, out);
    expect(a.core).toEqual([0, 0, 0]);
    expect(b.core).toEqual([1, 1, 1]);
  });

  it('eases monotonically from 0 to 1', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    let prev = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('averages weighted palettes', () => {
    const avg = averagePalettes([{ p: a, w: 1 }, { p: b, w: 3 }])!;
    expect(avg.core[0]).toBeCloseTo(0.75);
    expect(averagePalettes([])).toBeNull();
    expect(WORLD_PALETTE.deep[2]).toBeLessThan(0.1);
  });
});
