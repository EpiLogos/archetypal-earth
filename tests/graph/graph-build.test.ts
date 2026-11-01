// N18: the books and the people in the graph. Every count below is made again here from the raw cites and the registries,
// with no help from the code under test; the relations are built ONLY from the data.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, subjectPalette } from '../../src/data/model';
import { averagePalettes } from '../../src/data/palette';
import { buildGraph, CITE_OCCURRENCES_IN_GLOBAL, globalSet, neighbourhood, type NodeKind } from '../../src/graph/build';
import { DEFAULT_KINDS, KIND_KEYS, type KindFlags } from '../../src/graph/settings';
import type { Field } from '../../src/types/field';
import type { PeopleData } from '../../src/types/people';
import type { WorksData } from '../../src/types/works';

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
const field = read<Field>('../../public/data/field.json');
const works = read<WorksData>('../../public/data/works.json');
const people = read<PeopleData>('../../public/data/people.json');
const registry = read<{ works: Record<string, { aliases?: string[]; author: string; with?: string; editor?: string }> }>('../../curation/works.json').works;
const model = buildModel(field, undefined, undefined, { works, people });
const g = buildGraph(model);
const bare = buildGraph(buildModel(field));

// the raw reading of the cites, folded through the registry's aliases
const idOf = new Map<string, string>();
for (const [id, w] of Object.entries(registry)) for (const k of [id, ...(w.aliases ?? [])]) idOf.set(k, id);
const archOfFamily = new Map(field.families.map((f) => [f.id, f.archetypes.map((t) => t.id)]));
const theoOfFamily = new Map<string, Set<string>>(field.families.map((f) => [f.id, new Set()]));
for (const t of field.theoretics) {
  for (const x of t.families) theoOfFamily.get(x.id)?.add(t.id);
  for (const x of t.archetypes) for (const fid of field.archetypes.find((a) => a.id === x.id)?.familyIds ?? []) theoOfFamily.get(fid)?.add(t.id);
}
const aggregated = new Map<string, number>(); // `${work}|${key}` -> cites
const perOcc = new Map<string, number>(); // `${work}|${occ}` -> cites
let totalCites = 0;
for (const o of field.occurrences) {
  for (const c of o.jung) {
    const w = idOf.get(c.work)!;
    totalCites++;
    perOcc.set(`${w}|${o.id}`, (perOcc.get(`${w}|${o.id}`) ?? 0) + 1);
    const keys = [`f:${o.familyId}`, ...(archOfFamily.get(o.familyId) ?? []).map((a) => `a:${a}`), ...[...(theoOfFamily.get(o.familyId) ?? [])].map((t) => `t:${t}`)];
    for (const k of keys) aggregated.set(`${w}|${k}`, (aggregated.get(`${w}|${k}`) ?? 0) + 1);
  }
}

const key = (i: number) => g.nodes[i].key;
const edgesOf = (kind: string) => g.edges.filter((e) => e.kind === kind);

describe('the Works and the People are nodes', () => {
  it('there is one node per registry record, and the field\'s own nodes keep their ids', () => {
    expect(g.workIds.length).toBe(works.works.length);
    expect(g.personIds.length).toBe(people.people.length);
    expect(g.workIds.length).toBe(43);
    expect(g.personIds.length).toBe(13);
    expect(g.nodes.length).toBe(bare.nodes.length + 43 + 13);
    expect(g.byKey.size).toBe(g.nodes.length);
    for (let i = 0; i < bare.nodes.length; i++) expect(g.nodes[i].key).toBe(bare.nodes[i].key);
    expect(g.workIds.map(key).sort()).toEqual(works.works.map((w) => `w:${w.id}`).sort());
    expect(g.personIds.map(key).sort()).toEqual(people.people.map((p) => `p:${p.id}`).sort());
  });

  it('without the Works and the People the graph is exactly as it was', () => {
    expect(bare.workIds).toEqual([]);
    expect(bare.personIds).toEqual([]);
    expect(bare.nodes.some((n) => n.kind === 'work' || n.kind === 'person' || n.kind === 'you')).toBe(false);
    expect(bare.edges.some((e) => e.kind === 'cite' || e.kind === 'wrote' || e.kind === 'you')).toBe(false);
    // and the edges it had are the first ones of the larger graph, untouched
    for (let k = 0; k < bare.edges.length; k++) expect([g.nodes[g.edges[k].s].key, g.nodes[g.edges[k].t].key, g.edges[k].kind]).toEqual([bare.nodes[bare.edges[k].s].key, bare.nodes[bare.edges[k].t].key, bare.edges[k].kind]);
  });
});

