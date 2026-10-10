// The pull-back's stage model: a pure function of the camera's distance from the Earth's centre (R⊕).
// Nothing here knows about three.js, the DOM or the clock, so it is tested like zoom.ts. Because every
// weight is a function of distance alone, any point of the zoom is reversible and linkable.
//
//   earth    1.05 → 40        the atlas as it always was; no sky layer
//   lunar    40 → 600         the Moon's ring and body, the Sun as a bright direction
//   handoff  600 → 3 000      the look-at eases from the Earth to the Sun (by 1 750, see FOCUS_HANDOFF); rings and planets arrive
//   system   beyond           the heliocentric field, radial scale diagrammatic and said so
import { MIN_DIST } from '../globe/zoom';
import type { Vec3 } from '../data/geo';
import type { BodyKey } from '../types/sky';

export type Stage = 'earth' | 'lunar' | 'handoff' | 'system';

export const STAGE_EDGES = { lunar: 40, handoff: 600, system: 3000 } as const;

/**
 * The look-at's share of the Sun across the handoff, 0 → 1, as a function of distance alone. It is 0 at the Earth stage's
 * edge (so the atlas's framing is unchanged there) and 1 once the Sun is the subject. It reaches 1 at 1 750 R⊕ rather than at
 * the system edge: on a desktop view of the canonical system pose, the Earth and the Sun are both inside the central 70% from
 * ~1 070 R⊕ on (`bothInFrame`). The former ramp to 3 000 R⊕ got there only at ~1 170 R⊕ (aspect 2.2) and ~1 290 R⊕ (1.6).
 * Its midpoint (0.5) falls at ~1 024 R⊕, where the look-at is the midpoint of the Earth and the Sun.
 */
export const FOCUS_HANDOFF = { from: STAGE_EDGES.handoff, to: 1750 } as const;
export function handoffFocusWeight(dist: number): number {
  return logStep(dist, FOCUS_HANDOFF.from, FOCUS_HANDOFF.to);
}

/** Entering and leaving the sky flag by the zoom gesture: a gap between them, so it never chatters. */
export const SKY_ENTER = 40;
export const SKY_EXIT = 30;

/** At or below this distance the depth planes are exactly the atlas's own (pixel-identical Earth mode). */
export const LEGACY_DEPTH_MAX = 6;

/** The diagram's radial compression: a body at r au from the Sun is drawn at K·r^P R⊕ from it. */
export const COMPRESSION = { K: 900, P: 0.5 } as const;

/**
 * How much of the Earth's light is the true Sun's: 0 near the surface, where the atlas keeps its composed key light
 * (exactly zero, so the near-surface look is unchanged), rising to 1 at the lunar stage's edge and beyond.
 */
export const SUN_BLEND = { from: 8, to: 40 } as const;
export function sunWeight(dist: number): number {
  return smoothstep((dist - SUN_BLEND.from) / (SUN_BLEND.to - SUN_BLEND.from));
}

/** Real distances, for the lunar stage: 1 au in Earth radii. */
export const AU_IN_EARTH_RADII = 149597870.7 / 6371.0084;

export function compressAu(rAu: number): number {
  return COMPRESSION.K * Math.pow(Math.max(rAu, 0), COMPRESSION.P);
}

/** The caption the view carries while the diagram is compressed: the house labels its approximations. */
export const COMPRESSION_CAPTION = `Radial scale is diagrammatic: distance from the Sun is drawn as ${COMPRESSION.K} R⊕ × √(au). Angles, longitudes and inclinations are true.`;

/** The caption while a birth sky stands: drawn from the Earth, so every direction is the true one. */
export const GEOCENTRIC_CAPTION = `Drawn from the Earth: each body lies along its true direction in the ecliptic; distance is diagrammatic, ${COMPRESSION.K} R⊕ × √(au). The orbit rings of the Sun-centred system are set aside.`;

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Smoothstep of the position of `d` between `a` and `b` on a log scale. */
export function logStep(d: number, a: number, b: number): number {
  if (d <= a) return 0;
  if (d >= b) return 1;
  return smoothstep(Math.log(d / a) / Math.log(b / a));
}

