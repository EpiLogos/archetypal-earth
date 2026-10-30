// N19a: the engagement log. What a person opens, walks, dreams, reads and charts is kept in this browser's practice store and
// nowhere else: local, capped, in the export / import / wipe, with a switch that stops the recording.
import { describe, expect, it } from 'vitest';
import { ENGAGEMENT_CAP, ENGAGEMENT_KINDS, LocalBackend, PracticeStore } from '../../src/practice/store';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: () => null, length: 0 } as Storage;
};
const fresh = (storage: Storage | null = memory()) => new PracticeStore(new LocalBackend(storage));

describe('engagements', () => {
  it('the kinds are open, walk, dream, symbol, coincidence, chart', () => {
    expect([...ENGAGEMENT_KINDS]).toEqual(['open', 'walk', 'dream', 'symbol', 'coincidence', 'chart']);
  });

  it('engage writes one record of the kind and the subject, and nothing else about the person', () => {
    const s = fresh();
    const e = s.engage('open', { type: 'work', id: 'cw12' })!;
    expect(e).not.toBeNull();
    expect(s.list('engagements')).toHaveLength(1);
    expect(Object.keys(e).sort()).toEqual(['createdAt', 'id', 'kind', 'subject', 'updatedAt']);
    expect(e.kind).toBe('open');
    expect(e.subject).toEqual({ type: 'work', id: 'cw12' });
    expect(s.engagements().map((x) => x.id)).toEqual([e.id]);
  });

  it('every kind can be recorded, and an unknown kind is refused', () => {
    const s = fresh();
    for (const k of ENGAGEMENT_KINDS) expect(s.engage(k, { type: 'family', id: 'serpent' })!.kind).toBe(k);
    expect(s.list('engagements')).toHaveLength(ENGAGEMENT_KINDS.length);
    expect(() => s.engage('browse' as never, { type: 'family', id: 'serpent' })).toThrow();
    expect(s.list('engagements')).toHaveLength(ENGAGEMENT_KINDS.length);
  });

  it('lists newest first', () => {
    const s = fresh();
    s.engage('open', { type: 'family', id: 'a' });
    s.engage('open', { type: 'family', id: 'b' });
    s.engage('walk', { type: 'walk', id: 'c' });
    expect(s.engagements().map((x) => x.subject.id)).toEqual(['c', 'b', 'a']);
  });

  it('is capped at 500: the oldest are dropped', () => {
    expect(ENGAGEMENT_CAP).toBe(500);
    const s = fresh();
    for (let i = 0; i < 510; i++) s.engage('open', { type: 'family', id: `f${i}` });
    const kept = s.engagements();
    expect(kept).toHaveLength(500);
    expect(kept[0].subject.id).toBe('f509');
    expect(kept[499].subject.id).toBe('f10');
    expect(kept.some((x) => x.subject.id === 'f9')).toBe(false);
  });

  it('the recording switch: on by default, off writes nothing, kept across a reload, and turning it off keeps what is there', () => {
    const storage = memory();
    const s = fresh(storage);
    expect(s.recording).toBe(true);
    s.engage('open', { type: 'family', id: 'serpent' });
    s.setRecording(false);
    expect(s.recording).toBe(false);
    expect(s.engage('open', { type: 'family', id: 'tree' })).toBeNull();
    expect(s.list('engagements')).toHaveLength(1);
    // a new page on the same storage finds it still off
    const again = fresh(storage);
    expect(again.recording).toBe(false);
    expect(again.engage('walk', { type: 'walk', id: 'w' })).toBeNull();
    again.setRecording(true);
    expect(again.engage('walk', { type: 'walk', id: 'w' })).not.toBeNull();
    expect(fresh(storage).recording).toBe(true);
  });

  it('forget one, or clear them all', () => {
    const s = fresh();
    const a = s.engage('open', { type: 'family', id: 'a' })!;
    s.engage('open', { type: 'family', id: 'b' });
    s.forgetEngagement(a.id);
    expect(s.engagements().map((x) => x.subject.id)).toEqual(['b']);
    s.clearEngagements();
    expect(s.engagements()).toEqual([]);
  });

  it('is in the export and the import, and the import respects the cap and refuses what is not an engagement', () => {
    const s = fresh();
    s.put('dreams', { title: 'kept' } as never);
    s.engage('open', { type: 'work', id: 'cw12' });
    s.engage('dream', { type: 'dream', id: 'd1' });
    const file = s.exportAll();
    expect(JSON.parse(file).engagements).toHaveLength(2);
    // the switch is the device's, not the file's
    expect(JSON.parse(file).settings).toBeUndefined();

    const t = fresh();
    t.setRecording(false);
    expect(t.importAll(file)).toEqual({ added: 3, kept: 0 });
    expect(t.engagements().map((x) => x.kind)).toEqual(['dream', 'open']);
    expect(t.recording).toBe(false);
    expect(t.importAll(file)).toEqual({ added: 0, kept: 3 });

    const flood = JSON.parse(file);
    flood.engagements = [
      ...Array.from({ length: 520 }, (_, i) => ({ id: `x${i}`, kind: 'open', subject: { type: 'family', id: `f${i}` }, createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(), updatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString() })),
      { id: 'bad1', kind: 'browse', subject: { type: 'family', id: 'f' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'bad2', kind: 'open', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const u = fresh();
    u.importAll(JSON.stringify(flood));
    const kept = u.engagements();
    expect(kept).toHaveLength(500);
    expect(kept.some((x) => x.id === 'bad1' || x.id === 'bad2')).toBe(false);
    expect(kept[0].id).toBe('x519');
    expect(kept.some((x) => x.id === 'x19')).toBe(false);
    expect(kept.some((x) => x.id === 'x20')).toBe(true);
  });

  it('an export from before the log existed still imports', () => {
    const t = fresh();
    const old = JSON.stringify({ kind: 'archetypal-earth-practice', version: 1, exportedAt: 'x', charts: [], dreams: [{ id: 'd', createdAt: 'a', updatedAt: 'a' }], coincidences: [] });
    expect(t.importAll(old)).toEqual({ added: 1, kept: 0 });
    expect(t.engagements()).toEqual([]);
  });

  it('wipe() deletes the log with the rest and leaves the switch where the person put it; wipe("engagements") deletes only the log', () => {
    const s = fresh();
    s.put('dreams', { title: 'x' } as never);
    s.engage('open', { type: 'family', id: 'a' });
    s.wipe('engagements');
    expect(s.engagements()).toEqual([]);
    expect(s.list('dreams')).toHaveLength(1);
    s.engage('open', { type: 'family', id: 'a' });
    s.setRecording(false);
    s.wipe();
    expect(s.engagements()).toEqual([]);
    expect(s.list('dreams')).toEqual([]);
    expect(s.recording).toBe(false);
  });

  it('tells its listeners the log changed, and works for the page’s life without storage', () => {
    const s = fresh(null);
    const seen: string[] = [];
    s.onChange((c) => seen.push(c));
    s.engage('chart', { type: 'chart', id: 'you' });
    expect(seen).toContain('engagements');
    expect(s.engagements()).toHaveLength(1);
    s.setRecording(false);
    expect(s.recording).toBe(false);
  });
});
