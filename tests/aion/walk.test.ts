import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chronological, findWalk, wholeReadingWalk, WHOLE_READING_NAME, WHOLE_READING_WALK, walksOf } from '../../src/aion/walk';
import type { AeonEvent, History, HistoryReading } from '../../src/types/history';

const history = JSON.parse(readFileSync(new URL('../../public/data/history.json', import.meta.url), 'utf8')) as History;
const aion = history.readings.find((r) => r.id === 'jung-aion')!;

const event = (id: string, year: number): AeonEvent => ({
  id, name: id, year, yearDisplay: String(year), epochId: 'e', polarity: 'neutral', oneLine: '', body: [], passages: [],
  familyIds: [], occurrenceIds: [],
});

describe('the whole-reading walk', () => {
  it('walks every event of the reading, in chronological order', () => {
    const walk = wholeReadingWalk(aion);
    const years = walk.eventIds.map((id) => aion.events.find((e) => e.id === id)!.year);
    expect(walk.eventIds).toHaveLength(aion.events.length);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  it('every id it names resolves to one of the reading’s own events, each exactly once', () => {
    for (const r of history.readings) {
      const walk = wholeReadingWalk(r);
      const ids = new Set(r.events.map((e) => e.id));
      expect(walk.eventIds.every((id) => ids.has(id))).toBe(true);
      expect(new Set(walk.eventIds).size).toBe(r.events.length);
    }
  });

  it('keeps the reading’s own order where two events share a year', () => {
    const r = { events: [event('b', 10), event('a', 5), event('c', 10), event('d', 5)] };
    expect(chronological(r.events).map((e) => e.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('is named and identified apart from every curated thread', () => {
    const walk = wholeReadingWalk(aion);
    expect(walk.id).toBe(WHOLE_READING_WALK);
    expect(walk.name).toBe(WHOLE_READING_NAME);
    expect(aion.threads.some((t) => t.id === WHOLE_READING_WALK)).toBe(false);
  });

  it('leaves the curated data as it was read', () => {
    const before = JSON.stringify(history);
    const readings: HistoryReading[] = history.readings.map((r) => structuredClone(r));
    for (const r of readings) { wholeReadingWalk(r); walksOf(r); chronological(r.events); findWalk(r, WHOLE_READING_WALK); }
    expect(JSON.stringify(history)).toBe(before);
    expect(aion.threads.map((t) => t.id)).not.toContain(WHOLE_READING_WALK);
  });
});

describe('the walks Options offers', () => {
  it('lists the whole reading first, then the curated threads as written', () => {
    const walks = walksOf(aion);
    expect(walks[0].id).toBe(WHOLE_READING_WALK);
    expect(walks.slice(1)).toEqual(aion.threads);
  });

  it('finds a walk by id: the derived one or a curated thread; nothing else', () => {
    expect(findWalk(aion, WHOLE_READING_WALK)?.eventIds).toEqual(wholeReadingWalk(aion).eventIds);
    const curated = aion.threads[0];
    expect(findWalk(aion, curated.id)).toBe(curated);
    expect(findWalk(aion, 'no-such-walk')).toBeUndefined();
  });
});
