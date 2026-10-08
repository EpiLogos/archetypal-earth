// Close-zoom detail: a quadtree of sphere patches streaming NASA GIBS Blue Marble
// tiles (public domain, no key). Tiles fade in over the base globe, are graded by
// the same earth shader, are cached, and are cancelled when they leave view.
//
//  • selection  — each frame the quadtree is refined while a tile would be
//    drawn bigger than ~1 texel per css pixel; only tiles denser than the 8k
//    base are ever requested (z ≥ 6, or 5 when the base is the 4k fallback).
//  • loading    — fetch + createImageBitmap (decoded off the main thread),
//    cancellable via AbortController, a handful in flight, nearest to the
//    screen centre first, nothing started until a tile has been wanted for a
//    moment so a fast zoom doesn't spawn requests it will immediately abandon.
//  • drawing    — a leaf draws when ready; until it is opaque the nearest ready
//    ancestor is drawn beneath it, so there is never a hole and never a flash.
//    A tile that is no longer needed fades out rather than popping.
//  • seams      — adjacent patches share exact edge positions and sample texel
//    centres at their borders; the base sphere sits just beneath.
import * as THREE from 'three';
import { angleBetween, dirFromLatLon, type Vec3 } from '../data/geo';
import type { EarthUniforms } from './earth';
import { TILE_FRAG, TILE_VERT } from './shaders';
import { childrenOf, focalPx, latOfY, lonOfX, MAX_ZOOM, parentOf, tileKey, tileScreenSize, tileUrl, TILE_PX } from './tilemath';

const D2R = Math.PI / 180;
const SEG = 16; // grid cells per tile edge
const LIFT = 1.0007; // patches float a hair above the base sphere
const ROOT_Z = 3;
const REFINE = 1.12; // refine while a tile would span > TILE_PX * REFINE css px
const MAX_INFLIGHT = 10;
const MAX_TILES = 240; // textures kept in memory
const WANT_DELAY = 0.1; // s a tile must stay wanted before it is fetched
const CANCEL_GRACE = 0.3; // s unwanted before an in-flight fetch is aborted
const FADE_IN = 0.45;
const FADE_OUT = 0.5;
const UPLOADS_PER_FRAME = 1; // one GPU transfer: WebKit may block on a single upload

interface Tile {
  z: number;
  x: number;
  y: number;
  key: string;
  state: 'idle' | 'loading' | 'decoded' | 'ready' | 'error';
  abort: AbortController | null;
  bitmap: ImageBitmap | HTMLImageElement | null;
  tex: THREE.Texture | null;
  mesh: THREE.Mesh | null;
  mat: THREE.ShaderMaterial | null;
  alpha: number;
  wantT: number; // seconds wanted so far (resets when unwanted)
  lastWanted: number;
  lastUsed: number;
  priority: number;
  inSet: boolean;
  loadId: number;
}

export interface TileStats {
  wanted: number;
  inflight: number;
  ready: number;
  drawn: number;
  maxZ: number;
  requested: number;
  cancelled: number;
  failed: number;
}

export class TileLayer {
  readonly group = new THREE.Group();
  readonly stats: TileStats = { wanted: 0, inflight: 0, ready: 0, drawn: 0, maxZ: 0, requested: 0, cancelled: 0, failed: 0 };
  /** hi-res base present → tiles start one level deeper */
  minEmit = 6;
  enabled = true;
  private tiles = new Map<string, Tile>();
  private geos = new Map<string, THREE.BufferGeometry>();
  private clock = 0;
  private inflight = 0;
  private loadSeq = 0;
  private maxAniso: number;
  private tmp = new THREE.Vector3();
  private cdir: Vec3 = [0, 0, 0];
  private clipMatrix = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private bounds = new THREE.Sphere();

