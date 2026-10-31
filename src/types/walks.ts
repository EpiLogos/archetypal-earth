// The walks (public/data/walks.json, built by scripts/walks.mjs): ordered stops the Walk runner steps. Each stop is a record
// of a file that already exists; nothing in a walk is authored. See scripts/verify-walks.mjs for what is proven of them.

export type WalkKind = 'aion-thread' | 'aion-chapters' | 'redbook' | 'theory-route' | 'alchemy-stages' | 'theoretic' | 'text';

/** How a walk is ordered: as its source curates it, by the year of its stops, or by the page of the text it reads. */
export type WalkOrder = 'curated' | 'chronological' | 'page';

export interface WalkStop {
  subject?: { type: 'occurrence' | 'event' | 'chapter' | 'stage' | 'concept' | 'route-stop' | 'theoretic'; id: string };
  /** the corpus page the stop opens (the Work's own id, the pdf page of its volume) */
  page?: { work: string; page: number };
  /** the clock: the subject's own year */
  year?: number;
  /** a text stop only: the first year of the cite's own engagement string (Cite.citeYear), where it names one */
  citeYear?: number;
  place?: { lat: number; lon: number };
  cite?: { work: string; locator: string };
  /** a theoretic stop only: the section of the theoretic's page the stop stands in (its heading and the line that orients it) */
  section?: { id: string; title: string; line: string };
  /** a theoretic stop only: the words at the stop, verbatim as the theoretic's page cites them */
  text?: string;
  /** a theoretic stop only: whose words, when they are not Jung's ('pauli') */
  voice?: string;
  /** a theoretic stop only: the words are an object label as printed, shown unquoted */
  caption?: true;
}

export interface Walk {
  id: string;
  kind: WalkKind;
  title: string;
  source: string;
  ordered: WalkOrder;
  stops: WalkStop[];
}

export interface WalksData {
  version: 1;
  walks: Walk[];
}
