// The sky's quiet DOM: body labels (real buttons, so the sky is reachable by keyboard and by touch) and the
// caption that says the radial scale is diagrammatic. Nothing here owns state: the controller does. The names' culture
// and the live line are Astrology's Options (src/lenses/astrology.ts); this view only reports them (statusLine).
import { glyphSvg, holoCss, signFamilyId } from './zodiac';
import type { BodyKey } from '../types/sky';
import { el } from '../ui/dom';
import type { ScreenBody, SkyLayer } from './layer';
import type { ChartScreenMark } from './chart-overlay';
import { describeLive, type LiveState } from './live';

export interface SkyViewHooks {
  onBody(key: BodyKey): void;
  /** the label shown for a body under the standing culture */
  nameOf(key: BodyKey): string;
  /** a sign's glyph opened as its field family: the same route a tied family takes from a sky card */
  onSign(id: string): void;
  /** whether the field holds a family; a sign's glyph is a control only when its family stands */
  hasFamily(id: string): boolean;
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
  private marks = new Map<string, HTMLElement>();
  private lastLive: LiveState | null = null;
  private held: string | null = null;

  constructor(parent: HTMLElement, private hooks: SkyViewHooks) {
    this.root = el('div', { class: 'sky-layer', 'aria-label': 'The sky: Sun, Moon and planets', role: 'group' });
    this.root.inert = true;
    this.caption = el('p', { class: 'sky-caption', 'aria-hidden': 'true' });
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
    // the layer arrives after the state that asked for it: bring the labels to the standing state
    this.setActive(this.active, this.selected);
  }

  /** The sky's live state, in words: live and checked, a snapshot and why, or beyond the generated span. */
  setLive(state: LiveState) {
    this.lastLive = state;
  }

  /** While a birth sky stands, the clock is not followed: say what the sky is held at instead of "live". Null returns to the live state. */
  setHeld(detail: string | null) {
    this.held = detail;
  }

  /** One line for Astrology's Options: held birth sky, or live status. */
  statusLine(): { label: string; detail: string; state: string } | null {
    if (this.held) return { label: 'Birth sky', detail: this.held, state: 'held' };
    if (!this.lastLive || this.lastLive.kind === 'snapshot' || this.lastLive.kind === 'diverged') return null;
    const d = describeLive(this.lastLive);
    return { label: d.label, detail: d.detail, state: this.lastLive.kind };
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
    this.caption.textContent = '';
    this.caption.classList.remove('on');
    const bodies = layer.screenBodies(this.scratch);
    const placed: { x: number; y: number; w: number }[] = [];
    // sun first, then Earth, then outward: the nearer wins a crowded corner
    const order: BodyKey[] = ['sun', 'terra', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    const byKey = new Map(bodies.map((b) => [b.key, b]));
    for (const key of order) {
      const l = this.labels.get(key);
      if (!l) continue;
      const b = byKey.get(key);
      if (!b) { l.node.classList.remove('on'); continue; }
      if (!l.w) l.w = l.node.getBoundingClientRect().width || 60;
      // clear of the drawn disc: a grown body's name sits beyond its edge, not on its centre
      const x = b.x + Math.max(12, b.px / 2 + 8);
      const y = b.y - 8;
      const clash = placed.some((p) => Math.abs(p.x - x) < (p.w + l.w) / 2 + 6 && Math.abs(p.y - y) < 17);
      // the approached body's card names it: its label stands down (hidden, so out of the tab order too)
      const approached = layer.approach > 0.05 && key === this.selected;
      const on = !clash && !approached && b.alpha > 0.45;
      l.node.classList.toggle('on', on);
      l.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (on) placed.push({ x: x + l.w / 2, y, w: l.w });
    }
    this.drawMarks(layer.chartMarks);
  }

  /** The ring's sign names and the two angles of a birth chart, as quiet text; the readout beside the form is the accessible statement. */
  private drawMarks(marks: ChartScreenMark[]) {
    const seen = new Set<string>();
    for (const m of marks) {
      seen.add(m.id);
      let n = this.marks.get(m.id);
      if (!n) {
        if (m.sign !== undefined) {
          // a sign: its canonical glyph, in the band's own colour at that longitude; a real control when its family stands
          const fam = signFamilyId(m.sign);
          n = fam && this.hooks.hasFamily(fam)
            ? el('button', { class: 'sky-chart-mark sky-chart-glyph sky-chart-btn', type: 'button', 'aria-label': m.text, title: m.text, onclick: () => this.hooks.onSign(fam) }, [glyphSvg(m.sign)])
            : el('span', { class: 'sky-chart-mark sky-chart-glyph', 'aria-hidden': 'true' }, [glyphSvg(m.sign)]);
          n.style.color = holoCss(m.sign);
        } else n = el('span', { class: `sky-chart-mark sky-chart-${m.kind}`, 'aria-hidden': 'true', text: m.text });
        this.marks.set(m.id, n);
        this.root.append(n);
      }
      if (m.size !== undefined) {
        // drawn inside the band: most of its width, never so small it blurs nor so large it crowds
        const px = Math.max(12, Math.min(46, m.size * 0.78));
        n.style.width = n.style.height = `${px.toFixed(1)}px`;
        setShown(n, m.on && m.size > 9);
      } else setShown(n, m.on);
      n.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
    for (const [id, n] of this.marks) if (!seen.has(id)) { n.remove(); this.marks.delete(id); }
  }

  private hideAll() {
    this.root.classList.remove('on');
    this.caption.classList.remove('on');
    for (const l of this.labels.values()) l.node.classList.remove('on');
    for (const n of this.marks.values()) setShown(n, false);
  }
}

/** A mark's visibility; a sign control is in the tab order only while it shows (a hidden one is never a stop). */
function setShown(n: HTMLElement, on: boolean) {
  n.classList.toggle('on', on);
  if (n instanceof HTMLButtonElement) n.tabIndex = on ? 0 : -1;
}
