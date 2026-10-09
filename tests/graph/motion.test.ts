import { describe, expect, it } from 'vitest';
import { clampZoom, frameSeconds, isCamera, isDoubleClick } from '../../src/graph/motion';

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
