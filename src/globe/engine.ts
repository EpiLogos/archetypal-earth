// The globe: renderer, camera rig, layers, atmosphere and per-frame plumbing.
import * as THREE from 'three';
import type { Model } from '../data/model';
import { clonePalette, easeInOutCubic, mixPalette, WORLD_PALETTE, type RGBPalette } from '../data/palette';
import type { Vec3 } from '../data/geo';
import type { TimeModel } from '../state/timeModel';
import { DEFAULT_RAMP } from '../data/time';
import { CameraRig } from './controls';
import { Arcs, Marker } from './arcs';
import { Aura, AtmosphereShell, Backdrop, Earth, loadTextures } from './earth';
import { Presences } from './presences';
import { createShared, type Shared } from './shared';

export interface ScreenPoint {
  x: number;
  y: number;
  /** >0 when the point faces the camera (0 at the horizon) */
  facing: number;
}

export interface EngineCallbacks {
  onPick(index: number): void;
  onHover(index: number, x: number, y: number): void;
  onInteract(): void;
  onGrab(): void;
  onPalette(p: RGBPalette): void;
}

export const FOV = 38;

export class GlobeEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.04, 60);
  readonly shared: Shared = createShared();
  readonly rig: CameraRig;
  readonly arcs: Arcs;
  readonly markers: { sel: Marker; hover: Marker; head: Marker };
  presences!: Presences;
  private earth!: Earth;
  private backdrop: Backdrop;
  private aura: Aura;
  private shell: AtmosphereShell;
  readonly ready: Promise<void>;

  private last = performance.now();
  private elapsed = 0;
  width = 1;
  height = 1;
  private pr = 1;
  private frameCbs: ((dt: number, t: number) => void)[] = [];

  // palette tween
  private curPal = clonePalette(WORLD_PALETTE);
  private fromPal = clonePalette(WORLD_PALETTE);
  private toPal = clonePalette(WORLD_PALETTE);
  private palT = 1;
  private palDur = 1.6;
  private palDirty = true;

  private pointer = { x: 0, y: 0, inside: false, dirty: false };
  private hoverIdx = -1;
  private tmpV = new THREE.Vector3();
  private raf = 0;
  private running = true;

  constructor(private parent: HTMLElement, private model: Model, private time: TimeModel, private cb: EngineCallbacks, readonly reduced: boolean) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x02030a, 1);
    this.renderer.domElement.className = 'globe-canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.renderer.domElement);

    this.rig = new CameraRig(this.camera, this.renderer.domElement, {
      reduced,
      onInteract: () => cb.onInteract(),
      onGrab: () => cb.onGrab(),
      onClick: (x, y) => this.handleClick(x, y),
      onHover: (x, y, inside) => {
        this.pointer.x = x;
        this.pointer.y = y;
        this.pointer.inside = inside;
        this.pointer.dirty = true;
      },
    });

    this.backdrop = new Backdrop(this.shared);
    this.shell = new AtmosphereShell(this.shared);
    this.aura = new Aura(this.shared);
    this.arcs = new Arcs(this.shared);
    this.markers = { sel: new Marker(this.shared, 26), hover: new Marker(this.shared, 17), head: new Marker(this.shared, 30) };

    this.ready = this.init();
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  private async init() {
    const tex = await loadTextures(this.renderer);
    this.presences = new Presences(this.model, this.shared, this.renderer);
    this.earth = new Earth(this.shared, tex, this.presences.densityTarget.texture);
    this.scene.add(this.backdrop.mesh, this.earth.mesh, this.shell.mesh, this.presences.mesh, this.arcs.group, this.aura.points, this.markers.sel.mesh, this.markers.hover.mesh, this.markers.head.mesh);
    this.palDirty = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
  }

  onFrame(cb: (dt: number, t: number) => void) {
    this.frameCbs.push(cb);
  }

  // ── palette ────────────────────────────────────────────────────────────
  setPalette(p: RGBPalette, seconds = 1.6) {
    this.fromPal = clonePalette(this.curPal);
    this.toPal = clonePalette(p);
    this.palT = 0;
    this.palDur = this.reduced ? Math.min(seconds, 0.5) : seconds;
  }

  get palette(): RGBPalette {
    return this.curPal;
  }

  // ── emphasis ───────────────────────────────────────────────────────────
  setEmphasis(targets: Float32Array | null, tint: [number, number, number] | null) {
    this.presences.setTargets(targets);
    this.presences.setFocusTint(tint ?? [1, 1, 1], !!tint);
  }

  // ── projection helpers for DOM overlays ────────────────────────────────
  project(dir: Vec3, out: ScreenPoint, radius = 1): ScreenPoint {
    const v = this.tmpV.set(dir[0] * radius, dir[1] * radius, dir[2] * radius).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (1 - (v.y * 0.5 + 0.5)) * this.height;
    const cd = this.camera.position.length();
    out.facing = (dir[0] * this.camera.position.x + dir[1] * this.camera.position.y + dir[2] * this.camera.position.z) / cd - 1 / cd;
    return out;
  }

  /** Screen position of the globe's centre and its radius in px. */
  globeDisc(out: { x: number; y: number; r: number }) {
    const v = this.tmpV.set(0, 0, 0).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (1 - (v.y * 0.5 + 0.5)) * this.height;
    const d = this.camera.position.length();
    const t = Math.tan((FOV * Math.PI) / 360);
    out.r = (1 / Math.sqrt(Math.max(d * d - 1, 0.01)) / t) * 0.5 * this.height;
  }

  private onResize = () => {
    const w = this.parent.clientWidth || window.innerWidth;
    const h = this.parent.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.pr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.shared.res.value.set(w * this.pr, h * this.pr);
    this.shared.px.value = this.pr;
  };

  // ── picking ────────────────────────────────────────────────────────────
  private pickRadius(): number {
    return (matchMedia('(pointer: coarse)').matches ? 26 : 15);
  }

  private handleClick(x: number, y: number) {
    const idx = this.presences ? this.presences.pick(x, y, this.camera, this.width, this.height, this.pickRadius() * 1.15) : -1;
    this.cb.onPick(idx);
  }

  // ── frame ──────────────────────────────────────────────────────────────
  /**
   * Test/diagnostic hook: stop the real-time loop and step the simulation by
   * a fixed dt (rendering only the last frame). Deterministic under load.
   */
  advance(seconds: number, step = 1 / 30) {
    this.running = false;
    cancelAnimationFrame(this.raf);
    const n = Math.max(1, Math.ceil(seconds / step));
    for (let i = 0; i < n; i++) this.frame(step, i === n - 1);
  }

  private frame(dtOverride?: number, render = true) {
    const now = performance.now();
    const dt = dtOverride ?? Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.elapsed += dt;
    const t = this.elapsed;
    const S = this.shared;
    S.time.value = t;

    this.time.update(dt);
    S.cursor.value = this.time.cursorU;
    S.trail.value = this.time.trail;
    S.ramp.value = DEFAULT_RAMP;
    S.timeOn.value = this.time.on;

    this.rig.update(dt);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
    const e = this.camera.projectionMatrix.elements;
    e[8] = -this.rig.shiftX;
    e[9] = -this.rig.shiftY;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();

    const dist = this.camera.position.length();
    S.camDist.value = dist;
    S.camDir.value.copy(this.camera.position).divideScalar(dist);

    // palette
    if (this.palT < 1) {
      this.palT = Math.min(1, this.palT + dt / this.palDur);
      mixPalette(this.fromPal, this.toPal, easeInOutCubic(this.palT), this.curPal);
      this.palDirty = true;
    }
    if (this.palDirty) {
      this.palDirty = false;
      const p = this.curPal;
      S.glow.value.set(...p.glow);
      S.core.value.set(...p.core);
      S.fog.value.set(...p.fog);
      S.deep.value.set(...p.deep);
      S.spec.value = p.spectrum;
      this.cb.onPalette(p);
    }

    // light follows the camera: always a soft key from upper-left
    const m = this.camera.matrixWorld.elements;
    this.earth.lightDir.value.set(
      S.camDir.value.x * 0.9 - m[0] * 0.55 + m[4] * 0.6,
      S.camDir.value.y * 0.9 - m[1] * 0.55 + m[5] * 0.6,
      S.camDir.value.z * 0.9 - m[2] * 0.55 + m[6] * 0.6,
    ).normalize();

    // backdrop anchors to the globe's screen position
    const c = this.tmpV.set(0, 0, 0).project(this.camera);
    this.backdrop.center.value.set(c.x, c.y);
    const tanH = Math.tan((FOV * Math.PI) / 360);
    this.backdrop.radius.value = 1 / Math.sqrt(Math.max(dist * dist - 1, 0.01)) / tanH;
    this.backdrop.parallax.value.set(this.rig.lon * 0.018, this.rig.lat * 0.018);

    this.presences.setSizeFor(dist);
    this.presences.step(dt);
    if (render) this.presences.renderDensity();
    this.markers.sel.step(dt, this.pr);
    this.markers.hover.step(dt, this.pr);
    this.markers.head.step(dt, this.pr);

    // hover (CPU pick, once per frame, only when the pointer moved)
    if (this.pointer.dirty) {
      this.pointer.dirty = false;
      let idx = -1;
      if (this.pointer.inside && !this.rig.dragging && !this.rig.flying) {
        idx = this.presences.pick(this.pointer.x, this.pointer.y, this.camera, this.width, this.height, this.pickRadius());
      }
      this.hoverIdx = idx;
      this.cb.onHover(idx, this.pointer.x, this.pointer.y);
    } else if (this.hoverIdx >= 0 && (this.rig.dragging || this.rig.flying)) {
      this.hoverIdx = -1;
      this.cb.onHover(-1, 0, 0);
    }

    for (const f of this.frameCbs) f(dt, t);
    if (render) this.renderer.render(this.scene, this.camera);
  }

  /** Test/debug hook: current camera state. */
  get cameraState() {
    return { lat: this.rig.lat, lon: this.rig.lon, dist: this.rig.dist };
  }
}