export function stageOf(dist: number): Stage {
  if (dist < STAGE_EDGES.lunar) return 'earth';
  if (dist < STAGE_EDGES.handoff) return 'lunar';
  if (dist < STAGE_EDGES.system) return 'handoff';
  return 'system';
}

export interface StageWeights {
  /** the Sun's glow: the bright direction in the backdrop */
  sun: number;
  /** the Moon's ring and body (true geocentric scale); gone when the Earth is a point */
  moon: number;
  /** 0 → 1 across the handoff: the Sun's glow grows as the Earth's own sky gives way (sizes, not the look-at) */
  handoff: number;
  /** the look-at's share of the Sun (`handoffFocusWeight`): the focus, and the camera's ride with the sky, follow it */
  focus: number;
  /** orbit rings and the ecliptic plane */
  rings: number;
  /** the planets as bodies */
  planets: number;
  /** the Earth as a labelled point in the diagram */
  earthPoint: number;
}

export function stageWeights(dist: number): StageWeights {
  return {
    sun: logStep(dist, 25, 70),
    moon: logStep(dist, 30, 80) * (1 - logStep(dist, 1500, 4000)),
    handoff: logStep(dist, STAGE_EDGES.handoff, STAGE_EDGES.system),
    focus: handoffFocusWeight(dist),
    rings: logStep(dist, 500, 3000),
    planets: logStep(dist, 400, 2000),
    earthPoint: logStep(dist, 300, 1500),
  };
}

/** The whole sky layer is invisible (and costs nothing) inside the Earth stage. */
export function skyVisible(dist: number): boolean {
  return dist > 20;
}

/** Furthest distance a body or ring sits from the Earth in the diagram (Pluto's aphelion, with margin). */
export const SKY_EXTENT = 7200;

/**
 * Near and far planes. Inside `LEGACY_DEPTH_MAX` these are exactly the atlas's own expressions; beyond it
 * the far plane grows to hold the sky, so depth stays precise from the ground to past Neptune.
 *
 * `dist` is the camera's distance from the Earth's centre and bounds the far plane (the sky is drawn about the Sun).
 * While a body is approached (`approach` > 0) the near plane may come down to the camera's distance from the focus,
 * `focusDist`, so a small planet's disc, drawn at that distance, is not cut by the near plane.
 */
export function depthPlanes(dist: number, withSky: boolean, focusDist = dist, approach = 0): { near: number; far: number } {
  let near = Math.max(0.003, (dist - 1) * 0.28);
  if (approach > 0) near = Math.min(near, Math.max(0.003, (focusDist - 1) * 0.28));
  let far = dist + 3.2;
  if (withSky && dist > LEGACY_DEPTH_MAX) far += SKY_EXTENT * smoothstep((dist - LEGACY_DEPTH_MAX) / (40 - LEGACY_DEPTH_MAX));
  return { near, far };
}

const tanHalf = (fovDeg: number): number => Math.tan((fovDeg * Math.PI) / 360);

/** Radius of the diagram that must fit, Earth radii: Pluto's typical reach (≈39 au) under the radial compression. */
const HOME_RADIUS = COMPRESSION.K * Math.sqrt(39);

/**
 * The distance at which the whole system sits comfortably in view, for the viewport's aspect. It is fitted on the
 * tilted disc — the vertical half-extent of a ring seen `SYSTEM_VIEW_ELEVATION`° above the plane, with room for
 * Pluto's own inclination — and on the width, whichever is the tighter. Every body is in frame at home.
 */
export function systemHomeDist(aspect: number, fovDeg: number): number {
  const t = tanHalf(fovDeg);
  const el = (SYSTEM_VIEW_ELEVATION * Math.PI) / 180;
  const vertical = (HOME_RADIUS * (Math.sin(el) + 0.3 * Math.cos(el))) / (0.88 * t);
  const horizontal = HOME_RADIUS / (0.92 * t * Math.min(Math.max(aspect, 0.3), 2.6));
  return Math.max(9000, vertical, horizontal);
}

/**
 * How far past the system's home framing the user may pull back: a small overshoot (×1.35). It was 2.2×, which left a dead
 * zone of empty space to pull back through with nothing in it (audit S3 (c)); the home already frames every body, so this
 * keeps room to read the system's extent without the dead zone. Pinned in tests/sky/handoff.test.ts.
 */
