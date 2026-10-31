// DREAMS: the Contents of the lens (H5). The journal and the way to record a dream come first; under them stand the visitor's own
// dreams, newest first, each by the title the visitor gave it (or its first words). A dream is the visitor's: its words appear here,
// in this browser's page, and nowhere else (never in a route, which names an entry by its random id). Pure: entries in, groups out.
import type { ContentsGroup } from '../ui/deep';

export interface DreamListing { id: string; date: string; title: string; text: string; createdAt: string }

/** What a dream is called in a list: the visitor's own title, else the first words of the dream, else a plain word. */
export function dreamName(d: Pick<DreamListing, 'title' | 'text'>): string {
  return d.title.trim() || d.text.trim().slice(0, 60) || 'Untitled';
}

/** The visitor's dreams, newest first (by the date they gave, then by when they were kept). */
export function newestFirst<T extends Pick<DreamListing, 'date' | 'createdAt'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}

/** `at` is the route the lens stands at: `[]` the journal, `['new']` the recorder, `[id, …]` a dream. */
export function dreamsContentsGroups(dreams: readonly DreamListing[], at: readonly string[], go: (path: string[]) => void): ContentsGroup[] {
  const onDream = (id: string) => at[0] === id;
  return [
    {
      title: 'Dreams',
      items: [
        { label: 'The journal', current: at.length === 0, onPick: () => go([]) },
        { label: 'Record a dream', current: at[0] === 'new', onPick: () => go(['new']) },
      ],
    },
    ...(dreams.length
      ? [{ title: 'Your dreams', items: newestFirst(dreams).map((d) => ({ label: dreamName(d), note: d.date, current: onDream(d.id), onPick: () => go([d.id]) })) }]
      : []),
  ];
}
