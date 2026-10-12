import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardTies, decanOf, restAngle, ringsFor, type SkyCardsData } from '../../src/sky/cards';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const data = read('public/data/sky-cards.json') as SkyCardsData;
const field = read('public/data/field.json');
const pages = read('public/data/field-pages.json');
const joinIds = new Set<string>(field.joins.map((j: { id: string }) => j.id));

describe('the card rings’ data', () => {
  it('gives every classical planet its decans and its rank, and the 36 decans are all drawn once', () => {
    const all = Object.values(data.bodies).flatMap((b) => b!.decans);
    expect(all).toHaveLength(36);
    expect(new Set(all.map((d) => d.decan)).size).toBe(36);
    for (const k of ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'] as const) {
      const b = data.bodies[k]!;
      expect(b.decans.length, k).toBeGreaterThanOrEqual(5);
      expect(b.ranks, k).toHaveLength(4);
    }
  });

  it('gives the outer planets and the Earth only what Crowley’s list gives them', () => {
    expect(data.bodies.pluto!.sephira).toBe('kether');
    expect(data.bodies.neptune!.sephira).toBe('chokmah');
    expect(data.bodies.terra!.sephira).toBe('malkuth');
    expect(data.bodies.terra!.elements).toEqual(['fire', 'water', 'air', 'earth-element']);
    // Uranus is the Abyss: no number, so no rank and no card
    expect(data.bodies.uranus!.abyss).toBe(true);
    expect(data.bodies.uranus!.ranks).toHaveLength(0);
    expect(ringsFor(data, 'uranus')).toBeNull();
  });

  it('holds every body to a quotation: its place in the list is placed in the corpus', () => {
    for (const [k, b] of Object.entries(data.bodies)) {
      expect(b!.positionQuotes.length, k).toBeGreaterThan(0);
      for (const q of b!.positionQuotes) {
        expect(q.cite.work).toBe('book-of-thoth');
        expect(q.cite.locator).toBe('pdf p111');
      }
    }
  });

  it('rests every card’s place on a join of the field, and says which have no placed quotation', () => {
    for (const b of Object.values(data.bodies)) {
      for (const x of [...b!.decans, ...b!.ranks, ...b!.majors]) {
        for (const id of x.joins) {
          expect(joinIds.has(id), id).toBe(true);
          if (!pages.joins[id]?.length) expect(data.uncited, id).toContain(id);
        }
      }
    }
  });

  it('gives each drawn card a plate and a name', () => {
    const drawn = new Set(Object.values(data.bodies).flatMap((b) => [...b!.decans, ...b!.ranks, ...b!.majors].map((x) => x.card)));
    for (const id of drawn) {
      expect(data.cards[id], id).toBeTruthy();
      expect(data.cards[id].image.thumb, id).toMatch(/\.thumb\.jpg$/);
      expect(data.cards[id].name.length, id).toBeGreaterThan(2);
    }
  });

  it('puts a decan card at the middle of its ten degrees, in zodiacal order', () => {
    const r = ringsFor(data, 'mars')!;
    expect(r.decan.map((c) => c.lon)).toEqual([5, 75, 145, 215, 285, 355]);
    expect(r.decan.map((c) => c.id)).toEqual(['thoth-two-of-wands', 'thoth-nine-of-swords', 'thoth-seven-of-wands', 'thoth-five-of-cups', 'thoth-three-of-disks', 'thoth-ten-of-cups']);
  });

  it('spreads the rank ring evenly from its start, the planet’s own Atu first and then the four of its number', () => {
    const r = ringsFor(data, 'mars')!;
    expect(r.rank.map((c) => c.id)).toEqual(['thoth-tower', 'thoth-emperor', 'thoth-five-of-wands', 'thoth-five-of-cups', 'thoth-five-of-swords', 'thoth-five-of-disks']);
    const step = 360 / r.rank.length;
    const start = r.rank[0].lon;
    r.rank.forEach((c, i) => expect(c.lon).toBeCloseTo((start + i * step) % 360, 6));
    // …turned to stand as far as it can from the decan cards (six and six cannot do better than 5° apart)
    const near = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
    for (const c of r.rank) for (const d of r.decan) expect(near(c.lon, d.lon)).toBeGreaterThanOrEqual(5 - 1e-9);
    // a sign’s Atu a planet rules is tinted by its sign, not by where the spread put it
    expect(r.rank.find((c) => c.id === 'thoth-emperor')!.tintLon).toBe(15);
  });

  it('turns a spread of cards to stand farthest from some longitudes', () => {
    expect(restAngle(0, [10])).toBe(45);
    expect(restAngle(4, [])).toBe(45);
    // four cards 90° apart, a longitude at 0°: the best turn is 45° (every card 45° from it)
    expect(restAngle(4, [0])).toBe(45);
    // two longitudes 180° apart and two cards 180° apart: the cards sit 90° from both
    expect(restAngle(2, [0, 180])).toBe(90);
  });

  it('counts which decan a longitude stands in', () => {
    expect(decanOf(0)).toBe(0);
    expect(decanOf(9.99)).toBe(0);
    expect(decanOf(10)).toBe(1);
    expect(decanOf(359.9)).toBe(35);
    expect(decanOf(-1)).toBe(35);
  });

  it('turns the cards into ties a card’s page can say “See in sky” from, once each', () => {
    const ties = cardTies(data);
    const key = (t: (typeof ties)[number]) => `${t.body}|${t.id}`;
    expect(new Set(ties.map(key)).size).toBe(ties.length);
    expect(ties.find((t) => t.body === 'jupiter' && t.id === 'thoth-four-of-cups')).toBeTruthy();
    expect(ties.find((t) => t.body === 'terra' && t.id === 'fire')).toBeTruthy();
    expect(ties.every((t) => t.basis === 'site')).toBe(true);
  });
});
