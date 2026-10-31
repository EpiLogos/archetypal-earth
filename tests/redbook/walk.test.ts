// H5 + S9, the Red Book: the book's walk is the one `redbook` walk of public/data/walks.json stepped by the Walk runner. The old
// walk was `stops[(i + delta + n) % n]` over redbook.json; it goes only because the runner walks the same stops in the same order,
// at the same year and the same place, and wraps as the rail always did. This file is that parity, made from the raw data files.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { redbookWalk } from '../../src/redbook/walk';
import { lensContract } from '../../src/lenses/contract';
import { WalkRunner } from '../../src/walk/runner';
import type { Field } from '../../src/types/field';
import type { RedBook } from '../../src/types/redbook';
import type { WalksData } from '../../src/types/walks';

const ROOT = path.resolve(__dirname, '..', '..');
const json = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8')) as T;
const field = json<Field>('field.json');
const rb = json<RedBook>('redbook.json');
const walks = json<WalksData>('walks.json');
const m = buildModel(field, undefined, undefined, { works: json('works.json'), walks });
const SNAP = { u: 0, focus: null, reading: null, centre: null, walk: null };

describe('the Red Book walk is the curated descent, on the runner', () => {
  it('walks.json holds the same 37 folios in the same order as redbook.json', () => {
    const raw = walks.walks.find((w) => w.id === 'redbook')!;
    expect(raw.stops.map((s) => s.subject!.id)).toEqual(rb.stops.map((s) => s.id));
    expect(raw.stops).toHaveLength(37);
    expect(raw.ordered).toBe('curated');
    // the view reads the shipped walk, not a rebuilt one
    expect(redbookWalk(m, rb)).toBe(m.walkById.get('redbook'));
  });

  it('every stop sets the clock to the folio\'s year and flies to its place, as the card did', () => {
    const w = redbookWalk(m, rb);
    w.stops.forEach((s, k) => {
      const i = m.occIndex.get(rb.stops[k].id)!;
      expect(m.scale.toU(s.year!)).toBeCloseTo(m.u[i], 6);
      expect(s.place).toEqual({ lat: m.occ[i].lat, lon: m.occ[i].lon });
    });
  });

  it('the runner steps as the old rail did: forward and back from every folio, wrapping past either end', () => {
    const w = redbookWalk(m, rb);
    const n = rb.stops.length;
    for (let at = 0; at < n; at++) {
      for (const delta of [1, -1]) {
        const run = new WalkRunner({ scale: m.scale, wrap: true });
        run.start(w, SNAP, at);
        const step = delta > 0 ? run.next() : run.prev();
        // the rule the view used before the runner: stops[(i + delta + n) % n]
        expect(step!.stop.subject!.id).toBe(rb.stops[(at + delta + n) % n].id);
      }
    }
  });

  it('a walk file that has drifted from the curated stops is not trusted: the walk is drawn from the stops themselves', () => {
    const drifted = new Map(m.walkById);
    const raw = m.walkById.get('redbook')!;
    drifted.set('redbook', { ...raw, stops: [...raw.stops].reverse() });
    const w = redbookWalk({ walkById: drifted, occIndex: m.occIndex, occ: m.occ }, rb);
    expect(w.stops.map((s) => s.subject!.id)).toEqual(rb.stops.map((s) => s.id));
    const none = redbookWalk({ walkById: new Map(), occIndex: m.occIndex, occ: m.occ }, rb);
    expect(none.stops.map((s) => s.subject!.id)).toEqual(rb.stops.map((s) => s.id));
    expect(none.stops.every((s) => s.year !== undefined && s.place)).toBe(true);
  });
});

describe('the Red Book Contents', () => {
  it('lists all 37 folios once, under their sections in the book\'s order', () => {
    const groups = lensContract('redbook', m, { redbook: rb }).groups;
    expect(groups.map((g) => g.id)).toEqual(rb.sections.map((s) => s.id));
    const ids = groups.flatMap((g) => g.items.map((x) => x.id));
    expect(ids).toHaveLength(37);
    expect(new Set(ids).size).toBe(37);
    // inside a section the folios keep the walk's order
    for (const g of groups) {
      const at = g.items.map((x) => rb.stops.findIndex((s) => s.id === x.id));
      expect(at).toEqual([...at].sort((a, b) => a - b));
    }
  });
});
