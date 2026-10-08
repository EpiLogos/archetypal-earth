import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { epochAt, eventOccurrences, historyExtent } from '../../src/aion/model';
import { hashToState, stateToHash } from '../../src/state/router';
import { back, stateEq, WORLD, type AppState } from '../../src/state/store';
import type { Field } from '../../src/types/field';
import type { History } from '../../src/types/history';
const field = JSON.parse(readFileSync(new URL('../../public/data/field.json', import.meta.url), 'utf8')) as Field;
const history = JSON.parse(readFileSync(new URL('../../public/data/history.json', import.meta.url), 'utf8')) as History;
const reading = history.readings[0];
const model = buildModel(field, historyExtent(history));
const resolver = {
  hasArchetype: (id: string) => model.archById.has(id), hasFamily: (id: string) => model.famById.has(id),
  hasCulture: (id: string) => model.cultureById.has(id), hasPlace: (id: string) => model.places.has(id),
  familyOf: (id: string) => { const i = model.occIndex.get(id); return i === undefined ? undefined : model.occ[i].familyId; },
  hasReading: (id: string) => history.readings.some(r => r.id === id),
  hasHistorySelection: (id: string, kind: string, selection: string) => {
    const r = history.readings.find(r => r.id === id);
    return !!r && (kind === 'epoch' ? r.epochs : kind === 'event' ? r.events : r.threads).some(x => x.id === selection);
  },
};

describe('the published Aion reading in the atlas', () => {
  it('resolves nested atmosphere at real epoch boundaries without losing the future endpoint', () => {
    expect(epochAt(reading, 500)?.id).toBe('pisces-first-fish');
    expect(epochAt(reading, 1000)?.id).toBe('pisces-commissure');
    expect(epochAt(reading, 1600)?.id).toBe('pisces-second-fish');
    expect(epochAt(reading, 2200)?.id).toBe('aquarius');
    expect(epochAt(reading, reading.to)?.id).toBe('aquarius');
    expect(epochAt(reading, reading.from - 1)).toBeUndefined();
  });
  it('extends the live clock to every published epoch and event', () => {
    for (const year of [reading.from, reading.to, ...reading.events.map(e => e.year)]) {
      expect(model.scale.fromU(model.scale.toU(year))).toBeCloseTo(year, 4);
    }
  });
  it('gathers only actual field occurrences from historical event links', () => {
    for (const event of reading.events) {
      const gathered = eventOccurrences(model, event);
      expect(new Set(gathered).size).toBe(gathered.length);
      for (const id of event.occurrenceIds) expect(gathered).toContain(model.occIndex.get(id));
      for (const i of gathered) expect(event.occurrenceIds.includes(model.occ[i].id) || event.familyIds.includes(model.occ[i].familyId)).toBe(true);
    }
  });
  it('round-trips each historical selection and backs out through the reading', () => {
    for (const [kind, items] of [['epoch', reading.epochs], ['event', reading.events], ['thread', reading.threads]] as const) {
      for (const item of items) {
        const state: AppState = { view: { kind: 'world' }, deep: false, history: { reading: reading.id, selection: { kind, id: item.id } } };
        expect(stateEq(hashToState(stateToHash(state), resolver).state, state)).toBe(true);
        expect(back(back(state))).toEqual(WORLD);
      }
    }
    expect(hashToState('#/aion/unknown', resolver).state).toEqual(WORLD);
    expect(hashToState(`#/aion/${reading.id}/event/unknown`, resolver).state.history?.selection).toBeUndefined();
  });
});