export const SKY_OVERSHOOT = 1.35;

/** How far the user may pull back once the sky is reachable. */
export function skyMaxDist(aspect: number, fovDeg: number): number {
  return systemHomeDist(aspect, fovDeg) * SKY_OVERSHOOT;
}

/** The Earth–Sun separation in the diagram, R⊕: 1 au under the radial compression. */
export const SUN_DIAGRAM_DIST = COMPRESSION.K;

/** The share of the viewport each of the pair must stay inside, from the centre: the central 70%, i.e. ±0.7 in NDC. */
export const FRAME_CENTRAL = 0.7;

/**
 * Normalised device coordinates (−1 … 1 across the viewport) of a point, seen by the rig's north-up camera: at
 * `focus + dist·camDir`, looking at `focus`, with +Y up and no roll (the rig's lens, unshifted).
 */
export function ndcOf(point: Vec3, focus: Vec3, camDir: Vec3, dist: number, aspect: number, fovDeg: number): { x: number; y: number; depth: number } {
  const fwd: Vec3 = [-camDir[0], -camDir[1], -camDir[2]];
  // right = fwd × Y, up = right × fwd: the camera basis `THREE.Object3D.lookAt` builds for up = +Y
  const rl = Math.hypot(fwd[2], fwd[0]) || 1;
  const right: Vec3 = [-fwd[2] / rl, 0, fwd[0] / rl];
  const up: Vec3 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const rx = point[0] - focus[0] - dist * camDir[0];
  const ry = point[1] - focus[1] - dist * camDir[1];
  const rz = point[2] - focus[2] - dist * camDir[2];
  const depth = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
  const t = tanHalf(fovDeg);
  return {
    x: (rx * right[0] + ry * right[1] + rz * right[2]) / (depth * t * aspect),
    y: (rx * up[0] + ry * up[1] + rz * up[2]) / (depth * t),
    depth,
  };
}

/**
 * The look-at of the handoff for a camera at distance `dist` looking along `camDir` (scene axes, unit), with the Sun in the
 * direction `sunDir` (unit) from the Earth. The focus is `handoffFocusWeight(dist)` of the way to the Sun, as the camera uses it.
 * Returns the larger of the Earth's and the Sun's |NDC| on either axis: at most 1 means both are in the frame.
 */
export function pairExtent(dist: number, aspect: number, fovDeg: number, camDir: Vec3, sunDir: Vec3, weight = handoffFocusWeight(dist)): number {
  const k = weight * SUN_DIAGRAM_DIST;
  const focus: Vec3 = [sunDir[0] * k, sunDir[1] * k, sunDir[2] * k];
  const sun: Vec3 = [sunDir[0] * SUN_DIAGRAM_DIST, sunDir[1] * SUN_DIAGRAM_DIST, sunDir[2] * SUN_DIAGRAM_DIST];
  const e = ndcOf([0, 0, 0], focus, camDir, dist, aspect, fovDeg);
  const s = ndcOf(sun, focus, camDir, dist, aspect, fovDeg);
  return Math.max(Math.abs(e.x), Math.abs(e.y), Math.abs(s.x), Math.abs(s.y));
}

/** True when the Earth and the Sun both lie inside the central `fraction` of the viewport at this distance and view. */
export function bothInFrame(dist: number, aspect: number, fovDeg: number, camDir: Vec3, sunDir: Vec3, fraction = FRAME_CENTRAL): boolean {
  return pairExtent(dist, aspect, fovDeg, camDir, sunDir) <= fraction;
}

/**
 * The arrival settle (audit S3 (b)): a pull-back that rests in the system settles its orientation toward the canonical
 * system view, the room the S key composes, at the same distance. It is eased (90% of the way in `durationMs`), capped
 * at `maxDegPerS` so it never teleports, and cancelled by any input. A drag ends it for good (controls.ts).
 */
export const SETTLE = { idleMs: 600, quietDragMs: 4000, durationMs: 2400, maxDegPerS: 12, doneDeg: 0.02 } as const;
const SETTLE_RATE = Math.log(10) / (SETTLE.durationMs / 1000);

