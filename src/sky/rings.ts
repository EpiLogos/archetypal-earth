// Ringed bodies: what the sky layer draws round a planet that carries rings, and how the held object is framed. Pure
// data and maths (no three.js, no DOM), so the layer's shader, the camera's framing and the orbits all read one place.
//
// The ring plane is the planet's equator, so its normal is the spin axis: fixed in the sky (it precesses over millennia),
// which is why the rings open and close with the planet's place on its orbit — the layer only needs the axis, the Sun and
// the camera, all of which it already has. Radii are in the globe's equatorial radii.
import type { BodyKey } from '../types/sky';

export interface RingSystem {
  /** the spin axis (the ring plane's normal) in ecliptic coordinates of J2000, degrees */
  pole: { lon: number; lat: number };
  /** polar over equatorial radius: the globe is drawn an oblate spheroid */
  oblate: number;
  /** the outermost ring (F), in equatorial radii: the billboard is drawn to just past it */
  outer: number;
  /**
   * The held object's radius, in globe radii: the planet with its rings, framed as the other bodies' discs are framed.
   * Less than `outer` on purpose: the rings may stand wider than a plain disc does, the globe a little smaller than one,
   * and the archetypes' orbits (which stand at multiples of this) still clear the ring system.
   */
  frame: number;
}

/**
 * Saturn: the IAU pole (RA 40.589°, Dec 83.537°) turned to the J2000 ecliptic gives λ 79.53°, β 61.95° — the ring plane
 * 28.05° to the ecliptic, its node at 169.5°, where the Earth crosses it every 14–15 years. The flattening is 0.098.
 * The ring system runs from the D ring (1.11) to the F ring (2.33), measured on the 60 268 km equatorial radius.
 */
export const RING_SYSTEMS: Partial<Record<BodyKey, RingSystem>> = {
  saturn: { pole: { lon: 79.53, lat: 61.95 }, oblate: 0.902, outer: 2.33, frame: 1.5 },
};

export const ringSystemOf = (key: BodyKey): RingSystem | undefined => RING_SYSTEMS[key];

/** How many globe radii the held object spans: 1 for a bare body, more where rings stand wider than a disc is framed. */
export const frameExtent = (key: BodyKey): number => RING_SYSTEMS[key]?.frame ?? 1;

/** The billboard's half-size in globe radii: the globe alone, or just past the outermost ring. */
export const billboardSpan = (key: BodyKey): number => {
  const r = RING_SYSTEMS[key];
  return r ? r.outer * 1.04 : 1;
};
