// THE PHASE STRIP: s against time for one subject, one canvas. The order parameter (s, SPEC §16) rises and falls
// along the shared time scale; basins are soft bands in their family colours; parallels are faint companion traces;
// the cursor is a point riding the trajectory. A crossing of the midpoint with a large jump carries one V mark.
// No axes, no legends, no numbers (SPEC §14): the strip is read, not decoded.
import { hexToRgb, type RGB } from '../data/palette';
import type { Palette } from '../types/field';
import { el } from '../ui/dom';
import { vMark } from './marks';
import { basinsOf, downsample, sAt, transitions, type Basin, type Companion, type Trajectory, type TrajPoint } from './trajectory';

/** The drawn range of s: the published spectrum runs 0.12–0.88 (SPEC §16), with a margin. */
const S_LO = 0.1;
const S_HI = 0.9;
const PAD_X = 6;
const PAD_Y = 12;
/** Companion traces are thinned to this many points each: they are context, not data to read. */
const COMPANION_POINTS = 300;
/** The cursor's trail reaches back this share of the visible domain. */
const TRAIL_SPAN = 0.05;
/** Midpoint crossings closer than this (CSS px) share one V mark. */
const MARK_GAP = 22;
const BAND_HALF_S = 0.05;
const REDUCED = '(prefers-reduced-motion: reduce)';

export interface StripState {
  points: number;
  companions: number;
  basins: number;
  transitions: number;
  /** V marks on screen (crossings closer than MARK_GAP share one) */
  marks: number;
  /** points in the cursor's trail; 0 under reduced motion */
  trailPoints: number;
  cursor: { x: number; y: number } | null;
  domain: [number, number];
  reducedMotion: boolean;
}

const rgba = (c: RGB, a: number) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const rgbOf = (hex: string | undefined, fallback: RGB): RGB => (hex ? hexToRgb(hex) : fallback);

export class PhaseStrip {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private marksEl: HTMLElement;
  private traj: Trajectory | null = null;
  private palette: Palette | null = null;
  private companions: Companion[] = [];
  private basins: Basin[] = [];
  private transitionIdx: number[] = [];
  private colourOf: (familyId: string) => string | undefined = () => undefined;
  private from = 0;
  private to = 1;
  private cursorU: number | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private layerDirty = true;
  private trail = 0;
  private cursorPx: { x: number; y: number } | null = null;
  private media: MediaQueryList | null = null;
  private ro: ResizeObserver | null = null;
  private onMedia = () => this.draw();

