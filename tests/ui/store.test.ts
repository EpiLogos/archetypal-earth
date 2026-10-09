import { describe, expect, it } from 'vitest';
import { back, focusOn, manifest, setDeep, startThread, stateEq, WORLD } from '../../src/state/store';
import { hashToState, stateToHash, type Resolver } from '../../src/state/router';

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
