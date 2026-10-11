// The walk fabric reaches every node: a thread is thinned to one step per period, but every occurrence of its subject
// hangs off a step (the step's period-mates, and the unplaced attached by year), so none is cut off from its walk.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildModel } from '../../src/data/model';
import { planThread } from '../../src/data/thread';
import { scopeOf, SCOPE_LEVEL } from '../../src/data/scope';

const m = buildModel(JSON.parse(fs.readFileSync('public/data/field.json', 'utf8')));

describe('thread reach', () => {
  it('every occurrence of every family is a step of its thread or listed with one', () => {
    const missed: string[] = [];
    for (const f of m.field.families) {
      const all = m.famOcc.get(f.id) ?? [];
      if (!all.some((i) => m.located[i])) continue; // no placed instance: no thread (the label says so)
      const reached = new Set<number>();
      for (const s of planThread(m, 'family', f.id)) { reached.add(s.occ); for (const i of s.also) reached.add(i); }
      for (const i of all) if (!reached.has(i)) missed.push(`${f.id}: ${m.occ[i].id}`);
    }
    expect(missed).toEqual([]);
  });

  it('a step is never listed again among its own period-mates, and steps stay in time order', () => {
    const steps = planThread(m, 'family', 'serpent');
    expect(steps.length).toBeGreaterThan(10);
    for (const s of steps) expect(s.also).not.toContain(s.occ);
    for (let k = 1; k < steps.length; k++) expect(m.occ[steps[k].occ].year).toBeGreaterThanOrEqual(m.occ[steps[k - 1].occ].year);
  });
});

describe('a mode’s scope', () => {
  it('keeps the mode’s own, dims the nearby, and sets the rest aside', () => {
    const own = (m.famOcc.get('serpent') ?? []).slice(0, 5);
    const sc = scopeOf(m, own, 'test');
    for (const i of own) if (m.located[i]) expect(sc.rel[i]).toBe(SCOPE_LEVEL.own);
    // the rest of the serpent family is nearby
    const rest = (m.famOcc.get('serpent') ?? []).slice(5).filter((i) => m.located[i]);
    expect(rest.every((i) => sc.rel[i] === Math.fround(SCOPE_LEVEL.nearby))).toBe(true);
    // something far away is set aside
    const far = (m.famOcc.get('mandala') ?? []).find((i) => m.located[i] && !own.includes(i) && !m.occ[i].parallelIds.length && m.occ[i].familyId === 'mandala');
    if (far !== undefined) expect(sc.rel[far]).toBe(SCOPE_LEVEL.aside);
    expect(sc.info.own).toBe(own.filter((i) => m.located[i]).length);
    expect(sc.info.nearby).toBeGreaterThanOrEqual(rest.length);
  });
});
