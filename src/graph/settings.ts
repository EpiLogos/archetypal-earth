// The graph's own settings, remembered on this browser: the four forces, the occurrences and the relations.
// Depth is not kept: it belongs to the subject being looked at. Every read and write is guarded, because a private
// window or blocked site data must leave the graph working, with its defaults, and nothing else broken.
import type { TieBasis } from '../types/field';
import { DEFAULT_FORCES, FORCE_ROWS, type Forces } from './forces';

export interface GraphSettings {
  forces: Forces;
  /** occurrences (the dust) shown */
  dust: boolean;
  /** which relations are followed */
  ties: TieBasis[];
}

export const DEFAULT_SETTINGS: GraphSettings = { forces: { ...DEFAULT_FORCES }, dust: true, ties: ['jung', 'inferred', 'site'] };
export const SETTINGS_KEY = 'archetypal-earth.graph';
const BASES: readonly TieBasis[] = ['jung', 'inferred', 'site'];

/** The four forces from whatever was stored: a missing or non-numeric key is the default, and every number is held to its slider's range. */
export function clampForces(raw: unknown): Forces {
  const out: Forces = { ...DEFAULT_FORCES };
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const r of FORCE_ROWS) {
    const v = o[r.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[r.key] = Math.min(r.max, Math.max(r.min, v));
  }
  return out;
}

/**
 * The settings from stored text. Null, empty, corrupt or non-object text gives the defaults; so does a key that is
 * missing or of the wrong type. An empty list of relations is a choice the person made (all off) and is kept.
 */
export function parseSettings(text: string | null | undefined): GraphSettings {
  if (typeof text !== 'string' || !text) return { ...DEFAULT_SETTINGS, forces: { ...DEFAULT_FORCES }, ties: [...DEFAULT_SETTINGS.ties] };
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return { ...DEFAULT_SETTINGS, forces: { ...DEFAULT_FORCES }, ties: [...DEFAULT_SETTINGS.ties] };
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ...DEFAULT_SETTINGS, forces: { ...DEFAULT_FORCES }, ties: [...DEFAULT_SETTINGS.ties] };
  const rec = o as Record<string, unknown>;
  let ties: TieBasis[] = [...DEFAULT_SETTINGS.ties];
  if (Array.isArray(rec.ties)) {
    if (rec.ties.length === 0) ties = [];
    else {
      const valid = [...new Set(rec.ties.filter((b): b is TieBasis => typeof b === 'string' && (BASES as readonly string[]).includes(b)))];
      if (valid.length) ties = BASES.filter((b) => valid.includes(b));
    }
  }
  return {
    forces: clampForces(rec.forces),
    dust: typeof rec.dust === 'boolean' ? rec.dust : DEFAULT_SETTINGS.dust,
    ties,
  };
}

/** The minimal store this needs: localStorage, or nothing. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** This browser's localStorage, or null where it is blocked or absent (it can throw on access). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(store: KeyValueStore | null = browserStore()): GraphSettings {
  try {
    return parseSettings(store ? store.getItem(SETTINGS_KEY) : null);
  } catch {
    return parseSettings(null);
  }
}

/** Write the settings. A failed write (quota, private window) is dropped: the layout still follows the person. */
export function saveSettings(s: GraphSettings, store: KeyValueStore | null = browserStore()): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, forces: s.forces, dust: s.dust, ties: s.ties }));
  } catch {
    // no storage: nothing to keep
  }
}
