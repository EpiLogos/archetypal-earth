// The graph mode: the same field as a calm force-directed constellation (Obsidian's graph, in this world's light).
//
// Canvas 2D, HiDPI-aware, d3-force for layout, d3-zoom for pan/zoom/pinch, d3-quadtree for hit-testing.
// It renders only when something changes (a settling simulation, a tween, the pointer, the time window) and
// goes fully idle otherwise. Nothing here knows about the controller: it is told what to show (setTarget)
// and reports what the person chose (GraphHandlers).
import '../style/graph.css';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum } from 'd3-force';
import { quadtree, type Quadtree } from 'd3-quadtree';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import type { Model } from '../data/model';
import type { RGB } from '../data/palette';
import { smoothstep } from '../data/palette';
import type { TimeModel } from '../state/timeModel';
import { buildGraph, edgeAllowed, globalSet, hash01, neighbourhood, nodeLiveness, skyRingPosition, withSkyAnchors, type GEdge, type GNode, type Graph, type Neighbourhood, type SkyAnchorSource } from './build';
import type { TieBasis } from '../types/field';
import { GraphTools, type ToolState } from './tools';

// outside the local lens the field recedes to a whisper that is still clickable
const GHOST_VIS = 0.05;

export interface GraphHandlers {
  /** a node was clicked */
  onSelect(key: string): void;
  /** the person wants to see this node (or, with null, the current subject) on Earth */
  onEarth(key: string | null): void;
  /** back to the whole graph */
  onWhole(): void;
  /** The sky's bodies, ties and standing longitudes, loaded on demand; null when the sky cannot be had. */
  loadSky?(): Promise<{ source: SkyAnchorSource; asOf: string } | null>;
}

export interface GraphTarget {
  /** local-graph subject as a node key ('a:self' | 'f:serpent'), or null for the global graph */
  subject: string | null;
  /** an occurrence to mark as selected (a manifestation), 'o:<id>' */
  selected: string | null;
  /** occurrence indices to light up (a culture or place focus) */
  emphasis: number[] | null;
}

export interface Insets {
  l: number;
  t: number;
  r: number;
  b: number;
}

interface VNode {
  g: GNode;
  id: number;
  index?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  /** world radius */
  r: number;
  /** presence: tweens toward visT as the node enters / leaves the shown set */
  vis: number;
  visT: number;
  /** lit (1) or dimmed (0): tweens toward hlT */
  hl: number;
  hlT: number;
  /** time liveness 0..1 */
  live: number;
  /** pinned as the local subject */
  pinned: boolean;
  /** 'r g b' 0..255 for rgb() strings */
  rgb: string;
  glow: string;
  /** frame scratch */
  sx: number;
  sy: number;
  sr: number;
  on: boolean;
}

interface SimLink extends SimulationLinkDatum<VNode> {
  e: GEdge;
  k: number;
}

const SERIF = '"Source Serif 4", "Source Serif Pro", "Iowan Old Style", Georgia, serif';
const SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

