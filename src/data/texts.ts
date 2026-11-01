// A text is a lens (PRODUCT-ALIGNMENT-PLAN §5, N12): the Texts lens takes a Work as its subject, and everything it shows is
// read here, so the lens holds no derivation. Pure: the Model in, plain objects out, no DOM.
import type { Model } from './model';
import type { Work, WorkId, WorkKind } from '../types/works';
import type { Walk } from '../types/walks';

/** One chapter of the Work's contents with the stops of its page walk that fall inside it: `walk.stops.slice(from, to)`. */
export interface TextChapter {
  title: string;
  /** the pdf page it begins on (the Work's corpus volume) */
  page: number;
  level: number;
  /** the first stop on or after the chapter's page; `from === to` when the chapter holds none */
  from: number;
  /** one past the last stop before the next chapter of the same or a higher rank (a chapter holds its sub-chapters) */
  to: number;
}

export interface WorkLens {
  id: WorkId;
  title: string;
  kind: WorkKind;
  /** whose words the Work is, as the registry names the voice */
  voice: string;
  /** first publication, only where the corpus states it */
  year?: number;
  /** the Work's own reading lens, where it has one: CW9ii is the Aion lens, Liber Novus the Red Book lens */
  lens?: 'aion' | 'redbook';
  contents: TextChapter[];
  /** the occurrences that cite the Work (Model.workMem): indices into `Model.occ`, what a scope reads */
  scope: Set<number>;
  /** the Work's walk in page order; absent when none of its cites is placed on its corpus volume */
  walk?: Walk;
  /** the images the walk's stops carry (the image's `src`), in walk order, once each */
  plates: string[];
}

/** The Work a cite key names (a Work's id or any of its aliases), or undefined. A cite keeps its key; this is how it is read. */
export function workOfCite(m: Model, citeKey: string): Work | undefined {
  const id = m.workKey.get(citeKey);
  return id === undefined ? undefined : m.workById.get(id);
}

/** The chapters of a Work with their stop ranges over a page walk (none when there is no walk). */
function contentsOf(chapters: Work['chapters'], walk: Walk | undefined): TextChapter[] {
  const pages = (walk?.stops ?? []).map((s) => s.page?.page ?? -1);
  // the walk is in page order: the first stop at or after a page is a binary search away, but chapter tables are short
  const firstFrom = (page: number): number => {
    let i = 0;
    while (i < pages.length && pages[i] < page) i++;
    return i;
  };
  return chapters.map((c, k) => {
    let end = Infinity;
    for (let j = k + 1; j < chapters.length; j++) if (chapters[j].level <= c.level) { end = chapters[j].page; break; }
    const from = firstFrom(c.page);
    const to = end === Infinity ? pages.length : Math.max(from, firstFrom(end));
    return { title: c.title, page: c.page, level: c.level, from, to };
  });
}

/** The lens of a Work, by its id or any alias; undefined for a key no Work holds. */
export function workLens(m: Model, key: string): WorkLens | undefined {
  const w = workOfCite(m, key);
  if (!w) return undefined;
  const walk = m.walkById.get(`text/${w.id}`);
  const seen = new Set<string>();
  const plates: string[] = [];
  for (const s of walk?.stops ?? []) {
    const i = s.subject ? m.occIndex.get(s.subject.id) : undefined;
    const src = i === undefined ? undefined : m.occ[i].image?.src;
    if (src && !seen.has(src)) { seen.add(src); plates.push(src); }
  }
  return {
    id: w.id,
    title: w.title,
    kind: w.kind,
    voice: w.voice,
    ...(w.year !== undefined ? { year: w.year } : {}),
    ...(w.lens ? { lens: w.lens } : {}),
    contents: contentsOf(w.chapters, walk),
    scope: new Set(m.workMem.get(w.id) ?? []),
    ...(walk ? { walk } : {}),
    plates,
  };
}

export interface VoiceGroup {
  voice: string;
  kinds: { kind: WorkKind; works: Work[] }[];
}

/** The kinds in the order the picker lists them: the collected volumes first, then the books about and around them. */
const KIND_ORDER: WorkKind[] = ['collected-volume', 'seminar', 'lectures', 'book', 'letters', 'memoir', 'manuscript', 'anthology', 'dictionary', 'deck', 'secondary'];

/**
 * The instances a Work attests, as an archetype's are listed: indices into `Model.occ`, by date (`Model.workMem` keeps them
 * so). A text is read through these, each linking back to it; the text itself is never put on the page.
 */
export function workInstances(m: Model, key: string): number[] {
  const w = workOfCite(m, key);
  return w ? [...(m.workMem.get(w.id) ?? [])] : [];
}

/**
 * Every Work that attests an instance, once, grouped for the picker: by voice (the voice with most Works first, the field's
 * own, then the rest by their number of Works and by name; no voice is named in code) and, within a voice, by kind in
 * KIND_ORDER; within a kind, the registry's order (by id). A Work no instance cites has nothing to show and is not listed.
 */
export function worksByVoice(m: Model): VoiceGroup[] {
  const byVoice = new Map<string, Work[]>();
  for (const w of m.workById.values()) {
    if (!m.workMem.get(w.id)?.length) continue;
    const l = byVoice.get(w.voice);
    if (l) l.push(w); else byVoice.set(w.voice, [w]);
  }
  const voices = [...byVoice.keys()].sort((a, b) => byVoice.get(b)!.length - byVoice.get(a)!.length || a.localeCompare(b));
  return voices.map((voice) => {
    const list = byVoice.get(voice)!;
    const kinds = [...new Set(list.map((w) => w.kind))].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
    return { voice, kinds: kinds.map((kind) => ({ kind, works: list.filter((w) => w.kind === kind) })) };
  });
}
