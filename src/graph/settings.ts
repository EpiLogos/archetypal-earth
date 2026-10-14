// The graph's own settings, remembered on this browser: the four forces, the display, the occurrences and the relations.
// Depth is not kept: it belongs to the subject being looked at. Every read and write is guarded, because a private
// window or blocked site data must leave the graph working, with its defaults, and nothing else broken.
import type { TieBasis } from '../types/field';
import { DEFAULT_FORCES, FORCE_ROWS, type Forces } from './forces';

/**
 * The tiers the graph draws. Occurrences answer to `dust` (the toggle that was always there); the three node tiers
 * of the field answer here — a tier switched off is absent from the drawing with its ties, never left stranded.
 */
export interface KindFlags {
  archetype: boolean;
  theoretic: boolean;
  family: boolean;
}

export const DEFAULT_KINDS: KindFlags = { archetype: true, theoretic: true, family: true };

/** How the graph is drawn (Obsidian's Display): multipliers on the drawing only, never on the layout. 1 is as drawn. */
export interface Display {
  /** every node's drawn size */
  size: number;
  /** every relation's drawn width */
  links: number;
  /** how soon the names of the smaller forms and the occurrences appear as you come close */
  text: number;
}

export const DEFAULT_DISPLAY: Display = { size: 1, links: 1, text: 1 };

/** The display sliders, in the order they are shown; the tooltips say what each does. */
export const DISPLAY_ROWS: { key: keyof Display; label: string; min: number; max: number; step: number; tip: string }[] = [
  { key: 'size', label: 'Node size', min: 0.5, max: 2, step: 0.05, tip: 'How large every node is drawn. The layout does not move.' },
  { key: 'links', label: 'Link width', min: 0.4, max: 2.5, step: 0.05, tip: 'How thick every relation is drawn. The layout does not move.' },
  { key: 'text', label: 'Text fade', min: 0.5, max: 2, step: 0.05, tip: 'How soon the names of smaller forms appear as you come close. More names them sooner.' },
];

export interface GraphSettings {
  forces: Forces;
  /** occurrences (the dust) shown */
  dust: boolean;
  /** which relations are followed */
  ties: TieBasis[];
  /** which tiers are drawn (occurrences answer to `dust`) */
  kinds: KindFlags;
  /** how it is drawn */
  display: Display;
}

export const DEFAULT_SETTINGS: GraphSettings = { forces: { ...DEFAULT_FORCES }, dust: true, ties: ['jung', 'inferred', 'site'], kinds: { ...DEFAULT_KINDS }, display: { ...DEFAULT_DISPLAY } };
const defaults = (): GraphSettings => ({ ...DEFAULT_SETTINGS, forces: { ...DEFAULT_FORCES }, ties: [...DEFAULT_SETTINGS.ties], kinds: { ...DEFAULT_KINDS }, display: { ...DEFAULT_DISPLAY } });
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
  if (typeof text !== 'string' || !text) return defaults();
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return defaults();
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return defaults();
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
    kinds: clampKinds(rec.kinds),
    display: clampDisplay(rec.display),
  };
}

/** The display from whatever was stored: a missing or non-numeric key is the default, every number held to its slider's range. */
export function clampDisplay(raw: unknown): Display {
  const out: Display = { ...DEFAULT_DISPLAY };
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const r of DISPLAY_ROWS) {
    const v = o[r.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[r.key] = Math.min(r.max, Math.max(r.min, v));
  }
  return out;
}

/** The tier flags from whatever was stored: a missing or non-boolean key is the default (drawn). */
export function clampKinds(raw: unknown): KindFlags {
  const out: KindFlags = { ...DEFAULT_KINDS };
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const k of ['archetype', 'theoretic', 'family'] as const) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  return out;
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
    store?.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, forces: s.forces, dust: s.dust, ties: s.ties, kinds: s.kinds, display: s.display }));
  } catch {
    // no storage: nothing to keep
  }
}

// ── the settled whole field, kept between visits ──
// The whole field takes a few seconds of layout to come to rest. Once it has, its positions are kept on this browser
// under a signature of everything that shapes it (the nodes, the filters, the forces), so the next visit opens on
// the picture the person last saw, at rest, instead of settling it again. Any change to that signature forgets it.
export const LAYOUT_KEY = 'archetypal-earth.graph.layout';

export interface SavedLayout {
  sig: string;
  /** x, y for each node of the field's own graph, in node order */
  xy: Float32Array;
}

/** A layout's positions from stored text: null unless the signature and the node count match exactly and every number is finite. */
export function parseLayout(text: string | null | undefined, sig: string, n: number): Float32Array | null {
  if (typeof text !== 'string' || !text) return null;
  try {
    const o = JSON.parse(text) as { v?: number; sig?: unknown; xy?: unknown };
    if (!o || o.v !== 1 || o.sig !== sig || !Array.isArray(o.xy) || o.xy.length !== n * 2) return null;
    const out = new Float32Array(n * 2);
    for (let i = 0; i < out.length; i++) {
      const v = o.xy[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      out[i] = v;
    }
    return out;
  } catch {
    return null;
  }
}

export function loadLayout(sig: string, n: number, store: KeyValueStore | null = browserStore()): Float32Array | null {
  try {
    return parseLayout(store ? store.getItem(LAYOUT_KEY) : null, sig, n);
  } catch {
    return null;
  }
}

/** Keep a settled layout (rounded to a tenth of a unit: the picture, not the float noise). A failed write is dropped. */
export function saveLayout(sig: string, xy: ArrayLike<number>, store: KeyValueStore | null = browserStore()): void {
  try {
    const out: number[] = new Array(xy.length);
    for (let i = 0; i < xy.length; i++) out[i] = Math.round(xy[i] * 10) / 10;
    store?.setItem(LAYOUT_KEY, JSON.stringify({ v: 1, sig, xy: out }));
  } catch {
    // no storage: the field settles afresh next time
  }
}
