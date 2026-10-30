// N7: the Work as a Subject. A Work is a record (curation/works.json) whose relations are read off the field's cites, never
// typed in. Every count below is made again here from the raw cites, with no help from the code under test.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildModel, subjectExists, subjectLine, subjectMembers, subjectName, subjectOccurrences, subjectPalette } from '../../src/data/model';
import { averagePalettes } from '../../src/data/palette';
import type { Field } from '../../src/types/field';
import type { WorksData } from '../../src/types/works';
// @ts-expect-error plain ESM generator
import { buildWorks, load } from '../../scripts/works-publish.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const field = json('public/data/field.json') as Field;
const published = json('public/data/works.json') as WorksData;
const registry = json('curation/works.json').works as Record<string, { aliases?: string[]; title: string; author: string; voice?: string }>;
const m = buildModel(field, undefined, undefined, { works: published });

// the independent reading of the cites: every key folded through the registry's aliases
const idOfKey = new Map<string, string>();
for (const [id, w] of Object.entries(registry)) for (const k of [id, ...(w.aliases ?? [])]) idOfKey.set(k, id);
const familyArchetypes = new Map(field.families.map((f) => [f.id, f.archetypes.map((t) => t.id)]));
const familyTheoretics = new Map<string, Set<string>>(field.families.map((f) => [f.id, new Set()]));
for (const t of field.theoretics ?? []) {
  for (const x of t.families) familyTheoretics.get(x.id)?.add(t.id);
  for (const x of t.archetypes) for (const fid of field.archetypes.find((a) => a.id === x.id)?.familyIds ?? []) familyTheoretics.get(fid)?.add(t.id);
}

describe('a Work is a Subject', () => {
  it('has a record for every key the field cites, aliases folded (a cite keeps its key)', () => {
    const keys = new Set(field.occurrences.flatMap((o) => o.jung.map((c) => c.work)));
    expect(keys.size).toBeGreaterThan(40);
    for (const k of keys) expect(idOfKey.has(k), `cite key ${k}`).toBe(true);
    expect(m.workKey.get('redbook')).toBe('liber-novus');
    expect(m.workKey.get('memories')).toBe('mdr');
    expect(m.workKey.get('cw12')).toBe('cw12');
    // no cite is rewritten: the field still names its text by its own key
    expect(field.occurrences.some((o) => o.jung.some((c) => c.work === 'redbook'))).toBe(true);
  });

  it('subjectMembers({work, cw12}) is the 204 occurrences that cite it, 197 of them placed', () => {
    const cited = new Set(field.occurrences.filter((o) => o.jung.some((c) => idOfKey.get(c.work) === 'cw12')).map((o) => o.id));
    expect(cited.size).toBe(204);
    const members = subjectMembers(m, { type: 'work', id: 'cw12' });
    expect(members.length).toBe(204);
    expect(new Set(members.map((i) => m.occ[i].id))).toEqual(cited);
    const placed = [...cited].filter((id) => { const o = field.occurrences.find((x) => x.id === id)!; return o.geoPrecision !== 'none' && Number.isFinite(o.lat); });
    expect(placed.length).toBe(197);
    expect(subjectOccurrences(m, { type: 'work', id: 'cw12' }).length).toBe(197);
    // year ascending, like every other membership list
    for (let i = 1; i < members.length; i++) expect(m.occ[members[i]].year).toBeGreaterThanOrEqual(m.occ[members[i - 1]].year);
  });

  it('folds the aliases when it counts: Liber Novus holds the occurrences that cite it as "redbook"', () => {
    const cited = field.occurrences.filter((o) => o.jung.some((c) => idOfKey.get(c.work) === 'liber-novus'));
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.some((o) => o.jung.some((c) => c.work === 'redbook'))).toBe(true);
    expect(subjectMembers(m, { type: 'work', id: 'liber-novus' }).length).toBe(cited.length);
  });

  it('every occurrence appears under each Work it cites, once', () => {
    let total = 0;
    for (const w of published.works) {
      const mem = m.workMem.get(w.id) ?? [];
      expect(new Set(mem).size).toBe(mem.length);
      total += mem.length;
    }
    const pairs = new Set<string>();
    for (const o of field.occurrences) for (const c of o.jung) pairs.add(`${o.id}|${idOfKey.get(c.work)}`);
    expect(total).toBe(pairs.size);
  });

  it('names, lines, existence and palette: no new hue, the cite-weighted mean of the families it touches', () => {
    const s = { type: 'work', id: 'cw12' } as const;
    expect(subjectExists(m, s)).toBe(true);
    expect(subjectExists(m, { type: 'work', id: 'no-such-work' })).toBe(false);
    expect(subjectName(m, s)).toBe('Psychology and Alchemy (CW12)');
    expect(subjectName(m, { type: 'work', id: 'no-such-work' })).toBe('no-such-work');
    expect(subjectLine(m, s)).toContain('Jung');
    const pal = subjectPalette(m, s, averagePalettes)!;
    const items = field.occurrences.flatMap((o) => o.jung.filter((c) => idOfKey.get(c.work) === 'cw12').map(() => ({ p: m.famPalette.get(o.familyId)!, w: 1 })));
    const want = averagePalettes(items)!;
    for (const k of ['core', 'glow', 'fog', 'deep'] as const) for (let c = 0; c < 3; c++) expect(pal[k][c]).toBeCloseTo(want[k][c], 6);
  });
});

