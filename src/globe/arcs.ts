// Migratory arcs: the thread being followed (driven by the tour), and a subject's chronology drawn along the cursor.
import * as THREE from 'three';
import { slerp, angleBetween, type Vec3 } from '../data/geo';
import { CHRONO_MAX_HOPS, chronologyProgress } from './chronology';
import { ARC_FRAG, ARC_VERT, MARKER_FRAG, MARKER_VERT } from './shaders';
import type { Shared } from './shared';

// The chronology's arcs: the thread's look (the flow along the line, the same blend toward white), with each arc's
// own travel and presence from the cursor. A separate material, so the thread's shaders and uniforms are untouched.
const CHRONO_VERT = /* glsl */ `
attribute float aSeg;
attribute float aT;
attribute float aDist;
uniform float uSegDraw[${CHRONO_MAX_HOPS}];
uniform float uSegAlpha[${CHRONO_MAX_HOPS}];
varying float vT;
varying float vDist;
varying float vDraw;
varying float vAlpha;
void main() {
  int k = int(aSeg + 0.5);
  vDraw = uSegDraw[k];
  vAlpha = uSegAlpha[k];
  vT = aT;
  vDist = aDist;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const CHRONO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOn;
varying float vT;
varying float vDist;
varying float vDraw;
varying float vAlpha;
void main() {
  // the head sits at vDraw along the arc: ahead of it nothing, behind it the whole line (a finished arc is whole)
  float head = step(0.001, vDraw) * max(step(0.999, vDraw), 1.0 - smoothstep(vDraw - 0.02, vDraw + 0.02, vT));
  float a = vAlpha * head * uOn;
  if (a < 0.002) discard;
  float dash = fract(vDist * 5.5 - uTime * 0.22);
  float flow = smoothstep(0.0, 0.5, dash) * smoothstep(1.0, 0.5, dash);
  float v = (0.28 + 0.72 * flow * flow) * a;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.12 + 0.3 * flow), clamp(v * 0.4, 0.0, 1.0));
}
`;

export class Arcs {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private mat: THREE.ShaderMaterial;
  readonly uniforms = {
    uColor: { value: new THREE.Vector3(1, 1, 1) },
    uTime: { value: 0 },
    uDraw: { value: 0 },
    uHead: { value: 0 },
    uTour: { value: 0 },
    uFade: { value: 1 },
  };
  steps = 0;
  // the chronology: its own geometry and material; arc k (0-based) runs between nodes k and k+1
  private chrono: THREE.Mesh | null = null;
  private chronoMat: THREE.ShaderMaterial;
  private chronoU = {
    uColor: { value: new THREE.Vector3(1, 1, 1) },
    uTime: { value: 0 },
    uOn: { value: 0 },
    uSegDraw: { value: new Array<number>(CHRONO_MAX_HOPS).fill(0) },
    uSegAlpha: { value: new Array<number>(CHRONO_MAX_HOPS).fill(0) },
  };
  private chronoNodeU: number[] = [];

