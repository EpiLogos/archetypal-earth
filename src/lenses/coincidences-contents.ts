// COINCIDENCES: the Contents of the lens (H5). Your log first (the series, drawn), the way to log a coincidence, then the visitor's
// own entries, newest first, each by the image that connects its two events. The entries are the visitor's: their words appear in
// this browser's page and nowhere else. Pure: entries in, groups out.
import type { ContentsGroup } from '../ui/deep';

export interface CoincidenceListing { id: string; date: string; createdAt: string; name: string }

/** The visitor's entries, newest first (by the date they gave, then by when they were kept). */
export function newestEntriesFirst<T extends Pick<CoincidenceListing, 'date' | 'createdAt'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}

/** `at` is the route the lens stands at: `[]` the log, `['new']` the recorder, `[id, …]` an entry. */
export function coincidencesContentsGroups(entries: readonly CoincidenceListing[], at: readonly string[], go: (path: string[]) => void): ContentsGroup[] {
  return [
    {
      title: 'Coincidences',
      items: [
        { label: 'Your log', current: at.length === 0, onPick: () => go([]) },
        { label: 'Log a coincidence', current: at[0] === 'new', onPick: () => go(['new']) },
      ],
    },
    ...(entries.length
      ? [{ title: 'Your entries', items: newestEntriesFirst(entries).map((c) => ({ label: c.name, note: c.date, current: at[0] === c.id, onPick: () => go([c.id]) })) }]
      : []),
  ];
}
