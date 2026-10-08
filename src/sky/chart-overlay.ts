// A birth chart drawn in place: a ring of the ecliptic around the Earth, divided into the twelve tropical signs, with
// each body's natal longitude marked on it and a sight line from the Earth to the body itself; the Ascendant and
// Midheaven as longer ticks; the aspects as quiet arcs and the house cusps as a ring of spokes, each off until asked
// for. It stands in the layer's Earth-centred ecliptic frame, so everything here is in ecliptic axes and diagram units.
// It draws the sidecar's chart as given and adds no reading: nothing here ranks, colours by meaning or predicts.
import * as THREE from 'three';
import type { BodyKey, SidecarChart, SkyBody } from '../types/sky';
import type { Vec3 } from '../data/geo';
import { SIGNS } from './frames';

/** The chart ring's radius, Earth radii: inside Mars' distance from the Earth in the diagram, outside the Sun's. */
export const CHART_RADIUS = 1500;

const D2R = Math.PI / 180;
const ringPoint = (lon: number, r: number, out: Vec3 = [0, 0, 0]): Vec3 => {
  out[0] = Math.cos(lon * D2R) * r;
  out[1] = Math.sin(lon * D2R) * r;
  out[2] = 0;
  return out;
};

export interface ChartMark {
  id: string;
  text: string;
  kind: 'sign' | 'angle';
}

export interface ChartScreenMark extends ChartMark {
  x: number;
  y: number;
  on: boolean;
}

export interface ChartDrawOptions {
  aspects: boolean;
  houses: boolean;
}

/** A quadratic arc between two points of the ring, bowed toward the centre by how far apart they are (a chord diagram's curve). */
export function aspectArc(lonA: number, lonB: number, radius: number, segments = 28): Vec3[] {
  const a = ringPoint(lonA, radius);
  const b = ringPoint(lonB, radius);
  // opposite points meet through the centre; near ones bow only a little
  const sep = Math.abs((((lonB - lonA) % 360) + 540) % 360 - 180); // 0 at opposition, 180 at conjunction
  const pull = 0.18 + 0.42 * (1 - sep / 180);
  const c: Vec3 = [((a[0] + b[0]) / 2) * pull, ((a[1] + b[1]) / 2) * pull, 0];
  const out: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], 0]);
  }
  return out;
}

export class ChartOverlay {
  readonly group = new THREE.Group();
  private chart: SidecarChart | null = null;
  private keys: BodyKey[] = [];
  private ring: THREE.LineLoop;
  private ticks: THREE.LineSegments;
  private markers: THREE.LineSegments;
  private sight: THREE.LineSegments;
  private angles: THREE.LineSegments;
  private aspects: THREE.LineSegments | null = null;
  private houses: THREE.LineSegments | null = null;
  private options: ChartDrawOptions = { aspects: false, houses: false };
  private marks: { mark: ChartMark; at: Vec3 }[] = [];
  private tmp = new THREE.Vector3();
  private colour = new Map<BodyKey, THREE.Color>();

  constructor(private bodies: SkyBody[]) {
    this.group.visible = false;
    this.group.name = 'chart';
    const mat = (opacity: number, vertexColors = false) => new THREE.LineBasicMaterial({ color: new THREE.Color('#aab8d4'), transparent: true, opacity, depthWrite: false, vertexColors });
    const ringGeo = new THREE.BufferGeometry();
    const pts = new Float32Array(180 * 3);
    for (let i = 0; i < 180; i++) { const p = ringPoint((i / 180) * 360, CHART_RADIUS); pts.set(p, i * 3); }
    ringGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.ring = new THREE.LineLoop(ringGeo, mat(1));
    this.ticks = new THREE.LineSegments(this.signTicks(), mat(1));
    this.markers = new THREE.LineSegments(new THREE.BufferGeometry(), mat(1, true));
    this.sight = new THREE.LineSegments(new THREE.BufferGeometry(), mat(1, true));
    this.angles = new THREE.LineSegments(new THREE.BufferGeometry(), mat(1));
    for (const o of [this.ring, this.ticks, this.markers, this.sight, this.angles]) { o.frustumCulled = false; o.renderOrder = 3; this.group.add(o); }
    for (const b of bodies) this.colour.set(b.key, new THREE.Color(b.palette.core).lerp(new THREE.Color('#dfe8ff'), 0.25));
  }

