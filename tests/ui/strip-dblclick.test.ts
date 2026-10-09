import { describe, expect, it } from 'vitest';
import { holdRemaining, TAP_HOLD_MS } from '../../src/ui/strip';

// The thumbnail double-click guard (audit W1): a tap holds the rail still for the double-click window,
// so the second tap of a double-click lands on the step the first one jumped to (the rail used to re-centre
// between the taps and land on i=9 for i=5).
describe('strip tap hold', () => {
  it('holds for the platform double-click interval', () => {
    expect(TAP_HOLD_MS).toBe(500);
  });

  it('does not hold before any tap', () => {
    expect(holdRemaining(null, 12345)).toBe(0);
  });

  it('holds the whole window straight after a tap, and counts it down', () => {
    expect(holdRemaining(1000, 1000)).toBe(500);
    expect(holdRemaining(1000, 1200)).toBe(300);
    expect(holdRemaining(1000, 1499)).toBe(1);
  });

  it('releases exactly when the window has passed, and stays released', () => {
    expect(holdRemaining(1000, 1500)).toBe(0);
    expect(holdRemaining(1000, 2600)).toBe(0);
  });

  it('a later tap restarts the window', () => {
    const second = 1000 + 450;
    expect(holdRemaining(second, 1000 + 480)).toBe(470);
  });

  it('a clock that reads earlier than the tap holds for the full window, never more', () => {
    expect(holdRemaining(1000, 900)).toBe(500);
  });

  it('takes an explicit window', () => {
    expect(holdRemaining(0, 100, 250)).toBe(150);
    expect(holdRemaining(0, 250, 250)).toBe(0);
  });
});
