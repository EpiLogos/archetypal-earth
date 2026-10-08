// The data contract of the sky layer: the generator (scripts/sky.mjs → public/data/sky.json) and the
// experience layer (src/sky, src/aion/precession.ts) both code against this file only. It sits beside
// field.ts and reuses its palette, spectrum and tie vocabulary, so the sky deepens the one colour system.
//
// Astronomy comes from one authority, the ephemeris sidecar (Kerykeion / libephemeris, JPL DE440);
// mythic character is authored in curation/sky/. The vault's `wiki/sky/` tier, if the owner adopts it,
// replaces `provenance: 'curation'` with `'vault'` without changing this shape.
import type { Cite, Palette, TieBasis } from './field';

export type BodyKey =
  | 'sun' | 'moon' | 'earth'
  | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn'
  | 'uranus' | 'neptune' | 'pluto';

export const BODY_KEYS: readonly BodyKey[] = [
  'sun', 'moon', 'earth', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto',
];

/** Bodies sampled heliocentrically in the grid (the Sun is the origin; the Moon is geocentric). */
export const HELIO_KEYS: readonly BodyKey[] = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

export interface SkySource {
  claim: string;
  ref: string;
  /** ISO date the source was read */
  retrieved: string;
}

export interface SkyOrbit {
  /** the body this one circles when it is not the Sun (the Moon circles the Earth) */
  around?: BodyKey;
  /** semimajor axis, au */
  au: number;
  eccentricity: number;
  siderealDays: number;
  /** inclination to the ecliptic, degrees */
  inclinationDeg: number;
}

/** A body → field link, never presented as stronger than its basis. */
export interface SkyTie {
  body: BodyKey;
  target: { type: 'family' | 'archetype'; id: string };
  basis: TieBasis;
  /** justification in plain words; always present */
  note: string;
  /** the passages that carry it; required for `jung`, expected for `inferred`, absent for `site` */
  cites?: SkyCite[];
}

export interface SkyCite extends Pick<Cite, 'work' | 'workTitle' | 'locator'> {
  /** a verbatim substring of the cited page of the read-only corpus */
  quote: string;
}

/** A reading that belongs to a pair of bodies, e.g. the Self as the coniunctio of Sol and Luna. */
export interface SkyReading {
  id: string;
  bodies: BodyKey[];
  name: string;
  statement: string;
  targets: { type: 'family' | 'archetype'; id: string }[];
  basis: TieBasis;
  cites: SkyCite[];
}

export interface CultureProjection {
  name: string;
  kind: 'deity' | 'element';
  basis: TieBasis;
  source: string;
}

/** A page-cited quotation from Kathleen Burt's *Archetypes of the Zodiac* — her reading, named as hers, never Jung's. */
export interface SkyBodyQuote {
  text: string;
  /** the PDF page of the library copy the generator verified the words against */
  page: number;
  /** the book's own printed page, when the two differ */
  bookPage?: number;
  chapter?: string;
}

export interface SkyBody {
  key: BodyKey;
  order: number;
  /** discovered 1781 or later (uranus, neptune, pluto): outside Jung's classical seven */
  modern: boolean;
  /** default reading's name: the Greco-Roman form Jung inherits, with the alchemical reading foregrounded */
  name: string;
  /** ≤ 90 chars, the one-line mythic identity in the default projection */
  oneLine: string;
  orbit?: SkyOrbit;
  radiusKm: number;
  palette: Palette;
  /** instinct↔spirit position, 0..1 (see field.ts Spectrum) */
  spectrum: number;
  paletteFrom: string;
  discovered?: { year: number };
  sources: SkySource[];
  ties: SkyTie[];
  /** the book's own definitions of this body (curation/sky/burt.json), when it gives any */
  quotes?: SkyBodyQuote[];
  /** where the mythic layer comes from: the site's curation now, the vault's wiki/sky/ tier if adopted */
  provenance: 'curation' | 'vault';
}

/** Per-body numeric columns, equal length, display-grade (rounded by the sidecar). */
export interface SkyColumns {
  lon: number[];
  lat: number[];
  r: number[];
}

export interface SkyGrid {
  /** ISO instant of sample 0 (UTC) */
  start: string;
  stepHours: number;
  count: number;
  /** ecliptic and equinox of date; longitudes and latitudes in degrees; r in au */
  bodies: Partial<Record<BodyKey, SkyColumns>>;
}

/** One real period of an orbit, for drawing its ring: heliocentric, ecliptic, precession since 2026.0 removed. */
export interface SkyOrbitPath extends SkyColumns {
  start: string;
  stepHours: number;
  count: number;
  frame: string;
}

