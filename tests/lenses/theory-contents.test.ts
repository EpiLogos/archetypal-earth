// H5 + N14, Theory: the Contents of the mode lists the theory route, the fourteen theoretics and the route; the theoretics are one
// walk of fourteen stops in the field's own order.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { routeStops, theoreticsWalk, theoryContentsGroups } from '../../src/lenses/theory-contents';
import { WalkRunner } from '../../src/walk/runner';
import { createTimeScale } from '../../src/data/time';
import type { Field } from '../../src/types/field';
import type { DynamicsRoute } from '../../src/types/dynamics';

const ROOT = path.resolve(__dirname, '..', '..');
const json = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8')) as T;
const field = json<Field>('field.json');
const route = json<DynamicsRoute>('dynamics-route.json');
const SECTIONS = [{ id: 'self', name: 'The Self' }, { id: 'number', name: 'Number' }];
const go = () => ({ section: vi.fn(), theoretic: vi.fn(), overview: vi.fn(), stop: vi.fn() });

describe('the fourteen theoretics are one walk (N14)', () => {
  const w = theoreticsWalk({ field });

  it('has fourteen stops, one for each theoretic the field carries, in the field\'s order', () => {
    expect(w.stops).toHaveLength(14);
    expect(w.stops.map((s) => s.subject!.id)).toEqual(field.theoretics.map((t) => t.id));
    expect(new Set(w.stops.map((s) => s.subject!.id)).size).toBe(14);
    expect(w.kind).toBe('theoretic');
  });

  it('leaves the clock and the camera alone, and the runner wraps past the last to the first', () => {
    const run = new WalkRunner({ scale: createTimeScale(1900, 2030), wrap: true });
    const first = run.start(w, { u: 0, focus: null, reading: null, centre: null, walk: null }, 13)!;
    expect(first.effects.setClock).toBeNull();
    expect(first.effects.flyTo).toBeNull();
    expect(run.next()!.stop.subject!.id).toBe(field.theoretics[0].id);
    expect(run.prev()!.stop.subject!.id).toBe(field.theoretics[13].id);
  });
});

describe('the Theory Contents', () => {
  const input = (at: Parameters<typeof theoryContentsGroups>[0]['at'], withRoute = true) => ({
    model: { field }, theoryTitle: 'The theory', sections: SECTIONS, route: withRoute ? route : null, stopName: (s: { id: string }) => s.id, at, go: go(),
  });

  it('lists the theory route, the fourteen theoretics, then the route by movement: sixteen stops in four movements', () => {
    const groups = theoryContentsGroups(input({ kind: 'none' }));
    expect(groups.map((g) => g.title)).toEqual(['The theory', 'The fourteen theoretics', 'Dynamics', ...route.movements.map((m) => `${m.n} · ${m.title}`)]);
    expect(groups[0].items.map((i) => i.label)).toEqual(['The Self', 'Number']);
    expect(groups[1].items).toHaveLength(14);
    expect(groups.slice(3).flatMap((g) => g.items.map((i) => i.label))).toEqual(routeStops(route).map((r) => r.stop.id));
  });

  it('opens with the families the standing stop passes through, each going to its family; none, no group', () => {
    const family = vi.fn();
    const a = { ...input({ kind: 'none' }), families: [{ id: 'serpent', name: 'Serpent' }, { id: 'tree', name: 'Tree' }], go: { ...go(), family } };
    const groups = theoryContentsGroups(a);
    expect(groups[0].title).toBe('Families it passes through');
    expect(groups[0].items.map((i) => i.label)).toEqual(['Serpent', 'Tree']);
    groups[0].items[1].onPick!();
    expect(family).toHaveBeenCalledWith('tree');
    expect(theoryContentsGroups({ ...a, families: [] })[0].title).toBe('The theory');
  });

  it('marks the one the visitor stands on, and only that one', () => {
    const marked = (at: Parameters<typeof input>[0]) => theoryContentsGroups(input(at)).flatMap((g) => g.items).filter((i) => i.current).map((i) => i.label);
    expect(marked({ kind: 'theoretic', id: 'psychoid' })).toEqual(['The Psychoid']);
    expect(marked({ kind: 'stop', id: 'ql-cycle' })).toEqual(['ql-cycle']);
    expect(marked({ kind: 'section', id: 'number' })).toEqual(['Number']);
    expect(marked({ kind: 'overview' })).toEqual([route.title]);
    expect(marked({ kind: 'none' })).toEqual([]);
  });

  it('an entry goes where it names; without the route the list is the theory route and the theoretics', () => {
    const a = input({ kind: 'none' });
    const groups = theoryContentsGroups(a);
    groups[1].items[1].onPick!();
    expect(a.go.theoretic).toHaveBeenCalledWith(field.theoretics[1].id);
    groups[3].items[0].onPick!();
    expect(a.go.stop).toHaveBeenCalledWith(route.movements[0].stops[0].id);
    expect(theoryContentsGroups(input({ kind: 'none' }, false)).map((g) => g.title)).toEqual(['The theory', 'The fourteen theoretics']);
  });
});
