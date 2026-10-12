// FOCUS: a few large, framed images surfaced in the field — fanned around the
// distribution they belong to, each tied to its place by a hairline.
// Not a grid; a handful at most. Image-less entries become compact tonal plates.
import type { ImageRef, Palette } from '../types/field';
import type { Vec3 } from '../data/geo';
import type { Subject } from '../data/model';
import type { GlobeEngine, ScreenPoint } from '../globe/engine';
import { Vector3 } from 'three';
import { el, plate } from './dom';

export type FloatTarget =
  | { type: 'occurrence'; occIdx: number }
  | { type: 'family'; id: string }
  | { type: 'reading' }
  | { type: 'subject'; subject: Subject };

/**
 * `surface`: each plate anchors to its own point on the globe and fades with that point's facing (the default).
 * `earth-point`: while gazing at the Earth from a planet, every plate anchors to the projected Earth centre and
 * stays visible whenever that centre is in front of the camera.
 */
export type FloatAnchor = 'surface' | 'earth-point';

export interface FloatOptions {
  anchor?: FloatAnchor;
}

export interface FloatItem {
  /** where on the globe this image is tied */
  dir: Vec3;
  img?: ImageRef;
  label: string;
  era: string;
  palette?: Palette;
  target: FloatTarget;
}

interface Live {
  item: FloatItem;
  node: HTMLElement;
  line: SVGLineElement;
  dot: SVGCircleElement;
  w: number;
  h: number;
  x: number;
  y: number;
  placed: boolean;
  born: number;
  idx: number;
}

export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Plate box as laid out (`h` includes the caption strip). */
export interface PlateBox {
  w: number;
  h: number;
}

export interface FanBounds {
  width: number;
  height: number;
  marginX: number;
  top: number;
  bottom: number;
}

export interface PlateCentre {
  cx: number;
  cy: number;
}

/** Anchor visibility: surface anchors fade with facing; the earth-point anchor is visible while the Earth is in front. */
export function anchorVis(anchor: FloatAnchor, facing: number, centreInFront: boolean): number {
  if (anchor === 'earth-point') return centreInFront ? 1 : 0;
  return Math.max(0, Math.min(1, facing / 0.1));
}

/** A leader's opacities follow its plate's: the hairline at half, the end dot at nine tenths. Zero when the plate is zero. */
export function leaderOpacity(op: number): { line: number; dot: number } {
  return { line: op * 0.5, dot: op * 0.9 };
}

/** Opacity, eased appear and hit-testing of one plate, `sinceBorn` ms after its stagger point. */
export function plateOpacity(vis: number, sinceBorn: number, yields = false): { op: number; e: number; pointerEvents: 'auto' | 'none' } {
  const appear = Math.max(0, Math.min(1, sinceBorn / 1100));
  const e = appear * appear * (3 - 2 * appear);
  const op = yields ? 0 : vis * e;
  return { op, e, pointerEvents: op > 0.5 ? 'auto' : 'none' };
}

/** Two plate boxes collide when they are closer than their widths/heights plus the same gaps update() keeps. */
function boxesOverlap(a: PlateCentre & PlateBox, b: PlateCentre & PlateBox): boolean {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + 22 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + 14;
}

/**
 * Earth-point placement: plates fan out evenly around the Earth's projected centre (ax, ay). The fan is centred on
 * the direction opposite the obstacles' mass (the open side panel), so plates lean away from it; with fewer than
 * three plates the spacing is that of three, so one or two plates still sit symmetrically. The ring grows until
 * neighbours clear each other, then every centre is clamped to bounds.
 */
export function fanTargets(ax: number, ay: number, plates: PlateBox[], obstacles: Obstacle[], bounds: FanBounds): PlateCentre[] {
  const n = plates.length;
  if (!n) return [];
  let mx = 0, my = 0, mass = 0;
  for (const o of obstacles) {
    const a = o.w * o.h;
    mx += (o.x + o.w / 2 - ax) * a;
    my += (o.y + o.h / 2 - ay) * a;
    mass += a;
  }
  const away = mass > 0 && Math.hypot(mx, my) > 1 ? Math.atan2(-my, -mx) : -Math.PI / 2;
  const spacing = (Math.PI * 2) / Math.max(n, 3);
  const { width: W, height: H, marginX, top, bottom } = bounds;
  const place = (grow: number): PlateCentre[] => plates.map((p, i) => {
    const a = away + (i - (n - 1) / 2) * spacing;
    const reach = Math.hypot(p.w, p.h) * 0.5 + 64 + grow;
    const cx = ax + Math.cos(a) * reach;
    const cy = ay + Math.sin(a) * reach;
    return {
      cx: Math.min(W - marginX - p.w / 2, Math.max(marginX + p.w / 2, cx)),
      cy: Math.min(H - bottom - p.h / 2, Math.max(top + p.h / 2, cy)),
    };
  });
  let grow = 0;
  let t = place(grow);
  for (let it = 0; it < 40 && t.some((c, i) => t.some((d, j) => j > i && boxesOverlap({ ...c, ...plates[i] }, { ...d, ...plates[j] }))); it++) {
    grow += 8;
    t = place(grow);
  }
  return t;
}

