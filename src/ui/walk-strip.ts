// THE WALK STRIP: "follow the thread" for a walk through plates (the Red Book's folios, Aion's chapters and events).
// A row of small plate thumbnails inside the walk's rail: the current one raised and centred, a tap on one jumps there.
import type { ImageRef, Palette } from '../types/field';
import { clear, el, plate } from './dom';

export interface WalkItem { id: string; image?: ImageRef; label: string; sub?: string; palette?: Palette }
export interface WalkLabels { prev: string; next: string; list: string }

/**
 * Pure: the scrollLeft that centres a frame in its viewport, clamped to the scrollable range.
 * `frameLeft` is the frame's offset within the scrolling track.
 */
export function scrollTarget(frameLeft: number, frameWidth: number, viewportWidth: number, scrollWidth: number): number {
  const max = Math.max(0, scrollWidth - viewportWidth);
  const target = frameLeft + frameWidth / 2 - viewportWidth / 2;
  return Math.max(0, Math.min(max, target));
}

export class WalkStrip {
  private progress: HTMLElement;
  private section: HTMLElement;
  private viewport: HTMLElement;
  private track: HTMLElement;
  private frames: HTMLButtonElement[] = [];
  private ids = '';
  private index = -1;

  constructor(host: HTMLElement, labels: WalkLabels, private onSelect: (i: number) => void, private onStep: (delta: number) => void) {
    host.classList.add('ws-host');
    this.progress = el('span', { class: 'rb-progress' });
    this.section = el('span', { class: 'rb-section', hidden: true });
    this.track = el('div', { class: 'ws-track', role: 'group', 'aria-label': labels.list });
    this.viewport = el('div', { class: 'ws-viewport' }, [this.track]);
    const prev = el('button', { type: 'button', class: 'rb-step', text: '‹', 'aria-label': labels.prev, onclick: () => this.onStep(-1) });
    const next = el('button', { type: 'button', class: 'rb-step', text: '›', 'aria-label': labels.next, onclick: () => this.onStep(1) });
    host.append(
      el('div', { class: 'ws-head' }, [this.progress, this.section]),
      el('div', { class: 'ws-row' }, [prev, this.viewport, next]),
    );
    // a resize re-centres the current frame; the listener retires once the strip has left the page
    const onResize = () => {
      if (this.viewport.isConnected) this.recenter();
      else window.removeEventListener('resize', onResize);
    };
    window.addEventListener('resize', onResize);
  }

  /** Show `items` with `index` current. The frames are rebuilt only when the ids change; a step moves the classes and scrolls. */
  update(items: WalkItem[], index: number, note = '') {
    this.progress.textContent = `${index + 1} / ${items.length}`;
    this.section.textContent = note;
    this.section.hidden = !note;
    const ids = items.map((x) => x.id).join('|');
    const rebuilt = ids !== this.ids;
    if (rebuilt) {
      this.ids = ids;
      clear(this.track);
      this.frames = items.map((item, i) => this.frame(item, i));
      this.track.append(...this.frames);
    }
    this.index = index;
    this.frames.forEach((f, i) => {
      const on = i === index;
      f.classList.toggle('current', on);
      f.classList.toggle('past', i < index);
      f.tabIndex = on ? 0 : -1;
      if (on) f.setAttribute('aria-current', 'step');
      else f.removeAttribute('aria-current');
    });
    this.centre(rebuilt);
  }

  /** Centre the current frame at once (after the host has been shown, or after a resize). */
  recenter() {
    this.centre(true);
  }

  private frame(item: WalkItem, i: number): HTMLButtonElement {
    const label = item.sub ? `${item.label}, ${item.sub}` : item.label;
    return el('button', { type: 'button', class: 'ws-frame', title: item.label, 'aria-label': label, onclick: () => this.onSelect(i) }, [
      plate(item.image, { thumb: true, className: 'ws-plate', palette: item.palette, alt: '' }),
      item.sub ? el('span', { class: 'ws-sub', text: item.sub }) : null,
    ]);
  }

  private centre(instant: boolean) {
    const f = this.frames[this.index];
    if (!f) return;
    const vp = this.viewport;
    const left = scrollTarget(f.offsetLeft, f.offsetWidth, vp.clientWidth, vp.scrollWidth);
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    vp.scrollTo({ left, behavior: instant || reduced ? 'auto' : 'smooth' });
  }
}
