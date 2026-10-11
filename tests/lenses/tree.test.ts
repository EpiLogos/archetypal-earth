// The Tree of Life's tables (src/lenses/tree.ts): ten sephiroth in the standard layout, twenty-two paths numbered 11–32 in
// the traditional order, every path joining two sephiroth. The vitest run is node-only (no DOM), so the figure builder is
// not rendered here; its data is.
import { describe, expect, it } from 'vitest';
import { NUMBER_ARCHETYPES } from '../../src/lenses/deep-fields';
import { TREE_NODES, TREE_PATHS, TREE_VIEW } from '../../src/lenses/tree';

const byId = new Map(TREE_NODES.map((n) => [n.id, n]));

describe('the sephiroth', () => {
  it('are ten, each with a unique id and name', () => {
    expect(TREE_NODES).toHaveLength(10);
    expect(new Set(TREE_NODES.map((n) => n.id)).size).toBe(10);
    expect(new Set(TREE_NODES.map((n) => n.name)).size).toBe(10);
  });

  it('carry the numbers one to ten, each once', () => {
    expect(TREE_NODES.map((n) => n.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('sit inside the figure frame', () => {
    for (const n of TREE_NODES) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(TREE_VIEW.width);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(TREE_VIEW.height);
    }
  });

  it('stand on three pillars: the middle pillar at one x, the others either side of it', () => {
    const mid = byId.get('kether')!.x;
    for (const id of ['kether', 'tiphareth', 'yesod', 'malkuth'] as const) expect(byId.get(id)!.x).toBe(mid);
    for (const id of ['chokmah', 'chesed', 'netzach'] as const) expect(byId.get(id)!.x).toBeGreaterThan(mid);
    for (const id of ['binah', 'geburah', 'hod'] as const) expect(byId.get(id)!.x).toBeLessThan(mid);
  });

  it('keep the middle pillar from the top down: Kether, Tiphareth, Yesod, Malkuth', () => {
    const ys = ['kether', 'tiphareth', 'yesod', 'malkuth'].map((id) => byId.get(id as 'kether')!.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('are listed in the standard order, numbered as they are listed', () => {
    const order = ['kether', 'chokmah', 'binah', 'chesed', 'geburah', 'tiphareth', 'netzach', 'hod', 'yesod', 'malkuth'];
    expect(TREE_NODES.map((n) => n.id)).toEqual(order);
    expect(TREE_NODES.map((n) => n.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('the paths', () => {
  it('are twenty-two, numbered 11 to 32 contiguously in order', () => {
    expect(TREE_PATHS).toHaveLength(22);
    expect(TREE_PATHS.map((p) => p.n)).toEqual(Array.from({ length: 22 }, (_, i) => 11 + i));
  });

  it('join the pairs of the standard order', () => {
    const expected: Array<[number, string, string]> = [
      [11, 'kether', 'chokmah'], [12, 'kether', 'binah'], [13, 'kether', 'tiphareth'], [14, 'chokmah', 'binah'],
      [15, 'chokmah', 'tiphareth'], [16, 'chokmah', 'chesed'], [17, 'binah', 'tiphareth'], [18, 'binah', 'geburah'],
      [19, 'chesed', 'geburah'], [20, 'chesed', 'tiphareth'], [21, 'chesed', 'netzach'], [22, 'geburah', 'tiphareth'],
      [23, 'geburah', 'hod'], [24, 'tiphareth', 'netzach'], [25, 'tiphareth', 'yesod'], [26, 'tiphareth', 'hod'],
      [27, 'netzach', 'hod'], [28, 'netzach', 'yesod'], [29, 'netzach', 'malkuth'], [30, 'hod', 'yesod'],
      [31, 'hod', 'malkuth'], [32, 'yesod', 'malkuth'],
    ];
    expect(TREE_PATHS.map((p) => [p.n, p.from, p.to])).toEqual(expected);
  });

  it('have both ends at sephiroth, never a loop, and no pair twice', () => {
    const seen = new Set<string>();
    for (const p of TREE_PATHS) {
      expect(byId.has(p.from)).toBe(true);
      expect(byId.has(p.to)).toBe(true);
      expect(p.from).not.toBe(p.to);
      const key = [p.from, p.to].sort().join('|');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('the number archetypes past six', () => {
  it('include seven to ten, so a focus on one opens its page', () => {
    for (const id of ['seven', 'eight', 'nine', 'ten']) expect(NUMBER_ARCHETYPES.has(id)).toBe(true);
    for (const id of ['one', 'two', 'three', 'four', 'five', 'six']) expect(NUMBER_ARCHETYPES.has(id)).toBe(true);
  });
});
