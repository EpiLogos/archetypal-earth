import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, type Model, type Subject } from '../../src/data/model';
import { basinsOf, companions, downsample, sAt, trajectoryOf, transitions, TRANSITION_JUMP, MIDPOINT } from '../../src/dynamics/trajectory';
import type { Field } from '../../src/types/field';

const field = JSON.parse(readFileSync(new URL('../../public/data/field.json', import.meta.url), 'utf8')) as Field;
const model: Model = buildModel(field);
const SELF: Subject = { type: 'archetype', id: 'self' };
const SERPENT: Subject = { type: 'family', id: 'serpent' };

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

  it('gives a family a flat trajectory at its own spectrum position', () => {
    const t = trajectoryOf(model, SERPENT);
    expect(t.points.length).toBeGreaterThan(0);
    for (const p of t.points) expect(p.s).toBe(field.families.find((f) => f.id === 'serpent')!.spectrum.position);
    expect(transitions(t)).toEqual([]);
  });

  it('is deterministic', () => {
    expect(trajectoryOf(model, SELF)).toEqual(trajectoryOf(model, SELF));
  });
});

describe('transitions (the midpoint crossings with a large jump)', () => {
  it('are a subset of consecutive pairs that really cross the midpoint by the jump size', () => {
    const t = trajectoryOf(model, SELF);
    const js = transitions(t);
    expect(js.length).toBeGreaterThan(0);
    for (const j of js) {
      expect(j).toBeGreaterThan(0);
      expect(j).toBeLessThan(t.points.length);
      const a = t.points[j - 1].s, b = t.points[j].s;
      expect((a >= MIDPOINT) !== (b >= MIDPOINT)).toBe(true);
      expect(Math.abs(b - a)).toBeGreaterThanOrEqual(TRANSITION_JUMP);
    }
    expect(js).toEqual([...js].sort((x, y) => x - y));
  });

  it('finds every qualifying pair (none missed)', () => {
    const t = trajectoryOf(model, SELF);
    const brute: number[] = [];
    for (let j = 1; j < t.points.length; j++) {
      const a = t.points[j - 1].s, b = t.points[j].s;
      if ((a >= MIDPOINT) !== (b >= MIDPOINT) && Math.abs(b - a) >= TRANSITION_JUMP) brute.push(j);
    }
    expect(transitions(t)).toEqual(brute);
  });
});

describe('basins', () => {
  it('lists each visited family once, in order of first visit, with its span and mean s', () => {
    const t = trajectoryOf(model, SELF);
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

describe('downsample and interpolation', () => {
  it('keeps the endpoints, the requested count, and is deterministic', () => {
    const t = trajectoryOf(model, SELF);
    const d = downsample(t, 50);
    expect(d.points.length).toBe(50);
    expect(d.points[0]).toEqual(t.points[0]);
    expect(d.points[49]).toEqual(t.points[t.points.length - 1]);
    expect(downsample(t, 50)).toEqual(d);
  });

  it('returns a short trajectory unchanged', () => {
    const t = trajectoryOf(model, SERPENT);
    const small = { subject: t.subject, points: t.points.slice(0, 5) };
    expect(downsample(small, 10)).toBe(small);
  });

  it('interpolates s on the shared scale and holds at the ends', () => {
    const pts = trajectoryOf(model, SELF).points;
    expect(sAt(pts, pts[0].u - 0.001)).toBeNull();
    expect(sAt(pts, pts[0].u)).toBeCloseTo(pts[0].s, 9);
    expect(sAt(pts, pts[pts.length - 1].u + 0.5)).toBe(pts[pts.length - 1].s);
    // a pair with distinct positions (occurrences that share a year interpolate against the last of them)
    const k = pts.findIndex((p, j) => j > 0 && p.u > pts[j - 1].u);
    const mid = (pts[k - 1].u + pts[k].u) / 2;
    expect(sAt(pts, mid)).toBeCloseTo((pts[k - 1].s + pts[k].s) / 2, 9);
  });
});
