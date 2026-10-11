import { describe, expect, it } from 'vitest';
import { buildFixture } from '../../src/dev/fixture';
import { buildModel, type Subject } from '../../src/data/model';
import type { Field, Join, Theoretic } from '../../src/types/field';
import { relatedRows, SYSTEM_LABEL } from '../../src/ui/related';

// a tiny field: the fixture's archetypes and families, one theoretic, and joins that cover both directions,
// every system, a basis tie-break, a self-join, and a system the order does not name
const base = buildFixture();
const psychoid: Theoretic = {
  id: 'psychoid', name: 'The Psychoid', oneLine: 'The layer where psyche and matter are not yet apart.', ground: 'ontological',
  spectrum: { position: 0.5 }, palette: base.archetypes[0].palette, body: [], archetypes: [], families: [], theoretics: [], occurrenceCount: 0,
};
const joins: Join[] = [
  { id: 'self-serpent', a: { type: 'archetype', id: 'self' }, b: { type: 'family', id: 'serpent' }, basis: 'jung', system: 'jung', note: 'The coil holds the opposites.' },
  { id: 'serpent-psychoid', a: { type: 'family', id: 'serpent' }, b: { type: 'theoretic', id: 'psychoid' }, basis: 'inferred', system: 'alchemy', note: 'Both sit before the split.' },
  { id: 'serpent-anima', a: { type: 'family', id: 'serpent' }, b: { type: 'archetype', id: 'anima' }, basis: 'jung', system: 'alchemy', note: 'The watery coil.' },
  { id: 'serpent-great-mother', a: { type: 'family', id: 'serpent' }, b: { type: 'archetype', id: 'great-mother' }, basis: 'inferred', system: 'alchemy', note: 'The mother coils.' },
  { id: 'serpent-shadow', a: { type: 'family', id: 'serpent' }, b: { type: 'archetype', id: 'shadow' }, basis: 'jung', system: 'thoth', voice: 'Crowley', note: 'The serpent in the Tarot card.' },
  { id: 'self-tree', a: { type: 'archetype', id: 'self' }, b: { type: 'family', id: 'tree' }, basis: 'site', system: 'site', note: 'Read here: the axis.' },
  { id: 'self-mandala', a: { type: 'archetype', id: 'self' }, b: { type: 'family', id: 'mandala' }, basis: 'inferred', note: 'The centre drawn round.' },
  { id: 'mandala-self-join', a: { type: 'family', id: 'mandala' }, b: { type: 'family', id: 'mandala' }, basis: 'jung', system: 'qabalah', note: 'Named by itself.' },
  { id: 'tree-anima', a: { type: 'family', id: 'tree' }, b: { type: 'archetype', id: 'anima' }, basis: 'jung', system: 'mystery-x', note: 'An unnamed system.' },
];
const field: Field = { ...base, theoretics: [psychoid], joins };
const model = buildModel(field);

const rowsOf = (s: Subject) => relatedRows(model, s);
const serpent: Subject = { type: 'family', id: 'serpent' };
const self: Subject = { type: 'archetype', id: 'self' };

describe('relatedRows', () => {
  it('groups a node’s joins by system, in the fixed system order', () => {
    expect(rowsOf(self).map((g) => g.system)).toEqual(['jung', 'site', 'other']);
    expect(rowsOf(serpent).map((g) => g.system)).toEqual(['jung', 'alchemy', 'thoth']);
  });

  it('puts a system the order does not name after all the named ones', () => {
    expect(rowsOf({ type: 'family', id: 'tree' }).map((g) => g.system)).toEqual(['site', 'mystery-x']);
  });

  it('orders rows within a system: Jung before inferred before site, then by name', () => {
    const alchemy = rowsOf(serpent).find((g) => g.system === 'alchemy')!;
    expect(alchemy.rows.map((r) => r.name)).toEqual(['Anima', 'Great Mother', 'The Psychoid']);
    expect(alchemy.rows.map((r) => r.basis)).toEqual(['jung', 'inferred', 'inferred']);
  });

  it('lists a join from both of its ends, with the far end as the other node', () => {
    const fromSelf = rowsOf(self).find((g) => g.system === 'jung')!.rows[0];
    expect(fromSelf).toMatchObject({ other: { type: 'family', id: 'serpent' }, name: 'Serpent', joinId: 'self-serpent', basis: 'jung' });
    const fromSerpent = rowsOf(serpent).find((g) => g.system === 'jung')!.rows[0];
    expect(fromSerpent).toMatchObject({ other: { type: 'archetype', id: 'self' }, name: 'Self', joinId: 'self-serpent' });
  });

  it('carries the note, and the voice when the join has one', () => {
    const thoth = rowsOf(serpent).find((g) => g.system === 'thoth')!.rows[0];
    expect(thoth).toMatchObject({ name: 'Shadow', voice: 'Crowley', note: 'The serpent in the Tarot card.' });
    const alchemy = rowsOf(serpent).find((g) => g.system === 'alchemy')!.rows[0];
    expect(alchemy.voice).toBeUndefined();
  });

  it('files a join with no system under “other”', () => {
    const other = rowsOf(self).find((g) => g.system === 'other')!;
    expect(other.rows).toHaveLength(1);
    expect(other.rows[0]).toMatchObject({ joinId: 'self-mandala', name: 'Mandala' });
  });

  it('lists a self-join once', () => {
    const mandala = rowsOf({ type: 'family', id: 'mandala' });
    const hits = mandala.flatMap((g) => g.rows).filter((r) => r.joinId === 'mandala-self-join');
    expect(hits).toHaveLength(1);
    expect(hits[0].other).toEqual({ type: 'family', id: 'mandala' });
  });

  it('returns no groups for a node with no joins', () => {
    const bare = buildModel(buildFixture());
    expect(relatedRows(bare, serpent)).toEqual([]);
    expect(relatedRows(model, { type: 'family', id: 'cave' })).toEqual([]);
  });

  it('labels the systems the sheet names', () => {
    expect(SYSTEM_LABEL).toMatchObject({ jung: 'Jung', alchemy: 'Alchemy', thoth: 'Thoth tarot', qabalah: 'Qabalah', astrology: 'Astrology', burt: 'Burt', site: 'Read here', other: 'Also' });
  });
});
