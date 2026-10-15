// Indexes over the Field: everything the experience layer looks up by id.
import type { Archetype, ArchetypeId, Culture, Family, FamilyId, ImageRef, Join, Occurrence, Field, SkyLocus, Theoretic, TheoreticId } from '../types/field';
import type { BodyKey } from '../types/sky';
import type { Symbols, SymbolEntry } from '../types/symbols';
import { createTimeScale, type TimeScale } from './time';
import { dirFromLatLon, type Vec3 } from './geo';
import { hexToRgb, toRgbPalette, type RGB, type RGBPalette } from './palette';

export type SubjectType = 'archetype' | 'theoretic' | 'family' | 'culture' | 'place';
export interface Subject {
  type: SubjectType;
  id: string;
}

export interface Place {
  id: string; // slug
  name: string;
  occ: number[]; // occurrence indices
}

/**
 * What governs one occurrence: the archetypes of its own family, and the theoretics whose material that family is
 * (a theoretic stands for its tied families and for the families of its tied archetypes — the rule the ingest counts
 * with). Built once per model, index-aligned with `occ`, for the field filter's archetype and theoretic dimensions.
 */
export interface OccurrenceTags {
  archetypes: string[];
  theoretics: string[];
}

export interface Model {
  field: Field;
  symbols: Map<string, SymbolEntry>;
  symbolSource?: Symbols['source'];
  scale: TimeScale;
  occ: Occurrence[];
  archById: Map<ArchetypeId, Archetype>;
  theoById: Map<TheoreticId, Theoretic>;
  famById: Map<FamilyId, Family>;
  cultureById: Map<string, Culture>;
  occIndex: Map<string, number>;
  /** unit direction per occurrence (index aligned with `occ`) */
  dir: Vec3[];
  /** slider-position of each occurrence's year */
  u: Float32Array;
  /** whether the occurrence can be shown on the globe */
  located: Uint8Array;
  /** whether the occurrence hangs somewhere in the sky (a body, a ring of it, the zodiac): its extraterrestrial place */
  skyAt: Uint8Array;
  /**
   * The occurrences that hang at each place of the sky, by body key (the planet itself and every ring of it) or, for
   * the places no body holds, 'zodiac' and 'pole'. Index lists, year ascending.
   */
  skyOcc: Map<string, number[]>;
  famPalette: Map<FamilyId, RGBPalette>;
  archPalette: Map<ArchetypeId, RGBPalette>;
  theoPalette: Map<TheoreticId, RGBPalette>;
  /** each family's HOME occurrences (its primary family): what a mode's scope and the Aion and Red Book walks read */
  famOcc: Map<FamilyId, number[]>; // indices, year ascending
  archOcc: Map<ArchetypeId, number[]>;
  theoOcc: Map<TheoreticId, number[]>;
  /**
   * The same by MEMBERSHIP: the occurrences that are a family's own, those that co-manifest it beside another, and those its
   * vault note lists (Occurrence.coFamilyIds is the rule). What a thread, a label, a count and a focus read; the modes keep
   * the home lists, so a mode's own set is not widened by a co-manifest.
   */
  famMem: Map<FamilyId, number[]>;
  archMem: Map<ArchetypeId, number[]>;
  theoMem: Map<TheoreticId, number[]>;
  cultureOcc: Map<string, number[]>;
  places: Map<string, Place>;
  occPlace: (string | undefined)[];
  /** the primary colour of each occurrence (its family's core) */
  colour: RGB[];
  /** what governs each occurrence (its family's archetypes and theoretics), index-aligned with `occ` */
  tags: OccurrenceTags[];
  /** the field's joins (curation/joins.json), any node to any node */
  joins: Join[];
  /** joins by endpoint, keyed `${type}:${id}`: each join is listed under both of its ends */
  joinsBy: Map<string, Join[]>;
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
  const theoById = new Map((field.theoretics ?? []).map((t) => [t.id, t]));
  const famById = new Map(field.families.map((f) => [f.id, f]));
  const cultureById = new Map(field.cultures.map((c) => [c.id, c]));
  const occIndex = new Map(occ.map((o, i) => [o.id, i]));

  const famPalette = new Map<FamilyId, RGBPalette>();
  for (const f of field.families) famPalette.set(f.id, toRgbPalette(f.palette ?? FALLBACK_PALETTE, f.spectrum?.position ?? 0.5));
  const archPalette = new Map<ArchetypeId, RGBPalette>();
  for (const a of field.archetypes) archPalette.set(a.id, toRgbPalette(a.palette ?? FALLBACK_PALETTE, a.spectrum?.position ?? 0.5));
  const theoPalette = new Map<TheoreticId, RGBPalette>();
  for (const t of field.theoretics ?? []) theoPalette.set(t.id, toRgbPalette(t.palette ?? FALLBACK_PALETTE, t.spectrum?.position ?? 0.5));

