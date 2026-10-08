// The sky's quiet DOM: body labels (real buttons, so the sky is reachable by keyboard and by touch) and the
// caption that says the radial scale is diagrammatic. Nothing here owns state: the controller does.
import type { BodyKey } from '../types/sky';
import { el } from '../ui/dom';
import type { ScreenBody, SkyLayer } from './layer';
import { COMPRESSION_CAPTION } from './stages';

export interface SkyViewHooks {
  onBody(key: BodyKey): void;
  /** the label shown for a body under the standing culture */
  nameOf(key: BodyKey): string;
}

interface LabelEntry {
  key: BodyKey;
  node: HTMLButtonElement;
  w: number;
}

export class SkyView {
  readonly root: HTMLElement;
  readonly caption: HTMLElement;
  private labels = new Map<BodyKey, LabelEntry>();
  private layer: SkyLayer | null = null;
  private active = false;
  private selected: BodyKey | null = null;
  private scratch: ScreenBody[] = [];

  constructor(parent: HTMLElement, private hooks: SkyViewHooks) {
    this.root = el('div', { class: 'sky-layer', 'aria-label': 'The sky: Sun, Moon and planets', role: 'group' });
    this.root.inert = true;
    this.caption = el('p', { class: 'sky-caption', text: COMPRESSION_CAPTION, 'aria-hidden': 'true' });
    parent.append(this.root, this.caption);
  }

  setLayer(layer: SkyLayer) {
    this.layer = layer;
    for (const body of layer.data.bodies) {
      const node = el('button', {
        class: 'sky-label', type: 'button', 'data-body': body.key, tabindex: -1,
        onclick: () => this.hooks.onBody(body.key),
      }) as HTMLButtonElement;
      node.textContent = this.hooks.nameOf(body.key);
      node.style.setProperty('--sl', body.palette.core);
      this.root.append(node);
      this.labels.set(body.key, { key: body.key, node, w: 0 });
    }
  }

  /** Re-label after the standing culture changed. */
  relabel() {
    for (const l of this.labels.values()) {
      l.node.textContent = this.hooks.nameOf(l.key);
      l.w = 0;
    }
  }

  setActive(on: boolean, body?: BodyKey | null) {
    this.active = on;
    this.selected = body ?? null;
    this.root.inert = !on;
    document.body.classList.toggle('sky-on', on);
    for (const l of this.labels.values()) {
      l.node.tabIndex = on ? 0 : -1;
      l.node.setAttribute('aria-pressed', String(on && l.key === this.selected));
    }
  }

  /** Per frame: place the labels over the bodies they name. */
  tick() {
    const layer = this.layer;
    if (!layer) return;
    const show = this.active && layer.group.visible;
    if (!show) {
      if (this.root.classList.contains('on')) this.hideAll();
      return;
    }
    this.root.classList.add('on');
    this.caption.classList.toggle('on', layer.weights.rings > 0.55);
    const bodies = layer.screenBodies(this.scratch);
    const placed: { x: number; y: number; w: number }[] = [];
    // sun first, then Earth, then outward: the nearer wins a crowded corner
    const order: BodyKey[] = ['sun', 'earth', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    const byKey = new Map(bodies.map((b) => [b.key, b]));
    for (const key of order) {
      const l = this.labels.get(key);
      if (!l) continue;
      const b = byKey.get(key);
      if (!b) { l.node.classList.remove('on'); continue; }
      if (!l.w) l.w = l.node.getBoundingClientRect().width || 60;
      const x = b.x + 12;
      const y = b.y - 8;
      const clash = placed.some((p) => Math.abs(p.x - x) < (p.w + l.w) / 2 + 6 && Math.abs(p.y - y) < 17);
      const on = !clash && b.alpha > 0.45;
      l.node.classList.toggle('on', on);
      l.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (on) placed.push({ x: x + l.w / 2, y, w: l.w });
    }
  }

  private hideAll() {
    this.root.classList.remove('on');
    this.caption.classList.remove('on');
    for (const l of this.labels.values()) l.node.classList.remove('on');
  }
}
