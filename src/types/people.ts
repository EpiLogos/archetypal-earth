// The people the field draws on (public/data/people.json, built by scripts/people-publish.mjs from curation/people.json, the
// Works registry and the cites of field.json). Every field is a source's word or null: a blank carries its reason in the
// curation file and stays blank here. Nothing about a visitor is ever in this file.
import type { SidecarChart } from './sky';
import type { WorkId } from './works';

export type PersonId = string; // slug, e.g. "jung", "von-franz"

/** A portrait that is a file of its own (public domain, credited), as against an id in the image registers. */
export interface PersonPortraitFile {
  src: string;
  title: string;
  credit: string;
  license: string;
  sourceUrl: string;
  width?: number;
  height?: number;
}

export interface PersonBirth {
  date: string;
  time: string | null;
  /** who gave the time, and how sure the rising degree is */
  timeSource: string;
  place: string;
  lat: number;
  lon: number;
  /** "mean-time" (the place's local mean time) or minutes east of UTC */
  offset: 'mean-time' | number;
}

export interface Person {
  id: PersonId;
  name: string;
  /** a year, or a full date where a record gives it; null when no source states it */
  born: number | string | null;
  died: number | string | null;
  role: string | null;
  /** an id in public/data/images*.json, or a file of its own; null when there is no honest portrait */
  portrait: string | PersonPortraitFile | null;
  /** the `subject` value occurrences of his own carry in field.json */
  subjectKey?: string;
  birth?: PersonBirth;
  /** the Works he wrote, wrote with, or edited, read from curation/works.json (ids, sorted) */
  works: WorkId[];
  /** how many occurrences carry his own subject; 0 where he has none */
  own: number;
  /** his natal placements, cast at build by src/astro/natal.ts from `birth`; only where a birth is given */
  natal?: SidecarChart & { timeKnown: boolean };
  /** the curation's source for each field, and the reason for each blank */
  sources: Record<string, string>;
  reasons: Record<string, string>;
}

export interface PeopleData {
  schema: 1;
  people: Person[];
}
