import { describe, expect, it } from 'vitest';
import { back, focusOn, inSky, manifest, openedFrom, setDeep, startThread, stateEq, WORLD, type AppState } from '../../src/state/store';
import { defaultReadingId, hashToState, stateToHash, type Resolver } from '../../src/state/router';

const serpent = { type: 'family', id: 'serpent' } as const;

describe('state transitions', () => {
  it('walks World → Focus → Manifestation → Thread and back, one step at a time', () => {
    let s = focusOn(WORLD, serpent);
    expect(s.view.kind).toBe('focus');
    s = manifest(s, 'serpent-1', serpent);
    expect(s.view.kind).toBe('manifest');
    s = startThread(s, { type: 'family', id: 'serpent' });
    expect(s.view.kind).toBe('thread');
    s = back(s); // thread → where it began (manifestation)
    expect(s.view.kind).toBe('manifest');
    s = back(s); // manifestation → focus
    expect(s.view).toEqual({ kind: 'focus', subject: serpent });
    s = back(s);
    expect(s).toEqual(WORLD);
    expect(back(WORLD)).toEqual(WORLD);
  });

  it('deep is a layer: escape closes it before stepping back', () => {
    let s = manifest(focusOn(WORLD, serpent), 'serpent-1', serpent);
    s = setDeep(s, true);
    expect(s.deep).toBe(true);
    s = back(s);
    expect(s.deep).toBe(false);
    expect(s.view.kind).toBe('manifest');
    s = back(s);
    expect(s.view.kind).toBe('focus');
  });

  it('keeps the focus subject as the manifestation context', () => {
    const arch = { type: 'archetype', id: 'self' } as const;
    const s = manifest(focusOn(WORLD, arch), 'serpent-1', serpent);
    expect(s.view.kind === 'manifest' && s.view.context).toEqual(arch);
    // moving between parallels keeps it
    const t = manifest(s, 'tree-2', { type: 'family', id: 'tree' });
    expect(t.view.kind === 'manifest' && t.view.context).toEqual(arch);
  });

  it('cannot deepen the world', () => {
    expect(setDeep(WORLD, true)).toEqual(WORLD);
  });

  it('starting a thread from a thread keeps the original return point', () => {
    const f = focusOn(WORLD, serpent);
    const t1 = startThread(f, { type: 'family', id: 'serpent' });
    const t2 = startThread(t1, { type: 'archetype', id: 'self' });
    expect(back(t2)).toEqual(f);
  });

  it('compares states', () => {
    expect(stateEq(focusOn(WORLD, serpent), focusOn(WORLD, serpent))).toBe(true);
    expect(stateEq(focusOn(WORLD, serpent), WORLD)).toBe(false);
  });

  it('the Red Book null state is a state of its own: entering and leaving it are both moves', () => {
    const redbook = { ...WORLD, redbook: {} };
    expect(stateEq(redbook, WORLD)).toBe(false); // navigate() accepts the launch
    expect(stateEq(WORLD, redbook)).toBe(false); // ...and closing it (redbook removed)
    expect(stateEq(redbook, { ...WORLD, redbook: {} })).toBe(true);
  });
});

describe('hash router', () => {
  const r: Resolver = {
    hasArchetype: (id) => ['self', 'shadow'].includes(id),
    hasFamily: (id) => ['serpent', 'tree', 'shadow'].includes(id),
    hasCulture: (id) => id === 'norse',
    hasPlace: (id) => id === 'chartres',
    familyOf: (id) => (id.startsWith('serpent-') ? 'serpent' : undefined),
  };

  it('round-trips every state', () => {
    const states = [
      WORLD,
      focusOn(WORLD, serpent),
      focusOn(WORLD, { type: 'archetype', id: 'self' }),
      focusOn(WORLD, { type: 'culture', id: 'norse' }),
      focusOn(WORLD, { type: 'place', id: 'chartres' }),
      manifest(WORLD, 'serpent-3', serpent),
      startThread(focusOn(WORLD, serpent), { type: 'family', id: 'serpent' }),
      startThread(focusOn(WORLD, { type: 'archetype', id: 'self' }), { type: 'archetype', id: 'self' }),
      setDeep(focusOn(WORLD, serpent), true),
    ];
    for (const s of states) {
      const parsed = hashToState(stateToHash(s), r).state;
      expect(stateToHash(parsed)).toBe(stateToHash(s));
      expect(parsed.view.kind).toBe(s.view.kind);
      expect(parsed.deep).toBe(s.deep);
    }
  });

  it('uses the short forms from the brief', () => {
    expect(stateToHash(focusOn(WORLD, serpent))).toBe('#/f/serpent');
    expect(stateToHash(focusOn(WORLD, { type: 'archetype', id: 'self' }))).toBe('#/a/self');
    expect(stateToHash(startThread(focusOn(WORLD, serpent), { type: 'family', id: 'serpent' }))).toBe('#/t/serpent');
    expect(stateToHash(manifest(WORLD, 'serpent-3', serpent))).toBe('#/o/serpent-3');
  });

  it('resolves #/t/<id> to a family first, then an archetype', () => {
    expect(hashToState('#/t/serpent', r).state.view).toMatchObject({ kind: 'thread', target: { type: 'family', id: 'serpent' } });
    expect(hashToState('#/t/self', r).state.view).toMatchObject({ kind: 'thread', target: { type: 'archetype', id: 'self' } });
    expect(hashToState('#/t/a/shadow', r).state.view).toMatchObject({ target: { type: 'archetype', id: 'shadow' } });
  });

  it('falls back to the world for unknown or malformed hashes', () => {
    for (const h of ['', '#', '#/', '#/f/unknown', '#/o/nope', '#/zzz/1', '#/t/ghost']) {
      expect(hashToState(h, r).state).toEqual(WORLD);
    }
  });

  it('reads a time cursor', () => {
    expect(hashToState('#/y/1600', r).year).toBe(1600);
  });
});

