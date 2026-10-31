// S9: the Walk runner core. Pure: it turns a walk's stops into the effects the controller executes, keeps {walkId, i}, and
// hands back the snapshot taken at start when a walk is interrupted. The data is public/data/walks.json as built.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTimeScale } from '../../src/data/time';
import { planStop, WalkRunner, type AppSnapshot } from '../../src/walk/runner';
import type { Walk, WalkStop, WalksData } from '../../src/types/walks';

const ROOT = path.resolve(__dirname, '..', '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/walks.json'), 'utf8')) as WalksData;
const walk = (id: string) => data.walks.find((w) => w.id === id)!;
const scale = createTimeScale(-10000, 2025);

const SNAP: AppSnapshot = { u: 0.42, focus: { type: 'archetype', id: 'self' }, reading: { work: 'cw09ii', page: 33 }, centre: { lat: 10, lon: 20 }, walk: null };
const stop = (over: Partial<WalkStop>): WalkStop => ({ subject: { type: 'occurrence', id: 'x' }, ...over });
const mini = (stops: WalkStop[], over: Partial<Walk> = {}): Walk => ({ id: 'mini', kind: 'theoretic', title: 'mini', source: 'test', ordered: 'curated', stops, ...over });

describe('a stop is a plan of effects', () => {
  it('a stop with no year leaves the clock alone', () => {
    expect(planStop(stop({ place: { lat: 1, lon: 2 } }), scale).setClock).toBeNull();
    const chapters = walk('aion-chapters');
    for (const s of chapters.stops) expect(planStop(s, scale).setClock).toBeNull();
    for (const s of walk('theory-route').stops) expect(planStop(s, scale).setClock).toBeNull();
  });

  it('a stop with a year sets the clock to that year on the shared scale', () => {
    expect(planStop(stop({ year: 1913 }), scale).setClock).toBeCloseTo(scale.toU(1913), 10);
    expect(planStop(stop({ year: 0 }), scale).setClock).toBeCloseTo(scale.toU(0), 10);
    expect(planStop(stop({ year: -10000 }), scale).setClock).toBe(0);
  });

  it('a stop with a place flies there; one without does not fly', () => {
    expect(planStop(stop({ place: { lat: 47.4, lon: 8.55 } }), scale).flyTo).toEqual({ lat: 47.4, lon: 8.55 });
    expect(planStop(stop({ year: 1913 }), scale).flyTo).toBeNull();
    const located = walk('redbook').stops.filter((s) => s.place);
    expect(located).toHaveLength(37);
    for (const s of located) expect(planStop(s, scale).flyTo).toEqual(s.place);
  });

  it('a stop with a page opens the reading there; the subject is focused', () => {
    const s = stop({ page: { work: 'cw12', page: 245 }, subject: { type: 'stage', id: 'nigredo' } });
    expect(planStop(s, scale)).toEqual({ setClock: null, flyTo: null, openPage: { work: 'cw12', page: 245 }, focus: { type: 'stage', id: 'nigredo' } });
    expect(planStop(stop({ year: 5 }), scale).openPage).toBeNull();
    expect(planStop({}, scale)).toEqual({ setClock: null, flyTo: null, openPage: null, focus: null });
  });

  it('the plan does not touch its stop', () => {
    const s = stop({ year: 1913, place: { lat: 1, lon: 2 }, page: { work: 'w', page: 3 } });
    const before = structuredClone(s);
    const p = planStop(s, scale);
    p.flyTo!.lat = 99;
    expect(s).toEqual(before);
  });
});

describe('the runner steps a walk', () => {
  it('starts at the first stop, keeps {walkId, i}, and steps forward and back', () => {
    const r = new WalkRunner({ scale });
    expect(r.position).toBeNull();
    const first = r.start(walk('redbook'), SNAP)!;
    expect(first).toMatchObject({ walkId: 'redbook', i: 0, count: 37, first: true, last: false });
    expect(r.position).toEqual({ walkId: 'redbook', i: 0 });
    expect(r.next()).toMatchObject({ i: 1, first: false });
    expect(r.next()!.i).toBe(2);
    expect(r.prev()!.i).toBe(1);
    expect(r.position).toEqual({ walkId: 'redbook', i: 1 });
  });

  it('a step carries the stop and the effects planned from it', () => {
    const r = new WalkRunner({ scale });
    const w = walk('redbook');
    const step = r.start(w, SNAP)!;
    expect(step.stop).toBe(w.stops[0]);
    expect(step.effects).toEqual(planStop(w.stops[0], scale));
    expect(step.effects.flyTo).toEqual(w.stops[0].place);
  });

  it('does not run past either end unless the walk is set to wrap', () => {
    const r = new WalkRunner({ scale });
    const w = mini([stop({ year: 1 }), stop({ year: 2 }), stop({ year: 3 })]);
    r.start(w, SNAP);
    expect(r.prev()).toBeNull();
    expect(r.position!.i).toBe(0);
    r.next(); const last = r.next()!;
    expect(last).toMatchObject({ i: 2, last: true });
    expect(r.next()).toBeNull();
    expect(r.position!.i).toBe(2);
    const w2 = new WalkRunner({ scale, wrap: true });
    w2.start(w, SNAP);
    expect(w2.prev()!.i).toBe(2);
    expect(w2.next()!.i).toBe(0);
  });

  it('goto lands on a stop by index and refuses an index the walk does not have', () => {
    const r = new WalkRunner({ scale });
    r.start(walk('theory-route'), SNAP);
    expect(r.goto(9)!.i).toBe(9);
    expect(r.goto(16)).toBeNull();
    expect(r.goto(-1)).toBeNull();
    expect(r.position!.i).toBe(9);
  });

  it('can be started part-way, as a walk restored from the address is', () => {
    const r = new WalkRunner({ scale });
    expect(r.start(walk('redbook'), SNAP, 12)!.i).toBe(12);
    expect(r.start(mini([]), SNAP)).toBeNull();
    expect(r.start(walk('redbook'), SNAP, 99)).toBeNull();
  });

  it('an empty walk does not start', () => {
    const r = new WalkRunner({ scale });
    expect(r.start(mini([]), SNAP)).toBeNull();
    expect(r.active).toBe(false);
  });
});

