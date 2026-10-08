// A north-up, inertial, damped orbit rig with great-circle flights.
// The camera is always (lat, lon, dist) around the origin — orientation is
// never lost because there is no roll and the pole is clamped.
import * as THREE from 'three';
import { dirFromLatLon, latLonFromDir, slerp, angleBetween, wrapLon, type Vec3 } from '../data/geo';
import { easeInOutCubic } from '../data/palette';

export const MIN_DIST = 1.1;
export const MAX_DIST = 5.4;
const MAX_LAT = 82;

interface Fly {
  t: number;
  dur: number;
  from: Vec3;
  to: Vec3;
  d0: number;
  d1: number;
  lift: number;
}

export interface RigOptions {
  reduced: boolean;
  onInteract(): void;
  /** every pointer-down / wheel — used to pause tours */
  onGrab(): void;
  onClick(x: number, y: number): void;
  onHover(x: number, y: number, inside: boolean): void;
}

export class CameraRig {
  lat = 24;
  lon = 26;
  dist = 3.8;
  targetDist = 3.8;
  shiftX = 0;
  shiftY = 0;
  tShiftX = 0;
  tShiftY = 0;
  autoRotate = true;
  /** how far the user may pull back (wider on portrait screens) */
  maxDist = MAX_DIST;
  interacted = false;
  /** true while the user holds the globe or a flight is running (UI pauses hover) */
  dragging = false;

