// The archetypes a planet carries, drawn as its satellites (the owner's design): when the walk holds a planet up close,
// its field ties circle it on two tilted orbits — Jung's own links on the inner orbit, the atlas's links on the outer —
// each a small light with its name, which opens that archetype or symbol in the field. A line runs from the planet
// back toward the Earth, ending in a control that returns to the whole birth sky. Screen-space, over the canvas; it reads
// the sky layer's own drawn disc each frame, so it follows the planet exactly. Nothing here is a claim: the satellites
// are the same ties the walk's panel lists, with the same basis.
import { el } from '../ui/dom';
import type { SkyLayer } from './layer';
import type { BodyKey } from '../types/sky';

export interface Satellite {
  /** stable key (the tie's target) */
  id: string;
  name: string;
  /** Jung's own link (inner orbit) or one the atlas draws (outer) */
  inner: boolean;
  open(): void;
}

const SVG = 'http://www.w3.org/2000/svg';
const TILT = 0.34; // the orbits' apparent flattening: a ring seen from a little above its plane
const ROT = (-14 * Math.PI) / 180; // and turned a little off the horizontal
const PERIOD_S = [64, 96]; // one turn of the inner and the outer orbit, seconds
const TOP = 96; // the shell's header band: nothing of the overlay is placed under it

export class PlanetOrbits {
  readonly root: HTMLElement;
  private svg: SVGSVGElement;
  private rings: SVGEllipseElement[];
  private earthLine: SVGLineElement;
  private earthMark: SVGTextElement;
  private earthBtn: HTMLButtonElement;
  private sats: { s: Satellite; dot: SVGCircleElement; tether: SVGLineElement; label: HTMLButtonElement; phase: number }[] = [];
  private key: BodyKey | null = null;
  private t = 0;
  private shown = 0;

  constructor(parent: HTMLElement, private onEarth: () => void) {
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('class', 'po-svg');
    this.svg.setAttribute('aria-hidden', 'true');
    this.rings = [0, 1].map((i) => {
      const e = document.createElementNS(SVG, 'ellipse');
      e.setAttribute('class', `po-ring ${i ? 'po-outer' : 'po-inner'}`);
      this.svg.append(e);
      return e;
    });
    this.earthLine = document.createElementNS(SVG, 'line');
    this.earthLine.setAttribute('class', 'po-earth-line');
    this.earthMark = document.createElementNS(SVG, 'text');
    this.earthMark.setAttribute('class', 'po-earth-mark');
    this.earthMark.textContent = 'Earth';
    this.svg.append(this.earthLine, this.earthMark);
    this.earthBtn = el('button', { type: 'button', class: 'po-earth', text: 'Whole sky', 'aria-label': 'Back to the whole sky around the Earth', onclick: () => this.onEarth() });
    this.root = el('div', { class: 'po', hidden: true }, [this.earthBtn]);
    this.root.prepend(this.svg);
    parent.append(this.root);
  }

  /** The planet the walk holds and its satellites; null clears. */
  set(key: BodyKey | null, sats: Satellite[] = []) {
    this.key = key;
    for (const x of this.sats) { x.dot.remove(); x.tether.remove(); x.label.remove(); }
    // spread each orbit's satellites evenly, the inner and outer offset so no two names start together
    const inner = sats.filter((s) => s.inner);
    const outer = sats.filter((s) => !s.inner);
    const place = (list: Satellite[], off: number) => list.map((s, i) => ({ s, phase: off + (i / Math.max(1, list.length)) * Math.PI * 2 }));
    this.sats = [...place(inner, 0.6), ...place(outer, 0.6 + Math.PI / Math.max(2, outer.length))].map(({ s, phase }) => {
      const tether = document.createElementNS(SVG, 'line');
      tether.setAttribute('class', 'po-tether');
      const dot = document.createElementNS(SVG, 'circle');
      dot.setAttribute('class', `po-dot ${s.inner ? 'po-inner' : 'po-outer'}`);
      this.svg.append(tether, dot);
      const label = el('button', { type: 'button', class: `po-sat ${s.inner ? 'po-inner' : 'po-outer'}`, title: s.inner ? 'Jung’s own link' : 'A link the atlas draws', onclick: () => s.open() }, [el('span', { text: s.name })]);
      this.root.append(label);
      return { s, dot, tether, label, phase };
    });
    if (!key) { this.root.hidden = true; this.shown = 0; document.body.classList.remove('po-holding'); }
  }

