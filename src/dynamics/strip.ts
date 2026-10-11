// THE PHASE STRIP: the subject's order parameter (s) against time, one canvas. What is drawn is the era series
// (trajectory.ts): count-weighted bin means of the subject's occurrences, lightly smoothed, with empty eras as gaps.
// Basins are soft bands in their family colours; a subject whose series does not vary is a single level, drawn as a
// band and no trace; companion traces are drawn only where their own series varies. A midpoint crossing that survives
// the sustained rule carries one neutral tick on the 0.5 line. The cursor is a point on the drawn line.
// No axes, no legends, no numbers (SPEC §14): the strip is read, not decoded.
import { hexToRgb, type RGB } from '../data/palette';
import type { Palette } from '../types/field';
import { el } from '../ui/dom';
import {
  basinsOf, eraSeries, ERA_BINS, MIDPOINT, seriesAt, smoothEra, sustainedCrossings, variesEnough,
  type Basin, type Companion, type Crossing, type EraBin, type Trajectory,
} from './trajectory';

/** The drawn range of s: the published spectrum runs 0.12–0.88 (SPEC §16), with a margin. */
const S_LO = 0.1;
const S_HI = 0.9;
const PAD_X = 6;
const PAD_Y = 12;
/** The cursor's trail reaches back this share of the visible domain. */
const TRAIL_SPAN = 0.05;
const BAND_HALF_S = 0.05;
const TICK_TITLE = 'crosses the midpoint · drawn here';
const REDUCED = '(prefers-reduced-motion: reduce)';

export interface StripState {
  /** eras of the subject's span that hold at least one occurrence */
  bins: number;
  /** the subject is a single level: a band is drawn, no trace */
  flat: boolean;
  /** the subject's trace is drawn (not flat) */
  trace: boolean;
  /** companion traces drawn: only those whose own era series varies */
  companions: number;
  /** midpoint crossings that survive the sustained rule */
  crossings: number;
  /** tick marks on screen: one per surviving crossing */
  ticks: number;
  /** family bands drawn (none when the subject is flat: its own band stands) */
  basins: number;
  /** points in the cursor's trail; 0 under reduced motion or when flat */
  trailPoints: number;
  cursor: { x: number; y: number } | null;
  domain: [number, number];
  reducedMotion: boolean;
}

const rgba = (c: RGB, a: number) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const rgbOf = (hex: string | undefined, fallback: RGB): RGB => (hex ? hexToRgb(hex) : fallback);

/**
 * Call `cb` when the device pixel ratio changes (a browser zoom, or a move to another screen): a ResizeObserver does not
 * see that. Returns the disposer. The query is re-armed on each change, since it names the ratio it was made for.
 */
export function onPixelRatio(cb: () => void): () => void {
  if (typeof matchMedia === 'undefined' || typeof window === 'undefined') return () => {};
  let mq: MediaQueryList | null = null;
  const onChange = () => {
    cb();
    arm();
  };
  const arm = () => {
    mq?.removeEventListener?.('change', onChange);
    mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener?.('change', onChange);
  };
  arm();
  return () => mq?.removeEventListener?.('change', onChange);
}

