// The sky's quiet DOM: body labels (real buttons, so the sky is reachable by keyboard and by touch) and the
// caption that says the radial scale is diagrammatic. Nothing here owns state: the controller does.
import type { BodyKey } from '../types/sky';
import { clear, el } from '../ui/dom';
import type { ScreenBody, SkyLayer } from './layer';
import type { ChartScreenMark } from './chart-overlay';
import { describeLive, type LiveState } from './live';
import { COMPRESSION_CAPTION, GEOCENTRIC_CAPTION } from './stages';

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
  private culture: HTMLElement;
  private cultureSelect: HTMLSelectElement;
  private cultureNote: HTMLElement;
  private liveNote: HTMLElement;
  /** where the birth-sky disclosure stands: under the culture selector and the live note */
  readonly birthHost: HTMLElement;
  private marks = new Map<string, HTMLElement>();
  private lastLive: LiveState | null = null;
  private held: string | null = null;

  constructor(parent: HTMLElement, private hooks: SkyViewHooks) {
    this.root = el('div', { class: 'sky-layer', 'aria-label': 'The sky: Sun, Moon and planets', role: 'group' });
    this.root.inert = true;
    this.caption = el('p', { class: 'sky-caption', text: COMPRESSION_CAPTION, 'aria-hidden': 'true' });
    this.cultureSelect = el('select', { 'aria-label': 'Read the names through a culture' });
    this.cultureNote = el('p', { class: 'sky-culture-note' });
    this.liveNote = el('p', { class: 'sky-live', role: 'status' });
    this.birthHost = el('div', { class: 'sky-birth-host' });
    this.culture = el('div', { class: 'sky-culture' }, [el('label', {}, [el('span', { text: 'Names read through' }), this.cultureSelect]), this.cultureNote, this.liveNote, this.birthHost]);
    this.culture.inert = true;
    parent.append(this.root, this.caption, this.culture);
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

  /** The cultures the names can be read through (the field's own, those with a table in cultures.json). */
  setCultures(options: { id: string; name: string }[], onChange: (id: string | null) => void) {
    clear(this.cultureSelect);
    this.cultureSelect.append(el('option', { value: '', text: 'Greco-Roman (default)' }));
    for (const o of options) this.cultureSelect.append(el('option', { value: o.id, text: o.name }));
    this.cultureSelect.onchange = () => onChange(this.cultureSelect.value || null);
  }

  /** Reflect the standing culture in the selector and its note. */
  setCulture(id: string | null, name?: string) {
    this.cultureSelect.value = id ?? '';
    this.cultureNote.textContent = id ? `Names read through ${name ?? id}, after the table of planetary gods.` : '';
  }

  /** The sky's live state, in words: live and checked, a snapshot and why, or beyond the generated span. */
  setLive(state: LiveState) {
    this.lastLive = state;
    this.paintLive();
  }

  /** While a birth sky stands, the clock is not followed: say what the sky is held at instead of "live". Null returns to the live state. */
  setHeld(detail: string | null) {
    this.held = detail;
    this.paintLive();
  }

  private paintLive() {
    clear(this.liveNote);
    if (this.held) {
      this.liveNote.dataset.state = 'held';
      this.liveNote.append(el('strong', { text: 'Birth sky' }), ` · ${this.held}`);
      return;
    }
    if (!this.lastLive) return;
    const d = describeLive(this.lastLive);
    this.liveNote.dataset.state = this.lastLive.kind;
    this.liveNote.append(el('strong', { text: d.label }), ` · ${d.detail}`);
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
    this.culture.inert = !on;
    this.culture.classList.toggle('on', on);
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
    const text = layer.geoShare > 0.5 ? GEOCENTRIC_CAPTION : COMPRESSION_CAPTION;
    if (this.caption.textContent !== text) this.caption.textContent = text;
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
    this.drawMarks(layer.chartMarks);
  }

  /** The ring's sign names and the two angles of a birth chart, as quiet text; the readout beside the form is the accessible statement. */
  private drawMarks(marks: ChartScreenMark[]) {
    const seen = new Set<string>();
    for (const m of marks) {
      seen.add(m.id);
      let n = this.marks.get(m.id);
      if (!n) {
        n = el('span', { class: `sky-chart-mark sky-chart-${m.kind}`, 'aria-hidden': 'true', text: m.text });
        this.marks.set(m.id, n);
        this.root.append(n);
      }
      n.classList.toggle('on', m.on);
      n.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
    for (const [id, n] of this.marks) if (!seen.has(id)) { n.remove(); this.marks.delete(id); }
  }

  private hideAll() {
    this.root.classList.remove('on');
    this.caption.classList.remove('on');
    for (const l of this.labels.values()) l.node.classList.remove('on');
    for (const n of this.marks.values()) n.classList.remove('on');
  }
}
