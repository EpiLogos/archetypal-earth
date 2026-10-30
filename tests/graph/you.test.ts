// N19b: the visitor is a node, and it grows from use. withYou is pure: the practice store's record goes in as data, counts on
// edges come out, and nothing of the record reaches the graph. No data, no node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { buildGraph, withSkyAnchors, withYou, YOU_KEY, type PersonalData, type SkyAnchorSource, type YouContext } from '../../src/graph/build';
import { matchImages, vocabulary } from '../../src/practice/amplify';
import type { Field } from '../../src/types/field';
import type { PeopleData } from '../../src/types/people';
import type { BodyKey } from '../../src/types/sky';
import type { WorksData } from '../../src/types/works';

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
const field = read<Field>('../../public/data/field.json');
const model = buildModel(field, undefined, undefined, { works: read<WorksData>('../../public/data/works.json'), people: read<PeopleData>('../../public/data/people.json') });
const base = buildGraph(model);
const ctx: YouContext = { vocab: vocabulary(model) };
const tieOf = (g: ReturnType<typeof buildGraph>, to: string) => g.edges.find((e) => e.kind === 'you' && g.nodes[e.t].key === to);
const youEdges = (g: ReturnType<typeof buildGraph>) => g.edges.filter((e) => e.kind === 'you');

describe('no data, no node', () => {
  it('returns the graph itself for an empty record, in every shape the store can give', () => {
    for (const p of [{}, { dreams: [], coincidences: [], charts: [], engagements: [] }, { dreams: [{ text: '' }] }, { dreams: [{ text: 'Nothing here names an image at all, only qqzzx.' }] }]) {
      const g = withYou(base, p, ctx);
      expect(g).toBe(base);
      expect(g.youIds).toEqual([]);
      expect(g.byKey.has(YOU_KEY)).toBe(false);
      expect(g.nodes.some((n) => n.kind === 'you')).toBe(false);
    }
  });

  it('an engagement whose subject is not in the graph, or is the record\'s own, adds nothing', () => {
    const p: PersonalData = { engagements: [
      { kind: 'dream', subject: { type: 'dream', id: 'd1' } }, { kind: 'chart', subject: { type: 'chart', id: 'you' } },
      { kind: 'open', subject: { type: 'culture', id: 'norse' } }, { kind: 'open', subject: { type: 'family', id: 'no-such-family' } },
    ] };
    expect(withYou(base, p, ctx)).toBe(base);
  });
});

describe('a dream names images', () => {
  const dream = { text: 'A serpent lay coiled under the tree. Later a second serpent rose out of the water.' };

  it('adds a tie to the serpent family, weighted by how many times it is named', () => {
    const named = matchImages(ctx.vocab, dream.text).filter((h) => h.target.type === 'family' && h.target.id === 'serpent').length;
    expect(named).toBe(2);
    const g = withYou(base, { dreams: [dream] }, ctx);
    expect(g.youIds.length).toBe(1);
    expect(g.nodes[g.youIds[0]]).toMatchObject({ kind: 'you', key: 'you', ref: 'you', label: 'You' });
    expect(tieOf(g, 'f:serpent')!.weight).toBe(2);
    expect(tieOf(g, 'f:tree')!.weight).toBe(1);
    // every tie is to a family or an archetype the vocabulary names in that text
    const names = new Set(matchImages(ctx.vocab, dream.text).map((h) => `${h.target.type === 'family' ? 'f' : 'a'}:${h.target.id}`));
    expect(new Set(youEdges(g).map((e) => g.nodes[e.t].key))).toEqual(names);
  });

  it('counts across dreams', () => {
    const g = withYou(base, { dreams: [dream, { text: 'I met a snake.' }] }, ctx);
    expect(tieOf(g, 'f:serpent')!.weight).toBe(3);
  });

  it('wiping (an empty record) removes the node and its ties', () => {
    const g = withYou(base, { dreams: [dream] }, ctx);
    expect(g.byKey.has('you')).toBe(true);
    const wiped = withYou(base, { dreams: [], coincidences: [], charts: [], engagements: [] }, ctx);
    expect(wiped.byKey.has('you')).toBe(false);
    expect(wiped.edges.length).toBe(base.edges.length);
    expect(wiped.nodes.length).toBe(base.nodes.length);
  });
});

describe('what the visitor opens, looks up, walks and logs', () => {
  it('an engagement adds its tie: a work or an occurrence read, a symbol looked up, an archetype opened', () => {
    const occ = field.occurrences[10].id;
    const g = withYou(base, { engagements: [
      { kind: 'open', subject: { type: 'work', id: 'cw12' } }, { kind: 'open', subject: { type: 'work', id: 'cw12' } },
      { kind: 'open', subject: { type: 'occurrence', id: occ } },
      { kind: 'symbol', subject: { type: 'family', id: 'serpent' } }, { kind: 'open', subject: { type: 'archetype', id: 'self' } },
      { kind: 'open', subject: { type: 'person', id: 'jung' } }, { kind: 'open', subject: { type: 'theoretic', id: field.theoretics[0].id } },
    ] }, ctx);
    expect(tieOf(g, 'w:cw12')!.weight).toBe(2);
    expect(tieOf(g, `o:${occ}`)!.weight).toBe(1);
    expect(tieOf(g, 'f:serpent')!.weight).toBe(1);
    expect(tieOf(g, 'a:self')!.weight).toBe(1);
    expect(tieOf(g, 'p:jung')!.weight).toBe(1);
    expect(tieOf(g, `t:${field.theoretics[0].id}`)!.weight).toBe(1);
    expect(youEdges(g).length).toBe(6);
  });

  it('a finished walk is tied to where it went, when the walks are given', () => {
    const occs = [field.occurrences[3].id, field.occurrences[4].id];
    const walks = new Map([['theoretic/psychoid', [{ type: 'occurrence', id: occs[0] }, { type: 'occurrence', id: occs[1] }, { type: 'concept', id: 'x' }]]]);
    const e = [{ kind: 'walk', subject: { type: 'walk', id: 'theoretic/psychoid' } }];
    const g = withYou(base, { engagements: e }, { ...ctx, walks });
    expect(youEdges(g).map((x) => g.nodes[x.t].key).sort()).toEqual(occs.map((o) => `o:${o}`).sort());
    expect(withYou(base, { engagements: e }, ctx)).toBe(base);
  });

  it('a coincidence is tied to the family it was tied to, else to the images its symbol names', () => {
    const g = withYou(base, { coincidences: [{ familyId: 'serpent', symbol: 'tree' }, { familyId: null, symbol: 'a tree' }] }, ctx);
    expect(tieOf(g, 'f:serpent')!.weight).toBe(1);
    expect(tieOf(g, 'f:tree')!.weight).toBe(1);
  });
});

