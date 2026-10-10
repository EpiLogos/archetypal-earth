import { describe, expect, it } from 'vitest';
import { astrologyAt, back, focusOn, inSky, stateEq, withMode, WORLD } from '../../src/state/store';
import { hashToState, stateToHash, type Resolver } from '../../src/state/router';

const r: Resolver = {
  hasArchetype: (id) => ['self', 'shadow', 'syzygy'].includes(id),
  hasFamily: (id) => ['serpent'].includes(id),
  hasCulture: (id) => ['norse', 'greek'].includes(id),
  hasPlace: (id) => id === 'chartres',
  familyOf: () => undefined,
  hasBody: (id) => ['sun', 'moon', 'mars'].includes(id),
};

describe('the sky state', () => {
  it('stands over the world view and is not the world', () => {
    const s = inSky();
    expect(s.view).toEqual({ kind: 'world' });
    expect(stateEq(s, WORLD)).toBe(false);
  });

  it('Back closes a card onto the sky, then the sky onto the Earth', () => {
    const s = inSky({ body: 'moon' });
    expect(back(s)).toEqual(inSky());
    expect(back(inSky())).toEqual(WORLD);
  });

  it('a natal sky survives closing its body card, and Back leaves it step by step', () => {
    const s = inSky({ natal: 'jung', body: 'sun' });
    expect(back(s)).toEqual(inSky({ natal: 'jung' }));
    expect(back(inSky({ natal: 'jung' }))).toEqual(WORLD);
  });

  it('Astrology climbs its walk: body, then chart, then its landing, then the Earth', () => {
    expect(back(astrologyAt(['jung', 'saturn']))).toEqual(astrologyAt(['jung']));
    expect(back(astrologyAt(['jung']))).toEqual(astrologyAt([]));
    expect(back(astrologyAt([]))).toEqual(WORLD);
  });

  it('focusing a subject or changing mode leaves the sky behind', () => {
    const f = focusOn(inSky(), { type: 'family', id: 'serpent' });
    expect(f.sky).toBeUndefined();
    expect(withMode(inSky(), true).sky).toBeUndefined();
  });

  it('round-trips through the hash', () => {
    for (const s of [inSky(), inSky({ body: 'mars' }), inSky({ culture: 'norse' }), inSky({ body: 'mars', culture: 'norse' })]) {
      const h = stateToHash(s);
      expect(h.startsWith('#/sky')).toBe(true);
      expect(hashToState(h, r).state, h).toEqual(s);
    }
    for (const s of [astrologyAt([]), astrologyAt(['you']), astrologyAt(['jung', 'mars'])]) {
      const h = stateToHash(s);
      expect(h.startsWith('#/astrology')).toBe(true);
      expect(hashToState(h, r).state, h).toEqual(s);
    }
  });

  it('no route carries a birth: a natal sky is named by its chart only', () => {
    expect(stateToHash(astrologyAt(['you', 'moon']))).toBe('#/astrology/you/moon');
    expect(astrologyAt(['you', 'moon']).sky).toEqual({ natal: 'you', body: 'moon' });
  });

  it('reads the deep-link forms', () => {
    expect(hashToState('#/sky', r).state).toEqual(inSky());
    expect(hashToState('#/sky/moon', r).state).toEqual(inSky({ body: 'moon' }));
    // the old birth links carried a birth moment: they open Astrology with the form filled from it; the state names no birth
    const old = hashToState('#/sky/birth/1875-07-26T19:25/47.55/9.2', r);
    expect(old.state).toEqual(astrologyAt([]));
    expect(old.birthPrefill).toEqual({ date: '1875-07-26', time: '19:25', lat: 47.55, lon: 9.2 });
    expect(hashToState('#/sky/birth/not-a-date/1/2', r).birthPrefill).toBeUndefined();
    expect(hashToState('#/sky/birth/1875-07-26T19:25/95/9.2', r).birthPrefill).toBeUndefined();
  });

  it('closing a card keeps the culture the sky is read through', () => {
    expect(back(inSky({ body: 'mars', culture: 'norse' }))).toEqual(inSky({ culture: 'norse' }));
    expect(stateEq(inSky({ culture: 'norse' }), inSky())).toBe(false);
  });

  it('ignores a culture the field does not have', () => {
    expect(hashToState('#/sky/mars/c/atlantis', r).state).toEqual(inSky({ body: 'mars' }));
  });

  it('refuses what it cannot honour: an unknown body is the plain sky, an odd chart name is Astrology’s landing', () => {
    expect(hashToState('#/sky/vulcan', r).state).toEqual(inSky());
    expect(hashToState('#/astrology/jung/vulcan', r).state).toEqual(astrologyAt(['jung']));
    expect(hashToState('#/astrology/1875-07-26T19:25', r).state).toEqual(astrologyAt([]));
  });
});
