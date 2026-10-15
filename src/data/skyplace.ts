// Where an occurrence hangs in the sky, in words. The one formatter the label, the reveal and the strip share, so a place
// is never described two ways. Pure: a locus in, a plain line out. The geometry is the card rings' own (types/field.ts).
import type { SkyLocus } from '../types/field';
import type { BodyKey } from '../types/sky';

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const SUITS = ['Wands', 'Cups', 'Swords', 'Disks'];

/** "the Sun", "the Moon", "the Earth", "Mars": a body as a sentence names it. */
export function bodyPhrase(key: BodyKey): string {
  if (key === 'sun') return 'the Sun';
  if (key === 'moon') return 'the Moon';
  if (key === 'terra') return 'the Earth';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** A body's name with no article, for a possessive or a list. */
export function bodyName(key: BodyKey): string {
  return key === 'terra' ? 'Earth' : key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * An ecliptic span as the zodiac reads it: a whole sign by its name, ten degrees inside a sign as "Aries 0°–10°", a span
 * that crosses a sign boundary as "20° Pisces – 20° Aries". `lon` is the start in degrees, `span` the width.
 */
export function spanPhrase(lon: number, span: number): string {
  const start = ((lon % 360) + 360) % 360;
  const si = Math.floor(start / 30) % 12;
  const d1 = start - si * 30;
  if (span >= 30 - 1e-9 && d1 < 1e-9) return span > 30 + 1e-9 ? `${SIGNS[si]} onward` : SIGNS[si];
  const end = start + span;
  const ei = Math.floor((end - 1e-9) / 30) % 12;
  const d2 = end - Math.floor((end - 1e-9) / 30) * 30;
  if (ei === si) return `${SIGNS[si]} ${Math.round(d1)}°–${Math.round(d2)}°`;
  return `${Math.round(d1)}° ${SIGNS[si]} – ${Math.round(d2)}° ${SIGNS[ei]}`;
}

/** One locus as a plain phrase: "Mars's decan wheel, Aries 0°–10°". */
export function locusPhrase(l: SkyLocus): string {
  const of = l.body ? bodyName(l.body) : '';
  switch (l.ring) {
    case 'body':
      return l.body ? bodyPhrase(l.body) : 'the sky';
    case 'wheel':
      return `${of}’s decan wheel, ${spanPhrase(l.lon ?? 0, l.span ?? 10)}`;
    case 'rank':
      return `${of}’s rank ring${l.slot !== undefined ? `, the card of ${SUITS[l.slot] ?? 'its suit'}` : ''}`;
    case 'zodiac':
      return `the zodiac, ${spanPhrase(l.lon ?? 0, l.span ?? 30)}`;
    case 'pole':
      return `the heavens round the North Pole${l.slot !== undefined ? `, the quadrant of ${SUITS[l.slot] ?? 'its suit'}` : ''}`;
  }
}

/** All of an occurrence's loci as one line, the most exact first (the order the data gives them). */
export function skyLine(loci: SkyLocus[] | undefined): string {
  return (loci ?? []).map(locusPhrase).join(' · ');
}

/** Which body to open for a locus: its own, or — for the zodiac and the pole, which no body holds — the Earth's sky. */
export function bodyOfLocus(l: SkyLocus): BodyKey {
  return l.body ?? 'terra';
}
