// S4: one era table. The filter's era chips (src/shell/filter.ts) and the time strip's era names (src/data/time.ts, drawn by
// src/ui/time-control.ts) read the same table, src/data/eras.ts: two vocabularies would let the strip say "Middle Ages" over
// a stretch the chip calls "500–1499".
import { describe, expect, it } from 'vitest';
import { ERA_CEIL, ERA_FLOOR, ERA_TABLE } from '../../src/data/eras';
import { ERAS } from '../../src/shell/filter';
import { createTimeScale } from '../../src/data/time';

describe('one era table', () => {
  it('the table covers all of time once: contiguous, ordered, open at both ends', () => {
    expect(ERA_TABLE.length).toBeGreaterThanOrEqual(5);
    expect(ERA_TABLE[0].from).toBe(-Infinity);
    expect(ERA_TABLE[ERA_TABLE.length - 1].to).toBe(Infinity);
    for (let i = 1; i < ERA_TABLE.length; i++) expect(ERA_TABLE[i].from, ERA_TABLE[i].id).toBe(ERA_TABLE[i - 1].to);
    expect(new Set(ERA_TABLE.map((e) => e.id)).size).toBe(ERA_TABLE.length);
  });

  it('the filter chips are the table: same ids, same names, the table\'s ranges', () => {
    expect(ERAS.map((e) => e.id)).toEqual(ERA_TABLE.map((e) => e.id));
    expect(ERAS.map((e) => e.label)).toEqual(ERA_TABLE.map((e) => e.name));
    for (const [i, e] of ERAS.entries()) {
      expect(e.range[0], e.id).toBe(Math.max(ERA_TABLE[i].from, ERA_FLOOR));
      expect(e.range[1], e.id).toBe(Number.isFinite(ERA_TABLE[i].to) ? ERA_TABLE[i].to - 1 : ERA_CEIL);
    }
  });

  it('the time strip draws the table: over a span that holds every era, its names and bounds are the table\'s', () => {
    const scale = createTimeScale(-4000, 2000);
    expect(scale.eras.map((e) => e.name)).toEqual(ERA_TABLE.map((e) => e.name));
    for (const [i, e] of scale.eras.entries()) {
      expect(e.from, e.name).toBe(Math.max(ERA_TABLE[i].from, -4000));
      expect(e.to, e.name).toBe(Math.min(ERA_TABLE[i].to, 2000));
    }
  });

  it('a chip\'s range holds a year exactly when the strip puts that year in the chip\'s era', () => {
    const scale = createTimeScale(-4000, 2000);
    for (const y of [-3000, -1, 0, 249, 250, 749, 750, 1399, 1400, 1699, 1700, 1960]) {
      const strip = scale.eras.filter((e) => y >= e.from && y < e.to).map((e) => e.name);
      const chips = ERAS.filter((e) => y >= e.range[0] && y <= e.range[1]).map((e) => e.label);
      expect(chips, String(y)).toEqual(strip);
    }
  });
});
