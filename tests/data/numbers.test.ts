// The numbers as archetypes (curation/archetypes.json → the field; curation/numbers.json + curation/ql.json →
// public/data/numbers.json): one to six are archetypes of order tied to the Self, every tie resolves, the Self's tie
// and the two keystone quotations stand verbatim, the egg is three witnesses in their own voices, the QL lines are
// marked QL and never in Jung's voice, and the shape is shown, never stated.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error Plain ESM shared with the generators.
import { DEFAULT_VAULT } from '../../scripts/lib/vault.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { verify, workLoader } from '../../scripts/lib/cite.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { buildNumbers } from '../../scripts/numbers.mjs';
import { DEEP_FIELDS } from '../../src/lenses/deep-fields';
import { hashToState } from '../../src/state/router';
import { buildModel } from '../../src/data/model';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', f), 'utf8'));
const field = read('field.json') as Field;
const numbers = read('numbers.json');
const model = buildModel(field);
const load = workLoader(DEFAULT_VAULT);
const IDS = ['one', 'two', 'three', 'four', 'five', 'six'] as const;

type Q = { text: string; cite: { work: string; workTitle: string; locator: string }; voice?: string; scan?: true };
type Page = { n: number; position: string; ql: { text: string; source: string; name?: string }; gloss: { text: string; source: string }; line: string; vonFranz: Q[]; jung: Q[]; sections: { id: string; title: string; line: string; quotes: Q[] }[]; subjects: { type: string; id: string }[] };
const pages = numbers.pages as Record<string, Page>;
/** Every quotation of a page. */
const quotesOf = (p: Page): Q[] => [...p.vonFranz, ...p.jung, ...p.sections.flatMap((s) => s.quotes)];

