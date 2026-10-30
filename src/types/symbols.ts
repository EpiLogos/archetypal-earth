import type { FamilyId } from './field';

/** An editorial source layer, distinct from Jung's quotations and field records. */
export interface SymbolQuote {
  text: string;
  /** the printed page of the book */
  page: number;
  /** the same page in the reviewed PDF (the printed page plus four) */
  pdfPage: number;
}

export interface SymbolEntry {
  familyId: FamilyId;
  /** Title of the actual book entry, or named entries in a combined reading. */
  title: string;
  /** Printed book pages, separate from the file's 1-based PDF page numbers. */
  pages: number[];
  pdfPages: number[];
  /**
   * Short verbatim quotations from the entry's own pages, each with the printed page and the pdf page it stands on. The book's words
   * (its contributors'), never Jung's. The quote oracle reads each from the reviewed PDF at check time; the repo holds no page text.
   */
  quotes: SymbolQuote[];
  /** Editorial comparisons with other existing families; not canonical field ties. */
  resonances: FamilyId[];
}

export interface Symbols {
  source: {
    id: string;
    title: string;
    editor: string;
    year: number;
    /** Private source provenance. The PDF is not served by the atlas. */
    sourcePath: string;
    sha256?: string;
    pageCount?: number;
  };
  entries: SymbolEntry[];
}
