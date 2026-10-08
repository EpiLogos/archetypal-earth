// The discreet time control: a hairline scrubber over the whole span, with a
// non-linear scale, soft era names, and an "all time" resting state.
import type { Model } from '../data/model';
import { formatYear } from '../data/time';
import type { TimeModel } from '../state/timeModel';
import { el } from './dom';

const PLAY_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M3 1.8v8.4L10.2 6z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor"/></svg>';

export class TimeControl {
  readonly root: HTMLElement;
  private track: HTMLElement;
  private handle: HTMLElement;
  private band: HTMLElement;
  private readout: HTMLButtonElement;
  private play: HTMLButtonElement;
  private canvas: HTMLCanvasElement;
  private eras: HTMLElement;
  private fromU = 0;
  private toU = 1;
  private subjectIndices: number[] | null = null;
  private dens: Float32Array;
  private subjectDens: Float32Array | null = null;
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
    const sc = model.scale;
    this.renderEras();
    this.track = el('div', {
      class: 't-track', role: 'slider', tabindex: 0, 'aria-label': 'Time',
      'aria-valuemin': Math.round(sc.yearMin), 'aria-valuemax': Math.round(sc.yearMax), 'aria-valuetext': 'All time',
    }, [this.canvas, el('div', { class: 't-line' }), this.band, this.handle, this.eras]);
    this.readout = el('button', { class: 't-readout', type: 'button', 'aria-label': 'Show all time', title: 'All time', onclick: () => this.time.setAll() }) as HTMLButtonElement;
    this.play = el('button', { class: 't-play', type: 'button', 'aria-label': 'Play history', title: 'Play history', onclick: () => this.togglePlay() }) as HTMLButtonElement;
    this.play.innerHTML = PLAY_ICON;
    this.root = el('div', { class: 'time' }, [this.readout, this.track, this.play]);
    parent.append(this.root);

    this.track.addEventListener('pointerdown', this.onDown);
    this.track.addEventListener('pointermove', this.onMove);
    this.track.addEventListener('pointerup', this.onUp);
    this.track.addEventListener('pointercancel', this.onUp);
    this.track.addEventListener('keydown', this.onKey);
    time.subscribe(() => this.schedule());
    new ResizeObserver(() => this.drawDensity()).observe(this.track);
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
    this.subjectColour = colour;
    this.drawDensity();
  }

  /** Remap this control and playback to a view's span, expressed in the shared scale. */
  setRange(fromU = this.model.scale.toU(this.model.field.meta.yearMin), toU = this.model.scale.toU(this.model.field.meta.yearMax)) {
    this.time.setRange(fromU, toU);
    this.fromU = this.time.fromU;
    this.toU = this.time.toU;
    this.dens = this.density(null);
    this.subjectDens = this.subjectIndices ? this.density(this.subjectIndices) : null;
    this.renderEras();
    this.drawDensity();
    this.render();
  }

  private position(u: number) { return Math.max(0, Math.min(1, (u - this.fromU) / (this.toU - this.fromU))); }

  private renderEras() {
    this.eras.replaceChildren();
    for (const e of this.model.scale.eras) {
      const a = Math.max(this.fromU, this.model.scale.toU(e.from));
      const b = Math.min(this.toU, this.model.scale.toU(e.to));
      if (b <= a) continue;
      this.eras.append(el('span', { class: 't-era', style: `left:${this.position((a + b) / 2) * 100}%`, text: e.name }));
      if (a > this.fromU) this.eras.append(el('span', { class: 't-tick', style: `left:${this.position(a) * 100}%` }));
    }
  }

  private density(subset: number[] | null): Float32Array {
    const out = new Float32Array(this.bins);
    const m = this.model;
    const add = (i: number) => {
      if (!m.located[i]) return;
      if (m.u[i] < this.fromU || m.u[i] > this.toU) return;
      const b = Math.min(this.bins - 1, Math.floor(this.position(m.u[i]) * this.bins));
      for (let k = -2; k <= 2; k++) {
        const j = b + k;
        if (j >= 0 && j < this.bins) out[j] += Math.exp(-(k * k) / 2.2);
      }
    };
    if (subset) subset.forEach(add);
    else for (let i = 0; i < m.occ.length; i++) add(i);
    return out;
  }

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
    draw(this.dens, '#ffffff', this.subjectDens ? 0.1 : 0.2, 0.7);
    if (this.subjectDens) draw(this.subjectDens, this.subjectColour, 0.75, 1);
    ctx.globalAlpha = 1;
  }

  private uFromEvent(e: PointerEvent): number {
    const r = this.track.getBoundingClientRect();
    return this.fromU + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (this.toU - this.fromU);
  }

  private onDown = (e: PointerEvent) => {
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
    this.track.setAttribute('aria-valuetext', on ? formatYear(year) : 'All time');
    this.track.setAttribute('aria-valuemin', String(Math.round(sc.fromU(this.fromU))));
    this.track.setAttribute('aria-valuemax', String(Math.round(sc.fromU(this.toU))));
    this.track.setAttribute('aria-valuenow', String(Math.round(year)));
    const playing = this.tour ? this.tour.playing : t.playing;
    const icon = playing ? PAUSE_ICON : PLAY_ICON;
    if (this.play.dataset.icon !== String(playing)) {
      this.play.dataset.icon = String(playing);
      this.play.innerHTML = icon;
      this.play.setAttribute('aria-label', this.tour ? (playing ? 'Pause tour' : 'Resume tour') : playing ? 'Pause' : 'Play history');
      this.play.title = this.tour ? (playing ? 'Pause the walk' : 'Resume the walk') : 'Play history';
    }
  }
}
