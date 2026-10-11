import { describe, expect, it } from 'vitest';
import { SIGNS } from '../../src/sky/frames';
import { GLYPHS, SIGN_FAMILY_IDS, signFamilyId } from '../../src/sky/zodiac';

describe('sign families', () => {
  it('maps Aries 0 … Pisces 11 to the twelve family ids, in glyph order', () => {
    expect(SIGN_FAMILY_IDS).toHaveLength(12);
    expect(GLYPHS).toHaveLength(12);
    expect(signFamilyId(0)).toBe('aries');
    expect(signFamilyId(11)).toBe('pisces');
    expect(signFamilyId(4)).toBe('leo');
  });

  it('is the sign name in lower case, so the ids match the sky’s own sign names', () => {
    expect([...SIGN_FAMILY_IDS]).toEqual(SIGNS.map((s) => s.toLowerCase()));
  });

  it('is undefined outside the twelve, and for anything that is not a whole sign', () => {
    expect(signFamilyId(-1)).toBeUndefined();
    expect(signFamilyId(12)).toBeUndefined();
    expect(signFamilyId(1.5)).toBeUndefined();
    expect(signFamilyId(Number.NaN)).toBeUndefined();
  });
});
