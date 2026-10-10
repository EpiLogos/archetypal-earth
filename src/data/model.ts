// Indexes over the Field: everything the experience layer looks up by id.
import type { Archetype, ArchetypeId, Culture, Family, FamilyId, ImageRef, Occurrence, Field } from '../types/field';
import type { Symbols, SymbolEntry } from '../types/symbols';
import { createTimeScale, type TimeScale } from './time';
import { dirFromLatLon, type Vec3 } from './geo';
import { hexToRgb, toRgbPalette, type RGB, type RGBPalette } from './palette';

export type SubjectType = 'archetype' | 'family' | 'culture' | 'place';
export interface Subject {
  type: SubjectType;
  id: string;
}

export interface Place {
  id: string; // slug
  name: string;
  occ: number[]; // occurrence indices
}

export interface Model {
  field: Field;
  symbols: Map<string, SymbolEntry>;
  symbolSource?: Symbols['source'];
  scale: TimeScale;
  occ: Occurrence[];
  archById: Map<ArchetypeId, Archetype>;
  famById: Map<FamilyId, Family>;
  cultureById: Map<string, Culture>;
  occIndex: Map<string, number>;
  /** unit direction per occurrence (index aligned with `occ`) */
  dir: Vec3[];
  /** slider-position of each occurrence's year */
  u: Float32Array;
  /** whether the occurrence can be shown on the globe */
  located: Uint8Array;
  famPalette: Map<FamilyId, RGBPalette>;
  archPalette: Map<ArchetypeId, RGBPalette>;
  famOcc: Map<FamilyId, number[]>; // indices, year ascending
  archOcc: Map<ArchetypeId, number[]>;
  cultureOcc: Map<string, number[]>;
  places: Map<string, Place>;
  occPlace: (string | undefined)[];
  /** the primary colour of each occurrence (its family's core) */
  colour: RGB[];
}