describe('the Aion switch and #/aion agree', () => {
  const readings = [{ id: 'jung-aion' }, { id: 'jung-turn' }];
  const r: Resolver = {
    hasArchetype: () => false,
    hasFamily: () => false,
    hasCulture: () => false,
    hasPlace: () => false,
    familyOf: () => undefined,
    hasReading: (id) => readings.some((x) => x.id === id),
    hasHistorySelection: () => false,
    defaultReading: () => defaultReadingId(readings),
  };

  it('a bare #/aion opens the default reading, the one the switch opens', () => {
    const parsed = hashToState('#/aion', r).state;
    expect(parsed.history).toEqual({ reading: 'jung-aion' });
    expect(parsed.view).toEqual({ kind: 'world' });
    expect(stateToHash(parsed)).toBe('#/aion/jung-aion');
  });

  it('keeps a named reading and its selection exactly as before', () => {
    expect(hashToState('#/aion/jung-turn', r).state.history).toEqual({ reading: 'jung-turn' });
    expect(hashToState('#/aion/nope', r).state).toEqual(WORLD);
  });

  it('falls back to the world when there is no reading to open', () => {
    const none: Resolver = { ...r, hasReading: () => false, defaultReading: () => defaultReadingId([]) };
    expect(hashToState('#/aion', none).state).toEqual(WORLD);
  });
});

describe('a reading a mode opened returns to that mode (Escape, once)', () => {
  const serpent = { type: 'family', id: 'serpent' } as const;
  const aion: AppState = { view: { kind: 'world' }, deep: false, history: { reading: 'jung-aion', selection: { kind: 'event', id: 'e1' } } };
  const redbook: AppState = { view: { kind: 'world' }, deep: false, redbook: { stop: 'folio-7' } };
  const sky: AppState = inSky({ body: 'venus' });
  const reading = (from: AppState) => openedFrom(from, { view: { kind: 'manifest', occId: 'serpent-1', context: { type: 'family', id: 'serpent' } }, deep: true });

  it('Escape from the core reading returns to the Aion event, the Red Book folio and the sky body it came from', () => {
    expect(back(reading(aion))).toEqual(aion);
    expect(back(reading(redbook))).toEqual(redbook);
    expect(back(reading(sky))).toEqual(sky);
  });

  it('the return is taken once: the mode state it returns to carries no memory', () => {
    const back1 = back(reading(redbook));
    expect(back1.from).toBeUndefined();
    // the next Escape walks the mode's own ladder, not a second return
    expect(back(back1)).toEqual({ view: { kind: 'world' }, deep: false, redbook: {} }); // the book's own ladder: folio → the null book
  });

  it('the memory is cleared by any navigation that is not the reading itself', () => {
    const r = reading(redbook);
    expect(focusOn(r, serpent).from).toBeUndefined();
    expect(manifest(r, 'serpent-2', serpent).from).toBeUndefined();
    // a deep layer that is closed keeps the return (it is the same reading)
    expect(back(setDeep(r, false)).from).toBeUndefined();
    expect(setDeep(r, false).from).toEqual(redbook);
  });

  it('is never in the hash: the reading serialises as the reading alone', () => {
    expect(stateToHash(reading(aion))).toBe(stateToHash({ view: { kind: 'manifest', occId: 'serpent-1', context: { type: 'family', id: 'serpent' } }, deep: true }));
  });

  it('is compared by presence only', () => {
    const plain = { view: { kind: 'manifest' as const, occId: 'serpent-1', context: { type: 'family' as const, id: 'serpent' } }, deep: true };
    expect(stateEq(reading(redbook), plain)).toBe(false);
    expect(stateEq(reading(redbook), reading(sky))).toBe(true);
  });

  it('does not change what Escape does where no mode opened the reading', () => {
    const plainDeep = setDeep(manifest(focusOn(WORLD, serpent), 'serpent-1', serpent), true);
    expect(back(plainDeep).deep).toBe(false);
    expect(back(plainDeep).view.kind).toBe('manifest');
  });
});