describe('cite ties, from the cites and nothing else', () => {
  it('one weighted tie per work and archetype / theoretic / family, as many as the raw cites make', () => {
    const agg = edgesOf('cite').filter((e) => g.nodes[e.t].kind !== 'occurrence');
    expect(agg.length).toBe(aggregated.size);
    const got = new Map(agg.map((e) => [`${g.nodes[e.s].ref}|${key(e.t)}`, e.weight]));
    expect(got.size).toBe(agg.length); // one per pair
    for (const [k, w] of aggregated) expect(got.get(k), k).toBe(w);
    // every cite stands on exactly one family
    expect(agg.filter((e) => g.nodes[e.t].kind === 'family').reduce((n, e) => n + (e.weight ?? 0), 0)).toBe(totalCites);
    expect(totalCites).toBe(3227);
  });

  it('one tie per work and occurrence that cites it, weighted by the cites on that occurrence', () => {
    const occ = edgesOf('cite').filter((e) => g.nodes[e.t].kind === 'occurrence');
    expect(occ.length).toBe(perOcc.size);
    for (const e of occ) expect(e.weight, `${key(e.s)}|${key(e.t)}`).toBe(perOcc.get(`${g.nodes[e.s].ref}|${g.nodes[e.t].ref}`));
    expect(occ.reduce((n, e) => n + (e.weight ?? 0), 0)).toBe(totalCites);
    // the cite edges always run from the work
    expect(edgesOf('cite').every((e) => g.nodes[e.s].kind === 'work')).toBe(true);
  });

  it('authorship: a person to each work the registry names him for, and Jung to his own 82 occurrences', () => {
    const peopleIds = new Set(people.people.map((p) => p.id));
    const want = new Set<string>();
    for (const [wid, w] of Object.entries(registry)) for (const s of [w.author, w.with, w.editor]) if (s && peopleIds.has(s)) want.add(`p:${s}|w:${wid}`);
    const wrote = edgesOf('wrote');
    const toWorks = wrote.filter((e) => g.nodes[e.t].kind === 'work');
    expect(new Set(toWorks.map((e) => `${key(e.s)}|${key(e.t)}`))).toEqual(want);
    expect(toWorks.length).toBe(want.size);
    const own = wrote.filter((e) => g.nodes[e.t].kind === 'occurrence');
    const jung = field.occurrences.filter((o) => o.subject === 'jung').map((o) => `p:jung|o:${o.id}`);
    expect(jung.length).toBe(82);
    expect(new Set(own.map((e) => `${key(e.s)}|${key(e.t)}`))).toEqual(new Set(jung));
    expect(own.length).toBe(82);
  });

  it('no relation is made up: the edge kinds of the new nodes are cite and wrote only', () => {
    for (const e of g.edges) {
      const a = g.nodes[e.s].kind, b = g.nodes[e.t].kind;
      if (a === 'work' || b === 'work') expect(['cite', 'wrote']).toContain(e.kind);
      if (a === 'person' || b === 'person') expect(e.kind).toBe('wrote');
    }
  });
});

describe('colour: no new hue', () => {
  it('a work takes the cite-weighted mean of the colours of what it touches', () => {
    const w = g.nodes[g.byKey.get('w:cw12')!];
    const items: { p: ReturnType<typeof model.famPalette.get>; w: number }[] = [];
    for (const o of field.occurrences) for (const c of o.jung) if (idOf.get(c.work) === 'cw12') items.push({ p: model.famPalette.get(o.familyId), w: 1 });
    const want = averagePalettes(items.map((x) => ({ p: x.p!, w: x.w })))!;
    for (let c = 0; c < 3; c++) {
      expect(w.colour[c]).toBeCloseTo(want.core[c], 9);
      expect(w.glow[c]).toBeCloseTo(want.glow[c], 9);
    }
    const lo = [0, 1, 2].map((c) => Math.min(...items.map((x) => x.p!.core[c])));
    const hi = [0, 1, 2].map((c) => Math.max(...items.map((x) => x.p!.core[c])));
    for (let c = 0; c < 3; c++) { expect(w.colour[c]).toBeGreaterThanOrEqual(lo[c] - 1e-9); expect(w.colour[c]).toBeLessThanOrEqual(hi[c] + 1e-9); }
  });

  it('a person takes that of his works (the same rule the Subject uses)', () => {
    const j = g.nodes[g.byKey.get('p:jung')!];
    const want = subjectPalette(model, { type: 'person', id: 'jung' }, averagePalettes)!;
    for (let c = 0; c < 3; c++) expect(j.colour[c]).toBeCloseTo(want.core[c], 9);
    // a person with no work and no material falls back to the graph's own default, not a hue of his own
    const k = g.nodes[g.byKey.get('p:khunrath')!];
    expect(k.colour).toEqual([0.76, 0.82, 0.95]);
  });
});

