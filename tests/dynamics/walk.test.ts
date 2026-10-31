// H5 + S9, Theory: the route through Van Eenwyk is the one `theory-route` walk of public/data/walks.json, stepped by the Walk
// runner. The old walk was `stops[(i + delta + n) % n]` over dynamics-route.json (a stop id each); it goes only because the runner
// walks the same stops in the same order and wraps as the rail always did. This file is that parity, made from the raw data files.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { routeWalk } from '../../src/dynamics/walk';
import { WalkRunner } from '../../src/walk/runner';
import { createTimeScale } from '../../src/data/time';
import type { DynamicsRoute } from '../../src/types/dynamics';
import type { Walk, WalksData } from '../../src/types/walks';

const ROOT = path.resolve(__dirname, '..', '..');
const json = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8')) as T;
const route = json<DynamicsRoute>('dynamics-route.json');
const walks = new Map(json<WalksData>('walks.json').walks.map((w) => [w.id, w] as [string, Walk]));
const ids = route.movements.flatMap((m) => m.stops.map((s) => s.id));
const SNAP = { u: 0, focus: null, reading: null, centre: null, walk: null };
const scale = createTimeScale(1900, 2030);

describe('the dynamical route is the curated walk, on the runner', () => {
  it('walks.json holds the same sixteen stops in the same order as the route, and the view reads the shipped walk', () => {
    const raw = walks.get('theory-route')!;
    expect(raw.stops.map((s) => s.subject!.id)).toEqual(ids);
    expect(raw.stops).toHaveLength(16);
    expect(raw.ordered).toBe('curated');
    expect(routeWalk(walks, route)).toBe(raw);
  });

  it('no stop has a year or a place: walking the route leaves the clock and the camera where they are', () => {
    for (const s of routeWalk(walks, route).stops) { expect(s.year).toBeUndefined(); expect(s.place).toBeUndefined(); }
    const run = new WalkRunner({ scale, wrap: true });
    const first = run.start(routeWalk(walks, route), SNAP, 0)!;
    expect(first.effects.setClock).toBeNull();
    expect(first.effects.flyTo).toBeNull();
  });

  it('the runner steps as the old rail did: forward and back from every stop, wrapping past either end', () => {
    const w = routeWalk(walks, route);
    const n = ids.length;
    for (let at = 0; at < n; at++) {
      for (const delta of [1, -1]) {
        const run = new WalkRunner({ scale, wrap: true });
        run.start(w, SNAP, at);
        const step = delta > 0 ? run.next() : run.prev();
        // the rule the view used before the runner: stops[(i + delta + n) % n]
        expect(step!.stop.subject!.id).toBe(ids[(at + delta + n) % n]);
      }
    }
  });

  it('a walk file that has drifted from the route is not trusted: the walk is drawn from the route itself', () => {
    const raw = walks.get('theory-route')!;
    const drifted = new Map(walks);
    drifted.set('theory-route', { ...raw, stops: [...raw.stops].reverse() });
    const w = routeWalk(drifted, route);
    expect(w).not.toBe(raw);
    expect(w.stops.map((s) => s.subject!.id)).toEqual(ids);
    expect(routeWalk(new Map(), route).stops.map((s) => s.subject!.id)).toEqual(ids);
  });
});
