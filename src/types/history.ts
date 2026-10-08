// Archetypal readings of history — the data contract for Aion mode.
//
// A HistoryReading is one author's archetypal view of historical time laid
// over the globe. Jung's Aion (CW9ii) is the first reading. Later readings
// (the owner's Antichrist material) declare `extends: "jung-aion"` and add
// epochs, events and threads on the same axes — they never rewrite Jung's.
//
// Output file: public/data/history.json → { readings: HistoryReading[] }.
import type { FamilyId, OccurrenceId, Palette } from './field';

/** A verbatim passage, always traceable. Never paraphrase inside `text`. */
export interface Passage {
  text: string;
  /** Work key as in the vault ("cw09ii") or a reading-local source key. */
  work: string;
  /** "¶127" or "¶127–128"; pdf page when the paragraph is unresolved. */
  locator: string;
}

/** Where a reading places the moral/psychic charge of a span of time. */
export type Polarity = 'light' | 'shadow' | 'union' | 'neutral';

export interface Epoch {
  id: string; // "pisces-first-fish"
  name: string; // "The first fish"
  /** Zodiacal sign when the epoch is a Platonic month or part of one. */
  sign?: string;
  from: number; // year, negative = BCE (approximate, as the reading gives it)
  to: number;
  /** Nested epochs (the two fishes inside Pisces) point at their parent. */
  parentId?: string;
  polarity: Polarity;
  /** 0 = instinct/infra-red … 1 = spirit/ultra-violet (same axis as archetypes). */
  spectrum: number;
  palette: Palette;
  oneLine: string; // ≤ 90 chars, the reading's own claim in plain words
  body: string[]; // short plain paragraphs, the site's summary (not the author's words)
  passages: Passage[]; // the author's own words that ground it
  /** field archetypes the epoch bears on (the Self, the Shadow…), when the reading itself names them */
  archetypeIds?: string[];
}

export interface AeonEvent {
  id: string;
  name: string; // "Jupiter–Saturn conjunction in Pisces"
  year: number;
  yearDisplay: string;
  place?: string;
  lat?: number;
  lon?: number;
  epochId: string;
  polarity: Polarity;
  oneLine: string;
  body: string[];
  passages: Passage[];
  familyIds: FamilyId[]; // field families this event bears on (fish, antichrist…)
  /** field archetypes the event bears on (the Self, the Shadow…), when the reading itself names them */
  archetypeIds?: string[];
  occurrenceIds: OccurrenceId[]; // field occurrences it gathers
}

/** A line through time the reading follows (e.g. the Christ/Antichrist opposition). */
export interface AeonThread {
  id: string;
  name: string;
  polarity: Polarity;
  eventIds: string[]; // in order
  oneLine: string;
}

export interface HistoryReading {
  id: string; // "jung-aion"
  title: string; // "Aion"
  author: string; // "C. G. Jung"
  work?: string; // "cw09ii"
  extends?: string; // id of the reading this one continues
  /** Span the reading's own clock covers, for the scrubber. */
  from: number;
  to: number;
  epochs: Epoch[];
  events: AeonEvent[];
  threads: AeonThread[];
}

export interface History {
  generatedAt: string;
  readings: HistoryReading[];
}
