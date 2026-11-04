// The Works the field draws on (public/data/works.json, built by scripts/works-publish.mjs from curation/works.json and the
// cites of field.json). A cite keeps its key; the registry folds the aliases (`redbook` is Liber Novus), so the app reads a
// cite through `Model.workKey`, never by comparing keys.

export type WorkId = string; // slug, e.g. "cw12", "liber-novus"

export type WorkKind =
  | 'collected-volume' | 'seminar' | 'lectures' | 'book' | 'anthology' | 'letters' | 'memoir' | 'manuscript' | 'secondary' | 'deck' | 'dictionary';

/** A chapter of a Work: its title and the pdf page it begins on (the page numbering of the Work's corpus volume). */
export interface WorkChapter {
  title: string;
  page: number;
  level: number;
}

/** A relation the cites give: how many cites of the Work stand on occurrences of this archetype, theoretic or family. */
export interface WorkTie {
  id: string;
  weight: number;
}

/**
 * A passage of the Work's own introductory matter (its foreword, preface or introduction), verbatim, that says what the text is.
 * The Work's page opens with it, before the instances it attests. The cite is the Quote component's, so the passage is
 * checked against the corpus volume by the quote oracle like every other quotation.
 */
export interface WorkBlurb {
  text: string;
  /** whose words they are, only where they are not the author's: 'The editors' on an editorial note, an introducer's name */
  voice?: string;
  cite: { work: WorkId; workTitle: string; /** 'pdf p7' or 'pdf p7-8' */ locator: string; /** the printed page, where the volume labels its pages */ print?: string };
}

export interface Work {
  id: WorkId;
  title: string;
  kind: WorkKind;
  /** a Person id (curation/people.json) where the author has a record, else the author's slug */
  author: string;
  /** a second named hand on the title page (Pauli on the letters, Martin on the Book of Symbols) */
  with?: string;
  editor?: string;
  /** whose words a cite of it is: "Jung", "Crowley", "Burt", "von Franz" … */
  voice: string;
  /** first publication, only where a copyright page in the corpus states it; the collected volumes carry none */
  year?: number;
  display?: string;
  /** the other cite keys of the same text; a cite resolves through them */
  aliases: string[];
  /** the corpus volume the text opens in (the same id), when the field holds its pages */
  corpus?: WorkId;
  /** the Work's own reading lens: `aion` for CW9ii, `redbook` for Liber Novus */
  lens?: 'aion' | 'redbook';
  chapters: WorkChapter[];
  /** the chapter table was derived from page runs, not read from a table of contents */
  chaptersDerived: boolean;
  /** what the text says of itself, from its introductory matter; absent where the corpus holds none that qualifies */
  blurb?: WorkBlurb;
  /** how many cites of the field name it, after the aliases fold */
  cites: number;
  /** how many occurrences carry at least one of them */
  occurrences: number;
  /** the relations the cites give, heaviest first; nothing here is typed in */
  ties: { archetypes: WorkTie[]; theoretics: WorkTie[]; families: WorkTie[] };
}

export interface WorksData {
  schema: 1;
  works: Work[];
}
