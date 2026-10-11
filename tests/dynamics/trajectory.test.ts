import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, type Model, type Subject } from '../../src/data/model';
import {
  basinsOf, companions, eraSeries, ERA_BINS, HYSTERESIS, MIN_SIDE, seriesAt, smoothEra, spreadOf, sustainedCrossings, trajectoryOf, variesEnough,
  type EraBin, type Trajectory,
} from '../../src/dynamics/trajectory';
import type { Field } from '../../src/types/field';

const field = JSON.parse(readFileSync(new URL('../../public/data/field.json', import.meta.url), 'utf8')) as Field;
const model: Model = buildModel(field);
const SELF: Subject = { type: 'archetype', id: 'self' };
const SERPENT: Subject = { type: 'family', id: 'serpent' };
const arch = (id: string): Subject => ({ type: 'archetype', id });

/** The crossings the rule keeps on the published field: asserted so the rule cannot regress silently. */
const EXPECTED_CROSSINGS: Record<string, number> = {
  self: 0, hero: 0, shadow: 0, 'great-mother': 0, anima: 0, trickster: 0, psychopomp: 1,
};

/** A synthetic era series from (mean, count) pairs; null means an empty era. */
function series(parts: [number | null, number][]): EraBin[] {
  const k = parts.length;
  return parts.map(([mean, n], j) => ({ u0: j / k, u1: (j + 1) / k, mean, n }));
}
/** A trajectory-like object with one point per listed (u, s), for eraSeries. */
const pts = (list: [number, number][]) => ({ points: list.map(([u, s], i) => ({ i, year: i, u, s, familyId: 'f' })) });

describe('the trajectory of a subject through the field', () => {
  it('orders the Self by year, with s inside the published range', () => {
    const t = trajectoryOf(model, SELF);
    expect(t.points.length).toBeGreaterThan(100);
    for (let j = 1; j < t.points.length; j++) expect(t.points[j].year).toBeGreaterThanOrEqual(t.points[j - 1].year);
    for (const p of t.points) {
      expect(p.s).toBeGreaterThanOrEqual(0.12);
      expect(p.s).toBeLessThanOrEqual(0.88);
      expect(model.occ[p.i].geoPrecision).not.toBe('none');
      expect(p.u).toBeCloseTo(model.u[p.i], 6);
      expect(p.familyId).toBe(model.occ[p.i].familyId);
    }
  });

  it('gives a family a single level at its own spectrum position', () => {
    const t = trajectoryOf(model, SERPENT);
    expect(t.points.length).toBeGreaterThan(0);
    for (const p of t.points) expect(p.s).toBe(field.families.find((f) => f.id === 'serpent')!.spectrum.position);
    expect(variesEnough(eraSeries(t, ERA_BINS))).toBe(false);
    expect(sustainedCrossings(smoothEra(eraSeries(t, ERA_BINS)))).toEqual([]);
  });

  it('is deterministic', () => {
    expect(trajectoryOf(model, SELF)).toEqual(trajectoryOf(model, SELF));
  });
});

describe('the era series', () => {
  it('bins every occurrence of the span once, with the count-weighted mean s of each era', () => {
    const t = pts([[0, 0.2], [0.1, 0.4], [0.6, 0.6], [1, 0.8]]);
    const bins = eraSeries(t, 2);
    expect(bins.map((b) => b.n)).toEqual([2, 2]);
    expect(bins[0].mean).toBeCloseTo(0.3, 12);
    expect(bins[1].mean).toBeCloseTo(0.7, 12);
    expect(bins[0].u0).toBe(0);
    expect(bins[1].u1).toBe(1);
  });

  it('leaves an era with no occurrence empty (null), never filled', () => {
    const bins = eraSeries(pts([[0, 0.2], [1, 0.8]]), 4);
    expect(bins.map((b) => b.mean)).toEqual([0.2, null, null, 0.8]);
    expect(bins.map((b) => b.n)).toEqual([1, 0, 0, 1]);
  });

  it('counts only the occurrences inside a given span, and a zero-width span is one era', () => {
    const t = pts([[0.1, 0.3], [0.5, 0.5], [0.9, 0.7]]);
    const inside = eraSeries(t, 2, { fromU: 0.4, toU: 1 });
    expect(inside.reduce((n, b) => n + b.n, 0)).toBe(2);
    const one = eraSeries(pts([[0.5, 0.2], [0.5, 0.4]]), 40);
    expect(one).toHaveLength(1);
    expect(one[0].n).toBe(2);
    expect(one[0].mean).toBeCloseTo(0.3, 12);
  });

  it('bins the real Self into the published number of eras, every occurrence counted once', () => {
    const t = trajectoryOf(model, SELF);
    const bins = eraSeries(t, ERA_BINS);
    expect(bins).toHaveLength(ERA_BINS);
    expect(bins.reduce((n, b) => n + b.n, 0)).toBe(t.points.length);
    expect(eraSeries(t, ERA_BINS)).toEqual(bins);
  });
});

