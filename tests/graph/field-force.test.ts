import { describe, expect, it } from 'vitest';
import { forceManyBody } from 'd3-force';
import { CLUSTER_PAIRWISE_MAX, forceCluster, forceField } from '../../src/graph/field-force';

interface N { x: number; y: number; vx: number; vy: number; index: number; kind: 'form' | 'dust'; parent: N | null; s: number }

/** A small field: forms on a loose grid, each with a few occurrences of dust a few units away. */
function field(forms = 30, dustEach = 6): N[] {
  const out: N[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < forms; i++) {
    const f: N = { x: (i % 6) * 140 + rnd() * 30, y: Math.floor(i / 6) * 140 + rnd() * 30, vx: 0, vy: 0, index: out.length, kind: 'form', parent: null, s: -(120 + rnd() * 200) };
    out.push(f);
    for (let j = 0; j < dustEach; j++) {
      const a = rnd() * Math.PI * 2;
      out.push({ x: f.x + Math.cos(a) * (12 + rnd() * 10), y: f.y + Math.sin(a) * (12 + rnd() * 10), vx: 0, vy: 0, index: out.length, kind: 'dust', parent: f, s: -13 });
    }
  }
  return out;
}

const clone = (ns: N[]) => {
  const c = ns.map((n) => ({ ...n }));
  for (const n of c) n.parent = n.parent ? c[n.parent.index] : null;
  return c;
};

describe('the field force', () => {
  it('is exactly d3’s many-body force when every node is a source', () => {
    const a = field(20, 0);
    const b = clone(a);
    const d3 = forceManyBody<N>().strength((n) => n.s).theta(0.95).distanceMax(780);
    d3.initialize(a, () => 0.5);
    d3(0.4);
    const mine = forceField<N>().strength((n) => n.s).theta(0.95).distanceMax(780);
    mine.initialize(b);
    mine(0.4);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].vx).toBeCloseTo(a[i].vx, 9);
      expect(b[i].vy).toBeCloseTo(a[i].vy, 9);
    }
  });

  it('keeps the far field the whole set made: every form is pushed by the other forms and all their dust as before', () => {
    const ns = field(30, 6);
    // the exact push, pair by pair, of every node on a form except the form's own dust (that is part of the form)
    const exact = ns.filter((n) => n.kind === 'form').map((f) => {
      let vx = 0;
      let vy = 0;
      for (const o of ns) {
        if (o === f || o.parent === f) continue;
        const x = o.x - f.x;
        const y = o.y - f.y;
        const l = x * x + y * y;
        vx += (x * o.s * 0.3) / l;
        vy += (y * o.s * 0.3) / l;
      }
      return { f, vx, vy };
    });
    const mine = forceField<N>().strength((n) => n.s).parent((n) => n.parent).theta(0.3);
    mine.initialize(ns);
    mine(0.3);
    expect(mine.sources().length).toBe(30);
    // each cluster's dust is carried at its form: within a few per cent of the exact push, form by form
    let worst = 0;
    for (const e of exact) worst = Math.max(worst, Math.hypot(e.f.vx - e.vx, e.f.vy - e.vy) / Math.hypot(e.vx, e.vy));
    expect(worst).toBeLessThan(0.05);
  });

  it('moves an occurrence with its form in the field, and pushes it off the form by the form’s own strength', () => {
    const ns = field(4, 2);
    const mine = forceField<N>().strength((n) => n.s).parent((n) => n.parent).theta(0.9);
    mine.initialize(ns);
    mine(0.5);
    for (const d of ns) {
      if (d.kind !== 'dust') continue;
      const f = d.parent!;
      const x = f.x - d.x;
      const y = f.y - d.y;
      const l = x * x + y * y;
      expect(d.vx).toBeCloseTo(f.vx + (x * f.s * 0.5) / l, 9);
      expect(d.vy).toBeCloseTo(f.vy + (y * f.s * 0.5) / l, 9);
    }
  });

  it('treats an occurrence whose form is not on stage as a source of its own', () => {
    const ns = field(3, 2);
    const orphan = ns.find((n) => n.kind === 'dust')!;
    const stage = ns.filter((n) => n !== orphan.parent);
    stage.forEach((n, i) => { n.index = i; });
    const mine = forceField<N>().strength((n) => n.s).parent((n) => n.parent);
    mine.initialize(stage);
    expect(mine.sources()).toContain(orphan);
  });
});

describe('the cluster force', () => {
  it('repels the occurrences of one form pair by pair, each with its own strength, and leaves other forms’ alone', () => {
    const ns = field(2, 3);
    const c = forceCluster<N>().strength((n) => n.s).group((n) => n.parent);
    c.initialize(ns);
    c(0.5);
    for (const a of ns) {
      if (a.kind !== 'dust') { expect(a.vx).toBe(0); continue; }
      let vx = 0;
      for (const b of ns) {
        if (b === a || b.kind !== 'dust' || b.parent !== a.parent) continue;
        const x = b.x - a.x;
        const y = b.y - a.y;
        vx += (x * b.s * 0.5) / (x * x + y * y);
      }
      expect(a.vx).toBeCloseTo(vx, 9);
    }
  });
});

