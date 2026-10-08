import * as THREE from 'three';
import { EARTH_FRAG, EARTH_VERT, SHELL_FRAG, SHELL_VERT, AURA_FRAG, AURA_VERT, BACKDROP_FRAG, BACKDROP_VERT } from './shaders';
import type { Shared } from './shared';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/** Uniforms every earth-graded surface (the sphere and the close-zoom tiles) shares. */
export interface EarthUniforms {
  uDensity: THREE.IUniform<THREE.Texture>;
  uLightDir: THREE.IUniform<THREE.Vector3>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunMix: THREE.IUniform<number>;
  uFog: THREE.IUniform<THREE.Vector3>;
  uGlow: THREE.IUniform<THREE.Vector3>;
  uDeep: THREE.IUniform<THREE.Vector3>;
  uCore: THREE.IUniform<THREE.Vector3>;
  uSpec: THREE.IUniform<number>;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      // decode off the main thread before the texture ever sees it
      (img.decode ? img.decode().catch(() => undefined) : Promise.resolve()).then(() => resolve(img));
    };
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

function baseTexture(img: HTMLImageElement | ImageBitmap, renderer: THREE.WebGLRenderer): THREE.Texture {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.NoColorSpace; // graded in display space by the earth shader
  t.flipY = img instanceof HTMLImageElement; // bitmaps are flipped when decoded
  t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Decode in a worker thread where possible, so the main thread only pays for the upload. */
async function loadDecoded(url: string): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      return await createImageBitmap(await res.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch {
      /* fall through to an <img> */
    }
  }
  return loadImage(url);
}

/** The small first-paint texture (2k): tiny, so the globe is up almost at once. */
export async function loadBaseLo(renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
  return baseTexture(await loadImage(`${BASE}/textures/earth-2k.jpg`), renderer);
}

/** Which hi-res base this GPU/device should get: 8k, 4k, or none for weak hardware. */
export function hiResChoice(renderer: THREE.WebGLRenderer): '8k' | '4k' | null {
  const max = renderer.capabilities.maxTextureSize;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (max >= 8192 && !coarse) return '8k';
  if (max >= 4096) return '4k';
  return null;
}

/** The sharp base, swapped in once loaded (and uploaded) so first paint never waits for it. */
export async function loadBaseHi(renderer: THREE.WebGLRenderer, which: '8k' | '4k'): Promise<THREE.Texture> {
  return baseTexture(await loadDecoded(`${BASE}/textures/earth-${which}.jpg`), renderer);
}

export class Earth {
  readonly mesh: THREE.Mesh;
  /** shared with the tile layer so both are graded identically */
  readonly u: EarthUniforms;
  readonly lightDir: THREE.IUniform<THREE.Vector3> = { value: new THREE.Vector3(-0.5, 0.6, 1) };
  /** the true Sun's direction (scene axes) and its share of the light: 0 until the sky has said where the Sun is */
  readonly sunDir: THREE.IUniform<THREE.Vector3> = { value: new THREE.Vector3(1, 0, 0) };
  readonly sunMix: THREE.IUniform<number> = { value: 0 };
  private hiMix = { value: 0 };
  private baseHi: THREE.IUniform<THREE.Texture>;
  private baseLo: THREE.IUniform<THREE.Texture>;
  private fade = -1;

  constructor(shared: Shared, lo: THREE.Texture, density: THREE.Texture) {
    this.u = {
      uDensity: { value: density },
      uLightDir: this.lightDir,
      uSunDir: this.sunDir,
      uSunMix: this.sunMix,
      uFog: shared.fog, uGlow: shared.glow, uDeep: shared.deep, uCore: shared.core, uSpec: shared.spec,
    };
    this.baseLo = { value: lo };
    this.baseHi = { value: lo };
    const geo = new THREE.SphereGeometry(1, 192, 96);
    const mat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      uniforms: { ...this.u, uBaseLo: this.baseLo, uBaseHi: this.baseHi, uHiMix: this.hiMix },
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 0;
  }

  /** Blend the sharp base in over about half a second, then let the small one go. */
  setHi(hi: THREE.Texture) {
    this.baseHi.value = hi;
    this.hiMix.value = 0;
    this.fade = 0;
  }

  step(dt: number, reduced: boolean) {
    if (this.fade < 0) return;
    this.fade = Math.min(1, this.fade + dt / (reduced ? 0.05 : 0.7));
    this.hiMix.value = this.fade * this.fade * (3 - 2 * this.fade);
    if (this.fade >= 1) {
      this.fade = -1;
      const lo = this.baseLo.value;
      this.baseLo.value = this.baseHi.value;
      this.hiMix.value = 0;
      lo.dispose();
    }
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
