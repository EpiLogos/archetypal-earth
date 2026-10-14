// The layout's repulsion, made cheap enough for the whole field. d3's forceManyBody makes every node a source and a
// target, so three thousand occurrences of dust cost several times more than the six hundred forms that shape the
// picture. Here the forms (archetypes, theoretics, families, bodies) are the only sources and targets of the far field
// (Barnes–Hut, exactly as d3 does it), and each occurrence's own push is carried by its form, so the far field is the
// one the whole set used to make. An occurrence sits a few units from its form, where the far field is the form's: it
// moves with its form in it, and is pushed apart from it by the form's own strength. The near field among the dust is
// the cluster force's: an occurrence repels the other occurrences of its own form, pair by pair.
import { quadtree, type QuadtreeInternalNode, type QuadtreeLeaf } from 'd3-quadtree';

export interface FieldBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  index?: number;
}

type Quad<N> = (QuadtreeInternalNode<N> | QuadtreeLeaf<N>) & { x?: number; y?: number; value?: number };

// a zero offset must still push: the smallest deterministic nudge (d3 uses its random source; a layout here is reproducible)
const nudge = (i: number) => ((i % 7) - 3 + 0.5) * 1e-6;

/** A Barnes–Hut repulsion among the sources; a light node folds its strength into its parent and moves with it in the field. */
export interface FieldForce<N extends FieldBody> {
  (alpha: number): void;
  initialize(nodes: N[], random?: () => number): void;
  /** the push of each node (negative repels); read again on initialize and when set */
  strength(): (n: N) => number;
  strength(fn: (n: N) => number): FieldForce<N>;
  /** the parent that carries a light node's push, or null for a source */
  parent(fn: (n: N) => N | null): FieldForce<N>;
  theta(t: number): FieldForce<N>;
  distanceMax(): number;
  distanceMax(d: number): FieldForce<N>;
  /** the sources of the current set (tests, diagnostics) */
  sources(): readonly N[];
}

export function forceField<N extends FieldBody>(): FieldForce<N> {
  let nodes: N[] = [];
  let sources: N[] = [];
  // by node.index: the node's own push, and (for a source) its push with its children's folded in
  let own = new Float64Array(0);
  let total = new Float64Array(0);
  // by node.index: the field's push on a source this tick, which its light nodes share
  let fx = new Float64Array(0);
  let fy = new Float64Array(0);
  // by node.index: the parent's node.index, or -1
  let par = new Int32Array(0);
  let strengthFn: (n: N) => number = () => -30;
  let parentFn: (n: N) => N | null = () => null;
  let theta2 = 0.81;
  let distMax = Infinity;
  let distMax2 = Infinity;
  const distMin2 = 1;
  let target: N;
  let alpha = 0;
  let byIndex: N[] = [];

  const prepare = () => {
    const n = nodes.length;
    let max = 0;
    for (const v of nodes) max = Math.max(max, (v.index ?? 0) + 1);
    own = new Float64Array(max);
    total = new Float64Array(max);
    fx = new Float64Array(max);
    fy = new Float64Array(max);
    par = new Int32Array(max).fill(-1);
    const inSet = new Set<N>(nodes);
    sources = [];
    for (let i = 0; i < n; i++) {
      const v = nodes[i];
      own[v.index!] = +strengthFn(v) || 0;
    }
    for (let i = 0; i < n; i++) {
      const v = nodes[i];
      const p = parentFn(v);
      // a light node whose parent is not in the set is its own source: nothing is left unpushed
      if (p && p !== v && inSet.has(p) && parentFn(p) === null) par[v.index!] = p.index!;
    }
    for (let i = 0; i < n; i++) {
      const v = nodes[i];
      if (par[v.index!] < 0) {
        sources.push(v);
        total[v.index!] += own[v.index!];
      } else total[par[v.index!]] += own[v.index!];
    }
  };

  function accumulate(quad: Quad<N>) {
    let strength = 0;
    if (quad.length) {
      let weight = 0;
      let x = 0;
      let y = 0;
      for (let i = 0; i < 4; i++) {
        const q = (quad as QuadtreeInternalNode<N>)[i] as Quad<N> | undefined;
        if (!q) continue;
        const c = Math.abs(q.value ?? 0);
        if (!c) continue;
        strength += q.value!;
        weight += c;
        x += c * q.x!;
        y += c * q.y!;
      }
      quad.x = weight ? x / weight : 0;
      quad.y = weight ? y / weight : 0;
    } else {
      let q: QuadtreeLeaf<N> | undefined = quad as QuadtreeLeaf<N>;
      quad.x = q.data.x;
      quad.y = q.data.y;
      do strength += total[q.data.index!];
      while ((q = q.next));
    }
    quad.value = strength;
  }

  function apply(quad: Quad<N>, x1: number, _y1: number, x2: number): boolean | void {
    if (!quad.value) return true;
    let x = quad.x! - target.x;
    let y = quad.y! - target.y;
    let w = x2 - x1;
    let l = x * x + y * y;
    // far enough to be one body
    if ((w * w) / theta2 < l) {
      if (l < distMax2) {
        if (x === 0) { x = nudge(target.index!); l += x * x; }
        if (y === 0) { y = nudge(target.index! + 3); l += y * y; }
        if (l < distMin2) l = Math.sqrt(distMin2 * l);
        target.vx += (x * quad.value * alpha) / l;
        target.vy += (y * quad.value * alpha) / l;
      }
      return true;
    }
    if (quad.length || l >= distMax2) return;
    let q: QuadtreeLeaf<N> | undefined = quad as QuadtreeLeaf<N>;
    if (q.data !== target || q.next) {
      if (x === 0) { x = nudge(target.index!); l += x * x; }
      if (y === 0) { y = nudge(target.index! + 3); l += y * y; }
      if (l < distMin2) l = Math.sqrt(distMin2 * l);
    }
    do {
      if (q.data !== target) {
        w = (total[q.data.index!] * alpha) / l;
        target.vx += x * w;
        target.vy += y * w;
      }
    } while ((q = q.next));
  }

  const force = ((a: number) => {
    if (!sources.length) return;
    alpha = a;
    const tree = quadtree<N>(sources, (d) => d.x, (d) => d.y).visitAfter(accumulate as (q: QuadtreeInternalNode<N> | QuadtreeLeaf<N>) => void);
    for (const v of sources) {
      const vx0 = v.vx;
      const vy0 = v.vy;
      target = v;
      tree.visit(apply as (q: QuadtreeInternalNode<N> | QuadtreeLeaf<N>, x0: number, y0: number, x1: number, y1: number) => boolean | void);
      fx[v.index!] = v.vx - vx0;
      fy[v.index!] = v.vy - vy0;
    }
    for (const v of nodes) {
      const pi = par[v.index!];
      if (pi < 0) continue;
      // a light node moves with its parent in the far field...
      v.vx += fx[pi];
      v.vy += fy[pi];
      // ...and is pushed off the parent by the parent's own strength (its siblings' are the cluster force's)
      const p = byIndex[pi];
      let x = p.x - v.x;
      let y = p.y - v.y;
      let l = x * x + y * y;
      if (l >= distMax2) continue;
      if (x === 0) { x = nudge(v.index!); l += x * x; }
      if (y === 0) { y = nudge(v.index! + 3); l += y * y; }
      if (l < distMin2) l = Math.sqrt(distMin2 * l);
      const w = (own[pi] * alpha) / l;
      v.vx += x * w;
      v.vy += y * w;
    }
  }) as FieldForce<N>;

  force.initialize = (ns: N[]) => {
    nodes = ns;
    byIndex = [];
    for (const v of ns) byIndex[v.index!] = v;
    prepare();
  };
  force.strength = ((fn?: (n: N) => number) => {
    if (fn === undefined) return strengthFn;
    strengthFn = fn;
    if (nodes.length) prepare();
    return force;
  }) as FieldForce<N>['strength'];
  force.parent = (fn) => {
    parentFn = fn;
    if (nodes.length) prepare();
    return force;
  };
  force.theta = (t) => {
    theta2 = t * t;
    return force;
  };
  force.distanceMax = ((d?: number) => {
    if (d === undefined) return distMax;
    distMax = d;
    distMax2 = d * d;
    return force;
  }) as FieldForce<N>['distanceMax'];
  force.sources = () => sources;
  return force;
}

