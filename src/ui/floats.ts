// FOCUS: a few large, framed images surfaced in the field — fanned around the
// distribution they belong to, each tied to its place by a hairline.
// Not a grid; a handful at most. Image-less entries become compact tonal plates.
import type { ImageRef, Palette } from '../types/field';
import type { Vec3 } from '../data/geo';
import type { GlobeEngine, ScreenPoint } from '../globe/engine';
import { el, plate } from './dom';

export type FloatTarget =
  | { type: 'occurrence'; occIdx: number }
  | { type: 'family'; id: string }
  | { type: 'reading' };

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

export class Floats {
  readonly root: HTMLElement;
  private svg: SVGSVGElement;
  private live: Live[] = [];
  private sp: ScreenPoint = { x: 0, y: 0, facing: 0 };
  private disc = { x: 0, y: 0, r: 1 };
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
      window.setTimeout(() => { n.remove(); ln.remove(); d.remove(); }, 600);
    }
    this.live = [];
  }

  set(items: FloatItem[], narrow: boolean) {
    this.clear();
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

    // anchors on screen
    const pts: { x: number; y: number; vis: number }[] = [];
    let cx = 0, cy = 0, cn = 0;
    for (const l of this.live) {
      engine.project(l.item.dir, this.sp);
      const vis = Math.max(0, Math.min(1, this.sp.facing / 0.1));
      pts.push({ x: this.sp.x, y: this.sp.y, vis });
      if (vis > 0) { cx += this.sp.x; cy += this.sp.y; cn++; }
    }
    if (cn) { cx /= cn; cy /= cn; } else { cx = this.disc.x; cy = this.disc.y; }

    const targets: { cx: number; cy: number }[] = [];
    this.live.forEach((l, i) => {
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

    const obs = this.obstacles();
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
            if (oy < ox) t.cy += (t.cy < o.y + o.h / 2 ? -1 : 1) * oy;
            else t.cx += (t.cx < o.x + o.w / 2 ? -1 : 1) * ox;
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
      const appear = Math.max(0, Math.min(1, (now - l.born) / 1100));
      const e = appear * appear * (3 - 2 * appear);
      const op = yields[i] ? 0 : p.vis * e;
      l.node.style.opacity = String(op);
      l.node.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
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
      l.line.style.opacity = String(op * 0.5);
      l.dot.setAttribute('cx', String(p.x));
      l.dot.setAttribute('cy', String(p.y));
      l.dot.style.opacity = String(op * 0.9);
    });
  }
}
