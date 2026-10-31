// H5, Symbols: the lens's Contents. The way in first, then the images the field holds most instances of, then the dictionary's entries
// in the dictionary's own order; an entry whose image the field does not hold is not offered; the entry the lens stands on is marked.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { symbolsContentsGroups } from '../../src/lenses/symbols-contents';

const ROOT = path.resolve(__dirname, '..', '..');
const symbols = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/symbols.json'), 'utf8')) as { entries: { familyId: string; title: string }[] };
const field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8')) as { families: { id: string }[] };
const held = new Set(field.families.map((f) => f.id));
const top = [{ id: 'serpent', name: 'Serpent' }, { id: 'tower', name: 'Tower' }];

describe('the Symbols Contents', () => {
  it('leads with the way in, then the busiest images, then the dictionary', () => {
    const g = symbolsContentsGroups({ top, entries: symbols.entries, held }, [], () => {});
    expect(g.map((x) => x.title)).toEqual(['Find', 'The images with the most instances', 'Symbols']);
    expect(g[0].items.map((i) => i.label)).toEqual(['Find a symbol']);
    expect(g[1].items.map((i) => i.label)).toEqual(['Serpent', 'Tower']);
  });

  it("lists the dictionary's entries in the dictionary's order, only those whose image the field holds", () => {
    const entries = [...symbols.entries, { familyId: 'not-in-the-field', title: 'Nowhere' }];
    const g = symbolsContentsGroups({ top, entries, held }, [], () => {});
    const expected = symbols.entries.filter((e) => held.has(e.familyId)).map((e) => e.title);
    expect(g[2].items.map((i) => i.label)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(40);
    expect(g[2].items.map((i) => i.label)).not.toContain('Nowhere');
  });

  it('marks the entry the lens stands on, and the way in while it stands at the start', () => {
    const at = (p: string[]) => symbolsContentsGroups({ top, entries: symbols.entries, held }, p, () => {}).flatMap((g) => g.items.filter((i) => i.current).map((i) => i.label));
    expect(at([])).toEqual(['Find a symbol']);
    expect(at(['serpent'])).toContain('Serpent');
    expect(at(['archetype', 'self'])).toEqual([]);
  });

  it("a pick goes to the entry's own route", () => {
    const log: string[][] = [];
    const g = symbolsContentsGroups({ top, entries: symbols.entries, held }, [], (p) => { log.push(p); });
    g[0].items[0].onPick();
    g[1].items[0].onPick();
    g[2].items[0].onPick();
    expect(log[0]).toEqual([]);
    expect(log[1]).toEqual(['serpent']);
    expect(log[2]).toEqual([symbols.entries.find((e) => held.has(e.familyId))!.familyId]);
  });
});
