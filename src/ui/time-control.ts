// The discreet time control: a hairline scrubber over the whole span, with a
// non-linear scale, soft era names, and an "all time" resting state.
import type { Model } from '../data/model';
import { formatYear } from '../data/time';
import type { TimeModel } from '../state/timeModel';
import { el } from './dom';
import { binCounts, citeCounts, citeSpan, smooth } from './density';

const PLAY_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M3 1.8v8.4L10.2 6z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor"/></svg>';
/** The clear space (px) an era name keeps from the one drawn before it on the track. */
const ERA_GAP = 6;

/** A mark a lens puts on the strip: a band over a span of years (an epoch) or a tick at a year (an event, a folio). `out` dims a tick the filter leaves out. */
export interface StripMark { kind: 'band' | 'tick'; id: string; label: string; from: number; to: number; out?: boolean }

interface EraSpan { el: HTMLElement; name: string; a: number; b: number; skipped: boolean }

export class TimeControl {
  readonly root: HTMLElement;
  private track: HTMLElement;
  private handle: HTMLElement;
  private band: HTMLElement;
  private readout: HTMLButtonElement;
  private play: HTMLButtonElement;
  private canvas: HTMLCanvasElement;
  private eras: HTMLElement;
  private marksEl: HTMLElement;
  private marks: StripMark[] = [];
  /** Jung's second axis (the years of his cites), when the strip is showing it instead of the dated one */
  private axis = false;
  private axisBtn: HTMLButtonElement;
  private citeRange: [number, number] | null;
  private citeDens: Float32Array | null = null;
  private citeSubjectDens: Float32Array | null = null;
  private eraSpans: EraSpan[] = [];
  private fromU = 0;
  private toU = 1;
  private subjectIndices: number[] | null = null;
  private dens: Float32Array;
  private subjectDens: Float32Array | null = null;
  /** 1 where the active lens's slice holds an occurrence and the filter passes it; null counts all (see src/shell/slice.ts) */
  private slice: Uint8Array | null = null;
  private subjectColour = '#ffffff';
  private scheduled = false;
  private dragging = false;
  private bins = 160;
  /** While a thread's walk stands, the one transport button serves it; the clock's own play yields. */
  private tour: { playing: boolean; onToggle: () => void } | null = null;

  constructor(parent: HTMLElement, private model: Model, private time: TimeModel, private onUserScrub: () => void) {
    this.fromU = model.scale.toU(model.field.meta.yearMin);
    this.toU = model.scale.toU(model.field.meta.yearMax);
    time.setRange(this.fromU, this.toU);
    this.dens = this.density(null);
    this.canvas = el('canvas', { class: 't-dens', 'aria-hidden': 'true' });
    this.handle = el('div', { class: 't-handle' });
    this.band = el('div', { class: 't-band' });
    this.eras = el('div', { class: 't-eras', 'aria-hidden': 'true' });
    this.marksEl = el('div', { class: 't-marks', 'aria-hidden': 'true' });
    this.citeRange = citeSpan(model.occ);
    const sc = model.scale;
    this.track = el('div', {
      class: 't-track', role: 'slider', tabindex: 0, 'aria-label': 'Time',
      'aria-valuemin': Math.round(sc.yearMin), 'aria-valuemax': Math.round(sc.yearMax), 'aria-valuetext': 'All time',
    }, [this.canvas, el('div', { class: 't-line' }), this.marksEl, this.band, this.handle, this.eras]);
    this.renderEras();
    this.readout = el('button', { class: 't-readout', type: 'button', 'aria-label': 'Show all time', title: 'All time', onclick: () => this.time.setAll() }) as HTMLButtonElement;
    this.play = el('button', { class: 't-play', type: 'button', 'aria-label': 'Play history', title: 'Play history', onclick: () => this.togglePlay() }) as HTMLButtonElement;
    this.play.innerHTML = PLAY_ICON;
    this.axisBtn = el('button', {
      class: 't-axis', type: 'button', 'aria-pressed': 'false', text: 'Cite years', hidden: !this.citeRange,
      title: 'Show the years the material was cited from instead of the years it is dated',
      onclick: () => this.setAxis(!this.axis),
    }) as HTMLButtonElement;
    this.root = el('div', { class: 'time' }, [this.readout, this.track, this.play, this.axisBtn]);
    parent.append(this.root);

    this.track.addEventListener('pointerdown', this.onDown);
    this.track.addEventListener('pointermove', this.onMove);
    this.track.addEventListener('pointerup', this.onUp);
    this.track.addEventListener('pointercancel', this.onUp);
    this.track.addEventListener('keydown', this.onKey);
    this.track.addEventListener('pointermove', this.onAxisHover);
    time.subscribe(() => this.schedule());
    new ResizeObserver(() => { this.drawDensity(); this.layoutEras(); }).observe(this.track);
    // the names are measured, so lay them out again once the label face has loaded
    document.fonts.ready.then(() => this.layoutEras());
    this.render();
  }