  private vLat = 0;
  private vLon = 0;
  private fly: Fly | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart = 0;
  private pinchDist0 = 0;
  private downT = 0;
  private moved = 0;
  private lastMoveT = 0;
  private tmpA: Vec3 = [0, 0, 0];
  private tmpC: Vec3 = [0, 0, 0];
  private flyEndCbs: (() => void)[] = [];

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private opts: RigOptions) {
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointercancel', this.onUp);
    dom.addEventListener('pointerleave', () => opts.onHover(0, 0, false));
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.style.touchAction = 'none';
    this.apply();
  }

  get flying(): boolean {
    return this.fly !== null;
  }

  onFlyEnd(cb: () => void) {
    this.flyEndCbs.push(cb);
  }

  /** Where the camera currently looks. */
  centre(): { lat: number; lon: number } {
    return { lat: this.lat, lon: this.lon };
  }

  /** Frame the point at (lat, lon) from distance `dist`, flying along the great circle. */
  flyTo(lat: number, lon: number, dist: number, opts: { duration?: number; instant?: boolean } = {}) {
    const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
    const to = dirFromLatLon(clampedLat, lon);
    const from = dirFromLatLon(this.lat, this.lon);
    const d1 = Math.max(MIN_DIST + 0.02, Math.min(this.maxDist, dist));
    this.vLat = this.vLon = 0;
    const ang = angleBetween(from, to);
    if (opts.instant || (ang < 1e-4 && Math.abs(d1 - this.dist) < 1e-3)) {
      this.lat = clampedLat;
      this.lon = wrapLon(lon);
      this.dist = this.targetDist = d1;
      this.fly = null;
      this.apply();
      return;
    }
    let dur = opts.duration ?? Math.min(3.8, 1.3 + ang * 1.15 + Math.abs(d1 - this.dist) * 0.35);
    if (this.opts.reduced) dur *= 0.4;
    // a long hop pulls the camera back mid-flight so the journey reads spatially
    const lift = Math.min(1.25, ang * 0.62) * Math.min(1, 0.55 + ang);
    this.fly = { t: 0, dur, from, to, d0: this.dist, d1, lift };
    this.targetDist = d1;
  }

  setShift(x: number, y: number) {
    this.tShiftX = x;
    this.tShiftY = y;
  }

  cancelFly() {
    if (this.fly) {
      this.fly = null;
      this.targetDist = this.dist;
    }
  }

  /** Keyboard / programmatic nudges. */
  nudge(dLat: number, dLon: number) {
    this.markInteracted();
    this.cancelFly();
    this.vLat += dLat;
    this.vLon += dLon;
  }

  zoomBy(factor: number) {
    this.markInteracted();
    this.cancelFly();
    this.targetDist = Math.max(MIN_DIST, Math.min(this.maxDist, this.targetDist * factor));
  }

  private markInteracted() {
    if (!this.interacted) {
      this.interacted = true;
      this.opts.onInteract();
    }
  }

  private angularPerPixel(): number {
    const h = this.dom.clientHeight || 800;
    const fov = (this.camera.fov * Math.PI) / 180;
    return (2 * Math.tan(fov / 2) * Math.max(this.dist - 1, 0.1)) / h;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.dom.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.markInteracted();
    this.opts.onGrab();
    this.cancelFly();
    this.vLat = this.vLon = 0;
    if (this.pointers.size === 1) {
      this.downT = performance.now();
      this.moved = 0;
      this.dragging = true;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchStart = this.targetDist;
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
      const k = this.angularPerPixel() * (180 / Math.PI);
      const cosLat = Math.max(Math.cos((this.lat * Math.PI) / 180), 0.35);
      const dLon = (-dx * k) / cosLat;
      const dLat = dy * k;
      this.lon = wrapLon(this.lon + dLon);
      this.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, this.lat + dLat));
      const now = performance.now();
      const dt = Math.max(8, now - this.lastMoveT) / 1000;
      this.lastMoveT = now;
      // smoothed release velocity (deg/s)
      this.vLon = this.vLon * 0.6 + (dLon / dt) * 0.4;
      this.vLat = this.vLat * 0.6 + (dLat / dt) * 0.4;
      this.apply();
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist0 > 10) {
        this.targetDist = Math.max(MIN_DIST, Math.min(this.maxDist, this.pinchStart * (this.pinchDist0 / d)));
        this.dist = this.targetDist;
        this.apply();
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (this.pointers.size === 0) {
      this.dragging = false;
      const quick = performance.now() - this.downT < 450;
      if (e.type === 'pointerup' && this.moved < 6 && quick) {
        this.vLat = this.vLon = 0;
        this.opts.onClick(e.clientX, e.clientY);
      } else if (performance.now() - this.lastMoveT > 90) {
        this.vLat = this.vLon = 0; // held still before release: no fling
      }
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.markInteracted();
    this.opts.onGrab();
    this.cancelFly();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    const k = e.ctrlKey ? 0.012 : 0.0016; // trackpad pinch sends ctrl+wheel
    this.targetDist = Math.max(MIN_DIST, Math.min(this.maxDist, this.targetDist * Math.exp(dy * k)));
  };

  update(dt: number) {
    dt = Math.min(dt, 0.1);
    const sk = 1 - Math.exp(-dt * 4.2);
    this.shiftX += (this.tShiftX - this.shiftX) * sk;
    this.shiftY += (this.tShiftY - this.shiftY) * sk;

    if (this.fly) {
      const f = this.fly;
      f.t += dt / f.dur;
      const t = Math.min(1, f.t);
      const e = easeInOutCubic(t);
      slerp(f.from, f.to, e, this.tmpA);
      const ll = latLonFromDir(this.tmpA);
      this.lat = ll.lat;
      this.lon = ll.lon;
      this.dist = f.d0 + (f.d1 - f.d0) * e + f.lift * Math.sin(Math.PI * t);
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
          const damp = Math.exp(-dt * 2.9);
          this.lon = wrapLon(this.lon + this.vLon * dt);
          this.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, this.lat + this.vLat * dt));
          this.vLon *= damp;
          this.vLat *= damp;
          if (Math.abs(this.vLon) < 0.02) this.vLon = 0;
          if (Math.abs(this.vLat) < 0.02) this.vLat = 0;
        }
      }
      if (this.pointers.size < 2) this.dist += (this.targetDist - this.dist) * (1 - Math.exp(-dt * 7));
    }
    this.apply();
  }

  private apply() {
    dirFromLatLon(this.lat, this.lon, this.tmpC);
    this.camera.position.set(this.tmpC[0] * this.dist, this.tmpC[1] * this.dist, this.tmpC[2] * this.dist);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
  }
}
