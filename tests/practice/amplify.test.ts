import { describe, expect, it } from 'vitest';
import field from '../../public/data/field.json';
import { buildModel } from '../../src/data/model';
import { amplify, dreamEvidence, findImages, matchImages, vocabulary } from '../../src/practice/amplify';
import { LocalBackend, PracticeStore } from '../../src/practice/store';
import type { Field } from '../../src/types/field';

const m = buildModel(field as unknown as Field);
const v = vocabulary(m);

describe('the amplification engine reads a dream in the field’s own names', () => {
  it('finds the images a dream names, longest phrase first, plurals met', () => {
    const text = 'I walked down to a river where two snakes lay under a tree. An old wise woman held a golden flower.';
    const hits = matchImages(v, text);
    const ids = hits.map((h) => `${h.target.type}:${h.target.id}`);
    expect(ids).toContain('family:river');
    expect(ids).toContain('family:serpent');
    expect(ids).toContain('family:tree');
    expect(ids).toContain('family:golden-flower');
    expect(hits.find((h) => h.target.id === 'serpent')?.text).toBe('snakes');
    // spans are in reading order and do not overlap
    for (let i = 1; i < hits.length; i++) expect(hits[i].start).toBeGreaterThanOrEqual(hits[i - 1].end);
  });

  it('does not make an image out of a word too common to name one', () => {
    expect(matchImages(v, 'The man and the woman said it was life.')).toEqual([]);
  });

  it('finds images by the start of a name, the exact name first', () => {
    const r = findImages(m, v, 'serp');
    expect(r[0]).toEqual({ type: 'family', id: 'serpent' });
    expect(findImages(m, v, 'shadow')[0]).toEqual({ type: 'archetype', id: 'shadow' });
    expect(findImages(m, v, 'zzzz')).toEqual([]);
  });

  it('lays a family out as Jung did: dated instances in order, dreams among them, its archetypes', () => {
    const a = amplify(m, 'serpent')!;
    expect(a.instances.length).toBeGreaterThan(40);
    for (let i = 1; i < a.instances.length; i++) expect(m.occ[a.instances[i]].year).toBeGreaterThanOrEqual(m.occ[a.instances[i - 1]].year);
    expect(a.dreams.length).toBeGreaterThan(20);
    expect(a.dreams.every((i) => ['dream', 'vision'].includes(m.occ[i].locusType))).toBe(true);
    expect(a.archetypes.length).toBeGreaterThan(0);
    expect(amplify(m, 'no-such-family')).toBeNull();
  });

  it('the corpus’s dream evidence is all its dreams and visions', () => {
    expect(dreamEvidence(m).length).toBeGreaterThanOrEqual(589);
  });
});

describe('the practice store keeps everything in one place, and can give it back', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: () => null, length: 0 } as Storage;
  };
  it('puts, lists, removes and wipes by collection', () => {
    const s = new PracticeStore(new LocalBackend(memory()));
    const a = s.put('dreams', { title: 'A', text: 'river' } as never);
    s.put('coincidences', { a: 'x', b: 'y' } as never);
    expect(s.list('dreams').map((d) => d.id)).toEqual([a.id]);
    s.put('dreams', { ...(a as object), title: 'B' } as never);
    expect((s.get('dreams', a.id) as unknown as { title: string }).title).toBe('B');
    s.remove('dreams', a.id);
    expect(s.list('dreams')).toEqual([]);
    s.wipe();
    expect(s.list('coincidences')).toEqual([]);
  });
  it('exports to one file and reads it back, newer edits winning', () => {
    const s = new PracticeStore(new LocalBackend(memory()));
    s.put('dreams', { title: 'kept' } as never);
    const file = s.exportAll();
    const t = new PracticeStore(new LocalBackend(memory()));
    expect(t.importAll(file)).toEqual({ added: 1, kept: 0 });
    expect(t.importAll(file)).toEqual({ added: 0, kept: 1 });
    expect(() => t.importAll('{"kind":"other"}')).toThrow();
  });
  it('without storage it still works for the page’s life, and says it will not keep anything', () => {
    const s = new PracticeStore(new LocalBackend(null));
    expect(s.persistent).toBe(false);
    s.put('dreams', { title: 'x' } as never);
    expect(s.list('dreams').length).toBe(1);
  });
});
