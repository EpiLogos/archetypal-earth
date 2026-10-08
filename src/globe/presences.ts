// Occurrences as soft glowing presences: one instanced draw for the points and
// one instanced pass into an equirect density texture that the earth samples.
import * as THREE from 'three';
import type { Model } from '../data/model';
import { timeVisibility, type TimeWindow } from '../data/time';
import { PRESENCE_FRAG, PRESENCE_VERT, SPLAT_FRAG, SPLAT_VERT } from './shaders';
import type { Shared } from './shared';

const PREC: Record<string, number> = { place: 0, region: 1, culture: 2, none: 3 };

export class Presences {
  readonly mesh: THREE.Mesh;
  readonly densityTarget: THREE.WebGLRenderTarget;
  readonly densityScene = new THREE.Scene();
  readonly densityCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  readonly rel: Float32Array;
  private relTarget: Float32Array;
  private relAttr: THREE.InstancedBufferAttribute;
  private n: number;
  private focusCore = { value: new THREE.Vector3(1, 1, 1) };
  private focusMix = { value: 0 };
  private focusMixTarget = 0;
  private sizeK = { value: 1 };
  private relAnimating = false;
  densityDirty = true;
  private lastSig = '';
  private camDirTmp = new THREE.Vector3();

  constructor(private model: Model, private shared: Shared, private renderer: THREE.WebGLRenderer) {
    const n = (this.n = model.occ.length);
    const dir = new Float32Array(n * 3);
    const ll = new Float32Array(n * 2);
    const col = new Float32Array(n * 3);
    const glowCol = new Float32Array(n * 3);
    const meta = new Float32Array(n * 4);
    this.rel = new Float32Array(n).fill(1);
    this.relTarget = new Float32Array(n).fill(1);

    for (let i = 0; i < n; i++) {
      const o = model.occ[i];
      const d = model.dir[i];
      dir.set(d, i * 3);
      ll[i * 2] = (o.lon * Math.PI) / 180;
      ll[i * 2 + 1] = (o.lat * Math.PI) / 180;
      col.set(model.colour[i], i * 3);
      glowCol.set(model.famPalette.get(o.familyId)?.glow ?? model.colour[i], i * 3);
      const prec = model.located[i] ? PREC[o.geoPrecision] ?? 0 : 3;
      const seed = hash01(i);
      meta[i * 4] = model.u[i];
      meta[i * 4 + 1] = 5.4 + seed * 1.8;
      meta[i * 4 + 2] = prec;
      meta[i * 4 + 3] = seed;
    }
    const aDir = new THREE.InstancedBufferAttribute(dir, 3);
    const aLL = new THREE.InstancedBufferAttribute(ll, 2);
    const aColor = new THREE.InstancedBufferAttribute(col, 3);
    const aGlow = new THREE.InstancedBufferAttribute(glowCol, 3);
    const aMeta = new THREE.InstancedBufferAttribute(meta, 4);
    this.relAttr = new THREE.InstancedBufferAttribute(this.rel, 1);
    this.relAttr.setUsage(THREE.DynamicDrawUsage);

    const quad = (g: THREE.InstancedBufferGeometry) => {
      g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.instanceCount = n;
    };

    // ── presence points
    const geo = new THREE.InstancedBufferGeometry();
    quad(geo);
    geo.setAttribute('aDir', aDir);
    geo.setAttribute('aColor', aColor);
    geo.setAttribute('aMeta', aMeta);
    geo.setAttribute('aRel', this.relAttr);
    const mat = new THREE.ShaderMaterial({
      vertexShader: PRESENCE_VERT,
      fragmentShader: PRESENCE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      // screen blend: overlaps keep their hue and can never exceed white
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
      uniforms: {
        uCursor: shared.cursor, uTrail: shared.trail, uRamp: shared.ramp, uTimeOn: shared.timeOn,
        uCamDir: shared.camDir, uCamDist: shared.camDist, uRes: shared.res, uPx: shared.px, uTime: shared.time,
        uSizeK: this.sizeK, uFocusCore: this.focusCore, uFocusMix: this.focusMix,
      },
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;

    // ── density splats (three copies across the dateline)
    const sgeo = new THREE.InstancedBufferGeometry();
    quad(sgeo);
    sgeo.setAttribute('aLL', aLL);
    sgeo.setAttribute('aGlow', aGlow);
    sgeo.setAttribute('aMeta', aMeta);
    sgeo.setAttribute('aRel', this.relAttr);
    for (const off of [0, -2, 2]) {
      const sm = new THREE.ShaderMaterial({
        vertexShader: SPLAT_VERT,
        fragmentShader: SPLAT_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uCursor: shared.cursor, uTrail: shared.trail, uRamp: shared.ramp, uTimeOn: shared.timeOn,
          uOffset: { value: off },
        },
      });
      const m = new THREE.Mesh(sgeo, sm);
      m.frustumCulled = false;
      this.densityScene.add(m);
    }
    this.densityTarget = new THREE.WebGLRenderTarget(1024, 512, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });
  }

