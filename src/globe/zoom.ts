// Pure camera math for the orbit rig: no three.js, no DOM, so it can be tested.
//
// The camera orbits the unit globe at (lat, lon, dist) and always looks at its
// centre with +Y up (north stays up, there is no roll). The rig's job is to keep
// a chosen surface point under a chosen screen point while the distance or the
// look direction changes — the "point under the cursor stays under the cursor"
// feel of a map, for wheel zoom, pinch, double-click zoom and dragging alike.
import { dirFromLatLon, latLonFromDir, type Vec3 } from '../data/geo';

export const MIN_ALT = 0.05; // closest altitude above the surface, in globe radii (~320 km)
export const MIN_DIST = 1 + MIN_ALT;
export const MAX_LAT = 82;

const D2R = Math.PI / 180;

export interface View {
  lat: number;
  lon: number;
  /** distance from the globe's centre (surface = 1) */
  dist: number;
}

export interface Lens {
  fovDeg: number;
  aspect: number;
  /** the rig's off-centre framing, in NDC (see GlobeEngine: projection[8,9] = -shift) */
  shiftX: number;
  shiftY: number;
}

export interface Basis {
  /** unit vector from the globe's centre to the camera */
  c: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** The camera frame for a north-up orbit camera at (lat, lon). */
export function cameraBasis(lat: number, lon: number): Basis {
  const c = dirFromLatLon(lat, lon);
  const fwd: Vec3 = [-c[0], -c[1], -c[2]];
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { c, right, up, fwd };
}

/** World-space ray through a screen point given in NDC (x right, y up). */
export function rayThroughNdc(v: View, lens: Lens, nx: number, ny: number): { o: Vec3; d: Vec3 } {
  const b = cameraBasis(v.lat, v.lon);
  const tanH = Math.tan((lens.fovDeg * D2R) / 2);
  const vx = (nx - lens.shiftX) * tanH * lens.aspect;
  const vy = (ny - lens.shiftY) * tanH;
  const d = norm([
    b.right[0] * vx + b.up[0] * vy + b.fwd[0],
    b.right[1] * vx + b.up[1] * vy + b.fwd[1],
    b.right[2] * vx + b.up[2] * vy + b.fwd[2],
  ]);
  return { o: [b.c[0] * v.dist, b.c[1] * v.dist, b.c[2] * v.dist], d };
}

/** Near-side intersection of a ray with the unit sphere, or null. */
export function raySphere(o: Vec3, d: Vec3): Vec3 | null {
  const b = dot(o, d);
  const c = dot(o, o) - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return null;
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}

/** The surface point under a screen point, or null when it is over empty space. */
export function surfacePointAt(v: View, lens: Lens, nx: number, ny: number): Vec3 | null {
  const r = rayThroughNdc(v, lens, nx, ny);
  return raySphere(r.o, r.d);
}

/** Rotate `p` about the unit `axis` by `angle` (Rodrigues). */
function rotate(p: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, p);
  const kd = dot(axis, p) * (1 - c);
  return [p[0] * c + k[0] * s + axis[0] * kd, p[1] * c + k[1] * s + axis[1] * kd, p[2] * c + k[2] * s + axis[2] * kd];
}

/**
 * Re-aim the camera (distance unchanged) so that surface point `p` appears at
 * (nx, ny). Fixed-point iteration: rotate the camera by the rotation that
 * carries the point now under the cursor onto `p`, re-impose north-up, repeat.
 * Returns the new (lat, lon), or null if the cursor misses the globe.
 */
export function anchorView(v: View, lens: Lens, p: Vec3, nx: number, ny: number, iterations = 10): { lat: number; lon: number } | null {
  let lat = v.lat;
  let lon = v.lon;
  let ok = false;
  for (let i = 0; i < iterations; i++) {
    const hit = surfacePointAt({ lat, lon, dist: v.dist }, lens, nx, ny);
    if (!hit) return ok ? { lat, lon } : null;
    ok = true;
    const ax = cross(hit, p);
    const sin = Math.hypot(ax[0], ax[1], ax[2]);
    const ang = Math.atan2(sin, dot(hit, p));
    if (ang < 1e-9) break;
    const axis: Vec3 = [ax[0] / sin, ax[1] / sin, ax[2] / sin];
    const c = rotate(dirFromLatLon(lat, lon), axis, ang);
    const ll = latLonFromDir(c);
    lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, ll.lat));
    lon = ll.lon;
  }
  return { lat, lon };
}

// ── altitude (zoom) ────────────────────────────────────────────────────────

export function clampDist(dist: number, maxDist: number, minDist = MIN_DIST): number {
  return Math.max(minDist, Math.min(maxDist, dist));
}

/**
 * Exponential zoom: a wheel delta scales the *altitude* (distance above the
 * surface), so every notch feels the same from orbit to street level. Trackpad
 * pinch (ctrl+wheel) uses a larger gain since its deltas are tiny.
 */
export function zoomedDist(dist: number, deltaY: number, pinch: boolean, maxDist: number, minDist = MIN_DIST): number {
  const dy = Math.max(-260, Math.min(260, deltaY));
  const k = pinch ? 0.011 : 0.0021;
  return clampDist(1 + (dist - 1) * Math.exp(dy * k), maxDist, minDist);
}

/** Ease `dist` toward `target` in log-altitude: exponential approach, never overshoots. */
export function easeDist(dist: number, target: number, dt: number, rate = 9): number {
  const a = Math.max(dist - 1, 1e-4);
  const b = Math.max(target - 1, 1e-4);
  const s = 1 - Math.exp(-dt * rate);
  const next = a * Math.pow(b / a, s);
  if (Math.abs(Math.log(b / a)) < 2e-4) return target;
  return 1 + next;
}

/** Degrees of rotation per screen pixel at the sub-camera point; shrinks with altitude. */
export function degPerPixel(dist: number, fovDeg: number, heightPx: number): number {
  const alt = Math.max(dist - 1, 0.02);
  return ((2 * Math.tan((fovDeg * D2R) / 2) * alt) / Math.max(heightPx, 1)) / D2R;
}
