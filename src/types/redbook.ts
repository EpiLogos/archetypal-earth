// The Red Book contract — Liber Novus as a folio walk over the ingested field.
// Built by scripts/redbook.mjs from curation/redbook.json + field.json + the
// vault's Red Book layer. Every stop is an occurrence id in field.json (all
// `subject: jung`), so titles, dates, quotes and bodies live in the field and
// are never copied here. The facsimile plates are copyrighted Norton pages:
// they are LOCAL-ONLY runtime assets — never in git, never in dist.

export interface RedBookLicence {
  plates: string;
  text: string;
  vaultPathNote: string;
}

export interface RedBookPlates {
  /** Vault-relative directory of the facsimile plates. */
  vaultRelativeDir: string;
  /** Dev-server route the plates are served under (dev-only; 404 elsewhere). */
  urlPrefix: string;
  served: 'dev-only';
  note: string;
}

export interface RedBookSection {
  id: string;
  name: string;
  oneLine: string;
}

/** One stop of the walk: a liber-novus-* occurrence, ordered by the curated descent. */
export interface RedBookStop {
  /** occurrence id in field.json. */
  id: string;
  sectionId: string;
  /** Facsimile plate file ("p0028.jpg") when the folio has one — local-only. */
  plate?: string;
  /** The vault's own plate note, when the instance body carries one. */
  plateCaption?: string;
}

/** Where a genesis row's root "became": a field archetype, a family, or one of the Aion readings. */
export type GenesisTarget =
  | { kind: 'archetype'; id: string }
  | { kind: 'family'; id: string }
  | { kind: 'reading'; id: string }
  | null;

export interface GenesisRow {
  id: string;
  name: string;
  target: GenesisTarget;
  /** A second field tie, when the root became two things (the table's compound rows). */
  also?: Exclude<GenesisTarget, null | { kind: 'reading' }>;
  /** The liber-novus stop that carries the root locus. */
  stopId: string;
  /** The root's own words — a Reader-edition translation quote, as the vault cites it. */
  words: string;
  cite: string;
  /** The published doctrine it grew into. */
  doctrine: string;
}

export interface RedBook {
  generatedAt: string;
  licence: RedBookLicence;
  plates: RedBookPlates;
  mode: { title: string; subtitle: string; subject: 'jung'; oneLine: string };
  sections: RedBookSection[];
  stops: RedBookStop[];
  genesis: GenesisRow[];
}
