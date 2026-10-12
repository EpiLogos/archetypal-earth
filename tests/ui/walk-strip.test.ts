import { describe, expect, it } from 'vitest';
import { scrollTarget } from '../../src/ui/walk-strip';

// The walk strip centres the current frame: the frame's middle over the viewport's middle, clamped to the track.
describe('walk strip scroll target', () => {
  it('centres a frame in the middle of the track', () => {
    // frame at 500 of 52px width in a 400px viewport over a 1000px track: centre at 526 - 200 = 326
    expect(scrollTarget(500, 52, 400, 1000)).toBe(326);
  });

  it('does not scroll before the first frame', () => {
    expect(scrollTarget(0, 52, 400, 1000)).toBe(0);
  });

  it('stops at the end of the track', () => {
    expect(scrollTarget(960, 52, 400, 1000)).toBe(600);
  });

  it('stays at zero when the track fits the viewport', () => {
    expect(scrollTarget(100, 52, 400, 300)).toBe(0);
  });
});
