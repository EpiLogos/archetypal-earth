import { describe, expect, it } from 'vitest';
import { buildFixture } from '../../src/dev/fixture';
import { buildModel, type Subject } from '../../src/data/model';
import type { Family, Field, ImageRef, Join, Theoretic } from '../../src/types/field';
import { relatedPlates, relatedRows, SYSTEM_LABEL } from '../../src/ui/related';

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

describe('relatedRows: the far node’s plate', () => {
  it('carries the far node’s image and palette on the row; a node with none carries none', () => {
    const rows = rowsOf(self).flatMap((g) => g.rows);
    const serpentRow = rows.find((r) => r.joinId === 'self-serpent')!;
    expect(serpentRow.image).toEqual(model.famById.get('serpent')!.image);
    expect(serpentRow.palette).toEqual(model.famById.get('serpent')!.palette);
    // a family the fixture gives no image: the row has no image key at all
    const bareFam = { ...model.famById.get('tree')!, image: undefined };
    const m2 = buildModel({ ...field, families: field.families.map((f) => (f.id === 'tree' ? bareFam : f)) });
    const treeRow = relatedRows(m2, self).flatMap((g) => g.rows).find((r) => r.joinId === 'self-tree')!;
    expect(treeRow.image).toBeUndefined();
    expect('image' in treeRow).toBe(false);
  });
});

// a node with no image of its own and joins to cards, signs and a sephira, some without a plate
const img = (name: string, src = `img/families/${name}.jpg`): ImageRef => ({
  src, thumb: src.replace(/\.jpg$/, '.thumb.jpg'), width: 600, height: 900, title: name, credit: 'Test', license: 'Public domain', sourceUrl: '',
});
const proto = base.families[0];
const fam = (id: string, name: string, image?: ImageRef): Family => ({ ...proto, id, name, image, archetypes: [], aliases: [] });
const plateField = (families: Family[], joinsList: Join[]): Field => ({ ...base, families, theoretics: [], joins: joinsList });
const jn = (id: string, other: string, system: string, basis: Join['basis'] = 'site'): Join => ({
  id, a: { type: 'family', id: 'kether-x' }, b: { type: 'family', id: other }, basis, system, note: 'n',
});
const KETHER: Subject = { type: 'family', id: 'kether-x' };

describe('relatedPlates', () => {
  const families = [
    fam('kether-x', 'Kether'),
    fam('thoth-ace-wands', 'Ace of Wands', img('thoth-ace-wands')),
    fam('thoth-ace-cups', 'Ace of Cups', img('thoth-ace-cups')),
    fam('thoth-magus', 'Atu I · The Magus', img('thoth-magus')),
    fam('mercury', 'Mercury', img('mercury')),
    fam('aries', 'Aries', img('aries')),
    fam('tree', 'Tree', img('tree')),
    fam('chokmah', 'Chokmah'),
    fam('twin', 'Aries twin', img('twin', 'img/families/aries.jpg')),
  ];
  const js = [
    jn('k-tree', 'tree', 'qabalah', 'jung'),
    jn('k-aries', 'aries', 'astrology'),
    jn('k-mercury', 'mercury', 'alchemy'),
    jn('k-wands', 'thoth-ace-wands', 'thoth'),
    jn('k-magus', 'thoth-magus', 'qabalah'),
    jn('k-cups', 'thoth-ace-cups', 'thoth'),
    jn('k-chokmah', 'chokmah', 'qabalah'),
    jn('k-twin', 'twin', 'astrology'),
  ];
  const m = buildModel(plateField(families, js));

  it('draws plates from the joined nodes that have one, cards first, then by system order', () => {
    const out = relatedPlates(m, KETHER, 8);
    // cards: thoth system before qabalah (Ace of Cups, Ace of Wands by name, then the Magus); then alchemy, astrology, qabalah
    expect(out.map((p) => p.name)).toEqual(['Ace of Cups', 'Ace of Wands', 'Atu I · The Magus', 'Mercury', 'Aries', 'Tree']);
    expect(out.map((p) => p.system)).toEqual(['thoth', 'thoth', 'qabalah', 'alchemy', 'astrology', 'qabalah']);
    expect(out[0]).toMatchObject({ other: { type: 'family', id: 'thoth-ace-cups' }, image: { src: 'img/families/thoth-ace-cups.jpg' } });
  });

  it('skips a node with no image, so it never makes a placeholder', () => {
    expect(relatedPlates(m, KETHER, 20).some((p) => p.name === 'Chokmah')).toBe(false);
  });

  it('takes a plate shared by two nodes once (the first in order keeps it)', () => {
    const out = relatedPlates(m, KETHER, 20);
    expect(out.filter((p) => p.image.src === 'img/families/aries.jpg')).toHaveLength(1);
    expect(out.map((p) => p.name)).not.toContain('Aries twin');
  });

  it('takes a node joined twice once', () => {
    const twice = buildModel(plateField(families, [...js, jn('k-aries-2', 'aries', 'thoth')]));
    const out = relatedPlates(twice, KETHER, 20);
    expect(out.filter((p) => p.name === 'Aries')).toHaveLength(1);
    // the better-ranked of its two joins is the one it stands by (the thoth system, a card or not)
    expect(out.find((p) => p.name === 'Aries')!.system).toBe('thoth');
  });

  it('is cut at the limit, keeping the best-ranked', () => {
    expect(relatedPlates(m, KETHER, 3).map((p) => p.name)).toEqual(['Ace of Cups', 'Ace of Wands', 'Atu I · The Magus']);
    expect(relatedPlates(m, KETHER)).toHaveLength(6);
  });

  it('is the strip of a node with no image: none when the node has its own image', () => {
    const own = families.map((f) => (f.id === 'kether-x' ? { ...f, image: img('kether-x') } : f));
    expect(relatedPlates(buildModel(plateField(own, js)), KETHER, 8)).toEqual([]);
  });

  it('is empty when fewer than two joined nodes have a plate', () => {
    const one = buildModel(plateField(families, [jn('k-aries', 'aries', 'astrology'), jn('k-chokmah', 'chokmah', 'qabalah')]));
    expect(relatedPlates(one, KETHER, 8)).toEqual([]);
    // two joins that lead to one file are one plate
    const same = buildModel(plateField(families, [jn('k-aries', 'aries', 'astrology'), jn('k-twin', 'twin', 'astrology')]));
    expect(relatedPlates(same, KETHER, 8)).toEqual([]);
    const two = buildModel(plateField(families, [jn('k-aries', 'aries', 'astrology'), jn('k-mercury', 'mercury', 'alchemy')]));
    expect(relatedPlates(two, KETHER, 8)).toHaveLength(2);
  });

  it('finds the plates of joins listed from the other end', () => {
    const rev = buildModel(plateField(families, [
      { id: 'a', a: { type: 'family', id: 'aries' }, b: { type: 'family', id: 'kether-x' }, basis: 'site', system: 'astrology', note: 'n' },
      { id: 'b', a: { type: 'family', id: 'mercury' }, b: { type: 'family', id: 'kether-x' }, basis: 'site', system: 'alchemy', note: 'n' },
    ]));
    expect(relatedPlates(rev, KETHER, 8).map((p) => p.name)).toEqual(['Mercury', 'Aries']);
  });
});