  /** Each frame: follow the planet's drawn disc; show only once the approach has arrived. */
  update(layer: SkyLayer | null, dt: number, reduced: boolean) {
    const key = this.key;
    const disc = key && layer ? layer.screenDisc(key) : null;
    // sky-gazing: stationed at the planet looking at Earth — satellites stand down so the floats read
    const gazing = document.body.classList.contains('sky-gazing');
    const want = !gazing && disc && disc.on && layer && layer.approach > 0.6 && disc.px > 40 ? 1 : 0;
    this.shown += (want - this.shown) * (1 - Math.exp(-dt * 4));
    // while a body is held, a phone gives the sky's own controls (names, the held note) back to it
    document.body.classList.toggle('po-holding', this.shown > 0.5);
    if (this.shown < 0.02 || !disc || !layer) { this.root.hidden = true; return; }
    this.root.hidden = false;
    this.root.style.opacity = this.shown.toFixed(3);
    if (!reduced) this.t += dt;
    const R = disc.px / 2;
    const cx = disc.x, cy = disc.y;
    const radii = [R * 1.42, R * 1.86];
    const cos = Math.cos(ROT), sin = Math.sin(ROT);
    this.rings.forEach((e, i) => {
      e.setAttribute('cx', cx.toFixed(1)); e.setAttribute('cy', cy.toFixed(1));
      e.setAttribute('rx', radii[i].toFixed(1)); e.setAttribute('ry', (radii[i] * TILT).toFixed(1));
      e.setAttribute('transform', `rotate(${(ROT * 180) / Math.PI} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
    });
    // the line home: from the planet toward where the Earth stands (off screen, it runs to the edge)
    const earth = layer.screenDisc('earth');
    // the open panel is the screen's edge: a side panel on a desktop, a bottom sheet on a phone
    let W = this.root.clientWidth || window.innerWidth, H = this.root.clientHeight || window.innerHeight;
    const panel = document.querySelector<HTMLElement>('.lens-panel:not([hidden])')?.getBoundingClientRect();
    if (panel && panel.width > 0) {
      if (panel.left > W * 0.35) W = panel.left - 12;
      else if (panel.top > H * 0.25) H = panel.top + 96; // (the edge math below keeps 120px off the bottom)
    }
    let ex = earth ? earth.x : cx - W, ey = earth ? earth.y : cy + H;
    const dx = ex - cx, dy = ey - cy, len = Math.hypot(dx, dy) || 1;
    // stop at the screen's edge (inset), so the control stays on screen
    const tEdge = Math.min(1, ...[dx < 0 ? (cx - 24) / -dx : (W - 24 - cx) / Math.max(dx, 1e-6), dy < 0 ? (cy - TOP - 22) / -dy : (H - 120 - cy) / Math.max(dy, 1e-6)].map((v) => (Number.isFinite(v) && v > 0 ? v : 1)));
    ex = cx + dx * tEdge; ey = cy + dy * tEdge;
    const sx = cx + (dx / len) * R * 1.02, sy = cy + (dy / len) * R * 1.02;
    this.earthLine.setAttribute('x1', sx.toFixed(1)); this.earthLine.setAttribute('y1', sy.toFixed(1));
    this.earthLine.setAttribute('x2', ex.toFixed(1)); this.earthLine.setAttribute('y2', ey.toFixed(1));
    // the line ends in a mark naming the Earth; the control that goes back always stands under the planet's outer orbit,
    // one predictable place clear of the satellites, the header and the sky's own controls
    this.earthMark.setAttribute('x', ex.toFixed(1));
    this.earthMark.setAttribute('y', (ey - 8).toFixed(1));
    this.earthMark.setAttribute('text-anchor', ex < cx ? 'start' : 'end');
    const bw = this.earthBtn.offsetWidth || 140;
    const by = cy + Math.max(R, radii[1] * TILT) + 36;
    this.earthBtn.style.transform = `translate(${Math.round(Math.min(W - bw - 8, Math.max(8, cx - bw / 2)))}px, ${Math.round(Math.min(H - 150, Math.max(TOP, by)))}px)`;

    for (const x of this.sats) {
      const r = radii[x.s.inner ? 0 : 1];
      const a = x.phase + (this.t * Math.PI * 2) / PERIOD_S[x.s.inner ? 0 : 1];
      const ox = Math.cos(a) * r, oy = Math.sin(a) * r * TILT;
      const px = cx + ox * cos - oy * sin, py = cy + ox * sin + oy * cos;
      // the far half of the orbit passes behind the planet: inside the disc it is hidden, outside it is dimmer
      const behind = Math.sin(a) < 0;
      const occluded = behind && Math.hypot(px - cx, py - cy) < R * 0.98;
      const o = occluded ? 0 : behind ? 0.55 : 1;
      x.dot.setAttribute('cx', px.toFixed(1)); x.dot.setAttribute('cy', py.toFixed(1));
      x.dot.setAttribute('r', (behind ? 3 : 4.5).toFixed(1));
      x.dot.style.opacity = String(o);
      // a short tether from the light to its name, pointing away from the planet
      const ux = (px - cx) / (Math.hypot(px - cx, py - cy) || 1), uy = (py - cy) / (Math.hypot(px - cx, py - cy) || 1);
      const lx = px + ux * 14, ly = py + uy * 14;
      x.tether.setAttribute('x1', px.toFixed(1)); x.tether.setAttribute('y1', py.toFixed(1));
      x.tether.setAttribute('x2', lx.toFixed(1)); x.tether.setAttribute('y2', ly.toFixed(1));
      x.tether.style.opacity = String(o * 0.8);
      x.label.style.opacity = String(o);
      x.label.style.pointerEvents = o > 0.3 ? 'auto' : 'none';
      x.label.style.zIndex = behind ? '1' : '2';
      // the name sits beyond the tether, on the side away from the planet
      x.label.style.transform = `translate(${Math.round(lx + (ux < -0.2 ? -1 : ux > 0.2 ? 0 : -0.5) * x.label.offsetWidth)}px, ${Math.round(ly - x.label.offsetHeight / 2)}px)`;
    }
  }

  destroy() { document.body.classList.remove('po-holding'); this.root.remove(); }
}
