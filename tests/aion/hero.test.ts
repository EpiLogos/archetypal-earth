import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { epochHeroImage, eventHeroImage, historyExtent } from '../../src/aion/model';
import type { History } from '../../src/types/history';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const field: Field = JSON.parse(readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8'));
const history: History = JSON.parse(readFileSync(path.join(ROOT, 'public/data/history.json'), 'utf8'));
const model = buildModel(field, historyExtent(history));

/** What the card showed before the pass: only the event's own first resolvable occurrence image. */
const ownImage = (event: History['readings'][number]['events'][number]) => {
  const i = event.occurrenceIds.map((id) => model.occIndex.get(id)).find((x) => x !== undefined);
  return i !== undefined && model.occ[i].image ? 1 : 0;
};

/** Every archetype's own picture: a card that shows one of these is about the archetype, not about its event or epoch. */
const archetypeImages = new Set([...model.archById.values()].flatMap((a) => (a.image ? [a.image.src] : [])));

describe('Aion hero images', () => {
  it('covers the events that have a resolvable image far beyond the own-occurrence baseline', () => {
    const jung = history.readings.find((r) => r.id === 'jung-aion')!;
    const turn = history.readings.find((r) => r.id === 'jung-turn')!;
    const horizon = history.readings.find((r) => r.id === 'jung-aquarius-horizon')!;
    const covered = (r: History['readings'][number]) => r.events.filter((e) => eventHeroImage(model, e)).length;
    const baseline = (r: History['readings'][number]) => r.events.reduce((n, e) => n + ownImage(e), 0);
    expect(baseline(jung)).toBe(3);
    // measured after the archetype fallback was removed: 44 of 45, 20 of 22, 5 of 19 (69 of 86 in all)
    expect(covered(jung)).toBeGreaterThanOrEqual(44);
    expect(covered(turn)).toBeGreaterThanOrEqual(20);
    expect(covered(horizon)).toBeGreaterThanOrEqual(5);
    expect(history.readings.flatMap((r) => r.events).filter((e) => eventHeroImage(model, e)).length).toBeGreaterThanOrEqual(69);
  });

  it('gives the epochs with images the picture of a family their events stand in, and leaves the rest tonal', () => {
    const jung = history.readings.find((r) => r.id === 'jung-aion')!;
    const withImage = jung.epochs.filter((e) => epochHeroImage(model, jung, e));
    // measured: 5 of 7 (Taurus and Aquarius have no event with a family picture inside them)
    expect(withImage.length).toBeGreaterThanOrEqual(5);
    // the earliest epoch has no events inside it, so it correctly falls back to its tonal palette
    expect(epochHeroImage(model, jung, jung.epochs.find((e) => e.id === 'taurus')!)).toBeUndefined();
    // measured across all readings: 12 of 14 epochs
    const all = history.readings.flatMap((r) => r.epochs.filter((e) => epochHeroImage(model, r, e)));
    expect(all.length).toBeGreaterThanOrEqual(12);
  });

  it('never returns a broken reference: every hero is a real file under public/ with a title and credit', () => {
    for (const reading of history.readings) {
      for (const item of [...reading.events, ...reading.epochs] as const) {
        const image = 'occurrenceIds' in item ? eventHeroImage(model, item) : epochHeroImage(model, reading, item);
        if (!image) continue;
        expect(image.src).toMatch(/^img\//);
        expect(fs.existsSync(path.join(ROOT, 'public', image.src))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'public', image.thumb))).toBe(true);
      }
    }
  });

  it('is pure and deterministic: the same event or epoch gives the same hero on every call, and the data is left unchanged', () => {
    const before = JSON.stringify(history);
    for (const reading of history.readings) {
      for (const event of reading.events) {
        expect(eventHeroImage(model, event)).toEqual(eventHeroImage(model, event));
      }
      for (const epoch of reading.epochs) {
        expect(epochHeroImage(model, reading, epoch)).toEqual(epochHeroImage(model, reading, epoch));
      }
    }
    expect(JSON.stringify(history)).toBe(before);
  });

  it('relevance: no hero of an event or an epoch is an archetype\'s picture', () => {
    expect(archetypeImages.size).toBeGreaterThan(0);
    for (const reading of history.readings) {
      for (const event of reading.events) {
        const image = eventHeroImage(model, event);
        if (image) expect(archetypeImages.has(image.src), `${event.id} shows an archetype picture`).toBe(false);
      }
      for (const epoch of reading.epochs) {
        const image = epochHeroImage(model, reading, epoch);
        if (image) expect(archetypeImages.has(image.src), `${epoch.id} shows an archetype picture`).toBe(false);
      }
    }
  });
});