  const n = occ.length;
  const dir: Vec3[] = new Array(n);
  const u = new Float32Array(n);
  const located = new Uint8Array(n);
  const skyAt = new Uint8Array(n);
  const skyOcc = new Map<string, number[]>();
  const colour: RGB[] = new Array(n);
  const famOcc = new Map<FamilyId, number[]>();
  const famMem = new Map<FamilyId, number[]>();
  const cultureOcc = new Map<string, number[]>();
  const places = new Map<string, Place>();
  const occPlace: (string | undefined)[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const o = occ[i];
    dir[i] = dirFromLatLon(o.lat, o.lon);
    u[i] = scale.toU(o.year);
    located[i] = o.geoPrecision !== 'none' && Number.isFinite(o.lat) && Number.isFinite(o.lon) ? 1 : 0;
    colour[i] = famPalette.get(o.familyId)?.core ?? hexToRgb(FALLBACK_PALETTE.core);
    const home = famOcc.get(o.familyId);
    if (home) home.push(i); else famOcc.set(o.familyId, [i]);
    // a family's members: its own, and those that manifest it beside another (co-manifests, and the instances its own vault
    // note lists) — the membership the thread, the label and every count read
    for (const fid of new Set([o.familyId, ...(o.coFamilyIds ?? [])])) {
      const mem = famMem.get(fid);
      if (mem) mem.push(i); else famMem.set(fid, [i]);
    }
    if (o.sky?.length) {
      skyAt[i] = 1;
      for (const k of new Set(o.sky.map((l) => l.body ?? l.ring))) {
        const l = skyOcc.get(k);
        if (l) l.push(i); else skyOcc.set(k, [i]);
      }
    }
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
  for (const list of famMem.values()) list.sort((a, b) => occ[a].year - occ[b].year);
  for (const list of cultureOcc.values()) list.sort((a, b) => occ[a].year - occ[b].year);
  for (const list of skyOcc.values()) list.sort((a, b) => occ[a].year - occ[b].year || a - b);
  for (const p of places.values()) p.occ.sort((a, b) => occ[a].year - occ[b].year);
  // a single-occurrence "place" is just that occurrence; keep only real regions of recurrence
  for (const [id, p] of places) if (p.occ.length < 2) { for (const i of p.occ) occPlace[i] = undefined; places.delete(id); }

  // an archetype stands for what its families carry; a theoretic for what its tied archetypes and families carry — so
  // focusing one tunes the world to it rather than opening a page beside it. Built twice, from the home lists and from
  // the member lists (see famMem).
  const sets = (byFam: Map<FamilyId, number[]>) => {
    const arch = new Map<ArchetypeId, number[]>();
    for (const a of field.archetypes) {
      const set = new Set<number>();
      const fams = new Set<FamilyId>(a.familyIds);
      for (const f of field.families) if (f.archetypes.some((t) => t.id === a.id)) fams.add(f.id);
      for (const fid of fams) for (const i of byFam.get(fid) ?? []) set.add(i);
      arch.set(a.id, [...set].sort((x, y) => occ[x].year - occ[y].year));
    }
    const theo = new Map<TheoreticId, number[]>();
    for (const t of field.theoretics ?? []) {
      const set = new Set<number>();
      for (const tie of t.archetypes) for (const i of arch.get(tie.id) ?? []) set.add(i);
      for (const tie of t.families) for (const i of byFam.get(tie.id) ?? []) set.add(i);
      theo.set(t.id, [...set].sort((x, y) => occ[x].year - occ[y].year));
    }
    return { arch, theo };
  };
  const home = sets(famOcc);
  const mem = sets(famMem);
  const archOcc = home.arch;
  const theoOcc = home.theo;
  const archMem = mem.arch;
  const theoMem = mem.theo;

  // What governs each occurrence, by its own family: the archetypes the family is tied to, and the theoretics whose
  // material that family is — the same sets the focus tunes to, so a filter on them slices exactly what a focus shows.
  const famTags = new Map<FamilyId, OccurrenceTags>();
  for (const f of field.families) famTags.set(f.id, { archetypes: f.archetypes.map((t) => t.id), theoretics: [] });
  for (const t of field.theoretics ?? []) {
    const fams = new Set([...t.families.map((x) => x.id), ...t.archetypes.flatMap((x) => archById.get(x.id)?.familyIds ?? [])]);
    for (const fid of fams) famTags.get(fid)?.theoretics.push(t.id);
  }
  const tags: OccurrenceTags[] = occ.map((o) => famTags.get(o.familyId) ?? { archetypes: [], theoretics: [] });

  const joins = field.joins ?? [];
  const joinsBy = new Map<string, Join[]>();
  for (const j of joins) {
    for (const e of [j.a, j.b]) {
      const k = `${e.type}:${e.id}`;
      const l = joinsBy.get(k);
      if (l) l.push(j); else joinsBy.set(k, [j]);
    }
  }

  return { field, symbols: new Map(symbols?.entries.filter(e => famById.has(e.familyId)).map(e => [e.familyId, e]) ?? []), symbolSource: symbols?.source, scale, occ, archById, theoById, famById, cultureById, occIndex, dir, u, located, skyAt, skyOcc, famPalette, archPalette, theoPalette, famOcc, archOcc, theoOcc, famMem, archMem, theoMem, cultureOcc, places, occPlace, colour, tags, joins, joinsBy };
}

const BASIS_ORDER: Record<string, number> = { jung: 0, inferred: 1, site: 2 };

/**
 * The joins a subject takes part in, each with its far end (`other`). Jung before inferred before site, then by name.
 * A join is listed under both its ends, so the far end is whichever end is not the subject.
 */
export function joinsOf(m: Model, s: Subject): { join: Join; other: Subject }[] {
  const list = m.joinsBy.get(`${s.type}:${s.id}`) ?? [];
  return list
    .map((join) => {
      const far = join.a.type === s.type && join.a.id === s.id ? join.b : join.a;
      return { join, other: { type: far.type, id: far.id } };
    })
    .sort((x, y) => BASIS_ORDER[x.join.basis] - BASIS_ORDER[y.join.basis] || subjectName(m, x.other).localeCompare(subjectName(m, y.other)));
}

/** Every occurrence index that belongs to a subject, placed or not (year ascending). */
export function subjectMembers(m: Model, s: Subject): number[] {
  let list: number[] | undefined;
  if (s.type === 'archetype') list = m.archMem.get(s.id);
  else if (s.type === 'theoretic') list = m.theoMem.get(s.id);
  else if (s.type === 'family') list = m.famMem.get(s.id);
  else if (s.type === 'culture') list = m.cultureOcc.get(s.id);
  else list = m.places.get(s.id)?.occ;
  return list ?? [];
}

/** Occurrence indices (placed on the Earth only) that belong to a subject: what the globe shows and a thread walks. */
export function subjectOccurrences(m: Model, s: Subject): number[] {
  return subjectMembers(m, s).filter((i) => m.located[i]);
}

/**
 * The occurrences placed on the Earth that are HOME to a subject: its own family's (and, for an archetype or a theoretic,
 * its families' own). What the dynamical reading draws — each occurrence belongs to one basin, its primary family — as
 * against subjectOccurrences, which also counts the co-manifests a family is a member of.
 */
export function subjectHome(m: Model, s: Subject): number[] {
  let list: number[] | undefined;
  if (s.type === 'archetype') list = m.archOcc.get(s.id);
  else if (s.type === 'theoretic') list = m.theoOcc.get(s.id);
  else if (s.type === 'family') list = m.famOcc.get(s.id);
  else if (s.type === 'culture') list = m.cultureOcc.get(s.id);
  else list = m.places.get(s.id)?.occ;
  return (list ?? []).filter((i) => m.located[i]);
}

/** A place in the sky a subject's occurrences hang at: a body (any ring of it), the zodiac, or the heavens round the pole. */
export interface SkyHang {
  /** the body key, or 'zodiac' / 'pole' for the places no body holds */
  at: BodyKey | 'zodiac' | 'pole';
  /** the loci of the subject's occurrences that stand here, each with the occurrence that holds it */
  loci: { locus: SkyLocus; occ: number }[];
}

/** Where a subject's occurrences hang in the sky: one entry per place, the bodies in the order the sky lists them. */
export function subjectSky(m: Model, s: Subject): SkyHang[] {
  const by = new Map<string, SkyHang>();
  for (const i of subjectMembers(m, s)) {
    for (const locus of m.occ[i].sky ?? []) {
      const at = (locus.body ?? locus.ring) as SkyHang['at'];
      let h = by.get(at);
      if (!h) by.set(at, (h = { at, loci: [] }));
      h.loci.push({ locus, occ: i });
    }
  }
  return [...by.values()];
}

export function subjectName(m: Model, s: Subject): string {
  if (s.type === 'archetype') return m.archById.get(s.id)?.name ?? s.id;
  if (s.type === 'theoretic') return m.theoById.get(s.id)?.name ?? s.id;
  if (s.type === 'family') return m.famById.get(s.id)?.name ?? s.id;
  if (s.type === 'culture') return m.cultureById.get(s.id)?.name ?? s.id;
  return m.places.get(s.id)?.name ?? s.id;
}

export function subjectLine(m: Model, s: Subject): string {
  if (s.type === 'archetype') return m.archById.get(s.id)?.oneLine ?? '';
  if (s.type === 'theoretic') return m.theoById.get(s.id)?.oneLine ?? '';
  if (s.type === 'family') return m.famById.get(s.id)?.oneLine ?? '';
  return '';
}

export function subjectExists(m: Model, s: Subject): boolean {
  if (s.type === 'archetype') return m.archById.has(s.id);
  if (s.type === 'theoretic') return m.theoById.has(s.id);
  if (s.type === 'family') return m.famById.has(s.id);
  if (s.type === 'culture') return m.cultureById.has(s.id);
  return m.places.has(s.id);
}

/** Palette of a subject: its own, or the occurrence-weighted blend for cultures/places. */
export function subjectPalette(m: Model, s: Subject, avg: (ps: { p: RGBPalette; w: number }[]) => RGBPalette | null): RGBPalette | null {
  if (s.type === 'archetype') return m.archPalette.get(s.id) ?? null;
  if (s.type === 'theoretic') return m.theoPalette.get(s.id) ?? null;
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
