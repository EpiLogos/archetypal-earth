import { describe, expect, it } from 'vitest';
import { billboardSpan, frameExtent, RING_SYSTEMS, ringSystemOf } from '../../src/sky/rings';
import { eclipticVector } from '../../src/sky/frames';
import { APPROACH_BODIES } from '../../src/sky/stages';

describe('ring systems', () => {
  it('Saturn carries rings, and no other approach body does', () => {
    expect(ringSystemOf('saturn')).toBeDefined();
    for (const key of APPROACH_BODIES) if (key !== 'saturn') expect(ringSystemOf(key), key).toBeUndefined();
  });

  it('a bare body is framed as its own disc, a ringed one as the planet and its rings, and the billboard reaches past the rings', () => {
    expect(frameExtent('mars')).toBe(1);
    expect(billboardSpan('mars')).toBe(1);
    const s = RING_SYSTEMS.saturn!;
    expect(frameExtent('saturn')).toBe(s.frame);
    // the rings may stand wider than the framed object (the globe is drawn a little smaller than a bare disc), but the
    // archetypes' orbits stand off the held object at 1.95 and up: they clear the ring system
    expect(s.frame * 1.95).toBeGreaterThan(s.outer);
    expect(billboardSpan('saturn')).toBeGreaterThan(s.outer);
  });

  // The ring plane is the planet's equator: 28.05° to the ecliptic, its ascending node at 169.5° (Meeus, ch. 45), which is
  // where the Earth crosses it. The pole's ecliptic longitude is 90° behind the node, its latitude 90° − the inclination.
  it('Saturn\'s pole is the ring plane of the almanac: inclination 28.05° to the ecliptic, node at 169.5°', () => {
    const { pole } = RING_SYSTEMS.saturn!;
    expect(90 - pole.lat).toBeCloseTo(28.08, 1);
    expect(((pole.lon + 90) % 360 + 360) % 360).toBeCloseTo(169.5, 0);
    const n = eclipticVector(pole.lon, pole.lat, 1);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 12);
    // the ring plane meets the ecliptic along the node's direction: the node lies in both planes
    const node = eclipticVector(pole.lon + 90, 0, 1);
    expect(n[0] * node[0] + n[1] * node[1] + n[2] * node[2]).toBeCloseTo(0, 12);
  });

  it('is flattened as Saturn is (0.098), and not as a sphere', () => {
    expect(RING_SYSTEMS.saturn!.oblate).toBeCloseTo(1 - 0.098, 3);
  });
});