describe('the chart, through the sky', () => {
  const bodies = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as BodyKey[];
  const src: SkyAnchorSource = {
    bodies: bodies.map((key, order) => ({ key, name: key, order, palette: { core: '#cccccc', glow: '#888888' }, spectrum: 0.5 })),
    ties: [{ body: 'sun', type: 'family', id: 'serpent', basis: 'jung' }],
    lon: Object.fromEntries(bodies.map((k, i) => [k, i * 30])) as SkyAnchorSource['lon'],
  };
  const withSky = withSkyAnchors(base, src);

  it('with the sky off a chart alone makes no node; with Sky anchors on, the visitor is tied to each of its bodies', () => {
    expect(withYou(base, { charts: [{ any: 'chart' }] }, ctx)).toBe(base);
    const g = withYou(withSky, { charts: [{ any: 'chart' }] }, ctx);
    expect(youEdges(g).map((e) => g.nodes[e.t].ref).sort()).toEqual([...bodies].sort());
    expect(youEdges(g).every((e) => g.nodes[e.t].kind === 'body')).toBe(true);
    // the bodies keep their own ties to the field: that is how the chart reaches it
    expect(g.edges.filter((e) => e.kind === 'sky').length).toBe(withSky.edges.filter((e) => e.kind === 'sky').length);
  });
});

describe('purity, ids and colour', () => {
  const p: PersonalData = { dreams: [{ text: 'A serpent under a tree.' }], engagements: [{ kind: 'open', subject: { type: 'work', id: 'cw12' } }] };

  it('does not touch the graph it extends, and every existing node and edge keeps its place', () => {
    const before = JSON.stringify([base.nodes.length, base.edges.length, base.adj.map((a) => a.length), base.byKey.size]);
    const g = withYou(base, p, ctx);
    expect(JSON.stringify([base.nodes.length, base.edges.length, base.adj.map((a) => a.length), base.byKey.size])).toBe(before);
    for (let i = 0; i < base.nodes.length; i++) expect(g.nodes[i]).toBe(base.nodes[i]);
    for (let i = 0; i < base.edges.length; i++) expect(g.edges[i]).toBe(base.edges[i]);
    expect(g.nodes.length).toBe(base.nodes.length + 1);
    expect(g.workIds).toBe(base.workIds);
    expect(g.adj[g.youIds[0]].length).toBe(youEdges(g).length);
    // and the sky can come and go under it: the visitor goes on the sky's graph the same way
    expect(() => withYou(g, p, ctx)).toThrow();
  });

  it('takes the weighted mean of the colours of what it names: no hue of its own', () => {
    const g = withYou(base, p, ctx);
    const you = g.nodes[g.youIds[0]];
    let total = 0;
    const want = [0, 0, 0];
    for (const e of youEdges(g)) { total += e.weight!; for (let c = 0; c < 3; c++) want[c] += g.nodes[e.t].colour[c] * e.weight!; }
    for (let c = 0; c < 3; c++) expect(you.colour[c]).toBeCloseTo(want[c] / total, 9);
  });

  it('nothing of the record appears in anything the graph exposes beyond the fixed id "you"', () => {
    const secret = 'zqxv-private-dream-words';
    const personal: PersonalData = {
      dreams: [{ text: `${secret} a serpent under a tree` }],
      coincidences: [{ familyId: null, symbol: `${secret} snake` }],
      charts: [{ label: secret, birth: { place: secret } }],
      engagements: [{ kind: 'open', subject: { type: 'work', id: 'cw12' } }],
    };
    const g = withYou(base, personal, ctx);
    expect(g.youIds.length).toBe(1);
    // the whole graph, serialised, holds none of it
    const text = JSON.stringify({ nodes: g.nodes, edges: g.edges, byKey: [...g.byKey] });
    expect(text.includes(secret)).toBe(false);
    // and the strings a view reads for the URL, the label and the layout key are the fixed id and the registries' own
    const you = g.nodes[g.youIds[0]];
    expect([you.key, you.ref, you.label, you.yearDisplay]).toEqual(['you', 'you', 'You', '']);
    expect(you.members).toEqual([]);
    for (const e of youEdges(g)) expect(Object.keys(e).sort()).toEqual(['kind', 's', 't', 'weight']);
    for (const n of g.nodes.slice(base.nodes.length)) expect(n.kind).toBe('you');
    // every key in the graph is one of the registries' (or the fixed "you")
    const known = new Set(base.nodes.map((n) => n.key));
    for (const n of g.nodes) expect(n.key === 'you' || known.has(n.key)).toBe(true);
  });
});
