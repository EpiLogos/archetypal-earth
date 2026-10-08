import * as THREE from 'three';
import { EARTH_FRAG, EARTH_VERT, SHELL_FRAG, SHELL_VERT, AURA_FRAG, AURA_VERT, BACKDROP_FRAG, BACKDROP_VERT } from './shaders';
import type { Shared } from './shared';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

export function loadTextures(renderer: THREE.WebGLRenderer): Promise<{ base: THREE.Texture; water: THREE.Texture; topo: THREE.Texture }> {
  const loader = new THREE.TextureLoader();
  const load = (name: string, srgb: boolean) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(`${BASE}/textures/${name}`, (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        resolve(t);
      }, undefined, reject);
    });
  return Promise.all([load('earth-dark.jpg', false), load('earth-water.png', false), load('earth-topology.png', false)]).then(([base, water, topo]) => ({ base, water, topo }));
}

export class Earth {
  readonly mesh: THREE.Mesh;
  readonly lightDir = { value: new THREE.Vector3(-0.5, 0.6, 1) };

  constructor(shared: Shared, tex: { base: THREE.Texture; water: THREE.Texture; topo: THREE.Texture }, density: THREE.Texture) {
    const geo = new THREE.SphereGeometry(1, 192, 96);
    const mat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      uniforms: {
        uBase: { value: tex.base }, uWater: { value: tex.water }, uTopo: { value: tex.topo }, uDensity: { value: density },
        uLightDir: this.lightDir, uFog: shared.fog, uGlow: shared.glow, uDeep: shared.deep, uCore: shared.core, uSpec: shared.spec,
        uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 800) },
      },
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 0;
  }
}

export class AtmosphereShell {
  readonly mesh: THREE.Mesh;
  constructor(shared: Shared) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      uniforms: { uGlow: shared.glow, uCore: shared.core, uSpec: shared.spec },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1.55, 96, 48), mat);
    this.mesh.renderOrder = 1;
  }
}

export class Aura {
  readonly points: THREE.Points;
  constructor(shared: Shared, count = 2600) {
    const seeds = new Float32Array(count * 4);
    let s = 1234567;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = rnd(); seeds[i * 4 + 1] = rnd(); seeds[i * 4 + 2] = rnd(); seeds[i * 4 + 3] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
    const mat = new THREE.ShaderMaterial({
      vertexShader: AURA_VERT,
      fragmentShader: AURA_FRAG,
      uniforms: { uTime: shared.time, uPx: shared.px, uSpec: shared.spec, uGlow: shared.glow, uCore: shared.core },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
  }
}

export class Backdrop {
  readonly mesh: THREE.Mesh;
  readonly center = { value: new THREE.Vector2() };
  readonly radius = { value: 0.4 };
  readonly parallax = { value: new THREE.Vector2() };
  constructor(shared: Shared) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      uniforms: {
        uRes: shared.res, uCenter: this.center, uRadius: this.radius, uFog: shared.fog, uGlow: shared.glow, uDeep: shared.deep,
        uTime: shared.time, uSpec: shared.spec, uParallax: this.parallax,
      },
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }
}
