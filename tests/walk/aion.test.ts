// H5 + S9, Aion: the reading's threads and the book's chapters are walked by the Walk runner. The old walks were
// `threadEvents[(i + delta + n) % n]` over a thread's event ids (and, for the whole reading, over the events in time order) and
// `book.chapters[(i + delta + n) % n]` over the chapters. They go only because the runner walks the same stops in the same
// order, at the same year and the same place, and wraps as they did. This file is that parity, made from the raw data files.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chaptersWalk, chronological, threadWalk, walksOf, WHOLE_READING_WALK } from '../../src/aion/walk';
import { WalkRunner } from '../../src/walk/runner';
import type { AionBook, History } from '../../src/types/history';
import type { Walk, WalksData } from '../../src/types/walks';

const raw = (f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'));
const history = raw('history.json') as History;
const book = raw('aionbook.json') as AionBook;
const walks = new Map((raw('walks.json') as WalksData).walks.map((w) => [w.id, w]));
const SNAP = { u: 0, focus: null, reading: null, centre: null, walk: null };
const scale = { toU: (year: number) => (year + 3000) / 5100 };
const located = (e: { lat?: number; lon?: number }) => Number.isFinite(e.lat) && Number.isFinite(e.lon);

describe('a thread is walked by the runner, as the old index walked it', () => {
  it('every curated thread reads the shipped walk of walks.json, stop for stop', () => {
    let seen = 0;
    for (const r of history.readings) {
      for (const t of r.threads) {
        const shipped = walks.get(`${r.id}/${t.id}`);
        expect(shipped, `${r.id}/${t.id}`).toBeDefined();
        expect(threadWalk(walks, r, t)).toBe(shipped);
        seen++;
      }
    }
    expect(seen).toBe(history.readings.reduce((n, r) => n + r.threads.length, 0));
  });

  it('each stop sets the clock to the event\'s year and flies to its place where it has one, as the card did', () => {
    for (const r of history.readings) {
      for (const t of r.threads) {
        const w = threadWalk(walks, r, t);
        expect(w.stops.map((s) => s.subject!.id)).toEqual(t.eventIds);
        w.stops.forEach((s, k) => {
          const e = r.events.find((x) => x.id === t.eventIds[k])!;
          expect(s.year).toBe(e.year);
          if (located(e)) expect(s.place).toEqual({ lat: e.lat, lon: e.lon });
          else expect(s.place).toBeUndefined();
        });
      }
    }
  });

  it('the whole reading is a walk of its own, derived: every event once, the earlier year first', () => {
    for (const r of history.readings) {
      const all = threadWalk(walks, r, walksOf(r)[0]);
      expect(walksOf(r)[0].id).toBe(WHOLE_READING_WALK);
      expect(all.id).toBe(`${r.id}/${WHOLE_READING_WALK}`);
      expect(all.stops.map((s) => s.subject!.id)).toEqual(chronological(r.events).map((e) => e.id));
      expect(all.stops).toHaveLength(r.events.length);
    }
  });

  it('the runner steps as the old rule did: forward and back from every stop, wrapping past either end', () => {
    for (const r of history.readings) {
      for (const t of walksOf(r)) {
        const w = threadWalk(walks, r, t);
        const n = t.eventIds.length;
        for (let at = 0; at < n; at++) {
          for (const delta of [1, -1]) {
            const run = new WalkRunner({ scale, wrap: true });
            run.start(w, SNAP, at);
            const step = delta > 0 ? run.next() : run.prev();
            expect(step!.stop.subject!.id).toBe(t.eventIds[(at + delta + n) % n]);
          }
        }
      }
    }
  });

  it('a walk file that has drifted from the thread is not trusted: the walk is drawn from the thread\'s own events', () => {
    const r = history.readings[0];
    const t = r.threads[0];
    const drifted = new Map(walks);
    const shipped = walks.get(`${r.id}/${t.id}`)!;
    drifted.set(shipped.id, { ...shipped, stops: [...shipped.stops].reverse() });
    const w = threadWalk(drifted, r, t);
    expect(w).not.toBe(drifted.get(shipped.id));
    expect(w.stops.map((s) => s.subject!.id)).toEqual(t.eventIds);
    const none = threadWalk(new Map<string, Walk>(), r, t);
    expect(none.stops.map((s) => s.subject!.id)).toEqual(t.eventIds);
    expect(none.stops.map((s) => s.year)).toEqual(shipped.stops.map((s) => s.year));
  });
});

describe('the book\'s chapters are walked by the runner', () => {
  it('walks.json holds the same sixteen chapters in the same order as the book', () => {
    const shipped = walks.get('aion-chapters')!;
    expect(shipped.stops.map((s) => s.subject!.id)).toEqual(book.chapters.map((c) => c.id));
    expect(shipped.stops).toHaveLength(16);
    expect(chaptersWalk(walks, book)).toBe(shipped);
  });

  it('a chapter has no year and no place: walking the book leaves the clock and the camera to the chapter\'s own events', () => {
    for (const s of chaptersWalk(walks, book).stops) {
      expect(s.year).toBeUndefined();
      expect(s.place).toBeUndefined();
    }
  });

  it('the runner steps as the old rule did, wrapping from the Foreword back to the last chapter and round again', () => {
    const w = chaptersWalk(walks, book);
    const n = book.chapters.length;
    for (let at = 0; at < n; at++) {
      for (const delta of [1, -1]) {
        const run = new WalkRunner({ scale, wrap: true });
        run.start(w, SNAP, at);
        const step = delta > 0 ? run.next() : run.prev();
        expect(step!.stop.subject!.id).toBe(book.chapters[(at + delta + n) % n].id);
      }
    }
  });

  it('a chapters walk that has drifted is not trusted: the walk is drawn from the book\'s chapters', () => {
    const w = chaptersWalk(new Map<string, Walk>(), book);
    expect(w.stops.map((s) => s.subject!.id)).toEqual(book.chapters.map((c) => c.id));
    expect(w.stops[2].page).toEqual({ work: book.work, page: book.chapters[2].pages[0] });
    const drifted = new Map(walks);
    const shipped = walks.get('aion-chapters')!;
    drifted.set('aion-chapters', { ...shipped, stops: shipped.stops.slice(1) });
    expect(chaptersWalk(drifted, book).stops).toHaveLength(16);
  });
});
