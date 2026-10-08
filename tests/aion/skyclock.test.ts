import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { abbreviate, aquarianRows, crossCheck, placesAt, sectorOf, signOf, signSpans, SKY_CLOCK_LEDE, SKY_CLOCK_TWO_CLOCKS, spanText, yearText } from '../../src/aion/skyclock';
import { CONVENTIONS } from '../../src/aion/precession';
import type { History } from '../../src/types/history';

const reading = (JSON.parse(readFileSync(new URL('../../public/data/history.json', import.meta.url), 'utf8')) as History).readings[0];

describe('years as text', () => {
  it('names BCE and CE, and marks the approximate ones', () => {
    expect(yearText(-63.1, true)).toBe('c. 63 BCE');
    expect(yearText(2596.8, true)).toBe('c. 2,597 CE');
    expect(yearText(0)).toBe('0 CE');
    expect(spanText(0, 2143, false)).toBe('0 CE – 2,143 CE');
  });
});

describe('Jung\u2019s boundaries stay primary and unchanged', () => {
  it('lists the reading\u2019s own span for each sign first, exactly as the reading gives it', () => {
    for (const e of reading.epochs.filter((x) => !x.parentId)) {
      const rows = signSpans(reading, e.sign!);
      expect(rows[0]).toMatchObject({ key: 'jung-display', primary: true, from: e.from, to: e.to });
      expect(rows.slice(1).every((r) => !r.primary)).toBe(true);
      expect(rows.slice(1).map((r) => r.key)).toEqual([...CONVENTIONS]);
    }
  });
  it('Pisces: 0\u20132200 in the reading, 0\u20132143 as bare arithmetic, and the others labelled approximate', () => {
    const rows = signSpans(reading, 'Pisces');
    expect(rows.map((r) => [r.key, Math.round(r.from), Math.round(r.to), r.approximate])).toEqual([
      ['jung-display', 0, 2200, false], ['jung-equal', 0, 2143, false], ['fagan-bradley', 222, 2376, true], ['lahiri', 286, 2439, true], ['iau', -63, 2597, true],
    ]);
  });
  it('Taurus and Aries equal months coincide with the display\u2019s own boundaries', () => {
    for (const sign of ['Taurus', 'Aries']) {
      const [display, equal] = signSpans(reading, sign);
      expect([equal.from, equal.to]).toEqual([display.from, display.to]);
    }
  });
});

describe('the conditional Aquarian boundaries are calculations, from the reading', () => {
  it('carries Jung\u2019s 1997 and 2154 from its events, the 2000\u20132200 range, and each convention\u2019s own beginning', () => {
    const a = aquarianRows(reading);
    expect(a.calculations.map((c) => c.year)).toEqual([1997, 2154]);
    expect(a.range).toMatchObject({ from: 2000, to: 2200 });
    expect(a.conventions.map((c) => [c.convention, Math.round(c.year)])).toEqual([['jung-equal', 2143], ['fagan-bradley', 2376], ['lahiri', 2439], ['iau', 2597]]);
    expect(reading.epochs.find((e) => e.id === 'pisces')!.to).toBe(a.range.to);
  });
});

describe('the sign a card speaks of, and where the equinox stands', () => {
  it('reads an epoch\u2019s own sign, and an event\u2019s through its epoch', () => {
    expect(signOf(reading, reading.epochs.find((e) => e.id === 'pisces-first-fish')!)).toBe('Pisces');
    expect(signOf(reading, reading.events.find((e) => e.id === 'aquarius-alternative-1997')!)).toBe('Pisces');
  });
  it('7 BCE (Jung\u2019s conjunction): the conventions disagree — Aries in the three equal-sign readings, Pisces by the IAU boundaries', () => {
    const rows = placesAt(-6);
    expect(rows.map((r) => [r.convention, r.name])).toEqual([['jung-equal', 'Aries'], ['fagan-bradley', 'Aries'], ['lahiri', 'Aries'], ['iau', 'Pisces']]);
  });
  it('2026: Pisces everywhere', () => {
    expect(placesAt(2026).every((r) => r.name === 'Pisces')).toBe(true);
  });
  it('finds the sector holding a longitude, wrapping across 0\u00b0', () => {
    expect(sectorOf('lahiri', 350)).toEqual({ from: 330, to: 0, name: 'Pisces' });
    expect(sectorOf('iau', 10)).toMatchObject({ name: 'Pisces', from: 351.6526, to: 28.6889 });
    expect(sectorOf('iau', 250)).toMatchObject({ name: 'Ophiuchus' });
  });
  it('abbreviates names only, never glyphs', () => {
    expect(abbreviate('Sagittarius')).toBe('Sgr');
    expect(abbreviate('Ophiuchus')).toBe('Oph');
  });
});

describe('the cross-check and the fixed words', () => {
  it('says the IAU polynomial agrees near the present and does not far away', () => {
    expect(crossCheck(2026).agrees).toBe(true);
    expect(crossCheck(2026).text).toMatch(/agrees/);
    expect(crossCheck(-9000).agrees).toBe(false);
    expect(crossCheck(-9000).text).toMatch(/differs from the long-term model/);
  });
  it('carries no prediction language', () => {
    for (const t of [SKY_CLOCK_LEDE, SKY_CLOCK_TWO_CLOCKS]) expect(t).not.toMatch(/will |predict|destiny|foretell/i);
    expect(SKY_CLOCK_LEDE).toMatch(/Nothing here is a forecast/);
    expect(SKY_CLOCK_TWO_CLOCKS).toMatch(/Two clocks/);
  });
});
