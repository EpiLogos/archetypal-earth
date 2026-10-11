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

/** A further quotation a route stop carries (Neumann; Van Eenwyk on Neumann), placed in the corpus by its generator. */
export interface RouteQuote {
  text: string;
  cite: { work: string; workTitle: string; locator: string; print?: string };
  /** 'vaneenwyk' | 'neumann' */
  voice?: string;
}

/** One stop of the route: a concept of the rail's (by id), or a stop of its own (a name and its families). */
export interface RouteStop {
  id: string;
  /** the native figure that draws it (src/dynamics/figures.ts) */
  figure: string;
  /** mine: what the drawing shows and what the quotations under it say */
  line: string;
  concept?: string;
  name?: string;
  familyIds?: string[];
  quotes?: RouteQuote[];
  /** the QL framework's own words, from the published site by section (W § I) */
  ql?: { text: string; source: string }[];
}

export interface RouteMovement {
  id: string;
  n: string;
  title: string;
  line: string;
  stops: RouteStop[];
}

/** public/data/dynamics-route.json (scripts/dynamics-route.mjs): the lens's walk, in four movements. Optional. */
export interface DynamicsRoute {
  version: 1;
  title: string;
  line: string;
  movements: RouteMovement[];
}