/** One form and its dust laid on a sunflower spiral: `count` occurrences within `spread` of the form, none on another. */
function formOf(count: number, spread = 400): N[] {
  const form: N = { x: 0, y: 0, vx: 0, vy: 0, index: 0, kind: 'form', parent: null, s: -200 };
  const dust = Array.from({ length: count }, (_, i): N => {
    const a = i * 2.399963;
    const r = Math.sqrt((i + 0.5) / count) * spread;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, index: i + 1, kind: 'dust', parent: form, s: -13 };
  });
  return [form, ...dust];
}

/** The exact near field of one form's dust, pair by pair, at alpha 1. */
function exactPush(ns: N[]): [number, number][] {
  const v = ns.map((): [number, number] => [0, 0]);
  for (let i = 1; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const x = ns[j].x - ns[i].x;
      const y = ns[j].y - ns[i].y;
      const l = x * x + y * y;
      v[i][0] += (x * -13) / l; v[i][1] += (y * -13) / l;
      v[j][0] -= (x * -13) / l; v[j][1] -= (y * -13) / l;
    }
  }
  return v;
}

/** One tick's CPU time once warm: the median of five, the velocities put back each time. */
function warmTick(force: (alpha: number) => void, ns: N[]): number {
  const kept = ns.map((n) => [n.vx, n.vy]);
  const times: number[] = [];
  for (let k = 0; k < 7; k++) {
    const start = process.cpuUsage();
    force(1);
    const used = process.cpuUsage(start);
    times.push((used.user + used.system) / 1000);
  }
  ns.forEach((n, i) => { n.vx = kept[i][0]; n.vy = kept[i][1]; });
  return times.slice(2).sort((a, b) => a - b)[2];
}

// The near field's cost is the sum of each form's members squared: a form of a few thousand occurrences makes it the whole tick.
// Up to CLUSTER_PAIRWISE_MAX members a form's dust repels pair by pair, exactly; above that it is Barnes–Hut, a quadtree of the
// form's own members at the far field's theta, so a form's tick grows as n log n.
describe('the cluster force at scale', () => {
  it('repels a form of up to a thousand members pair by pair, exactly', () => {
    expect(CLUSTER_PAIRWISE_MAX).toBe(1000);
    const ns = formOf(1000);
    const c = forceCluster<N>().strength((n) => n.s).group((n) => n.parent);
    c.initialize(ns);
    c(1);
    const exact = exactPush(ns);
    for (let i = 1; i < ns.length; i++) {
      expect(ns[i].vx).toBeCloseTo(exact[i][0], 9);
      expect(ns[i].vy).toBeCloseTo(exact[i][1], 9);
    }
  });

  it('above a thousand members is Barnes–Hut: the same push within a few per cent, at a fraction of the pairs’ cost', () => {
    const ns = formOf(6000, 800);
    const c = forceCluster<N>().strength((n) => n.s).group((n) => n.parent).theta(0.95);
    c.initialize(ns);
    c(1);
    const exact = exactPush(ns);
    let err = 0;
    let norm = 0;
    for (let i = 1; i < ns.length; i++) {
      err += (ns[i].vx - exact[i][0]) ** 2 + (ns[i].vy - exact[i][1]) ** 2;
      norm += exact[i][0] ** 2 + exact[i][1] ** 2;
    }
    expect(Math.sqrt(err / norm)).toBeLessThan(0.05);
    const tree = warmTick(c, ns);
    const copy = formOf(6000, 800);
    const pairs = forceCluster<N>().strength((n) => n.s).group((n) => n.parent).pairwiseMax(Infinity);
    pairs.initialize(copy);
    expect(tree * 2.5).toBeLessThan(warmTick(pairs, copy));
  });

  it('takes the far field’s theta in the graph view', async () => {
    const { readFile } = await import('node:fs/promises');
    const view = await readFile(new URL('../../src/graph/view.ts', import.meta.url), 'utf8');
    expect(view).toMatch(/\.force\('charge', forceField<VNode>\(\)\.parent\(this\.parentOf\)\.strength\(fns\.charge\)\.theta\(FIELD_THETA\)\.distanceMax\(fns\.reach\)\)\n\s*\.force\('cluster', forceCluster<VNode>\(\)\.group\(this\.parentOf\)\.strength\(fns\.charge\)\.theta\(FIELD_THETA\)\.distanceMax\(fns\.reach\)\)/);
  });
});
