// The archetypes a planet carries, drawn as its satellites (the owner's design): when the walk holds a planet up close,
// its field ties circle it on two tilted orbits — Jung's own links on the inner orbit, the atlas's links on the outer —
// each a small light with its name, which opens that archetype or symbol in the field. A line runs from the planet
// back toward the Earth, ending in a control that returns to the whole birth sky. Screen-space, over the canvas; it reads
// the sky layer's own drawn disc each frame, so it follows the planet exactly. Nothing here is a claim: the satellites
// are the same ties the walk's panel lists, with the same basis.
//
// Beyond those two orbits stand the planet's tarot cards, as small plates that float on two wider rings (spec: the
// field's own joins, public/data/sky-cards.json): the decan wheel, each card hung at its decan's true ecliptic longitude
// (the plane is projected through the camera, so 0° Aries points toward the vernal point), and the rank ring, the four
// cards of its sephira's number with the Atu the field gives it. A card sways a little about its place and breathes in
// its radius; the rank ring turns slowly, since nothing on it is a longitude.
import { el } from '../ui/dom';
import type { SkyLayer } from './layer';
import type { BodyKey } from '../types/sky';
import { decanOf, imageUrl, type CardPlate, type RingCard } from './cards';
import { cardSize, fitShare, readable, ringPresence, wheelPoint, type Room } from './wheel';
import { holoCssAt } from './zodiac';

/** One card on a ring: its place on the ring, its plate, and what opens it. */
export interface CardNode {
  ring: RingCard;
  name: string;
  /** what the card is to this planet, said once (the control's title) */
  hint: string;
  plate: CardPlate;
  open(): void;
}

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
/** The card rings' radii, in discs: well beyond the archetypes' two orbits (1.42 and 1.86), the rank ring outside the decan wheel. */
const K_DECAN = 2.6;
const K_RANK = 3.75;
/** The least a ring is drawn at when the room is short (a phone): outside the archetypes' outer orbit, the two a ring apart. Their names stand above the cards. */
const K_DECAN_MIN = 2.05;
const K_RANK_MIN = 2.6;
const RANK_PERIOD_S = 420; // one turn of the rank ring
const SWAY_DEG = 5; // a decan card's sway about its longitude

/**
 * Whether the satellites, the Earth line and the Whole-sky control stand this frame (spec §2.5, the phase contract on
 * `document.body.dataset.skyPhase`). They stand only in `approach`: stationed at a planet, arrived. Any other phase
 * hides them. With no phase set (a page that has not adopted the contract yet) the old rule holds: stand down while the
 * body carries `sky-gazing`. `disc` is the held body's own disc (never the Sun's glow: the body's true size); the orbits need
 * it on screen and large enough to ring. The rings then go with the body as it dwindles (`ringPresence`), so this floor is
 * only the point below which there is nothing left to hang them on.
 */
export function orbitsWanted(phase: string | undefined, gazing: boolean, approach: number, disc: { on: boolean; px: number } | null): boolean {
  const stationed = phase === undefined ? !gazing : phase === 'approach';
  return stationed && !!disc && disc.on && approach > 0.6 && disc.px > 28;
}

/** Phases whose orbits go at once, with no fade: the camera is leaving the station or has not reached it yet. */
export function orbitsSnapOff(phase: string | undefined): boolean {
  return phase === 'gaze' || phase === 'descend' || phase === 'return' || phase === 'system';
}

