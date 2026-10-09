import { describe, expect, it } from 'vitest';
import { buildFixture } from '../../src/dev/fixture';
import { buildModel, shortPlace, slug, subjectOccurrences } from '../../src/data/model';
import { planThread, thin, THREAD_MAX } from '../../src/data/thread';
import { clipText, shortLocator, shortWork } from '../../src/ui/format';
import { buildSearchIndex, search } from '../../src/data/search';

const model = buildModel(buildFixture());

describe('model indexes', () => {
  it('indexes every occurrence and places only the located ones', () => {
    expect(model.occ.length).toBeGreaterThan(100);
    model.occ.forEach((o, i) => {
      expect(model.located[i]).toBe(o.geoPrecision === 'none' ? 0 : 1);
      expect(model.u[i]).toBeGreaterThanOrEqual(0);
      expect(model.u[i]).toBeLessThanOrEqual(1);
    });
  });

  it('keeps family occurrences in chronological order', () => {
    for (const list of model.famOcc.values()) {
      for (let i = 1; i < list.length; i++) expect(model.occ[list[i]].year).toBeGreaterThanOrEqual(model.occ[list[i - 1]].year);
    }
  });

  it('an archetype’s occurrences are the union of its families’', () => {
    const arch = model.field.archetypes.find((a) => a.id === 'self')!;
    const n = subjectOccurrences(model, { type: 'archetype', id: 'self' }).length;
    const fams = new Set(arch.familyIds);
    const expected = model.field.occurrences.filter((o, i) => model.located[i] && fams.has(o.familyId)).length;
    expect(n).toBe(expected);
  });

  it('shortens places and slugs', () => {
    expect(shortPlace('Chartres, France (cathedral)')).toBe('Chartres');
    expect(slug('Küsnacht')).toBe('kusnacht');
  });
});

describe('scale: a field of five thousand occurrences', () => {
  const base = buildFixture();
  const big = { ...base, occurrences: Array.from({ length: 5000 }, (_, i) => ({ ...base.occurrences[i % base.occurrences.length], id: `occ-${i}`, year: -3000 + (i % 4960) })) };
  big.families = base.families.map((f) => ({ ...f, occurrenceIds: [] }));

  it('builds the model quickly', () => {
    const t0 = performance.now();
    const m = buildModel(big);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(m.occ).toHaveLength(5000);
    expect(m.u).toHaveLength(5000);
  });

  it('searches within a few milliseconds', () => {
    const m = buildModel(big);
    const idx = buildSearchIndex(m);
    const t0 = performance.now();
    for (const q of ['ser', 'tree', 'rome', 'renaissance', 'mother']) search(idx, q);
    expect((performance.now() - t0) / 5).toBeLessThan(40);
  });
});

describe('thread planning', () => {
  it('orders steps oldest to newest and caps their number', () => {
    const steps = planThread(model, 'family', 'serpent');
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.length).toBeLessThanOrEqual(THREAD_MAX);
    for (let i = 1; i < steps.length; i++) expect(model.occ[steps[i].occ].year).toBeGreaterThanOrEqual(model.occ[steps[i - 1].occ].year);
    expect(steps[0].arcFromPrev).toBe(false);
  });

  it('thins long lists evenly, preferring image-bearing entries', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ i, img: i % 7 === 0 }));
    const out = thin(items, 10, (x) => x.img);
    expect(out).toHaveLength(10);
    expect(out[0].i).toBeLessThan(10);
    expect(out[9].i).toBeGreaterThan(80);
    expect(out.filter((x) => x.img).length).toBeGreaterThanOrEqual(5);
  });

  it('builds a parallels thread around one occurrence', () => {
    const o = model.occ.find((x, i) => model.located[i] && x.parallelIds.length > 1)!;
    const steps = planThread(model, 'parallels', o.id);
    expect(steps.some((s) => model.occ[s.occ].id === o.id)).toBe(true);
    expect(steps.length).toBeGreaterThan(1);
  });
});

describe('text formatting', () => {
  it('trims the work title and locator to the quiet single line', () => {
    expect(shortWork('Psychology and Alchemy (CW12)')).toBe('Psychology and Alchemy');
    expect(shortLocator('fig. 131, ¶357 (pdf p268)')).toBe('¶357');
    expect(shortLocator('p. 12 (pdf p40)')).toBe('p. 12');
  });

  it('keeps a footnote the paragraph carries, and still strips the pdf noise around it', () => {
    expect(shortLocator('¶149, n.84 (pdf p106)')).toBe('¶149, n.84');
    expect(shortLocator('¶149, n.84')).toBe('¶149, n.84');
    expect(shortLocator('¶149,  n. 84 (pdf p106)')).toBe('¶149, n. 84');
    expect(shortLocator('¶149 (pdf p105–106)')).toBe('¶149');
    expect(shortLocator('¶149, n.84–85 (pdf p106)')).toBe('¶149, n.84–85');
    expect(shortLocator('fig. 131, ¶357, n.2 (pdf p268)')).toBe('¶357, n.2');
  });

  it('never shows a parenthesised pdf locator, with or without a paragraph or a footnote', () => {
    expect(shortLocator('p. 12 (pdf p40)')).not.toMatch(/pdf|\(/);
    expect(shortLocator('¶149 (pdf p105–106)')).not.toMatch(/pdf|\(/);
    expect(shortLocator('¶149, n.84 (pdf p106)')).not.toMatch(/pdf|\(/);
    expect(shortLocator('footnote n.84 (pdf p106)')).not.toMatch(/pdf|\(/);
  });

  it('clips at a sentence when it can', () => {
    const t = 'One short sentence here. Another sentence that runs on for quite a while longer than the limit allows.';
    expect(clipText(t, 40)).toBe('One short sentence here.');
    expect(clipText('short', 60)).toBe('short');
    expect(clipText('word '.repeat(40), 30).endsWith('…')).toBe(true);
  });
});