  constructor(shared: Shared) {
    this.uniforms.uTime = shared.time;
    this.chronoU.uTime = shared.time;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.chronoMat = new THREE.ShaderMaterial({
      vertexShader: CHRONO_VERT,
      fragmentShader: CHRONO_FRAG,
      uniforms: this.chronoU,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.group.renderOrder = 11;
  }

  clear() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.steps = 0;
  }

  /** Remove the chronology (the thread's arcs are untouched). */
  clearChronology() {
    if (this.chrono) {
      this.group.remove(this.chrono);
      this.chrono.geometry.dispose();
      this.chrono = null;
    }
    this.chronoNodeU = [];
    this.chronoU.uOn.value = 0;
  }

  /**
   * A subject's chronology: `dirs` are the path's places in date order, `nodeU` their slider-positions. Arc k runs from
   * place k to place k+1; `updateChronology` draws them along the cursor.
   */
  buildChronology(dirs: Vec3[], nodeU: number[], colour: [number, number, number]) {
    this.clearChronology();
    const N = dirs.length;
    if (N < 2 || N > CHRONO_MAX_HOPS + 1) return;
    this.chronoU.uColor.value.set(colour[0], colour[1], colour[2]);
    this.chronoNodeU = nodeU.slice();
    const pos: number[] = [];
    const aSeg: number[] = [];
    const aT: number[] = [];
    const aDist: number[] = [];
    const idx: number[] = [];
    const SIDES = 5;
    const R = 0.0021;
    let cum = 0;
    const a: Vec3 = [0, 0, 0];
    const p: Vec3 = [0, 0, 0];
    let prevCentre: Vec3 | null = null;
    for (let k = 1; k < N; k++) {
      const seg = k - 1;
      const ang = angleBetween(dirs[k - 1], dirs[k]);
      const n = Math.max(14, Math.ceil(ang * 46));
      const lift = 0.016 + 0.12 * (ang / Math.PI);
      const base = pos.length / 3;
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        slerp(dirs[k - 1], dirs[k], t, a);
        const r = 1.004 + lift * Math.sin(Math.PI * t);
        p[0] = a[0] * r; p[1] = a[1] * r; p[2] = a[2] * r;
        if (prevCentre) cum += Math.hypot(p[0] - prevCentre[0], p[1] - prevCentre[1], p[2] - prevCentre[2]);
        prevCentre = [p[0], p[1], p[2]];
        const t0 = Math.max(0, t - 0.01), t1 = Math.min(1, t + 0.01);
        const A: Vec3 = slerp(dirs[k - 1], dirs[k], t0, [0, 0, 0]);
        const B: Vec3 = slerp(dirs[k - 1], dirs[k], t1, [0, 0, 0]);
        const tx = B[0] - A[0], ty = B[1] - A[1], tz = B[2] - A[2];
        let sx = a[1] * tz - a[2] * ty, sy = a[2] * tx - a[0] * tz, sz = a[0] * ty - a[1] * tx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        sx /= sl; sy /= sl; sz /= sl;
        for (let q = 0; q < SIDES; q++) {
          const th = (q / SIDES) * Math.PI * 2;
          const c = Math.cos(th), si = Math.sin(th);
          pos.push(p[0] + (a[0] * c + sx * si) * R, p[1] + (a[1] * c + sy * si) * R, p[2] + (a[2] * c + sz * si) * R);
          aSeg.push(seg);
          aT.push(t);
          aDist.push(cum);
        }
      }
      for (let s = 0; s < n; s++) {
        for (let q = 0; q < SIDES; q++) {
          const q1 = (q + 1) % SIDES;
          const i0 = base + s * SIDES + q, i1 = base + s * SIDES + q1;
          const j0 = base + (s + 1) * SIDES + q, j1 = base + (s + 1) * SIDES + q1;
          idx.push(i0, j0, i1, i1, j0, j1);
        }
      }
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSeg', new THREE.Float32BufferAttribute(aSeg, 1));
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
    geo.setAttribute('aDist', new THREE.Float32BufferAttribute(aDist, 1));
    geo.setIndex(idx);
    this.chrono = new THREE.Mesh(geo, this.chronoMat);
    this.chrono.frustumCulled = false;
    this.group.add(this.chrono);
  }

  /**
   * The chronology at the cursor. `on` is the time window's blend (0 = all time: nothing drawn). Reduced motion:
   * the arcs appear whole and fade, without the travel.
   */
  updateChronology(cursorU: number, trail: number, ramp: number, on: number, reduced: boolean) {
    this.chronoU.uOn.value = on;
    if (!this.chrono) return;
    this.chrono.visible = on > 0.002;
    const prog = chronologyProgress(this.chronoNodeU, cursorU, trail, ramp, reduced);
    const draw = this.chronoU.uSegDraw.value;
    const alpha = this.chronoU.uSegAlpha.value;
    for (let k = 0; k < CHRONO_MAX_HOPS; k++) {
      draw[k] = k < prog.length ? prog[k].draw : 0;
      alpha[k] = k < prog.length ? prog[k].alpha : 0;
    }
  }

  /** The chronology's state, for tests and diagnostics: its arcs, how many have begun, the total travel, how many are visible. */
  chronoState(): { segments: number; begun: number; travel: number; visible: number; on: number } {
    const n = this.chronoNodeU.length ? this.chronoNodeU.length - 1 : 0;
    const draw = this.chronoU.uSegDraw.value;
    const alpha = this.chronoU.uSegAlpha.value;
    let begun = 0, travel = 0, visible = 0;
    for (let k = 0; k < n; k++) {
      if (draw[k] > 0) begun++;
      travel += draw[k];
      if (alpha[k] > 0.05) visible++;
    }
    const on = this.chronoU.uOn.value;
    const shown = !!this.chrono && on > 0.002;
    return { segments: n, begun: shown ? begun : 0, travel: shown ? travel : 0, visible: shown ? visible : 0, on };
  }

  /** dirs: located steps in chronological order; arc[k] says whether to draw k-1 → k. */
  build(dirs: Vec3[], arc: boolean[]) {
    this.clear();
    const N = dirs.length;
    this.steps = N;
    const pos: number[] = [];
    const aStep: number[] = [];
    const aDist: number[] = [];
    const idx: number[] = [];
    const SIDES = 5;
    const R = 0.0021;
    let cum = 0;
    const a: Vec3 = [0, 0, 0];
    const p: Vec3 = [0, 0, 0];
    let ringBase = 0;
    let prevCentre: Vec3 | null = null;
    for (let k = 1; k < N; k++) {
      if (!arc[k]) continue;
      const ang = angleBetween(dirs[k - 1], dirs[k]);
      const n = Math.max(14, Math.ceil(ang * 46));
      const lift = 0.016 + 0.12 * (ang / Math.PI);
      let segStartRing = -1;
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        slerp(dirs[k - 1], dirs[k], t, a);
        const r = 1.004 + lift * Math.sin(Math.PI * t);
        p[0] = a[0] * r; p[1] = a[1] * r; p[2] = a[2] * r;
        if (prevCentre) cum += Math.hypot(p[0] - prevCentre[0], p[1] - prevCentre[1], p[2] - prevCentre[2]);
        prevCentre = [p[0], p[1], p[2]];
        // tangent from neighbour samples
        const t0 = Math.max(0, t - 0.01), t1 = Math.min(1, t + 0.01);
        const A: Vec3 = slerp(dirs[k - 1], dirs[k], t0, [0, 0, 0]);
        const B: Vec3 = slerp(dirs[k - 1], dirs[k], t1, [0, 0, 0]);
        const tx = B[0] - A[0], ty = B[1] - A[1], tz = B[2] - A[2];
        // frame: radial (a) and side = a × tangent
        let sx = a[1] * tz - a[2] * ty, sy = a[2] * tx - a[0] * tz, sz = a[0] * ty - a[1] * tx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        sx /= sl; sy /= sl; sz /= sl;
        if (s === 0) segStartRing = pos.length / 3;
        for (let q = 0; q < SIDES; q++) {
          const th = (q / SIDES) * Math.PI * 2;
          const c = Math.cos(th), si = Math.sin(th);
          pos.push(p[0] + (a[0] * c + sx * si) * R, p[1] + (a[1] * c + sy * si) * R, p[2] + (a[2] * c + sz * si) * R);
          aStep.push(k - 1 + t);
          aDist.push(cum);
        }
      }
      ringBase = segStartRing;
      for (let s = 0; s < n; s++) {
        for (let q = 0; q < SIDES; q++) {
          const q1 = (q + 1) % SIDES;
          const i0 = ringBase + s * SIDES + q, i1 = ringBase + s * SIDES + q1;
          const j0 = ringBase + (s + 1) * SIDES + q, j1 = ringBase + (s + 1) * SIDES + q1;
          idx.push(i0, j0, i1, i1, j0, j1);
        }
      }
      prevCentre = null; // don't connect lengths across gaps
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aStep', new THREE.Float32BufferAttribute(aStep, 1));
    geo.setAttribute('aDist', new THREE.Float32BufferAttribute(aDist, 1));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }
}

/**
 * A quiet ring that lies in the surface at one point of the globe (selection,
 * hover, tour head): a polar patch of the sphere centred on the point, lifted a
 * hair, depth-tested with a polygon offset so it never cuts into or flickers
 * against the terrain, foreshortening with the surface toward the limb and
 * fading out as it goes round the horizon. Its size is held in screen terms.
 */
export class Marker {
  readonly mesh: THREE.Mesh;
  readonly u = {
    uDir: { value: new THREE.Vector3(0, 0, 1) },
    uE: { value: new THREE.Vector3(1, 0, 0) },
    uN: { value: new THREE.Vector3(0, 1, 0) },
    uWorld: { value: 0.04 },
    uLift: { value: 1.0016 },
    uColor: { value: new THREE.Vector3(1, 1, 1) },
    uAlpha: { value: 0 },
    uTime: { value: 0 },
  };
  private target = 0;
  private p = new THREE.Vector3();
  /** held off while the globe is too small for a constant-pixel decal (the sky stages) */
  suppressed = false;

