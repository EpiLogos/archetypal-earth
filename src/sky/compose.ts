// The sky camera's framer: where to look, and where to stand, so that a planet and the Earth both sit inside the frame.
// Pure maths on Vec3 tuples, no three.js, tested like stages.ts. The lens is a pinhole with vertical field `fovDeg`, +Y up
// and no roll; `shiftX`/`shiftY` offset the projection in NDC so that a side panel can take room.
//
// Two facts carry the design. Aimed at the bisector of the two bodies' directions, the pair sits symmetrically about the
// centre of the view, so turning alone is the cheapest way to frame it (`composeLook`). And when the far body is very
// distant, its direction from the camera is nearly the same from any station, so the pair's separation is set by how far
// the camera's direction about the near body has swung off the line through the far body (the swing), while the azimuth
// of that swing sets which way the pair runs across the screen. `composeStation` therefore searches the swing first, and
// among the candidates at the smallest swing prefers the azimuth that spreads the pair furthest along screen-x (a wide frame).
import type { Vec3 } from '../data/geo';

export interface Frame {
  fovDeg: number;
  aspect: number;
  shiftX: number;
  shiftY: number;
  /** each body's centre must lie inside |NDC| ≤ margin */
  margin: number;
  /**
   * each body's whole disc (centre plus its angular radius, in NDC) must lie inside |NDC| ≤ edge; default 0.8, which keeps it clear of the header band and the bottom controls. A planet at its
   * approach station fills a third of the view, so a centre inside the margin can still hang off the screen (a phone's width).
   */
  edge?: number;
}
export interface ComposeInput { cam: Vec3; a: Vec3; aRadius: number; b: Vec3; bRadius: number; frame: Frame; up?: Vec3 }
export interface ComposeResult { look: Vec3; ok: boolean; sepDeg: number; ndcA: Ndc; ndcB: Ndc; occluded: boolean; behind: boolean }
/** The camera is derived from the station (`center + dir·dist`), so no `cam` is taken. */
export type StationInput = Omit<ComposeInput, 'cam'> & { center: Vec3; dist: number; currentDir: Vec3 };

export interface Ndc { x: number; y: number }

/** The share of the half-view (NDC) a body's whole disc may reach; `Frame.edge` overrides it. */
const DEFAULT_EDGE = 0.8;
/** The discs must clear each other by this factor of their combined angular radii, so the near one never grazes the far one. */
const CLEAR = 1.15;
/** The station search grid: 1° of swing, 2° of azimuth. */
const SWING_STEP_DEG = 1;
const AZIMUTH_STEP_DEG = 2;
const UP: Vec3 = [0, 1, 0];
const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

const add = (p: Vec3, q: Vec3): Vec3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const scale = (p: Vec3, k: number): Vec3 => [p[0] * k, p[1] * k, p[2] * k];
const dot = (p: Vec3, q: Vec3): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const len = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]);
const unit = (p: Vec3): Vec3 => scale(p, 1 / (len(p) || 1));
const tanHalf = (fovDeg: number): number => Math.tan((fovDeg * Math.PI) / 360);
/** Angular radius of a sphere of radius r seen from distance d; a camera inside the sphere sees a half-sky. */
const angRadius = (r: number, d: number): number => (d > r ? Math.asin(r / d) : Math.PI / 2);

/**
 * NDC of world point `p` for a camera at `cam` looking at `look`, with `up` as the screen's up. The basis is the one
 * `THREE.Object3D.lookAt` builds: right = fwd × up, camera-up = right × fwd. The frame's shift is added last, so
 * `ndc = raw + (shiftX, shiftY)`. `depth` is the distance along the view; the point is in front of the lens when it is positive.
 */
export function projectNdc(cam: Vec3, look: Vec3, up: Vec3, p: Vec3, frame: Frame): { x: number; y: number; depth: number } {
  const fwd = unit(sub(look, cam));
  let right = cross(fwd, up);
  // looking straight along `up` the basis is undefined: fall back to the x axis
  if (len(right) < 1e-9) right = cross(fwd, [1, 0, 0]);
  right = unit(right);
  const camUp = cross(right, fwd);
  const d = sub(p, cam);
  const depth = dot(d, fwd);
  const t = tanHalf(frame.fovDeg);
  return {
    x: dot(d, right) / (depth * t * frame.aspect) + frame.shiftX,
    y: dot(d, camUp) / (depth * t) + frame.shiftY,
    depth,
  };
}

/**
 * Turn-only framing of two bodies, A (planet, radius aRadius) and B (Earth, radius bRadius), seen from `cam`. The look
 * point lies on the segment a→b at (dB·a + dA·b)/(dA + dB), where dA, dB are the distances from the camera: there the
 * direction from the camera is the unit sum of the two directions, so the bodies sit symmetrically about the view's
 * centre. `ok` needs both bodies in front of the lens, both NDC inside `frame.margin`, and the discs apart: the separation
 * of the two directions must reach `CLEAR` times the sum of their angular radii.
 */
