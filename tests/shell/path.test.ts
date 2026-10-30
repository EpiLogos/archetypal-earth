import { describe, expect, it } from 'vitest';
import { back, focusOn, manifest, WORLD, type AppState } from '../../src/state/store';
import { pathOf, stepsTo, upBy } from '../../src/shell/path';

const A = { type: 'archetype', id: 'anima' } as const;
const B = { type: 'family', id: 'serpent' } as const;
const C = { type: 'archetype', id: 'shadow' } as const;
const key = (s: AppState) => JSON.stringify(s.view);

describe('the Path: each crumb is the number of steps back that reaches it', () => {
  const deepRoute = focusOn(focusOn(focusOn(WORLD, A), B), C); // the Field › Anima › Serpent › Shadow

  it('names the drilled route nearest first and ends at the whole field', () => {
    const p = pathOf(deepRoute);
    expect(p.map((c) => (c.subject ? `${c.subject.type}:${c.subject.id}` : 'field'))).toEqual(['family:serpent', 'archetype:anima', 'field']);
    expect(p.map((c) => c.steps)).toEqual([1, 2, 3]);
  });

  it('a crumb is a way up: back applied its steps lands on that crumb, whichever one it is', () => {
    for (const c of pathOf(deepRoute)) {
      const at = upBy(deepRoute, c.steps);
      if (c.subject) expect(at.view).toMatchObject({ kind: 'focus', subject: c.subject });
      else expect(at.view.kind).toBe('world');
    }
  });

  it('upBy is back, step by step (the same act as dismissing that many times)', () => {
    let s = deepRoute;
    for (let i = 1; i <= 4; i++) {
      s = back(s);
      expect(key(upBy(deepRoute, i))).toBe(key(s));
    }
  });

  it('an open reading is one step on the way, not a place on the path', () => {
    const reading = { ...deepRoute, deep: true };
    const p = pathOf(reading);
    expect(p.map((c) => c.steps)).toEqual([2, 3, 4]);
    expect(upBy(reading, 1).deep).toBe(false);
    expect(upBy(reading, 1).view).toMatchObject({ kind: 'focus', subject: C });
  });

  it('reads the steps to a crumb when it is clicked, not when it was drawn: a reading opened since adds one', () => {
    const drawn = stepsTo(deepRoute, null);
    const later = { ...deepRoute, deep: true };
    expect(drawn).toBe(3);
    expect(stepsTo(later, null)).toBe(4);
    expect(stepsTo(later, A)).toBe(3);
    expect(stepsTo(deepRoute, { type: 'archetype', id: 'nowhere' })).toBeUndefined();
  });

  it('the Field itself has no way up', () => {
    expect(pathOf(WORLD)).toEqual([]);
  });

  it('a manifestation climbs to the subject it was opened under, then the field', () => {
    const m = manifest(focusOn(WORLD, A), 'occ-1', A);
    const p = pathOf(m);
    expect(p[0].subject).toMatchObject(A);
    expect(p[p.length - 1].subject).toBeNull();
  });
});
