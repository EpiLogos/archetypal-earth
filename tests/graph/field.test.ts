import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { buildGraph, globalSet, neighbourhood, nodeLiveness } from '../../src/graph/build';
import type { Field } from '../../src/types/field';
import { DEFAULT_RAMP, DEFAULT_TRAIL } from '../../src/data/time';

// This is the served field, including its real ties, co-manifestations and parallels.
const field = JSON.parse(readFileSync(new URL('../../public/data/field.json', import.meta.url), 'utf8')) as Field;
const model = buildModel(field);
const graph = buildGraph(model);
const edges = new Set(graph.edges.filter((e) => e.kind !== 'parallel').map((e) => [graph.nodes[e.s].key, graph.nodes[e.t].key, e.kind, e.basis ?? ''].join('|')));

describe('graph of the real field', () => {
  it('keeps every real entity and occurrence', () => {
    expect(graph.nodes.length).toBe(field.archetypes.length + field.families.length + field.occurrences.length);
    expect(graph.byKey.size).toBe(graph.nodes.length);
    expect(graph.nodes[graph.byKey.get('a:self')!].prime).toBe(true);
    expect(field.occurrences.every((o) => graph.byKey.has(`o:${o.id}`))).toBe(true);
  });

  it('carries the source family, co-family and authored tie relations without losing their basis', () => {
    const expected = new Set<string>();
    for (const f of field.families) {
      for (const t of f.archetypes) expected.add(`f:${f.id}|a:${t.id}|tie|${t.basis}`);
    }
    for (const o of field.occurrences) {
      expected.add(`o:${o.id}|f:${o.familyId}|instance|`);
      for (const c of new Set(o.coFamilyIds)) {
        if (c !== o.familyId && model.famById.has(c)) expected.add(`o:${o.id}|f:${c}|co|`);
      }
    }
    expect(edges).toEqual(expected);
  });

  it('represents each real parallel once, regardless of which occurrence records it', () => {
    const source = new Set<string>();
    for (const o of field.occurrences) for (const p of o.parallelIds) {
      if (p !== o.id && model.occIndex.has(p)) source.add([o.id, p].sort().join('|'));
    }
    const drawn = graph.edges.filter((e) => e.kind === 'parallel').map((e) => [graph.nodes[e.s].ref, graph.nodes[e.t].ref].sort().join('|'));
    expect(new Set(drawn)).toEqual(source);
    expect(drawn.length).toBe(source.size);
  });

  it('shows Self’s directly tied forms at one step and their real manifestations at two', () => {
    const self = graph.byKey.get('a:self')!;
    const directFamilies = field.families.filter((f) => f.archetypes.some((t) => t.id === 'self'));
    const one = neighbourhood(graph, [self], { depth: 1, cap: graph.nodes.length });
    expect(new Set([...one.dist.keys()].map((id) => graph.nodes[id].key))).toEqual(new Set(['a:self', ...directFamilies.map((f) => `f:${f.id}`)]));
    const two = neighbourhood(graph, [self], { depth: 2, cap: graph.nodes.length });
    const formIds = new Set(directFamilies.map((f) => f.id));
    const occurrences = field.occurrences.filter((o) => formIds.has(o.familyId) || o.coFamilyIds.some((f) => formIds.has(f)));
    expect(occurrences.length).toBeGreaterThan(0);
    expect(occurrences.every((o) => two.dist.get(graph.byKey.get(`o:${o.id}`)!) === 2)).toBe(true);
    expect(two.edges.every((k) => two.dist.has(graph.edges[k].s) && two.dist.has(graph.edges[k].t))).toBe(true);
  });

  it('applies relation filters to the traversal as well as to the drawn links', () => {
    const self = graph.byKey.get('a:self')!;
    const filtered = neighbourhood(graph, [self], { depth: 1, tieBases: ['jung'], cap: graph.nodes.length });
    const authored = field.families.filter((f) => f.archetypes.some((t) => t.id === 'self' && t.basis === 'jung'));
    expect(new Set([...filtered.dist.keys()].map((id) => graph.nodes[id].key))).toEqual(new Set(['a:self', ...authored.map((f) => `f:${f.id}`)]));
    expect(globalSet(graph, true, []).edges.every((k) => graph.edges[k].kind !== 'tie')).toBe(true);
    expect(globalSet(graph, true, []).edges.some((k) => graph.edges[k].kind === 'instance')).toBe(true);
  });

  it('can hide occurrence dust while retaining a selected occurrence as a local seed', () => {
    const global = globalSet(graph, false);
    expect(global.dist.size).toBe(field.archetypes.length + field.families.length);
    const seed = graph.occurrenceIds[0];
    const local = neighbourhood(graph, [seed], { depth: 2, occurrences: false });
    expect(local.dist.get(seed)).toBe(0);
    expect([...local.dist.keys()].filter((id) => graph.nodes[id].kind === 'occurrence')).toEqual([seed]);
  });

  it('follows actual historical dates: future and expired occurrences fade, current ones remain live', () => {
    const all = nodeLiveness(graph, model, { on: 0, cursorU: 0.55, trail: DEFAULT_TRAIL, ramp: DEFAULT_RAMP });
    expect([...all].every((v) => v === 1)).toBe(true);
    const cursor = 0.6;
    const live = nodeLiveness(graph, model, { on: 1, cursorU: cursor, trail: DEFAULT_TRAIL, ramp: DEFAULT_RAMP });
    const future = graph.occurrenceIds.filter((id) => graph.nodes[id].u > cursor);
    const expired = graph.occurrenceIds.filter((id) => graph.nodes[id].u < cursor - DEFAULT_TRAIL);
    const present = graph.occurrenceIds.filter((id) => graph.nodes[id].u < cursor - DEFAULT_RAMP && graph.nodes[id].u > cursor - DEFAULT_TRAIL * 0.55);
    expect(future.length).toBeGreaterThan(0); expect(expired.length).toBeGreaterThan(0); expect(present.length).toBeGreaterThan(0);
    expect([...future, ...expired].every((id) => Math.abs(live[id] - 0.05) < 1e-6)).toBe(true);
    expect(present.every((id) => live[id] === 1)).toBe(true);
    expect(graph.familyIds.some((id) => live[id] < 0.9)).toBe(true);
    expect(nodeLiveness(graph, model, { on: 0, cursorU: cursor, trail: DEFAULT_TRAIL, ramp: DEFAULT_RAMP }, live)).toBe(live);
    expect([...live].every((v) => v === 1)).toBe(true);
  });
});
