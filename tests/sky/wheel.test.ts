import { describe, expect, it } from 'vitest';
import { cardSize, fitShare, readable, semiAxes, wheelPoint, type Wheel } from '../../src/sky/wheel';

/** a plane seen from `elev` degrees above it, 0° Aries to the right: the x axis along the screen's x, the y axis foreshortened */
const seen = (r: number, elev: number): Wheel => ({ ux: r, uy: 0, vx: 0, vy: -r * Math.sin((elev * Math.PI) / 180), zu: 0, zv: Math.cos((elev * Math.PI) / 180) });

describe('the wheel', () => {
  it('has a semi-major axis of its radius and a minor of the foreshortening', () => {
    const { a, b } = semiAxes(seen(100, 30));
    expect(a).toBeCloseTo(100, 6);
    expect(b).toBeCloseTo(50, 6);
  });

  it('hangs 0° Aries on the +x axis and 90° on the foreshortened one', () => {
    const w = seen(100, 90);
    const a = wheelPoint(w, 2, 0);
    const q = wheelPoint(w, 2, 90);
    expect(a.x).toBeCloseTo(200, 6);
    expect(a.y).toBeCloseTo(0, 6);
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(-200, 6);
  });

  it('puts the far half of the wheel at positive depth', () => {
    const w = seen(100, 40);
    expect(wheelPoint(w, 1, 90).depth).toBeGreaterThan(0);
    expect(wheelPoint(w, 1, 270).depth).toBeLessThan(0);
  });

  it('leaves a readable wheel exactly as the camera has it', () => {
    const w = seen(100, 35);
    expect(readable(w)).toBe(w);
  });

  it('opens an edge-on wheel into a tilted ellipse, keeping its width and its handedness', () => {
    const flat = seen(100, 2);
    const r = readable(flat, 0.3, 0.4);
    const { a, b } = semiAxes(r);
    expect(b / a).toBeGreaterThan(0.2);
    expect(a).toBeGreaterThan(90);
    // exactly edge-on is a line, and is opened too
    expect(semiAxes(readable(seen(100, 0))).b).toBeGreaterThan(15);
    // the handedness (which side of the plane faces the camera) is kept
    const hand = (x: Wheel) => Math.sign(x.ux * x.vy - x.uy * x.vx);
    expect(hand(readable(seen(100, 2)))).toBe(hand(seen(100, 2)));
    const mirrored: Wheel = { ...seen(100, 2), vy: -seen(100, 2).vy };
    expect(hand(readable(mirrored))).toBe(hand(mirrored));
  });

  it('fits a ring into the room: whole when it fits, scaled down to keep a card on screen when it does not', () => {
    const w = seen(100, 40);
    const room = { left: 0, right: 1000, top: 0, bottom: 700 };
    expect(fitShare(w, 2, 500, 350, room, 30, 48)).toBe(1);
    const tight = fitShare(w, 6, 200, 350, room, 30, 48);
    expect(tight).toBeLessThan(1);
    // at that share the ring's widest point (plus half a card) stays inside the room
    expect(200 - 6 * tight * 100 - 15).toBeGreaterThanOrEqual(-1e-6);
  });

  it('sizes a card in the plates’ own ratio and never below a touchable height', () => {
    const s = cardSize(10);
    expect(s.h).toBe(40);
    expect(s.w / s.h).toBeCloseTo(0.637, 1);
    expect(cardSize(500).h).toBe(70);
  });
});
