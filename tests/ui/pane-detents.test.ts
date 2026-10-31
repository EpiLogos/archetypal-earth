import { describe, expect, it } from 'vitest';
import { DETENT_SHARE, nextDetent, openDetent, settleDetent } from '../../src/ui/pane';

describe("the phone sheet's detents", () => {
  it('opens a reading full and the Contents list half', () => {
    expect(openDetent('reading')).toBe('full');
    expect(openDetent('wide')).toBe('full');
    expect(openDetent('contents')).toBe('half');
  });
  it('steps up on a tap, and from the top back to half', () => {
    expect(nextDetent('peek')).toBe('half');
    expect(nextDetent('half')).toBe('full');
    expect(nextDetent('full')).toBe('half');
  });
  it('rests at three heights in order', () => {
    expect(DETENT_SHARE.peek).toBeLessThan(DETENT_SHARE.half);
    expect(DETENT_SHARE.half).toBeLessThan(DETENT_SHARE.full);
  });
  it('lets a drag go to the nearest height', () => {
    expect(settleDetent(0.3)).toBe('peek');
    expect(settleDetent(0.45)).toBe('half');
    expect(settleDetent(0.8)).toBe('full');
  });
  it('carries a flick on: a quick upward let-go from half lands full, a downward one lands peek', () => {
    expect(settleDetent(0.55, 2)).toBe('full');
    expect(settleDetent(0.5, -2)).toBe('peek');
  });
});
