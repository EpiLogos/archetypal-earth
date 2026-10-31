// H5 + S9, Alchemy: the opus's four stages are the `alchemy-stages` walk of public/data/walks.json stepped by the Walk runner, and the
// lens's Contents list the opus, the operations, the matter and the elements. The old walk was `stages[(i + delta + n) % n]` over
// alchemy.json; it goes only because the runner walks the same stops in the same order and wraps as the rail always did.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { alchemyContentsGroups, stagesWalk } from '../../src/lenses/alchemy-contents';
import { WalkRunner } from '../../src/walk/runner';
import { createTimeScale } from '../../src/data/time';
import type { Walk, WalksData } from '../../src/types/walks';

const ROOT = path.resolve(__dirname, '..', '..');
const json = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8')) as T;
interface Named { id: string; name: string }
const alchemy = json<{ opus: { stages: Named[] }; operations: Named[]; matter: Named[] }>('alchemy.json');
const walks = new Map(json<WalksData>('walks.json').walks.map((w) => [w.id, w] as [string, Walk]));
const stages = alchemy.opus.stages;
const ids = stages.map((s) => s.id);
const SNAP = { u: 0, focus: null, reading: null, centre: null, walk: null };
const scale = createTimeScale(1900, 2030);

describe('the opus is the curated walk, on the runner', () => {
  it('walks.json holds the same stages in the same order as the opus (nigredo first), and the lens reads the shipped walk', () => {
    const raw = walks.get('alchemy-stages')!;
    expect(raw.stops.map((s) => s.subject!.id)).toEqual(ids);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe('nigredo');
    expect(raw.ordered).toBe('curated');
    expect(stagesWalk(walks, stages)).toBe(raw);
  });

  it('the runner steps as the old rail did: forward and back from every stage, wrapping past either end', () => {
    const w = stagesWalk(walks, stages);
    const n = ids.length;
    for (let at = 0; at < n; at++) {
      for (const delta of [1, -1]) {
        const run = new WalkRunner({ scale, wrap: true });
        run.start(w, SNAP, at);
        const step = delta > 0 ? run.next() : run.prev();
        // the rule the lens used before the runner: stages[(i + delta + n) % n]
        expect(step!.stop.subject!.id).toBe(ids[(at + delta + n) % n]);
      }
    }
  });

  it('a walk file that has drifted from the opus is not trusted: the walk is drawn from the opus itself', () => {
    const raw = walks.get('alchemy-stages')!;
    const drifted = new Map(walks);
    drifted.set('alchemy-stages', { ...raw, stops: [...raw.stops].reverse() });
    expect(stagesWalk(drifted, stages)).not.toBe(raw);
    expect(stagesWalk(drifted, stages).stops.map((s) => s.subject!.id)).toEqual(ids);
    expect(stagesWalk(new Map(), stages).stops.map((s) => s.subject!.id)).toEqual(ids);
  });
});

describe('the Alchemy Contents', () => {
  const names = { stages, operations: alchemy.operations, matter: alchemy.matter };

  it('lists the opus whole and its four stages, the operations, the matter and the elements', () => {
    const groups = alchemyContentsGroups(names, null, () => {});
    expect(groups.map((g) => g.title)).toEqual(['The opus', 'Operations', 'Matter', 'Elements']);
    expect(groups[0].items.map((i) => i.label)).toEqual(['The whole opus', ...stages.map((s) => s.name)]);
    expect(groups[1].items.map((i) => i.label)).toEqual(['All operations', ...alchemy.operations.map((o) => o.name)]);
    expect(groups[2].items.map((i) => i.label)).toEqual(['All matter', ...alchemy.matter.map((m) => m.name)]);
  });

  it('marks the one the lens stands on, and an entry goes to the route it names', () => {
    const marked = (at: Parameters<typeof alchemyContentsGroups>[1]) => alchemyContentsGroups(names, at, () => {}).flatMap((g) => g.items).filter((i) => i.current).map((i) => i.label);
    expect(marked({ section: 'opus' })).toEqual(['The whole opus']);
    expect(marked({ section: 'opus', stage: 'albedo' })).toEqual([stages[1].name]);
    expect(marked({ section: 'operations' })).toEqual(['All operations']);
    expect(marked({ section: 'matter' })).toEqual(['All matter']);
    expect(marked({ section: 'operations', id: alchemy.operations[0].id })).toEqual([alchemy.operations[0].name]);
    expect(marked({ section: 'elements' })).toEqual(['The elements']);
    const go = vi.fn();
    const groups = alchemyContentsGroups(names, null, go);
    groups[0].items[0].onPick(); expect(go).toHaveBeenLastCalledWith([]);
    groups[0].items[2].onPick(); expect(go).toHaveBeenLastCalledWith(['opus', stages[1].id]);
    groups[1].items[0].onPick(); expect(go).toHaveBeenLastCalledWith(['operations']);
    groups[1].items[1].onPick(); expect(go).toHaveBeenLastCalledWith(['operations', alchemy.operations[0].id]);
    groups[2].items[0].onPick(); expect(go).toHaveBeenLastCalledWith(['matter']);
    groups[2].items[1].onPick(); expect(go).toHaveBeenLastCalledWith(['matter', alchemy.matter[0].id]);
    groups[3].items[0].onPick(); expect(go).toHaveBeenLastCalledWith(['elements']);
  });
});