  /** Targets are rel values (see REL_GLSL); they ease in over ~1.2s. */
  setTargets(t: Float32Array | null) {
    if (t) this.relTarget.set(t);
    else this.relTarget.fill(1);
    this.relAnimating = true;
  }

  setFocusTint(core: [number, number, number], on: boolean) {
    this.focusCore.value.set(core[0], core[1], core[2]);
    this.focusMixTarget = on ? 1 : 0;
  }

  setSizeFor(dist: number, surface = 1) {
    // regional zoom lets the presences breathe a little larger; the sky stages shrink them away with the globe
    this.sizeK.value = (1 + Math.max(0, 2.4 - dist) * 0.12) * surface;
  }

  step(dt: number) {
    const fm = this.focusMix.value;
    if (Math.abs(fm - this.focusMixTarget) > 0.001) {
      this.focusMix.value = fm + (this.focusMixTarget - fm) * (1 - Math.exp(-dt * 2.6));
    }
    if (this.relAnimating) {
      const k = 1 - Math.exp(-dt * 3.4);
      let moving = false;
      for (let i = 0; i < this.n; i++) {
        const d = this.relTarget[i] - this.rel[i];
        if (d > 0.002 || d < -0.002) {
          this.rel[i] += d * k;
          moving = true;
        } else this.rel[i] = this.relTarget[i];
      }
      this.relAttr.needsUpdate = true;
      this.relAnimating = moving;
      this.densityDirty = true;
    }
  }

  /** Re-render the density texture when time or emphasis changed. */
  renderDensity() {
    const s = this.shared;
    const sig = `${s.cursor.value.toFixed(4)}|${s.trail.value.toFixed(3)}|${s.timeOn.value.toFixed(3)}`;
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.densityDirty = true;
    }
    if (!this.densityDirty) return;
    this.densityDirty = false;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevClear = new THREE.Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.densityTarget);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.densityScene, this.densityCam);
    r.setRenderTarget(prev);
    r.setClearColor(prevClear, prevAlpha);
  }

  get window(): TimeWindow {
    const s = this.shared;
    return { on: s.timeOn.value, cursorU: s.cursor.value, trail: s.trail.value, ramp: s.ramp.value };
  }

  /**
   * Nearest visible presence to a screen point (CSS px), or -1.
   * CPU-side so the field can hold thousands of points without picking buffers.
   */
  pick(sx: number, sy: number, camera: THREE.PerspectiveCamera, width: number, height: number, radius: number): number {
    const m = this.model;
    const w = this.window;
    const cam = camera.position;
    const camLen = cam.length();
    this.camDirTmp.copy(cam).divideScalar(camLen);
    const horizon = 1 / camLen + 0.04;
    const e = camera.projectionMatrix.elements;
    const v = camera.matrixWorldInverse.elements;
    let best = -1;
    let bestD = radius * radius;
    for (let i = 0; i < this.n; i++) {
      if (!m.located[i]) continue;
      const d = m.dir[i];
      if (d[0] * this.camDirTmp.x + d[1] * this.camDirTmp.y + d[2] * this.camDirTmp.z < horizon) continue;
      // everything the shader draws is selectable: the receded field stays reachable
      if (this.rel[i] < 0.02) continue;
      if (timeVisibility(m.u[i], w) < 0.5) continue;
      // view space
      const x = v[0] * d[0] + v[4] * d[1] + v[8] * d[2] + v[12];
      const y = v[1] * d[0] + v[5] * d[1] + v[9] * d[2] + v[13];
      const z = v[2] * d[0] + v[6] * d[1] + v[10] * d[2] + v[14];
      const cx = e[0] * x + e[8] * z;
      const cy = e[5] * y + e[9] * z;
      const cw = -z;
      if (cw <= 0) continue;
      const px = (cx / cw * 0.5 + 0.5) * width;
      const py = (1 - (cy / cw * 0.5 + 0.5)) * height;
      const dx = px - sx;
      const dy = py - sy;
      const prec = m.occ[i].geoPrecision;
      const reach = prec === 'culture' ? 1.9 : prec === 'region' ? 1.35 : 1;
      const dd = (dx * dx + dy * dy) / (reach * reach);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    return best;
  }
}

function hash01(i: number): number {
  let x = (i + 1) * 2654435761;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  return ((x >>> 0) % 10000) / 10000;
}