describe('turning a kind off leaves no stranded tie', () => {
  const subsets: KindFlags[] = [];
  for (let mask = 0; mask < 1 << KIND_KEYS.length; mask++) {
    const f = { ...DEFAULT_KINDS };
    KIND_KEYS.forEach((k, i) => { f[k] = !!(mask & (1 << i)); });
    subsets.push(f);
  }
  const setOf = (f: KindFlags, dust: boolean): ReadonlySet<NodeKind> => {
    const s = new Set<NodeKind>(KIND_KEYS.filter((k) => f[k]));
    if (dust) s.add('occurrence');
    return s;
  };

  it('every combination of the six tiers, with and without occurrences, in the whole field', () => {
    for (const f of subsets) for (const dust of [true, false]) {
      const nb = globalSet(g, dust, undefined, setOf(f, dust));
      for (const [id] of nb.dist) {
        const kd = g.nodes[id].kind;
        if (kd !== 'body') expect(kd === 'occurrence' ? dust : f[kd as keyof KindFlags], `${kd} off`).toBe(true);
      }
      for (const k of nb.edges) {
        expect(nb.dist.has(g.edges[k].s) && nb.dist.has(g.edges[k].t), `edge ${g.edges[k].kind} stranded`).toBe(true);
      }
    }
  });

  it('every combination, in the local graph of a text, a person, a form and an archetype', () => {
    for (const seed of ['w:cw12', 'p:jung', 'f:serpent', 'a:self']) {
      for (const f of subsets) for (const dust of [true, false]) {
        const nb = neighbourhood(g, [g.byKey.get(seed)!], { depth: 2, occurrences: dust, kinds: setOf(f, dust) });
        for (const k of nb.edges) expect(nb.dist.has(g.edges[k].s) && nb.dist.has(g.edges[k].t)).toBe(true);
        for (const [id] of nb.dist) {
          if (id === g.byKey.get(seed)) continue;
          const kd = g.nodes[id].kind;
          if (kd !== 'body') expect(kd === 'occurrence' ? dust : f[kd as keyof KindFlags]).toBe(true);
        }
      }
    }
  });

  it('Texts off takes every cite and every authorship tie to a text; People off takes every wrote tie', () => {
    const noTexts = globalSet(g, true, undefined, setOf({ ...DEFAULT_KINDS, work: false }, true));
    expect(noTexts.edges.some((k) => g.edges[k].kind === 'cite')).toBe(false);
    expect(noTexts.edges.some((k) => g.edges[k].kind === 'wrote' && g.nodes[g.edges[k].t].kind === 'work')).toBe(false);
    const noPeople = globalSet(g, true, undefined, setOf({ ...DEFAULT_KINDS, person: false }, true));
    expect(noPeople.edges.some((k) => g.edges[k].kind === 'wrote')).toBe(false);
    expect(noPeople.edges.some((k) => g.edges[k].kind === 'cite')).toBe(true);
    // and the field itself is untouched by either
    const both = globalSet(g, true, undefined, setOf({ ...DEFAULT_KINDS, work: false, person: false }, true));
    const plain = globalSet(bare, true);
    expect(both.dist.size).toBe(plain.dist.size);
    expect(both.edges.length).toBe(plain.edges.length);
  });
});

describe('density: what the whole field and a local graph draw', () => {
  it('the aggregated work ties are always in the whole field; the occurrence-level ones only when occurrences are shown', () => {
    expect(CITE_OCCURRENCES_IN_GLOBAL).toBe(true);
    const withDust = globalSet(g, true);
    const noDust = globalSet(g, false);
    const level = (nb: { edges: number[] }, occ: boolean) => nb.edges.filter((k) => g.edges[k].kind === 'cite' && (g.nodes[g.edges[k].t].kind === 'occurrence') === occ).length;
    expect(level(noDust, false)).toBe(aggregated.size);
    expect(level(noDust, true)).toBe(0);
    expect(level(withDust, false)).toBe(aggregated.size);
    expect(level(withDust, true)).toBe(perOcc.size);
  });

  it('Jung\'s own occurrences are tied to him only when occurrences are shown', () => {
    const n = (nb: { edges: number[] }) => nb.edges.filter((k) => g.edges[k].kind === 'wrote' && g.nodes[g.edges[k].t].kind === 'occurrence').length;
    expect(n(globalSet(g, true))).toBe(82);
    expect(n(globalSet(g, false))).toBe(0);
  });

  it('a local graph of a text follows its occurrences only when occurrences are on', () => {
    const seed = g.byKey.get('w:cw12')!;
    const off = neighbourhood(g, [seed], { depth: 1, occurrences: false });
    const on = neighbourhood(g, [seed], { depth: 1, occurrences: true, cap: 1000 });
    expect([...off.dist.keys()].some((i) => g.nodes[i].kind === 'occurrence')).toBe(false);
    expect([...on.dist.keys()].some((i) => g.nodes[i].kind === 'occurrence')).toBe(true);
    // the cap holds
    expect(neighbourhood(g, [seed], { depth: 3, occurrences: true }).dist.size).toBeLessThanOrEqual(520);
  });

  it('the tie bases (Jung\'s word, inferred, read here) filter the family ties, not the cites', () => {
    const none = globalSet(g, false, []);
    expect(none.edges.filter((k) => g.edges[k].kind === 'cite').length).toBe(aggregated.size);
    expect(none.edges.some((k) => g.edges[k].kind === 'tie')).toBe(false);
  });
});