/** Degrees the orientation may move this frame toward a settled pose `remainingDeg` away, over `dtS` seconds. */
export function settleStep(remainingDeg: number, dtS: number): number {
  if (!(remainingDeg > 0) || !(dtS > 0)) return 0;
  const v = Math.min(SETTLE.maxDegPerS, SETTLE_RATE * remainingDeg);
  return Math.min(remainingDeg, v * dtS);
}

/** The chosen elevation above the ecliptic of the default system view, degrees. */
export const SYSTEM_VIEW_ELEVATION = 38;
/**
 * … and its ecliptic azimuth. The azimuth follows the Sun rather than standing at a fixed longitude: the camera's up is the
 * equatorial pole, so as the Earth–Sun line swings round the year it also rolls on screen by up to ±23°, and a view fixed in
 * the ecliptic let the pair leave the frame on most dates (to ~1.9 in |NDC| at 1.6, where 1 is the edge). The camera sits
 * `lead` degrees past the Sun's longitude, bowed by `swing`·cos(λ☉ − `phase`) — fitted so the pair holds inside the frame on
 * every date, and inside the central 70% on about two thirds of them; the rest (the December–April swing) stays inside
 * |NDC| 0.9. Smooth in the Sun's longitude, so scrubbing the date never makes the settled view jump.
 */
export const SYSTEM_VIEW_AZIMUTH = { lead: 50, swing: 35, phase: 310 } as const;

/** The canonical system view's ecliptic longitude when the Sun stands at ecliptic longitude `sunLonDeg`, degrees. */
export function systemViewLongitude(sunLonDeg: number): number {
  const { lead, swing, phase } = SYSTEM_VIEW_AZIMUTH;
  return sunLonDeg + lead + swing * Math.cos(((sunLonDeg - phase) * Math.PI) / 180);
}

/** Distances (Earth radii) over which the atlas's surface layers (presences, arcs, tiles, markers) give way to the sky. */
export const SURFACE_FADE = { from: 6, to: 36 } as const;

/** 1 over and near the Earth, 0 once the globe is a few pixels wide and its constant-pixel layers would only smear. */
export const surfaceWeight = (camDist: number): number => 1 - smoothstep((camDist - SURFACE_FADE.from) / (SURFACE_FADE.to - SURFACE_FADE.from));

/** Earth's mean radius, km: the unit of the diagram. */
export const EARTH_RADIUS_KM = 6371.0084;

/** The bodies a card can approach: the Sun and the planets. Earth keeps its own framing, the Moon its own. */
export const APPROACH_BODIES: readonly BodyKey[] = ['sun', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
export const isApproachBody = (key: BodyKey): boolean => APPROACH_BODIES.includes(key);

/** The share of the viewport's height an approached body's disc fills. */
export const APPROACH_FILL = 0.3;

/**
 * The camera-to-body distance (Earth radii) at which the body's disc spans `APPROACH_FILL` of the viewport height
 * (less on a narrow viewport, so the disc keeps within the width). Exact: the silhouette's half-angle α has
 * tan α = fill·tan(fov/2), and the distance is radius / sin α. Clamped so the sphere sits clear of the camera for any
 * field of view (2.6 radii) and never inside the closest approach the zoom allows. Monotone in the radius.
 */
export function approachDist(radiusKm: number, fovDeg: number, aspect: number): number {
  const trueRad = radiusKm / EARTH_RADIUS_KM;
  const fill = Math.min(APPROACH_FILL, 0.6 * Math.max(aspect, 0.05));
  const x = fill * tanHalf(fovDeg);
  const exact = (trueRad * Math.sqrt(1 + x * x)) / x;
  return Math.max(exact, MIN_DIST + 0.5, 2.6 * trueRad);
}

/**
 * The distance the stage model reads. With no body approached (approach 0) it is the camera's distance from the focus,
 * exactly as it always was. As the camera approaches a body it reads the camera's distance from the Earth's centre,
 * floored at the system edge, blended in log space, so the whole system stands about the planet being approached.
 */
export function stageDistance(rigDist: number, camFromEarth: number, approach: number): number {
  const a = clamp01(approach);
  if (a <= 0) return rigDist;
  const far = Math.max(rigDist, camFromEarth, STAGE_EDGES.system);
  if (a >= 1) return far;
  return Math.exp(Math.log(rigDist) + (Math.log(far) - Math.log(rigDist)) * a);
}