describe('smoothing keeps gaps as gaps', () => {
  it('smooths a non-empty era with its non-empty neighbours only', () => {
    const s = smoothEra(series([[0.2, 1], [null, 0], [0.8, 1], [0.8, 1]]));
    expect(s[1].mean).toBeNull();
    expect(s[0].mean).toBeCloseTo(0.2, 12);
    // era 2 has neighbours 1 (empty, ignored) and 3 (0.8): all 0.8
    expect(s[2].mean).toBeCloseTo(0.8, 12);
  });

  it('keeps the counts of the raw eras', () => {
    const raw = series([[0.3, 3], [0.6, 7]]);
    expect(smoothEra(raw).map((b) => b.n)).toEqual([3, 7]);
  });
});

describe('spread and the rule for drawing a trace', () => {
  it('a single level has no spread; a series that moves does', () => {
    expect(spreadOf(series([[0.4, 5], [0.4, 5], [0.4, 5]]))).toBe(0);
    expect(variesEnough(series([[0.4, 5], [0.4, 5], [0.4, 5]]))).toBe(false);
    expect(variesEnough(series([[0.3, 5], [0.7, 5]]))).toBe(true);
  });

  it('the real field: the Self and the Hero vary enough to be traced; the serpent does not', () => {
    expect(variesEnough(eraSeries(trajectoryOf(model, SELF), ERA_BINS))).toBe(true);
    expect(variesEnough(eraSeries(trajectoryOf(model, arch('hero')), ERA_BINS))).toBe(true);
    expect(variesEnough(eraSeries(trajectoryOf(model, SERPENT), ERA_BINS))).toBe(false);
  });

  it('a companion of a family subject is a single level: never drawn as a trace', () => {
    const t = trajectoryOf(model, SELF);
    const span = { fromU: t.points[0].u, toU: t.points[t.points.length - 1].u };
    const cs = companions(model, t, 3);
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) expect(variesEnough(eraSeries(c, ERA_BINS, span))).toBe(false);
  });
});

describe('sustained midpoint crossings', () => {
  it('the real field keeps the crossings the rule allows, and no more (the rule cannot regress silently)', () => {
    for (const [id, expected] of Object.entries(EXPECTED_CROSSINGS)) {
      const t = trajectoryOf(model, arch(id));
      const got = sustainedCrossings(smoothEra(eraSeries(t, ERA_BINS))).length;
      expect(got, id).toBe(expected);
    }
  });

  it('a single occurrence on one side is not a crossing, however far it reaches', () => {
    // one high occurrence between two long low runs: the excursion is rejected
    const s = series([[0.3, 10], [0.9, 1], [0.3, 10]]);
    expect(sustainedCrossings(s)).toEqual([]);
  });

  it('a sustained step with at least MIN_SIDE occurrences on each side is one crossing, placed between the runs', () => {
    const s = series([[0.3, MIN_SIDE], [0.3, MIN_SIDE], [0.7, MIN_SIDE], [0.7, MIN_SIDE]]);
    const c = sustainedCrossings(s);
    expect(c).toHaveLength(1);
    expect(c[0].before).toBe(2 * MIN_SIDE);
    expect(c[0].after).toBe(2 * MIN_SIDE);
    expect(c[0].u).toBeCloseTo(0.5, 12);
  });

  it('one side short of MIN_SIDE is refused, even when the other side is long', () => {
    expect(sustainedCrossings(series([[0.3, 20], [0.7, MIN_SIDE - 1]]))).toEqual([]);
    expect(sustainedCrossings(series([[0.3, MIN_SIDE - 1], [0.7, 20]]))).toEqual([]);
  });

  it('a series that hovers inside the hysteresis band never crosses', () => {
    const band = 0.5 + HYSTERESIS / 2;
    expect(sustainedCrossings(series([[band, 10], [0.5 - HYSTERESIS / 2, 10], [band, 10], [0.5 - HYSTERESIS / 2, 10]]))).toEqual([]);
  });

  it('a side is entered only past the hysteresis: a value just inside the band does not switch it', () => {
    const just = 0.5 + HYSTERESIS - 1e-6;
    expect(sustainedCrossings(series([[0.3, 10], [just, 10]]))).toEqual([]);
    expect(sustainedCrossings(series([[0.3, 10], [0.5 + HYSTERESIS + 1e-6, 10]]))).toHaveLength(1);
  });

  it('empty eras are skipped: a crossing is still read across a gap, and a gap is never a side', () => {
    const s = series([[0.3, 6], [null, 0], [null, 0], [0.7, 6]]);
    expect(sustainedCrossings(s)).toHaveLength(1);
  });
});

