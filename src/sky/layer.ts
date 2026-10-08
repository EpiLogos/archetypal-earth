// The sky layer: the Sun, Moon and planets as palette-tinted bodies, orbit rings from real sampled
// orbits, and the ecliptic plane — all one more group in the Earth-fixed scene. Positions come only from
// SkyEphemeris (the generated grids); this file draws them. The group is invisible, and costs nothing,
// inside the Earth stage, so Earth mode renders exactly as it always did.
import * as THREE from 'three';
import type { BodyKey, SkyBody, SkyData } from '../types/sky';
import { SkyEphemeris, type SkyPoint } from './ephemeris';
import { eclipticVector, gmstDeg, obliquityDeg, sceneBasis, sceneFromEcliptic, wrap180 } from './frames';
import { sunScene } from './luminaries';
import { AU_IN_EARTH_RADII, compressAu, skyVisible, stageWeights, SKY_EXTENT, type StageWeights } from './stages';

const BODY_VERT = /* glsl */ `
uniform vec2 uRes;
uniform float uPx;
varying vec2 vP;
void main() {
  vec4 c = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vP = position.xy;
  gl_Position = vec4(c.xy + position.xy * (uPx / uRes) * c.w, c.z, c.w);
}`;

// A lit sphere seen as a disc: the light is the direction to the Sun in view space, so phase is true at any scale.
const BODY_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform vec3 uFog;
uniform vec3 uDeep;
uniform vec3 uLight;
uniform float uAlpha;
uniform float uPx;
varying vec2 vP;
void main() {
  float r2 = dot(vP, vP);
  float edge = 1.5 / max(uPx * 0.5, 1.0);
  float a = 1.0 - smoothstep(1.0 - edge * 2.0, 1.0, sqrt(r2));
  if (a <= 0.0) discard;
  vec3 n = vec3(vP, sqrt(max(1.0 - r2, 0.0)));
  float lit = dot(n, normalize(uLight));
  // centred on zero: the terminator is where the light grazes, so the lit share of the disc is the true phase
  float day = smoothstep(-0.16, 0.16, lit);
  vec3 shade = mix(uFog * 0.9 + uDeep * 0.2, uCore, day);
  float rim = pow(1.0 - n.z, 2.2);
  shade += uGlow * rim * (0.16 + 0.34 * day);
  gl_FragColor = vec4(shade, a * uAlpha);
}`;

const SUN_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uAlpha;
uniform float uCorePx;
uniform float uPx;
varying vec2 vP;
void main() {
  float d = length(vP);
  float coreR = uCorePx / uPx;
  float core = 1.0 - smoothstep(coreR * 0.82, coreR, d);
  float halo = pow(max(1.0 - d, 0.0), 3.2);
  float wide = pow(max(1.0 - d, 0.0), 1.4) * 0.16;
  vec3 col = uCore * core + uGlow * (halo * 0.85 + wide);
  float a = clamp(core + halo * 0.75 + wide, 0.0, 1.0);
  gl_FragColor = vec4(col, a * uAlpha);
}`;

const PLANE_VERT = /* glsl */ `
varying vec2 vXY;
void main() { vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PLANE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uRadius;
varying vec2 vXY;
void main() {
  float d = length(vXY) / uRadius;
  float a = (1.0 - smoothstep(0.55, 1.0, d)) * (0.5 + 0.5 * (1.0 - d));
  gl_FragColor = vec4(uColor, a * uAlpha);
}`;

/** Display diameter in device-independent px for a body of this radius (log-scaled, restrained). */
export function bodyPx(radiusKm: number): number {
  return 5 + 5.5 * Math.max(0, Math.min(3, Math.log10(radiusKm) - 3));
}

interface BodyDraw {
  key: BodyKey;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  body: SkyBody;
  /** the base alpha this frame, before stage weighting */
  weight: number;
  screen: { x: number; y: number; px: number; on: boolean };
}

export interface ScreenBody {
  key: BodyKey;
  x: number;
  y: number;
  /** 0..1, how present the body is in this stage */
  alpha: number;
  facing: boolean;
}

export class SkyLayer {
  readonly group = new THREE.Group();
  readonly eph: SkyEphemeris;
  /** where the camera looks, scene coordinates: the Earth at 0 → the Sun across the handoff */
  readonly focus = new THREE.Vector3();
  weights: StageWeights = stageWeights(1);
  gmst = 0;
  eps = 23.44;
  moment = Date.now();
  /** the unit direction from the Earth to the Sun, scene axes, at the moment; valid only while `sunKnown` */
  readonly sunDir = new THREE.Vector3(1, 0, 0);
  /** false when the moment lies outside the generated span: there is no true Sun to light the Earth with */
  sunKnown = false;

