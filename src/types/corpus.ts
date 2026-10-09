// The corpus contract — the structured passage index behind citation deep links.
// Built by scripts/lib/corpus.mjs from the vault's read-only corpus/ into
// public/data/corpus/ (index.json + one file per volume). The Field contract
// (field.ts) is untouched: a Cite's locator here is resolved, never rewritten.

export interface CorpusChapter {
  id: string;
  title: string;
  /** pdf page the chapter heading sits on. */
  p: number;
  /** offset of the heading line within that page's text. */
  off: number;
}

export interface CorpusPage {
  /** pdf page number. */
  p: number;
  /** printed page label as the corpus kept it, when present. */
  print?: string;
  /** id of the chapter this page opened under. */
  ch?: string;
  text: string;
}

/** A ¶ anchor: a span (off/len) inside its page's text. */
export interface CorpusPara {
  para: number;
  p: number;
  off: number;
  len: number;
}

export interface CorpusWork {
  work: string;
  title: string;
  chapters: CorpusChapter[];
  pages: CorpusPage[];
  paras: CorpusPara[];
}

export interface CorpusIndexEntry {
  work: string;
  title: string;
  /** file name under public/data/corpus/. */
  file: string;
  pages: number;
  paras: number;
  chapters: number;
}

export interface CorpusIndex {
  generatedAt: string;
  vaultPath: string;
  works: CorpusIndexEntry[];
}
