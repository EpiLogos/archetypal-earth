// THREAD: the image sequence strip — plays through the thread oldest to newest.
// Transport lives in the one time-control button (bottom right): never a second play/pause here.
import type { Model } from '../data/model';
import { occurrenceImage } from '../data/model';
import { clear, el, onReadGesture, plate } from './dom';
import { eraShort, placeLine } from './format';

export interface StripHandlers {
  onSelect(i: number): void;
  onOpen(i: number): void;
  /** a double-click on a step (or the caption): the step, then its reading */
  onRead(i: number): void;
}

/** A thumbnail tap holds the rail still for the platform double-click interval, so the second tap lands where the first was aimed. */
export const TAP_HOLD_MS = 500;

/**
 * Pure: how many ms the rail must still hold at `now`, after the last thumbnail tap at `tapAt` (null: no tap).
 * 0 means it may re-centre now.
 */
export function holdRemaining(tapAt: number | null, now: number, hold = TAP_HOLD_MS): number {
  if (tapAt === null) return 0;
  const elapsed = Math.max(0, now - tapAt);
  return Math.max(0, hold - elapsed);
}

export class Strip {
  readonly root: HTMLElement;
  private rail: HTMLElement;
  private frames: HTMLElement[] = [];
  private caption: HTMLElement;
  private captionName: HTMLElement;
  private captionLine: HTMLElement;
  private index = -1;
  private tapAt: number | null = null;
  private holdTimer = 0;

  constructor(parent: HTMLElement, private model: Model, private h: StripHandlers) {
    this.rail = el('div', { class: 'st-rail' });
    this.captionName = el('span', { class: 'st-name' });
    this.captionLine = el('span', { class: 'st-line' });
    this.caption = el('button', { class: 'st-caption', type: 'button', 'aria-label': 'Open this presence', onclick: () => this.index >= 0 && this.h.onOpen(this.index) }, [this.captionName, this.captionLine]);
    onReadGesture(this.caption, () => this.index >= 0 && this.h.onRead(this.index));
    const viewport = el('div', { class: 'st-viewport' }, [this.rail]);
    this.root = el('div', { class: 'strip', 'aria-label': 'The thread, oldest to newest', 'aria-hidden': 'true' }, [this.caption, el('div', { class: 'st-row' }, [viewport])]);
    this.root.inert = true;
    parent.append(this.root);
  }

  set(occIdx: number[]) {
    clear(this.rail);
    this.frames = [];
    const m = this.model;
    // a borrowed family image appears once; later frames stay tonal rather than repeat it
    const used = new Set<string>();
    occIdx.forEach((oi, i) => {
      const o = m.occ[oi];
      const fam = m.famById.get(o.familyId);
      let img = occurrenceImage(m, o);
      if (img && !o.image) img = used.has(img.src) ? undefined : (used.add(img.src), img);
      const f = el('button', { class: 'st-frame', type: 'button', 'aria-label': `${o.label}, ${eraShort(o.yearDisplay, 40)}`, onclick: (e: Event) => {
        this.tap();
        // the second tap of a double-click lands on the step the first one jumped to: no second jump
        if ((e as MouseEvent).detail < 2) this.h.onSelect(i);
      } }, [
        plate(img, { thumb: true, className: 'st-plate', palette: fam?.palette, alt: '' }),
        el('span', { class: 'st-year', text: eraShort(o.yearDisplay, 13) }),
      ]);
      onReadGesture(f, () => this.h.onRead(i));
      this.rail.append(f);
      this.frames.push(f);
    });
    this.index = -1;
  }

  show() {
    this.root.classList.add('on');
    this.root.inert = false;
    this.root.setAttribute('aria-hidden', 'false');
  }

  hide() {
    this.root.classList.remove('on');
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
  }

  setPlaying(playing: boolean) {
    this.root.classList.toggle('paused', !playing);
  }

  /** Mark step `i` current; centre it in the viewport. */
  setIndex(i: number, occIdx: number) {
    this.index = i;
    this.frames.forEach((f, k) => {
      f.classList.toggle('current', k === i);
      f.classList.toggle('past', k < i);
    });
    const o = this.model.occ[occIdx];
    this.captionName.textContent = o.label;
    this.captionLine.textContent = placeLine(this.model, o);
    this.centreWhenFree();
  }

  /** A thumbnail tap was made: the rail holds still until the double-click window has passed. */
  private tap() {
    this.tapAt = performance.now();
  }

  /** Centre the current step, unless a tap holds the rail; then centre when the hold ends (one timer, re-checked). */
  private centreWhenFree() {
    window.clearTimeout(this.holdTimer);
    this.holdTimer = 0;
    const wait = holdRemaining(this.tapAt, performance.now());
    if (wait > 0) this.holdTimer = window.setTimeout(() => this.centreWhenFree(), wait);
    else if (this.index >= 0) this.center(this.index);
  }

  private center(i: number) {
    const f = this.frames[i];
    if (!f) return;
    const vp = this.rail.parentElement!;
    const target = f.offsetLeft + f.offsetWidth / 2 - vp.clientWidth / 2;
    const max = Math.max(0, this.rail.scrollWidth - vp.clientWidth);
    this.rail.style.transform = `translate3d(${-Math.max(0, Math.min(max, target))}px,0,0)`;
  }

  recenter() {
    if (this.index >= 0) this.center(this.index);
  }
}
