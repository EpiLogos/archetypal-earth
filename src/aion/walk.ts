// The walks a reading offers in its Contents: the whole reading in time order, then its curated threads; and the book's chapters.
// The whole-reading walk is derived here, client-side, from the reading's own events; nothing is written back to the curated
// data. The Walk runner steps them (S9): a thread is the shipped walk `${reading}/${thread}` of public/data/walks.json and the
// chapters are the shipped `aion-chapters`, each trusted only while it holds the very stops the reading and the book hold.
import type { AeonEvent, AeonThread, AionBook, HistoryReading } from '../types/history';
import type { Walk, WalkStop } from '../types/walks';

/** The id of the derived walk through every event. Not a curated thread id (the data never uses it). */
export const WHOLE_READING_WALK = 'all';
export const WHOLE_READING_NAME = 'The whole reading, in order';

/** The reading's events in time order: the earlier year first; the reading's own order breaks a tie. */
export function chronological(events: readonly AeonEvent[]): AeonEvent[] {
  return events
    .map((event, i) => ({ event, i }))
    .sort((a, b) => a.event.year - b.event.year || a.i - b.i)
    .map(({ event }) => event);
}

/** A walk through every event of the reading, earliest to latest. Derived, never stored. */
export function wholeReadingWalk(reading: Pick<HistoryReading, 'events'>): AeonThread {
  const events = chronological(reading.events);
  return {
    id: WHOLE_READING_WALK,
    name: WHOLE_READING_NAME,
    polarity: 'neutral',
    eventIds: events.map((e) => e.id),
    oneLine: `All ${events.length} events of the reading, from the earliest year to the latest.`,
  };
}

/** The walks Options offers for a reading: the derived whole-reading walk first, then the curated threads as written. */
export function walksOf(reading: HistoryReading): AeonThread[] {
  return [wholeReadingWalk(reading), ...reading.threads];
}

/** One walk by id (the derived one or a curated thread), or undefined. */
export function findWalk(reading: HistoryReading, id: string): AeonThread | undefined {
  return id === WHOLE_READING_WALK ? wholeReadingWalk(reading) : reading.threads.find((t) => t.id === id);
}

/** One event as a stop: its year moves the clock, its place (where it has one) flies the globe. */
function eventStop(e: AeonEvent): WalkStop {
  return {
    subject: { type: 'event', id: e.id },
    year: e.year,
    ...(Number.isFinite(e.lat) && Number.isFinite(e.lon) ? { place: { lat: e.lat!, lon: e.lon! } } : {}),
  };
}

const sameIds = (w: Walk, ids: readonly string[]) => w.stops.length === ids.length && w.stops.every((s, i) => s.subject?.id === ids[i]);

/**
 * The runner's walk for one of a reading's walks (the derived whole-reading walk or a curated thread): the shipped walk when it
 * holds the thread's events in the thread's order, else a walk drawn from the events themselves, so the rail never shows a
 * different thread than the Contents lists. An id the reading does not hold is left out, as the thread has always been.
 */
export function threadWalk(walks: ReadonlyMap<string, Walk>, reading: Pick<HistoryReading, 'id' | 'events'>, thread: AeonThread): Walk {
  const events = thread.eventIds.map((id) => reading.events.find((e) => e.id === id)).filter((e): e is AeonEvent => !!e);
  const id = `${reading.id}/${thread.id}`;
  const shipped = thread.id === WHOLE_READING_WALK ? undefined : walks.get(id);
  if (shipped && sameIds(shipped, events.map((e) => e.id))) return shipped;
  return {
    id, kind: 'aion-thread', title: thread.name, source: 'history.json#threads',
    ordered: thread.id === WHOLE_READING_WALK ? 'chronological' : 'curated',
    stops: events.map(eventStop),
  };
}

/** The runner's walk through the book, chapter by chapter: the shipped `aion-chapters` while it holds the book's chapters in order. */
export function chaptersWalk(walks: ReadonlyMap<string, Walk>, book: Pick<AionBook, 'work' | 'chapters'>): Walk {
  const shipped = walks.get('aion-chapters');
  if (shipped && sameIds(shipped, book.chapters.map((c) => c.id))) return shipped;
  return {
    id: 'aion-chapters', kind: 'aion-chapters', title: 'Aion, chapter by chapter', source: 'aionbook.json#chapters', ordered: 'curated',
    stops: book.chapters.map((c) => ({ subject: { type: 'chapter' as const, id: c.id }, page: { work: book.work, page: c.pages[0] } })),
  };
}
