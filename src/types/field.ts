// The data contract between the ingest layer (scripts/ → public/data/field.json)
// and the experience layer (src/). Both sides code against this file only.
//
// Source: the Jung archetypal-field vault (~/Documents/books/jung-archetypal-field).
// Vault tiers map to site tiers:
//   wiki/archetypes  → Archetype   (as-such, few)
//   wiki/images      → Family      (symbolic form / motif; also synthesised from
//                                    instance_of targets that have no note yet)
//   wiki/instances   → Occurrence  (place-time manifestation — what the globe shows)

export type ArchetypeId = string; // slug, e.g. "great-mother"
export type FamilyId = string; // slug, e.g. "serpent"
export type OccurrenceId = string; // vault filename slug
export type CultureId = string; // normalised slug, e.g. "latin-alchemy"

/** Where an archetype tie comes from. Never present "site" or "inferred" as Jung's word. */
export type TieBasis = 'jung' | 'inferred' | 'site';

export type LocusType =
  | 'artifact'
  | 'text-passage'
  | 'myth-episode'
  | 'ritual'
  | 'dream'
  | 'vision'
  | 'active-imagination'
  | 'clinical-case'
  | 'historical-event';

/** How trustworthy lat/lon is. "culture" = placed at the tradition's centroid. */
export type GeoPrecision = 'place' | 'region' | 'culture' | 'none';

export interface ImageRef {
  /** Site-relative path, e.g. "img/families/serpent.jpg" (served from public/). */
  src: string;
  /** Smaller variant for in-field markers; may equal src. */
  thumb: string;
  width: number;
  height: number;
  /** Dominant colour sampled from the image, hex — lets the UI tint before load. */
  tone?: string;
  title: string;
  credit: string; // artist / institution as given by the source
  license: string; // e.g. "Public domain", "CC BY-SA 4.0"
  sourceUrl: string; // the Commons/museum page, for attribution
}

export interface Cite {
  /** Jung work key as in the vault: "cw12", "sem-visions", "letters-pauli"… */
  work: string;
  /** Human label, e.g. "Psychology and Alchemy (CW12)". */
  workTitle: string;
  /** Year(s) of Jung's engagement as written, e.g. "1936/44". */
  year: string;
  /** Locator as written, e.g. "fig. 131, ¶357 (pdf p268)". */
  locator: string;
}

/**
 * The instinct ↔ spirit spectrum (CW8 ¶414–420): instinct sits at the
 * infra-red end, the archetype-as-image at the ultra-violet end.
 * 0 = instinct / infra-red (dense, warm, terrestrial)
 * 1 = spirit / ultra-violet (clear, cool, fine)
 */
export interface Spectrum {
  position: number; // 0..1
}

/** Atmosphere colours the experience layer blends between. All hex "#rrggbb". */
export interface Palette {
  core: string; // the archetype's own luminous colour (markers, focus ring)
  glow: string; // atmosphere rim / halo
  fog: string; // ambient fog / background wash
  deep: string; // darkest tone for space / shadows
}

export interface Archetype {
  id: ArchetypeId;
  name: string; // display, e.g. "Great Mother"
  oneLine: string; // ≤ 90 chars, orienting; empty when the vault gives no line
  prime: boolean; // true only for "self"
  spectrum: Spectrum;
  palette: Palette;
  /** Verbatim Jung quote with cite, when the vault has pinned one. */
  definition?: { text: string; cite: string };
  /** 1–3 short paragraphs of plain text for the deep layer. May be empty. */
  body: string[];
  image?: ImageRef;
  familyIds: FamilyId[]; // families tied to it (any basis), most occurrences first
  occurrenceCount: number; // via its families
}

export interface Family {
  id: FamilyId;
  name: string; // display, e.g. "Serpent"
  subtype: 'figure' | 'object' | 'process' | 'scene' | 'unknown';
  aliases: string[];
  oneLine: string; // ≤ 90 chars; empty when the vault gives no line
  archetypes: { id: ArchetypeId; basis: TieBasis }[];
  /** Blended from its archetypes, or set directly in curation. */
  spectrum: Spectrum;
  palette: Palette;
  body: string[]; // plain text paragraphs; may be empty
  image?: ImageRef;
  occurrenceIds: OccurrenceId[]; // sorted by year ascending
  /** True when the vault has no note for this family yet (only instance_of refs). */
  synthesised: boolean;
}

export interface Culture {
  id: CultureId;
  name: string; // "Latin alchemy"
  lat: number;
  lon: number; // centroid used for culture-precision placement
  occurrenceCount: number;
}

export interface Occurrence {
  id: OccurrenceId;
  title: string; // full vault title
  label: string; // ≤ 48 chars, for the one-line marker label
  familyId: FamilyId; // primary instance_of
  coFamilyIds: FamilyId[];
  locusType: LocusType;
  subject: 'jung' | 'patient-anon' | 'n/a';
  cultureIds: CultureId[];
  place: string; // vault prose, cleaned of wikilink syntax
  lat: number;
  lon: number;
  geoPrecision: GeoPrecision;
  year: number; // representative year, negative = BCE
  yearDisplay: string; // human truth, e.g. "~11th c."
  yearRange?: [number, number];
  /** Jung's engagement — the second time axis. Never conflate with `year`. */
  jung: Cite[];
  /** Short verbatim quote from the vault body, when present. */
  quote?: string;
  /** Plain-text paragraphs of the vault body (wikilinks resolved to names). */
  body: string[];
  parallelIds: OccurrenceId[]; // resolvable vault parallels only
  image?: ImageRef; // occurrence-specific image when one was found
}

export interface FieldMeta {
  generatedAt: string; // ISO
  vaultPath: string;
  vaultLedgerLine?: string; // last ledger heading, so the site can say how fresh it is
  counts: { archetypes: number; families: number; occurrences: number; cultures: number; images: number };
  yearMin: number;
  yearMax: number;
}

export interface Field {
  meta: FieldMeta;
  archetypes: Archetype[];
  families: Family[];
  occurrences: Occurrence[];
  cultures: Culture[];
}
