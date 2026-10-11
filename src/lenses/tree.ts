// The Tree of Life as a figure: the ten sephiroth in their standard layout, the twenty-two paths between them numbered
// 11–32 in the traditional order. The tables are pure (exported for the tests); the builder draws them in the style of the
// QL wheel. Shapes are shown, not narrated: a sephira whose family is in the field is a button, one whose family is not is
// drawn and left as a plain shape.

export type SephiraId = 'kether' | 'chokmah' | 'binah' | 'chesed' | 'geburah' | 'tiphareth' | 'netzach' | 'hod' | 'yesod' | 'malkuth';

export interface TreeNode { id: SephiraId; name: string; number: number; x: number; y: number }
export interface TreePath { n: number; from: SephiraId; to: SephiraId }

/** The figure's coordinate frame: a 240 by 360 box, the Tree's three pillars at x 44, 120 and 196. */
export const TREE_VIEW = { width: 240, height: 360 } as const;

/** The ten sephiroth, numbered 1–10. Kether, Tiphareth, Yesod and Malkuth stand on the middle pillar. */
export const TREE_NODES: readonly TreeNode[] = [
  { id: 'kether', name: 'Kether', number: 1, x: 120, y: 28 },
  { id: 'chokmah', name: 'Chokmah', number: 2, x: 196, y: 88 },
  { id: 'binah', name: 'Binah', number: 3, x: 44, y: 88 },
  { id: 'chesed', name: 'Chesed', number: 4, x: 196, y: 150 },
  { id: 'geburah', name: 'Geburah', number: 5, x: 44, y: 150 },
  { id: 'tiphareth', name: 'Tiphareth', number: 6, x: 120, y: 190 },
  { id: 'netzach', name: 'Netzach', number: 7, x: 196, y: 236 },
  { id: 'hod', name: 'Hod', number: 8, x: 44, y: 236 },
  { id: 'yesod', name: 'Yesod', number: 9, x: 120, y: 272 },
  { id: 'malkuth', name: 'Malkuth', number: 10, x: 120, y: 326 },
];

/** The twenty-two paths between the sephiroth, numbered 11–32 in the standard order. Drawn as quiet lines. */
export const TREE_PATHS: readonly TreePath[] = [
  { n: 11, from: 'kether', to: 'chokmah' },
  { n: 12, from: 'kether', to: 'binah' },
  { n: 13, from: 'kether', to: 'tiphareth' },
  { n: 14, from: 'chokmah', to: 'binah' },
  { n: 15, from: 'chokmah', to: 'tiphareth' },
  { n: 16, from: 'chokmah', to: 'chesed' },
  { n: 17, from: 'binah', to: 'tiphareth' },
  { n: 18, from: 'binah', to: 'geburah' },
  { n: 19, from: 'chesed', to: 'geburah' },
  { n: 20, from: 'chesed', to: 'tiphareth' },
  { n: 21, from: 'chesed', to: 'netzach' },
  { n: 22, from: 'geburah', to: 'tiphareth' },
  { n: 23, from: 'geburah', to: 'hod' },
  { n: 24, from: 'tiphareth', to: 'netzach' },
  { n: 25, from: 'tiphareth', to: 'yesod' },
  { n: 26, from: 'tiphareth', to: 'hod' },
  { n: 27, from: 'netzach', to: 'hod' },
  { n: 28, from: 'netzach', to: 'yesod' },
  { n: 29, from: 'netzach', to: 'malkuth' },
  { n: 30, from: 'hod', to: 'yesod' },
  { n: 31, from: 'hod', to: 'malkuth' },
  { n: 32, from: 'yesod', to: 'malkuth' },
];

export interface TreeFigureOpts {
  /** the fill of a sephira's node, from its family's palette; undefined draws the plain node */
  palette(id: string): { core: string } | undefined;
  /** a sephira whose family is in the field is a button that calls this with its id */
  open?(id: string): void;
  /** whether the field holds the family of this sephira */
  has(id: string): boolean;
  /** the sephira to light, if any */
  current?: string;
}

const NS = 'http://www.w3.org/2000/svg';
const NODE_R = 16;

/**
 * The Tree of Life: paths first, quiet, then the ten nodes over them, each with its number inside and its name below.
 * A sephira whose family the field holds is a focusable button (Enter, Space or click opens it); the others are drawn only.
 */
export function treeFigure(opts: TreeFigureOpts): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  const add = (parent: Element, tag: string, a: Record<string, string | number>, text?: string): SVGElement => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    parent.append(n);
    return n as SVGElement;
  };
  svg.setAttribute('viewBox', `0 0 ${TREE_VIEW.width} ${TREE_VIEW.height}`);
  svg.setAttribute('class', 'tree-figure');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `The Tree of Life: ${TREE_NODES.map((n) => `${n.name}, number ${n.number}`).join('; ')}`);

  const at = new Map(TREE_NODES.map((n) => [n.id, n] as const));
  for (const p of TREE_PATHS) {
    const a = at.get(p.from)!, b = at.get(p.to)!;
    add(svg, 'line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'tree-path', 'data-path': p.n });
  }

  for (const node of TREE_NODES) {
    const live = opts.has(node.id) && !!opts.open;
    const g = add(svg, 'g', {
      class: `ql-stop tree-node ${live ? 'tree-live' : 'tree-absent'}${opts.current === node.id ? ' on' : ''}`,
      'data-sephira': node.id,
    }) as SVGGElement;
    const c = add(g, 'circle', { cx: node.x, cy: node.y, r: NODE_R, class: 'ql-node' }) as SVGCircleElement;
    const pal = opts.palette(node.id);
    if (pal) { c.style.fill = pal.core; c.style.fillOpacity = '0.28'; c.style.stroke = pal.core; }
    add(g, 'text', { x: node.x, y: node.y + 5, class: 'ql-n', 'text-anchor': 'middle' }, String(node.number));
    add(g, 'text', { x: node.x, y: node.y + 30, class: 'ql-pos', 'text-anchor': 'middle' }, node.name);
    if (live) {
      const open = opts.open!;
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `${node.name}, number ${node.number}`);
      g.addEventListener('click', () => open(node.id));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(node.id); } });
    }
  }
  return svg;
}
