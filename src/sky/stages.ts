// The pull-back's stage model: a pure function of the camera's distance from the Earth's centre (R⊕).
// Nothing here knows about three.js, the DOM or the clock, so it is tested like zoom.ts. Because every
// weight is a function of distance alone, any point of the zoom is reversible and linkable.
//
//   earth    1.05 → 40        the atlas as it always was; no sky layer
//   lunar    40 → 600         the Moon's ring and body, the Sun as a bright direction
//   handoff  600 → 3 000      the look-at eases from the Earth to the Sun, rings and planets arrive
//   system   beyond           the heliocentric field, radial scale diagrammatic and said so
export type Stage = 'earth' | 'lunar' | 'handoff' | 'system';

export const STAGE_EDGES = { lunar: 40, handoff: 600, system: 3000 } as const;

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
  /** 0 → 1 across the handoff: the look-at moves from the Earth to the Sun, the camera starts to ride the sky */
  handoff: number;
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
 */
export function depthPlanes(dist: number, withSky: boolean): { near: number; far: number } {
  const near = Math.max(0.003, (dist - 1) * 0.28);
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

/** How far the user may pull back once the sky is reachable. */
export function skyMaxDist(aspect: number, fovDeg: number): number {
  return systemHomeDist(aspect, fovDeg) * 2.2;
}

/** The chosen elevation above the ecliptic of the default system view, degrees. */
export const SYSTEM_VIEW_ELEVATION = 38;
/** … and its ecliptic azimuth (the direction the camera sits toward, ecliptic longitude). */
export const SYSTEM_VIEW_LONGITUDE = 250;

/** Distances (Earth radii) over which the atlas's surface layers (presences, arcs, tiles, markers) give way to the sky. */
export const SURFACE_FADE = { from: 6, to: 36 } as const;

/** 1 over and near the Earth, 0 once the globe is a few pixels wide and its constant-pixel layers would only smear. */
export const surfaceWeight = (camDist: number): number => 1 - smoothstep((camDist - SURFACE_FADE.from) / (SURFACE_FADE.to - SURFACE_FADE.from));
