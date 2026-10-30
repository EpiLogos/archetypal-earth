// N8: the Works and the People are searchable. "Psychology and Alchemy" finds the Work, "redbook" finds Liber Novus (a cite key
// the registry folds), "jung" finds the Person before any Work, and every record is reachable by its own name.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildModel } from '../../src/data/model';
import { buildSearchIndex, search } from '../../src/data/search';
import type { Field } from '../../src/types/field';
import type { PeopleData } from '../../src/types/people';
import type { WorksData } from '../../src/types/works';

const ROOT = path.resolve(__dirname, '..', '..');
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const field = json('public/data/field.json') as Field;
const works = json('public/data/works.json') as WorksData;
const people = json('public/data/people.json') as PeopleData;
const index = buildSearchIndex(buildModel(field, undefined, undefined, { works, people }));
const first = (q: string) => search(index, q)[0];

describe('works are a search kind', () => {
  it('"Psychology and Alchemy" is the Work, first', () => {
    expect(first('Psychology and Alchemy')).toMatchObject({ kind: 'work', label: 'Psychology and Alchemy (CW12)', action: { type: 'subject', subject: { type: 'work', id: 'cw12' } } });
  });

  it('"redbook", a cite key the registry folds, is Liber Novus', () => {
    expect(first('redbook')).toMatchObject({ kind: 'work', action: { type: 'subject', subject: { type: 'work', id: 'liber-novus' } } });
  });

  it('a collected volume is found by its number, with or without the space', () => {
    expect(first('cw12').action).toEqual({ type: 'subject', subject: { type: 'work', id: 'cw12' } });
    expect(first('cw 12').action).toEqual({ type: 'subject', subject: { type: 'work', id: 'cw12' } });
  });

  it('a Work is found by the head of its title ("aion") and by a word of it', () => {
    expect(first('aion').action).toEqual({ type: 'subject', subject: { type: 'work', id: 'cw09ii' } });
    expect(search(index, 'number and time').some((r) => r.action.type === 'subject' && r.action.subject.id === 'vonzfranz-number-time')).toBe(true);
  });

  it('every Work is reachable by its own title', () => {
    for (const w of works.works) {
      const hit = search(index, w.title, 7).some((r) => r.action.type === 'subject' && r.action.subject.type === 'work' && r.action.subject.id === w.id);
      expect(hit, w.title).toBe(true);
    }
  });

  it('the author alias of a volume ("jung" for CW11) is not a name for the Work', () => {
    const ids = search(index, 'jung', 7).filter((r) => r.kind === 'work').map((r) => (r.action as { subject: { id: string } }).subject.id);
    expect(ids).not.toContain('cw11');
  });
});

describe('people are a search kind', () => {
  it('"jung" is the Person, ahead of every Work', () => {
    expect(first('jung')).toMatchObject({ kind: 'person', label: 'C. G. Jung', action: { type: 'subject', subject: { type: 'person', id: 'jung' } } });
  });

  it('a surname finds him: "von franz", "hillman", "pauli" (ahead of the letters that carry his name)', () => {
    expect(first('von franz').action).toEqual({ type: 'subject', subject: { type: 'person', id: 'von-franz' } });
    expect(first('hillman').action).toEqual({ type: 'subject', subject: { type: 'person', id: 'hillman' } });
    expect(first('pauli').action).toEqual({ type: 'subject', subject: { type: 'person', id: 'pauli' } });
  });

  it('every Person is reachable by his full name', () => {
    for (const p of people.people) {
      const hit = search(index, p.name, 7).some((r) => r.action.type === 'subject' && r.action.subject.type === 'person' && r.action.subject.id === p.id);
      expect(hit, p.name).toBe(true);
    }
  });

  it('a result carries its sub-line and a tone from the cites that tie it to the field', () => {
    const j = first('jung');
    expect(j.sub).toBe('Analytical psychologist');
    expect(j.tone).toMatch(/^#[0-9a-f]{6}$/i);
    expect(first('Psychology and Alchemy').sub).toBe('work · Jung');
  });
});

describe('the rest of search is unchanged', () => {
  it('without the Works and the People the model has no such entries', () => {
    const bare = buildSearchIndex(buildModel(field));
    expect(bare.entries.some((e) => e.kind === 'work' || e.kind === 'person')).toBe(false);
  });

  it('the quiet invitation is still archetypes and theory', () => {
    expect(search(index, '').every((r) => r.kind === 'archetype' || r.kind === 'theoretic')).toBe(true);
  });
});