  /** `sizePx`: outer radius of the decal in css px, wherever it sits on screen */
  constructor(shared: Shared, public sizePx = 26) {
    this.u.uTime = shared.time;
    const RINGS = 9;
    const SEGS = 72;
    const pos: number[] = [0, 0, 0];
    for (let r = 1; r <= RINGS; r++) {
      const rho = r / RINGS;
      for (let s = 0; s < SEGS; s++) {
        const th = (s / SEGS) * Math.PI * 2;
        pos.push(Math.cos(th) * rho, Math.sin(th) * rho, 0);
      }
    }
    const idx: number[] = [];
    for (let s = 0; s < SEGS; s++) idx.push(0, 1 + s, 1 + ((s + 1) % SEGS));
    for (let r = 1; r < RINGS; r++) {
      const a = 1 + (r - 1) * SEGS;
      const b = 1 + r * SEGS;
      for (let s = 0; s < SEGS; s++) {
        const s1 = (s + 1) % SEGS;
        idx.push(a + s, b + s, a + s1, a + s1, b + s, b + s1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: MARKER_VERT,
      fragmentShader: MARKER_FRAG,
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 14;
    this.mesh.visible = false;
  }

  show(dir: Vec3, colour: [number, number, number]) {
    const d = this.u.uDir.value.set(dir[0], dir[1], dir[2]).normalize();
    // local surface frame: east and north tangents at the point
    const e = this.u.uE.value.set(d.z, 0, -d.x);
    if (e.lengthSq() < 1e-6) e.set(1, 0, 0);
    e.normalize();
    this.u.uN.value.crossVectors(d, e).normalize();
    this.u.uColor.value.set(colour[0], colour[1], colour[2]);
    this.target = 1;
    this.mesh.visible = !this.suppressed;
  }

  hide() {
    this.target = 0;
  }

  /** `heightCss`: viewport height in css px; the decal's world size follows the camera so it stays readable. */
  step(dt: number, camera: THREE.PerspectiveCamera, heightCss: number) {
    const a = this.u.uAlpha.value;
    this.u.uAlpha.value = a + (this.target - a) * (1 - Math.exp(-dt * 8));
    if (this.suppressed) { this.mesh.visible = false; return; }
    if (this.target === 1) this.mesh.visible = true;
    if (this.target === 0 && this.u.uAlpha.value < 0.01) this.mesh.visible = false;
    if (!this.mesh.visible) return;
    const me = camera.matrixWorldInverse.elements;
    this.p.copy(this.u.uDir.value).multiplyScalar(this.u.uLift.value);
    const depth = -(me[2] * this.p.x + me[6] * this.p.y + me[10] * this.p.z + me[14]);
    const perPx = (2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(depth, 0.05)) / Math.max(heightCss, 1);
    this.u.uWorld.value = this.sizePx * perPx;
  }
}
