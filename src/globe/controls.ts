// A north-up, inertial orbit rig with great-circle flights, built to feel like a
// map: whatever surface point you grab, wheel-zoom or pinch stays under your
// fingertip; speed follows altitude; user input always wins over a flight.
// The camera is (lat, lon, dist) around the origin — there is no roll and the
// pole is clamped, so orientation is never lost. The maths lives in zoom.ts.
import * as THREE from 'three';
import { dirFromLatLon, latLonFromDir, slerp, angleBetween, wrapLon, type Vec3 } from '../data/geo';
import { easeInOutCubic } from '../data/palette';
import { anchorView, clampDist, degPerPixel, easeDist, MAX_LAT, MIN_DIST, surfacePointAt, zoomedDist, type Lens } from './zoom';
import { SETTLE, settleStep } from '../sky/stages';

export { MIN_DIST };
export const MAX_DIST = 5.4;
/**
 * Beyond `maxDist` while the sky is still loading (`softMaxDist`), each outward wheel step moves the target this fraction as
 * far: the pull-back resists and keeps moving, so it never stalls and then jumps when the sky arrives (audit S3 (d)).
 */
const SOFT_RESIST = 0.3;
const R2D = 180 / Math.PI;

const DOUBLE_ZOOM = 0.4; // altitude factor for a double-click / double-tap
const FLING_MAX = 240; // deg/s
/** Above any value the atlas's own distances reach (0.2 at the old MAX_DIST), so Earth mode is unchanged. */
const DRAG_DEG_PER_PX_MAX = 0.25;

interface Fly {
  t: number;
  dur: number;
  from: Vec3;
  to: Vec3;
  d0: number;
  d1: number;
  lift: number;
}

/** A surface point held under a screen point (NDC) while the view changes. */
interface Anchor {
  p: Vec3;
  nx: number;
  ny: number;
}

export interface RigOptions {
  reduced: boolean;
  onInteract(): void;
  /** every pointer-down / wheel — used to pause tours */
  onGrab(): void;
  onClick(x: number, y: number): void;
  onHover(x: number, y: number, inside: boolean): void;
  /** true if a live presence sits under this point (a double-click there selects, it does not zoom) */
  isOverPresence?(x: number, y: number): boolean;
}

export class CameraRig {
  lat = 24;
  lon = 26;
  dist = 3.8;
  targetDist = 3.8;
  /**
   * Where the camera looks and orbits, scene coordinates. The origin (the Earth) for every distance the atlas
   * has always had; the sky layer moves it toward the Sun across the pull-back's handoff (src/sky/stages.ts).
   */
  readonly focus = new THREE.Vector3();
  /**
   * When set, the engine holds `focus` here instead of taking it from the sky layer. Scripted sky flights (the descent
   * from a planet, the return to it) are Earth-centred polar flights: they pin the focus to the origin so the layer's own
   * focus easing (approach / release) cannot move the camera underneath them. null: the layer owns the focus.
   */
  focusPin: THREE.Vector3 | null = null;
  shiftX = 0;
  shiftY = 0;
  tShiftX = 0;
  tShiftY = 0;
  autoRotate = true;
  /** how far the user may pull back (wider on portrait screens) */
  maxDist = MAX_DIST;
  /**
   * The further limit the pull-back is heading for while the sky loads (0: none). Beyond `maxDist` it resists (SOFT_RESIST);
   * once the sky stands, `maxDist` is raised to it and the resistance is gone.
   */
  softMaxDist = 0;
  interacted = false;
  /** true while the user holds the globe or a flight is running (UI pauses hover) */
  dragging = false;
  /** performance.now() of the last wheel or pinch step, and of the last drag step: the sky's arrival settle waits on them */
  lastWheelAt = -Infinity;
  lastDragAt = -Infinity;
  /** true while the view was brought here by a wheel or pinch and no drag or key has moved it since (the arrival settle's condition) */
  wheelDriven = false;
  /** the orientation an arrival is settling toward (the sky's canonical system view), or null: any input cancels it */
  settleTo: { lat: number; lon: number } | null = null;

