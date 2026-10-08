// The globe: renderer, camera rig, layers, atmosphere and per-frame plumbing.
import * as THREE from 'three';
import type { Model } from '../data/model';
import { clonePalette, easeInOutCubic, mixPalette, WORLD_PALETTE, type RGBPalette } from '../data/palette';
import type { Vec3 } from '../data/geo';
import type { TimeModel } from '../state/timeModel';
import { DEFAULT_RAMP } from '../data/time';
import { CameraRig } from './controls';
import { Arcs, Marker } from './arcs';
import { Aura, AtmosphereShell, Backdrop, Earth, hiResChoice, loadBaseHi, loadBaseLo } from './earth';
import { Presences } from './presences';
import { createShared, type Shared } from './shared';
import { TileLayer } from './tiles';
import { depthPlanes, sunWeight, surfaceWeight } from '../sky/stages';
import type { SkyLayer } from '../sky/layer';
import type { BodyKey } from '../types/sky';
import { wrapLon } from '../data/geo';

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
  /** a body of the sky layer was picked */
  onSkyPick?(key: BodyKey): void;
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
  earth!: Earth;
  tiles!: TileLayer;
  /** the sky layer, once its data has loaded (absent: the atlas exactly as it was) */
  sky: SkyLayer | null = null;
  /** false once the globe is too small for its constant-pixel surface layers to read (sky stages) */
  private surfaceOn = true;
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
  baseKind: '2k' | '4k' | '8k' = '2k';
  baseUploadMs = 0;
  private running = true;
  private paused = false;

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
      isOverPresence: (x, y) => !!this.presences && this.surfaceOn && this.presences.pick(x, y, this.camera, this.width, this.height, this.pickRadius()) >= 0,
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
    const lo = await loadBaseLo(this.renderer);
    this.presences = new Presences(this.model, this.shared, this.renderer);
    this.earth = new Earth(this.shared, lo, this.presences.densityTarget.texture);
    this.tiles = new TileLayer(this.renderer, this.earth.u, this.reduced);
    this.scene.add(this.backdrop.mesh, this.earth.mesh, this.tiles.group, this.shell.mesh, this.presences.mesh, this.arcs.group, this.aura.points, this.markers.sel.mesh, this.markers.hover.mesh, this.markers.head.mesh);
    this.palDirty = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
    void this.upgradeBase();
  }

  /** After first paint: fetch the sharp base, upload it quietly, then blend it in. */
  private async upgradeBase() {
    const which = hiResChoice(this.renderer);
    this.tiles.minEmit = which === '8k' ? 6 : 5;
    if (!which) return;
    try {
      await new Promise((r) => setTimeout(r, 700));
      const hi = await loadBaseHi(this.renderer, which);
      // wait for a calm frame: the upload of a big texture is one long GPU call
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const t0 = performance.now();
      this.renderer.initTexture(hi);
      this.baseUploadMs = performance.now() - t0;
      this.earth.setHi(hi);
      this.baseKind = which;
    } catch (err) {
      console.warn('hi-res base unavailable', err);
    }
  }

  /**
   * Stop drawing the globe (the graph mode is up) without stopping the clock: time, the camera rig, the
   * palette tween and frame callbacks keep running; the GPU work (presences, tiles, markers, render) does not.
   */
  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) this.last = performance.now();
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

  /** Add the sky layer to the scene. Idempotent. */
  attachSky(layer: SkyLayer) {
    if (this.sky === layer) return;
    this.sky = layer;
    this.scene.add(layer.group);
    layer.setSize(this.width, this.height, this.pr);
    // compile the sky's programs now, while the Earth is on screen, so the first pull-back does not hitch
    const was: [THREE.Object3D, boolean][] = [];
    layer.group.traverse((o) => { was.push([o, o.visible]); o.visible = true; });
    try { this.renderer.compile(this.scene, this.camera); } catch { /* compiled on first draw instead */ }
    for (const [o, v] of was) o.visible = v;
  }

  /**
   * The Earth's light: the atlas's composed key light near the surface, the true Sun's from the lunar stage outward.
   * The share eases (never pops) when the sky's data arrives or the distance changes quickly; where the sky cannot
   * say where the Sun is (a moment outside the generated span) it stays the atlas's.
   */
  private sunShare = 0;
  private stepSun(dt: number) {
    const target = this.sky?.sunKnown ? sunWeight(this.rig.dist) : 0;
    this.sunShare = this.reduced || Math.abs(target - this.sunShare) < 1e-4 ? target : this.sunShare + (target - this.sunShare) * (1 - Math.exp(-dt * 3.5));
    if (this.sky?.sunKnown) this.earth.sunDir.value.copy(this.sky.sunDir);
    this.earth.sunMix.value = this.sunShare;
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
    this.sky?.setSize(w, h, this.pr);
  };

  // ── picking ────────────────────────────────────────────────────────────
  private pickRadius(): number {
    // generous and magnetic: the nearest live presence within reach is the one you mean
    return matchMedia('(pointer: coarse)').matches ? 34 : 22;
  }

  private handleClick(x: number, y: number) {
    const body = this.sky?.pick(x, y, this.pickRadius() * 0.8);
    if (body) {
      this.cb.onSkyPick?.(body);
      return;
    }
    const idx = this.presences && this.surfaceOn ? this.presences.pick(x, y, this.camera, this.width, this.height, this.pickRadius() * 1.2) : -1;
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

    // the sky: where the camera looks, and carrying the camera with the sky as the pull-back hands off
    if (this.sky) {
      const { focus, dLon } = this.sky.prepare(this.rig.dist);
      this.rig.focus.copy(focus);
      if (dLon) this.rig.lon = wrapLon(this.rig.lon + dLon);
    }
    this.stepSun(dt);
    this.rig.update(dt);
    // the clip planes follow the altitude so depth stays precise from orbit to the ground
    const camDist = this.camera.position.length();
    const planes = depthPlanes(camDist, !!this.sky);
    this.camera.near = planes.near;
    this.camera.far = planes.far;
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
    const e = this.camera.projectionMatrix.elements;
    e[8] = -this.rig.shiftX;
    e[9] = -this.rig.shiftY;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    this.sky?.update(this.camera, this.rig.dist, this.width, this.height);

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

    if (this.paused) {
      for (const f of this.frameCbs) f(dt, t);
      return;
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

    const surface = this.sky ? surfaceWeight(dist) : 1;
    this.presences.setSizeFor(dist, surface);
    this.setSurface(surface);
    this.presences.step(dt);
    if (render) this.presences.renderDensity();
    this.earth.step(dt, this.reduced);
    this.tiles.update(this.camera, dt, this.width, this.height);
    this.markers.sel.step(dt, this.camera, this.height);
    this.markers.hover.step(dt, this.camera, this.height);
    this.markers.head.step(dt, this.camera, this.height);

    // hover (CPU pick, once per frame, only when the pointer moved)
    if (this.pointer.dirty) {
      this.pointer.dirty = false;
      let idx = -1;
      if (this.pointer.inside && this.surfaceOn && !this.rig.dragging && !this.rig.flying) {
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

  /** The atlas's surface layers fade as the pull-back passes the Moon; fully off, they are not drawn. */
  private setSurface(w: number) {
    const on = w > 0.002;
    this.surfaceOn = on;
    this.presences.mesh.visible = on;
    this.aura.points.visible = on;
    this.arcs.group.visible = on;
    this.tiles.group.visible = on;
    for (const m of [this.markers.sel, this.markers.hover, this.markers.head]) m.suppressed = !on;
  }

  /** Test/debug hook: current camera state. */
  get cameraState() {
    return { lat: this.rig.lat, lon: this.rig.lon, dist: this.rig.dist };
  }
}