const rgbTriplet = (c: RGB) => `${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)}`;
const rgba = (trip: string, a: number) => `rgb(${trip} / ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function nodeRadius(n: GNode): number {
  if (n.kind === 'body') return 6.5 + 2.5 * n.rank;
  if (n.kind === 'archetype') return n.prime ? 23 : 12.5 + 7 * (n.rank - 0.55) / 0.4;
  if (n.kind === 'family') return 3.4 + 6 * n.rank;
  return n.hasImage ? 2.3 : 1.8;
}

/** Edge styles: drawn thin, in the colour of what they tie. `jung` is Jung's word, solid and brighter. */
interface EdgeStyle {
  width: number;
  alpha: number;
  dash: number[];
}
const STYLE: Record<string, EdgeStyle> = {
  'tie-jung': { width: 1.6, alpha: 0.62, dash: [] },
  'tie-inferred': { width: 1.05, alpha: 0.34, dash: [] },
  'tie-site': { width: 0.9, alpha: 0.22, dash: [2.5, 5] },
  instance: { width: 0.7, alpha: 0.2, dash: [] },
  co: { width: 0.7, alpha: 0.17, dash: [1.5, 4.5] },
  parallel: { width: 0.9, alpha: 0.3, dash: [1, 3.2] },
  // the sky's own strands: hairlines, quieter than the field's ties, in the body's light
  'sky-jung': { width: 1.1, alpha: 0.46, dash: [] },
  'sky-inferred': { width: 0.85, alpha: 0.27, dash: [] },
  'sky-site': { width: 0.8, alpha: 0.17, dash: [2.5, 5] },
};
const styleOf = (e: GEdge) => (e.kind === 'tie' ? `tie-${e.basis ?? 'site'}` : e.kind === 'sky' ? `sky-${e.basis ?? 'site'}` : e.kind);

const MAX_K = 9;
const MIN_K = 0.1;

export class GraphView {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tools: GraphTools;
  private g: Graph;
  /** the field's own graph; `g` is this, or this with the sky hung from it */
  private gBase: Graph;
  private nodes: VNode[];
  private sky: { on: boolean; status: ToolState['sky']; asOf: string; source: SkyAnchorSource | null } = { on: false, status: 'off', asOf: '', source: null };
  private skyReq = 0;
  private sim: Simulation<VNode, SimLink>;
  private qt: Quadtree<VNode> | null = null;
  private qtStale = true;
  private zoomB: ZoomBehavior<HTMLCanvasElement, unknown>;
  private t: ZoomTransform = zoomIdentity;

  private w = 1;
  private h = 1;
  private dpr = 1;
  private stars: HTMLCanvasElement | null = null;

  private visible = false;
  private raf = 0;
  private lastTs = 0;
  private dirty = true;
  private live: Float32Array;
  private timeDirty = true;

  // what is shown
  private mode: 'global' | 'local' = 'global';
  private subject = -1;
  private selected = -1;
  private depth = 1;
  private dust = true;
  private ties: TieBasis[] = ['jung', 'inferred', 'site'];
  private emph: Set<number> | null = null;
  private active = new Map<number, number>();
  private activeEdges: number[] = [];
  private simNodes: VNode[] = [];
  private lastTargetKey = '';
  private target: GraphTarget = { subject: null, selected: null, emphasis: null };

  // interaction
  private hover = -1;
  private press: { id: number; x: number; y: number; t: number; moved: boolean; pid: number } | null = null;
  private dragging = -1;
  private lastClick: { id: number; x: number; y: number; t: number } | null = null;
  private pulse = 0;

  // camera
  private insets: Insets = { l: 0, t: 0, r: 0, b: 0 };
  private follow = 0; // seconds of "keep framing the subject" left
  private camAnim: { from: ZoomTransform; to: ZoomTransform; t: number; dur: number } | null = null;
  private autoFit = true;

  private labelW = new Map<string, number>();
  private fontsReady = false;
  private reduced: boolean;

  constructor(parent: HTMLElement, private model: Model, private time: TimeModel, private h_: GraphHandlers, reduced = false) {
    this.reduced = reduced;
    this.gBase = this.g = buildGraph(model);
    this.live = new Float32Array(this.g.nodes.length).fill(1);
    this.nodes = this.g.nodes.map((n) => this.makeNode(n));
    this.spawnAll();

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gv-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'The archetypes, their forms and their occurrences, drawn as a graph. Click a node to focus it.');
    this.canvas.tabIndex = 0;
    const ctx = this.canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;

    this.tools = new GraphTools({
      onDepth: (d) => this.setDepth(d),
      onDust: (on) => this.setDust(on),
      onTies: (bases) => this.setTies(bases),
      onSky: (on) => this.setSkyAnchors(on),
      onFit: () => { this.autoFit = true; this.follow = 1.2; this.refit(0.8); this.wake(); },
      onEarth: () => this.h_.onEarth(this.target.selected ?? this.target.subject),
      onWhole: () => this.h_.onWhole(),
    });
    this.root = document.createElement('div');
    this.root.className = 'gv';
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.append(this.canvas, this.tools.root);
    parent.append(this.root);

    this.sim = forceSimulation<VNode, SimLink>([]).stop().alphaMin(0.012).velocityDecay(0.36);

    this.zoomB = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([MIN_K, MAX_K])
      .filter((ev: Event) => this.zoomFilter(ev))
      .on('zoom', (ev) => {
        this.t = ev.transform;
        if (ev.sourceEvent) {
          // the person took the camera: stop framing for them
          this.follow = 0;
          this.camAnim = null;
          this.autoFit = false;
        }
        this.qtStale = false;
        this.dirty = true;
        this.wake();
      });
    select(this.canvas).call(this.zoomB).on('dblclick.zoom', null);

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.canvas.addEventListener('keydown', this.onKey);
    new ResizeObserver(() => this.resize()).observe(this.root);
    time.subscribe(() => {
      this.timeDirty = true;
      if (this.visible) this.wake();
    });
    if (typeof document !== 'undefined' && document.fonts) {
      const load = () => Promise.all([document.fonts.load(`600 16px ${SERIF}`), document.fonts.load(`400 13px ${SERIF}`), document.fonts.load(`500 11px ${SANS}`)]).catch(() => undefined);
      void load().then(() => {
        this.fontsReady = true;
        this.labelW.clear();
        this.dirty = true;
        if (this.visible) this.wake();
      });
    }
    this.resize();
  }

  // ── set-up ───────────────────────────────────────────────────────────────
  private makeNode(g: GNode): VNode {
    return {
      g, id: g.id, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, r: nodeRadius(g),
      vis: 0, visT: 0, hl: 1, hlT: 1, live: 1, pinned: false,
      rgb: rgbTriplet(g.colour), glow: rgbTriplet(g.glow), sx: 0, sy: 0, sr: 0, on: false,
    };
  }

  /** A calm, reproducible first arrangement: Self at the heart, archetypes on a ring, forms about their archetype, occurrences about their form. */
  private spawnAll() {
    const g = this.g;
    const arch = g.archetypeIds;
    const others = arch.filter((id) => !g.nodes[id].prime);
    others.forEach((id, i) => {
      const a = (i / Math.max(1, others.length)) * Math.PI * 2 + hash01('ring') * 0.5;
      const v = this.nodes[id];
      v.x = Math.cos(a) * 300;
      v.y = Math.sin(a) * 300;
    });
    for (const id of arch) if (g.nodes[id].prime) { this.nodes[id].x = 0; this.nodes[id].y = 0; }
    const tieOf = new Map<number, number>();
    for (const e of g.edges) if (e.kind === 'tie') {
      const cur = tieOf.get(e.s);
      const rank = (b?: string) => (b === 'jung' ? 0 : b === 'inferred' ? 1 : 2);
      if (cur === undefined || rank(e.basis) < rank(g.edges.find((x) => x.s === e.s && x.t === cur)?.basis)) tieOf.set(e.s, e.t);
    }
    for (const id of g.familyIds) {
      const a = tieOf.get(id);
      const base = a !== undefined ? this.nodes[a] : this.nodes[arch[0]];
      const ang = hash01(g.nodes[id].key, 1) * Math.PI * 2;
      const rad = 70 + hash01(g.nodes[id].key, 2) * 90;
      const v = this.nodes[id];
      v.x = base.x + Math.cos(ang) * rad;
      v.y = base.y + Math.sin(ang) * rad;
    }
    for (const id of g.occurrenceIds) {
      const fam = this.model.occ[g.nodes[id].occIdx].familyId;
      const fi = g.byKey.get(`f:${fam}`);
      const base = fi !== undefined ? this.nodes[fi] : this.nodes[0];
      const ang = hash01(g.nodes[id].key, 3) * Math.PI * 2;
      const rad = 14 + hash01(g.nodes[id].key, 4) * 30;
      const v = this.nodes[id];
      v.x = base.x + Math.cos(ang) * rad;
      v.y = base.y + Math.sin(ang) * rad;
    }
  }

  // ── public ───────────────────────────────────────────────────────────────
  get isVisible() {
    return this.visible;
  }

  show(instant = false) {
    if (this.visible) return;
    this.visible = true;
    this.root.inert = false;
    this.root.setAttribute('aria-hidden', 'false');
    this.root.classList.add('on');
    if (instant) this.root.classList.add('instant');
    else this.root.classList.remove('instant');
    this.resize();
    if (this.active.size === 0) this.rebuild(true);
    this.dirty = true;
    this.timeDirty = true;
    this.wake();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.classList.remove('on');
    this.tools.close();
    this.hover = -1;
    this.press = null;
    // let the cross-fade finish, then stop spending anything
    window.setTimeout(() => {
      if (!this.visible && this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
    }, 1100);
  }

  /** Tell the graph what the app is looking at. */
  setTarget(t: GraphTarget) {
    this.target = t;
    const subject = t.subject ? this.g.byKey.get(t.subject) ?? -1 : -1;
    const selected = t.selected ? this.g.byKey.get(t.selected) ?? -1 : -1;
    const emph = t.emphasis && t.emphasis.length ? new Set(t.emphasis.map((i) => this.g.occurrenceIds[i]).filter((x) => x !== undefined)) : null;
    const key = `${subject}|${this.depth}|${this.dust ? 1 : 0}|${selected}|${emph ? emph.size : 0}`;
    const layoutKey = `${subject}|${this.depth}|${this.dust ? 1 : 0}`;
    const prevSelected = this.selected;
    this.selected = selected;
    this.emph = emph;
    this.tools.setState({ ...this.toolState(), local: subject >= 0, hasSubject: subject >= 0 || selected >= 0 });
    if (key === this.lastTargetKey) return;
    // a selected occurrence the shown set lacks brings its form in: that is a change of layout too
    const layoutChanged = layoutKey !== this.lastTargetKey.split('|').slice(0, 3).join('|') || this.active.size === 0 || (selected >= 0 && !this.active.has(selected));
    this.lastTargetKey = key;
    this.subject = subject;
    this.mode = subject >= 0 ? 'local' : 'global';
    if (selected >= 0 && selected !== prevSelected) this.pulse = 1;
    if (this.visible) {
      if (layoutChanged) this.rebuild(false);
      else this.refreshLit();
      this.wake();
    } else {
      this.active.clear(); // rebuilt on show
    }
  }

  setInsets(i: Insets) {
    const same = i.l === this.insets.l && i.t === this.insets.t && i.r === this.insets.r && i.b === this.insets.b;
    this.insets = i;
    if (same || !this.visible) return;
    if (this.autoFit || this.follow > 0) {
      this.follow = Math.max(this.follow, 1.2);
      this.wake();
    } else {
      this.refit(0.9);
    }
  }

  zoomBy(f: number) {
    this.nudgeCamera(0, 0, f);
  }

  panBy(dx: number, dy: number) {
    this.nudgeCamera(dx, dy, 1);
  }

  /** Test / diagnostics. */
  get stats() {
    const n = this.active.size;
    let bodies = 0;
    let bodyLive = 1;
    for (const id of this.active.keys()) if (this.nodes[id].g.kind === 'body') { bodies++; bodyLive = Math.min(bodyLive, this.nodes[id].live); }
    const skyEdges = this.activeEdges.filter((k) => this.g.edges[k].kind === 'sky').length;
    return { sky: this.sky.status, bodies, bodyLive, skyEdges, nodes: n, edges: this.activeEdges.length, alpha: this.sim.alpha(), k: this.t.k, mode: this.mode, depth: this.depth, hover: this.hover, subject: this.subject, tieBases: this.ties.slice(), occurrences: this.dust };
  }

  /** Settle the simulation synchronously (tests, screenshots). */
  settle(ticks = 220) {
    for (let i = 0; i < ticks; i++) this.sim.tick();
    this.qtStale = true;
    this.dirty = true;
    this.refit(0);
    this.wake();
  }

  /** Where a node is in the graph's own coordinates (diagnostics / tests). */
  worldOf(key: string): { x: number; y: number } | null {
    const id = this.g.byKey.get(key);
    return id === undefined ? null : { x: this.nodes[id].x, y: this.nodes[id].y };
  }

  /** Where a node is on screen (diagnostics / tests). */
  screenOf(key: string): { x: number; y: number } | null {
    const id = this.g.byKey.get(key);
    if (id === undefined) return null;
    const v = this.nodes[id];
    return { x: this.t.x + v.x * this.t.k, y: this.t.y + v.y * this.t.k };
  }

  private toolState(): ToolState {
    return { local: this.mode === 'local', depth: this.depth, dust: this.dust, ties: this.ties, hasSubject: this.subject >= 0 || this.selected >= 0, sky: this.sky.status, skyAsOf: this.sky.asOf };
  }

  private pushTools() {
    this.tools.setState(this.toolState());
  }

  /**
   * Hang the sky from the graph (or take it down). Off by default. The sky's bodies are extra nodes after the
   * field's own, so every existing node keeps its id and its place; they settle toward the family and archetype
   * they are tied to. Asked of the controller on first use: the sky's data is not loaded until someone wants it.
   */
  setSkyAnchors(on: boolean) {
    if (on === this.sky.on) return;
    const req = ++this.skyReq;
    this.sky.on = on;
    if (!on) {
      this.sky.status = 'off';
      this.sky.source = null; // the next time asks again, so the moment is fresh
      this.applySky(null);
      return;
    }
    if (this.sky.source) { this.sky.status = 'on'; this.applySky(this.sky.source); return; }
    if (!this.h_.loadSky) { this.sky.on = false; this.sky.status = 'unavailable'; this.pushTools(); return; }
    this.sky.status = 'loading';
    this.pushTools();
    void this.h_.loadSky().then((r) => {
      if (req !== this.skyReq) return; // asked again meanwhile
      if (!r) { this.sky.on = false; this.sky.status = 'unavailable'; this.pushTools(); return; }
      this.sky.source = r.source;
      this.sky.asOf = r.asOf;
      this.sky.status = 'on';
      this.applySky(r.source);
    });
  }

  private applySky(src: SkyAnchorSource | null) {
    const base = this.gBase.nodes.length;
    this.nodes.length = base; // any earlier bodies go; the field's nodes stay exactly as they are
    this.g = src ? withSkyAnchors(this.gBase, src) : this.gBase;
    for (let i = base; i < this.g.nodes.length; i++) {
      const v = this.makeNode(this.g.nodes[i]);
      const p = skyRingPosition((src?.lon[this.g.nodes[i].ref as keyof SkyAnchorSource['lon']]) ?? 0);
      v.x = p.x;
      v.y = p.y;
      this.nodes.push(v);
    }
    this.live = new Float32Array(this.g.nodes.length).fill(1);
    this.hover = -1;
    this.pushTools();
    this.timeDirty = true;
    this.qtStale = true;
    if (this.visible) { this.rebuild(false); this.wake(); } else this.active.clear();
  }

  /** The body's resting place on the outer ring, or null when it should move freely (in a local graph it is simply a neighbour). */
  private ringPlace(v: VNode): { x: number; y: number } | null {
    if (v.g.kind !== 'body' || this.mode === 'local' || !this.sky.source) return null;
    const lon = this.sky.source.lon[v.g.ref as keyof SkyAnchorSource['lon']];
    return lon === undefined ? null : skyRingPosition(lon);
  }

  private setDepth(d: number) {
    const nd = Math.max(1, Math.min(3, d));
    if (nd === this.depth) return;
    this.depth = nd;
    this.pushTools();
    this.lastTargetKey = '';
    this.setTarget(this.target);
  }

  private setDust(on: boolean) {
    if (on === this.dust) return;
    this.dust = on;
    this.pushTools();
    this.lastTargetKey = '';
    this.setTarget(this.target);
  }

  // ── which nodes are shown ────────────────────────────────────────────────
  private setTies(bases: TieBasis[]) {
    this.ties = bases;
    this.pushTools();
    if (this.visible) { this.rebuild(false); this.wake(); }
  }

  private computeActive(): Neighbourhood {
    const g = this.g;
    let nb: Neighbourhood;
    if (this.mode === 'local' && this.subject >= 0) {
      nb = neighbourhood(g, [this.subject], { depth: this.depth, occurrences: this.dust, tieBases: this.ties, cap: this.depth >= 3 ? 520 : 380 });
    } else {
      nb = globalSet(g, this.dust, this.ties);
    }
    // a selected occurrence is always part of the picture, with the form it belongs to
    if (this.selected >= 0 && !nb.dist.has(this.selected)) {
      const add = [this.selected];
      const fam = this.model.occ[g.nodes[this.selected].occIdx].familyId;
      const fi = g.byKey.get(`f:${fam}`);
      if (fi !== undefined && !nb.dist.has(fi)) add.push(fi);
      for (const n of add) nb.dist.set(n, 1);
      g.edges.forEach((e, k) => {
        if (edgeAllowed(e, this.ties) && nb.dist.has(e.s) && nb.dist.has(e.t) && !nb.edges.includes(k) && (add.includes(e.s) || add.includes(e.t))) nb.edges.push(k);
      });
    }
    return nb;
  }

  private rebuild(first: boolean) {
    const g = this.g;
    const nb = this.computeActive();
    const wasOn = new Set<number>();
    for (const v of this.nodes) if (v.vis >= GHOST_VIS || v.visT > 0.5) wasOn.add(v.id);
    this.active = nb.dist;
    this.activeEdges = nb.edges;

    // enter / leave
    const entering: number[] = [];
    for (const v of this.nodes) {
      const isOn = this.active.has(v.id);
      v.visT = isOn ? 1 : GHOST_VIS;
      if (isOn && !wasOn.has(v.id)) entering.push(v.id);
      if (first && isOn) v.vis = 1;
      if (first && !isOn) v.vis = 0;
    }
    // newcomers burst out of the nearest thing already there
    if (!first) {
      const order = entering.slice().sort((a, b) => (this.active.get(a) ?? 0) - (this.active.get(b) ?? 0));
      const placed = new Set<number>(wasOn);
      for (const id of order) {
        const v = this.nodes[id];
        let anchor = -1;
        let best = Infinity;
        for (const nbid of g.adj[id]) {
          if (!placed.has(nbid)) continue;
          const d = this.active.get(nbid) ?? 9;
          if (d < best) { best = d; anchor = nbid; }
        }
        if (anchor < 0 && this.subject >= 0) anchor = this.subject;
        if (anchor >= 0) {
          const a = this.nodes[anchor];
          const ang = hash01(g.nodes[id].key, 7) * Math.PI * 2;
          v.x = a.x + Math.cos(ang) * 6;
          v.y = a.y + Math.sin(ang) * 6;
          v.vx = v.vy = 0;
        }
        placed.add(id);
      }
    }

    // pins: the local subject holds still so its neighbourhood forms around it
    for (const v of this.nodes) {
      if (v.pinned) { v.pinned = false; v.fx = v.fy = null; }
    }
    if (this.mode === 'local' && this.subject >= 0) {
      const s = this.nodes[this.subject];
      s.pinned = true;
      s.fx = s.x;
      s.fy = s.y;
    }

    // the sky's bodies hold their ring in the whole graph; in a local graph they are ordinary neighbours
    for (const v of this.nodes) {
      if (v.g.kind !== 'body') continue;
      const p = this.ringPlace(v);
      if (p) { v.x = v.fx = p.x; v.y = v.fy = p.y; v.vx = v.vy = 0; } else if (!v.pinned) v.fx = v.fy = null;
    }

    this.simNodes = this.nodes.filter((v) => this.active.has(v.id));
    const links: SimLink[] = [];
    for (const k of this.activeEdges) {
      const e = g.edges[k];
      links.push({ source: this.nodes[e.s], target: this.nodes[e.t], e, k });
    }
    const local = this.mode === 'local';
    const kDist = (e: GEdge) => {
      const f = local ? 1.18 : 1;
      switch (e.kind) {
        case 'tie': return (e.basis === 'jung' ? 92 : e.basis === 'inferred' ? 118 : 148) * f;
        case 'sky': return (e.basis === 'jung' ? 150 : e.basis === 'inferred' ? 190 : 240) * f;
        case 'instance': return (local ? 30 : 17) + 0;
        case 'co': return 80 * f;
        default: return 96 * f;
      }
    };
    const kStr = (e: GEdge) => {
      switch (e.kind) {
        case 'tie': return e.basis === 'jung' ? 0.5 : e.basis === 'inferred' ? 0.26 : 0.12;
        // the Self holds the centre: a tie to it is drawn, but never drags it from its place
        case 'sky': return this.nodes[e.t].g.prime ? 0.004 : e.basis === 'jung' ? 0.2 : e.basis === 'inferred' ? 0.1 : 0.05;
        case 'instance': return 0.85;
        case 'co': return 0.05;
        default: return 0.035;
      }
    };
    const n = this.simNodes.length;
    const charge = (v: VNode) => {
      const f = local ? 1.2 : 1;
      if (v.g.kind === 'archetype') return -(v.g.prime ? 1500 : 880) * f;
      if (v.g.kind === 'family') return -(90 + 170 * v.g.rank) * f;
      if (v.g.kind === 'body') return -60;
      return -13 * f;
    };
    const decay = n > 1500 ? 0.032 : n > 700 ? 0.026 : 0.0228;
    this.sim
      .nodes(this.simNodes)
      .force('link', forceLink<VNode, SimLink>(links).distance((l) => kDist(l.e)).strength((l) => kStr(l.e)).iterations(1))
      .force('charge', forceManyBody<VNode>().strength(charge).theta(0.95).distanceMax(780))
      .force('collide', forceCollide<VNode>((v) => v.r * 1.12 + 2.2).strength(0.7))
      .force('x', forceX<VNode>(0).strength(local ? 0 : 0.018))
      .force('y', forceY<VNode>(0).strength(local ? 0 : 0.018))
      .force('heart', local ? null : (() => {
        const self = this.g.archetypeIds.map((i) => this.nodes[i]).find((v) => v.g.prime);
        return () => {
          if (!self || self.fx !== null) return;
          self.vx -= self.x * 0.06;
          self.vy -= self.y * 0.06;
        };
      })())
      .alphaDecay(decay)
      .alpha(first ? 0.9 : Math.max(this.sim.alpha(), 0.62))
      .alphaTarget(0);

    if (first) {
      // arrive already composed: the first screenful of motion is a settle, not an explosion
      const warm = Math.min(120, Math.round(36000 / Math.max(60, n)));
      for (let i = 0; i < warm; i++) this.sim.tick();
      this.sim.alpha(0.35);
    }
    this.qtStale = true;
    this.refreshLit();
    this.timeDirty = true;
    this.autoFit = true;
    this.follow = this.reduced ? 0.1 : 3.4;
    if (first) this.refit(0);
    this.dirty = true;
  }

  /** Which nodes are lit given hover and emphasis. */
  private refreshLit() {
    const g = this.g;
    const emph = this.emph;
    if (this.hover >= 0 && this.active.has(this.hover)) {
      const lit = new Set<number>([this.hover]);
      for (const nb of g.adj[this.hover]) if (this.active.has(nb)) lit.add(nb);
      for (const v of this.nodes) v.hlT = lit.has(v.id) ? 1 : 0.13;
    } else if (emph) {
      const fams = new Set<number>();
      for (const id of emph) {
        const fi = g.byKey.get(`f:${this.model.occ[g.nodes[id].occIdx].familyId}`);
        if (fi !== undefined) fams.add(fi);
      }
      for (const v of this.nodes) v.hlT = emph.has(v.id) ? 1 : fams.has(v.id) ? 0.55 : 0.2;
    } else {
      for (const v of this.nodes) v.hlT = 1;
    }
    this.dirty = true;
  }

  // ── the loop ─────────────────────────────────────────────────────────────
  private wake() {
    if (!this.visible || this.raf) return;
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (ts: number) => {
    this.raf = 0;
    if (!this.visible) return;
    const dt = Math.min(0.06, (ts - this.lastTs) / 1000 || 0.016);
    this.lastTs = ts;
    const busy = this.step(dt);
    if (this.dirty || busy) {
      this.draw();
      this.dirty = false;
    }
    if (busy) this.raf = requestAnimationFrame(this.loop);
  };

  /** Advance everything that moves. Returns whether another frame is wanted. */
  private step(dt: number): boolean {
    let busy = false;

    // simulation: a tick or two per frame, as the frame budget allows
    if (this.sim.alpha() > this.sim.alphaMin() || this.dragging >= 0) {
      const t0 = performance.now();
      let n = 0;
      do {
        this.sim.tick();
        n++;
      } while (n < 3 && performance.now() - t0 < 5);
      this.qtStale = true;
      busy = true;
      this.dirty = true;
    }

    // presence / lit tweens
    const kv = 1 - Math.exp(-dt * (this.reduced ? 30 : 4.2));
    const kh = 1 - Math.exp(-dt * (this.reduced ? 30 : 11));
    for (const v of this.nodes) {
      if (v.vis !== v.visT) {
        v.vis += (v.visT - v.vis) * kv;
        if (Math.abs(v.visT - v.vis) < 0.004) v.vis = v.visT;
        busy = true;
        this.dirty = true;
      }
      if (v.hl !== v.hlT) {
        v.hl += (v.hlT - v.hl) * kh;
        if (Math.abs(v.hlT - v.hl) < 0.006) v.hl = v.hlT;
        busy = true;
        this.dirty = true;
      }
    }
    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - dt / 1.6);
      busy = true;
      this.dirty = true;
    }

    // time window → liveness
    if (this.timeDirty) {
      this.timeDirty = false;
      nodeLiveness(this.g, this.model, this.time.window, this.live);
      for (const v of this.nodes) v.live = this.live[v.id];
      this.qtStale = true;
      if (this.hover >= 0 && this.nodes[this.hover].g.kind === 'occurrence' && this.nodes[this.hover].live <= 0.525) {
        this.hover = -1;
        this.canvas.style.cursor = '';
        this.refreshLit();
      }
      this.dirty = true;
    }
    // the time model eases its own window; keep drawing while it moves
    if (this.time.mode === 'cursor' && (this.time.playing || Math.abs(this.time.targetU - this.time.cursorU) > 1e-3 || Math.abs(this.time.on - 1) > 1e-3 || Math.abs(this.time.trail - this.time.trailTarget) > 1e-3)) {
      this.timeDirty = true;
      busy = true;
    } else if (this.time.mode === 'all' && this.time.on > 1e-3) {
      this.timeDirty = true;
      busy = true;
    }

    // camera
    if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const e = ease(a.t);
      const k = a.from.k * Math.pow(a.to.k / a.from.k, e);
      this.setCamera(a.from.x + (a.to.x - a.from.x) * e, a.from.y + (a.to.y - a.from.y) * e, k);
      if (a.t >= 1) this.camAnim = null;
      busy = true;
    } else if (this.follow > 0 && this.autoFit) {
      this.follow -= dt;
      this.followCamera(dt);
      busy = true;
    }
    return busy;
  }

  // ── camera ───────────────────────────────────────────────────────────────
  private usable() {
    const i = this.insets;
    const w = Math.max(80, this.w - i.l - i.r);
    const h = Math.max(80, this.h - i.t - i.b);
    return { w, h, cx: i.l + w / 2, cy: i.t + h / 2 };
  }

  /** The camera that frames what is shown: the heart of the graph, or the subject's neighbourhood. */
  private fitCamera(): { x: number; y: number; k: number } {
    const u = this.usable();
    const pts: VNode[] = [];
    for (const id of this.active.keys()) {
      const v = this.nodes[id];
      // dust never decides the frame in the global graph
      if (this.mode === 'global' && v.g.kind === 'occurrence') continue;
      pts.push(v);
    }
    if (!pts.length) return { x: this.w / 2, y: this.h / 2, k: 1 };
    let c = { x: 0, y: 0 };
    if (this.mode === 'local' && this.subject >= 0) {
      c = { x: this.nodes[this.subject].x, y: this.nodes[this.subject].y };
    } else {
      // Self rests at the heart; frame about it
      const self = this.g.archetypeIds.map((i) => this.nodes[i]).find((v) => v.g.prime);
      c = self ? { x: self.x, y: self.y } : { x: 0, y: 0 };
    }
    const dxs = pts.map((v) => Math.abs(v.x - c.x)).sort((a, b) => a - b);
    const dys = pts.map((v) => Math.abs(v.y - c.y)).sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
    const p = this.mode === 'local' ? 0.93 : 0.97;
    const ex = Math.max(60, q(dxs, p));
    const ey = Math.max(60, q(dys, p));
    const pad = this.mode === 'local' ? 1.22 : 1.1;
    const labelRoom = 54; // keep names inside the frame
    let k = Math.min((u.w - labelRoom * 2) / (2 * ex * pad), (u.h - labelRoom * 2) / (2 * ey * pad));
    k = Math.max(0.22, Math.min(this.mode === 'local' ? 2.4 : 1.5, k));
    return { x: u.cx - c.x * k, y: u.cy - c.y * k, k };
  }

  private followCamera(dt: number) {
    const tgt = this.fitCamera();
    const s = 1 - Math.exp(-dt * (this.reduced ? 20 : 3.2));
    const k = this.t.k * Math.pow(tgt.k / this.t.k, s);
    this.setCamera(this.t.x + (tgt.x - this.t.x) * s, this.t.y + (tgt.y - this.t.y) * s, k);
  }

  private refit(seconds: number) {
    const to = this.fitCamera();
    if (seconds <= 0 || this.reduced) {
      this.camAnim = null;
      this.setCamera(to.x, to.y, to.k);
    } else {
      this.camAnim = { from: this.t, to: zoomIdentity.translate(to.x, to.y).scale(to.k), t: 0, dur: seconds };
      this.wake();
    }
  }

  private setCamera(x: number, y: number, k: number) {
    this.t = zoomIdentity.translate(x, y).scale(k);
    // keep d3-zoom's own state in step so the next wheel / drag starts from here
    (this.canvas as unknown as { __zoom: ZoomTransform }).__zoom = this.t;
    this.dirty = true;
  }

  private nudgeCamera(dx: number, dy: number, f: number) {
    this.follow = 0;
    this.camAnim = null;
    this.autoFit = false;
    const k = Math.max(MIN_K, Math.min(MAX_K, this.t.k * f));
    const cx = this.w / 2;
    const cy = this.h / 2;
    // zoom about the centre of the view
    const wx = (cx - this.t.x) / this.t.k;
    const wy = (cy - this.t.y) / this.t.k;
    this.camAnim = { from: this.t, to: zoomIdentity.translate(cx - wx * k + dx, cy - wy * k + dy).scale(k), t: 0, dur: 0.28 };
    this.wake();
  }

  private resize() {
    const r = this.root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this.w && h === this.h && dpr === this.dpr && this.canvas.width) return;
    const first = !this.canvas.width;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.stars = null;
    this.qtStale = true;
    if (this.active.size && (this.autoFit || first)) this.refit(0);
    this.dirty = true;
    if (this.visible) this.wake();
  }

  // ── hit-testing ──────────────────────────────────────────────────────────
  private tree(): Quadtree<VNode> {
    if (!this.qt || this.qtStale) {
      // anything drawn is hittable: the ghost floor stays above the 0.012 stage cutoff
    const items = this.nodes.filter((v) => v.vis > 0.012 && (v.live > 0.525 || v.g.kind !== 'occurrence'));
      this.qt = quadtree<VNode>().x((v) => v.x).y((v) => v.y).addAll(items);
      this.qtStale = false;
    }
    return this.qt;
  }

  private pick(px: number, py: number, coarse = false): VNode | null {
    const k = this.t.k;
    const wx = (px - this.t.x) / k;
    const wy = (py - this.t.y) / k;
    const slop = (coarse ? 15 : 7) / k;
    let best: VNode | null = null;
    let bestScore = Infinity;
    const search = (this.maxRadius() * Math.pow(k, 0.5) + slop * k) / k + 2;
    this.tree().visit((node, x0, y0, x1, y1) => {
      if (!node.length) {
        let n: typeof node | undefined = node;
        do {
          const v = (n as unknown as { data: VNode }).data;
          const d = Math.hypot(v.x - wx, v.y - wy);
          const reach = (v.r * Math.pow(k, 0.5)) / k + slop;
          if (d <= reach) {
            // nearest edge wins; bigger things win ties so a form is never hidden under its own dust
            const score = d / reach - (v.g.kind === 'archetype' ? 0.6 : v.g.kind === 'body' ? 0.5 : v.g.kind === 'family' ? 0.3 : 0);
            if (score < bestScore) { bestScore = score; best = v; }
          }
          n = (n as unknown as { next?: typeof node }).next;
        } while (n);
      }
      return x0 > wx + search || x1 < wx - search || y0 > wy + search || y1 < wy - search;
    });
    return best;
  }

  private maxRadius() {
    return 26;
  }

  // ── pointer ──────────────────────────────────────────────────────────────
  private local(ev: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private zoomFilter(ev: Event): boolean {
    if (ev.type === 'wheel') return true;
    if (this.press || this.dragging >= 0) return false;
    if (ev.type === 'dblclick') return false;
    const me = ev as MouseEvent;
    if (ev.type === 'mousedown' || ev.type === 'touchstart') {
      const r = this.canvas.getBoundingClientRect();
      const p = ev.type === 'touchstart' ? (ev as TouchEvent).touches[0] : me;
      if (p && (ev.type === 'mousedown' || (ev as TouchEvent).touches.length === 1)) {
        if (this.pick(p.clientX - r.left, p.clientY - r.top, ev.type === 'touchstart')) return false;
      }
      if (ev.type === 'mousedown' && me.button) return false;
    }
    return !me.ctrlKey || ev.type === 'wheel';
  }

  private onDown = (ev: PointerEvent) => {
    if (ev.button > 0) return;
    const p = this.local(ev);
    const hit = this.pick(p.x, p.y, ev.pointerType !== 'mouse');
    if (!hit) {
      this.press = null;
      return;
    }
    this.press = { id: hit.id, x: p.x, y: p.y, t: performance.now(), moved: false, pid: ev.pointerId };
    this.canvas.setPointerCapture?.(ev.pointerId);
  };

  private onMove = (ev: PointerEvent) => {
    const p = this.local(ev);
    if (this.press && ev.pointerId === this.press.pid) {
      const press = this.press;
      if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > 4) {
        press.moved = true;
        this.dragging = press.id;
        const v = this.nodes[press.id];
        v.fx = v.x;
        v.fy = v.y;
        this.sim.alphaTarget(0.22).alpha(Math.max(this.sim.alpha(), 0.3));
        this.follow = 0;
        this.wake();
      }
      if (this.dragging >= 0) {
        const v = this.nodes[this.dragging];
        v.fx = (p.x - this.t.x) / this.t.k;
        v.fy = (p.y - this.t.y) / this.t.k;
        this.qtStale = true;
        this.dirty = true;
        this.wake();
      }
      return;
    }
    if (ev.pointerType !== 'mouse') return;
    const hit = this.pick(p.x, p.y);
    const id = hit ? hit.id : -1;
    if (id !== this.hover) {
      this.hover = id;
      this.canvas.style.cursor = id >= 0 ? 'pointer' : '';
      this.refreshLit();
      this.wake();
    }
  };

  private onUp = (ev: PointerEvent) => {
    const press = this.press;
    if (!press || ev.pointerId !== press.pid) return;
    this.press = null;
    this.canvas.releasePointerCapture?.(ev.pointerId);
    if (this.dragging >= 0) {
      const v = this.nodes[this.dragging];
      this.dragging = -1;
      // released: free again, unless it is the subject holding the neighbourhood together
      const ring = this.ringPlace(v);
      if (ring) { v.fx = ring.x; v.fy = ring.y; } else if (v.pinned) { v.fx = v.x; v.fy = v.y; } else { v.fx = v.fy = null; }
      this.sim.alphaTarget(0);
      this.wake();
      return;
    }
    if (ev.type === 'pointercancel') return;
    const now = performance.now();
    const lc = this.lastClick;
    const p = this.local(ev);
    if (lc && lc.id === press.id && now - lc.t < 420 && Math.hypot(p.x - lc.x, p.y - lc.y) < 14) {
      this.lastClick = null;
      this.h_.onEarth(this.g.nodes[lc.id].key);
      return;
    }
    this.lastClick = { id: press.id, x: p.x, y: p.y, t: now };
    this.h_.onSelect(this.g.nodes[press.id].key);
  };

  private onLeave = () => {
    if (this.hover >= 0 && !this.press) {
      this.hover = -1;
      this.canvas.style.cursor = '';
      this.refreshLit();
      this.wake();
    }
  };

  private onKey = (ev: KeyboardEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = 60;
    switch (ev.key) {
      case 'ArrowLeft': this.panBy(k, 0); break;
      case 'ArrowRight': this.panBy(-k, 0); break;
      case 'ArrowUp': this.panBy(0, k); break;
      case 'ArrowDown': this.panBy(0, -k); break;
      case '+': case '=': this.zoomBy(1.3); break;
      case '-': case '_': this.zoomBy(1 / 1.3); break;
      default: return;
    }
    ev.preventDefault();
  };

  // ── drawing ──────────────────────────────────────────────────────────────
  private starLayer(): HTMLCanvasElement {
    if (this.stars) return this.stars;
    const c = document.createElement('canvas');
    const pad = 80;
    c.width = Math.round((this.w + pad * 2) * this.dpr);
    c.height = Math.round((this.h + pad * 2) * this.dpr);
    const x = c.getContext('2d')!;
    x.scale(this.dpr, this.dpr);
    const n = Math.round(((this.w + pad * 2) * (this.h + pad * 2)) / 5200);
    for (let i = 0; i < n; i++) {
      const px = hash01('sx', i) * (this.w + pad * 2);
      const py = hash01('sy', i) * (this.h + pad * 2);
      const m = hash01('sm', i);
      const rr = 0.3 + m * m * 0.9;
      x.fillStyle = `rgb(205 218 245 / ${(0.1 + m * 0.34).toFixed(2)})`;
      x.beginPath();
      x.arc(px, py, rr, 0, Math.PI * 2);
      x.fill();
    }
    this.stars = c;
    return c;
  }

  private fontSize(v: VNode, k: number): number {
    if (v.g.kind === 'archetype') return (v.g.prime ? 17.5 : 15) * Math.min(1.25, 0.88 + 0.12 * k);
    if (v.g.kind === 'family') return (12.2 + 2.6 * v.g.rank) * Math.min(1.2, 0.9 + 0.1 * k);
    if (v.g.kind === 'body') return 12.5 * Math.min(1.2, 0.9 + 0.1 * k);
    return 11.5 * Math.min(1.15, 0.92 + 0.08 * k);
  }

  private measure(text: string, font: string): number {
    const key = `${font}|${text}`;
    let w = this.labelW.get(key);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      this.labelW.set(key, w);
      if (this.labelW.size > 4000) this.labelW.clear();
    }
    return w;
  }

  private draw() {
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    const k = this.t.k;
    const tx = this.t.x;
    const ty = this.t.y;
    const local = this.mode === 'local';
    const kEff = local ? k * 1.4 : k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // distant stars drift a little against the camera: depth without noise
    const st = this.starLayer();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(st, -80 + (tx * 0.035) % 80, -80 + (ty * 0.035) % 80, st.width / this.dpr, st.height / this.dpr);
    ctx.globalAlpha = 1;

    // screen positions of what is on stage
    const margin = 90;
    const stage: VNode[] = [];
    const grow = Math.pow(k, 0.55);
    for (const v of this.nodes) {
      if (v.vis < 0.012) { v.on = false; continue; }
      v.sx = tx + v.x * k;
      v.sy = ty + v.y * k;
      v.sr = Math.max(v.g.kind === 'occurrence' ? 1.15 : 2.4, v.r * grow);
      v.on = v.sx > -margin && v.sx < w + margin && v.sy > -margin && v.sy < h + margin;
      if (v.on) stage.push(v);
    }
    const hov = this.hover >= 0 ? this.nodes[this.hover] : null;

    if (!local && this.g.bodyIds.length && this.sky.source) this.drawSkyRing(ctx, k);
    this.drawEdges(ctx, k, kEff, local, hov);

    // halos, additive: the soft light of each presence
    ctx.globalCompositeOperation = 'lighter';
    for (const v of stage) {
      const kind = v.g.kind;
      if (kind === 'occurrence') continue;
      const a = v.vis * v.hl * v.live;
      if (a < 0.02) continue;
      const rad = v.sr * (kind === 'archetype' ? 3.7 : kind === 'body' ? 3.2 : 2.7);
      const strength = kind === 'archetype' ? 0.36 : kind === 'body' ? 0.3 : 0.15 + 0.09 * v.g.rank;
      const gr = ctx.createRadialGradient(v.sx, v.sy, v.sr * 0.4, v.sx, v.sy, rad);
      gr.addColorStop(0, rgba(v.glow, strength * a));
      gr.addColorStop(1, rgba(v.glow, 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(v.sx, v.sy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // dust first (under), then forms, then archetypes
    for (const pass of ['occurrence', 'family', 'archetype', 'body'] as const) {
      for (const v of stage) {
        if (v.g.kind !== pass) continue;
        const a = v.vis * (0.28 + 0.72 * v.hl) * (pass === 'occurrence' ? v.live : 0.35 + 0.65 * v.live);
        if (a < 0.015) continue;
        if (pass === 'occurrence') {
          const sel = v.id === this.selected;
          ctx.fillStyle = rgba(v.rgb, (sel ? 1 : 0.62 + 0.3 * (v.hl > 0.9 ? 1 : 0)) * a);
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, v.sr * (sel ? 1.9 : 1), 0, Math.PI * 2);
          ctx.fill();
        } else if (pass === 'body') {
          // a body is a point of light on a thin ring: a star, not a dot of the field
          const gr = ctx.createRadialGradient(v.sx, v.sy, 0, v.sx, v.sy, v.sr);
          gr.addColorStop(0, rgba('255 255 255', 0.98 * a));
          gr.addColorStop(0.45, rgba(v.rgb, 0.95 * a));
          gr.addColorStop(1, rgba(v.glow, 0.55 * a));
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, v.sr * 0.72, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 0.9;
          ctx.strokeStyle = rgba(v.rgb, 0.5 * a);
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, v.sr + 2.5, 0, Math.PI * 2);
          ctx.stroke();
        } else if (pass === 'family') {
          ctx.fillStyle = rgba(v.rgb, 0.9 * a);
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, v.sr, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = rgba('255 255 255', 0.28 * a);
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, v.sr + 0.5, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const gr = ctx.createRadialGradient(v.sx - v.sr * 0.3, v.sy - v.sr * 0.34, v.sr * 0.08, v.sx, v.sy, v.sr);
          gr.addColorStop(0, rgba('255 255 255', 0.95 * a));
          gr.addColorStop(0.35, rgba(v.rgb, 0.98 * a));
          gr.addColorStop(1, rgba(v.glow, 0.92 * a));
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, v.sr, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = rgba('255 255 255', (v.g.prime ? 0.45 : 0.28) * a);
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, v.sr + (v.g.prime ? 5 : 3.5), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // the subject and the selection: a thin ring of attention
    const ring = (v: VNode | undefined, extra: number, a: number) => {
      if (!v || !v.on || v.vis < 0.2) return;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(v.rgb, a * v.vis);
      ctx.beginPath();
      ctx.arc(v.sx, v.sy, v.sr + extra, 0, Math.PI * 2);
      ctx.stroke();
    };
    if (this.subject >= 0) ring(this.nodes[this.subject], 7, 0.85);
    if (this.selected >= 0) {
      const v = this.nodes[this.selected];
      ring(v, 5 + this.pulse * 14, 0.9 - this.pulse * 0.4);
    }

    this.drawLabels(ctx, stage, k, kEff, local, hov);
  }

  /** The ecliptic, as one faint circle the bodies stand on: no wheel, no signs, no divisions. */
  private drawSkyRing(ctx: CanvasRenderingContext2D, k: number) {
    const cx = this.t.x;
    const cy = this.t.y;
    const R = skyRingPosition(0).x * k;
    if (R < 8 || R > 40000) return;
    const a = this.nodes[this.g.bodyIds[0]].vis;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([1.5, 6]);
    ctx.strokeStyle = rgba('188 204 238', 0.34 * a);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawEdges(ctx: CanvasRenderingContext2D, k: number, kEff: number, local: boolean, hov: VNode | null) {
    const g = this.g;
    const buckets = new Map<string, { st: EdgeStyle; trip: string; a: number; segs: number[] }>();
    const hot: GEdge[] = [];
    const w = this.w;
    const h = this.h;
    // in the whole graph the fine strands appear only as you come close
    const fine = local ? 1 : smoothstep(1.05, 1.9, k);
    const parFine = local ? 1 : smoothstep(1.5, 2.6, k);
    for (const ek of this.activeEdges) {
      const e = g.edges[ek];
      const a = this.nodes[e.s];
      const b = this.nodes[e.t];
      if (!a.on && !b.on) continue;
      if (a.vis < 0.02 || b.vis < 0.02) continue;
      let gate = 1;
      if (e.kind === 'instance' || e.kind === 'co') gate = fine;
      else if (e.kind === 'parallel') gate = parFine;
      const isHot = hov && (a === hov || b === hov);
      if (!isHot && gate < 0.02) continue;
      const style = STYLE[styleOf(e)];
      const vis = Math.min(a.vis, b.vis);
      const lit = Math.min(a.hl, b.hl);
      const live = Math.min(a.live, b.live);
      let alpha = style.alpha * vis * gate * (0.15 + 0.85 * lit) * (0.3 + 0.7 * live);
      if (isHot) { hot.push(e); alpha = 0; }
      if (alpha < 0.012) continue;
      // cheap cull: both ends off the same side of the screen
      if ((a.sx < 0 && b.sx < 0) || (a.sx > w && b.sx > w) || (a.sy < 0 && b.sy < 0) || (a.sy > h && b.sy > h)) continue;
      // tie strands wear the archetype's colour; the fine strands share one soft tone
      const trip = e.kind === 'tie' ? this.nodes[e.t].rgb : e.kind === 'sky' ? this.nodes[e.s].rgb : '188 204 238';
      const q = Math.round(alpha * 14) / 14;
      const bk = `${styleOf(e)}|${trip}|${q}`;
      let bucket = buckets.get(bk);
      if (!bucket) buckets.set(bk, (bucket = { st: style, trip, a: q, segs: [] }));
      bucket.segs.push(a.sx, a.sy, b.sx, b.sy);
    }
    ctx.lineCap = 'round';
    for (const bkt of buckets.values()) {
      ctx.strokeStyle = rgba(bkt.trip, bkt.a);
      ctx.lineWidth = bkt.st.width;
      ctx.setLineDash(bkt.st.dash);
      ctx.beginPath();
      const s = bkt.segs;
      for (let i = 0; i < s.length; i += 4) {
        ctx.moveTo(s[i], s[i + 1]);
        ctx.lineTo(s[i + 2], s[i + 3]);
      }
      ctx.stroke();
    }
    // strands of the hovered node, lit in the colour of the node they lead to
    for (const e of hot) {
      const a = this.nodes[e.s];
      const b = this.nodes[e.t];
      const style = STYLE[styleOf(e)];
      const gr = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
      gr.addColorStop(0, rgba(a.rgb, 0.85));
      gr.addColorStop(1, rgba(b.rgb, 0.85));
      ctx.strokeStyle = gr;
      ctx.lineWidth = style.width + 0.5;
      ctx.setLineDash(style.dash);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    void kEff;
  }

  private drawLabels(ctx: CanvasRenderingContext2D, stage: VNode[], k: number, kEff: number, local: boolean, hov: VNode | null) {
    interface Cand { v: VNode; a: number; pri: number; text: string; font: string; size: number; kind: 'serif' | 'sans'; sub?: string }
    const cands: Cand[] = [];
    const hovNb = new Set<number>();
    if (hov) for (const nb of this.g.adj[hov.id]) hovNb.add(nb);
    for (const v of stage) {
      const kind = v.g.kind;
      let a = 0;
      let pri = 0;
      if (v === hov) { a = 1; pri = 100; }
      else if (v.id === this.subject) { a = 1; pri = 90; }
      else if (v.id === this.selected) { a = 1; pri = 80; }
      else if (kind === 'archetype') { a = 1; pri = 70 + (v.g.prime ? 5 : 0); }
      else if (kind === 'body') { a = 1; pri = 66; }
      else if (kind === 'family') {
        // larger forms are named sooner; the rest as you come near
        const need = 1.7 - 1.15 * v.g.rank;
        a = smoothstep(need - 0.22, need + 0.12, kEff);
        pri = 40 + 20 * v.g.rank;
      } else {
        a = smoothstep(local ? 1.6 : 2.5, local ? 2.1 : 3.1, kEff) * (v.g.hasImage ? 1 : 0.8);
        pri = 10 + (v.g.hasImage ? 4 : 0);
      }
      if (hov && v !== hov && hovNb.has(v.id)) { a = Math.max(a, kind === 'occurrence' ? 0.8 : 1); pri = Math.max(pri, 60); }
      if (this.emph && this.emph.has(v.id)) { a = Math.max(a, 0.9 * smoothstep(1.0, 1.6, kEff)); pri = Math.max(pri, 50); }
      a *= v.vis * (0.12 + 0.88 * v.hl) * (kind === 'occurrence' ? 0.25 + 0.75 * v.live : 0.5 + 0.5 * v.live);
      if (a < 0.04) continue;
      const size = this.fontSize(v, k);
      const weight = kind === 'archetype' ? 600 : kind === 'family' || kind === 'body' ? 500 : 400;
      cands.push({ v, a, pri, text: v.g.label, font: `${weight} ${size.toFixed(1)}px ${SERIF}`, size, kind: 'serif', sub: kind === 'occurrence' && (v === hov || v.id === this.selected) ? v.g.yearDisplay : undefined });
    }
    cands.sort((x, y) => y.pri - x.pri || y.v.g.rank - x.v.g.rank);
    const boxes: number[] = [];
    const room = 3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    let drawn = 0;
    for (const c of cands) {
      if (drawn > 110 && c.pri < 60) break;
      const text = c.text.length > 44 ? c.text.slice(0, 42).trimEnd() + '…' : c.text;
      const tw = this.measure(text, c.font);
      const x = c.v.sx;
      const ys = c.v.sr + c.size * 0.95 + 3;
      const y = c.v.sy + ys;
      const x0 = x - tw / 2 - room;
      const x1 = x + tw / 2 + room;
      const y0 = y - c.size * 0.9;
      const y1 = y + c.size * 0.3 + (c.sub ? 15 : 0);
      if (x1 < 0 || x0 > this.w || y1 < 0 || y0 > this.h) continue;
      if (c.pri < 90) {
        let hit = false;
        for (let i = 0; i < boxes.length; i += 4) {
          if (x0 < boxes[i + 2] && x1 > boxes[i] && y0 < boxes[i + 3] && y1 > boxes[i + 1]) { hit = true; break; }
        }
        if (hit) continue;
      }
      boxes.push(x0, y0, x1, y1);
      drawn++;
      ctx.font = c.font;
      ctx.lineWidth = Math.max(2.5, c.size * 0.26);
      ctx.strokeStyle = rgba('2 3 10', 0.62 * c.a);
      ctx.strokeText(text, x, y);
      ctx.fillStyle = rgba(c.v.g.kind === 'occurrence' ? '226 233 249' : '240 244 253', (c.v.g.kind === 'archetype' ? 0.97 : c.v.g.kind === 'family' ? 0.86 : 0.78) * c.a);
      ctx.fillText(text, x, y);
      if (c.sub) {
        ctx.font = `500 10.5px ${SANS}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = rgba('2 3 10', 0.55 * c.a);
        ctx.strokeText(c.sub, x, y + 15);
        ctx.fillStyle = rgba('214 224 246', 0.62 * c.a);
        ctx.fillText(c.sub, x, y + 15);
      }
    }
    void this.fontsReady;
  }
}
