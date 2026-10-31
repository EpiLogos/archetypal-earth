import { describe, expect, it } from 'vitest';
import { scopeChip } from '../../src/shell/scope-chip';
import { chips } from '../../src/shell/filter';

describe('the lens scope as a dock chip', () => {
  it('names the set and its count while the scope stands', () => {
    expect(scopeChip({ label: '“Aion”', own: 523 }, false)).toEqual({ label: '523 in “Aion”', aria: 'Set “Aion” aside and show the whole field', off: false });
  });
  it('groups thousands the same way the field does', () => {
    expect(scopeChip({ label: 'the field', own: 12345 }, false)?.label).toBe('12,345 in the field');
  });
  it('stays, removed, as the way back to the lens set', () => {
    expect(scopeChip({ label: 'the Red Book', own: 37 }, true)).toEqual({ label: 'Only the Red Book', aria: 'Show only the Red Book again', off: true });
  });
  it('is nothing without a scope', () => {
    expect(scopeChip(null, false)).toBeNull();
    expect(scopeChip(null, true)).toBeNull();
  });
});

describe('a filter chip says which dimension it narrows', () => {
  const names = { work: (i: string) => i, culture: (i: string) => i, archetype: (i: string) => i, theoretic: (i: string) => i };
  it('carries a kind for each dimension in force', () => {
    const cs = chips({ works: ['w'], cultures: ['c'], kinds: ['dream'], archetypes: ['self'], theoretics: ['psychoid'], subjects: ['jung'], rings: ['zodiac'] }, names);
    expect(cs.map((c) => c.kind)).toEqual(['Source', 'Culture', 'Kind', 'Archetype', 'Theory', 'Whose', 'Sky ring']);
  });
  it('takes only its own dimension off', () => {
    const cs = chips({ archetypes: ['self'], kinds: ['dream'] }, names);
    expect(cs.find((c) => c.kind === 'Archetype')!.without).toEqual({ kinds: ['dream'] });
  });
});
