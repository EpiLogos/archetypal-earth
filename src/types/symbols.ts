import type { FamilyId } from './field';

/** An editorial source layer, distinct from Jung's quotations and field records. */
export interface SymbolEntry {
  familyId: FamilyId;
  /** Title of the actual book entry, or named entries in a combined reading. */
  title: string;
  /** Printed book pages, separate from the file's 1-based PDF page numbers. */
  pages: number[];
  pdfPages: number[];
  /** Short site paraphrases of this source, never presented as Jung's words. */
  body: string[];
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