describe('the numbers are archetypes', () => {
  it('one to six are archetypes of the field, admitted from curation — never a tier of their own', () => {
    for (const id of IDS) {
      const a = field.archetypes.find((x) => x.id === id);
      expect(a, id).toBeTruthy();
      expect(a!.synthesised, `${id} is admitted from curation`).toBe(true);
      // there is no numbers family and no numbers tier: they are archetypes (CW8 ¶870-871, CW10 ¶805)
      expect(field.families.some((f) => f.id === id), `${id} is not a family`).toBe(false);
      expect((field as unknown as Record<string, unknown>)[`${id}s`]).toBeUndefined();
    }
  });

  it('every tie resolves, and the ties are the plan\'s own', () => {
    const familiesTiedTo = (id: string) => field.families.filter((f) => f.archetypes.some((t) => t.id === id)).map((f) => f.id);
    expect(familiesTiedTo('one')).toContain('monad');
    expect(familiesTiedTo('three')).toContain('trinity');
    expect(familiesTiedTo('four')).toEqual(expect.arrayContaining(['quaternity', 'mandala']));
    expect(familiesTiedTo('five')).toEqual(expect.arrayContaining(['quincunx', 'lapis']));
    // the dyad ties to the syzygy and the shadow — archetype to archetype, from curation alone
    const two = field.archetypes.find((a) => a.id === 'two')!;
    expect(two.archetypes.map((t) => t.id).sort()).toEqual(['shadow', 'syzygy']);
    // the Self tie, in Jung's own word (CW10 ¶805, CW9i pdf p424)
    const six = field.archetypes.find((a) => a.id === 'six')!;
    expect(six.archetypes).toEqual([{ id: 'self', basis: 'jung' }]);
    // every tie of every archetype resolves, whichever way it is stated
    for (const a of field.archetypes) for (const t of a.archetypes ?? []) expect(field.archetypes.some((x) => x.id === t.id), `${a.id} -> ${t.id}`).toBe(true);
    for (const f of field.families) for (const t of f.archetypes) expect(field.archetypes.some((x) => x.id === t.id), `${f.id} -> ${t.id}`).toBe(true);
    // and the number family is filled and tied to all six
    const number = field.families.find((f) => f.id === 'number')!;
    expect(number.oneLine.length).toBeGreaterThan(0);
    expect(number.body.length).toBeGreaterThan(0);
    expect(number.archetypes.map((t) => t.id)).toEqual(expect.arrayContaining([...IDS]));
  });

  it('the six is a node the graph draws with its tie to the Self, and the numbers are focusable subjects', () => {
    expect(model.archById.has('six')).toBe(true);
    expect(hashToState('#/a/five', { hasArchetype: (id: string) => model.archById.has(id), hasTheoretic: () => false, hasFamily: () => false, hasCulture: () => false, hasPlace: () => false, familyOf: () => undefined }).state.view).toEqual({ kind: 'focus', subject: { type: 'archetype', id: 'five' } });
  });

  it('every number has a page: its position, the framework\'s words, von Franz on it, and a section of Jung\'s own', () => {
    expect(Object.keys(pages).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      const p = pages[id];
      expect(p.line.length, `${id} line`).toBeGreaterThan(20);
      expect(p.sections.length, `${id} sections`).toBeGreaterThan(0);
      // the voices are split, never mixed: a heading that says von Franz stands over von Franz's words only
      expect(p.vonFranz.length, `${id} von Franz`).toBeGreaterThan(0);
      expect(p.vonFranz.every((q) => q.cite.work.startsWith('vonzfranz')), id).toBe(true);
      expect(p.jung.every((q) => !q.cite.work.startsWith('vonzfranz')), id).toBe(true);
    }
  });

  it('the Self tie carries its quotes verbatim on the six', () => {
    const all = quotesOf(pages.six);
    const order = all.find((q) => q.cite.work === 'cw10' && q.cite.locator.startsWith('¶805'));
    expect(order).toBeTruthy();
    expect(order!.text).toContain('The self is the archetype of order par excellence.');
    expect(order!.text).toContain('the Pythagorean tetraktys');
    const wholeness = all.find((q) => q.cite.work === 'cw09i' && q.cite.locator === 'pdf p424');
    expect(wholeness).toBeTruthy();
    expect(wholeness!.text).toContain('the archetype of wholeness');
    expect(wholeness!.text).toContain('the “quaternity of the One” is the schema for all images of God'.replace(/[“”]/g, '"').replace('"quaternity of the One"', (m) => m));
  });

  it('the keystone quotes stand verbatim: the wholeness of the One, and the quinta essentia', () => {
    const all = [...IDS.flatMap((id) => quotesOf(pages[id])), ...numbers.egg.footnote, ...numbers.egg.mandala];
    const quinta = all.find((q) => q.cite.work === 'cw10' && q.cite.locator.startsWith('¶738'));
    expect(quinta).toBeTruthy();
    expect(quinta!.text).toContain('the quinta essentia');
    expect(quinta!.text).toContain('the circle divided into four with the centre');
    expect(quinta!.text).toContain('the four functions of consciousness with their unitary substrate, the self');
  });

  it('every quotation is corpus-placed with a locating cite and stands verbatim on its cited page', () => {
    const all: (Q & { where: string })[] = [
      ...IDS.flatMap((id) => quotesOf(pages[id]).map((q) => ({ ...q, where: id }))),
      { ...numbers.egg.dream, where: 'egg.dream' },
      ...numbers.egg.footnote.map((q: Q) => ({ ...q, where: 'egg.footnote' })),
      ...numbers.egg.mandala.map((q: Q) => ({ ...q, where: 'egg.mandala' })),
    ];
    expect(all.length).toBeGreaterThan(20);
    for (const q of all) {
      expect(q.cite.locator, q.where).toMatch(/^(?:¶\d+ \(pdf p\d+\)|pdf p\d+)$/);
      expect(verify(load, { work: q.cite.work, locator: q.cite.locator, quote: q.text }), q.where).toBeNull();
    }
  });

  it('the egg: three witnesses to one image, the count as six stages, nothing asserted between them', () => {
    expect(numbers.egg.stages.labels).toEqual(['1 · The Seed', '2 · Polarity', '3 · The Third', '4 · Quaternity', '5 · Quintessence', '5→0 · The Return']);
    // the 0/1 frame's start is forgone: no stage names it
    expect(numbers.egg.stages.labels.some((s: string) => /\b0\/1\b|\bFrame\b/.test(s))).toBe(false);
    // the dream, in Pauli's own voice — never Jung's
    expect(numbers.egg.dream.voice).toBe('Pauli');
    expect(numbers.egg.dream.text).toContain('lays a large egg');
    // Jung's footnote: the four things, the punctum apart, the square rotating into a circle
    expect(numbers.egg.footnote.some((q: Q) => /punctum solis/.test(q.text))).toBe(true);
    expect(numbers.egg.footnote.some((q: Q) => /circulus exiguus/.test(q.text) && /square into a circular one/.test(q.text))).toBe(true);
    // the pentadic mandala: the egg encircled by the snake at the centre
    expect(numbers.egg.mandala.some((q: Q) => /egg encircled by the snake/.test(q.text))).toBe(true);
    expect(numbers.egg.mandala.some((q: Q) => /pentadic structure/.test(q.text))).toBe(true);
  });

  it('the QL lines are marked QL and never in Jung\'s voice', () => {
    const SRC = /^(?:S[1-4]|W § (?:I|II|III|IV|V|VI))$/;
    for (const id of IDS) {
      const p = pages[id];
      expect(p.ql.source, id).toMatch(SRC);
      expect(p.gloss.source, id).toMatch(SRC);
      expect(p.position, id).toMatch(/^#\d$/);
      // the framework's words are never repeated as a quotation in anyone's voice
      const all = quotesOf(p);
      expect(all.some((q) => q.text === p.ql.text || q.text === p.gloss.text), id).toBe(false);
    }
    expect(numbers.egg.stages.source).toMatch(SRC);
  });

  it('the shape is shown, never stated: no 4+2 or 3+1 label anywhere in the published numbers', () => {
    const text = JSON.stringify(numbers);
    expect(text).not.toMatch(/4\+2|3\+1/);
    // and the six positions stand in the owner's ruling: one to six at #0 to #5, untouched
    expect(IDS.map((id) => pages[id].position)).toEqual(['#0', '#1', '#2', '#3', '#4', '#5']);
    expect(IDS.map((id) => pages[id].n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  // a full rebuild reads the corpus; under the whole suite's load it runs past the default 5s
  it('the published file is what the sources give now (no hand edits)', () => {
    const built = buildNumbers();
    expect(built.errors).toEqual([]);
    expect(numbers).toEqual(built.data);
  }, 30_000);
});

describe('the Self\'s page', () => {
  const depth = read('depth.json');

  it('is reached where the Self is, and carries the eight sections of the plan', () => {
    expect(DEEP_FIELDS.has('self')).toBe(true);
    const self = depth.archetypes.self;
    expect(self).toBeTruthy();
    expect(self.sections.map((s: { id: string }) => s.id)).toEqual([
      'centre-and-circumference', 'archetype-of-order', 'the-monad', 'the-dyad', 'the-quaternity', 'the-fifth', 'the-return', 'the-numbers',
    ]);
    for (const s of self.sections) {
      expect(s.quotes.length, s.id).toBeGreaterThan(0);
      for (const q of s.quotes) expect(verify(load, { work: q.cite.work, locator: q.cite.locator, quote: q.text }), `${s.id} ${q.cite.locator}`).toBeNull();
    }
    // no Neumann run carries instance records of the self: the page has no instances block rather than an empty one
    expect(self.instances).toBeUndefined();
  });

  it('the numbers themselves are its last section, each linked', () => {
    const last = depth.archetypes.self.sections.at(-1);
    expect(last.subjects.map((s: { id: string }) => s.id)).toEqual([...IDS]);
  });
});
