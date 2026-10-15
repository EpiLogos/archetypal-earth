import { describe, expect, it } from 'vitest';
import { bodyOfLocus, bodyPhrase, locusPhrase, skyLine, spanPhrase } from '../../src/data/skyplace';

describe('an ecliptic span in the zodiac’s words', () => {
  it('names a whole sign by its name', () => {
    expect(spanPhrase(0, 30)).toBe('Aries');
    expect(spanPhrase(330, 30)).toBe('Pisces');
  });
  it('gives ten degrees inside a sign as degrees of it', () => {
    expect(spanPhrase(0, 10)).toBe('Aries 0°–10°');
    expect(spanPhrase(70, 10)).toBe('Gemini 10°–20°');
    expect(spanPhrase(350, 10)).toBe('Pisces 20°–30°');
  });
  it('gives a span across a boundary as its two ends, the year’s end included', () => {
    expect(spanPhrase(230, 30)).toBe('20° Scorpio – 20° Sagittarius');
    expect(spanPhrase(350, 30)).toBe('20° Pisces – 20° Aries');
  });
});

describe('a locus in words', () => {
  it('says a body as a sentence names it', () => {
    expect(bodyPhrase('terra')).toBe('the Earth');
    expect(bodyPhrase('sun')).toBe('the Sun');
    expect(bodyPhrase('mars')).toBe('Mars');
  });
  it('says each ring', () => {
    expect(locusPhrase({ body: 'mars', ring: 'wheel', lon: 0, span: 10, basis: 'site', via: [] })).toBe('Mars’s decan wheel, Aries 0°–10°');
    expect(locusPhrase({ body: 'pluto', ring: 'rank', slot: 0, basis: 'site', via: [] })).toBe('Pluto’s rank ring, the card of Wands');
    expect(locusPhrase({ ring: 'zodiac', lon: 30, span: 30, basis: 'site', via: [] })).toBe('the zodiac, Taurus');
    expect(locusPhrase({ body: 'terra', ring: 'body', basis: 'site', via: [] })).toBe('the Earth');
    expect(locusPhrase({ ring: 'pole', slot: 2, basis: 'site', via: [] })).toBe('the heavens round the North Pole, the quadrant of Swords');
  });
  it('lists several, and opens the Earth’s sky for a place no body holds', () => {
    const a = { body: 'mars' as const, ring: 'wheel' as const, lon: 0, span: 10, basis: 'site' as const, via: [] };
    const z = { ring: 'zodiac' as const, lon: 0, span: 10, basis: 'site' as const, via: [] };
    expect(skyLine([a, z])).toBe('Mars’s decan wheel, Aries 0°–10° · the zodiac, Aries 0°–10°');
    expect(skyLine(undefined)).toBe('');
    expect(bodyOfLocus(a)).toBe('mars');
    expect(bodyOfLocus(z)).toBe('terra');
  });
});