  /** Hand the transport button to a standing thread walk (null gives it back to the clock). */
  setTour(playing: boolean | null, onToggle?: () => void) {
    this.tour = playing === null ? null : { playing, onToggle: onToggle ?? this.tour?.onToggle ?? (() => {}) };
    this.render();
  }

  private togglePlay() {
    if (this.tour) {
      this.tour.onToggle();
      return;
    }
    this.onUserScrub();
    if (this.time.playing) this.time.pause();
    else this.time.play();
  }

  /** Brighten the time-density of the focused subject along the track. */
  setSubject(occ: number[] | null, colour: string) {
    this.subjectIndices = occ;
    this.subjectDens = occ ? this.density(occ) : null;
    this.citeSubjectDens = null;
    this.subjectColour = colour;
    this.drawDensity();
  }

  /** What the density counts: the lens's slice through the filter (null: all). The background and the subject's overlay both follow it. */
  setSlice(mask: Uint8Array | null) {
    this.slice = mask;
    this.dens = this.density(null);
    this.subjectDens = this.subjectIndices ? this.density(this.subjectIndices) : null;
    this.citeDens = null;
    this.citeSubjectDens = null;
    this.drawDensity();
  }

  /** What the lens puts on the strip: its epochs as bands, its events and folios as ticks. Empty clears them. */
  setMarks(marks: StripMark[]) {
    this.marks = marks;
    this.renderMarks();
  }

  /** Jung's second axis: the strip shows the years of his cites, a reading apart from the clock, which it leaves alone. */
  setAxis(on: boolean) {
    if (on === this.axis || (on && !this.citeRange)) return;
    this.axis = on;
    this.root.classList.toggle('is-axis', on);
    this.axisBtn.setAttribute('aria-pressed', String(on));
    this.track.style.cursor = on ? 'default' : '';
    this.track.title = '';
    this.renderEras();
    this.renderMarks();
    this.drawDensity();
  }

  get axisOn(): boolean { return this.axis; }

  private renderMarks() {
    this.marksEl.replaceChildren();
    // marks stand on the dated axis; on Jung's axis the years are another thing, so none is drawn
    if (this.axis) return;
    const sc = this.model.scale;
    for (const k of this.marks) {
      const a = this.position(sc.toU(k.from));
      const b = this.position(sc.toU(k.to));
      const node = el('span', { class: `t-mark${k.out ? ' out' : ''}`, 'data-kind': k.kind, 'data-id': k.id });
      node.style.left = `${a * 100}%`;
      if (k.kind === 'band') node.style.width = `${Math.max(0.2, (b - a) * 100)}%`;
      this.marksEl.append(node);
    }
  }

  /** The presences the track counts at the moment, and how many of the range's bins hold one (for tests and diagnostics). */
  get counted(): number {
    return binCounts({ u: this.model.u, located: this.model.located, subset: null, slice: this.slice, fromU: this.fromU, toU: this.toU, bins: this.bins }).n;
  }

  /** Remap this control and playback to a view's span, expressed in the shared scale. */
  setRange(fromU = this.model.scale.toU(this.model.field.meta.yearMin), toU = this.model.scale.toU(this.model.field.meta.yearMax)) {
    this.time.setRange(fromU, toU);
    this.fromU = this.time.fromU;
    this.toU = this.time.toU;
    this.dens = this.density(null);
    this.subjectDens = this.subjectIndices ? this.density(this.subjectIndices) : null;
    this.renderEras();
    this.renderMarks();
    this.drawDensity();
    this.render();
  }

