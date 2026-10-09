import { describe, expect, it } from 'vitest';
import { DEFAULT_FORCES, FORCE_ROWS } from '../../src/graph/forces';
import { clampForces, DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings, SETTINGS_KEY, type KeyValueStore } from '../../src/graph/settings';

// A store that keeps what it is given, as localStorage does.
const memory = (initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
};
// A store that cannot be used: a private window, or blocked site data.
const blocked: KeyValueStore = {
  getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
  setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
};

describe('the graph settings: clamp and parse', () => {
  it('a missing or empty store is the defaults', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('corrupt JSON, and JSON that is not an object, is the defaults', () => {
    for (const text of ['{not json', 'null', '42', '"text"', '[1,2,3]', 'true']) expect(parseSettings(text)).toEqual(DEFAULT_SETTINGS);
  });

  it('a missing key is its default, and the others are kept', () => {
    const s = parseSettings(JSON.stringify({ dust: false }));
    expect(s.dust).toBe(false);
    expect(s.forces).toEqual(DEFAULT_FORCES);
    expect(s.ties).toEqual(['jung', 'inferred', 'site']);
    const t = parseSettings(JSON.stringify({ forces: { repel: 1.4 } }));
    expect(t.forces.repel).toBe(1.4);
    expect(t.forces.centre).toBe(DEFAULT_FORCES.centre);
    expect(t.dust).toBe(true);
  });

  it('every force is held to its slider\'s range', () => {
    const wild = clampForces({ centre: 99, repel: -4, link: Number.POSITIVE_INFINITY, distance: 1.2 });
    for (const r of FORCE_ROWS) {
      expect(wild[r.key]).toBeGreaterThanOrEqual(r.min);
      expect(wild[r.key]).toBeLessThanOrEqual(r.max);
    }
    expect(wild.centre).toBe(6);
    expect(wild.repel).toBe(0.3);
    expect(wild.link).toBe(DEFAULT_FORCES.link);
    expect(wild.distance).toBe(1.2);
  });

  it('a force of the wrong type is its default, never NaN', () => {
    const f = clampForces({ centre: '3', repel: null, link: [2], distance: NaN });
    expect(f).toEqual(DEFAULT_FORCES);
    expect(clampForces(null)).toEqual(DEFAULT_FORCES);
    expect(clampForces('forces')).toEqual(DEFAULT_FORCES);
  });

  it('keeps only the relations it knows, and an empty list is a choice the person made', () => {
    expect(parseSettings(JSON.stringify({ ties: ['site', 'bogus', 'site'] })).ties).toEqual(['site']);
    expect(parseSettings(JSON.stringify({ ties: [] })).ties).toEqual([]);
    expect(parseSettings(JSON.stringify({ ties: ['bogus'] })).ties).toEqual(DEFAULT_SETTINGS.ties);
    expect(parseSettings(JSON.stringify({ ties: 'jung' })).ties).toEqual(DEFAULT_SETTINGS.ties);
  });

  it('occurrences are a boolean, and anything else is the default', () => {
    expect(parseSettings(JSON.stringify({ dust: 0 })).dust).toBe(true);
    expect(parseSettings(JSON.stringify({ dust: 'off' })).dust).toBe(true);
    expect(parseSettings(JSON.stringify({ dust: false })).dust).toBe(false);
  });

  it('a saved set reads back as it was written', () => {
    const store = memory();
    const s = { forces: { ...DEFAULT_FORCES, centre: 3.2, link: 2.1 }, dust: false, ties: ['jung'] as ('jung')[] };
    saveSettings(s, store);
    expect(store.data[SETTINGS_KEY]).toBeTruthy();
    expect(loadSettings(store)).toEqual({ forces: s.forces, dust: false, ties: ['jung'] });
  });
});

describe('the graph settings: storage that is missing or blocked', () => {
  it('loads the defaults when the store throws, or is absent', () => {
    expect(loadSettings(blocked)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('saving to a blocked store does not throw', () => {
    expect(() => saveSettings(DEFAULT_SETTINGS, blocked)).not.toThrow();
    expect(() => saveSettings(DEFAULT_SETTINGS, null)).not.toThrow();
  });

  it('a stored value that is corrupt loads as the defaults', () => {
    expect(loadSettings(memory({ [SETTINGS_KEY]: '{"forces":' }))).toEqual(DEFAULT_SETTINGS);
  });
});
