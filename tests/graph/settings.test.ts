import { describe, expect, it } from 'vitest';
import { DEFAULT_FORCES, FORCE_ROWS } from '../../src/graph/forces';
import { clampDisplay, clampForces, DEFAULT_DISPLAY, DEFAULT_SETTINGS, DISPLAY_ROWS, loadLayout, loadSettings, parseLayout, parseSettings, saveLayout, saveSettings, SETTINGS_KEY, type KeyValueStore } from '../../src/graph/settings';

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

  it('the tiers are flags, and anything else is the default (drawn)', () => {
    expect(parseSettings(JSON.stringify({ kinds: { theoretic: false } })).kinds).toEqual({ archetype: true, theoretic: false, family: true });
    expect(parseSettings(JSON.stringify({ kinds: { theoretic: 0, family: 'off' } })).kinds).toEqual({ archetype: true, theoretic: true, family: true });
    expect(parseSettings(JSON.stringify({ kinds: 'none' })).kinds).toEqual({ archetype: true, theoretic: true, family: true });
    expect(parseSettings(null).kinds).toEqual({ archetype: true, theoretic: true, family: true });
  });

  it('a saved set reads back as it was written', () => {
    const store = memory();
    const s = { forces: { ...DEFAULT_FORCES, centre: 3.2, link: 2.1 }, dust: false, ties: ['jung'] as ('jung')[], kinds: { archetype: true, theoretic: false, family: true }, display: { size: 1.4, links: 0.6, text: 1.5 } };
    saveSettings(s, store);
    expect(store.data[SETTINGS_KEY]).toBeTruthy();
    expect(loadSettings(store)).toEqual({ forces: s.forces, dust: false, ties: ['jung'], kinds: { archetype: true, theoretic: false, family: true }, display: { size: 1.4, links: 0.6, text: 1.5 } });
  });
});

describe('the graph display', () => {
  it('is drawn as it always was by default, and every slider starts inside its range on its own grid', () => {
    expect(DEFAULT_DISPLAY).toEqual({ size: 1, links: 1, text: 1 });
    expect(DISPLAY_ROWS.map((r) => r.key)).toEqual(['size', 'links', 'text']);
    for (const r of DISPLAY_ROWS) {
      const v = DEFAULT_DISPLAY[r.key];
      expect(v).toBeGreaterThanOrEqual(r.min);
      expect(v).toBeLessThanOrEqual(r.max);
      expect(Math.abs((v - r.min) / r.step - Math.round((v - r.min) / r.step))).toBeLessThan(1e-9);
      expect(r.tip.length).toBeGreaterThan(20);
    }
  });

  it('a stored display is held to its ranges; a missing or wrong key is the default; settings saved before it read as drawn', () => {
    expect(clampDisplay({ size: 9, links: -3, text: 'x' })).toEqual({ size: 2, links: 0.4, text: 1 });
    expect(clampDisplay(null)).toEqual(DEFAULT_DISPLAY);
    expect(parseSettings(JSON.stringify({ v: 1, dust: false })).display).toEqual(DEFAULT_DISPLAY);
  });
});

describe('the settled whole field, kept between visits', () => {
  it('reads back only under the same signature and node count, with every number finite', () => {
    const store = memory();
    saveLayout('sig-a', [1.04, 2, -3.26, 4], store);
    expect(Array.from(loadLayout('sig-a', 2, store)!)).toEqual([1, 2, -3.3, 4].map((x) => Math.fround(x)));
    expect(loadLayout('sig-b', 2, store)).toBeNull();
    expect(loadLayout('sig-a', 3, store)).toBeNull();
    expect(parseLayout(JSON.stringify({ v: 1, sig: 's', xy: [0, null] }), 's', 1)).toBeNull();
    expect(parseLayout('{not json', 's', 1)).toBeNull();
    expect(loadLayout('sig-a', 2, blocked)).toBeNull();
    expect(loadLayout('sig-a', 2, null)).toBeNull();
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