  private vLat = 0;
  private vLon = 0;
  private fly: Fly | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private anchor: Anchor | null = null;
  private pinch: { d0: number; dist0: number } | null = null;
  private gesture: { dist0: number } | null = null;
  private downT = 0;
  private moved = 0;
  private lastMoveT = 0;
  private lastTap: { t: number; x: number; y: number } | null = null;
  private wheelPos = { x: -1e9, y: -1e9, t: 0 };
  private flyVLat = 0;
  private flyVLon = 0;
  private tmpA: Vec3 = [0, 0, 0];
  private tmpC: Vec3 = [0, 0, 0];
  private tmpS: Vec3 = [0, 0, 0];
  private tmpT: Vec3 = [0, 0, 0];
  private flyEndCbs: (() => void)[] = [];
  /**
   * The look-at point is `lerp(lookFrom, lookTo, ease(lookT))`, a scene point. `lookTo` is the held target, or the
   * live `focus` while `lookTrack` (a recentre). The camera POSITION never depends on any of this: it is always
   * focus + dir(lat, lon)·dist, so a gaze turns the camera and never translates it.
   * The look blend (`lookOffset`) eases `lookOff0` → `lookGoal` on the same `ease(lookT)`: 1 = held on a target, 0 = centred.
   * A retarget starts a new turn from wherever the look is now, so it never jumps.
   */
  private lookFrom = new THREE.Vector3();
  private lookTo = new THREE.Vector3();
  private lookTrack = true;
  private lookT = 1;
  private lookDur = 1;
  private lookOff0 = 0;
  private lookGoal: 0 | 1 = 0;
  private lookDone: (() => void) | null = null;
  private lookTmp = new THREE.Vector3();
  private orbitTmp = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private opts: RigOptions) {
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointercancel', this.onUp);
    dom.addEventListener('pointerleave', () => opts.onHover(0, 0, false));
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    // Safari reports trackpad pinch as gesture events rather than ctrl+wheel
    dom.addEventListener('gesturestart', this.onGestureStart as EventListener, { passive: false });
    dom.addEventListener('gesturechange', this.onGestureChange as EventListener, { passive: false });
    dom.addEventListener('gestureend', this.onGestureEnd as EventListener, { passive: false });
    dom.style.touchAction = 'none';
    this.apply();
  }

  get flying(): boolean {
    return this.fly !== null;
  }

  /** True while the look is turning toward a target, held off the focus, or easing back to it. The position is never affected. */
  get gazing(): boolean {
    return this.lookT < 1 || this.lookOffset > 1e-3;
  }

  /** The eased look blend: 1 held on a target, 0 centred on the focus, between while a turn runs. */
  get lookOffset(): number {
    return this.lookOff0 + (this.lookGoal - this.lookOff0) * easeInOutCubic(this.lookT);
  }

  /** The current look-at point (scene coordinates), written into `out`. */
  lookPoint(out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const to = this.lookTrack ? this.focus : this.lookTo;
    const e = easeInOutCubic(this.lookT);
    if (e >= 1) out.copy(to);
    else out.lerpVectors(this.lookFrom, to, e);
    // degenerate: the look point is the camera itself, or lies on the up axis, where lookAt has no orientation — look at the focus
    const p = this.orbitPos(this.orbitTmp);
    const dx = out.x - p.x;
    const dy = out.y - p.y;
    const dz = out.z - p.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (!(len2 > 1e-18) || dx * dx + dz * dz < 1e-10 * len2) out.copy(this.focus);
    return out;
  }

  /** The camera position and look-at point the rig produces now, for tests and the harness. */
  snapshot(): { pos: [number, number, number]; look: [number, number, number] } {
    const p = this.orbitPos(new THREE.Vector3());
    const l = this.lookPoint(new THREE.Vector3());
    return { pos: [p.x, p.y, p.z], look: [l.x, l.y, l.z] };
  }

  onFlyEnd(cb: () => void) {
    this.flyEndCbs.push(cb);
  }

  /** Where the camera currently looks. */
  centre(): { lat: number; lon: number } {
    return { lat: this.lat, lon: this.lon };
  }

  /**
   * Turn the camera to look at a scene point, without moving it: the position stays focus + dir(lat, lon)·dist.
   * Eases from wherever the look is now (mid-turn included), so retargeting is continuous. `onDone` fires once on arrival.
   * Orbit gaze (look at Earth) and return-to-sky (look at the planet) both use this.
   */
  lookAtPoint(target: THREE.Vector3, opts: { duration?: number; instant?: boolean; onDone?: () => void } = {}) {
    this.cancelFly(false);
    this.settleTo = null;
    this.wheelDriven = false;
    this.vLat = this.vLon = 0;
    const dur = opts.instant || this.opts.reduced ? 0 : (opts.duration ?? 1.5);
    this.beginLook(target, 1, dur, opts.onDone ?? null);
  }

  /**
   * Scripted pose, for the sky camera's tracks (descent, return, swing): set the orbit state directly, about the
   * current `focus`, and hold the look on `look` (a scene point) or centre it on the focus when `look` is null.
   * Cancels flights, inertia and any settle, and does not ease: the caller samples its own track every frame.
   */
  drive(lat: number, lon: number, dist: number, look: THREE.Vector3 | null = null) {
    this.cancelFly(false);
    this.vLat = this.vLon = 0;
    this.anchor = null;
    this.settleTo = null;
    this.wheelDriven = false;
    this.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    this.lon = wrapLon(lon);
    this.dist = this.targetDist = Math.max(MIN_DIST + 0.02, dist);
    if (look) {
      this.lookFrom.copy(look);
      this.lookTo.copy(look);
      this.lookTrack = false;
      this.lookT = 1;
      this.lookGoal = 1;
      this.lookOff0 = 1;
      this.lookDone = null;
    } else {
      this.snapLookCentred();
    }
    this.apply();
  }

  /** Turn in place to look at a lat/lon on the Earth (unit sphere). */
  lookAtEarth(lat: number, lon: number, opts: { duration?: number; instant?: boolean; onDone?: () => void } = {}) {
    dirFromLatLon(lat, lon, this.tmpC);
    this.lookAtPoint(new THREE.Vector3(this.tmpC[0], this.tmpC[1], this.tmpC[2]), opts);
  }

  /**
   * End a gaze: the look eases back to the focus (tracking it live) over 0.6 s. The position is untouched and nothing drops.
   */
  clearGaze() {
    this.recentreLook({ duration: 0.6 });
  }

  /**
   * Ease the look point back to the focus, tracking the focus as it moves (default 0.7 s). Position untouched.
   * Already centred: `onDone` fires at once. Already recentring: it carries on rather than restarting, so repeated
   * input (wheel ticks) does not stall the ease.
   */
  recentreLook(opts: { duration?: number; onDone?: () => void } = {}) {
    if (this.lookTrack && this.lookGoal === 0) {
      if (this.lookT >= 1) {
        opts.onDone?.();
        return;
      }
      if (opts.onDone) this.lookDone = opts.onDone;
      return;
    }
    const dur = this.opts.reduced ? 0 : (opts.duration ?? 0.7);
    this.beginLook(null, 0, dur, opts.onDone ?? null);
  }

  /** Start a look turn from the current look point: to `to` (held), or to the focus when `to` is null (recentre). */
  private beginLook(to: THREE.Vector3 | null, goal: 0 | 1, dur: number, done: (() => void) | null) {
    const off = this.lookOffset;
    this.lookPoint(this.lookTmp);
    this.lookFrom.copy(this.lookTmp);
    this.lookTrack = to === null;
    if (to) this.lookTo.copy(to);
    this.lookOff0 = off;
    this.lookGoal = goal;
    this.lookDur = Math.max(dur, 1e-3);
    this.lookT = dur <= 0 ? 1 : 0;
    this.lookDone = done;
    this.apply();
    if (this.lookT >= 1) this.finishLook();
  }

  private stepLook(dt: number) {
    if (this.lookT >= 1) return;
    this.lookT = Math.min(1, this.lookT + dt / this.lookDur);
    if (this.lookT >= 1) this.finishLook();
  }

  /** Centre the look on the focus at once, with no turn (instant flights). */
  private snapLookCentred() {
    this.lookTrack = true;
    this.lookT = 1;
    this.lookGoal = 0;
    this.lookOff0 = 0;
    this.lookDone = null;
  }

  private finishLook() {
    const cb = this.lookDone;
    this.lookDone = null;
    cb?.();
  }

  /**
   * Frame the point at (lat, lon) from distance `dist`, flying along the great circle.
   * `lift` (Earth radii at mid-flight) defaults from the hop's angle; pass 0 for a pure drop or a turn that must not climb.
   */
  flyTo(lat: number, lon: number, dist: number, opts: { duration?: number; instant?: boolean; lift?: number } = {}) {
    const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    const to = dirFromLatLon(clampedLat, lon);
    const from = dirFromLatLon(this.lat, this.lon);
    const d1 = Math.max(MIN_DIST + 0.02, Math.min(this.softCap(), dist));
    this.vLat = this.vLon = 0;
    this.anchor = null;
    // a flight is a journey of its own: it ends any arrival settle, and the arrival it was by wheel no longer stands
    this.settleTo = null;
    this.wheelDriven = false;
    this.flyEndCbs.length = 0;
    const ang = angleBetween(from, to);
    if (opts.instant || (ang < 1e-4 && Math.abs(d1 - this.dist) < 1e-3)) {
      this.lat = clampedLat;
      this.lon = wrapLon(lon);
      this.dist = this.targetDist = d1;
      this.fly = null;
      if (opts.instant) this.snapLookCentred();
      else this.recentreLook({ duration: 0.6 });
      this.apply();
      return;
    }
    let dur = opts.duration ?? Math.min(3.8, 1.3 + ang * 1.15 + Math.abs(Math.log((d1 - 1) / Math.max(this.dist - 1, 0.05))) * 0.42);
    if (this.opts.reduced) dur *= 0.4;
    // a long hop pulls the camera back mid-flight so the journey reads spatially
    const lift = opts.lift !== undefined ? opts.lift : Math.min(1.25, ang * 0.62) * Math.min(1, 0.55 + ang);
    this.fly = { t: 0, dur, from, to, d0: this.dist, d1, lift };
    this.targetDist = d1;
    // a held look eases back to the focus during the flight, so the flight ends centred and is not bent by a gaze
    this.recentreLook({ duration: Math.min(dur * 0.6, 1.0) });
  }

  setShift(x: number, y: number) {
    this.tShiftX = x;
    this.tShiftY = y;
  }

  /**
   * Stop a flight where it is. The camera keeps going in the direction it was
   * moving, decaying, so taking over never feels like hitting a wall.
   */
  cancelFly(carry = true) {
    // every input comes through here: it ends an arrival settle, and a key, drag or wheel that follows is its own gesture
    this.settleTo = null;
    this.wheelDriven = false;
    this.flyEndCbs.length = 0;
    if (!this.fly) return;
    this.fly = null;
    this.targetDist = this.dist;
    if (carry) {
      this.vLat = this.flyVLat * 0.55;
      this.vLon = this.flyVLon * 0.55;
    }
  }

  /** Keyboard / programmatic nudges. */
  nudge(dLat: number, dLon: number) {
    this.markInteracted();
    this.clearGaze();
    this.cancelFly();
    this.anchor = null;
    this.vLat += dLat;
    this.vLon += dLon;
  }

  zoomBy(factor: number) {
    this.markInteracted();
    this.clearGaze();
    this.cancelFly();
    this.anchor = null;
    this.targetDist = clampDist(1 + (this.targetDist - 1) * Math.pow(factor, 1.5), this.maxDist);
  }

  private markInteracted() {
    if (!this.interacted) {
      this.interacted = true;
      this.opts.onInteract();
    }
  }

  // ── screen ↔ sphere ─────────────────────────────────────────────────────
  private lens(): Lens {
    return { fovDeg: this.camera.fov, aspect: this.camera.aspect, shiftX: this.shiftX, shiftY: this.shiftY };
  }

  private ndc(clientX: number, clientY: number): [number, number] {
    const r = this.dom.getBoundingClientRect();
    return [((clientX - r.left) / Math.max(r.width, 1)) * 2 - 1, 1 - ((clientY - r.top) / Math.max(r.height, 1)) * 2];
  }

  /** The surface point under a client position, or null over empty space or too near the limb to grab reliably. */
  private surfaceAt(clientX: number, clientY: number, grabbable = false): Vec3 | null {
    const [nx, ny] = this.ndc(clientX, clientY);
    const p = surfacePointAt({ lat: this.lat, lon: this.lon, dist: this.dist }, this.lens(), nx, ny);
    if (!p) return null;
    if (grabbable) {
      const c = dirFromLatLon(this.lat, this.lon, this.tmpC);
      if (p[0] * c[0] + p[1] * c[1] + p[2] * c[2] < 0.2) return null;
    }
    return p;
  }

  private setAnchor(clientX: number, clientY: number, grabbable = false): boolean {
    const p = this.surfaceAt(clientX, clientY, grabbable);
    if (!p) {
      this.anchor = null;
      return false;
    }
    const [nx, ny] = this.ndc(clientX, clientY);
    this.anchor = { p, nx, ny };
    return true;
  }

  /** Re-aim so the anchored surface point sits under its screen point. */
  private applyAnchor(): boolean {
    const a = this.anchor;
    if (!a) return false;
    const ll = anchorView({ lat: this.lat, lon: this.lon, dist: this.dist }, this.lens(), a.p, a.nx, a.ny);
    if (!ll) return false;
    this.lat = ll.lat;
    this.lon = ll.lon;
    return true;
  }

  // ── pointer ─────────────────────────────────────────────────────────────
  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try { this.dom.setPointerCapture(e.pointerId); } catch { /* synthetic or already-gone pointer */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.markInteracted();
    this.clearGaze();
    this.opts.onGrab();
    this.cancelFly(false);
    this.vLat = this.vLon = 0;
    this.targetDist = this.dist; // taking hold stops any zoom easing in flight
    if (this.pointers.size === 1) {
      this.downT = performance.now();
      this.lastMoveT = this.downT;
      this.moved = 0;
      this.dragging = true;
      this.setAnchor(e.clientX, e.clientY, true);
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d0: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 10), dist0: this.dist };
      this.setAnchor((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.moved = 999;
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') this.opts.onHover(e.clientX, e.clientY, true);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 1) {
      this.moved += Math.abs(dx) + Math.abs(dy);
      // a drag is the user's own orbit: it ends the arrival settle for good, until the next wheel or pinch
      if (dx || dy) { this.lastDragAt = performance.now(); this.wheelDriven = false; this.settleTo = null; }
      const pl = this.lat;
      const pn = this.lon;
      let moved = false;
      if (this.anchor) {
        [this.anchor.nx, this.anchor.ny] = this.ndc(e.clientX, e.clientY);
        moved = this.applyAnchor();
      }
      if (!moved) {
        // no grabbable surface under the pointer: rotate by a distance-scaled step
        // capped: beyond the atlas's own distances a pixel is a quarter-degree of orbit, not a continent
        const k = Math.min(degPerPixel(this.dist, this.camera.fov, this.dom.clientHeight || 800), DRAG_DEG_PER_PX_MAX);
        const cosLat = Math.max(Math.cos((this.lat * Math.PI) / 180), 0.35);
        this.lon = wrapLon(this.lon - (dx * k) / cosLat);
        this.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, this.lat + dy * k));
      }
      const now = performance.now();
      const dt = Math.max(8, now - this.lastMoveT) / 1000;
      this.lastMoveT = now;
      // smoothed release velocity (deg/s)
      let dLon = this.lon - pn;
      if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
      const dLat = this.lat - pl;
      this.vLon = clampV(this.vLon * 0.6 + (dLon / dt) * 0.4);
      this.vLat = clampV(this.vLat * 0.6 + (dLat / dt) * 0.4);
      this.apply();
    } else if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 10);
      // fingers apart → closer: altitude scales inversely with the finger span
      this.dist = this.targetDist = clampDist(1 + (this.pinch.dist0 - 1) * (this.pinch.d0 / d), this.softCap());
      this.lastWheelAt = performance.now();
      this.wheelDriven = true;
      if (this.anchor) {
        [this.anchor.nx, this.anchor.ny] = this.ndc((a.x + b.x) / 2, (a.y + b.y) / 2);
        this.applyAnchor();
      }
      this.apply();
    }
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (this.pointers.size === 1) {
      // one finger lifts from a pinch: carry on dragging with the other, without a jump
      this.pinch = null;
      const [r] = [...this.pointers.values()];
      this.setAnchor(r.x, r.y, true);
      this.vLat = this.vLon = 0;
      return;
    }
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.anchor = null;
      this.pinch = null;
      const now = performance.now();
      const quick = now - this.downT < 450;
      if (e.type === 'pointerup' && this.moved < 6 && quick) {
        this.vLat = this.vLon = 0;
        const t = this.lastTap;
        if (t && now - t.t < 340 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 30 && !this.opts.isOverPresence?.(e.clientX, e.clientY)) {
          this.lastTap = null;
          this.zoomAt(e.clientX, e.clientY, DOUBLE_ZOOM);
          return;
        }
        this.lastTap = { t: now, x: e.clientX, y: e.clientY };
        this.opts.onClick(e.clientX, e.clientY);
      } else if (now - this.lastMoveT > 90) {
        this.vLat = this.vLon = 0; // held still before release: no fling
      }
    }
  };

  /** Ease the altitude by `factor` toward the surface point under a client position. */
  zoomAt(clientX: number, clientY: number, factor: number) {
    this.markInteracted();
    this.clearGaze();
    this.opts.onGrab();
    this.cancelFly();
    this.vLat = this.vLon = 0;
    this.setAnchor(clientX, clientY);
    this.targetDist = clampDist(1 + (this.targetDist - 1) * factor, this.maxDist);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.markInteracted();
    this.clearGaze();
    this.opts.onGrab();
    this.cancelFly();
    if (this.pointers.size) return;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 400;
    if (e.deltaX && !dy) return; // horizontal scroll: ignore
    const before = this.targetDist;
    // beyond the hard limit (the sky still loading) an outward step resists: it moves on, slowly, rather than stalling
    const resist = dy > 0 && before >= this.maxDist && this.softCap() > this.maxDist ? SOFT_RESIST : 1;
    this.targetDist = zoomedDist(this.targetDist, dy * resist, e.ctrlKey, this.softCap()); // trackpad pinch sends ctrl+wheel
    if (this.targetDist === before) return;
    this.lastWheelAt = performance.now();
    this.wheelDriven = true;
    // choose the point under the cursor when a zoom begins or the cursor has moved;
    // while the gesture continues it stays the same point
    const w = this.wheelPos;
    const now = performance.now();
    if (!this.anchor || now - w.t > 220 || Math.hypot(e.clientX - w.x, e.clientY - w.y) > 4) {
      this.vLat = this.vLon = 0;
      this.setAnchor(e.clientX, e.clientY);
    }
    w.x = e.clientX; w.y = e.clientY; w.t = now;
  };

  // Safari: trackpad pinch
  private onGestureStart = (e: Event) => {
    e.preventDefault();
    this.markInteracted();
    this.opts.onGrab();
    this.cancelFly();
    const g = e as unknown as { clientX: number; clientY: number };
    this.gesture = { dist0: this.dist };
    this.targetDist = this.dist;
    this.setAnchor(g.clientX, g.clientY);
  };
  private onGestureChange = (e: Event) => {
    e.preventDefault();
    if (!this.gesture) return;
    const g = e as unknown as { scale: number };
    this.dist = this.targetDist = clampDist(1 + (this.gesture.dist0 - 1) / Math.max(g.scale, 0.05), this.softCap());
    this.lastWheelAt = performance.now();
    this.wheelDriven = true;
    this.applyAnchor();
    this.apply();
  };
  private onGestureEnd = (e: Event) => {
    e.preventDefault();
    this.gesture = null;
    this.anchor = null;
  };

  // ── per-frame ───────────────────────────────────────────────────────────
  update(dt: number) {
    dt = Math.min(dt, 0.1);
    const sk = 1 - Math.exp(-dt * 4.2);
    this.shiftX += (this.tShiftX - this.shiftX) * sk;
    this.shiftY += (this.tShiftY - this.shiftY) * sk;

    if (this.fly) {
      const f = this.fly;
      const pLat = this.lat;
      const pLon = this.lon;
      f.t += dt / f.dur;
      const t = Math.min(1, f.t);
      const e = easeInOutCubic(t);
      slerp(f.from, f.to, e, this.tmpA);
      const ll = latLonFromDir(this.tmpA);
      this.lat = ll.lat;
      this.lon = ll.lon;
      // altitude interpolates in log space (even-feeling at any scale) plus a mid-flight lift
      const h0 = Math.max(f.d0 - 1, 0.04);
      const h1 = Math.max(f.d1 - 1, 0.04);
      this.dist = 1 + Math.exp(Math.log(h0) + (Math.log(h1) - Math.log(h0)) * e) + f.lift * Math.sin(Math.PI * t);
      let dLon = this.lon - pLon;
      if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
      this.flyVLat = (this.lat - pLat) / Math.max(dt, 1e-3);
      this.flyVLon = dLon / Math.max(dt, 1e-3);
      if (t >= 1) {
        this.fly = null;
        this.dist = this.targetDist = f.d1;
        const cbs = this.flyEndCbs.splice(0);
        for (const cb of cbs) cb();
      }
    } else {
      if (!this.dragging) {
        if (this.autoRotate && !this.interacted && !this.opts.reduced) {
          this.lon = wrapLon(this.lon - 2.1 * dt); // the world turns east: the view drifts west
        } else {
          const damp = Math.exp(-dt * 3.1);
          this.lon = wrapLon(this.lon + this.vLon * dt);
          this.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, this.lat + this.vLat * dt));
          this.vLon *= damp;
          this.vLat *= damp;
          if (Math.abs(this.vLon) < 0.02) this.vLon = 0;
          if (Math.abs(this.vLat) < 0.02) this.vLat = 0;
        }
      }
      // an arrival settle turns the view toward the system's canonical pose, distance unchanged (only while the hand is off it)
      if (this.settleTo && !this.dragging && this.pointers.size === 0 && !this.gesture) this.stepSettle(dt);
      const cap = this.softCap();
      if (this.targetDist > cap) this.targetDist = cap; // the window grew narrower
      if (this.pointers.size < 2 && !this.gesture) {
        const nd = easeDist(this.dist, this.targetDist, dt);
        if (nd !== this.dist) {
          this.dist = nd;
          // zooming keeps the chosen surface point under the cursor
          if (this.anchor) this.applyAnchor();
        } else if (!this.dragging) {
          this.anchor = null;
        }
      }
    }
    this.stepLook(dt);
    this.apply();
  }

  /** The furthest the target may stand: the soft limit while the sky loads, else the hard `maxDist`. */
  private softCap(): number {
    return this.softMaxDist > this.maxDist ? this.softMaxDist : this.maxDist;
  }

  /**
   * Turn the view toward `settleTo` by the eased, speed-capped step (stages.ts `settleStep`), along the great circle, at the
   * same distance. Done when within `SETTLE.doneDeg`; a finished arrival is spent (`wheelDriven` clears), so it cannot re-fire.
   */
  private stepSettle(dt: number) {
    const to = this.settleTo;
    if (!to) return;
    const a = dirFromLatLon(this.lat, this.lon, this.tmpS);
    const b = dirFromLatLon(to.lat, to.lon, this.tmpT);
    const ang = angleBetween(a, b) * R2D;
    if (ang < SETTLE.doneDeg) {
      this.lat = to.lat;
      this.lon = wrapLon(to.lon);
      this.settleTo = null;
      this.wheelDriven = false;
      return;
    }
    const p = slerp(a, b, Math.min(1, settleStep(ang, dt) / ang), this.tmpA);
    const ll = latLonFromDir(p);
    this.lat = ll.lat;
    this.lon = ll.lon;
  }

  /** The orbit position, focus + dir(lat, lon)·dist, written into `out`. */
  private orbitPos(out: THREE.Vector3): THREE.Vector3 {
    dirFromLatLon(this.lat, this.lon, this.tmpC);
    const f = this.focus;
    return out.set(f.x + this.tmpC[0] * this.dist, f.y + this.tmpC[1] * this.dist, f.z + this.tmpC[2] * this.dist);
  }

  private apply() {
    this.orbitPos(this.camera.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookPoint(this.lookTmp));
  }
}

function clampV(v: number): number {
  return Math.max(-FLING_MAX, Math.min(FLING_MAX, v));
}