/**
 * The near field of the dust: the light nodes of one parent repel each other pair by pair, each with its own
 * strength (as forceManyBody would, with no approximation). Groups are small (the largest form has ~140), so the
 * cost is the sum of their squares, a few tens of thousands of pairs for the whole field.
 */
export interface ClusterForce<N extends FieldBody> {
  (alpha: number): void;
  initialize(nodes: N[], random?: () => number): void;
  strength(fn: (n: N) => number): ClusterForce<N>;
  /** the group a light node belongs to (its parent), or null when it is a source of the field */
  group(fn: (n: N) => N | null): ClusterForce<N>;
  distanceMax(d: number): ClusterForce<N>;
}

export function forceCluster<N extends FieldBody>(): ClusterForce<N> {
  let nodes: N[] = [];
  let groups: N[][] = [];
  let str = new Float64Array(0);
  let strengthFn: (n: N) => number = () => -13;
  let groupFn: (n: N) => N | null = () => null;
  let distMax2 = Infinity;
  const distMin2 = 1;

  const prepare = () => {
    let max = 0;
    for (const v of nodes) max = Math.max(max, (v.index ?? 0) + 1);
    str = new Float64Array(max);
    const inSet = new Set<N>(nodes);
    const by = new Map<N, N[]>();
    for (const v of nodes) {
      str[v.index!] = +strengthFn(v) || 0;
      const p = groupFn(v);
      if (!p || p === v || !inSet.has(p) || groupFn(p) !== null) continue;
      let g = by.get(p);
      if (!g) by.set(p, (g = []));
      g.push(v);
    }
    groups = [...by.values()].filter((g) => g.length > 1);
  };

  const force = ((alpha: number) => {
    for (const g of groups) {
      const n = g.length;
      for (let i = 0; i < n; i++) {
        const a = g[i];
        for (let j = i + 1; j < n; j++) {
          const b = g[j];
          let x = b.x - a.x;
          let y = b.y - a.y;
          let l = x * x + y * y;
          if (l >= distMax2) continue;
          if (x === 0) { x = nudge(a.index! + j); l += x * x; }
          if (y === 0) { y = nudge(a.index! + j + 3); l += y * y; }
          if (l < distMin2) l = Math.sqrt(distMin2 * l);
          // a is pushed by b's strength, b by a's: the same law as the field, each way
          const wa = (str[b.index!] * alpha) / l;
          const wb = (str[a.index!] * alpha) / l;
          a.vx += x * wa;
          a.vy += y * wa;
          b.vx -= x * wb;
          b.vy -= y * wb;
        }
      }
    }
  }) as ClusterForce<N>;
  force.initialize = (ns: N[]) => {
    nodes = ns;
    prepare();
  };
  force.strength = (fn) => {
    strengthFn = fn;
    if (nodes.length) prepare();
    return force;
  };
  force.group = (fn) => {
    groupFn = fn;
    if (nodes.length) prepare();
    return force;
  };
  force.distanceMax = (d) => {
    distMax2 = d * d;
    return force;
  };
  return force;
}
