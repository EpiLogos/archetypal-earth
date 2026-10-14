// The graph mode: the same field as a calm force-directed constellation (Obsidian's graph, in this world's light).
//
// Canvas 2D, HiDPI-aware, d3-force for layout, d3-zoom for pan/zoom/pinch, d3-quadtree for hit-testing.
// It renders only when something changes (a settling simulation, a tween, the pointer, the time window) and
// goes fully idle otherwise. Nothing here knows about the controller: it is told what to show (setTarget)
// and reports what the person chose (GraphHandlers).
//
// The whole field is ~3,500 nodes and ~14,000 relations. It stays light by three rules: the repulsion is the forms'
// alone (field-force.ts: the dust is pushed by them and carries its own push through its form); the whole field's
// arrangement is kept when a local graph is opened, and the nodes the local layout moved glide home when it closes,
// instead of the whole field being laid out again; and a settled field is kept between visits (settings.ts).
// graph.css is loaded by main.ts: the Earth ⇄ Graph pill it styles stands before the graph is ever opened

import { forceCollide, forceLink, forceSimulation, forceX, forceY, type ForceLink, type ForceX, type ForceY, type Simulation, type SimulationLinkDatum } from 'd3-force';
import { quadtree, type Quadtree } from 'd3-quadtree';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import type { Model } from '../data/model';
import type { RGB } from '../data/palette';
import { smoothstep } from '../data/palette';
import type { TimeModel } from '../state/timeModel';
import { buildGraph, edgeAllowed, globalSet, hash01, neighbourhood, nodeLiveness, skyRingPosition, withSkyAnchors, type GEdge, type GNode, type Graph, type Neighbourhood, type NodeKind, type SkyAnchorSource } from './build';
import type { TieBasis } from '../types/field';
import { GraphTools, type ToolState } from './tools';
import { centreStrength, chargeReach, chargeStrength, DEFAULT_FORCES, dustLiveFactor, linkDistance, linkStrength, liveFactor, type Forces } from './forces';
import { clampZoom, Coast, frameSeconds, isCamera, isDoubleClick, MAX_ZOOM, MIN_ZOOM, type Click } from './motion';
import { loadLayout, loadSettings, saveLayout, saveSettings, DEFAULT_DISPLAY, DEFAULT_KINDS, type Display, type KindFlags } from './settings';
import { forceCluster, forceField, type FieldForce } from './field-force';

// outside the local lens the field recedes to a whisper that is still clickable
const GHOST_VIS = 0.05;
// a cursor that has stopped for this long (frame seconds) is when the layout re-reads who is live
const LIVE_SETTLE = 0.2;
// and the heat it is given then: enough to re-arrange the links, not to explode the field
const LIVE_REHEAT = 0.15;
// what a hover leaves lit outside the hovered node and its neighbours: dimmed, never gone
const HOVER_DIM = 0.2;
// a pointer that slips off a node for this long (seconds) between two nodes does not flash the whole field back
const HOVER_LINGER = 0.11;
// the nodes a local layout moved glide back to their place in the whole field over this long (seconds)
const HOME_SECONDS = 0.85;
// the camera's spring (rad/s): critically damped, so a new frame is reached without overshoot or a jolt at the start
const CAM_SPRING = 4.4;
// the most a frame may spend on the layout (ms), and at most two ticks: cheap ticks would otherwise settle the field
// in a fraction of a second, which reads as a jolt rather than a settle
const TICK_BUDGET = 6;
const TICKS_PER_FRAME = 2;