  private frame = new THREE.Group(); // Sun-centred, ecliptic axes: orbit rings and the ecliptic plane
  private earthFrame = new THREE.Group(); // Earth-centred, ecliptic axes: the Moon's ring
  private draws = new Map<BodyKey, BodyDraw>();
  private rings = new Map<BodyKey, THREE.LineLoop>();
  private moonRing: THREE.LineLoop;
  private moonRingAt = -Infinity;
  private plane: THREE.Mesh;
  private sunScene = new THREE.Vector3();
  private sunVec: [number, number, number] = [0, 0, 0];
  private sunGeoDir = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private p: SkyPoint = { lon: 0, lat: 0, r: 0 };
  private e: SkyPoint = { lon: 0, lat: 0, r: 0 };
  private prevGmst: number | null = null;
  private dpr = 1;
  private res = new THREE.Vector2(1, 1);
  /** false when the moment lies outside the generated span: bodies hold the nearest sample */
  inSpan = true;

  constructor(readonly data: SkyData) {
    this.eph = new SkyEphemeris(data);
    this.group.visible = false;
    this.group.name = 'sky';
    this.frame.matrixAutoUpdate = false;
    this.earthFrame.matrixAutoUpdate = false;
    this.group.add(this.frame, this.earthFrame);

    // the ecliptic plane: a very faint disc, the stage the rings stand on
    const planeMat = new THREE.ShaderMaterial({
      vertexShader: PLANE_VERT,
      fragmentShader: PLANE_FRAG,
      uniforms: { uColor: { value: new THREE.Color('#6b7fa8') }, uAlpha: { value: 0 }, uRadius: { value: SKY_EXTENT } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.plane = new THREE.Mesh(new THREE.CircleGeometry(SKY_EXTENT, 96), planeMat);
    this.plane.renderOrder = -2;
    this.plane.frustumCulled = false;
    this.frame.add(this.plane);

    // orbit rings: real sampled orbits, compressed radially for the diagram
    for (const body of data.bodies) {
      const path = data.orbits[body.key];
      if (!path) continue;
      const pos = new Float32Array(path.count * 3);
      const v: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < path.count; i++) {
        eclipticVector(path.lon[i], path.lat[i], compressAu(path.r[i]), v);
        pos.set(v, i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(body.palette.glow).lerp(new THREE.Color('#9fb0cc'), 0.45), transparent: true, opacity: 0, depthWrite: false });
      const ring = new THREE.LineLoop(geo, mat);
      ring.frustumCulled = false;
      ring.renderOrder = -1;
      this.rings.set(body.key, ring);
      this.frame.add(ring);
    }

    // the Moon's ring: its real geocentric path around this moment
    const moonGeo = new THREE.BufferGeometry();
    moonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96 * 3), 3));
    const moonBody = data.bodies.find((b) => b.key === 'moon')!;
    this.moonRing = new THREE.LineLoop(moonGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(moonBody.palette.core).lerp(new THREE.Color('#9fb0cc'), 0.4), transparent: true, opacity: 0, depthWrite: false }));
    this.moonRing.frustumCulled = false;
    this.earthFrame.add(this.moonRing);

    // bodies: one billboard each, drawn with its palette
    const plane = new THREE.PlaneGeometry(2, 2);
    for (const body of data.bodies) {
      const isSun = body.key === 'sun';
      const mat = new THREE.ShaderMaterial({
        vertexShader: BODY_VERT,
        fragmentShader: isSun ? SUN_FRAG : BODY_FRAG,
        uniforms: {
          uRes: { value: this.res },
          uPx: { value: 8 },
          uCorePx: { value: 16 },
          uCore: { value: new THREE.Color(body.palette.core) },
          uGlow: { value: new THREE.Color(body.palette.glow) },
          uFog: { value: new THREE.Color(body.palette.fog) },
          uDeep: { value: new THREE.Color(body.palette.deep) },
          uLight: { value: new THREE.Vector3(0, 0, 1) },
          uAlpha: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: isSun ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(plane, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = isSun ? 4 : 5;
      mesh.visible = false;
      this.group.add(mesh);
      this.draws.set(body.key, { key: body.key, mesh, mat, body, weight: 0, screen: { x: 0, y: 0, px: 0, on: false } });
    }
  }

  /** The instant the sky stands at (ms since the Unix epoch). */
  setMoment(ms: number) {
    this.moment = ms;
  }

  setSize(width: number, height: number, dpr: number) {
    this.res.set(width * dpr, height * dpr);
    this.dpr = dpr;
  }

  /**
   * Before the camera moves this frame: update the moment's frame (GMST, obliquity), the Sun's scene
   * position, and the look-at focus; and carry the camera with the sky as the handoff proceeds, so the
   * sky stays still in the view while the Earth turns beneath it (rig.lon is Earth-fixed).
   * Returns the lon correction to apply to the rig, degrees.
   */
  prepare(dist: number): { focus: THREE.Vector3; dLon: number } {
    const w = stageWeights(dist);
    this.weights = w;
    const clamped = this.eph.clamp(this.moment);
    this.inSpan = clamped.inside;
    const ms = clamped.ms;
    this.gmst = gmstDeg(this.moment);
    this.eps = obliquityDeg(this.moment);
    const earth = this.eph.helio('earth', ms, this.e)!;
    const ev = eclipticVector(earth.lon, earth.lat, compressAu(earth.r));
    // the Sun sits opposite the Earth's heliocentric vector, in scene axes
    const s = sceneFromEcliptic([-ev[0], -ev[1], -ev[2]], this.gmst, this.eps);
    this.sunScene.set(s[0], s[1], s[2]);
    const sd = sunScene(this.eph, this.moment, this.sunVec);
    this.sunKnown = !!sd;
    if (sd) this.sunDir.set(sd[0], sd[1], sd[2]);
    this.focus.copy(this.sunScene).multiplyScalar(w.handoff);

    let dLon = 0;
    if (this.prevGmst !== null && w.handoff > 0) dLon = -w.handoff * wrap180(this.gmst - this.prevGmst);
    this.prevGmst = this.gmst;
    return { focus: this.focus, dLon };
  }

  /** After the camera moved: place everything, set opacities and sizes, update labels' screen positions. */
  update(camera: THREE.PerspectiveCamera, dist: number, width: number, height: number) {
    const visible = skyVisible(dist);
    this.group.visible = visible;
    if (!visible) {
      for (const d of this.draws.values()) d.screen.on = false;
      return;
    }
    const w = this.weights;
    const clamped = this.eph.clamp(this.moment);
    const ms = clamped.ms;
    const basis = sceneBasis(this.gmst, this.eps);
    const x = new THREE.Vector3(...basis[0]);
    const y = new THREE.Vector3(...basis[1]);
    const z = new THREE.Vector3(...basis[2]);
    this.frame.matrix.makeBasis(x, y, z).setPosition(this.sunScene);
    this.frame.matrixWorldNeedsUpdate = true;
    this.earthFrame.matrix.makeBasis(x, y, z);
    this.earthFrame.matrixWorldNeedsUpdate = true;

    // orbit rings and the ecliptic plane
    const ringAlpha = w.rings * 0.34;
    for (const ring of this.rings.values()) (ring.material as THREE.LineBasicMaterial).opacity = ringAlpha;
    (this.plane.material as THREE.ShaderMaterial).uniforms.uAlpha.value = w.rings * 0.085;
    this.plane.visible = w.rings > 0.01;

    // the Moon's ring: refreshed when the moment has moved by more than an hour
    (this.moonRing.material as THREE.LineBasicMaterial).opacity = w.moon * 0.42;
    this.moonRing.visible = w.moon > 0.01;
    if (this.moonRing.visible && Math.abs(ms - this.moonRingAt) > 3_600_000) this.refreshMoonRing(ms);

    // bodies
    const earth = this.eph.helio('earth', ms, this.e)!;
    const earthV = eclipticVector(earth.lon, earth.lat, compressAu(earth.r));
    const sunGeo = this.eph.sunGeo(ms, this.p)!;
    const sg = sceneFromEcliptic(eclipticVector(sunGeo.lon, sunGeo.lat, 1), this.gmst, this.eps);
    this.sunGeoDir.set(sg[0], sg[1], sg[2]);
    const camInv = camera.matrixWorldInverse;
    const tanH = Math.tan((camera.fov * Math.PI) / 360);
    const pxPerRad = (height * this.dpr * 0.5) / tanH;
    const proj = this.tmp2;

    for (const d of this.draws.values()) {
      const key = d.key;
      let alpha = 0;
      const pos = d.mesh.position;
      let px = bodyPx(d.body.radiusKm) * this.dpr;
      if (key === 'sun') {
        pos.copy(this.sunScene);
        alpha = w.sun;
        const core = (9 + 14 * (1 - w.handoff)) * this.dpr;
        d.mat.uniforms.uCorePx.value = core;
        px = core * (7 + 5 * (1 - w.handoff));
      } else if (key === 'moon') {
        const m = this.eph.moon(ms, this.p)!;
        const v = sceneFromEcliptic(eclipticVector(m.lon, m.lat, m.r * AU_IN_EARTH_RADII), this.gmst, this.eps);
        pos.set(v[0], v[1], v[2]);
        alpha = w.moon;
        const trueRad = d.body.radiusKm / 6371.0084;
        const truePx = ((2 * trueRad) / Math.max(pos.distanceTo(camera.position), 1e-3)) * pxPerRad;
        px = Math.max(px, truePx);
        d.mat.uniforms.uLight.value.copy(this.sunGeoDir).transformDirection(camInv);
      } else if (key === 'earth') {
        pos.set(0, 0, 0);
        alpha = w.earthPoint;
        d.mat.uniforms.uLight.value.copy(this.sunScene).normalize().transformDirection(camInv);
      } else {
        const h = this.eph.helio(key, ms, this.p);
        if (!h) { d.mesh.visible = false; d.screen.on = false; continue; }
        const pv = eclipticVector(h.lon, h.lat, compressAu(h.r));
        const v = sceneFromEcliptic([pv[0] - earthV[0], pv[1] - earthV[1], pv[2] - earthV[2]], this.gmst, this.eps);
        pos.set(v[0], v[1], v[2]);
        alpha = w.planets;
        d.mat.uniforms.uLight.value.copy(this.sunScene).sub(pos).normalize().transformDirection(camInv);
      }
      d.mat.uniforms.uAlpha.value = alpha;
      d.mat.uniforms.uPx.value = px;
      d.mesh.visible = alpha > 0.004;
      d.weight = alpha;
      // screen position for labels and picking (CSS px)
      proj.copy(pos).project(camera);
      d.screen.x = (proj.x * 0.5 + 0.5) * width;
      d.screen.y = (1 - (proj.y * 0.5 + 0.5)) * height;
      d.screen.px = px / this.dpr;
      d.screen.on = alpha > 0.04 && proj.z < 1 && proj.z > -1 && Math.abs(proj.x) < 1.2 && Math.abs(proj.y) < 1.2;
    }
  }

  private refreshMoonRing(ms: number) {
    const path = this.eph.moonPath(ms, 96);
    if (!path) return;
    const attr = this.moonRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    const v: [number, number, number] = [0, 0, 0];
    path.forEach((p, i) => {
      eclipticVector(p.lon, p.lat, p.r * AU_IN_EARTH_RADII, v);
      attr.setXYZ(i, v[0], v[1], v[2]);
    });
    attr.needsUpdate = true;
    this.moonRingAt = ms;
  }

  /** Bodies currently on screen, for labels. */
  screenBodies(out: ScreenBody[] = []): ScreenBody[] {
    out.length = 0;
    for (const d of this.draws.values()) {
      if (!d.screen.on) continue;
      out.push({ key: d.key, x: d.screen.x, y: d.screen.y, alpha: d.weight, facing: true });
    }
    return out;
  }

  /** The body under a screen point (CSS px), generous like the presences' pick; null over empty space. */
  pick(x: number, y: number, radius: number): BodyKey | null {
    if (!this.group.visible) return null;
    let best: BodyKey | null = null;
    let bestD = Infinity;
    for (const d of this.draws.values()) {
      if (!d.screen.on || d.weight < 0.5) continue;
      const reach = Math.max(radius, d.screen.px * 0.6);
      const dist = Math.hypot(d.screen.x - x, d.screen.y - y);
      if (dist <= reach && dist < bestD) {
        best = d.key;
        bestD = dist;
      }
    }
    return best;
  }

  /** Scene position of a body right now (for flights and the focus), or null when unavailable. */
  positionOf(key: BodyKey): THREE.Vector3 | null {
    const d = this.draws.get(key);
    return d ? d.mesh.position : null;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    });
  }
}
