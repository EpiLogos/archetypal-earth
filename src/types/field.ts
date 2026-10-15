// The data contract between the ingest layer (scripts/ → public/data/field.json)
// and the experience layer (src/). Both sides code against this file only.
//
// Source: the Jung archetypal-field vault (~/Documents/books/jung-archetypal-field).
// Vault tiers map to site tiers:
//   wiki/archetypes  → Archetype   (as-such, few)
//   wiki/concepts    → Theoretic   (theoretics: Jung's theoretical instruments, and the field's ground)
//   wiki/images      → Family      (symbolic form / motif; also synthesised from
//                                    instance_of targets that have no note yet)
//   wiki/instances   → Occurrence  (place-time manifestation — what the globe shows)

import type { BodyKey } from './sky';

export type ArchetypeId = string; // slug, e.g. "great-mother"
export type TheoreticId = string; // slug, e.g. "psychoid"
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

/**
 * Where in the sky an occurrence hangs — its extraterrestrial place, independent of its Earth place (`lat/lon/geoPrecision`):
 * it may have either, both, or neither. The card rings' own geometry (src/sky/cards.ts), so a ring and a place cannot
 * disagree. A body (the planet itself, the Moon, the Earth as a body of the sky), a ring of it, an ecliptic span.
 *   body    at the body itself (a sephira, an element on the Earth)
 *   wheel   on the body's decan wheel, at an ecliptic span (a pip card, at its decan, on its ruler's wheel)
 *   rank    on the body's rank ring (the cards of its number, the Atu attributed to it)
 *   zodiac  the zodiac itself, no body: a sign, a decan, a court card's thirty degrees, a sign's Atu
 *   pole    the heavens round the celestial pole (the Princesses); `slot` is the quadrant
 * `lon`/`span` are ecliptic degrees (start and width; may wrap past 360). `slot` is the suit order (wands, cups, swords,
 * disks) on a rank ring or a pole quadrant. `basis` says where the attribution comes from; `via` the join ids it rests on.
 */
export interface SkyLocus {
  body?: BodyKey;
  ring: 'body' | 'wheel' | 'rank' | 'zodiac' | 'pole';
  lon?: number;
  span?: number;
  slot?: number;
  basis: TieBasis;
  via: string[];
}

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
  /** Whose words the passage is, when not Jung's ("Crowley", "Burt", "von Franz"); absent means Jung. */
  voice?: string;
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
  /** Ties to other archetypes, from curation alone (the numbers to the Self, the dyad to syzygy and shadow). */
  archetypes: TheoreticTie[];
  /** True when admitted from curation with no vault note yet (number archetypes). */
  synthesised?: boolean;
}

/** A tie from a theoretic to a node the field holds. */
export interface TheoreticTie {
  id: string; // archetype / family / theoretic id
  basis: TieBasis;
}

/**
 * The vault's wiki/concepts/ tier: Jung's theoretical instruments, carried as a tier of the field
 * beside archetypes, families and occurrences. Two of them are the field's own foundation and carry
 * `ground`: the psychoid is the ontological tier-marker (where the archetype stops being psyche) and
 * the archetype as such is the epistemological keystone (the irrepresentable pole known only through
 * its images). Both are the reason the field has tiers at all, so they are stated as its ground
 * rather than filed as two more entries in a list.
 */
export interface Theoretic {
  id: TheoreticId;
  name: string; // display, e.g. "The Psychoid"
  oneLine: string; // ≤ 90 chars, orienting
  ground: 'ontological' | 'epistemological' | null;
  spectrum: Spectrum;
  palette: Palette;
  /** Verbatim Jung quote with cite, picked from the vault's mentions — never typed. */
  definition?: { text: string; cite: string };
  body: string[]; // plain text paragraphs; may be empty
  archetypes: TheoreticTie[];
  families: TheoreticTie[];
  theoretics: TheoreticTie[]; // the theoretical web: this concept's own neighbours
  occurrenceCount: number; // every occurrence its tied archetypes and families carry
  /** The Theory section that already carries this concept, when one does. A link, never a choice. */
  section?: string;
  /** Another lens that already carries this concept (aion-time → Aion, synchronicity → Coincidences). */
  lens?: string;
  image?: ImageRef;
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
  /** Verbatim Jung quote with cite, picked from the vault's mentions — never typed. */
  definition?: { text: string; cite: string };
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
  /** the quote is a plate caption as printed (an object label), shown as one, never as a quotation */
  caption?: true;
  /** Plain-text paragraphs of the vault body (wikilinks resolved to names). */
  body: string[];
  parallelIds: OccurrenceId[]; // resolvable vault parallels only
  /**
   * Where it hangs in the sky, when a source puts it there (the Thoth card on its ruler's decan wheel, a sign on the
   * zodiac). Independent of the Earth place: `lat/lon` stay 0,0 and `geoPrecision` 'none' when this is its only place.
   */
  sky?: SkyLocus[];
  image?: ImageRef; // occurrence-specific image when one was found
}

export interface FieldMeta {
  generatedAt: string; // ISO
  vaultPath: string;
  vaultLedgerLine?: string; // last ledger heading, so the site can say how fresh it is
  counts: { archetypes: number; theoretics: number; families: number; occurrences: number; cultures: number; images: number; joins?: number };
  yearMin: number;
  yearMax: number;
}

/**
 * A general relation between two nodes of the field, of any tier to any tier (curation/joins.json, nothing else).
 * Basis says where the relation comes from, as for ties: never present "site" or "inferred" as Jung's word.
 * `system` names the tradition the join belongs to (e.g. "thoth"); `voice` names whose reading it is.
 * Joins carry no quotations in field.json.
 */
export interface Join {
  id: string; // kebab-case, unique
  a: { type: 'archetype' | 'theoretic' | 'family'; id: string };
  b: { type: 'archetype' | 'theoretic' | 'family'; id: string };
  basis: TieBasis;
  note: string; // one plain sentence, no wikilinks, ≤ 400 chars
  system?: string;
  voice?: string;
}

export interface Field {
  meta: FieldMeta;
  archetypes: Archetype[];
  theoretics: Theoretic[];
  families: Family[];
  occurrences: Occurrence[];
  cultures: Culture[];
  /** Cross-system relations between any two nodes. Optional: older field.json files carry none. */
  joins?: Join[];
}