  constructor(private renderer: THREE.WebGLRenderer, private common: EarthUniforms, private reduced: boolean) {
    this.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  // ── per frame ─────────────────────────────────────────────────────────────
  update(camera: THREE.PerspectiveCamera, dt: number, _width: number, height: number) {
    this.clock += dt;
    const dist = camera.position.length();
    const wanted: Tile[] = [];
    if (this.enabled && dist < 3.4) this.select(camera, dist, height, wanted);
    const stats = this.stats;
    stats.wanted = wanted.length;

    // wanted bookkeeping
    for (const t of wanted) {
      if (t.lastWanted < this.clock - 0.2) t.wantT = 0;
      t.wantT += dt;
      t.lastWanted = this.clock;
    }

    // start loads, nearest the centre first
    if (this.inflight < MAX_INFLIGHT) {
      wanted.sort((a, b) => a.priority - b.priority);
      for (const t of wanted) {
        if (this.inflight >= MAX_INFLIGHT) break;
        if (t.state === 'idle' && t.wantT >= WANT_DELAY) this.load(t);
      }
    }

    // abort fetches nobody wants any more
    for (const t of this.tiles.values()) {
      if (t.state === 'loading' && this.clock - t.lastWanted > CANCEL_GRACE) this.cancel(t);
    }

    // Avoid uploading departed views, then give the visible centre priority.
    // A transfer cannot be interrupted; never compound slow GPU calls in one frame.
    for (const t of this.tiles.values()) {
      if (t.state === 'decoded' && this.clock - t.lastWanted > CANCEL_GRACE) {
        if (t.bitmap && 'close' in t.bitmap) t.bitmap.close();
        t.bitmap = null;
        t.state = 'idle';
        t.wantT = 0;
      }
    }
    const decoded = [...this.tiles.values()].filter((t) => t.state === 'decoded').sort((a, b) => a.priority - b.priority);
    for (const t of decoded.slice(0, UPLOADS_PER_FRAME)) this.upload(t);

    // what to draw: each wanted tile, plus ready ancestors beneath it until it is opaque
    for (const t of this.tiles.values()) t.inSet = false;
    for (const w of wanted) this.chain(w);

    const fi = this.reduced ? 0.01 : FADE_IN;
    const fo = this.reduced ? 0.01 : FADE_OUT;
    let drawn = 0;
    let maxZ = 0;
    for (const t of this.tiles.values()) {
      if (t.state !== 'ready' || !t.mesh) continue;
      if (t.inSet) {
        t.alpha = Math.min(1, t.alpha + dt / fi);
        t.lastUsed = this.clock;
      } else if (t.alpha > 0) {
        t.alpha = Math.max(0, t.alpha - dt / fo);
      }
      const vis = t.alpha > 0.003;
      t.mesh.visible = vis;
      if (vis) {
        t.mat!.uniforms.uAlpha.value = t.alpha * t.alpha * (3 - 2 * t.alpha);
        drawn++;
        if (t.alpha >= 0.999 && t.z > maxZ) maxZ = t.z;
      }
    }
    stats.drawn = drawn;
    stats.maxZ = maxZ;
    this.evict();
  }

  /** Test/diagnostic: how many tiles are fully opaque at each zoom level. */
  levels(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const t of this.tiles.values()) if (t.state === 'ready' && t.alpha >= 0.999) out[t.z] = (out[t.z] ?? 0) + 1;
    return out;
  }

