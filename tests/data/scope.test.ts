import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, type Model } from '../../src/data/model';
import { SCOPE_LEVEL, scopeOf } from '../../src/data/scope';
import type { Field } from '../../src/types/field';

// G2, characterisation: `scopeOf` is the primitive every mode ranks the globe's presences with (src/data/scope.ts).
// Own presences full, the same family's and the parallels' one hop away dimmed, the rest set aside, and a presence
// with no place left at 1 (it is not drawn on the globe).

/** The few fields scopeOf reads, as a Model: 7 occurrences over two families; #1 and #5 have no place; #0 parallels #6. */
function tiny(): Model {
  const occ = [
    { familyId: 'serpent', parallelIds: ['o6'] },
    { familyId: 'serpent', parallelIds: [] },
    { familyId: 'serpent', parallelIds: [] },
    { familyId: 'bird', parallelIds: [] },
    { familyId: 'bird', parallelIds: [] },
    { familyId: 'bird', parallelIds: [] },
    { familyId: 'tree', parallelIds: [] },
  ];
  const located = [true, false, true, true, true, false, true];
  const famOcc = new Map<string, number[]>([['serpent', [0, 1, 2]], ['bird', [3, 4, 5]], ['tree', [6]]]);
  const occIndex = new Map(occ.map((_, i) => [`o${i}`, i]));
  return { occ, located, famOcc, occIndex } as unknown as Model;
}

describe('scopeOf', () => {
  it('lifts the mode\'s own, dims the same family and the parallels, and sets the rest aside', () => {
    const { rel, info } = scopeOf(tiny(), [0], 'a walk');
    expect(rel[0]).toBe(SCOPE_LEVEL.own);
    expect(rel[2]).toBeCloseTo(SCOPE_LEVEL.nearby, 6); // same family, placed
    expect(rel[6]).toBeCloseTo(SCOPE_LEVEL.nearby, 6); // a parallel of #0, a different family
    expect(rel[3]).toBe(SCOPE_LEVEL.aside);
    expect(rel[4]).toBe(SCOPE_LEVEL.aside);
    expect(info).toEqual({ label: 'a walk', own: 1, nearby: 2 });
  });

  it('leaves a presence with no place at 1 whatever its rank, and counts only the placed', () => {
    const { rel, info } = scopeOf(tiny(), [1, 2], 'x');
    expect(rel[1]).toBe(1); // own, but unplaced
    expect(rel[5]).toBe(1); // aside, unplaced
    expect(rel[2]).toBe(SCOPE_LEVEL.own);
    expect(info.own).toBe(1);
    // #0 shares the serpent family with the own set: nearby; the unplaced #1 is own, so not counted nearby
    expect(rel[0]).toBeCloseTo(SCOPE_LEVEL.nearby, 6);
    expect(info.nearby).toBe(1);
  });

  it('takes a custom level, and lifts the selected presence above the rest', () => {
    const { rel } = scopeOf(tiny(), [0, 2], 'x', { level: 1, selected: 2 });
    expect(rel[0]).toBe(1);
    expect(rel[2]).toBeCloseTo(2.4, 6);
    expect(scopeOf(tiny(), [0], 'x', { selected: -1 }).rel[0]).toBe(SCOPE_LEVEL.own);
  });

  it('draws no nearby ring when nearby is off', () => {
    const { rel, info } = scopeOf(tiny(), [0], 'x', { nearby: false });
    expect(rel[2]).toBe(SCOPE_LEVEL.aside);
    expect(rel[6]).toBe(SCOPE_LEVEL.aside);
    expect(info.nearby).toBe(0);
  });

  it('accepts any iterable and counts a repeated index once', () => {
    const { info } = scopeOf(tiny(), new Set([0, 0, 3]), 'x');
    expect(info.own).toBe(2);
    expect(scopeOf(tiny(), (function* () { yield 0; yield 0; })(), 'x').info.own).toBe(1);
  });

  it('an empty set sets every placed presence aside', () => {
    const { rel, info } = scopeOf(tiny(), [], 'none');
    expect(Array.from(rel)).toEqual([0, 1, 0, 0, 0, 1, 0]);
    expect(info).toEqual({ label: 'none', own: 0, nearby: 0 });
  });

  it('keeps the emphasis levels the engine reads: above 1 lifts, below 0.035 is not drawn', () => {
    expect(SCOPE_LEVEL.own).toBeGreaterThan(1);
    expect(SCOPE_LEVEL.nearby).toBeGreaterThan(0.035);
    expect(SCOPE_LEVEL.nearby).toBeLessThan(1);
    expect(SCOPE_LEVEL.aside).toBeLessThan(0.035);
  });
});

describe('scopeOf over the real field', () => {
  const field = JSON.parse(readFileSync(new URL('../../public/data/field.json', import.meta.url), 'utf8')) as Field;
  const m = buildModel(field);

  it('a family\'s own members are full, every other placed presence is nearby or set aside, and the counts agree with the array', () => {
    const fam = 'serpent';
    const own = m.famOcc.get(fam)!;
    const { rel, info } = scopeOf(m, own, 'Serpent');
    expect(rel).toBeInstanceOf(Float32Array);
    expect(rel.length).toBe(m.occ.length);
    const NEAR = Math.fround(SCOPE_LEVEL.nearby);
    let full = 0, near = 0;
    for (let i = 0; i < rel.length; i++) {
      if (!m.located[i]) { expect(rel[i]).toBe(1); continue; }
      if (rel[i] === Math.fround(SCOPE_LEVEL.own)) full++;
      else if (rel[i] === NEAR) near++;
      else expect(rel[i]).toBe(SCOPE_LEVEL.aside);
    }
    expect(full).toBe(info.own);
    expect(near).toBe(info.nearby);
    expect(info.own).toBe(own.filter((i) => m.located[i]).length);
    // the family's own members are never counted among the nearby ones
    for (const i of own) if (m.located[i]) expect(rel[i]).toBe(Math.fround(SCOPE_LEVEL.own));
    // a scope that is not the whole field leaves most of the placed field set aside
    expect(info.own + info.nearby).toBeLessThan(m.located.filter(Boolean).length);
  });
});