export interface GoldenEpoch {
  label: string;
  iso: string;
  jd: number;
  calendar: 'gregorian' | 'julian';
  /** `outside-ephemeris-range` records a date the loaded DE440 kernel cannot compute — never an approximation */
  status: 'ok' | 'outside-ephemeris-range';
  reason?: string;
  sun?: { lon: number; lat: number; r: number };
  moon?: { lon: number; lat: number; r: number };
  elongation?: number;
  gmst?: number;
  subsolar?: { lat: number; lon: number };
  sublunar?: { lat: number; lon: number };
  earth?: { lon: number; lat: number; r: number };
  planets?: Partial<Record<BodyKey, { lon: number; lat: number; r: number }>>;
  ayanamsa: Record<AyanamsaMode, number>;
}

export type AyanamsaMode = 'fagan-bradley' | 'lahiri';

export interface AyanamsaRow {
  year: number;
  jd: number;
  'fagan-bradley': number;
  lahiri: number;
}

export interface ConstellationBoundary {
  /** ecliptic longitude of J2000.0, degrees */
  lon: number;
  from: string;
  to: string;
}

export interface SkyMeta {
  generatedAt: string;
  sidecar: { name: string; version: string; packages: Record<string, string> };
  ephemeris: { kernel: string; from: string; to: string };
  /** the live span the grids cover */
  span: { from: string; to: string };
  /** longitudes are tropical, ecliptic and equinox of date, unless a field says otherwise */
  frame: string;
  counts: { bodies: number; ties: number; planetSamples: number; moonSamples: number };
}

export interface SkyData {
  meta: SkyMeta;
  constants: { auKm: number; earthRadiusKm: number; moonOrbitEarthRadii: number };
  bodies: SkyBody[];
  readings: SkyReading[];
  /** culture id → body → projection (default projection is the body's own name/oneLine) */
  cultures: Record<string, Partial<Record<BodyKey, CultureProjection>>>;
  /** named places for the birth-sky place field, with their source */
  gazetteer: Gazetteer;
  planets: SkyGrid;
  moon: SkyGrid;
  /** the rings of the system view: one period of each heliocentric body */
  orbits: Partial<Record<BodyKey, SkyOrbitPath>>;
  golden: {
    epochs: GoldenEpoch[];
    ayanamsa: {
      definitions: Record<AyanamsaMode, { valueDeg: number; epochJdTT: number }>;
      table: AyanamsaRow[];
    };
    constellationBoundaries: ConstellationBoundary[];
    boundaryFrame: string;
  };
}

// ── the sidecar's responses (the live side) ───────────────────────────────

export interface SidecarPing {
  name: string;
  version: string;
  time: string;
  python: string;
  packages: Record<string, string>;
  ephemeris: { kernel: string; fromJd: number; toJd: number; from: string; to: string };
}

export interface SidecarPoint {
  lon: number;
  lat: number;
  r: number;
  speed: number;
}

export interface SidecarSnapshot {
  jd: number;
  iso: string;
  sun: SidecarPoint;
  moon: SidecarPoint & { distKm: number };
  elongation: number;
  illuminated: number;
  waxing: boolean;
  gmst: number;
  subsolar: { lat: number; lon: number };
  sublunar: { lat: number; lon: number };
  earth: SidecarPoint;
  planets: Partial<Record<BodyKey, SidecarPoint>>;
  phase?: { name: string; major: string; stage: string; index: number; degreesBetween: number };
}

export type ChartAspectType = string;

export interface ChartPoint {
  lon: number;
  sign: string;
  signIndex: number;
  /** degrees within the sign, 0..30 */
  degree: number;
  retrograde: boolean;
  house: string | null;
}

export interface SidecarChart {
  input: { local: string; lat: number; lon: number; tz: string; utcOffsetMinutes: number };
  utc: string;
  jd: number;
  /** true before 1900: the civil clock behind the offset is not reliable */
  approximate: boolean;
  approximateReason: string | null;
  warnings: string[];
  zodiac: 'tropical';
  bodies: Partial<Record<BodyKey, ChartPoint>>;
  angles: { ascendant: ChartPoint; midheaven: ChartPoint };
  houses: { requested: string; effective: string; cusps: number[] };
  aspects: { a: BodyKey; b: BodyKey; type: ChartAspectType; orb: number }[];
  moon: { name: string; major: string; stage: string } | null;
  gmst: number;
}

export interface GazetteerPlace {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

export interface Gazetteer {
  source: { claim: string; ref: string; retrieved: string };
  places: GazetteerPlace[];
}

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
  source: string;
}

// ── the sky's own clock (D5): never the historical clock of time.ts ────────

/** A moment on the sky's clock, ms since the Unix epoch (UTC). */
export type SkyMoment = number;
