// Migratory arcs for the thread being followed — and only that thread.
import * as THREE from 'three';
import { slerp, angleBetween, type Vec3 } from '../data/geo';
import { ARC_FRAG, ARC_VERT, MARKER_FRAG, MARKER_VERT } from './shaders';
import type { Shared } from './shared';

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

  constructor(shared: Shared) {
    this.uniforms.uTime = shared.time;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      uniforms: this.uniforms,
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

/** A quiet ring that seats on one point of the globe (selection, hover, tour head). */
export class Marker {
  readonly mesh: THREE.Mesh;
  readonly u = {
    uDir: { value: new THREE.Vector3(0, 0, 1) },
    uRes: { value: new THREE.Vector2(1, 1) },
    uSize: { value: 22 },
    uColor: { value: new THREE.Vector3(1, 1, 1) },
    uAlpha: { value: 0 },
    uTime: { value: 0 },
  };
  private target = 0;

  constructor(shared: Shared, public sizePx = 22) {
    this.u.uRes = shared.res;
    this.u.uTime = shared.time;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mat = new THREE.ShaderMaterial({
      vertexShader: MARKER_VERT,
      fragmentShader: MARKER_FRAG,
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 14;
    this.mesh.visible = false;
  }

  show(dir: Vec3, colour: [number, number, number]) {
    this.u.uDir.value.set(dir[0], dir[1], dir[2]);
    this.u.uColor.value.set(colour[0], colour[1], colour[2]);
    this.target = 1;
    this.mesh.visible = true;
  }

  hide() {
    this.target = 0;
  }

  step(dt: number, px: number) {
    const a = this.u.uAlpha.value;
    this.u.uAlpha.value = a + (this.target - a) * (1 - Math.exp(-dt * 8));
    this.u.uSize.value = this.sizePx * px;
    if (this.target === 0 && this.u.uAlpha.value < 0.01) this.mesh.visible = false;
  }
}