export class PhaseStrip {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private marksEl: HTMLElement;
  private traj: Trajectory | null = null;
  private palette: Palette | null = null;
  private colourOf: (familyId: string) => string | undefined = () => undefined;
  private basins: Basin[] = [];
  /** the subject's era series, raw and as drawn (smoothed) */
  private raw: EraBin[] = [];
  private drawn: EraBin[] = [];
  private flat = false;
  /** the single level of a flat subject */
  private flatS = 0.5;
  private crossings: Crossing[] = [];
  /** the companion series that vary, as drawn */
  private companionsDrawn: { familyId: string; drawn: EraBin[] }[] = [];
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
  private stopDpr: () => void = () => {};
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
    this.stopDpr = onPixelRatio(() => this.resize());
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
    this.colourOf = colourOf ?? (() => undefined);
    this.basins = traj ? basinsOf(traj) : [];
    this.raw = [];
    this.drawn = [];
    this.flat = false;
    this.flatS = 0.5;
    this.crossings = [];
    this.companionsDrawn = [];
    if (traj && traj.points.length) {
      const pts = traj.points;
      const span = { fromU: pts[0].u, toU: pts[pts.length - 1].u };
      this.raw = eraSeries(traj, ERA_BINS);
      this.drawn = smoothEra(this.raw);
      this.flat = !variesEnough(this.raw);
      const means = this.raw.filter((b) => b.mean !== null).map((b) => b.mean as number);
      if (means.length) this.flatS = means.reduce((x, y) => x + y, 0) / means.length;
      this.crossings = this.flat ? [] : sustainedCrossings(this.drawn);
      // a companion is drawn only where its own series varies over the subject's span (a family's parallels are one level)
      for (const c of companions) {
        const series = eraSeries(c, ERA_BINS, span);
        if (variesEnough(series)) this.companionsDrawn.push({ familyId: c.subject.id, drawn: smoothEra(series) });
      }
    }
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
      bins: this.raw.filter((b) => b.mean !== null).length,
      flat: !!this.traj && this.flat,
      trace: !!this.traj && !this.flat,
      companions: this.companionsDrawn.length,
      crossings: this.crossings.length,
      ticks: this.marksEl.querySelectorAll('.dy-tick').length,
      basins: this.flat ? 0 : this.basins.length,
      trailPoints: this.trail,
      cursor: this.cursorPx ? { ...this.cursorPx } : null,
      domain: [this.from, this.to],
      reducedMotion: !!this.media?.matches,
    };
  }

  dispose() {
    this.ro?.disconnect();
    this.stopDpr();
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

  /** One tick on the 0.5 line for each surviving crossing (none for a flat subject). */
  private layoutMarks() {
    this.marksEl.replaceChildren();
    if (!this.traj || !this.w) return;
    const y = this.Y(MIDPOINT);
    for (const c of this.crossings) {
      const x = this.X(c.u);
      if (x < 0 || x > this.w) continue;
      const tick = el('span', { class: 'dy-tick', title: TICK_TITLE });
      tick.style.left = `${x.toFixed(1)}px`;
      tick.style.top = `${y.toFixed(1)}px`;
      tick.dataset.u = String(c.u);
      this.marksEl.append(tick);
    }
  }

  // ── painting ────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A soft horizontal band at s over [fromU, toU]: the basins' and a flat subject's form. Quiet by design: a level, not a
   * line.
   */
  private band(g: CanvasRenderingContext2D, c: RGB, s: number, fromU: number, toU: number, alpha: number) {
    const half = (BAND_HALF_S / (S_HI - S_LO)) * (this.h - 2 * PAD_Y);
    const x0 = this.X(fromU);
    const x1 = this.X(toU);
    const y = this.Y(s);
    const grad = g.createLinearGradient(0, y - half, 0, y + half);
    grad.addColorStop(0, rgba(c, 0));
    grad.addColorStop(0.5, rgba(c, alpha));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad;
    g.fillRect(x0 - 3, y - half, Math.max(x1 - x0, 6) + 6, 2 * half);
  }

  /**
   * An era series as a polyline through the centres of adjacent non-empty eras. An empty era breaks the line: nothing is
   * interpolated across a gap. A lone era is a short level across its own width.
   */
  private strokeEra(g: CanvasRenderingContext2D, bins: readonly EraBin[]) {
    let k = 0;
    while (k < bins.length) {
      const first = bins[k];
      if (first.mean === null) { k++; continue; }
      let j = k;
      while (j + 1 < bins.length && bins[j + 1].mean !== null) j++;
      g.beginPath();
      if (j === k) {
        g.moveTo(this.X(first.u0), this.Y(first.mean));
        g.lineTo(this.X(first.u1), this.Y(first.mean));
      } else {
        for (let q = k; q <= j; q++) {
          const b = bins[q];
          const x = this.X((b.u0 + b.u1) / 2);
          const y = this.Y(b.mean as number);
          if (q === k) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      }
      g.stroke();
      k = j + 1;
    }
  }

  /** Everything that does not move with the cursor: bands, companions, the trace, the midline. */
  private buildLayer() {
    this.layerDirty = false;
    const g = this.layer.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    if (!this.traj || !this.palette || !this.traj.points.length) return;
    const pts = this.traj.points;
    const core = rgbOf(this.palette.core, [1, 1, 1]);
    const glow = rgbOf(this.palette.glow, core);
    const spanFrom = pts[0].u;
    const spanTo = pts[pts.length - 1].u;

    if (this.flat) {
      // a single level: a quiet band at the subject's own s, and no trace
      this.band(g, core, this.flatS, spanFrom, spanTo, 0.12);
    } else {
      // basins: soft bands at each family's mean s, spanning its years
      for (const b of this.basins) this.band(g, rgbOf(this.colourOf(b.familyId), core), b.meanS, b.fromU, b.toU, 0.05);
      // the midline, only where a crossing stands on it
      if (this.crossings.length) {
        g.strokeStyle = rgba(core, 0.14);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(PAD_X, this.Y(MIDPOINT));
        g.lineTo(this.w - PAD_X, this.Y(MIDPOINT));
        g.stroke();
      }
    }

    // companion traces: only those whose own series varies
    g.lineWidth = 1;
    g.lineJoin = 'round';
    for (const c of this.companionsDrawn) {
      g.strokeStyle = rgba(rgbOf(this.colourOf(c.familyId), glow), 0.2);
      this.strokeEra(g, c.drawn);
    }

    // the trace: one luminous line (a wide soft pass under a fine bright one)
    if (!this.flat) {
      g.save();
      g.shadowColor = rgba(core, 0.8);
      g.shadowBlur = 6;
      g.strokeStyle = rgba(core, 0.22);
      g.lineWidth = 3;
      this.strokeEra(g, this.drawn);
      g.restore();
      g.strokeStyle = rgba(core, 0.78);
      g.lineWidth = 1;
      this.strokeEra(g, this.drawn);
    }
  }

  /** The cursor: a point on the drawn line at the cursor's year, with a short trail behind it (none under reduced motion). */
  private drawCursor() {
    this.trail = 0;
    this.cursorPx = null;
    if (this.cursorU === null || !this.traj || !this.palette) return;
    const u = this.cursorU;
    // a single level is the same across its whole span, so an empty era inside it hides nothing; a trace has no value in a gap
    const s = this.flat ? (u < this.traj.points[0].u ? null : this.flatS) : seriesAt(this.drawn, u);
    if (s === null) return;
    const ctx = this.ctx;
    const core = rgbOf(this.palette.core, [1, 1, 1]);
    const x = this.X(u);
    const y = this.Y(s);
    const reduced = !!this.media?.matches;
    if (!reduced && !this.flat) {
      // the trail is the drawn series over the last stretch, broken at any empty era
      const from = u - (this.to - this.from) * TRAIL_SPAN;
      let behind: { x: number; y: number }[] = [];
      for (const b of this.drawn) {
        if (b.mean === null) { behind = []; continue; }
        const c = (b.u0 + b.u1) / 2;
        if (c >= from && c <= u) behind.push({ x: this.X(c), y: this.Y(b.mean) });
      }
      if (behind.length) {
        ctx.beginPath();
        ctx.moveTo(behind[0].x, behind[0].y);
        for (const p of behind.slice(1)) ctx.lineTo(p.x, p.y);
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
}
