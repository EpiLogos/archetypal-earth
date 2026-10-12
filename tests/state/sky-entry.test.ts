import { describe, expect, it } from 'vitest';
import { astrologyAt, astrologyLive, back, focusOn, inSky, skyGestureState, stateEq, WORLD, type AppState } from '../../src/state/store';
import { hashToState, stateToHash, type Resolver } from '../../src/state/router';
import { SKY_ENTER, SKY_EXIT } from '../../src/sky/stages';

const r: Resolver = {
  hasArchetype: (id) => ['self', 'shadow'].includes(id),
  hasTheoretic: () => false,
  hasFamily: (id) => ['serpent'].includes(id),
  hasCulture: (id) => ['norse', 'greek'].includes(id),
  hasPlace: () => false,
  familyOf: () => undefined,
  hasBody: (id) => ['sun', 'moon', 'mars', 'saturn'].includes(id),
};

const EDGES = { enter: SKY_ENTER, exit: SKY_EXIT };
const FAR = SKY_ENTER + 10;
const NEAR = SKY_EXIT - 5;

/** A bare sky is the state the Field used to show with no lens: the sky flag over the world, and no Astrology behind it. */
const isBare = (s: AppState) => !!s.sky && !s.lens;

describe('entering the sky from the Field', () => {
  it('zooming out from the globe enters Astrology on the live sky, never a bare sky', () => {
    const next = skyGestureState(WORLD, FAR, EDGES, true);
    expect(next).toEqual(astrologyLive());
    expect(isBare(next!)).toBe(false);
  });

  it('zooming out from a focus (the default landing, The Self) enters Astrology too, and leaves the focus behind', () => {
    const focus = focusOn(WORLD, { type: 'archetype', id: 'self' });
    const next = skyGestureState(focus, FAR, EDGES, true);
    expect(next).toEqual(astrologyLive());
    expect(next!.view).toEqual({ kind: 'world' });
  });

  it('a gesture inside the sky edge does not enter; a scripted move (no wheel) does not leave', () => {
    expect(skyGestureState(WORLD, NEAR, EDGES, true)).toBeNull();
    expect(skyGestureState(astrologyLive(), NEAR, EDGES, false)).toBeNull();
  });

  it('the graph, Aion, the Red Book, the dynamical lens and the other panel lenses keep their own camera', () => {
    expect(skyGestureState({ ...WORLD, graph: true }, FAR, EDGES, true)).toBeNull();
    expect(skyGestureState({ ...WORLD, history: { reading: 'x' } }, FAR, EDGES, true)).toBeNull();
    expect(skyGestureState({ ...WORLD, redbook: {} }, FAR, EDGES, true)).toBeNull();
    expect(skyGestureState({ ...WORLD, dynamics: {} }, FAR, EDGES, true)).toBeNull();
    expect(skyGestureState({ ...WORLD, lens: { id: 'alchemy', path: [] } }, FAR, EDGES, true)).toBeNull();
  });

  it('zooming back in by the wheel leaves the sky for the Field; a sky left by a scripted move stays', () => {
    expect(skyGestureState(astrologyLive(), NEAR, EDGES, true)).toEqual(WORLD);
    expect(skyGestureState(astrologyAt(['jung', 'mars']), NEAR, EDGES, true)).toEqual(WORLD);
    expect(skyGestureState(astrologyLive(), NEAR, EDGES, false)).toBeNull();
    expect(skyGestureState(astrologyLive(), FAR, EDGES, true)).toBeNull();
  });
});

describe('no route or transition produces a bare sky', () => {
  const constructed: [string, AppState][] = [
    ['inSky()', inSky()],
    ['inSky(body)', inSky({ body: 'mars' })],
    ['inSky(culture)', inSky({ culture: 'norse' })],
    ['inSky(natal, body)', inSky({ natal: 'jung', body: 'sun' })],
    ['astrologyLive()', astrologyLive()],
    ['astrologyLive(body)', astrologyLive({ body: 'saturn' })],
    ['astrologyAt([])', astrologyAt([])],
    ['astrologyAt([chart])', astrologyAt(['jung'])],
    ['astrologyAt([chart, body])', astrologyAt(['jung', 'moon'])],
    ['zoom out from the Field', skyGestureState(WORLD, FAR, EDGES, true)!],
    ['zoom out from a focus', skyGestureState(focusOn(WORLD, { type: 'archetype', id: 'self' }), FAR, EDGES, true)!],
    ['#/sky', hashToState('#/sky', r).state],
    ['#/sky/moon', hashToState('#/sky/moon', r).state],
    ['#/sky/mars/c/norse', hashToState('#/sky/mars/c/norse', r).state],
    ['#/astrology/sky/saturn', hashToState('#/astrology/sky/saturn', r).state],
    ['back(card) of Astrology', back(astrologyLive({ body: 'mars' }))],
    ['back(natal walk)', back(astrologyAt(['jung', 'mars']))],
  ];
  for (const [name, s] of constructed) {
    it(`${name} is Astrology or the Field, never a sky with no lens`, () => {
      expect(isBare(s), name).toBe(false);
    });
  }
});

describe('the sky’s own transitions', () => {
  it('Escape releases a body, then leaves the mode to the Field', () => {
    expect(back(astrologyLive({ body: 'mars' }))).toEqual(astrologyLive());
    expect(back(astrologyLive())).toEqual(WORLD);
  });

  it('the live sky is the sky link, and it round-trips through the hash', () => {
    expect(stateToHash(astrologyLive())).toBe('#/sky');
    expect(hashToState('#/sky', r).state).toEqual(astrologyLive());
    expect(hashToState('#/astrology/sky', r).state).toEqual(astrologyLive());
    expect(stateEq(hashToState('#/sky/saturn', r).state, astrologyLive({ body: 'saturn' }))).toBe(true);
  });
});