  constructor(parent?: HTMLElement) {
    this.canvas = el('canvas', { class: 'dy-canvas', 'aria-hidden': 'true' });
    this.ctx = this.canvas.getContext('2d')!;
    this.layer = document.createElement('canvas');
    this.marksEl = el('div', { class: 'dy-marks' });
    this.root = el('figure', { class: 'dy-strip', role: 'img', 'aria-label': 'through time' }, [this.canvas, this.marksEl]);
    if (parent) parent.append(this.root);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.root);
    }
    if (typeof matchMedia !== 'undefined') {
      this.media = matchMedia(REDUCED);
      this.media.addEventListener?.('change', this.onMedia);
    }
  }

  /** The subject's name for the accessible label: "<name> through time". */
  setLabel(name: string) {
    this.root.setAttribute('aria-label', `${name} through time`);
  }

  setTrajectory(traj: Trajectory | null, palette: Palette | null, companions: Companion[] = [], colourOf?: (familyId: string) => string | undefined) {
    this.traj = traj;
    this.palette = palette;
    this.companions = companions.map((c) => ({ ...downsample(c, COMPANION_POINTS), links: c.links }));
    this.basins = traj ? basinsOf(traj) : [];
    this.transitionIdx = traj ? transitions(traj) : [];
    this.colourOf = colourOf ?? (() => undefined);
    this.layerDirty = true;
    this.layoutMarks();
    this.draw();
  }

  /** The shared scale's visible range (slider-positions); the strip maps u across it, as the time track does. */
  setDomain(fromU: number, toU: number) {
    if (!(toU > fromU)) return;
    if (fromU === this.from && toU === this.to) return;
    this.from = fromU;
    this.to = toU;
    this.layerDirty = true;
    this.layoutMarks();
    this.draw();
  }

  /** The cursor's slider-position, or null for no cursor (the strip draws its trajectory alone). */
  setCursor(u: number | null) {
    if (u === this.cursorU) return;
    this.cursorU = u;
    this.draw();
  }

  /** Re-read the box size and device pixel ratio; rebuilds the canvases when either changed. */
  resize() {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.layer.width = this.canvas.width;
    this.layer.height = this.canvas.height;
    this.layerDirty = true;
    this.layoutMarks();
    this.draw();
  }

  draw() {
    if (!this.w || !this.h) return;
    if (this.layerDirty) this.buildLayer();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawCursor();
  }

  /** What is on screen, for tests and the harness. Not a reading of the data. */
  inspect(): StripState {
    return {
      points: this.traj?.points.length ?? 0,
      companions: this.companions.length,
      basins: this.basins.length,
      transitions: this.transitionIdx.length,
      marks: this.marksEl.querySelectorAll('.dy-v').length,
      trailPoints: this.trail,
      cursor: this.cursorPx ? { ...this.cursorPx } : null,
      domain: [this.from, this.to],
      reducedMotion: !!this.media?.matches,
    };
  }

  dispose() {
    this.ro?.disconnect();
    this.media?.removeEventListener?.('change', this.onMedia);
  }

  // ── geometry ────────────────────────────────────────────────────────────────────────────────────────

  private X(u: number): number {
    const span = this.to - this.from || 1;
    return PAD_X + ((u - this.from) / span) * (this.w - 2 * PAD_X);
  }

  private Y(s: number): number {
    return this.h - PAD_Y - ((s - S_LO) / (S_HI - S_LO)) * (this.h - 2 * PAD_Y);
  }

  /** Crossings merged by pixel distance: each mark stands for the crossings it covers (n of them). */
  private layoutMarks() {
    this.marksEl.replaceChildren();
    if (!this.traj || !this.w || !this.transitionIdx.length) return;
    const p = this.traj.points;
    type Cluster = { sumU: number; n: number; x: number };
    const clusters: Cluster[] = [];
    for (const j of this.transitionIdx) {
      const u = (p[j - 1].u + p[j].u) / 2;
      const x = this.X(u);
      const last = clusters[clusters.length - 1];
      if (last && x - last.x < MARK_GAP) {
        last.sumU += u;
        last.n++;
      } else clusters.push({ sumU: u, n: 1, x });
    }
    for (const c of clusters) {
      const u = c.sumU / c.n;
      const x = this.X(u);
      if (x < 0 || x > this.w) continue;
      const mark = vMark();
      mark.style.left = `${x.toFixed(1)}px`;
      // the marks stand on the strip's top edge, so they flag the crossing without covering the line
      mark.style.top = '0px';
      mark.dataset.u = String(u);
      mark.dataset.n = String(c.n);
      this.marksEl.append(mark);
    }
  }

  // ── painting ────────────────────────────────────────────────────────────────────────────────────────

  private strokeSeries(g: CanvasRenderingContext2D, points: readonly TrajPoint[]) {
    if (!points.length) return;
    g.beginPath();
    g.moveTo(this.X(points[0].u), this.Y(points[0].s));
    for (let i = 1; i < points.length; i++) g.lineTo(this.X(points[i].u), this.Y(points[i].s));
    g.stroke();
  }

  /** Everything that does not move with the cursor: basins, companions, the trajectory. */
  private buildLayer() {
    this.layerDirty = false;
    const g = this.layer.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    if (!this.traj || !this.palette) return;
    const core = rgbOf(this.palette.core, [1, 1, 1]);
    const glow = rgbOf(this.palette.glow, core);

    // basins: soft horizontal bands at each family's mean s, spanning its years
    const half = (BAND_HALF_S / (S_HI - S_LO)) * (this.h - 2 * PAD_Y);
    for (const b of this.basins) {
      const c = rgbOf(this.colourOf(b.familyId), core);
      const x0 = this.X(b.fromU);
      const x1 = this.X(b.toU);
      const y = this.Y(b.meanS);
      const grad = g.createLinearGradient(0, y - half, 0, y + half);
      grad.addColorStop(0, rgba(c, 0));
      grad.addColorStop(0.5, rgba(c, 0.05));
      grad.addColorStop(1, rgba(c, 0));
      g.fillStyle = grad;
      g.fillRect(x0 - 3, y - half, Math.max(x1 - x0, 6) + 6, 2 * half);
    }

    // parallels: faint companion traces
    g.lineWidth = 1;
    g.lineJoin = 'round';
    for (const c of this.companions) {
      g.strokeStyle = rgba(rgbOf(this.colourOf(c.subject.id), glow), 0.2);
      this.strokeSeries(g, c.points);
    }

    // the trajectory: one luminous line (a wide soft pass under a fine bright one)
    g.save();
    g.shadowColor = rgba(core, 0.8);
    g.shadowBlur = 6;
    g.strokeStyle = rgba(core, 0.22);
    g.lineWidth = 3;
    this.strokeSeries(g, this.traj.points);
    g.restore();
    g.strokeStyle = rgba(core, 0.78);
    g.lineWidth = 1;
    this.strokeSeries(g, this.traj.points);
  }

  /** The cursor: a point on the line at the cursor's year, with a short bright trail behind it (none under reduced motion). */
  private drawCursor() {
    this.trail = 0;
    this.cursorPx = null;
    if (this.cursorU === null || !this.traj || !this.palette) return;
    const u = this.cursorU;
    const s = sAt(this.traj.points, u);
    if (s === null) return;
    const ctx = this.ctx;
    const core = rgbOf(this.palette.core, [1, 1, 1]);
    const x = this.X(u);
    const y = this.Y(s);
    const reduced = !!this.media?.matches;
    if (!reduced) {
      const pts = this.traj.points;
      const start = this.firstAtOrAfter(u - (this.to - this.from) * TRAIL_SPAN);
      const behind = pts.slice(start).filter((p) => p.u <= u);
      if (behind.length) {
        ctx.beginPath();
        ctx.moveTo(this.X(behind[0].u), this.Y(behind[0].s));
        for (const p of behind.slice(1)) ctx.lineTo(this.X(p.u), this.Y(p.s));
        ctx.lineTo(x, y);
        ctx.strokeStyle = rgba(core, 0.95);
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
        this.trail = behind.length + 1;
      }
    }
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 12);
    halo.addColorStop(0, rgba(core, 0.85));
    halo.addColorStop(1, rgba(core, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba([1, 1, 1], 1);
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    this.cursorPx = { x, y };
  }

  /** Index of the first point at or after u (binary search over the year-ordered points). */
  private firstAtOrAfter(u: number): number {
    const pts = this.traj?.points ?? [];
    let lo = 0, hi = pts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].u < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