export class PlanetOrbits {
  readonly root: HTMLElement;
  private svg: SVGSVGElement;
  private rings: SVGEllipseElement[];
  private earthLine: SVGLineElement;
  private earthMark: SVGTextElement;
  private earthBtn: HTMLButtonElement;
  private sats: { s: Satellite; dot: SVGCircleElement; tether: SVGLineElement; label: HTMLButtonElement; phase: number }[] = [];
  private wheelDecan: SVGPolylineElement;
  private wheelRank: SVGPolylineElement;
  private ticks: SVGLineElement[] = [];
  private cards: { n: CardNode; btn: HTMLButtonElement; p1: number; p2: number }[] = [];
  private cardsKey: BodyKey | null = null;
  private key: BodyKey | null = null;
  private t = 0;
  private shown = 0;
  /** whether the controls take clicks this frame (false while they fade or are hidden) */
  private interactive = false;

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
    // the card rings' own lines: the decan wheel with a tick at each decan (the sign's boundary longer), the rank ring dashed
    this.wheelDecan = document.createElementNS(SVG, 'polyline');
    this.wheelDecan.setAttribute('class', 'po-wheel po-wheel-decan');
    this.wheelRank = document.createElementNS(SVG, 'polyline');
    this.wheelRank.setAttribute('class', 'po-wheel po-wheel-rank');
    this.svg.append(this.wheelDecan, this.wheelRank);
    for (let i = 0; i < 36; i++) {
      const t = document.createElementNS(SVG, 'line');
      t.setAttribute('class', `po-tick${i % 3 === 0 ? ' po-tick-sign' : ''}`);
      this.ticks.push(t);
      this.svg.append(t);
    }
    this.earthBtn = el('button', { type: 'button', class: 'po-earth', text: 'Whole sky', 'aria-label': 'Back to the whole sky around the Earth', onclick: () => this.onEarth() });
    this.root = el('div', { class: 'po', hidden: true }, [this.earthBtn]);
    this.root.prepend(this.svg);
    parent.append(this.root);
  }

  /** The planet the walk holds and its satellites; null clears. */
  set(key: BodyKey | null, sats: Satellite[] = []) {
    this.key = key;
    this.setCards(null, []);
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
      // a new control stands hidden until update() shows it: its own opacity and pointer-events say so, not the stylesheet's
      // defaults (1 and auto), which a hidden root would otherwise leave reading as a clickable satellite
      label.style.opacity = '0';
      label.style.pointerEvents = 'none';
      return { s, dot, tether, label, phase };
    });
    if (!key) { this.root.hidden = true; this.shown = 0; document.body.classList.remove('po-holding'); }
  }

  /**
   * The planet's tarot cards, floated on the two outer rings. A call for a body the orbits no longer hold (the data
   * arrived after the planet was let go) is ignored; an empty list takes the cards away.
   */
  setCards(key: BodyKey | null, nodes: CardNode[]) {
    if (key !== null && key !== this.key) return;
    for (const c of this.cards) c.btn.remove();
    this.cards = [];
    this.cardsKey = nodes.length ? key : null;
    nodes.forEach((n, i) => {
      const img = el('img', { src: imageUrl(n.plate), alt: '', decoding: 'async', draggable: 'false', loading: 'lazy' });
      const btn = el('button', {
        type: 'button', class: `po-card po-card-${n.ring.ring} po-card-${n.ring.role}`, title: `${n.name} — ${n.hint}`, 'aria-label': `${n.name}: ${n.hint}`, onclick: () => n.open(),
      }, [img, el('span', { class: 'po-card-name', text: n.name })]) as HTMLButtonElement;
      btn.style.setProperty('--ct', holoCssAt(n.ring.tintLon));
      btn.style.setProperty('--ct-soft', holoCssAt(n.ring.tintLon, 0.5));
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'none';
      this.root.append(btn);
      // each card its own slow rhythm, so no two sway together
      this.cards.push({ n, btn, p1: i * 2.399963, p2: i * 1.618034 + 0.7 });
    });
    if (!nodes.length) {
      this.wheelDecan.removeAttribute('points');
      this.wheelRank.removeAttribute('points');
    }
  }

  /** Each frame: follow the planet's drawn disc; show only once the approach has arrived (see `orbitsWanted`). */
  update(layer: SkyLayer | null, dt: number, reduced: boolean) {
    const key = this.key;
    const disc = key && layer ? layer.screenDisc(key) : null;
    const phase = document.body.dataset.skyPhase;
    const isEarth = key === 'terra';
    // the held body's own disc: for the Sun, its true size and not the glow (whose floor kept its rings up at any distance)
    const heldPx = disc ? disc.held : 0;
    const wanted = orbitsWanted(phase, document.body.classList.contains('sky-gazing'), layer?.approach ?? 0, disc && { on: disc.on, px: heldPx });
    // the orbits leave at once in the gaze, descend, return and system phases: a fade would leave the line on screen
    if (!wanted && orbitsSnapOff(phase)) this.shown = 0;
    else this.shown += ((wanted ? 1 : 0) - this.shown) * (1 - Math.exp(-dt * 4));
    // while a body is held, a phone gives the sky's own controls (names, the held note) back to it
    document.body.classList.toggle('po-holding', this.shown > 0.5);
    const R = heldPx / 2;
    // the rings go with the body on a zoom out: its disc is the one measure of how much of them stands
    const presence = ringPresence(R);
    if (this.shown * presence < 0.02 || !disc || !layer) { this.root.hidden = true; this.setInteractive(false); return; }
    this.root.hidden = false;
    // while fading out nothing takes a click (nor while the body is too small to hang anything on): the children's own
    // pointer-events (set in the stylesheet) are overridden here
    this.setInteractive(wanted && presence > 0.6);
    this.root.style.opacity = (this.shown * presence).toFixed(3);
    if (!reduced) this.t += dt;
    const cx = disc.x, cy = disc.y;
    const radii = [R * 1.42, R * 1.86];
    const cos = Math.cos(ROT), sin = Math.sin(ROT);
    this.rings.forEach((e, i) => {
      e.setAttribute('cx', cx.toFixed(1)); e.setAttribute('cy', cy.toFixed(1));
      e.setAttribute('rx', radii[i].toFixed(1)); e.setAttribute('ry', (radii[i] * TILT).toFixed(1));
      e.setAttribute('transform', `rotate(${(ROT * 180) / Math.PI} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
    });
    // the line home: from the planet toward where the Earth stands (off screen, it runs to the edge)
    const earth = layer.screenDisc('terra');
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
    // the Earth held has no line home: it is home
    const homeVis = isEarth ? 'hidden' : 'visible';
    this.earthLine.setAttribute('visibility', homeVis);
    this.earthMark.setAttribute('visibility', homeVis);
    this.earthLine.setAttribute('x1', sx.toFixed(1)); this.earthLine.setAttribute('y1', sy.toFixed(1));
    this.earthLine.setAttribute('x2', ex.toFixed(1)); this.earthLine.setAttribute('y2', ey.toFixed(1));
    // the line ends in a mark naming the Earth; the control that goes back always stands under the planet's outer orbit,
    // one predictable place clear of the satellites, the header and the sky's own controls
    this.earthMark.setAttribute('x', ex.toFixed(1));
    // the line is held below the header band: its name goes under the end point there, never over the page title
    this.earthMark.setAttribute('y', (ey < TOP + 48 ? ey + 18 : ey - 8).toFixed(1));
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
      x.label.style.pointerEvents = this.interactive && o > 0.3 ? 'auto' : 'none';
      x.label.style.zIndex = behind ? '2' : '3';
      // the name sits beyond the tether, on the side away from the planet
      // …and never off the screen: on a phone the outer orbit spans the width, so a name set outward is pulled back inside
      const lw = x.label.offsetWidth;
      const lxPlaced = lx + (ux < -0.2 ? -1 : ux > 0.2 ? 0 : -0.5) * lw;
      const lxClamped = Math.min(W - lw - 8, Math.max(8, lxPlaced));
      x.label.style.transform = `translate(${Math.round(lxClamped)}px, ${Math.round(ly - x.label.offsetHeight / 2)}px)`;
    }
    this.placeCards(layer, key!, cx, cy, R, { left: 8, right: W - 8, top: TOP, bottom: H - 120 }, reduced);
  }

  /** The card rings: the wheel through the camera, each card at its longitude (or its spread place), floating. */
  private placeCards(layer: SkyLayer, key: BodyKey, cx: number, cy: number, R: number, room: Room, reduced: boolean) {
    const live = this.cards.length > 0 && this.cardsKey === key;
    const raw = live ? layer.eclipticWheel(key, R) : null;
    if (!live || !raw) {
      this.wheelDecan.setAttribute('visibility', 'hidden');
      this.wheelRank.setAttribute('visibility', 'hidden');
      this.ticks.forEach((t) => t.setAttribute('visibility', 'hidden'));
      for (const c of this.cards) { c.btn.style.opacity = '0'; c.btn.style.pointerEvents = 'none'; }
      return;
    }
    const w = readable(raw);
    const size = cardSize(R);
    const hasDecan = this.cards.some((c) => c.n.ring.ring === 'decan');
    // each ring as large as the room allows, never nearer than its floor: a phone's rings crowd in toward the planet
    const kDecan = Math.max(K_DECAN_MIN, K_DECAN * fitShare(w, K_DECAN, cx, cy, room, size.w * 1.2, size.h * 1.2));
    const kRank = Math.max(hasDecan ? Math.max(K_RANK_MIN, kDecan + 0.5) : K_DECAN_MIN, K_RANK * fitShare(w, K_RANK, cx, cy, room, size.w * 1.2, size.h * 1.2));
    const place = (k: number) => (lon: number) => { const p = wheelPoint(w, k, lon); return { x: cx + p.x, y: cy + p.y, depth: p.depth }; };
    const drawLoop = (poly: SVGPolylineElement, k: number) => {
      const at = place(k);
      const pts: string[] = [];
      for (let i = 0; i <= 72; i++) { const p = at(i * 5); pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`); }
      poly.setAttribute('points', pts.join(' '));
      poly.setAttribute('visibility', 'visible');
    };
    const hasRank = this.cards.some((c) => c.n.ring.ring === 'rank');
    if (hasDecan) {
      drawLoop(this.wheelDecan, kDecan);
      // the sign boundaries (longer) and the decans' own edges, as ticks across the wheel
      this.ticks.forEach((tk, i) => {
        const a = place(kDecan * 0.985)(i * 10);
        const b = place(kDecan * (i % 3 === 0 ? 1.045 : 1.015))(i * 10);
        tk.setAttribute('x1', a.x.toFixed(1)); tk.setAttribute('y1', a.y.toFixed(1));
        tk.setAttribute('x2', b.x.toFixed(1)); tk.setAttribute('y2', b.y.toFixed(1));
        tk.setAttribute('visibility', 'visible');
      });
    } else {
      this.wheelDecan.setAttribute('visibility', 'hidden');
      this.ticks.forEach((t) => t.setAttribute('visibility', 'hidden'));
    }
    if (hasRank) drawLoop(this.wheelRank, kRank); else this.wheelRank.setAttribute('visibility', 'hidden');

    // where the planet stands now: its decan's card is lit
    const here = decanOf(layer.bodyLongitude(key));
    for (const c of this.cards) {
      const r = c.n.ring;
      const sway = reduced ? 0 : Math.sin(this.t * 0.31 + c.p1) * SWAY_DEG;
      const bob = reduced ? 0 : Math.sin(this.t * 0.42 + c.p2);
      // the decan wheel keeps each card at its longitude (it only sways); the rank ring, no longitude at all, turns
      const onDecan = r.ring === 'decan';
      const lon = onDecan ? r.lon + sway : r.lon + (reduced ? 0 : (this.t * 360) / RANK_PERIOD_S) + sway * 0.5;
      const q = wheelPoint(w, (onDecan ? kDecan : kRank) * (1 + 0.025 * bob), lon);
      const p = { x: cx + q.x, y: cy + q.y, depth: q.depth };
      const grand = r.role === 'planet' || r.role === 'element' ? 1.16 : 1;
      const far = Math.max(0, p.depth);
      const scale = (1 - 0.16 * Math.max(-1, Math.min(1, p.depth))) * grand;
      // (the whole overlay's own fade is on its root: only the far half's dimming is here)
      const o = 1 - 0.3 * far;
      const bw = size.w, bh = size.h;
      // a card never leaves the screen: held a half-card inside the room
      const x = Math.min(room.right - bw / 2, Math.max(room.left + bw / 2, p.x));
      const y = Math.min(room.bottom - bh / 2, Math.max(room.top + bh / 2, p.y + (reduced ? 0 : bob * 3)));
      // the plate is its own size; the control is never smaller than a finger (44 px), the plate centred in it
      c.btn.style.setProperty('--cw', `${bw}px`);
      c.btn.style.setProperty('--ch', `${bh}px`);
      c.btn.style.width = `${Math.max(bw, 44)}px`;
      c.btn.style.height = `${Math.max(bh, 44)}px`;
      c.btn.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      c.btn.style.opacity = o.toFixed(3);
      c.btn.style.zIndex = p.depth > 0 ? '0' : '1';
      c.btn.style.pointerEvents = this.interactive && o > 0.3 ? 'auto' : 'none';
      c.btn.classList.toggle('is-here', onDecan && r.decan !== undefined && decanOf(r.decan) === here);
    }
  }

  /** Clicks reach the controls only while they are wanted; the stylesheet's own `pointer-events: auto` on them is overridden inline. */
  private setInteractive(on: boolean) {
    if (on === this.interactive) return;
    this.interactive = on;
    this.earthBtn.style.pointerEvents = on ? 'auto' : 'none';
    for (const x of this.sats) x.label.style.pointerEvents = on ? 'auto' : 'none';
    for (const c of this.cards) c.btn.style.pointerEvents = on ? 'auto' : 'none';
  }

  destroy() { document.body.classList.remove('po-holding'); this.root.remove(); }
}
