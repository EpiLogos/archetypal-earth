// The plain geometry of a planet's card rings: where an ecliptic longitude round a held planet falls on the screen.
// `SkyLayer.eclipticWheel` gives the plane's two axes as the camera sees them; this module places things on that
// ellipse, keeps it readable when the plane is seen edge-on, and fits it into the room the screen leaves. No three.js,
// no DOM: it is tested like compose.ts.

/** The ecliptic plane at a body, projected: the screen offsets of its 0° and 90° axes and how far each points from the camera. */
export interface Wheel {
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  zu: number;
  zv: number;
}

const D2R = Math.PI / 180;

/** The ellipse's semi-axes (px): a the longer, b the shorter. */
export function semiAxes(w: Wheel): { a: number; b: number } {
  const A = w.ux * w.ux + w.uy * w.uy;
  const B = w.vx * w.vx + w.vy * w.vy;
  const C = w.ux * w.vx + w.uy * w.vy;
  const m = (A + B) / 2;
  const d = Math.sqrt(((A - B) / 2) ** 2 + C * C);
  return { a: Math.sqrt(Math.max(0, m + d)), b: Math.sqrt(Math.max(0, m - d)) };
}

/**
 * A wheel no flatter than `min` (shorter over longer axis). Seen edge-on the true plane is a line and the cards would
 * stack on it; as it nears that, the wheel is drawn toward a gently tilted ellipse of the same width, keeping its
 * handedness, so the cards stay apart. Above `min` the wheel is exactly the camera's.
 */
export function readable(w: Wheel, min = 0.3, tilt = 0.4, rotDeg = -14): Wheel {
  const { a, b } = semiAxes(w);
  if (a < 1e-6) return { ux: 1, uy: 0, vx: 0, vy: tilt, zu: 0, zv: 1 };
  const ratio = b / a;
  if (ratio >= min) return w;
  const t = Math.min(1, (min - ratio) / min);
  const r = rotDeg * D2R;
  const u0x = a * Math.cos(r);
  const u0y = a * Math.sin(r);
  const hand = w.ux * w.vy - w.uy * w.vx >= 0 ? 1 : -1;
  const v0x = -hand * u0y * tilt;
  const v0y = hand * u0x * tilt;
  const mix = (p: number, q: number) => p + (q - p) * t;
  return { ux: mix(w.ux, u0x), uy: mix(w.uy, u0y), vx: mix(w.vx, v0x), vy: mix(w.vy, v0y), zu: w.zu, zv: w.zv };
}

/** The offset (px, from the body's centre) of longitude `lonDeg` on the wheel at ring factor `k`, and how far it points from the camera. */
export function wheelPoint(w: Wheel, k: number, lonDeg: number): { x: number; y: number; depth: number } {
  const c = Math.cos(lonDeg * D2R);
  const s = Math.sin(lonDeg * D2R);
  return { x: k * (c * w.ux + s * w.vx), y: k * (c * w.uy + s * w.vy), depth: c * w.zu + s * w.zv };
}

export interface Room {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The share (0 … 1) of ring factor `k` that fits in the room round a body at (cx, cy), a card (cw × ch) still wholly on
 * screen at the ring's widest and tallest. 1 when it fits as it stands.
 */
export function fitShare(w: Wheel, k: number, cx: number, cy: number, room: Room, cw: number, ch: number): number {
  const ex = k * Math.hypot(w.ux, w.vx);
  const ey = k * Math.hypot(w.uy, w.vy);
  const ax = Math.min(cx - room.left, room.right - cx) - cw / 2;
  const ay = Math.min(cy - room.top, room.bottom - cy) - ch / 2;
  const sx = ex > 1e-6 ? ax / ex : 1;
  const sy = ey > 1e-6 ? ay / ey : 1;
  return Math.max(0, Math.min(1, sx, sy));
}

/** The disc radius (px) from which a held body's rings stand whole: at and above it a card is never smaller than a finger can read. */
const RING_FULL_R = 80;
/** … and the radii over which the rings give way as the body dwindles: gone at the first, whole at the second. */
const RING_GONE_R = 14;
const RING_WHOLE_R = 36;

const unit = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * A card's size (px) for a disc of radius `R`: portrait, in the plates' own ratio (800 × 1255). A held body's disc fills a
 * third of the view or so (R about 130 px on a desktop, 80 on a phone) and the card keeps a readable floor of 40 px there;
 * as the body dwindles under a zoom out the floor lets go, so the card shrinks with the body it hangs about (it is
 * `0.46 R`), and never stays a fixed size over a planet that is a point.
 */
export function cardSize(R: number): { w: number; h: number } {
  const floor = 40 * unit((R - RING_GONE_R) / (RING_FULL_R - RING_GONE_R));
  const h = Math.min(70, Math.max(R * 0.46, floor));
  return { w: Math.round(h * 0.637), h: Math.round(h) };
}

/**
 * How present a held body's rings are (0 … 1) for a disc of radius `R`: whole while the body reads as a body, then fading
 * out with it as it dwindles. A continuous function of the disc, so the rings go as gracefully as the planet does on a zoom
 * out, whichever body it is.
 */
export function ringPresence(R: number): number {
  const t = unit((R - RING_GONE_R) / (RING_WHOLE_R - RING_GONE_R));
  return t * t * (3 - 2 * t);
}
