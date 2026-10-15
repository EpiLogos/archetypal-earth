// Where the field's sky-tied nodes hang: one derivation (scripts/lib/sky-address.mjs) read by the card rings and by the
// occurrences' extraterrestrial placement. The point of these tests is that a ring and a place cannot disagree.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ESM script
import { parseCourt, parseDecan, parseRank, skyAddresses, SIGNS, SUITS } from '../../scripts/lib/sky-address.mjs';
import type { Field, SkyLocus } from '../../src/types/field';
import type { SkyCardsData } from '../../src/sky/cards';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const field: Field = read('public/data/field.json');
const cards: SkyCardsData = read('public/data/sky-cards.json');
const cur = read('curation/sky/cards.json');
const fam = new Map(field.families.map((f) => [f.id, f]));

function derive() {
  const errors: string[] = [];
  const { addresses } = skyAddresses({ cur, famIds: new Set(fam.keys()), famName: (id: string) => fam.get(id)?.name, joins: field.joins, errors });
  return { addresses: addresses as Map<string, SkyLocus[]>, errors };
}

describe('the parsers', () => {
  it('read a decan, a rank card and a court card from the family id alone', () => {
    expect(parseDecan('decan-aries-1')).toEqual({ sign: 0, n: 1, lon: 0 });
    expect(parseDecan('decan-pisces-3')).toEqual({ sign: 11, n: 3, lon: 350 });
    expect(parseDecan('decan-ophiuchus-1')).toBeNull();
    expect(parseRank('thoth-ace-of-cups')).toEqual({ number: 1, suit: 'cups' });
    expect(parseRank('thoth-queen-of-cups')).toBeNull();
    expect(parseCourt('thoth-princess-of-disks')).toEqual({ court: 'princess', suit: 'disks' });
  });
});

describe('the addresses', () => {
  const { addresses, errors } = derive();
  const at = (id: string) => addresses.get(id) ?? [];

  it('derive without a single complaint from the field and the card curation', () => {
    expect(errors).toEqual([]);
  });

  it('put a sign on the zodiac for thirty degrees and a decan for ten', () => {
    expect(at('aries')).toEqual([expect.objectContaining({ ring: 'zodiac', lon: 0, span: 30 })]);
    expect(at('decan-gemini-2')).toEqual([expect.objectContaining({ ring: 'zodiac', lon: 70, span: 10 })]);
  });

  it('hang a pip card on its ruler’s decan wheel at its decan, and on its number’s rank ring', () => {
    const l = at('thoth-two-of-wands');
    expect(l).toContainEqual(expect.objectContaining({ body: 'mars', ring: 'wheel', lon: 0, span: 10 }));
    expect(l).toContainEqual(expect.objectContaining({ body: 'neptune', ring: 'rank', slot: SUITS.indexOf('wands') }));
  });

  it('give an Ace the rank ring of the body whose number is one, and no decan', () => {
    expect(at('thoth-ace-of-swords')).toEqual([expect.objectContaining({ body: 'pluto', ring: 'rank', slot: SUITS.indexOf('swords') })]);
  });

  it('give a court card thirty degrees from the 20th of one sign to the 20th of the next, across the year’s end too', () => {
    expect(at('thoth-knight-of-wands')).toEqual([expect.objectContaining({ ring: 'zodiac', lon: 7 * 30 + 20, span: 30 })]);
    expect(at('thoth-queen-of-wands')).toEqual([expect.objectContaining({ ring: 'zodiac', lon: 11 * 30 + 20, span: 30 })]);
  });

  it('give a Princess the heavens round the pole, a quadrant to a suit in Crowley’s order', () => {
    for (const [i, s] of SUITS.entries()) expect(at(`thoth-princess-of-${s}`)).toEqual([expect.objectContaining({ ring: 'pole', slot: i })]);
  });

  it('put a sephira on the body that carries its number and an element on the Earth', () => {
    expect(at('kether')).toEqual([expect.objectContaining({ body: 'pluto', ring: 'body' })]);
    expect(at('tiphareth')).toEqual([expect.objectContaining({ body: 'sun', ring: 'body' })]);
    expect(at('malkuth')).toEqual([expect.objectContaining({ body: 'terra', ring: 'body' })]);
    expect(at('air')).toEqual([expect.objectContaining({ body: 'terra', ring: 'body' })]);
  });

  it('stand a sign’s Atu on the sign’s span when no ring holds it, and keep it on the ruler’s ring when one does', () => {
    expect(at('thoth-hierophant')).toEqual([expect.objectContaining({ ring: 'zodiac', lon: 30, span: 30 })]);
    expect(at('thoth-tower')).toContainEqual(expect.objectContaining({ body: 'mars', ring: 'rank' }));
  });

  it('place nothing the joins and the curation do not: a function, a suit, the deck itself have no place in the sky', () => {
    for (const id of ['thinking', 'feeling', 'sensation', 'intuition', 'thoth-wands', 'thoth-tarot', 'thoth-major-arcana', 'quintessence', 'ether', 'spiritus']) {
      expect(addresses.has(id), id).toBe(false);
    }
  });

  it('rest every locus on a basis and the joins it rests on', () => {
    const joinIds = new Set((field.joins ?? []).map((j) => j.id));
    for (const [id, list] of addresses) for (const l of list) {
      expect(['jung', 'inferred', 'site'], id).toContain(l.basis);
      for (const j of l.via) expect(joinIds.has(j), `${id} via ${j}`).toBe(true);
    }
  });
});

describe('a ring and a place cannot disagree', () => {
  const { addresses } = derive();

  it('every card the card rings draw hangs, in the data, exactly where it is drawn', () => {
    const miss: string[] = [];
    for (const [body, b] of Object.entries(cards.bodies)) {
      if (!b) continue;
      for (const d of b.decans) if (!(addresses.get(d.card) ?? []).some((l) => l.body === body && l.ring === 'wheel' && l.lon === d.lon)) miss.push(`${d.card} on ${body}'s wheel at ${d.lon}`);
      for (const r of b.ranks) if (!(addresses.get(r.card) ?? []).some((l) => l.body === body && l.ring === 'rank')) miss.push(`${r.card} on ${body}'s rank ring`);
      for (const m of b.majors) if (!(addresses.get(m.card) ?? []).some((l) => l.body === body && l.ring === 'rank')) miss.push(`${m.card} (Atu) on ${body}'s rank ring`);
      if (b.sephira && !(addresses.get(b.sephira) ?? []).some((l) => l.body === body && l.ring === 'body')) miss.push(`${b.sephira} at ${body}`);
    }
    expect(miss).toEqual([]);
  });

  it('every occurrence’s sky placement is the derivation’s own, for the families it attests', () => {
    const drift: string[] = [];
    for (const o of field.occurrences) {
      if (!o.sky?.length) continue;
      const want = addresses.get(o.familyId) ?? [];
      const strip = (l: SkyLocus) => JSON.stringify({ body: l.body, ring: l.ring, lon: l.lon, span: l.span, slot: l.slot });
      if (JSON.stringify(o.sky.map(strip)) !== JSON.stringify(want.map(strip))) drift.push(o.id);
    }
    expect(drift).toEqual([]);
  });

  it('knows its twelve signs', () => {
    expect(SIGNS).toHaveLength(12);
  });
});
