// Spherical helpers. Convention matches three.js SphereGeometry's equirect uv:
// lon 0 faces +X, lon 90E faces -Z, +Y is north. Pure (no three import).

export type Vec3 = [number, number, number];
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function dirFromLatLon(lat: number, lon: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const la = lat * D2R;
  const lo = lon * D2R;
  const c = Math.cos(la);
  out[0] = c * Math.cos(lo);
  out[1] = Math.sin(la);
  out[2] = -c * Math.sin(lo);
  return out;
}

export function latLonFromDir(d: Vec3): { lat: number; lon: number } {
  const y = Math.max(-1, Math.min(1, d[1]));
  return { lat: Math.asin(y) * R2D, lon: Math.atan2(-d[2], d[0]) * R2D };
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize(v: Vec3, out: Vec3 = v): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  out[0] = v[0] / l;
  out[1] = v[1] / l;
  out[2] = v[2] / l;
  return out;
}

/** Great-circle angle in radians between two unit vectors. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

export function slerp(a: Vec3, b: Vec3, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const w = angleBetween(a, b);
  if (w < 1e-5) {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
    return out;
  }
  const s = Math.sin(w);
  const k0 = Math.sin((1 - t) * w) / s;
  const k1 = Math.sin(t * w) / s;
  out[0] = a[0] * k0 + b[0] * k1;
  out[1] = a[1] * k0 + b[1] * k1;
  out[2] = a[2] * k0 + b[2] * k1;
  return out;
}

/** Wrap degrees into (-180, 180]. */
export function wrapLon(lon: number): number {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  if (l === -180) l = 180;
  return l;
}

export interface Spread {
  lat: number;
  lon: number;
  /** angular radius (radians) that covers the bulk of the points */
  radius: number;
}

/**
 * Where to look to see a set of points: mean direction + a robust angular
 * radius (≈ 88th percentile of angular distance, so outliers don't zoom the
 * whole earth out). Returns null for an empty set.
 */
export function spreadOf(dirs: Vec3[]): Spread | null {
  if (!dirs.length) return null;
  const m: Vec3 = [0, 0, 0];
  for (const d of dirs) { m[0] += d[0]; m[1] += d[1]; m[2] += d[2]; }
  const len = Math.hypot(m[0], m[1], m[2]);
  let centre: Vec3;
  if (len < 1e-3 * dirs.length) {
    centre = dirs[0]; // antipodal cancellation: fall back to the first point
  } else {
    centre = normalize(m, [0, 0, 0]);
  }
  const angs = dirs.map((d) => angleBetween(centre, d)).sort((a, b) => a - b);
  const idx = dirs.length <= 5 ? angs.length - 1 : Math.min(angs.length - 1, Math.floor(angs.length * 0.88));
  const { lat, lon } = latLonFromDir(centre);
  return { lat, lon, radius: angs[idx] };
}

/**
 * Camera distance (globe radius = 1) at which a spherical cap of angular
 * radius `theta` fills `fill` (0..1) of the half-viewport for vertical fov.
 */
export function fitDistance(theta: number, fovDeg: number, fill = 0.62, minD = 1.22, maxD = 3.4): number {
  const t = Math.tan((fovDeg * D2R) / 2);
  const th = Math.min(theta, 1.45);
  const d = Math.cos(th) + Math.sin(th) / (fill * t);
  return Math.min(maxD, Math.max(minD, d));
}

/**
 * Camera distance at which the whole globe sits comfortably in the viewport:
 * ≈ `fillV` of the height and ≈ `fillH` of the width, whichever binds.
 */
export function worldDistance(aspect: number, fovDeg: number, fillV = 0.8, fillH = 0.9): number {
  const tv = Math.tan((fovDeg * D2R) / 2);
  const th = tv * Math.max(aspect, 0.1);
  const need = (t: number, fill: number) => Math.sqrt(1 + 1 / Math.pow(fill * t, 2));
  return Math.max(need(tv, fillV), need(th, fillH));
}
