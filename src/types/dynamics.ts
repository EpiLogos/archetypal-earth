// The contract of public/data/dynamics.json — OPTIONAL. Absent is the normal state: the mode then renders
// everything computed from field.json and shows no concept cards.
//
// Written by the vault-side rail (curation/dynamics.json → scripts/dynamics.mjs), which matches every Van Eenwyk
// quotation verbatim against the vault corpus before writing it. A quotation is never typed in src/.
// Labels (names) are terse curated labels; no sentence in this file is authored by the site.

export interface DynamicsCite {
  /** Corpus work key ("cw09ii") when the passage is in the vault corpus; enables a passage link for Jung's text. */
  work?: string;
  /** The printed work, e.g. "Archetypes & Strange Attractors (1997)". */
  workTitle: string;
  /** Year of the printed work or of Jung's engagement, as written. */
  year: string;
  /** A printed-page locator, e.g. "p. 110". */
  locator: string;
}

export interface DynamicsQuote {
  text: string;
  cite: DynamicsCite;
}

/** Which native render heads the concept's card (the Lorenz trail when absent). */
export type DynamicsRender = 'lorenz' | 'mandelbrot' | 'julia';

export interface DynamicsConcept {
  id: string;
  /** Terse V label, e.g. "Strange attractor". */
  name: string;
  /** Van Eenwyk's verbatim passage, page-cited (V). A concept without one is not written. */
  quote: DynamicsQuote;
  /** Jung's paired passage (J), when the vault pairs one. */
  jung?: DynamicsQuote;
  /** The families the concept binds to: its card is offered for subjects that visit one of them. */
  familyIds: string[];
  render?: DynamicsRender;
}

export interface DynamicsData {
  version: 1;
  concepts: DynamicsConcept[];
}
