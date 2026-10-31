// SYMBOLS: the Contents of the lens (H5). The lens is one place to look a symbol up, so its Contents lead with the way in (find a
// symbol), then the images the field holds most instances of, then the dictionary's entries in the dictionary's own order. A pick
// is a request to read: the pane shows the reading. Pure: names in, groups out.
import type { ContentsGroup } from '../ui/deep';

export interface SymbolsNames {
  /** the images the field holds most instances of, most first */
  top: readonly { id: string; name: string }[];
  /** the dictionary's entries, in its own order; an entry whose image the field does not hold is not offered */
  entries: readonly { familyId: string; title: string }[];
  /** the ids of the images the field holds */
  held: ReadonlySet<string>;
}

/** The route the lens stands at (`[]` is the way in, `[family]` an image, `['archetype', id]` an archetype). */
export function symbolsContentsGroups(names: SymbolsNames, at: readonly string[], go: (path: string[]) => void): ContentsGroup[] {
  const onFamily = (id: string) => at.length === 1 && at[0] === id;
  const entries = names.entries.filter((e) => names.held.has(e.familyId));
  return [
    { title: 'Find', items: [{ label: 'Find a symbol', current: at.length === 0, onPick: () => go([]) }] },
    ...(names.top.length
      ? [{ title: 'The images with the most instances', items: names.top.map((t) => ({ label: t.name, current: onFamily(t.id), onPick: () => go([t.id]) })) }]
      : []),
    ...(entries.length
      ? [{ title: 'Symbols', items: entries.map((e) => ({ label: e.title, current: onFamily(e.familyId), onPick: () => go([e.familyId]) })) }]
      : []),
  ];
}