  private position(u: number) { return Math.max(0, Math.min(1, (u - this.fromU) / (this.toU - this.fromU))); }

  private renderEras() {
    this.eras.replaceChildren();
    this.eraSpans = [];
    if (this.axis && this.citeRange) {
      // Jung's axis: its decades, in place of the eras of the dated one
      const [lo, hi] = this.citeRange;
      for (let y = Math.ceil(lo / 10) * 10; y <= hi; y += 10) {
        const at = ((y - lo) / Math.max(1, hi - lo)) * 100;
        this.eras.append(el('span', { class: 't-era', style: `left:${at}%`, text: `${y}` }), el('span', { class: 't-tick', style: `left:${at}%` }));
      }
      return;
    }
    for (const e of this.model.scale.eras) {
      const a = Math.max(this.fromU, this.model.scale.toU(e.from));
      const b = Math.min(this.toU, this.model.scale.toU(e.to));
      if (b <= a) continue;
      const name = el('span', { class: 't-era', style: `left:${this.position((a + b) / 2) * 100}%`, text: e.name });
      this.eras.append(name);
      this.eraSpans.push({ el: name, name: e.name, a, b, skipped: false });
      if (a > this.fromU) this.eras.append(el('span', { class: 't-tick', style: `left:${this.position(a) * 100}%` }));
    }
    this.layoutEras();
  }

  /**
   * Draw an era name only if its box clears the last drawn name by ERA_GAP px: the first always stands, a later one
   * that would crowd it yields. A name the CSS hides (a narrow track) counts as skipped, so the cursor still speaks it.
   * Runs again on every resize, and does nothing until the track has a width.
   */
  private layoutEras() {
    const w = this.track.clientWidth;
    if (!w) return;
    // measure every name, drawn or not: a name skipped last time has no width while it is hidden
    for (const s of this.eraSpans) s.el.classList.remove('is-skip');
    let right: number | null = null;
    for (const s of this.eraSpans) {
      const width = s.el.offsetWidth;
      const left = this.position((s.a + s.b) / 2) * w - width / 2;
      s.skipped = width === 0 || (right !== null && left < right + ERA_GAP);
      s.el.classList.toggle('is-skip', s.skipped);
      if (!s.skipped) right = left + width;
    }
    this.schedule();
  }

  /** The cursor's year, with its era's name when that era's label is not drawn, so the name is still spoken. */
  private spokenYear(u: number, year: number): string {
    const era = this.eraSpans.find((s) => u >= s.a && u <= s.b);
    return era?.skipped ? `${formatYear(year)}, ${era.name}` : formatYear(year);
  }

  private density(subset: number[] | null): Float32Array {
    const m = this.model;
    return smooth(binCounts({ u: m.u, located: m.located, subset, slice: this.slice, fromU: this.fromU, toU: this.toU, bins: this.bins }).counts);
  }

  /** Jung's cite years, over his own linear axis; cached until the slice or the subject changes. */
  private citeDensity(subset: number[] | null): Float32Array {
    const cached = subset ? this.citeSubjectDens : this.citeDens;
    if (cached) return cached;
    const [fromYear, toYear] = this.citeRange ?? [0, 1];
    const d = smooth(citeCounts({ occ: this.model.occ, located: this.model.located, subset, slice: this.slice, fromYear, toYear, bins: this.bins }).counts);
    if (subset) this.citeSubjectDens = d; else this.citeDens = d;
    return d;
  }

  /** The placed cite-years the second axis counts at the moment (for tests and diagnostics). */
  get citeCounted(): number {
    const [fromYear, toYear] = this.citeRange ?? [0, 1];
    return citeCounts({ occ: this.model.occ, located: this.model.located, subset: null, slice: this.slice, fromYear, toYear, bins: this.bins }).n;
  }

  private onAxisHover = (e: PointerEvent) => {
    if (!this.axis || !this.citeRange) return;
    const r = this.track.getBoundingClientRect();
    const [lo, hi] = this.citeRange;
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const year = Math.round(lo + frac * (hi - lo));
    this.track.title = String(year);
  };

