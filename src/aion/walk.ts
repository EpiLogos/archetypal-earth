// The walks a reading offers in Options: the whole reading in time order, then its curated threads. The whole-reading
// walk is derived here, client-side, from the reading's own events; nothing is written back to the curated data.
import type { AeonEvent, AeonThread, HistoryReading } from '../types/history';

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