describe('interrupting restores what the walk found', () => {
  it('interrupt returns the snapshot taken at start, however far the walk went', () => {
    const r = new WalkRunner({ scale });
    r.start(walk('redbook'), SNAP);
    r.next(); r.next(); r.next();
    expect(r.interrupt()).toEqual(SNAP);
    expect(r.position).toBeNull();
    expect(r.active).toBe(false);
  });

  it('the snapshot is a copy: changing the app\'s object afterwards does not change what is restored', () => {
    const live: AppSnapshot = structuredClone(SNAP);
    const r = new WalkRunner({ scale });
    r.start(walk('redbook'), live);
    live.u = 0.99; live.focus = null; live.reading!.page = 1;
    expect(r.interrupt()).toEqual(SNAP);
  });

  it('after an interrupt nothing steps; a second interrupt has nothing to restore', () => {
    const r = new WalkRunner({ scale });
    r.start(walk('redbook'), SNAP);
    r.interrupt();
    expect(r.next()).toBeNull();
    expect(r.prev()).toBeNull();
    expect(r.goto(3)).toBeNull();
    expect(r.interrupt()).toBeNull();
  });

  it('starting another walk while one runs keeps the state from before the first: one restore, to where the visitor began', () => {
    const r = new WalkRunner({ scale });
    r.start(walk('redbook'), SNAP);
    r.next();
    const mid: AppSnapshot = { ...SNAP, u: 0.9, walk: { walkId: 'redbook', i: 1 } };
    r.start(walk('aion-chapters'), mid);
    expect(r.position).toEqual({ walkId: 'aion-chapters', i: 0 });
    expect(r.interrupt()).toEqual(SNAP);
  });
});

describe('the order is the data\'s order', () => {
  it('a walk is stepped in the order of its stops, none skipped, none repeated', () => {
    for (const w of data.walks) {
      const r = new WalkRunner({ scale });
      const seen: WalkStop[] = [r.start(w, SNAP)!.stop];
      for (let s = r.next(); s; s = r.next()) seen.push(s.stop);
      expect(seen.length, w.id).toBe(w.stops.length);
      seen.forEach((s, k) => expect(s, `${w.id}#${k}`).toBe(w.stops[k]));
    }
  });

  it('the curated Theory route is not re-sorted: 16 stops in the movements\' order, no clock on any', () => {
    const w = walk('theory-route');
    const r = new WalkRunner({ scale });
    const ids = [r.start(w, SNAP)!.stop.subject!.id];
    for (let s = r.next(); s; s = r.next()) ids.push(s.stop.subject!.id);
    expect(ids).toEqual(w.stops.map((s) => s.subject!.id));
    expect(ids).toHaveLength(16);
    expect(ids[0]).toBe('alternating-current');
  });

  it('a text walk keeps page order: cw12\'s is 204 steps, pages never going back', () => {
    const w = walk('text/cw12');
    const r = new WalkRunner({ scale });
    const pages: number[] = [];
    for (let s = r.start(w, SNAP); s; s = r.next()) pages.push(s.stop.page!.page);
    expect(pages).toHaveLength(204);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
  });

  it('every text walk has the Work\'s own pages in the order the data gives', () => {
    for (const w of data.walks.filter((x) => x.kind === 'text')) {
      const pages = w.stops.map((s) => s.page?.page).filter((p): p is number => p !== undefined);
      expect(pages, w.id).toEqual([...pages].sort((a, b) => a - b));
    }
  });
});

describe('the clock of a chronological walk is monotone', () => {
  const clocks = (w: Walk): number[] => {
    const r = new WalkRunner({ scale });
    const out: number[] = [];
    for (let s = r.start(w, SNAP); s; s = r.next()) if (s.effects.setClock !== null) out.push(s.effects.setClock);
    return out;
  };

  it('the 14 theoretic walks are curated by their page, not by year: no walk is chronological, and the clock follows the stops as written', () => {
    expect(data.walks.filter((w) => w.ordered === 'chronological')).toHaveLength(0);
    const walks = data.walks.filter((w) => w.kind === 'theoretic');
    expect(walks).toHaveLength(14);
    for (const w of walks) {
      expect(w.ordered, w.id).toBe('curated');
      const dated = w.stops.filter((s) => s.year !== undefined);
      expect(clocks(w), w.id).toEqual(dated.map((s) => scale.toU(s.year!)));
    }
  });

  it('the nine curated Aion threads also run forward in time', () => {
    const threads = data.walks.filter((x) => x.kind === 'aion-thread');
    expect(threads).toHaveLength(9);
    for (const w of threads) {
      const c = clocks(w);
      expect(c, w.id).toEqual([...c].sort((a, b) => a - b));
    }
  });

  it('the Red Book is curated by folio, not by year: its clock follows its stops as written, never re-sorted', () => {
    const w = walk('redbook');
    const c = clocks(w);
    expect(c).toEqual(w.stops.map((s) => scale.toU(s.year!)));
    expect(c).not.toEqual([...c].sort((a, b) => a - b));
  });

  it('a walk of chapters, with no years, never moves the clock', () => {
    expect(clocks(walk('aion-chapters'))).toEqual([]);
    expect(clocks(walk('alchemy-stages'))).toEqual([]);
  });
});