  private signTicks(): THREE.BufferGeometry {
    const pos = new Float32Array(12 * 2 * 3);
    for (let i = 0; i < 12; i++) {
      pos.set(ringPoint(i * 30, CHART_RADIUS * 0.96), i * 6);
      pos.set(ringPoint(i * 30, CHART_RADIUS * 1.04), i * 6 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }

  /** Stand a chart on the ring (or take it away with null). */
  set(chart: SidecarChart | null) {
    this.chart = chart;
    this.group.visible = !!chart;
    this.marks = [];
    for (const o of [this.aspects, this.houses]) if (o) { this.group.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    this.aspects = this.houses = null;
    if (!chart) { this.keys = []; return; }
    this.keys = this.bodies.map((b) => b.key).filter((k) => !!chart.bodies[k]);

    // natal markers on the ring, in each body's own colour; sight lines are written every frame (the body moves in flight)
    const mp = new Float32Array(this.keys.length * 6);
    const mc = new Float32Array(this.keys.length * 6);
    this.keys.forEach((k, i) => {
      const lon = chart.bodies[k]!.lon;
      mp.set(ringPoint(lon, CHART_RADIUS * 0.9), i * 6);
      mp.set(ringPoint(lon, CHART_RADIUS * 1.1), i * 6 + 3);
      const c = this.colour.get(k)!;
      mc.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    });
    this.markers.geometry.dispose();
    this.markers.geometry = new THREE.BufferGeometry();
    this.markers.geometry.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.markers.geometry.setAttribute('color', new THREE.BufferAttribute(mc, 3));
    this.sight.geometry.dispose();
    this.sight.geometry = new THREE.BufferGeometry();
    this.sight.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.keys.length * 6), 3));
    this.sight.geometry.setAttribute('color', new THREE.BufferAttribute(mc.slice(), 3));

    // the angles: longer, plainer ticks
    const ap = new Float32Array(2 * 6);
    [chart.angles.ascendant.lon, chart.angles.midheaven.lon].forEach((lon, i) => {
      ap.set(ringPoint(lon, CHART_RADIUS * 0.82), i * 6);
      ap.set(ringPoint(lon, CHART_RADIUS * 1.14), i * 6 + 3);
    });
    this.angles.geometry.dispose();
    this.angles.geometry = new THREE.BufferGeometry();
    this.angles.geometry.setAttribute('position', new THREE.BufferAttribute(ap, 3));

    // the aspects as arcs between the natal longitudes; opacity is carried by orb in one colour (no meaning is coloured in)
    const segs: number[] = [];
    const cols: number[] = [];
    const ink = new THREE.Color('#b8c6e6');
    for (const a of chart.aspects) {
      const la = chart.bodies[a.a as BodyKey]?.lon;
      const lb = chart.bodies[a.b as BodyKey]?.lon;
      if (la === undefined || lb === undefined) continue;
      const arc = aspectArc(la, lb, CHART_RADIUS * 0.9);
      const strength = 0.35 + 0.65 * Math.max(0, 1 - a.orb / 8);
      for (let i = 0; i < arc.length - 1; i++) {
        segs.push(...arc[i], ...arc[i + 1]);
        cols.push(ink.r * strength, ink.g * strength, ink.b * strength, ink.r * strength, ink.g * strength, ink.b * strength);
      }
    }
    if (segs.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
      this.aspects = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false }));
      this.aspects.frustumCulled = false;
      this.aspects.renderOrder = 3;
      this.group.add(this.aspects);
    }

    // the house cusps: twelve spokes between an inner ring and the sign ring, with the inner ring itself
    const hp: number[] = [];
    const inner = CHART_RADIUS * 0.7;
    for (const lon of chart.houses.cusps) hp.push(...ringPoint(lon, inner), ...ringPoint(lon, CHART_RADIUS * 0.96));
    for (let i = 0; i < 120; i++) hp.push(...ringPoint((i / 120) * 360, inner), ...ringPoint(((i + 1) / 120) * 360, inner));
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hp), 3));
    this.houses = new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: new THREE.Color('#8fa3cc'), transparent: true, opacity: 0, depthWrite: false }));
    this.houses.frustumCulled = false;
    this.houses.renderOrder = 3;
    this.group.add(this.houses);

    // labels: sign names at the middle of each sign, the two angles at their ticks
    for (let i = 0; i < 12; i++) this.marks.push({ mark: { id: `sign-${i}`, text: SIGNS[i], kind: 'sign' }, at: ringPoint(i * 30 + 15, CHART_RADIUS * 1.13) });
    this.marks.push({ mark: { id: 'asc', text: 'Asc', kind: 'angle' }, at: ringPoint(chart.angles.ascendant.lon, CHART_RADIUS * 1.22) });
    this.marks.push({ mark: { id: 'mc', text: 'MC', kind: 'angle' }, at: ringPoint(chart.angles.midheaven.lon, CHART_RADIUS * 1.22) });
  }

  get current(): SidecarChart | null {
    return this.chart;
  }

  setOptions(o: Partial<ChartDrawOptions>) {
    this.options = { ...this.options, ...o };
  }

  get drawn(): Readonly<ChartDrawOptions> {
    return this.options;
  }

  /** Per frame: the sight lines to wherever the bodies are now, and every opacity. `weight` is the stage; `arrival` 0→1 across the flight. */
  update(poses: Map<BodyKey, Vec3>, weight: number, arrival: number) {
    if (!this.chart) return;
    const w = weight * arrival;
    this.group.visible = w > 0.005;
    const set = (o: THREE.LineSegments | THREE.LineLoop | null, v: number) => { if (o) (o.material as THREE.LineBasicMaterial).opacity = v; };
    set(this.ring, 0.32 * w);
    set(this.ticks, 0.5 * w);
    set(this.markers, 0.85 * w);
    set(this.sight, 0.2 * w);
    set(this.angles, 0.6 * w);
    set(this.aspects, this.options.aspects ? 0.42 * w : 0);
    set(this.houses, this.options.houses ? 0.34 * w : 0);
    if (this.aspects) this.aspects.visible = this.options.aspects;
    if (this.houses) this.houses.visible = this.options.houses;
    const attr = this.sight.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.keys.forEach((k, i) => {
      const v = poses.get(k);
      attr.setXYZ(i * 2, 0, 0, 0);
      if (v) attr.setXYZ(i * 2 + 1, v[0], v[1], v[2]); else attr.setXYZ(i * 2 + 1, 0, 0, 0);
    });
    attr.needsUpdate = true;
  }

  /** Where each mark falls on the screen now (CSS px); `frame` is the Earth-centred ecliptic frame's matrix. */
  project(camera: THREE.PerspectiveCamera, frame: THREE.Matrix4, width: number, height: number, weight: number, out: ChartScreenMark[] = []): ChartScreenMark[] {
    out.length = 0;
    if (!this.chart || weight < 0.3) return out;
    for (const m of this.marks) {
      this.tmp.set(m.at[0], m.at[1], m.at[2]).applyMatrix4(frame).project(camera);
      const on = this.tmp.z < 1 && this.tmp.z > -1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1;
      out.push({ ...m.mark, x: (this.tmp.x * 0.5 + 0.5) * width, y: (1 - (this.tmp.y * 0.5 + 0.5)) * height, on });
    }
    return out;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}
