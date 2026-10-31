// S8: a thread for a theoretic and for a text. planThread takes the two subjects by data alone: the same located members,
// year order and thinning as the family and archetype threads. (A theoretic's walk is another thing: the quotations of its page,
// held in tests/lenses/theoretic-walks.test.ts.)
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildModel } from '../../src/data/model';
import { planThread, threadOccurrences, THREAD_MAX } from '../../src/data/thread';
import type { Field } from '../../src/types/field';
import type { WorksData } from '../../src/types/works';
import type { WalksData } from '../../src/types/walks';

const ROOT = path.resolve(__dirname, '..', '..');
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const field = json('public/data/field.json') as Field;
const works = json('public/data/works.json') as WorksData;
const walks = json('public/data/walks.json') as WalksData;
const m = buildModel(field, undefined, undefined, { works, walks });

describe('planThread for a theoretic', () => {
  it('aion-time is 22 stops, each a located member of the theoretic, in year order', () => {
    const steps = planThread(m, 'theoretic', 'aion-time');
    expect(steps).toHaveLength(22);
    for (const s of steps) expect(m.located[s.occ]).toBe(1);
    for (let k = 1; k < steps.length; k++) expect(m.occ[steps[k].occ].year).toBeGreaterThanOrEqual(m.occ[steps[k - 1].occ].year);
  });

  it('is capped as a family thread is, and every step is a member of the theoretic', () => {
    for (const t of field.theoretics) {
      const steps = planThread(m, 'theoretic', t.id);
      expect(steps.length, t.id).toBeLessThanOrEqual(THREAD_MAX);
      const members = new Set(m.theoMem.get(t.id) ?? []);
      for (const s of steps) { expect(members.has(s.occ), t.id).toBe(true); for (const j of s.also) expect(members.has(j), t.id).toBe(true); }
    }
    expect(threadOccurrences(m, 'theoretic', 'aion-time')).toHaveLength(22);
  });
});

describe('planThread for a text', () => {
  it('a text thread has at least 2 stops, located members of the Work in year order', () => {
    const steps = planThread(m, 'work', 'cw12');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.length).toBeLessThanOrEqual(THREAD_MAX);
    const members = new Set(m.workMem.get('cw12') ?? []);
    for (const s of steps) { expect(members.has(s.occ)).toBe(true); expect(m.located[s.occ]).toBe(1); }
    for (let k = 1; k < steps.length; k++) expect(m.occ[steps[k].occ].year).toBeGreaterThanOrEqual(m.occ[steps[k - 1].occ].year);
  });

  it('folds the alias: the thread of "redbook" is the thread of Liber Novus', () => {
    expect(planThread(m, 'work', 'redbook').map((s) => s.occ)).toEqual(planThread(m, 'work', 'liber-novus').map((s) => s.occ));
    expect(planThread(m, 'work', 'liber-novus').length).toBeGreaterThanOrEqual(2);
  });

  it('every thread reaches every located-or-not member of the Work (steps plus the ones they carry)', () => {
    for (const w of works.works) {
      const members = m.workMem.get(w.id) ?? [];
      const reached = new Set<number>();
      for (const s of planThread(m, 'work', w.id)) { reached.add(s.occ); for (const j of s.also) reached.add(j); }
      const anyLocated = members.some((i) => m.located[i]);
      if (anyLocated) expect([...reached].sort((a, b) => a - b), w.id).toEqual([...members].sort((a, b) => a - b));
      else expect(reached.size, w.id).toBe(0);
    }
  });

  it('a Work no cite names has no thread', () => {
    expect(planThread(m, 'work', 'a-blue-fire')).toEqual([]);
    expect(planThread(m, 'work', 'no-such-work')).toEqual([]);
  });
});
