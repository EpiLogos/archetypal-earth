import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { planThread } from '../../src/data/thread';
import { back, focusOn, manifest, setDeep, startThread, WORLD } from '../../src/state/store';
import { hashToState, stateToHash } from '../../src/state/router';
import type { Field } from '../../src/types/field';

const field = JSON.parse(readFileSync(new URL('../../public/data/field.json', import.meta.url), 'utf8')) as Field;
const model = buildModel(field);
const resolver = {
  hasArchetype: (id: string) => model.archById.has(id),
  hasFamily: (id: string) => model.famById.has(id),
  hasCulture: (id: string) => model.cultureById.has(id),
  hasPlace: (id: string) => model.places.has(id),
  familyOf: (id: string) => { const i = model.occIndex.get(id); return i === undefined ? undefined : model.occ[i].familyId; },
};

describe('inspecting an actual traced path', () => {
  for (const type of ['family', 'archetype'] as const) {
    it(`retains the ${type} path through node inspection, deep reading, URL reload and return`, () => {
      const id = type === 'family' ? 'serpent' : 'self';
      const subject = { type, id };
      const thread = startThread(focusOn(WORLD, subject), { type, id });
      const steps = planThread(model, type, id);
      expect(steps.length).toBeGreaterThan(2);
      const occurrence = model.occ[steps[1].occ];
      const opened = manifest(thread, occurrence.id, { type: 'family', id: occurrence.familyId });
      expect(opened.trail).toEqual(thread.view);
      const deep = setDeep(opened, true);
      const reloaded = hashToState(stateToHash(deep), resolver).state;
      expect(stateToHash(reloaded)).toBe(stateToHash(deep));
      expect(reloaded.trail).toEqual(thread.view);
      expect(back(back(reloaded))).toEqual(thread);
    });
  }
  it('handles a malformed URL without crashing navigation', () => {
    expect(hashToState('#/f/%E0%A4', resolver).state).toEqual(WORLD);
  });
});