/** Whether the Earth's centre lies in front of the camera (origin lies ahead of the camera position). */
function centreInFront(engine: GlobeEngine): boolean {
  const fwd = engine.camera.getWorldDirection(new Vector3());
  return engine.camera.position.dot(fwd) < 0;
}

export class Floats {
  readonly root: HTMLElement;
  private svg: SVGSVGElement;
  private live: Live[] = [];
  private sp: ScreenPoint = { x: 0, y: 0, facing: 0 };
  private disc = { x: 0, y: 0, r: 1 };
  private anchor: FloatAnchor = 'surface';
  obstacles: () => Obstacle[] = () => [];

  constructor(parent: HTMLElement, private onSelect: (t: FloatTarget) => void) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'float-lines');
    this.svg.setAttribute('aria-hidden', 'true');
    this.root = el('div', { class: 'floats' });
    parent.append(this.svg, this.root);
  }

  clear() {
    for (const l of this.live) {
      l.node.classList.remove('in');
      const n = l.node, ln = l.line, d = l.dot;
      n.style.opacity = '0';
      n.style.pointerEvents = 'none';
      // the leader goes with its plate on this same frame: left at its last drawn opacity it outlives the image
      const off = leaderOpacity(0);
      ln.style.opacity = String(off.line);
      d.style.opacity = String(off.dot);
      window.setTimeout(() => { n.remove(); ln.remove(); d.remove(); }, 600);
    }
    this.live = [];
  }

  set(items: FloatItem[], narrow: boolean, opts?: FloatOptions) {
    this.clear();
    this.anchor = opts?.anchor ?? 'surface';
    // scale with the viewport so five plates still fit a small window
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const k = Math.max(0.56, Math.min(1, Math.min(vw / 1440, vh / 900)));
    const maxW = narrow ? 112 : Math.round(214 * k);
    const maxH = narrow ? 140 : Math.round(262 * k);
    const now = performance.now();
    items.forEach((item, idx) => {
      const hasImg = !!item.img;
      const ar = item.img && item.img.width && item.img.height ? item.img.width / item.img.height : 1.5;
      let w = hasImg ? maxW : narrow ? 118 : Math.round(156 * k);
      let h = w / ar;
      if (h > maxH) { h = maxH; w = h * ar; }
      const frame = plate(item.img, { thumb: true, eager: true, palette: item.palette, className: 'float-plate', credit: true, alt: item.label });
      const node = el('button', { class: 'float' + (hasImg ? '' : ' float-tonal'), type: 'button', 'aria-label': item.era ? `${item.label}, ${item.era}` : item.label, onclick: () => this.onSelect(item.target) }, [frame]);
      if (hasImg) {
        node.append(el('span', { class: 'float-cap' }, [el('span', { class: 'float-name', text: item.label }), item.era ? el('span', { class: 'float-era', text: item.era }) : null]));
      } else {
        frame.append(el('span', { class: 'float-inplate' }, [el('span', { class: 'float-name', text: item.label }), item.era ? el('span', { class: 'float-era', text: item.era }) : null]));
      }
      node.style.width = `${Math.round(w)}px`;
      frame.style.height = `${Math.round(h)}px`;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'float-line');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', 'float-dot');
      dot.setAttribute('r', '3.2');
      // a leader is hidden until update() places it with its plate
      line.style.opacity = '0';
      dot.style.opacity = '0';
      this.svg.append(line, dot);
      this.root.append(node);
      this.live.push({ item, node, line, dot, w, h: h + (hasImg ? 36 : 0), x: 0, y: 0, placed: false, born: now + idx * 190 + 500, idx });
    });
  }

  get count() {
    return this.live.length;
  }

  update(engine: GlobeEngine, dt: number) {
    const n = this.live.length;
    if (!n) return;
    const W = engine.width;
    const H = engine.height;
    engine.globeDisc(this.disc);
    const now = performance.now();
    const narrow = W < 760;
    const marginX = narrow ? 8 : 26;
    const top = narrow ? 64 : 88;
    const bottom = narrow ? 128 : 124;

    const earth = this.anchor === 'earth-point';
    const inFront = earth && centreInFront(engine);
    const obs = this.obstacles();

    // anchors on screen: every plate shares the Earth's centre in earth-point mode
    const pts: { x: number; y: number; vis: number }[] = [];
    let cx = 0, cy = 0, cn = 0;
    for (const l of this.live) {
      if (earth) {
        pts.push({ x: this.disc.x, y: this.disc.y, vis: anchorVis('earth-point', 0, inFront) });
        continue;
      }
      engine.project(l.item.dir, this.sp);
      const vis = anchorVis('surface', this.sp.facing, false);
      pts.push({ x: this.sp.x, y: this.sp.y, vis });
      if (vis > 0) { cx += this.sp.x; cy += this.sp.y; cn++; }
    }
    if (cn) { cx /= cn; cy /= cn; } else { cx = this.disc.x; cy = this.disc.y; }

    const targets: { cx: number; cy: number }[] = earth
      ? fanTargets(this.disc.x, this.disc.y, this.live.map((l) => ({ w: l.w, h: l.h })), obs, { width: W, height: H, marginX, top, bottom })
      : [];
    if (!earth) this.live.forEach((l, i) => {
      const p = pts[i];
      let vx = p.x - cx;
      let vy = p.y - cy;
      let len = Math.hypot(vx, vy);
      if (len < 28) {
        // anchors that coincide fan out evenly instead
        const a = -2.5 + (i / n) * Math.PI * 2;
        vx = Math.cos(a); vy = Math.sin(a); len = 1;
      }
      const nx = vx / len, ny = vy / len;
      const reach = Math.hypot(l.w, l.h) * 0.5 + 64;
      targets.push({ cx: p.x + nx * reach, cy: p.y + ny * reach });
    });

    const clampT = (l: Live, t: { cx: number; cy: number }) => {
      t.cx = Math.min(W - marginX - l.w / 2, Math.max(marginX + l.w / 2, t.cx));
      t.cy = Math.min(H - bottom - l.h / 2, Math.max(top + l.h / 2, t.cy));
    };
    this.live.forEach((l, i) => clampT(l, targets[i]));

    for (let it = 0; it < 24; it++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = this.live[i], b = this.live[j];
          const ta = targets[i], tb = targets[j];
          const ox = (a.w + b.w) / 2 + 22 - Math.abs(ta.cx - tb.cx);
          const oy = (a.h + b.h) / 2 + 14 - Math.abs(ta.cy - tb.cy);
          if (ox > 0 && oy > 0) {
            if (ox < oy) { const s = ta.cx < tb.cx ? -1 : 1; ta.cx += (s * ox) / 2; tb.cx -= (s * ox) / 2; }
            else { const s = ta.cy < tb.cy ? -1 : 1; ta.cy += (s * oy) / 2; tb.cy -= (s * oy) / 2; }
          }
        }
        const l = this.live[i], t = targets[i];
        for (const o of obs) {
          const ox = (l.w + o.w) / 2 - Math.abs(t.cx - (o.x + o.w / 2));
          const oy = (l.h + o.h) / 2 - Math.abs(t.cy - (o.y + o.h / 2));
          if (ox > 0 && oy > 0) {
            const sideX = t.cx + (t.cx < o.x + o.w / 2 ? -1 : 1) * ox;
            // a sideways push the screen edge would undo (a phone, where the label spans the width) goes down instead
            const fitsX = sideX - l.w / 2 >= marginX && sideX + l.w / 2 <= W - marginX;
            if (oy < ox || !fitsX) t.cy += (t.cy < o.y + o.h / 2 && fitsX ? -1 : 1) * (fitsX ? oy : (o.y + o.h + l.h / 2) - t.cy);
            else t.cx = sideX;
          }
        }
        clampT(l, t);
      }
    }

    // whatever relaxation could not separate gives way to the earlier plate
    const yields: boolean[] = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        if (yields[j]) continue;
        const a = this.live[i], b = this.live[j], ta = targets[i], tb = targets[j];
        if (Math.abs(ta.cx - tb.cx) < (a.w + b.w) / 2 + 6 && Math.abs(ta.cy - tb.cy) < (a.h + b.h) / 2 + 4) { yields[i] = true; break; }
      }
    }

    const k = 1 - Math.exp(-dt * 5);
    this.live.forEach((l, i) => {
      const t = targets[i];
      const p = pts[i];
      if (!l.placed) { l.x = t.cx; l.y = t.cy; l.placed = true; } else { l.x += (t.cx - l.x) * k; l.y += (t.cy - l.y) * k; }
      const { op, e, pointerEvents } = plateOpacity(p.vis, now - l.born, yields[i]);
      l.node.style.opacity = String(op);
      l.node.style.pointerEvents = pointerEvents;
      l.node.style.transform = `translate3d(${l.x - l.w / 2}px, ${l.y - l.h / 2 + (1 - e) * 10}px, 0)`;
      // hairline from the place to the nearest edge of its plate
      const dx = l.x - p.x;
      const plateH = l.item.img ? l.h - 36 : l.h;
      const sx = Math.abs(dx) > 1e-3 ? (l.w / 2 + 4) / Math.abs(dx) : Infinity;
      const dyP = l.y - l.h / 2 + plateH / 2 - p.y;
      const sy = Math.abs(dyP) > 1e-3 ? (plateH / 2 + 4) / Math.abs(dyP) : Infinity;
      const s = Math.min(1, sx, sy);
      const plateCy = l.y - l.h / 2 + plateH / 2; // the plate sits at the top of its box
      const ey = plateCy - dyP * s;
      l.line.setAttribute('x1', String(p.x));
      l.line.setAttribute('y1', String(p.y));
      l.line.setAttribute('x2', String(l.x - dx * s));
      l.line.setAttribute('y2', String(ey));
      const lead = leaderOpacity(op);
      l.line.style.opacity = String(lead.line);
      l.dot.setAttribute('cx', String(p.x));
      l.dot.setAttribute('cy', String(p.y));
      l.dot.style.opacity = String(lead.dot);
    });
  }
}
