// The arithmetic of travelling between two skies. When the sky moves to another moment — a birth, or back to the
// clock — the bodies do not jump and do not cut through the Earth: each keeps its distance's blend and sweeps along
// the ecliptic by the shorter arc, from the longitude it had to the longitude it has. Pure maths, no three.js.
import type { Vec3 } from '../data/geo';

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

/** (−180, 180]: an exact half turn goes the positive way, so the choice is the same every time. */
const wrap180 = (d: number) => { const w = ((((d + 180) % 360) + 360) % 360) - 180; return w === -180 ? 180 : w; };

/** `a` toward `b` along the shorter arc, degrees, result in 0..360. */
export function lerpAngle(a: number, b: number, t: number): number {
  return (((a + wrap180(b - a) * t) % 360) + 360) % 360;
}

/** Cubic ease in and out: the start and the arrival are gentle. */
export const easeInOut = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * A vector between two vectors by sweeping its longitude (the shorter way round the ecliptic pole), and blending its
 * latitude and length. At t = 0 it is `a`, at t = 1 it is `b`; a zero vector (the Earth, at the origin) has no
 * direction, so it takes the other's. The path never passes through the origin unless one end is it.
 */
export function blendPose(a: Vec3, b: Vec3, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  if (t <= 0) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; }
  if (t >= 1) { out[0] = b[0]; out[1] = b[1]; out[2] = b[2]; return out; }
  const ra = Math.hypot(a[0], a[1], a[2]);
  const rb = Math.hypot(b[0], b[1], b[2]);
  if (ra < 1e-9 || rb < 1e-9) {
    // an end with no direction: scale the other toward or away from the origin
    const [src, k] = ra < 1e-9 ? [b, t] : [a, 1 - t];
    out[0] = src[0] * k; out[1] = src[1] * k; out[2] = src[2] * k;
    return out;
  }
  const lonA = Math.atan2(a[1], a[0]) * R2D;
  const lonB = Math.atan2(b[1], b[0]) * R2D;
  const latA = Math.asin(Math.max(-1, Math.min(1, a[2] / ra))) * R2D;
  const latB = Math.asin(Math.max(-1, Math.min(1, b[2] / rb))) * R2D;
  const lon = lerpAngle(lonA, lonB, t) * D2R;
  const lat = (latA + (latB - latA) * t) * D2R;
  const r = ra + (rb - ra) * t;
  const c = Math.cos(lat) * r;
  out[0] = c * Math.cos(lon);
  out[1] = c * Math.sin(lon);
  out[2] = Math.sin(lat) * r;
  return out;
}