  private drawDensity() {
    const w = this.track.clientWidth;
    if (!w) return;
    const h = 14;
    const pr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * pr);
    this.canvas.height = Math.round(h * pr);
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const draw = (d: Float32Array, colour: string, alpha: number, scale: number) => {
      let mx = 0;
      for (const v of d) mx = Math.max(mx, v);
      if (!mx) return;
      ctx.fillStyle = colour;
      for (let i = 0; i < d.length; i++) {
        const v = Math.sqrt(d[i] / mx);
        if (v < 0.04) continue;
        const bh = Math.max(1, v * h * scale);
        ctx.globalAlpha = alpha * (0.35 + 0.65 * v);
        ctx.fillRect((i / d.length) * w, h - bh, Math.max(1, w / d.length - 0.5), bh);
      }
    };
    const base = this.axis ? this.citeDensity(null) : this.dens;
    const over = this.axis ? (this.subjectIndices ? this.citeDensity(this.subjectIndices) : null) : this.subjectDens;
    draw(base, '#ffffff', over ? 0.1 : 0.2, 0.7);
    if (over) draw(over, this.subjectColour, 0.75, 1);
    ctx.globalAlpha = 1;
  }

  private uFromEvent(e: PointerEvent): number {
    const r = this.track.getBoundingClientRect();
    return this.fromU + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (this.toU - this.fromU);
  }

  private onDown = (e: PointerEvent) => {
    if (this.axis) return;
    this.track.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.track.classList.add('dragging');
    this.onUserScrub();
    this.time.pause();
    this.time.scrub(this.uFromEvent(e));
  };
  private onMove = (e: PointerEvent) => {
    if (this.dragging) this.time.scrub(this.uFromEvent(e));
  };
  private onUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    this.track.classList.remove('dragging');
    try { this.track.releasePointerCapture(e.pointerId); } catch { /* released */ }
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.axis) return;
    const step = (e.shiftKey ? 0.06 : 0.015) * (this.toU - this.fromU);
    const t = this.time;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { this.onUserScrub(); t.pause(); t.scrub((t.mode === 'all' ? this.toU : t.cursorU) - step); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { this.onUserScrub(); t.pause(); t.scrub((t.mode === 'all' ? this.fromU : t.cursorU) + step); }
    else if (e.key === 'Home') { this.onUserScrub(); t.pause(); t.scrub(this.fromU); }
    else if (e.key === 'End' || e.key === 'Escape') { if (e.key === 'End') t.setAll(); else return; }
    else if (e.key === ' ' || e.key === 'Enter') { this.togglePlay(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.render();
    });
  }

  private render() {
    const t = this.time;
    const sc = this.model.scale;
    const on = t.mode === 'cursor';
    this.root.classList.toggle('is-cursor', on);
    this.root.classList.toggle('is-playing', t.playing);
    const u = t.cursorU;
    this.handle.style.left = `${this.position(u) * 100}%`;
    this.handle.style.opacity = String(Math.min(1, t.on * 1.4));
    const end = Math.min(u, this.toU);
    const start = Math.max(this.fromU, end - t.trail);
    this.band.style.left = `${this.position(start) * 100}%`;
    this.band.style.width = `${Math.max(0, this.position(end) - this.position(start)) * 100}%`;
    this.band.style.opacity = String(t.on * 0.9);
    const year = sc.fromU(u);
    const label = on ? formatYear(year) : 'All time';
    if (this.readout.textContent !== label) this.readout.textContent = label;
    this.track.setAttribute('aria-valuetext', on ? this.spokenYear(u, year) : 'All time');
    this.track.setAttribute('aria-valuemin', String(Math.round(sc.fromU(this.fromU))));
    this.track.setAttribute('aria-valuemax', String(Math.round(sc.fromU(this.toU))));
    this.track.setAttribute('aria-valuenow', String(Math.round(year)));
    const playing = this.tour ? this.tour.playing : t.playing;
    const icon = playing ? PAUSE_ICON : PLAY_ICON;
    // the label depends on whether a walk stands as well as on playing: refresh when either changes
    const mode = `${!!this.tour}:${playing}`;
    if (this.play.dataset.mode !== mode) {
      this.play.dataset.mode = mode;
      this.play.innerHTML = icon;
      this.play.setAttribute('aria-label', this.tour ? (playing ? 'Pause tour' : 'Resume tour') : playing ? 'Pause' : 'Play history');
      this.play.title = this.tour ? (playing ? 'Pause the walk' : 'Resume the walk') : 'Play history';
    }
  }
}