export function composeLook(i: ComposeInput): ComposeResult {
  const up = i.up ?? UP;
  const dA = len(sub(i.a, i.cam));
  const dB = len(sub(i.b, i.cam));
  const w = dA + dB;
  let look: Vec3 = w > 0 ? scale(add(scale(i.b, dA), scale(i.a, dB)), 1 / w) : [...i.a];
  // a camera on the segment has no bisector (the bodies are opposite): look at A, which `occluded` already rejects
  if (len(sub(look, i.cam)) < 1e-12) look = [...i.a];
  const ndcA = projectNdc(i.cam, look, up, i.a, i.frame);
  const ndcB = projectNdc(i.cam, look, up, i.b, i.frame);
  const sepDeg = Math.atan2(len(cross(sub(i.a, i.cam), sub(i.b, i.cam))), dot(sub(i.a, i.cam), sub(i.b, i.cam))) * R2D;
  const needDeg = CLEAR * (angRadius(i.aRadius, dA) + angRadius(i.bRadius, dB)) * R2D;
  const occluded = sepDeg < needDeg;
  // a body behind the lens has no meaningful NDC, so it can never count as framed (a camera between the two bodies)
  const behind = !(ndcA.depth > 0 && ndcB.depth > 0);
  const m = i.frame.margin;
  const edge = i.frame.edge ?? DEFAULT_EDGE;
  const t = tanHalf(i.frame.fovDeg);
  // a disc of angular radius r spans tan(r)/tanHalf in NDC y and tan(r)/(tanHalf·aspect) in x
  const spanY = (r: number, d: number) => Math.tan(angRadius(r, d)) / t;
  const spanX = (r: number, d: number) => spanY(r, d) / i.frame.aspect;
  const inside = (n: Ndc, r: number, d: number) =>
    Math.abs(n.x) <= m && Math.abs(n.y) <= m && Math.abs(n.x) + spanX(r, d) <= edge && Math.abs(n.y) + spanY(r, d) <= edge;
  const ok = !behind && !occluded && inside(ndcA, i.aRadius, dA) && inside(ndcB, i.bRadius, dB);
  return { look, ok, sepDeg, ndcA, ndcB, occluded, behind };
}

/**
 * The smallest swing about `center` that makes the pair framed, at constant distance `dist`. `center` is one of the two
 * bodies; the other is the body it is paired with. The swing is the angle from `currentDir`, the camera's direction now,
 * and the azimuth is measured about `currentDir` from the other body's axis. The search takes swings 0°…180° in 1° steps
 * and, at each, azimuths in 2° steps; it returns the first swing with a framed candidate, and among those the one that
 * separates the bodies furthest along screen-x. Deterministic. If no station frames the pair, it returns the candidate that
 * misses by least, with `ok` false.
 */
export function composeStation(i: StationInput): { dir: Vec3; swingDeg: number; ok: boolean } {
  const other = len(sub(i.center, i.a)) <= len(sub(i.center, i.b)) ? i.b : i.a;
  const c = unit(i.currentDir);
  const axis = unit(sub(other, i.center));
  let e1 = sub(axis, scale(c, dot(axis, c)));
  if (len(e1) < 1e-6) {
    // the other body lies along the current direction: any perpendicular will do, the one least parallel to it
    const ref: Vec3 = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    e1 = sub(ref, scale(c, dot(ref, c)));
  }
  e1 = unit(e1);
  const e2 = cross(c, e1);
  const dirAt = (swingDeg: number, azimuthDeg: number): Vec3 => {
    const t = add(scale(e1, Math.cos(azimuthDeg * D2R)), scale(e2, Math.sin(azimuthDeg * D2R)));
    return add(scale(c, Math.cos(swingDeg * D2R)), scale(t, Math.sin(swingDeg * D2R)));
  };
  let best = { dir: c, swingDeg: 0, penalty: Infinity };
  for (let swing = 0; swing <= 180; swing += SWING_STEP_DEG) {
    let pick: { dir: Vec3; sx: number } | null = null;
    for (let az = 0; az < 360; az += AZIMUTH_STEP_DEG) {
      const dir = dirAt(swing, az);
      const r = composeLook({ cam: add(i.center, scale(dir, i.dist)), a: i.a, aRadius: i.aRadius, b: i.b, bRadius: i.bRadius, frame: i.frame, up: i.up });
      if (r.ok) {
        const sx = Math.abs(r.ndcB.x - r.ndcA.x);
        if (!pick || sx > pick.sx) pick = { dir, sx };
      } else {
        const penalty = Math.max(Math.abs(r.ndcA.x), Math.abs(r.ndcA.y), Math.abs(r.ndcB.x), Math.abs(r.ndcB.y))
          + (r.occluded ? 1 : 0) + (r.behind ? 2 : 0);
        if (penalty < best.penalty) best = { dir, swingDeg: swing, penalty };
      }
    }
    if (pick) return { dir: pick.dir, swingDeg: swing, ok: true };
  }
  return { dir: best.dir, swingDeg: best.swingDeg, ok: false };
}