export interface GraphHandlers {
  /** a node was clicked */
  onSelect(key: string): void;
  /** the person wants to see this node (or, with null, the current subject) on Earth */
  onEarth(key: string | null): void;
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
  /** hovered (1) or not (0): the hovered node grows a little */
  hv: number;
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
/** A short, stable signature of a string (FNV-1a, two lanes): enough to tell one field's node list from another's. */
function sigOf(text: string): string {
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = (Math.imul(b, 33) + c) | 0;
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

function nodeRadius(n: GNode): number {
  if (n.kind === 'body') return 6.5 + 2.5 * n.rank;
  if (n.kind === 'archetype') return n.prime ? 23 : 12.5 + 7 * (n.rank - 0.55) / 0.4;
  // a theoretic is a small body of its own, a seed rather than a form; the ground is the larger base the others stand on
  if (n.kind === 'theoretic') return n.ground ? 7 : 3 + 1.8 * n.rank;
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

const MAX_K = MAX_ZOOM;
const MIN_K = MIN_ZOOM;

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
  /** the distant stars: their own canvas behind the field, drawn once per size and slid by the compositor */
  private starsEl: HTMLCanvasElement;
  private starsDrawn = '';
  private starsAt = '';
  /** the soft light of each presence, drawn once per colour (radial gradients are the costliest thing a frame makes) */
  private halos = new Map<string, HTMLCanvasElement>();

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
  private kinds: KindFlags = { ...DEFAULT_KINDS };
  private ties: TieBasis[] = ['jung', 'inferred', 'site'];
  /** the layout's four forces, as the person set them (forces.ts) */
  private forces: Forces = { ...DEFAULT_FORCES };
  /** how it is drawn: node size, link thickness, text fade (settings.ts) */
  private display: Display = { ...DEFAULT_DISPLAY };
  /** the whole field's arrangement, kept when a local graph opens: what it moved glides back when it closes */
  private home: { sig: string; xy: Float32Array; alpha: number } | null = null;
  private homing: { ids: number[]; from: Float32Array; to: Float32Array; t: number; dur: number; alpha: number } | null = null;
  /** the signature of the field's own nodes: a kept layout belongs to exactly this field */
  private fieldSig: string;
  private emph: Set<number> | null = null;
  private active = new Map<number, number>();
  private activeEdges: number[] = [];
  private simNodes: VNode[] = [];
  private lastTargetKey = '';
  /** the layout the shown set was last built for (subject, depth, occurrences, tiers): a target asking for it again is no new layout */
  private builtKey = '';
  private target: GraphTarget = { subject: null, selected: null, emphasis: null };

  // interaction
  private hover = -1;
  private press: { id: number; x: number; y: number; t: number; moved: boolean; pid: number; again: boolean } | null = null;
  private dragging = -1;
  private lastClick: (Click & { id: number }) | null = null;
  /** the touches down on the canvas: a second one makes the gesture a pinch */
  private touches = new Set<number>();
  private pulse = 0;
  /** seconds since the view woke, for the hovered relations' slow breath and the light that travels along them */
  private clock = 0;
  private hoverAt = 0;
  /** the node a slipping pointer last left, still lit for HOVER_LINGER */
  private lingerId = -1;
  private linger = 0;

  // camera
  private insets: Insets = { l: 0, t: 0, r: 0, b: 0 };
  private follow = 0; // seconds of "keep framing the subject" left
  private camAnim: { from: ZoomTransform; to: ZoomTransform; t: number; dur: number } | null = null;
  private autoFit = true;
  /** the framing spring: the world point it holds at the centre of the free space, its log zoom, and their velocities */
  private camGoal: { x: number; y: number; lk: number } | null = null;
  private camVel = { x: 0, y: 0, lk: 0 };
  /** the pan's inertia: it coasts on after the pointer lets go */
  private coast: Coast;
  /** a pan (not a pinch, not a node drag) is in progress */
  private panning = false;

  // time-aware layout: 1 while the cursor is scrubbing (the links of the live are held harder), 0 in 'all time'
  private liveOn = 0;
  /** seconds until the layout re-reads liveness; -1 when nothing is waiting */
  private liveWait = -1;

  private labelW = new Map<string, number>();
  private fontsReady = false;
  private reduced: boolean;

  constructor(parent: HTMLElement, private model: Model, private time: TimeModel, private h_: GraphHandlers, reduced = false) {
    this.reduced = reduced;
    this.coast = new Coast(reduced);
    // what the person chose last time, on this browser (forces, occurrences, relations); depth is per subject
    const saved = loadSettings();
    this.forces = saved.forces;
    this.dust = saved.dust;
    this.ties = saved.ties;
    this.kinds = saved.kinds;
    this.display = saved.display;
    this.gBase = this.g = buildGraph(model);
    this.fieldSig = sigOf(this.g.nodes.map((n) => n.key).join('|'));
    this.live = new Float32Array(this.g.nodes.length).fill(1);
    this.nodes = this.g.nodes.map((n) => this.makeNode(n));
    this.spawnAll();
    // the whole field as it was last at rest on this browser: the first view opens on it, settled
    const kept = loadLayout(this.layoutSig(), this.nodes.length);
    if (kept) {
      for (const v of this.nodes) { v.x = kept[v.id * 2]; v.y = kept[v.id * 2 + 1]; }
      this.home = { sig: this.layoutSig(), xy: kept, alpha: 0 };
    }

    this.starsEl = document.createElement('canvas');
    this.starsEl.className = 'gv-stars';
    this.starsEl.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gv-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'The archetypes, their forms and their occurrences, drawn as a graph. Click a node to focus it, double-click a node to open it on the Earth. Press 0 to reframe.');
    this.canvas.tabIndex = 0;
    const ctx = this.canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;

    this.tools = new GraphTools({
      onDepth: (d) => this.setDepth(d),
      onDust: (on) => this.setDust(on),
      onKinds: (k) => this.setKinds(k),
      onTies: (bases) => this.setTies(bases),
      onForces: (f) => this.setForces(f),
      onDisplay: (d) => this.setDisplay(d),
      onSky: (on) => this.setSkyAnchors(on),
      onFit: () => this.reframe(),
    });
    this.root = document.createElement('div');
    this.root.className = 'gv';
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.append(this.starsEl, this.canvas, this.tools.root);
    parent.append(this.root);

    this.sim = forceSimulation<VNode, SimLink>([]).stop().alphaMin(0.012).velocityDecay(0.36);

    this.zoomB = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([MIN_K, MAX_K])
      .filter((ev: Event) => this.zoomFilter(ev))
      .on('zoom', (ev) => {
        const prev = this.t;
        this.t = ev.transform;
        const src = ev.sourceEvent as Event | null;
        if (src) {
          // the person took the camera: stop framing for them
          this.follow = 0;
          this.camAnim = null;
          this.camGoal = null;
          this.autoFit = false;
          if (src.type === 'wheel') {
            this.coast.stop();
            this.panning = false;
          }
          // a drag that only moves the camera is a pan: its deltas are what the release will carry on with
          if (src.type === 'mousemove' || src.type === 'pointermove' || src.type === 'touchmove') {
            if (ev.transform.k === prev.k) {
              this.panning = true;
              this.coast.record(ev.transform.x - prev.x, ev.transform.y - prev.y, performance.now());
            } else this.panning = false;
          }
        }
        this.qtStale = false;
        this.dirty = true;
        this.wake();
      })
      .on('end', () => {
        // the pointer let go of a pan: it coasts on if it was moving fast enough when it did
        if (!this.panning) return;
        this.panning = false;
        if (this.coast.release(performance.now())) {
          this.follow = 0;
          this.camAnim = null;
          this.camGoal = null;
          this.autoFit = false;
          this.wake();
        }
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
    this.pushTools();
    this.resize();
  }

  // ── set-up ───────────────────────────────────────────────────────────────
  private makeNode(g: GNode): VNode {
    return {
      g, id: g.id, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, r: nodeRadius(g),
      vis: 0, visT: 0, hl: 1, hlT: 1, hv: 0, live: 1, pinned: false,
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
    // a touch that was down when the graph hid never lifts on this canvas: it must not make the next touch a pinch
    this.touches.clear();
    this.coast.stop();
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
    this.linger = 0;
    this.press = null;
    this.touches.clear();
    this.coast.stop();
    this.panning = false;
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
    const layoutKey = this.layoutKey(subject);
    const key = `${layoutKey}|${selected}|${emph ? emph.size : 0}`;
    const prevSelected = this.selected;
    this.selected = selected;
    this.emph = emph;
    this.tools.setState({ ...this.toolState(), local: subject >= 0 });
    if (key === this.lastTargetKey) return;
    // a selected occurrence the shown set lacks brings its form in: that is a change of layout too; a new selection
    // or emphasis inside the same picture is not (it only lights, and the layout is left at rest). Nor is the first
    // target after a first show: that show has just built exactly this picture.
    const layoutChanged = layoutKey !== this.builtKey || this.active.size === 0 || (selected >= 0 && !this.active.has(selected));
    // a new subject, or a selection that is new, is a new frame; filters and forces keep the person's camera
    const reframe = subject !== this.subject || (selected >= 0 && selected !== prevSelected);
    this.lastTargetKey = key;
    // the whole field is about to give way to a local graph: keep its arrangement, so that closing the local graph
    // brings the moved nodes home instead of laying the whole field out again
    if (this.mode === 'global' && subject >= 0 && this.active.size) this.keepHome();
    // whatever was chosen answers the click the same way: its ring of attention closes in on it and settles
    if ((selected >= 0 && selected !== prevSelected) || (subject >= 0 && subject !== this.subject)) this.pulse = 1;
    this.subject = subject;
    this.mode = subject >= 0 ? 'local' : 'global';
    if (this.visible) {
      if (layoutChanged) this.rebuild(false, reframe);
      else this.refreshLit();
      this.wake();
    } else {
      this.active.clear(); // rebuilt on show
    }
  }

  /**
   * The free space changed (a reading or a card opened or closed beside the graph). While the graph is framing for
   * the person, its spring carries the frame into the new space. Once they have taken the camera, their zoom is
   * theirs: the view slides by the same amount the free space's centre moved, so what they were looking at stays in
   * the middle of what they can still see, at the scale they chose.
   */
  setInsets(i: Insets) {
    const same = i.l === this.insets.l && i.t === this.insets.t && i.r === this.insets.r && i.b === this.insets.b;
    const before = this.usable();
    this.insets = i;
    if (same || !this.visible) return;
    if (this.autoFit || this.follow > 0) {
      this.follow = Math.max(this.follow, 1.2);
      this.wake();
    } else {
      const after = this.usable();
      this.coast.stop();
      const to = zoomIdentity.translate(this.t.x + after.cx - before.cx, this.t.y + after.cy - before.cy).scale(this.t.k);
      if (this.reduced) this.setCamera(to.x, to.y, to.k);
      else { this.camAnim = { from: this.t, to, t: 0, dur: 0.9 }; this.wake(); }
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
    return { sky: this.sky.status, bodies, bodyLive, skyEdges, nodes: n, edges: this.activeEdges.length, alpha: this.sim.alpha(), k: this.t.k, mode: this.mode, depth: this.depth, hover: this.hover, subject: this.subject, tieBases: this.ties.slice(), occurrences: this.dust, liveOn: this.liveOn, coasting: this.coast.moving, touching: this.touches.size };
  }

  /** Settle the simulation synchronously (tests, screenshots). */
  settle(ticks = 220) {
    this.finishHoming();
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
    return { local: this.mode === 'local', depth: this.depth, dust: this.dust, ties: this.ties, kinds: { ...this.kinds }, sky: this.sky.status, skyAsOf: this.sky.asOf, forces: this.forces, display: this.display };
  }

  /** What a shown set is built from: the subject, the depth, the occurrences and the tiers. */
  private layoutKey(subject: number): string {
    return `${subject}|${this.depth}|${this.dust ? 1 : 0}|${this.kindSig()}`;
  }

  /** A signature of the tier flags, for the layout key: switching a tier off re-lays the picture. */
  private kindSig(): string {
    return `${this.kinds.archetype ? 1 : 0}${this.kinds.theoretic ? 1 : 0}${this.kinds.family ? 1 : 0}`;
  }

  /** The kinds drawn, as the set builders take them; undefined while every tier is on (nothing to filter). */
  private kindSet(): ReadonlySet<NodeKind> | undefined {
    if (this.kinds.archetype && this.kinds.theoretic && this.kinds.family) return undefined;
    const out = new Set<NodeKind>();
    for (const k of ['archetype', 'theoretic', 'family'] as const) if (this.kinds[k]) out.add(k);
    // occurrences answer to the dust toggle, not to the tiers
    if (this.dust) out.add('occurrence');
    return out;
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

  /** What the person keeps between visits (depth is per subject, so it is not among them). A few hundred bytes: written at once. */
  private remember() {
    saveSettings({ forces: this.forces, dust: this.dust, ties: this.ties, kinds: this.kinds, display: this.display });
  }

  /**
   * Everything that shapes the whole field's arrangement: its nodes, what is drawn, the relations followed, the
   * forces, the sky. A kept arrangement (between visits, or while a local graph is open) belongs to one signature.
   */
  private layoutSig(): string {
    const f = this.forces;
    return `${this.fieldSig}|${this.g.nodes.length}|${this.dust ? 1 : 0}|${this.kindSig()}|${this.ties.join(',')}|${f.centre},${f.repel},${f.link},${f.distance}|${this.sky.on ? 1 : 0}`;
  }

  /** Keep the whole field's arrangement as it stands (a local graph is about to open over it). */
  private keepHome() {
    // mid-glide, home is where the glide is going, not where the nodes are on the way
    if (this.homing && this.homing.to.length === this.nodes.length * 2) {
      this.home = { sig: this.layoutSig(), xy: this.homing.to.slice(), alpha: this.homing.alpha };
      return;
    }
    const xy = new Float32Array(this.nodes.length * 2);
    for (const v of this.nodes) { xy[v.id * 2] = v.x; xy[v.id * 2 + 1] = v.y; }
    this.home = { sig: this.layoutSig(), xy, alpha: this.sim.alpha() };
  }

  /** The whole field has come to rest: keep it on this browser for the next visit (written when the page is idle). */
  private keepLayout() {
    if (this.mode !== 'global' || this.g !== this.gBase || this.homing || !this.active.size) return;
    const xy = new Float32Array(this.nodes.length * 2);
    for (const v of this.nodes) { xy[v.id * 2] = v.x; xy[v.id * 2 + 1] = v.y; }
    const sig = this.layoutSig();
    const write = () => saveLayout(sig, xy);
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(write, { timeout: 2000 });
    else window.setTimeout(write, 200);
  }

  /** The drawing only: node size, link thickness, how soon names appear. The layout is not touched. */
  private setDisplay(d: Display) {
    this.display = { ...d };
    this.remember();
    this.pushTools();
    this.dirty = true;
    this.wake();
  }

  private setDust(on: boolean) {
    if (on === this.dust) return;
    this.dust = on;
    this.remember();
    this.pushTools();
    this.lastTargetKey = '';
    this.setTarget(this.target);
  }

  /** A tier switched on or off: its nodes and its ties leave the drawing together. */
  private setKinds(next: KindFlags) {
    if (next.archetype === this.kinds.archetype && next.theoretic === this.kinds.theoretic && next.family === this.kinds.family) return;
    this.kinds = { ...next };
    this.remember();
    this.pushTools();
    this.lastTargetKey = '';
    this.setTarget(this.target);
  }

  // ── which nodes are shown ────────────────────────────────────────────────
  private setTies(bases: TieBasis[]) {
    this.ties = bases;
    this.remember();
    this.pushTools();
    if (this.visible) { this.rebuild(false); this.wake(); }
  }

  /** The four forces, as the person set them: re-set on the live layout (the nodes keep their places) and reheated, so the change is seen settling. */
  private setForces(f: Forces) {
    this.forces = { ...f };
    this.remember();
    this.pushTools();
    if (this.visible) {
      this.finishHoming();
      this.applyForces();
      this.sim.alpha(Math.max(this.sim.alpha(), 0.5));
      this.wake();
    }
  }

  /** The force functions of the current layout, read from the settings: built per layout, and re-set in place when a setting moves. */
  private forceFns() {
    const local = this.mode === 'local';
    const f = this.forces;
    const on = this.liveOn;
    return {
      dist: (l: SimLink) => linkDistance(l.e, local, f),
      // time-aware (audit T1): the ties and instances of the live hold harder than those of the ghosts; exactly as drawn in 'all time'
      str: (l: SimLink) => linkStrength(l.e, this.nodes[l.e.t].g.prime, f)
        * (l.e.kind === 'tie' || l.e.kind === 'instance' ? liveFactor(this.nodes[l.e.s].live, this.nodes[l.e.t].live, on) : 1),
      charge: (v: VNode) => chargeStrength(v.g.kind, v.g.prime || v.g.ground, v.g.rank, local, f) * dustLiveFactor(v.g.kind, v.live, on),
      centre: centreStrength(local, f),
      reach: chargeReach(f),
    };
  }

  /** The form an occurrence belongs to, when it is on stage: it carries the occurrence's push in the far field. */
  private parentOf = (v: VNode): VNode | null => {
    if (v.g.kind !== 'occurrence') return null;
    const fi = this.g.byKey.get(`f:${this.model.occ[v.g.occIdx].familyId}`);
    return fi !== undefined && this.active.has(fi) ? this.nodes[fi] : null;
  };

  private applyForces() {
    const fns = this.forceFns();
    (this.sim.force('link') as ForceLink<VNode, SimLink> | undefined)?.distance(fns.dist).strength(fns.str);
    (this.sim.force('charge') as FieldForce<VNode> | undefined)?.strength(fns.charge).distanceMax(fns.reach);
    (this.sim.force('cluster') as ReturnType<typeof forceCluster<VNode>> | undefined)?.strength(fns.charge);
    (this.sim.force('x') as ForceX<VNode> | undefined)?.strength(fns.centre);
    (this.sim.force('y') as ForceY<VNode> | undefined)?.strength(fns.centre);
  }

  private computeActive(): Neighbourhood {
    const g = this.g;
    let nb: Neighbourhood;
    if (this.mode === 'local' && this.subject >= 0) {
      nb = neighbourhood(g, [this.subject], { depth: this.depth, occurrences: this.dust, tieBases: this.ties, kinds: this.kindSet(), cap: this.depth >= 3 ? 520 : 380 });
    } else {
      nb = globalSet(g, this.dust, this.ties, this.kindSet());
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

  private rebuild(first: boolean, reframe = first) {
    const g = this.g;
    const nb = this.computeActive();
    const wasOn = new Set<number>();
    for (const v of this.nodes) if (v.vis >= GHOST_VIS || v.visT > 0.5) wasOn.add(v.id);
    this.finishHoming();
    this.active = nb.dist;
    this.activeEdges = nb.edges;
    this.builtKey = this.layoutKey(this.subject);
    // back to the whole field as it was left: the nodes the local layout moved glide home, and nothing is laid out again
    // (a local graph after a local graph keeps the whole field's arrangement waiting; the whole field takes it up)
    const home = this.mode === 'global' && this.home && this.home.sig === this.layoutSig() && this.home.xy.length === this.nodes.length * 2 ? this.home : null;
    if (this.mode === 'global') this.home = null;

    // enter / leave
    const entering: number[] = [];
    for (const v of this.nodes) {
      const isOn = this.active.has(v.id);
      v.visT = isOn ? 1 : GHOST_VIS;
      if (isOn && !wasOn.has(v.id)) entering.push(v.id);
      if (first && isOn) v.vis = 1;
      if (first && !isOn) v.vis = 0;
    }
    // newcomers burst out of the nearest thing already there (a node going home needs no burst: its place is known)
    if (!first && !home) {
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
    const fns = this.forceFns();
    const n = this.simNodes.length;
    const decay = n > 1500 ? 0.032 : n > 700 ? 0.026 : 0.0228;
    // collisions are the forms' (the dust keeps its distance by the cluster force): the dust is most of the nodes
    const heavy = (v: VNode) => v.g.kind !== 'occurrence' || this.parentOf(v) === null;
    const collide = forceCollide<VNode>((v) => v.r * 1.12 + 2.2).strength(0.7);
    const collideHeavy = Object.assign((a: number) => collide(a), { initialize: (ns: VNode[], random: () => number) => collide.initialize(ns.filter(heavy), random) });
    this.sim
      .nodes(this.simNodes)
      .force('link', forceLink<VNode, SimLink>(links).distance(fns.dist).strength(fns.str).iterations(1))
      .force('charge', forceField<VNode>().parent(this.parentOf).strength(fns.charge).theta(0.95).distanceMax(fns.reach))
      .force('cluster', forceCluster<VNode>().group(this.parentOf).strength(fns.charge).distanceMax(fns.reach))
      .force('collide', collideHeavy)
      .force('x', forceX<VNode>(0).strength(fns.centre))
      .force('y', forceY<VNode>(0).strength(fns.centre))
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

    if (home) {
      const ids: number[] = [];
      for (const v of this.nodes) {
        v.vx = v.vy = 0;
        if (Math.abs(v.x - home.xy[v.id * 2]) > 0.05 || Math.abs(v.y - home.xy[v.id * 2 + 1]) > 0.05) ids.push(v.id);
      }
      const from = new Float32Array(ids.length * 2);
      ids.forEach((id, i) => { from[i * 2] = this.nodes[id].x; from[i * 2 + 1] = this.nodes[id].y; });
      this.homing = { ids, from, to: home.xy, t: 0, dur: this.reduced ? 0.01 : HOME_SECONDS, alpha: home.alpha };
      // the field is at rest where it was: the layout waits for the glide, then carries on only if it was still settling
      this.sim.alpha(0);
    } else if (first) {
      // arrive already composed: the first screenful of motion is a settle, not an explosion (a whole field kept
      // between visits arrives through `home` above, already at rest). A fixed count, never a time budget: the same
      // field must settle into the same arrangement on every machine.
      const warm = Math.min(120, Math.round(90000 / Math.max(60, n)));
      for (let i = 0; i < warm; i++) this.sim.tick();
      this.sim.alpha(0.35);
    }
    this.qtStale = true;
    this.refreshLit();
    this.timeDirty = true;
    if (reframe) {
      // a new subject, or a first show: a new composition, framed afresh
      this.autoFit = true;
      this.follow = this.reduced ? 0.1 : 3.4;
    } else if (this.autoFit) {
      // a filter or a force reshapes the frame the person already has: ease to it, and leave their own camera alone
      this.follow = Math.max(this.follow, 1.2);
    }
    if (first) this.refit(0);
    this.dirty = true;
  }

  /** The glide home ends where it is going: the nodes stand in their places and the layout carries on as it was. */
  private finishHoming() {
    const h = this.homing;
    if (!h) return;
    this.homing = null;
    h.ids.forEach((id) => { const v = this.nodes[id]; if (v) { v.x = h.to[id * 2]; v.y = h.to[id * 2 + 1]; v.vx = v.vy = 0; } });
    if (h.alpha > this.sim.alphaMin()) this.sim.alpha(Math.max(this.sim.alpha(), h.alpha));
    this.qtStale = true;
    this.dirty = true;
  }

  /** Which nodes are lit given hover (or a hover that has only just slipped off) and emphasis. */
  private refreshLit() {
    const g = this.g;
    const emph = this.emph;
    const lit0 = this.hover >= 0 ? this.hover : this.linger > 0 ? this.lingerId : -1;
    if (lit0 >= 0 && this.active.has(lit0)) {
      const lit = new Set<number>([lit0]);
      for (const nb of g.adj[lit0]) if (this.active.has(nb)) lit.add(nb);
      for (const v of this.nodes) v.hlT = lit.has(v.id) ? 1 : HOVER_DIM;
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
    const dt = frameSeconds(ts - this.lastTs);
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
    this.clock += dt;

    // the nodes a local graph moved glide back to their place in the whole field
    if (this.homing) {
      const h = this.homing;
      h.t = Math.min(1, h.t + dt / h.dur);
      const e = ease(h.t);
      h.ids.forEach((id, i) => {
        const v = this.nodes[id];
        v.x = h.from[i * 2] + (h.to[id * 2] - h.from[i * 2]) * e;
        v.y = h.from[i * 2 + 1] + (h.to[id * 2 + 1] - h.from[i * 2 + 1]) * e;
      });
      if (h.t >= 1) this.finishHoming();
      this.qtStale = true;
      this.dirty = true;
      busy = true;
    }

    // simulation: up to two ticks a frame, as the frame budget allows
    const wasRunning = this.sim.alpha() > this.sim.alphaMin();
    if (wasRunning || this.dragging >= 0) {
      const t0 = performance.now();
      let n = 0;
      do {
        this.sim.tick();
        n++;
      } while (n < TICKS_PER_FRAME && performance.now() - t0 < TICK_BUDGET);
      this.qtStale = true;
      busy = true;
      this.dirty = true;
      // the whole field has come to rest: keep it for the next visit
      if (this.sim.alpha() <= this.sim.alphaMin() && this.dragging < 0) this.keepLayout();
    }

    // presence / lit / hover tweens: dimming is quick, coming back is a little slower, so a passing pointer is calm
    const kv = 1 - Math.exp(-dt * (this.reduced ? 30 : 4.2));
    const kDim = 1 - Math.exp(-dt * (this.reduced ? 30 : 13));
    const kLift = 1 - Math.exp(-dt * (this.reduced ? 30 : 7.5));
    const kHov = 1 - Math.exp(-dt * (this.reduced ? 30 : 14));
    for (const v of this.nodes) {
      if (v.vis !== v.visT) {
        v.vis += (v.visT - v.vis) * kv;
        if (Math.abs(v.visT - v.vis) < 0.004) v.vis = v.visT;
        busy = true;
        this.dirty = true;
      }
      if (v.hl !== v.hlT) {
        v.hl += (v.hlT - v.hl) * (v.hlT < v.hl ? kDim : kLift);
        if (Math.abs(v.hlT - v.hl) < 0.006) v.hl = v.hlT;
        busy = true;
        this.dirty = true;
      }
      const hvT = v.id === this.hover ? 1 : 0;
      if (v.hv !== hvT) {
        v.hv += (hvT - v.hv) * kHov;
        if (Math.abs(hvT - v.hv) < 0.01) v.hv = hvT;
        busy = true;
        this.dirty = true;
      }
    }
    // a pointer that slipped off a node: its neighbourhood stays lit for a breath, then the field comes back
    if (this.linger > 0) {
      this.linger -= dt;
      busy = true;
      if (this.linger <= 0) { this.linger = 0; this.lingerId = -1; this.refreshLit(); }
    }
    // the hovered node's relations breathe, and a light travels out along them: drawn while the pointer rests there
    if (this.hover >= 0 && !this.reduced) {
      busy = true;
      this.dirty = true;
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
      let moved = false;
      for (const v of this.nodes) {
        const nl = this.live[v.id];
        if (Math.abs(nl - v.live) > 1e-3) moved = true;
        v.live = nl;
      }
      this.qtStale = true;
      if (this.hover >= 0 && this.nodes[this.hover].g.kind === 'occurrence' && this.nodes[this.hover].live <= 0.525) {
        this.hover = -1;
        this.canvas.style.cursor = '';
        this.refreshLit();
      }
      // the layout takes the new liveness once the cursor has been still for a moment, not on every frame of a scrub
      const on = this.time.mode === 'cursor' ? 1 : 0;
      if (on !== this.liveOn) {
        this.liveOn = on;
        this.liveWait = on ? LIVE_SETTLE : 0;
      } else if (on && moved) {
        this.liveWait = LIVE_SETTLE;
      }
      this.dirty = true;
    }
    if (this.liveWait >= 0) {
      this.liveWait -= dt;
      busy = true;
      if (this.liveWait <= 0) {
        this.liveWait = -1;
        this.applyForces();
        this.sim.alpha(Math.max(this.sim.alpha(), LIVE_REHEAT));
      }
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
      // the world point at the centre of the view travels in a straight line while the zoom eases geometrically,
      // so what is in the middle stays in the middle as the scale changes (no swoop)
      const cx = this.w / 2;
      const cy = this.h / 2;
      const k = a.from.k * Math.pow(a.to.k / a.from.k, e);
      const fx = (cx - a.from.x) / a.from.k;
      const fy = (cy - a.from.y) / a.from.k;
      const tx = (cx - a.to.x) / a.to.k;
      const ty = (cy - a.to.y) / a.to.k;
      this.setCamera(cx - (fx + (tx - fx) * e) * k, cy - (fy + (ty - fy) * e) * k, k);
      if (a.t >= 1) this.camAnim = null;
      busy = true;
    } else if (this.autoFit && (this.follow > 0 || this.camGoal)) {
      if (this.follow > 0) this.follow -= dt;
      if (this.followCamera(dt)) busy = true;
    }
    // the pan's inertia: the release's velocity, decayed; every step goes through setCamera (NaN-guarded)
    if (this.coast.moving) {
      const d = this.coast.step(dt);
      this.setCamera(this.t.x + d.dx, this.t.y + d.dy, this.t.k);
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

  /**
   * Keep framing what is shown, on a critically damped spring: the camera starts gently, arrives without overshoot,
   * and a frame that moves (a layout still settling, a reading opening beside it) is followed without a jolt. The
   * spring holds the world point at the centre of the free space and the log of the zoom, so the subject stays put
   * on screen while the scale changes. Once the follow time is up it finishes reaching its last goal and rests.
   * Returns whether it is still moving.
   */
  private followCamera(dt: number): boolean {
    const u = this.usable();
    const k0 = this.t.k;
    const pos = { x: (u.cx - this.t.x) / k0, y: (u.cy - this.t.y) / k0, lk: Math.log(k0) };
    if (this.follow > 0 || !this.camGoal) {
      const fit = this.fitCamera();
      this.camGoal = { x: (u.cx - fit.x) / fit.k, y: (u.cy - fit.y) / fit.k, lk: Math.log(fit.k) };
    }
    const goal = this.camGoal;
    if (this.reduced) {
      this.camVel = { x: 0, y: 0, lk: 0 };
      const k = Math.exp(goal.lk);
      this.setCamera(u.cx - goal.x * k, u.cy - goal.y * k, k);
      if (this.follow <= 0) this.camGoal = null;
      return this.follow > 0;
    }
    const w = CAM_SPRING;
    const v = this.camVel;
    // semi-implicit Euler on x'' = w²(goal - x) - 2w x' (stable at the clock's longest frame)
    v.x += (w * w * (goal.x - pos.x) - 2 * w * v.x) * dt;
    v.y += (w * w * (goal.y - pos.y) - 2 * w * v.y) * dt;
    v.lk += (w * w * (goal.lk - pos.lk) - 2 * w * v.lk) * dt;
    const x = pos.x + v.x * dt;
    const y = pos.y + v.y * dt;
    const lk = pos.lk + v.lk * dt;
    const k = clampZoom(Math.exp(lk));
    this.setCamera(u.cx - x * k, u.cy - y * k, k);
    // at rest: within a fraction of a pixel and barely moving, once nothing more is being followed
    const px = Math.hypot(goal.x - x, goal.y - y) * k + Math.abs(goal.lk - lk) * 400;
    const speed = Math.hypot(v.x, v.y) * k + Math.abs(v.lk) * 400;
    if (this.follow <= 0 && px < 0.3 && speed < 2) {
      this.camGoal = null;
      this.camVel = { x: 0, y: 0, lk: 0 };
      return false;
    }
    return true;
  }

  private refit(seconds: number) {
    this.coast.stop();
    this.camGoal = null;
    this.camVel = { x: 0, y: 0, lk: 0 };
    const to = this.fitCamera();
    if (seconds <= 0 || this.reduced) {
      this.camAnim = null;
      this.setCamera(to.x, to.y, to.k);
    } else {
      this.camAnim = { from: this.t, to: zoomIdentity.translate(to.x, to.y).scale(to.k), t: 0, dur: seconds };
      this.wake();
    }
  }

  /** Frame what is shown afresh: the way back once the person has moved the camera (Reframe, the key 0). */
  private reframe() {
    this.autoFit = true;
    this.follow = 1.2;
    this.refit(0.8);
    this.wake();
  }

  private setCamera(x: number, y: number, k: number) {
    // no NaN, and no zoom past the extent, ever reaches the transform: a bad camera frames the subject instead
    let c = { x, y, k };
    if (!isCamera(c.x, c.y, c.k)) {
      c = this.fitCamera();
      if (!isCamera(c.x, c.y, c.k)) return;
    }
    this.t = zoomIdentity.translate(c.x, c.y).scale(clampZoom(c.k));
    // keep d3-zoom's own state in step so the next wheel / drag starts from here
    (this.canvas as unknown as { __zoom: ZoomTransform }).__zoom = this.t;
    this.dirty = true;
  }

  private nudgeCamera(dx: number, dy: number, f: number) {
    this.coast.stop();
    this.follow = 0;
    this.camAnim = null;
    this.camGoal = null;
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
    this.drawStars();
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
    const search = (this.maxRadius() * Math.pow(k, 0.55) * this.display.size + slop * k) / k + 2;
    this.tree().visit((node, x0, y0, x1, y1) => {
      if (!node.length) {
        let n: typeof node | undefined = node;
        do {
          const v = (n as unknown as { data: VNode }).data;
          const d = Math.hypot(v.x - wx, v.y - wy);
          const reach = (v.r * Math.pow(k, 0.55) * this.display.size) / k + slop;
          if (d <= reach) {
            // nearest edge wins; bigger things win ties so a form (or a small theoretic) is never hidden under the dust
            const score = d / reach - (v.g.kind === 'archetype' ? 0.6 : v.g.kind === 'body' ? 0.5 : v.g.kind === 'theoretic' ? 0.4 : v.g.kind === 'family' ? 0.3 : 0);
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
    // a second finger makes it a pinch: a node the first finger was holding gives way to the camera
    if (ev.type === 'touchstart' && (ev as TouchEvent).touches.length > 1) {
      this.releasePress();
      return true;
    }
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
    // a new touch on the field catches the coasting camera where it is
    this.coast.stop();
    if (ev.pointerType !== 'mouse') {
      // a second finger on the canvas is a pinch: no node is grabbed for it
      this.touches.add(ev.pointerId);
      if (this.touches.size > 1) {
        this.releasePress();
        return;
      }
    }
    const p = this.local(ev);
    // the second click of a double-click is the first click's node, wherever the field has carried it since
    const first = this.lastClick && isDoubleClick(this.lastClick, { x: p.x, y: p.y, t: performance.now() }) ? this.lastClick : null;
    const hit = first ? this.nodes[first.id] : this.pick(p.x, p.y, ev.pointerType !== 'mouse');
    if (!hit) {
      this.press = null;
      return;
    }
    this.press = { id: hit.id, x: p.x, y: p.y, t: performance.now(), moved: false, pid: ev.pointerId, again: !!first };
    this.canvas.setPointerCapture?.(ev.pointerId);
  };

  private onMove = (ev: PointerEvent) => {
    const p = this.local(ev);
    if (this.press && ev.pointerId === this.press.pid) {
      const press = this.press;
      if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > 4) {
        press.moved = true;
        this.finishHoming();
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
    this.setHover(hit ? hit.id : -1);
  };

  /**
   * The pointer is over this node now (or none). Slipping off a node does not flash the whole field back at once:
   * for a breath (HOVER_LINGER) its neighbourhood stays lit, so moving from one node to the next stays calm.
   */
  private setHover(id: number) {
    if (id === this.hover) return;
    if (id < 0 && this.hover >= 0 && !this.reduced) { this.lingerId = this.hover; this.linger = HOVER_LINGER; }
    else this.linger = 0;
    // a new node: its relations' light starts from it afresh
    if (id >= 0) this.hoverAt = this.clock;
    this.hover = id;
    this.canvas.style.cursor = id >= 0 ? 'pointer' : '';
    this.refreshLit();
    this.wake();
  }

  /** Let go of the node the pointer holds: a second finger has made the gesture a pinch. */
  private releasePress() {
    const press = this.press;
    if (!press) return;
    this.press = null;
    this.canvas.releasePointerCapture?.(press.pid);
    if (this.dragging >= 0) this.dropNode();
  }

  /** A dragged node is let go: free again, unless it holds a ring place or is the subject holding the neighbourhood together. */
  private dropNode() {
    const v = this.nodes[this.dragging];
    this.dragging = -1;
    const ring = this.ringPlace(v);
    if (ring) { v.fx = ring.x; v.fy = ring.y; } else if (v.pinned) { v.fx = v.x; v.fy = v.y; } else { v.fx = v.fy = null; }
    this.sim.alphaTarget(0);
    this.wake();
  }

  private onUp = (ev: PointerEvent) => {
    this.touches.delete(ev.pointerId);
    const press = this.press;
    if (!press || ev.pointerId !== press.pid) return;
    this.press = null;
    this.canvas.releasePointerCapture?.(ev.pointerId);
    if (this.dragging >= 0) {
      this.dropNode();
      return;
    }
    if (ev.type === 'pointercancel') return;
    if (press.again) {
      // the second click of a double-click: that node, on the Earth
      this.lastClick = null;
      this.h_.onEarth(this.g.nodes[press.id].key);
      return;
    }
    const p = this.local(ev);
    this.lastClick = { id: press.id, x: p.x, y: p.y, t: performance.now() };
    this.h_.onSelect(this.g.nodes[press.id].key);
  };

  private onLeave = () => {
    if (this.hover >= 0 && !this.press) this.setHover(-1);
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
      case '0': this.reframe(); break;
      default: return;
    }
    ev.preventDefault();
  };

  // ── drawing ──────────────────────────────────────────────────────────────
  /** The distant stars, drawn once for this size onto their own canvas behind the field. */
  private drawStars() {
    const pad = 80;
    const sig = `${this.w}x${this.h}@${this.dpr}`;
    if (sig === this.starsDrawn) return;
    this.starsDrawn = sig;
    const c = this.starsEl;
    c.width = Math.round((this.w + pad * 2) * this.dpr);
    c.height = Math.round((this.h + pad * 2) * this.dpr);
    c.style.width = `${this.w + pad * 2}px`;
    c.style.height = `${this.h + pad * 2}px`;
    const x = c.getContext('2d');
    if (!x) return;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.clearRect(0, 0, this.w + pad * 2, this.h + pad * 2);
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
  }

  /** The soft light of a presence in one colour: a radial gradient drawn once and stamped from then on. */
  private halo(trip: string): HTMLCanvasElement {
    let c = this.halos.get(trip);
    if (c) return c;
    const S = 64;
    c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(S / 2, S / 2, S * 0.065, S / 2, S / 2, S / 2);
    gr.addColorStop(0, rgba(trip, 1));
    gr.addColorStop(1, rgba(trip, 0));
    x.fillStyle = gr;
    x.fillRect(0, 0, S, S);
    if (this.halos.size > 900) this.halos.clear();
    this.halos.set(trip, c);
    return c;
  }

  private fontSize(v: VNode, k: number): number {
    if (v.g.kind === 'archetype') return (v.g.prime ? 17.5 : 15) * Math.min(1.25, 0.88 + 0.12 * k);
    if (v.g.kind === 'theoretic') return (v.g.ground ? 14.5 : 12 + 2.4 * v.g.rank) * Math.min(1.22, 0.9 + 0.11 * k);
    if (v.g.kind === 'family') return (12.2 + 2.6 * v.g.rank) * Math.min(1.2, 0.9 + 0.1 * k);
    if (v.g.kind === 'body') return 12.5 * Math.min(1.2, 0.9 + 0.1 * k);
    return 11.5 * Math.min(1.15, 0.92 + 0.08 * k);
  }

  /**
   * A label's width. Text scales with its size, so each name is measured once per weight at a reference size and
   * scaled: a zoom, which changes every label's size every frame, never measures again.
   */
  private measure(text: string, weight: number, size: number): number {
    const key = `${weight}|${text}`;
    let w = this.labelW.get(key);
    if (w === undefined) {
      this.ctx.font = `${weight} 100px ${SERIF}`;
      w = this.ctx.measureText(text).width;
      this.labelW.set(key, w);
      if (this.labelW.size > 6000) this.labelW.clear();
    }
    return (w * size) / 100;
  }

  private draw() {
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    const k = this.t.k;
    const tx = this.t.x;
    const ty = this.t.y;
    const local = this.mode === 'local';
    const kEff = local ? k * 1.4 : k;
    const size = this.display.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // distant stars drift a little against the camera: depth without noise (their own layer; only its offset moves)
    const at = `translate3d(${(-80 + ((tx * 0.035) % 80)).toFixed(1)}px, ${(-80 + ((ty * 0.035) % 80)).toFixed(1)}px, 0)`;
    if (at !== this.starsAt) { this.starsAt = at; this.starsEl.style.transform = at; }

    // screen positions of what is on stage
    const margin = 90;
    const stage: VNode[] = [];
    const grow = Math.pow(k, 0.55) * size;
    // level of detail: the dust and the strands recede as the whole field comes into view
    const dustK = local ? 1 : 0.5 + 0.5 * smoothstep(0.55, 1.5, k);
    for (const v of this.nodes) {
      if (v.vis < 0.012) { v.on = false; continue; }
      v.sx = tx + v.x * k;
      v.sy = ty + v.y * k;
      // the hovered node swells a little, as a thing under the hand does
      v.sr = Math.max(v.g.kind === 'occurrence' ? 1.15 : v.g.kind === 'theoretic' ? 2.1 : 2.4, v.r * grow) * (1 + 0.18 * v.hv);
      v.on = v.sx > -margin && v.sx < w + margin && v.sy > -margin && v.sy < h + margin;
      if (v.on) stage.push(v);
    }
    const hov = this.hover >= 0 ? this.nodes[this.hover] : null;

    if (!local && this.g.bodyIds.length && this.sky.source) this.drawSkyRing(ctx, k);
    this.drawEdges(ctx, k, kEff, local, hov);

    // halos, additive: the soft light of each presence, stamped from one sprite per colour
    ctx.globalCompositeOperation = 'lighter';
    for (const v of stage) {
      const kind = v.g.kind;
      if (kind === 'occurrence') continue;
      const a = v.vis * v.hl * v.live;
      if (a < 0.02) continue;
      const rad = v.sr * (kind === 'archetype' ? 3.7 : kind === 'theoretic' ? (v.g.ground ? 5.2 : 3.6) : kind === 'body' ? 3.2 : 2.7);
      const strength = kind === 'archetype' ? 0.36 : kind === 'theoretic' ? (v.g.ground ? 0.4 : 0.2 + 0.1 * v.g.rank) : kind === 'body' ? 0.3 : 0.15 + 0.09 * v.g.rank;
      ctx.globalAlpha = Math.min(1, strength * a * (1 + 0.5 * v.hv));
      ctx.drawImage(this.halo(v.glow), v.sx - rad, v.sy - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // the dust: one path per colour and strength, so three thousand points cost a few hundred fills
    const dust = new Map<string, { trip: string; a: number; pts: number[] }>();
    const hollow: VNode[] = [];
    let sel: VNode | null = null;
    for (const v of stage) {
      if (v.g.kind !== 'occurrence') continue;
      const a = v.vis * (0.28 + 0.72 * v.hl) * v.live * dustK;
      if (a < 0.015) continue;
      if (!v.g.placed) { hollow.push(v); continue; }
      if (v.id === this.selected) { sel = v; continue; }
      const fa = Math.round((0.62 + 0.3 * (v.hl > 0.9 ? 1 : 0)) * a * 24) / 24;
      if (fa < 0.015) continue;
      const bk = `${v.rgb}|${fa}`;
      let b = dust.get(bk);
      if (!b) dust.set(bk, (b = { trip: v.rgb, a: fa, pts: [] }));
      b.pts.push(v.sx, v.sy, v.sr);
    }
    for (const b of dust.values()) {
      ctx.fillStyle = rgba(b.trip, b.a);
      ctx.beginPath();
      const p = b.pts;
      for (let i = 0; i < p.length; i += 3) {
        const r = p[i + 2];
        // a point this small is drawn as a square of the same area: the eye cannot tell, the rasteriser can
        if (r < 1.5) ctx.rect(p[i] - r * 0.886, p[i + 1] - r * 0.886, r * 1.772, r * 1.772);
        else { ctx.moveTo(p[i] + r, p[i + 1]); ctx.arc(p[i], p[i + 1], r, 0, Math.PI * 2); }
      }
      ctx.fill();
    }
    if (sel) {
      const a = sel.vis * (0.28 + 0.72 * sel.hl) * sel.live * dustK;
      ctx.fillStyle = rgba(sel.rgb, a);
      ctx.beginPath();
      ctx.arc(sel.sx, sel.sy, sel.sr * 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    // no place on the globe (an occurrence with no recorded place; a symbol with no placed instance): a hollow,
    // dashed ring, so its absence from the globe and from every walk is visible, not silent
    const hollowRing = (v: VNode, a: number) => {
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2.5]);
      ctx.strokeStyle = rgba(v.rgb, 0.85 * a);
      ctx.beginPath();
      ctx.arc(v.sx, v.sy, Math.max(2.5, v.sr), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    for (const v of hollow) hollowRing(v, v.vis * (0.28 + 0.72 * v.hl) * v.live * dustK);

    // then forms, theoretics, archetypes and bodies
    for (const pass of ['family', 'theoretic', 'archetype', 'body'] as const) {
      for (const v of stage) {
        if (v.g.kind !== pass) continue;
        const a = v.vis * (0.28 + 0.72 * v.hl) * (0.35 + 0.65 * v.live);
        if (a < 0.015) continue;
        // (a theoretic is a concept: its place is its ties', so it is always drawn as the seed it is)
        if (!v.g.placed && pass !== 'body' && pass !== 'theoretic') { hollowRing(v, a); continue; }
        if (pass === 'body') {
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
        } else if (pass === 'theoretic') {
          // a theoretic is a seed: a small bright body in its own colour inside a thin ring of the same light,
          // the ring set off by a hair of dark so it reads as a concept, not a form; the ground carries a second ring
          ctx.fillStyle = rgba(v.rgb, 0.95 * a);
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, v.sr, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = rgba('255 255 255', 0.55 * a);
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, Math.max(0.7, v.sr * 0.38), 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = rgba(v.rgb, 0.62 * a);
          ctx.beginPath();
          ctx.arc(v.sx, v.sy, v.sr + 2.4, 0, Math.PI * 2);
          ctx.stroke();
          if (v.g.ground) {
            ctx.strokeStyle = rgba(v.rgb, 0.3 * a);
            ctx.beginPath();
            ctx.arc(v.sx, v.sy, v.sr + 5.6, 0, Math.PI * 2);
            ctx.stroke();
          }
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
    if (this.subject >= 0) {
      const p = this.selected >= 0 ? 0 : this.pulse;
      ring(this.nodes[this.subject], 7 + p * 12, 0.85 - p * 0.4);
    }
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
    // and every relation recedes a little as the whole field comes into view
    const edgeK = local ? 1 : 0.62 + 0.38 * smoothstep(0.6, 1.5, k);
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
      let alpha = style.alpha * vis * gate * edgeK * (0.15 + 0.85 * lit) * (0.3 + 0.7 * live);
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
    const lw = this.display.links;
    for (const bkt of buckets.values()) {
      ctx.strokeStyle = rgba(bkt.trip, bkt.a);
      ctx.lineWidth = bkt.st.width * lw;
      ctx.setLineDash(bkt.st.dash);
      ctx.beginPath();
      const s = bkt.segs;
      for (let i = 0; i < s.length; i += 4) {
        ctx.moveTo(s[i], s[i + 1]);
        ctx.lineTo(s[i + 2], s[i + 3]);
      }
      ctx.stroke();
    }
    // the hovered node's strands: not a glare but a quiet rise in their own colours (from the node's to the
    // neighbour's), breathing slowly, with a soft light that travels out from the node along each of them
    if (hot.length && hov) {
      const breath = this.reduced ? 1 : 0.84 + 0.16 * Math.sin((this.clock - this.hoverAt) * 2.3);
      // the light leaves the node every PERIOD seconds and travels SPEED px a second: a ripple outwards
      const PERIOD = 2.2;
      const SPEED = 240;
      const since = this.clock - this.hoverAt;
      const travelled = ((since % PERIOD) + PERIOD) % PERIOD * SPEED;
      for (const e of hot) {
        const p = this.nodes[e.s] === hov ? this.nodes[e.s] : this.nodes[e.t];
        const q = p === this.nodes[e.s] ? this.nodes[e.t] : this.nodes[e.s];
        const style = STYLE[styleOf(e)];
        const vis = Math.min(p.vis, q.vis);
        const live = 0.3 + 0.7 * Math.min(p.live, q.live);
        const base = Math.min(0.56, style.alpha * 1.3 + 0.12) * vis * live * breath;
        if (base < 0.012) continue;
        const gr = ctx.createLinearGradient(p.sx, p.sy, q.sx, q.sy);
        gr.addColorStop(0, rgba(p.rgb, base));
        gr.addColorStop(1, rgba(q.rgb, base * 0.85));
        ctx.strokeStyle = gr;
        ctx.lineWidth = (style.width + 0.3) * lw;
        ctx.setLineDash(style.dash);
        ctx.beginPath();
        ctx.moveTo(p.sx, p.sy);
        ctx.lineTo(q.sx, q.sy);
        ctx.stroke();
        if (this.reduced || since < 0.12) continue;
        const len = Math.hypot(q.sx - p.sx, q.sy - p.sy);
        const from = p.sr + 2;
        const d = from + travelled;
        if (len < 24 || d > len - q.sr) continue;
        const ux = (q.sx - p.sx) / len;
        const uy = (q.sy - p.sy) / len;
        const half = Math.min(22, len * 0.18);
        // fades in leaving the node and out arriving at the neighbour
        const f = Math.sin(Math.PI * Math.min(1, Math.max(0, (d - from) / Math.max(1, len - q.sr - from))));
        const ga = 0.34 * f * vis * live;
        if (ga < 0.02) continue;
        const x0 = p.sx + ux * (d - half);
        const y0 = p.sy + uy * (d - half);
        const x1 = p.sx + ux * (d + half);
        const y1 = p.sy + uy * (d + half);
        const gl = ctx.createLinearGradient(x0, y0, x1, y1);
        gl.addColorStop(0, rgba(q.rgb, 0));
        gl.addColorStop(0.5, rgba(q.rgb, ga));
        gl.addColorStop(1, rgba(q.rgb, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.setLineDash([]);
        ctx.strokeStyle = gl;
        ctx.lineWidth = (style.width + 1.3) * lw;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.setLineDash([]);
    void kEff;
  }

  private drawLabels(ctx: CanvasRenderingContext2D, stage: VNode[], k: number, kEff: number, local: boolean, hov: VNode | null) {
    interface Cand { v: VNode; a: number; pri: number; text: string; font: string; size: number; weight: number; sub?: string }
    const cands: Cand[] = [];
    const kText = kEff * this.display.text;
    const hovNb = new Set<number>();
    if (hov) for (const nb of this.g.adj[hov.id]) hovNb.add(nb);
    for (const v of stage) {
      const kind = v.g.kind;
      // what has receded to a whisper outside the local graph is not named (only a hovered one is)
      if (v !== hov && v.visT <= GHOST_VIS && v.vis < 0.3) continue;
      let a = 0;
      let pri = 0;
      if (v === hov) { a = 1; pri = 100; }
      else if (v.id === this.subject) { a = 1; pri = 90; }
      else if (v.id === this.selected) { a = 1; pri = 80; }
      else if (kind === 'archetype') { a = 1; pri = 70 + (v.g.prime ? 5 : 0); }
      else if (kind === 'body') { a = 1; pri = 66; }
      else if (kind === 'theoretic') { a = 1; pri = v.g.ground ? 88 : 58 + 10 * v.g.rank; }
      else if (kind === 'family') {
        // larger forms are named sooner; the rest as you come near (Text fade brings every name sooner or later)
        const need = 1.7 - 1.15 * v.g.rank;
        a = smoothstep(need - 0.22, need + 0.12, kText);
        pri = 40 + 20 * v.g.rank;
      } else {
        a = smoothstep(local ? 1.6 : 2.5, local ? 2.1 : 3.1, kText) * (v.g.hasImage ? 1 : 0.8);
        pri = 10 + (v.g.hasImage ? 4 : 0);
      }
      if (hov && v !== hov && hovNb.has(v.id)) { a = Math.max(a, kind === 'occurrence' ? 0.8 : 1); pri = Math.max(pri, 60); }
      if (this.emph && this.emph.has(v.id)) { a = Math.max(a, 0.9 * smoothstep(1.0, 1.6, kText)); pri = Math.max(pri, 50); }
      a *= v.vis * (0.12 + 0.88 * v.hl) * (kind === 'occurrence' ? 0.25 + 0.75 * v.live : 0.5 + 0.5 * v.live);
      if (a < 0.04) continue;
      const size = this.fontSize(v, k);
      const weight = kind === 'archetype' || (kind === 'theoretic' && v.g.ground) ? 600 : kind === 'family' || kind === 'body' || kind === 'theoretic' ? 500 : 400;
      cands.push({ v, a, pri, text: v.g.label, font: `${weight} ${size.toFixed(1)}px ${SERIF}`, size, weight, sub: kind === 'occurrence' && (v === hov || v.id === this.selected) ? v.g.yearDisplay : undefined });
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
      const tw = this.measure(text, c.weight, c.size);
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
      ctx.fillStyle = rgba(c.v.g.kind === 'occurrence' ? '226 233 249' : '240 244 253', (c.v.g.kind === 'archetype' || c.v.g.ground ? 0.97 : c.v.g.kind === 'family' || c.v.g.kind === 'theoretic' ? 0.86 : 0.78) * c.a);
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