describe('the drawn value at a slider-position', () => {
  it('is null inside an empty era and before the first occurrence', () => {
    const s = series([[0.2, 1], [null, 0], [0.8, 1]]);
    expect(seriesAt(s, 0.5)).toBeNull();
    expect(seriesAt(s, -0.1)).toBeNull();
  });

  it('holds where the trajectory ended, after its last occurrence', () => {
    const s = series([[0.2, 1], [null, 0], [0.8, 1]]);
    expect(seriesAt(s, 1.1)).toBeCloseTo(0.8, 12);
    expect(seriesAt(s, 1.0)).toBeCloseTo(0.8, 12);
  });

  it('interpolates between the centres of adjacent non-empty eras', () => {
    const s = series([[0.2, 1], [0.6, 1]]);
    // centres 0.25 and 0.75; midway between them is 0.4
    expect(seriesAt(s, 0.5)).toBeCloseTo(0.4, 12);
    expect(seriesAt(s, 0.25)).toBeCloseTo(0.2, 12);
  });

  it('holds the value of an era whose neighbour is empty', () => {
    expect(seriesAt(series([[0.6, 1], [null, 0]]), 0.2)).toBeCloseTo(0.6, 12);
  });
});

describe('basins', () => {
  it('lists each visited family once, in order of first visit, with its span and mean s', () => {
    const t: Trajectory = trajectoryOf(model, SELF);
    const basins = basinsOf(t);
    const ids = basins.map((b) => b.familyId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(basins.reduce((n, b) => n + b.count, 0)).toBe(t.points.length);
    const firstSeen = t.points.map((p) => p.familyId).filter((f, i, all) => all.indexOf(f) === i);
    expect(ids).toEqual(firstSeen);
    for (const b of basins) {
      expect(b.from).toBeLessThanOrEqual(b.to);
      expect(b.meanS).toBeGreaterThanOrEqual(0.12);
      expect(b.meanS).toBeLessThanOrEqual(0.88);
    }
  });
});

describe('companions (correlated trajectories through the parallels)', () => {
  it('returns at most three, ranked by links, none of them the subject', () => {
    const t = trajectoryOf(model, SELF);
    const cs = companions(model, t, 3);
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.length).toBeLessThanOrEqual(3);
    for (let k = 1; k < cs.length; k++) expect(cs[k - 1].links).toBeGreaterThanOrEqual(cs[k].links);
    const own = new Set(t.points.map((p) => p.i));
    for (const c of cs) {
      expect(c.links).toBeGreaterThan(0);
      expect(c.subject.type).toBe('family');
      for (const p of c.points) expect(own.has(p.i)).toBe(false);
      for (let j = 1; j < c.points.length; j++) expect(c.points[j].year).toBeGreaterThanOrEqual(c.points[j - 1].year);
    }
  });

  it('never returns the subject family itself for a family subject', () => {
    const cs = companions(model, trajectoryOf(model, SERPENT), 3);
    for (const c of cs) expect(c.subject.id).not.toBe('serpent');
  });
});