  // ── selection ─────────────────────────────────────────────────────────────
  private select(camera: THREE.PerspectiveCamera, dist: number, H: number, out: Tile[]) {
    const f = focalPx(camera.fov, H);
    const cam = camera.position;
    const camDir: Vec3 = [cam.x / dist, cam.y / dist, cam.z / dist];
    const horizon = Math.acos(Math.min(1, 1 / dist));
    this.clipMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.clipMatrix);
    const n = 1 << ROOT_Z;
    const visit = (z: number, x: number, y: number) => {
      const lon0 = lonOfX(z, x);
      const lon1 = lonOfX(z, x + 1);
      const latN = latOfY(z, y);
      const latS = latOfY(z, y + 1);
      const latC = latOfY(z, y + 0.5);
      const cd = dirFromLatLon(latC, (lon0 + lon1) / 2, this.cdir);
      const rad = Math.max(
        angleBetween(cd, dirFromLatLon(latN, lon0)), angleBetween(cd, dirFromLatLon(latN, lon1)),
        angleBetween(cd, dirFromLatLon(latS, lon0)), angleBetween(cd, dirFromLatLon(latS, lon1)),
      );
      // beyond the horizon
      if (angleBetween(cd, camDir) - rad > horizon + 0.01) return;
      // Test the entire curved patch. Near the surface a parent's centre can
      // project far off-screen while its near edge fills the view; a centre-
      // based pixel margin would incorrectly discard every descendant.
      this.bounds.center.set(cd[0], cd[1], cd[2]);
      this.bounds.radius = 2 * Math.sin(rad / 2);
      if (!this.frustum.intersectsSphere(this.bounds)) return;
      const dx = cam.x - cd[0], dy = cam.y - cd[1], dz = cam.z - cd[2];
      const dc = Math.hypot(dx, dy, dz);
      const size = tileScreenSize(z, latC, dc, f);
      this.tmp.set(cd[0], cd[1], cd[2]).project(camera);
      if (size > TILE_PX * REFINE && z < MAX_ZOOM) {
        for (const c of childrenOf(z, x, y)) visit(c[0], c[1], c[2]);
      } else if (z >= this.minEmit) {
        const t = this.get(z, x, y);
        t.priority = Math.hypot(this.tmp.x, this.tmp.y) + z * 0.001;
        out.push(t);
      }
    };
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) visit(ROOT_Z, x, y);
  }

  private get(z: number, x: number, y: number): Tile {
    const key = tileKey(z, x, y);
    let t = this.tiles.get(key);
    if (!t) {
      t = { z, x, y, key, state: 'idle', abort: null, bitmap: null, tex: null, mesh: null, mat: null, alpha: 0, wantT: 0, lastWanted: -9, lastUsed: this.clock, priority: 9, inSet: false, loadId: 0 };
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Mark `leaf` and, while it is not yet opaque, ready ancestors beneath it. */
  private chain(leaf: Tile) {
    let t: Tile | undefined = leaf;
    while (t) {
      if (t.state === 'ready') {
        t.inSet = true;
        if (t.alpha >= 0.999) break;
      }
      const p = parentOf(t.z, t.x, t.y);
      if (!p || p[0] < 3) break;
      t = this.tiles.get(tileKey(p[0], p[1], p[2]));
    }
  }

  // ── loading ───────────────────────────────────────────────────────────────
  private load(t: Tile) {
    t.state = 'loading';
    const id = ++this.loadSeq;
    t.loadId = id;
    this.inflight++;
    this.stats.requested++;
    this.stats.inflight = this.inflight;
    const ac = (t.abort = new AbortController());
    const url = tileUrl(t.z, t.x, t.y);
    const done = (img: ImageBitmap | HTMLImageElement | null) => {
      if (t.state !== 'loading' || t.loadId !== id) {
        if (img && 'close' in img) img.close();
        return;
      }
      this.inflight = Math.max(0, this.inflight - 1);
      this.stats.inflight = this.inflight;
      t.abort = null;
      if (img) {
        t.bitmap = img;
        t.state = 'decoded';
      } else {
        t.state = 'error';
        this.stats.failed++;
      }
    };
    if (typeof createImageBitmap === 'function') {
      fetch(url, { signal: ac.signal, mode: 'cors' })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then(async (b) => {
          try {
            return await createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          } catch {
            return await createImageBitmap(b);
          }
        })
        .then(done, (err) => {
          if (ac.signal.aborted) return; // cancel() already settled the book-keeping
          void err;
          done(null);
        });
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => done(img);
      img.onerror = () => done(null);
      ac.signal.addEventListener('abort', () => { img.src = ''; });
      img.src = url;
    }
  }

  private cancel(t: Tile) {
    t.abort?.abort();
    t.abort = null;
    if (t.state === 'loading') {
      this.inflight = Math.max(0, this.inflight - 1);
      this.stats.inflight = this.inflight;
      this.stats.cancelled++;
    }
    t.state = 'idle';
    t.wantT = 0;
  }

  private upload(t: Tile) {
    const img = t.bitmap;
    if (!img) return;
    const tex = new THREE.Texture(img as ImageBitmap);
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false; // image row 0 = tile v 0 = north
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = this.maxAniso;
    tex.needsUpdate = true;
    this.renderer.initTexture(tex); // pay the upload now, a few at a time, not inside the render
    if ('close' in img) img.close();
    t.bitmap = null;
    t.tex = tex;
    const mat = new THREE.ShaderMaterial({
      vertexShader: TILE_VERT,
      fragmentShader: TILE_FRAG,
      uniforms: { ...this.common, uMap: { value: tex }, uAlpha: { value: 0 }, uLon0: { value: lonOfX(t.z, t.x) * D2R } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(this.geometry(t.z, t.y), mat);
    mesh.rotation.y = lonOfX(t.z, t.x) * D2R; // the row geometry is built west-edge-at-lon-0
    mesh.frustumCulled = false;
    mesh.renderOrder = 0.5 + t.z * 0.01; // above the sphere, below shell, presences and rings
    mesh.visible = false;
    this.group.add(mesh);
    t.mat = mat;
    t.mesh = mesh;
    t.alpha = 0;
    t.state = 'ready';
    this.stats.ready++;
  }

  /** One grid per (zoom, row): tiles in a row differ only by a rotation about the poles. */
  private geometry(z: number, y: number): THREE.BufferGeometry {
    const key = `${z}/${y}`;
    let g = this.geos.get(key);
    if (g) return g;
    if (this.geos.size > 700) {
      for (const old of this.geos.values()) old.dispose();
      this.geos.clear();
    }
    const dLon = (360 / 2 ** z) * D2R;
    const n = SEG + 1;
    const pos = new Float32Array(n * n * 3);
    const tile = new Float32Array(n * n * 2);
    const ll = new Float32Array(n * n * 2);
    const v: Vec3 = [0, 0, 0];
    for (let r = 0; r < n; r++) {
      const fy = r / SEG;
      const lat = latOfY(z, y + fy);
      for (let c = 0; c < n; c++) {
        const fx = c / SEG;
        const i = r * n + c;
        dirFromLatLon(lat, (fx * 360) / 2 ** z, v);
        pos[i * 3] = v[0] * LIFT; pos[i * 3 + 1] = v[1] * LIFT; pos[i * 3 + 2] = v[2] * LIFT;
        tile[i * 2] = fx; tile[i * 2 + 1] = fy;
        ll[i * 2] = fx * dLon; ll[i * 2 + 1] = lat * D2R;
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < SEG; r++) {
      for (let c = 0; c < SEG; c++) {
        const a = r * n + c, b = a + 1, d = a + n, e = d + 1;
        // wound counter-clockwise seen from outside (east = +u, south = +v)
        idx.push(a, d, b, b, d, e);
      }
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aTile', new THREE.BufferAttribute(tile, 2));
    g.setAttribute('aLL', new THREE.BufferAttribute(ll, 2));
    g.setIndex(idx);
    this.geos.set(key, g);
    return g;
  }

  // ── cache ─────────────────────────────────────────────────────────────────
  private evict() {
    let ready = 0;
    for (const t of this.tiles.values()) if (t.state === 'ready') ready++;
    this.stats.ready = ready;
    if (ready > MAX_TILES) {
      const cand = [...this.tiles.values()].filter((t) => t.state === 'ready' && !t.inSet && t.alpha <= 0.003).sort((a, b) => a.lastUsed - b.lastUsed);
      for (const t of cand) {
        if (ready <= MAX_TILES * 0.85) break;
        this.dispose(t);
        ready--;
      }
    }
    // forget idle bookkeeping that nobody wants any more
    if (this.tiles.size > 3000) {
      for (const [k, t] of this.tiles) if (t.state === 'idle' || t.state === 'error') if (this.clock - t.lastWanted > 30) this.tiles.delete(k);
    }
  }

  private dispose(t: Tile) {
    if (t.mesh) this.group.remove(t.mesh);
    t.mat?.dispose();
    t.tex?.dispose();
    t.mesh = null; t.mat = null; t.tex = null;
    t.state = 'idle';
    t.alpha = 0;
    t.wantT = 0;
  }
}