export function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "Chartres, France (cathedral)" -> "Chartres" — the short name used for place lookups. */
export function shortPlace(place: string): string {
  const first = place.split(/[,;(–—/]| - /)[0].trim();
  // the vault's place field is prose; keep only what reads as a plain place name
  if (first.length < 3 || first.length > 34 || /\d/.test(first)) return '';
  if (/\b(print|edition|ms|manuscript|version|milieu|tradition|collection)\b/i.test(first)) return '';
  return first;
}

const FALLBACK_PALETTE = { core: '#c3d2f2', glow: '#4f78cf', fog: '#10193a', deep: '#02030a' };

export function buildModel(field: Field, extent?: { from: number; to: number }, symbols?: Symbols): Model {
  const occ = field.occurrences;
  const yMin = Number.isFinite(field.meta.yearMin) ? field.meta.yearMin : Math.min(...occ.map((o) => o.year), 0);
  const yMax = Number.isFinite(field.meta.yearMax) ? field.meta.yearMax : Math.max(...occ.map((o) => o.year), 1960);
  const scale = createTimeScale(Math.min(yMin, extent?.from ?? yMin), Math.max(yMax, extent?.to ?? yMax));

  const archById = new Map(field.archetypes.map((a) => [a.id, a]));
  const famById = new Map(field.families.map((f) => [f.id, f]));
  const cultureById = new Map(field.cultures.map((c) => [c.id, c]));
  const occIndex = new Map(occ.map((o, i) => [o.id, i]));

  const famPalette = new Map<FamilyId, RGBPalette>();
  for (const f of field.families) famPalette.set(f.id, toRgbPalette(f.palette ?? FALLBACK_PALETTE, f.spectrum?.position ?? 0.5));
  const archPalette = new Map<ArchetypeId, RGBPalette>();
  for (const a of field.archetypes) archPalette.set(a.id, toRgbPalette(a.palette ?? FALLBACK_PALETTE, a.spectrum?.position ?? 0.5));

  const n = occ.length;
  const dir: Vec3[] = new Array(n);
  const u = new Float32Array(n);
  const located = new Uint8Array(n);
  const colour: RGB[] = new Array(n);
  const famOcc = new Map<FamilyId, number[]>();
  const cultureOcc = new Map<string, number[]>();
  const places = new Map<string, Place>();
  const occPlace: (string | undefined)[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const o = occ[i];
    dir[i] = dirFromLatLon(o.lat, o.lon);
    u[i] = scale.toU(o.year);
    located[i] = o.geoPrecision !== 'none' && Number.isFinite(o.lat) && Number.isFinite(o.lon) ? 1 : 0;
    colour[i] = famPalette.get(o.familyId)?.core ?? hexToRgb(FALLBACK_PALETTE.core);
    const fam = famOcc.get(o.familyId);
    if (fam) fam.push(i); else famOcc.set(o.familyId, [i]);
    for (const c of o.cultureIds) {
      const l = cultureOcc.get(c);
      if (l) l.push(i); else cultureOcc.set(c, [i]);
    }
    const sp = shortPlace(o.place ?? '');
    if (sp && located[i]) {
      const id = slug(sp);
      let p = places.get(id);
      if (!p) places.set(id, (p = { id, name: sp, occ: [] }));
      p.occ.push(i);
      occPlace[i] = id;
    }
  }
  for (const list of famOcc.values()) list.sort((a, b) => occ[a].year - occ[b].year);
  for (const list of cultureOcc.values()) list.sort((a, b) => occ[a].year - occ[b].year);
  for (const p of places.values()) p.occ.sort((a, b) => occ[a].year - occ[b].year);
  // a single-occurrence "place" is just that occurrence; keep only real regions of recurrence
  for (const [id, p] of places) if (p.occ.length < 2) { for (const i of p.occ) occPlace[i] = undefined; places.delete(id); }

  const archOcc = new Map<ArchetypeId, number[]>();
  for (const a of field.archetypes) {
    const set = new Set<number>();
    const fams = new Set<FamilyId>(a.familyIds);
    for (const f of field.families) if (f.archetypes.some((t) => t.id === a.id)) fams.add(f.id);
    for (const fid of fams) for (const i of famOcc.get(fid) ?? []) set.add(i);
    archOcc.set(a.id, [...set].sort((x, y) => occ[x].year - occ[y].year));
  }

  return { field, symbols: new Map(symbols?.entries.filter(e => famById.has(e.familyId)).map(e => [e.familyId, e]) ?? []), symbolSource: symbols?.source, scale, occ, archById, famById, cultureById, occIndex, dir, u, located, famPalette, archPalette, famOcc, archOcc, cultureOcc, places, occPlace, colour };
}

/** Occurrence indices (located only) that belong to a subject. */
export function subjectOccurrences(m: Model, s: Subject): number[] {
  let list: number[] | undefined;
  if (s.type === 'archetype') list = m.archOcc.get(s.id);
  else if (s.type === 'family') list = m.famOcc.get(s.id);
  else if (s.type === 'culture') list = m.cultureOcc.get(s.id);
  else list = m.places.get(s.id)?.occ;
  return (list ?? []).filter((i) => m.located[i]);
}

export function subjectName(m: Model, s: Subject): string {
  if (s.type === 'archetype') return m.archById.get(s.id)?.name ?? s.id;
  if (s.type === 'family') return m.famById.get(s.id)?.name ?? s.id;
  if (s.type === 'culture') return m.cultureById.get(s.id)?.name ?? s.id;
  return m.places.get(s.id)?.name ?? s.id;
}

export function subjectLine(m: Model, s: Subject): string {
  if (s.type === 'archetype') return m.archById.get(s.id)?.oneLine ?? '';
  if (s.type === 'family') return m.famById.get(s.id)?.oneLine ?? '';
  return '';
}

export function subjectExists(m: Model, s: Subject): boolean {
  if (s.type === 'archetype') return m.archById.has(s.id);
  if (s.type === 'family') return m.famById.has(s.id);
  if (s.type === 'culture') return m.cultureById.has(s.id);
  return m.places.has(s.id);
}

/** Palette of a subject: its own, or the occurrence-weighted blend for cultures/places. */
export function subjectPalette(m: Model, s: Subject, avg: (ps: { p: RGBPalette; w: number }[]) => RGBPalette | null): RGBPalette | null {
  if (s.type === 'archetype') return m.archPalette.get(s.id) ?? null;
  if (s.type === 'family') return m.famPalette.get(s.id) ?? null;
  const items = subjectOccurrences(m, s).map((i) => ({ p: m.famPalette.get(m.occ[i].familyId)!, w: 1 })).filter((x) => x.p);
  return avg(items);
}

/** Best image for an entity: its own, or its family's, or its first archetype's. */
export function occurrenceImage(m: Model, o: Occurrence): ImageRef | undefined {
  return o.image ?? m.famById.get(o.familyId)?.image;
}

export function archetypesOfFamily(m: Model, f: Family): Archetype[] {
  return f.archetypes.map((t) => m.archById.get(t.id)).filter((x): x is Archetype => !!x);
}

/** The prime archetype (the Self): the centre every lens lands on when no subject is given. */
export function selfSubject(m: Model): Subject {
  const prime = m.field.archetypes.find((a) => a.prime);
  return { type: 'archetype', id: prime?.id ?? 'self' };
}
