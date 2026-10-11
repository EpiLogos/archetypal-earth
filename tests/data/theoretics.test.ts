import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ESM script
import { validateField } from '../../scripts/validate.mjs';
import { buildModel, subjectExists, subjectName, subjectOccurrences } from '../../src/data/model';
import { buildGraph } from '../../src/graph/build';
import { buildSearchIndex, search, GROUND_SUB } from '../../src/data/search';
import { hashToState, stateToHash } from '../../src/state/router';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const field: Field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'field.json'), 'utf8'));
const model = buildModel(field);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** The vault's concepts tier, carried into the field. The two keystones are its ground, not two more entries. */
describe('theoretics tier', () => {
  it('is carried in full and the keystones come first', () => {
    expect(field.theoretics.length).toBeGreaterThanOrEqual(14);
    expect(field.meta.counts.theoretics).toBe(field.theoretics.length);
    expect(field.theoretics.filter((t) => t.ground).map((t) => t.id)).toEqual(['psychoid', 'archetype-as-such']);
    // the ground is stated as the ground: the tier's first two entries, ahead of every other node in it
    expect(field.theoretics.slice(0, 2).every((t) => t.ground)).toBe(true);
    expect(field.theoretics[0].ground).toBe('ontological');
    expect(field.theoretics[1].ground).toBe('epistemological');
    expect(validateField(field)).toEqual([]);
  });

  it('names the psychoid as Jung named it: the irrepresentable nature of the archetype as such', () => {
    const psychoid = field.theoretics.find((t) => t.id === 'psychoid')!;
    expect(psychoid.name).toBe('The Psychoid');
    // the definition is Jung's own words, placed from the vault — the naming passage of CW8 ¶840
    expect(psychoid.definition!.text).toContain('"irrepresentable" nature I have called it "psychoid."');
    expect(psychoid.definition!.cite).toContain('840');
    // its ground tie is Jung's own: the archetype as such is a psychoid factor (CW8 ¶417), and the
    // synchronicity monograph names it the same way (CW8 ¶840) — never the site's reading
    expect(psychoid.theoretics.find((t) => t.id === 'archetype-as-such')?.basis).toBe('jung');
    expect(psychoid.theoretics.find((t) => t.id === 'synchronicity')?.basis).toBe('jung');
  });

  it('every tie resolves: no theoretic names a node the field does not have', () => {
    const arch = new Set(field.archetypes.map((a) => a.id));
    const fam = new Set(field.families.map((f) => f.id));
    const theo = new Set(field.theoretics.map((t) => t.id));
    for (const t of field.theoretics) {
      expect(t.archetypes.length + t.families.length + t.theoretics.length, `${t.id} has ties`).toBeGreaterThanOrEqual(1);
      for (const tie of t.archetypes) expect(arch.has(tie.id), `${t.id} -> archetype ${tie.id}`).toBe(true);
      for (const tie of t.families) expect(fam.has(tie.id), `${t.id} -> family ${tie.id}`).toBe(true);
      for (const tie of t.theoretics) {
        expect(theo.has(tie.id), `${t.id} -> theoretic ${tie.id}`).toBe(true);
        expect(tie.id, `${t.id} ties to itself`).not.toBe(t.id);
      }
      for (const tie of [...t.archetypes, ...t.families, ...t.theoretics]) expect(['jung', 'inferred', 'site']).toContain(tie.basis);
    }
  });

  it('keeps the interface contract: line <= 90, valid palette, position in 0..1', () => {
    for (const t of field.theoretics) {
      expect(t.oneLine.length, t.id).toBeGreaterThan(0);
      expect(t.oneLine.length, t.id).toBeLessThanOrEqual(90);
      expect(t.name.length, t.id).toBeGreaterThan(0);
      for (const k of ['core', 'glow', 'fog', 'deep'] as const) expect(t.palette[k], `${t.id}.${k}`).toMatch(HEX);
      expect(t.spectrum.position).toBeGreaterThanOrEqual(0);
      expect(t.spectrum.position).toBeLessThanOrEqual(1);
      for (const p of t.body) expect(p.includes('[['), t.id).toBe(false);
    }
  });

  it('places the two keystones where Jung placed them on the instinct/spirit spectrum', () => {
    // the archetype as such is the pole itself; the psychoid is the "psychic ultra-violet" end (CW8 ¶420)
    const asSuch = field.theoretics.find((t) => t.id === 'archetype-as-such')!;
    const psychoid = field.theoretics.find((t) => t.id === 'psychoid')!;
    expect(asSuch.spectrum.position).toBe(1);
    expect(psychoid.spectrum.position).toBeGreaterThan(0.9);
    expect(psychoid.spectrum.position).toBeLessThan(asSuch.spectrum.position);
  });

  it('definitions, where present, are quoted passages with a locating cite', () => {
    let seen = 0;
    for (const t of field.theoretics) {
      if (!t.definition) continue;
      seen++;
      expect(t.definition.text.length, t.id).toBeGreaterThan(40);
      expect(t.definition.cite, t.id).toMatch(/¶|pdf p/);
    }
    // one omission is honest (aion-time's own citations point at a foreword and a seminar page);
    // everything else carries Jung's words
    expect(seen).toBeGreaterThanOrEqual(field.theoretics.length - 1);
  });

  it('the theory already in the field is linked, not duplicated: a section and its node are two addresses for one thing', () => {
    const theory = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'theory.json'), 'utf8'));
    const ids = new Set(field.theoretics.map((t) => t.id));
    const linked = new Set<string>();
    for (const s of theory.sections) for (const l of s.links ?? []) if (l.type === 'theoretic') { expect(ids.has(l.id), `${s.id} -> ${l.id}`).toBe(true); linked.add(l.id); }
    for (const l of theory.number.psychoid.subjects ?? []) { expect(ids.has(l.id)).toBe(true); linked.add(l.id); }
    // the sections that are concepts address their node; the keystones are reachable from the number walk
    for (const id of ['psychoid', 'archetype-as-such', 'libido', 'compensation', 'aion-time', 'transcendent-function']) expect(linked.has(id), id).toBe(true);
    // and the node names the section back
    expect(field.theoretics.find((t) => t.id === 'compensation')!.section).toBe('compensation');
    expect(field.theoretics.find((t) => t.id === 'libido')!.section).toBe('energy');
    expect(field.theoretics.find((t) => t.id === 'psychoid')!.section).toBe('number');
  });

  it('is a subject on the globe: a theoretic stands for the field its ties carry', () => {
    const psychoid = field.theoretics.find((t) => t.id === 'psychoid')!;
    expect(subjectExists(model, { type: 'theoretic', id: 'psychoid' })).toBe(true);
    expect(subjectName(model, { type: 'theoretic', id: 'psychoid' })).toBe('The Psychoid');
    const occ = subjectOccurrences(model, { type: 'theoretic', id: 'psychoid' });
    expect(occ.length).toBeGreaterThan(500); // via the Self and the mana family
    expect(model.theoOcc.get('psychoid')!.length).toBe(psychoid.occurrenceCount);
    // every occurrence it stands for is located, so the globe can actually tune to it
    expect(occ.every((i) => model.located[i])).toBe(true);
  });

  it('is a node in the graph, with the ground drawn apart from the archetypes', () => {
    const graph = buildGraph(model);
    const psychoid = graph.nodes[graph.byKey.get('t:psychoid')!];
    expect(psychoid.kind).toBe('theoretic');
    expect(psychoid.ground).toBe(true);
    expect(graph.theoreticIds.length).toBe(field.theoretics.length);
    // the field's own ties: the keystone grounds the Self, and reaches the mana family
    const key = (k: string) => graph.byKey.get(k)!;
    const tie = (a: number, b: number) => graph.edges.some((e) => ((e.s === a && e.t === b) || (e.s === b && e.t === a)) && e.kind === 'tie');
    expect(tie(key('t:psychoid'), key('a:self'))).toBe(true);
    expect(tie(key('t:psychoid'), key('f:mana'))).toBe(true);
    expect(tie(key('t:psychoid'), key('t:archetype-as-such'))).toBe(true);
    // no archetype is drawn as the ground
    expect(graph.nodes.filter((n) => n.ground).map((n) => n.ref)).toEqual(['psychoid', 'archetype-as-such']);
  });

  it('is searchable, and the keystones are offered as the field\'s ground', () => {
    const idx = buildSearchIndex(model);
    const hits = search(idx, 'psychoid');
    expect(hits.some((h) => h.kind === 'theoretic' && h.label === 'The Psychoid')).toBe(true);
    const invitation = search(idx, '');
    expect(invitation[0].label).toBe('The Psychoid');
    expect(invitation[0].sub).toBe(GROUND_SUB);
    expect(invitation[1].label).toBe('The Archetype as Such');
  });

  it('is linkable: #/th/psychoid round-trips through the router', () => {
    const r = {
      hasArchetype: (id: string) => model.archById.has(id),
      hasTheoretic: (id: string) => model.theoById.has(id),
      hasFamily: (id: string) => model.famById.has(id),
      hasCulture: (id: string) => model.cultureById.has(id),
      hasPlace: (id: string) => model.places.has(id),
      familyOf: () => undefined,
    };
    const { state } = hashToState('#/th/psychoid', r);
    expect(state.view).toEqual({ kind: 'focus', subject: { type: 'theoretic', id: 'psychoid' } });
    // a theory node is focused onto its page: the reading stands open with the focus, so the hash says so
    expect(state.deep).toBe(true);
    expect(stateToHash(state)).toBe('#/th/psychoid/deep');
    expect(hashToState('#/th/psychoid/deep', r).state).toEqual(state);
    // an unknown theoretic is never a silent world
    expect(hashToState('#/th/not-a-concept', r).state.view.kind).toBe('world');
    // and the dynamical lens can read the theory directly: the energetic view stands on its own node
    expect(hashToState('#/dynamics/th/psychoid', r).state.dynamics?.subject).toEqual({ type: 'theoretic', id: 'psychoid' });
  });
});
