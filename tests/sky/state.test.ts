import { describe, expect, it } from 'vitest';
import { back, focusOn, inSky, stateEq, withMode, WORLD } from '../../src/state/store';
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

  it('a birth sky survives closing its body card, and Back leaves it step by step', () => {
    const birth = { local: '1875-07-26T19:25', lat: 47.55, lon: 9.2 };
    const s = inSky({ birth, body: 'sun' });
    expect(back(s)).toEqual(inSky({ birth }));
    expect(back(inSky({ birth }))).toEqual(WORLD);
  });

  it('focusing a subject or changing mode leaves the sky behind', () => {
    const f = focusOn(inSky(), { type: 'family', id: 'serpent' });
    expect(f.sky).toBeUndefined();
    expect(withMode(inSky(), true).sky).toBeUndefined();
  });

  it('round-trips through the hash', () => {
    const birth = { local: '1875-07-26T19:25', lat: 47.55, lon: 9.2 };
    for (const s of [inSky(), inSky({ body: 'mars' }), inSky({ birth }), inSky({ birth, body: 'sun' }), inSky({ culture: 'norse' }), inSky({ body: 'mars', culture: 'norse' }), inSky({ birth, body: 'sun', culture: 'greek' })]) {
      const h = stateToHash(s);
      expect(h.startsWith('#/sky')).toBe(true);
      expect(hashToState(h, r).state, h).toEqual(s);
    }
  });

  it('reads the deep-link forms', () => {
    expect(hashToState('#/sky', r).state).toEqual(inSky());
    expect(hashToState('#/sky/moon', r).state).toEqual(inSky({ body: 'moon' }));
    expect(hashToState('#/sky/birth/1875-07-26T19:25/47.55/9.2', r).state.sky?.birth).toEqual({ local: '1875-07-26T19:25', lat: 47.55, lon: 9.2 });
  });

  it('closing a card keeps the culture the sky is read through', () => {
    expect(back(inSky({ body: 'mars', culture: 'norse' }))).toEqual(inSky({ culture: 'norse' }));
    expect(stateEq(inSky({ culture: 'norse' }), inSky())).toBe(false);
  });

  it('ignores a culture the field does not have', () => {
    expect(hashToState('#/sky/mars/c/atlantis', r).state).toEqual(inSky({ body: 'mars' }));
  });

  it('refuses what it cannot honour: unknown bodies and malformed or out-of-range births fall back to the plain sky', () => {
    expect(hashToState('#/sky/vulcan', r).state).toEqual(inSky());
    for (const h of ['#/sky/birth/yesterday/1/1', '#/sky/birth/1875-07-26T19:25/91/0', '#/sky/birth/1875-07-26T19:25/0/181', '#/sky/birth/1875-07-26T19:25/x/y', '#/sky/birth']) {
      expect(hashToState(h, r).state, h).toEqual(inSky());
    }
  });
});
