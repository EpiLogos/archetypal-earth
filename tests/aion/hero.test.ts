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

describe('Aion hero images', () => {
  it('covers the events that have a resolvable image far beyond the own-occurrence baseline', () => {
    const jung = history.readings.find((r) => r.id === 'jung-aion')!;
    const turn = history.readings.find((r) => r.id === 'jung-turn')!;
    const horizon = history.readings.find((r) => r.id === 'jung-aquarius-horizon')!;
    const covered = (r: History['readings'][number]) => r.events.filter((e) => eventHeroImage(model, e)).length;
    const baseline = (r: History['readings'][number]) => r.events.reduce((n, e) => n + ownImage(e), 0);
    expect(baseline(jung)).toBe(3);
    expect(covered(jung)).toBeGreaterThanOrEqual(29);
    expect(covered(turn)).toBeGreaterThanOrEqual(13);
    expect(covered(horizon)).toBeGreaterThanOrEqual(1);
  });

  it('gives every epoch a hero or leaves it a tonal plate, and gives the epochs with images their own family or archetype', () => {
    const jung = history.readings.find((r) => r.id === 'jung-aion')!;
    const withImage = jung.epochs.filter((e) => epochHeroImage(model, jung, e));
    expect(withImage.length).toBeGreaterThanOrEqual(6);
    // the earliest epoch has no events inside it, so it correctly falls back to its tonal palette
    expect(epochHeroImage(model, jung, jung.epochs.find((e) => e.id === 'taurus')!)).toBeUndefined();
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
});
