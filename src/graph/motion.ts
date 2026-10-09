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

// ── inertia: the pan coasts on after the pointer lets go (SPEC §9, 'inertial motion') ──
/** The pan deltas kept for the release: the last this many milliseconds of them. */
export const COAST_WINDOW_MS = 80;
/** A release this long after the last delta is a pointer that stopped: no coast. */
export const COAST_STALE_MS = 100;
/** The velocity halves over this many seconds (exponential decay). */
export const COAST_HALF_LIFE = 0.25;
/** Below this speed (px/s) a release is a settle, not a flick. */
export const COAST_MIN_SPEED = 120;
/** The fastest coast: a stronger flick is clamped to it, so the field never leaves the screen in a second. */
export const COAST_MAX_SPEED = 800;
/** The coast ends when a 60 fps frame would move less than this many px. */
export const COAST_STOP_PX = 0.05;

interface PanSample {
  dx: number;
  dy: number;
  /** milliseconds (performance.now) */
  t: number;
}

/**
 * The camera's pan inertia. The view records each pan delta as it happens, asks for the velocity when the pointer
 * is released, and then steps the coast frame by frame (each step's displacement is applied through setCamera).
 * Off under reduced motion: a release never coasts there.
 */
export class Coast {
  private pts: PanSample[] = [];
  /** the velocity, in px per second */
  vx = 0;
  vy = 0;

  constructor(private reduced = false) {}

  get moving(): boolean {
    return this.vx !== 0 || this.vy !== 0;
  }

  /** A pan delta (px) at time t (ms). Deltas older than the window are dropped. */
  record(dx: number, dy: number, t: number): void {
    if (this.reduced || !Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(t)) return;
    this.pts.push({ dx, dy, t });
    const cut = t - COAST_WINDOW_MS;
    while (this.pts.length && this.pts[0].t < cut) this.pts.shift();
  }

  /**
   * The pointer lets go at time t (ms). Starts a coast when the last pan was fast and recent; returns whether it did.
   * The speed is the movement after the first kept sample, over the time those samples span.
   */
  release(t: number): boolean {
    const pts = this.pts;
    this.pts = [];
    if (this.reduced || pts.length < 2 || !Number.isFinite(t)) return this.halt();
    const last = pts[pts.length - 1];
    if (t - last.t > COAST_STALE_MS) return this.halt();
    const span = (last.t - pts[0].t) / 1000;
    if (!(span > 0)) return this.halt();
    let sx = 0;
    let sy = 0;
    for (let i = 1; i < pts.length; i++) {
      sx += pts[i].dx;
      sy += pts[i].dy;
    }
    let vx = sx / span;
    let vy = sy / span;
    const speed = Math.hypot(vx, vy);
    if (!Number.isFinite(speed) || speed < COAST_MIN_SPEED) return this.halt();
    if (speed > COAST_MAX_SPEED) {
      vx *= COAST_MAX_SPEED / speed;
      vy *= COAST_MAX_SPEED / speed;
    }
    this.vx = vx;
    this.vy = vy;
    return true;
  }

  /** Cancel: the pointer went down, the wheel turned, the camera was refitted or the graph hid. */
  stop(): void {
    this.halt();
  }

  private halt(): false {
    this.vx = 0;
    this.vy = 0;
    this.pts = [];
    return false;
  }

  /**
   * Advance the coast by dt seconds. Returns the displacement of this step: the exact integral of the decaying
   * velocity, so the total distance does not depend on the frame rate. Ends below COAST_STOP_PX per 60 fps frame.
   */
  step(dt: number): { dx: number; dy: number } {
    if (!this.moving || !Number.isFinite(dt) || dt <= 0) return { dx: 0, dy: 0 };
    const decay = Math.pow(0.5, dt / COAST_HALF_LIFE);
    const travelled = (COAST_HALF_LIFE / Math.LN2) * (1 - decay);
    const out = { dx: this.vx * travelled, dy: this.vy * travelled };
    this.vx *= decay;
    this.vy *= decay;
    if (Math.hypot(this.vx, this.vy) / 60 < COAST_STOP_PX) this.halt();
    return out;
  }
}