describe('the relations a Work gets from its cites', () => {
  it('weigh work↔archetype, work↔theoretic and work↔family by cite count, equal to an independent count', () => {
    const want = new Map<string, { arch: Map<string, number>; theo: Map<string, number>; fam: Map<string, number>; cites: number }>();
    for (const o of field.occurrences) {
      for (const c of o.jung) {
        const id = idOfKey.get(c.work)!;
        let w = want.get(id);
        if (!w) want.set(id, (w = { arch: new Map(), theo: new Map(), fam: new Map(), cites: 0 }));
        w.cites++;
        w.fam.set(o.familyId, (w.fam.get(o.familyId) ?? 0) + 1);
        for (const a of familyArchetypes.get(o.familyId) ?? []) w.arch.set(a, (w.arch.get(a) ?? 0) + 1);
        for (const t of familyTheoretics.get(o.familyId) ?? []) w.theo.set(t, (w.theo.get(t) ?? 0) + 1);
      }
    }
    for (const w of published.works) {
      const x = want.get(w.id) ?? { arch: new Map(), theo: new Map(), fam: new Map(), cites: 0 };
      expect(w.cites, `${w.id} cites`).toBe(x.cites);
      const read = (l: { id: string; weight: number }[]) => new Map(l.map((t) => [t.id, t.weight]));
      expect(read(w.ties.archetypes), `${w.id} archetypes`).toEqual(x.arch);
      expect(read(w.ties.theoretics), `${w.id} theoretics`).toEqual(x.theo);
      expect(read(w.ties.families), `${w.id} families`).toEqual(x.fam);
      const heaviest = w.ties.families.map((t) => t.weight);
      expect(heaviest).toEqual([...heaviest].sort((a, b) => b - a));
    }
    // the pairs the scout counted by key (477 archetype, 1,519 family) fall once the aliases fold
    const pairs = (pick: (v: { arch: Map<string, number>; fam: Map<string, number> }) => number) => [...want.values()].reduce((n, v) => n + pick(v), 0);
    expect(pairs((v) => v.fam.size)).toBeLessThanOrEqual(1519);
    expect(pairs((v) => v.arch.size)).toBeLessThanOrEqual(477);
  });

  it('are what the app reads: every tie names a node the field holds', () => {
    for (const w of published.works) {
      for (const t of w.ties.archetypes) expect(m.archById.has(t.id), `${w.id} → archetype ${t.id}`).toBe(true);
      for (const t of w.ties.theoretics) expect(m.theoById.has(t.id), `${w.id} → theoretic ${t.id}`).toBe(true);
      for (const t of w.ties.families) expect(m.famById.has(t.id), `${w.id} → family ${t.id}`).toBe(true);
    }
  });
});

describe('the published file', () => {
  it('is what the generator makes from the registry, the chapters and the field now', () => {
    const built = buildWorks(load());
    expect(JSON.parse(JSON.stringify(built))).toEqual(published);
  });
  it('carries every Work of the registry, with its voice, aliases, corpus and lens', () => {
    expect(published.works.map((w) => w.id).sort()).toEqual(Object.keys(registry).sort());
    const aion = published.works.find((w) => w.id === 'cw09ii')!;
    expect(aion.lens).toBe('aion');
    expect(published.works.find((w) => w.id === 'liber-novus')).toMatchObject({ lens: 'redbook', aliases: ['redbook'], voice: 'Jung' });
    expect(published.works.find((w) => w.id === 'book-of-thoth')).toMatchObject({ voice: 'Crowley', year: 1944 });
    expect(published.works.find((w) => w.id === 'cw12')).toMatchObject({ corpus: 'cw12', cites: 218, occurrences: 204 });
    expect(published.works.find((w) => w.id === 'mdr')!.corpus).toBeUndefined();
    for (const w of published.works) if (w.corpus) expect(fs.existsSync(path.join(ROOT, 'public/data/corpus', `${w.corpus}.json`))).toBe(true);
  });
});
