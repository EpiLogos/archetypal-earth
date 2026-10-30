// S1: the lens contract. Each lens states its set, its filter dimensions, its marks, its stops, its plates and its Contents in
// one object. The set sizes below are MEASURED from the raw data files by ProjectCentral/docs/alignment-scouting/s1/lens-sets.mjs
// (a different derivation from the code under test); the code must reproduce them.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { CONTRACT_LENSES, engageWith, lensContract, type LensData } from '../../src/lenses/contract';
import { LocalBackend, PracticeStore } from '../../src/practice/store';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const json = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8')) as T;
const field = json<Field>('field.json');
const m = buildModel(field, undefined, undefined, { works: json('works.json'), people: json('people.json'), walks: json('walks.json') });
const data: LensData = {
  dynamics: json('dynamics.json'),
  history: json('history.json'),
  redbook: json('redbook.json'),
  alchemy: json('alchemy.json'),
  symbols: json('symbols.json'),
};

/** Measured (own, placed) per lens: lens-sets.mjs on the field as it stands. Astrology, Dreams and Coincidences have no field set. */
const MEASURED: Record<string, [number, number]> = {
  field: [3085, 2844],
  theory: [1194, 1188],
  aion: [704, 701],
  redbook: [37, 37],
  alchemy: [712, 691],
  symbols: [808, 795],
  astrology: [0, 0],
  dreams: [0, 0],
  coincidences: [0, 0],
};

const memory = () => {
  const d = new Map<string, string>();
  return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k), clear: () => d.clear(), key: () => null, length: 0 } as Storage;
};

describe('the lens contract', () => {
  it('covers the nine lenses of the menu', () => {
    expect([...CONTRACT_LENSES].sort()).toEqual(Object.keys(MEASURED).sort());
  });

  it.each(Object.entries(MEASURED))('%s: the set is the measured size, and so is the placed part', (id, [own, placed]) => {
    const c = lensContract(id as never, m, data);
    expect(c.set.length).toBe(own);
    expect(c.placed).toBe(placed);
    expect(new Set(c.set).size).toBe(c.set.length);
  });

  it('a set is a set of the field: every index is an occurrence', () => {
    for (const id of CONTRACT_LENSES) for (const i of lensContract(id, m, data).set) expect(m.occ[i]).toBeDefined();
  });

  it('offers a filter dimension only where it varies inside the set (the Red Book spans one era)', () => {
    expect(lensContract('redbook', m, data).dimensions).not.toContain('era');
    expect(lensContract('field', m, data).dimensions).toEqual(['works', 'cultures', 'era', 'kinds', 'archetypes', 'theoretics', 'subjects', 'rings']);
    // Astrology has no set of its own; its slice is the occurrences that hang in the sky, so it can offer the sky ring
    expect(lensContract('astrology', m, data).set).toEqual([]);
    expect(lensContract('astrology', m, data).dimensions).toContain('rings');
  });

  it('puts marks on the strip for Aion (14 epochs as bands, 86 events as ticks) and the Red Book (37 folios), none elsewhere', () => {
    const aion = lensContract('aion', m, data).marks;
    expect(aion.filter((x) => x.kind === 'band')).toHaveLength(14);
    expect(aion.filter((x) => x.kind === 'tick')).toHaveLength(86);
    expect(lensContract('redbook', m, data).marks).toHaveLength(37);
    for (const id of ['field', 'theory', 'alchemy', 'symbols', 'astrology', 'dreams', 'coincidences'] as const) expect(lensContract(id, m, data).marks).toEqual([]);
  });

  it('orders the stops as the walks do: Aion 91 threads + 16 chapters, Red Book 37, Theory route 16, Alchemy 4', () => {
    const n = (id: Parameters<typeof lensContract>[0]) => lensContract(id, m, data).stops.length;
    expect(n('aion')).toBe(91 + 16);
    expect(n('redbook')).toBe(37);
    expect(n('theory')).toBe(16);
    expect(n('alchemy')).toBe(4);
    const rb = lensContract('redbook', m, data).stops;
    expect(rb.map((s) => s.i)).toEqual([...rb.keys()]);
  });

  it('names the Contents groups of the lenses that have them', () => {
    expect(lensContract('theory', m, data).groups[0].items).toHaveLength(14);
    expect(lensContract('aion', m, data).groups.map((g) => g.id)).toEqual(json<{ readings: { id: string }[] }>('history.json').readings.map((r) => r.id));
    expect(lensContract('redbook', m, data).groups.flatMap((g) => g.items)).toHaveLength(37);
    expect(lensContract('symbols', m, data).groups[0].items).toHaveLength(43);
  });

  it('a lens that engages writes one record of its own kind, and none when recording is off', () => {
    const kinds: Record<string, string> = { dreams: 'dream', symbols: 'symbol', coincidences: 'coincidence', astrology: 'chart', field: 'open', aion: 'open', redbook: 'open', theory: 'open', alchemy: 'open' };
    for (const [id, kind] of Object.entries(kinds)) {
      const store = new PracticeStore(new LocalBackend(memory()));
      const rec = engageWith(lensContract(id as never, m, data), store, { type: 'family', id: 'serpent' });
      expect(store.list('engagements')).toHaveLength(1);
      expect(rec?.kind).toBe(kind);
    }
    const off = new PracticeStore(new LocalBackend(memory()));
    off.setRecording(false);
    expect(engageWith(lensContract('dreams', m, data), off, { type: 'dream', id: 'x' })).toBeNull();
    expect(off.list('engagements')).toHaveLength(0);
  });
});
