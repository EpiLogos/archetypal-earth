import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { citeOfString, definitionQuote } from '../../src/lenses/ui';
import type { Field } from '../../src/types/field';
import type { WorksData } from '../../src/types/works';

// A definition's cite is still a string in field.json ("Aion (CW9ii) ¶426"); the Quote component wants it structured so the
// page can be opened. The reading of the string is tested on the field's own hundred-odd cites.
const read = <T>(f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8')) as T;
const field = read<Field>('field.json');
const model = buildModel(field, undefined, undefined, { works: read<WorksData>('works.json') });

describe('a cite held as a string', () => {
  it('is read as work, title and locator by its CW code, its key or its title', () => {
    expect(citeOfString(model, 'Aion (CW9ii) ¶426')).toEqual({ work: 'cw09ii', workTitle: 'Aion (CW9ii)', locator: '¶426' });
    expect(citeOfString(model, 'The Archetypes and the Collective Unconscious (CW9i) ¶352 (pdf p210)')).toMatchObject({ work: 'cw09i', locator: '¶352 (pdf p210)' });
    expect(citeOfString(model, "Children's Dreams pdf p436")).toMatchObject({ work: 'sem-childrens-dreams', locator: 'pdf p436' });
    expect(citeOfString(model, 'redbook pdf p232')).toMatchObject({ work: 'liber-novus', workTitle: expect.stringMatching(/Liber Novus/), locator: 'pdf p232' });
    expect(citeOfString(model, 'cw09i The Archetypes and the Collective Unconscious (CW9i) ¶190')).toMatchObject({ work: 'cw09i', workTitle: 'The Archetypes and the Collective Unconscious (CW9i)' });
  });
  it('stays a string when it names no work or no locator', () => {
    expect(citeOfString(model, 'Some letter, 1950')).toBe('Some letter, 1950');
    expect(citeOfString(model, 'Unheard Of Book ¶3')).toBe('Unheard Of Book ¶3');
  });
  it('every definition cite in the field is read to a Work and a locator', () => {
    const defs = [...field.archetypes, ...field.families, ...field.theoretics].flatMap((x) => (x.definition ? [x.definition] : []));
    expect(defs.length).toBeGreaterThan(100);
    const loose = defs.filter((d) => typeof citeOfString(model, d.cite) === 'string').map((d) => d.cite);
    expect(loose).toEqual([]);
    expect(definitionQuote(model, defs[0]).emphasis).toBe('lead');
  });
});
