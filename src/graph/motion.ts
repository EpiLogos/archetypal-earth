// The rules of the graph's camera clock, zoom and clicks, kept free of the canvas so they can be tested on their own.

/** The longest and the shortest step a frame may advance the camera and the tweens. */
export const FRAME_MIN = 0.001;
export const FRAME_MAX = 0.06;
/** The zoom extent: the same as the d3 behaviour's. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 9;
/** Two clicks this soon and this near are one double-click. */
export const DOUBLE_MS = 450;
export const DOUBLE_PX = 12;

/**
 * The seconds a frame advances, from the milliseconds since the last one. A frame stamped before the view woke
 * (negative) counts as the shortest step, never as a backwards one: the camera must not run away from it.
 */
export function frameSeconds(ms: number): number {
  const s = ms / 1000;
  if (!Number.isFinite(s)) return 0.016;
  return Math.min(FRAME_MAX, Math.max(FRAME_MIN, s));
}

/** A zoom inside the extent. Call only on a finite k (see isCamera). */
export function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/** A camera that can be drawn: three finite numbers and a positive zoom. */
export function isCamera(x: number, y: number, k: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(k) && k > 0;
}

export interface Click {
  x: number;
  y: number;
  /** milliseconds (performance.now) */
  t: number;
}

/** The second click completes a double-click when it lands near the first, and soon after it. */
export function isDoubleClick(first: Click, second: Click): boolean {
  const dt = second.t - first.t;
  return dt >= 0 && dt <= DOUBLE_MS && Math.hypot(second.x - first.x, second.y - first.y) <= DOUBLE_PX;
}
