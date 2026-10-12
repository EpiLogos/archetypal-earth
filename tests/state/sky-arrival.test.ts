import { describe, expect, it } from 'vitest';
import { astrologyLive, back, focusOn, inLens, openedFrom, skyArrival, stateEq, WORLD, type AppState } from '../../src/state/store';

const sky = (body?: 'mars'): AppState => astrologyLive(body ? { body } : {});
const fam = (id: string) => ({ type: 'family' as const, id });

describe('a descent from the sky carries its reading', () => {
  it('opens the reading on a focus the sky stays behind', () => {
    const from = sky('mars');
    const next = skyArrival(from, openedFrom(from, focusOn(WORLD, fam('aries'))));
    expect(next.deep).toBe(true);
    expect(next.arrived).toBe(true);
    expect(next.view).toEqual({ kind: 'focus', subject: fam('aries'), crumbs: undefined });
    expect(next.from?.sky?.body).toBe('mars');
  });

  it('does so for a node with no located place the same as for one with (the state does not look at places)', () => {
    const from = sky();
    for (const id of ['aries', 'thoth-five-of-wands', 'binah', 'earth-element']) {
      expect(skyArrival(from, openedFrom(from, focusOn(WORLD, fam(id)))).deep).toBe(true);
    }
  });

  it('opens a manifestation reached from the sky the same way', () => {
    const from = sky('mars');
    const manifest: AppState = { view: { kind: 'manifest', occId: 'occ-1', context: fam('mars') }, deep: false };
    expect(skyArrival(from, openedFrom(from, manifest)).deep).toBe(true);
  });

  it('leaves everything else as it was', () => {
    const from = sky('mars');
    const arrival = openedFrom(from, focusOn(WORLD, fam('aries')));
    // not from the sky
    expect(skyArrival(WORLD, arrival)).toBe(arrival);
    // the sky is not left
    const still = { ...arrival, sky: { body: 'mars' as const } };
    expect(skyArrival(from, still)).toBe(still);
    // no `from`: a hash or a Back arrival is not an act of reading
    const typed = focusOn(WORLD, fam('aries'));
    expect(skyArrival(from, typed)).toBe(typed);
    // a world view, a thread, a lens, the graph
    const world = openedFrom(from, WORLD);
    expect(skyArrival(from, world)).toBe(world);
    const lens = openedFrom(from, inLens('theory'));
    expect(skyArrival(from, lens)).toBe(lens);
    // a reading already asked for is not marked as arrived
    const asked: AppState = openedFrom(from, { view: { kind: 'focus', subject: fam('aries') }, deep: true });
    expect(skyArrival(from, asked)).toBe(asked);
  });

  it('is idempotent', () => {
    const from = sky('mars');
    const once = skyArrival(from, openedFrom(from, focusOn(WORLD, fam('aries'))));
    expect(skyArrival(from, once)).toBe(once);
  });
});

describe('closing the reading a descent opened', () => {
  const from = sky('mars');
  const landed = skyArrival(from, openedFrom(from, focusOn(WORLD, fam('aries'))));

  it('closes onto the node: the reading goes, the sky is still behind', () => {
    const closed = back(landed);
    expect(closed.deep).toBe(false);
    expect(closed.view.kind).toBe('focus');
    expect(closed.arrived).toBeUndefined();
    expect(closed.from?.sky?.body).toBe('mars');
    expect(stateEq(closed, landed)).toBe(false);
  });

  it('then Escape returns to the sky it came from', () => {
    const sky2 = back(back(landed));
    expect(stateEq(sky2, from)).toBe(true);
  });

  it('a reading asked for from the sky still returns to the sky at once', () => {
    const asked: AppState = openedFrom(from, { view: { kind: 'focus', subject: fam('aries') }, deep: true });
    expect(stateEq(back(asked), from)).toBe(true);
  });
});
