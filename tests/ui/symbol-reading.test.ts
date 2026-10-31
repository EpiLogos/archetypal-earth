import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { symbolReading } from '../../src/ui/symbol-reading';
import type { Field } from '../../src/types/field';
import type { Symbols } from '../../src/types/symbols';
import { FakeEl, installFakeDom } from './fake-dom';

// G2, characterisation: the Book of Symbols reading as it stands, in the two surfaces that draw it (the deep sheet's
// section, the card's collapsed details). The links to the entry's related symbols, the heading and the two source
// lines are pinned; the reading's own paragraphs are not (the alignment replaces them with verbatim passages).

const field = JSON.parse(readFileSync(new URL('../../public/data/field.json', import.meta.url), 'utf8')) as Field;
const symbols = JSON.parse(readFileSync(new URL('../../public/data/symbols.json', import.meta.url), 'utf8')) as Symbols;
const model = buildModel(field, undefined, symbols);

let restore: () => void;
beforeAll(() => { restore = installFakeDom(); });
afterAll(() => restore());

const read = (familyId: string, compact = false, onFamily: (id: string) => void = () => {}) => symbolReading(model, familyId, onFamily, compact) as unknown as FakeEl | null;

describe('the Book of Symbols reading (today)', () => {
  const entry = symbols.entries.find((e) => e.resonances.length >= 3)!;

  it('has an entry with resonances to test against', () => {
    expect(entry).toBeDefined();
  });

  it('is a section with the book\'s heading, its entry, pages and year, and its title and editor', () => {
    const s = read(entry.familyId)!;
    expect(s.tag).toBe('section');
    expect(s.hasClass('symbol-reading')).toBe(true);
    expect(s.getAttribute('aria-label')).toBe('The Book of Symbols reading');
    expect(s.first('h3.dp-sub')!.textContent).toBe('The Book of Symbols');
    const lines = s.find('p.symbol-source').map((p) => p.textContent);
    const pages = `${entry.pages.length > 1 ? 'pp.' : 'p.'} ${entry.pages.join(', ')}`;
    expect(lines[0]).toBe(`${entry.title} · ${pages} · ${symbols.source.year}`);
    expect(lines[lines.length - 1]).toBe(`${symbols.source.title} · edited by ${symbols.source.editor}`);
  });

  it('links each related symbol by its name, and a click goes to that symbol', () => {
    const went: string[] = [];
    const s = read(entry.familyId, false, (id) => went.push(id))!;
    const links = s.find('p.symbol-links')[0].find('button.link-quiet');
    const want = entry.resonances.filter((id) => model.famById.has(id));
    expect(want.length).toBeGreaterThanOrEqual(3);
    expect(links.map((b) => b.textContent)).toEqual(want.map((id) => model.famById.get(id)!.name));
    links.forEach((b) => b.click());
    expect(went).toEqual(want);
    expect(s.first('p.symbol-links')!.first('span')!.textContent).toBe('Related symbols · ');
  });

  it('the card\'s form is a collapsed details with the same links, under a summary', () => {
    const s = read(entry.familyId, true)!;
    expect(s.tag).toBe('details');
    expect(s.hasClass('symbol-compact')).toBe(true);
    expect(s.first('summary.symbol-summary')!.textContent).toBe('The Book of Symbols');
    expect(s.find('p.symbol-links')[0].find('button.link-quiet').length).toBe(entry.resonances.filter((id) => model.famById.has(id)).length);
  });

  it('each of the entry\'s words is a quotation of the Quote component: verbatim, with its printed page in the foot', () => {
    const s = read(entry.familyId)!;
    const qs = s.find('blockquote.q');
    expect(qs.length).toBe(entry.quotes.length);
    qs.forEach((q, i) => {
      const t = q.first('p.q-text')!.textContent;
      expect(t.replace(/^…/, '')).toBe(entry.quotes[i].text);
      expect(q.textContent).toContain(`p. ${entry.quotes[i].page}`);
    });
  });

  it('draws nothing for a family the book does not hold', () => {
    expect(read('not-a-family')).toBeNull();
  });

  it('every entry\'s resonances resolve to families of the field', () => {
    for (const e of symbols.entries) for (const id of e.resonances) expect(model.famById.has(id), `${e.familyId} → ${id}`).toBe(true);
  });
});
