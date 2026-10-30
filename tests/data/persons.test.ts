// N17b: the Person as a Subject. A Person is a curated record (curation/people.json) whose works are the registry's, whose
// occurrences are the field's, and whose natal placements are the same natalChart the astrology lens runs. Every count below
// is made again here from the raw files, with no help from the code under test.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildModel, subjectExists, subjectLine, subjectMembers, subjectName, subjectOccurrences, subjectPalette } from '../../src/data/model';
import { averagePalettes } from '../../src/data/palette';
import { meanTimeOffset, natalChart } from '../../src/astro/natal';
import type { Field } from '../../src/types/field';
import type { PeopleData } from '../../src/types/people';
import type { WorksData } from '../../src/types/works';
// @ts-expect-error plain ESM generator
import { buildPeople, load } from '../../scripts/people-publish.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const field = json('public/data/field.json') as Field;
const works = json('public/data/works.json') as WorksData;
const published = json('public/data/people.json') as PeopleData;
const curated = json('curation/people.json').people as Record<string, { name: string; role: string | null; subjectKey?: string; birth?: Record<string, unknown> }>;
const registry = json('curation/works.json').works as Record<string, { author: string; with?: string; editor?: string; aliases?: string[] }>;
const m = buildModel(field, undefined, undefined, { works, people: published });

const idOfKey = new Map<string, string>();
for (const [id, w] of Object.entries(registry)) for (const k of [id, ...(w.aliases ?? [])]) idOfKey.set(k, id);
// a Work's author slug names a person by the person's id or by its last hyphen segment (ronnberg -> ami-ronnberg)
const personOf = (slug: string) => Object.keys(curated).filter((id) => id === slug || id.split('-').pop() === slug);
const authoredBy = (pid: string) => Object.entries(registry).filter(([, w]) => [w.author, w.with, w.editor].some((s) => s && personOf(s).includes(pid))).map(([id]) => id);

describe('a Person is a Subject', () => {
  it('publishes every curated person, and the file equals what the generator builds', () => {
    expect(published.people.map((p) => p.id).sort()).toEqual(Object.keys(curated).sort());
    expect(JSON.parse(JSON.stringify(buildPeople(load())))).toEqual(published);
  });

  it('a Work author slug names exactly one person, or none', () => {
    for (const w of Object.values(registry)) for (const s of [w.author, w.with, w.editor]) if (s) expect(personOf(s).length, s).toBeLessThanOrEqual(1);
  });

  it('lists the Works a person wrote, with, or edited, read from the registry', () => {
    for (const pid of Object.keys(curated)) {
      expect(published.people.find((p) => p.id === pid)!.works, pid).toEqual(authoredBy(pid).sort());
    }
    expect(published.people.find((p) => p.id === 'pauli')!.works).toContain('letters-pauli');
    expect(published.people.find((p) => p.id === 'ami-ronnberg')!.works).toContain('book-of-symbols');
    expect(published.people.find((p) => p.id === 'kathleen-martin')!.works).toContain('book-of-symbols');
    for (const p of published.people) for (const w of p.works) expect(works.works.some((x) => x.id === w), `${p.id} -> ${w}`).toBe(true);
  });

  it('Jung: the 82 occurrences that carry his subject are his members, in year order', () => {
    const own = field.occurrences.filter((o) => o.subject === 'jung');
    expect(own.length).toBe(82);
    const members = subjectMembers(m, { type: 'person', id: 'jung' });
    expect(new Set(members.map((i) => m.occ[i].id))).toEqual(new Set(own.map((o) => o.id)));
    for (let i = 1; i < members.length; i++) expect(m.occ[members[i]].year).toBeGreaterThanOrEqual(m.occ[members[i - 1]].year);
    expect(subjectOccurrences(m, { type: 'person', id: 'jung' }).length).toBe(own.filter((o) => o.geoPrecision !== 'none' && Number.isFinite(o.lat)).length);
  });

  it('a person with no subject of his own holds the occurrences that cite the Works he wrote', () => {
    const mine = new Set(authoredBy('von-franz'));
    expect(mine.size).toBeGreaterThan(0);
    const cited = field.occurrences.filter((o) => o.jung.some((c) => mine.has(idOfKey.get(c.work)!)));
    expect(cited.length).toBeGreaterThan(0);
    expect(subjectMembers(m, { type: 'person', id: 'von-franz' }).length).toBe(cited.length);
    // a person who wrote nothing the field cites and has no subject holds nothing
    expect(subjectMembers(m, { type: 'person', id: 'khunrath' }).length).toBe(0);
  });

  it('names, lines, existence', () => {
    const s = { type: 'person' as const, id: 'jung' };
    expect(subjectExists(m, s)).toBe(true);
    expect(subjectExists(m, { type: 'person', id: 'nobody' })).toBe(false);
    expect(subjectName(m, s)).toBe('C. G. Jung');
    expect(subjectLine(m, s)).toBe(curated.jung.role);
    expect(subjectName(m, { type: 'person', id: 'nobody' })).toBe('nobody');
  });

  it('palette: no new hue, the cite-weighted mean of the families the Works he wrote touch', () => {
    const w = new Map<string, number>();
    for (const wid of authoredBy('jung')) for (const t of works.works.find((x) => x.id === wid)!.ties.families) w.set(t.id, (w.get(t.id) ?? 0) + t.weight);
    const want = averagePalettes([...w].map(([id, weight]) => ({ p: m.famPalette.get(id)!, w: weight })))!;
    const got = subjectPalette(m, { type: 'person', id: 'jung' }, averagePalettes)!;
    expect(got).not.toBeNull();
    for (const k of ['core', 'glow', 'fog', 'deep'] as const) for (let i = 0; i < 3; i++) expect(got[k][i]).toBeCloseTo(want[k][i], 9);
  });

  it('no person id is a place id (a person and a place share the #/p/ door)', () => {
    for (const p of published.people) expect(m.places.has(p.id), p.id).toBe(false);
  });
});

describe('Jung: the birth moved to the people file, and his natal placements are baked', () => {
  const jung = published.people.find((p) => p.id === 'jung')!;

  it('the birth lives in curation/people.json and no longer in curation/astrology.json', () => {
    expect(curated.jung.birth).toBeTruthy();
    expect(json('curation/astrology.json').people[0].birth).toBeUndefined();
    expect(json('curation/astrology.json').people[0].portrait).toBeUndefined();
  });

  it('public/data/astrology.json keeps the shape the astrology lens reads: birth with its portrait beside it', () => {
    const a = json('public/data/astrology.json').people[0];
    expect(Object.keys(a)).toEqual(['id', 'label', 'birth', 'line', 'quote', 'portrait']);
    expect(a.birth).toEqual({ ...curated.jung.birth });
    expect(a.birth.portrait).toBeUndefined();
    expect(a.portrait.src).toBe('/img/jung-portrait.jpg');
    expect(jung.portrait).toEqual(a.portrait);
  });

  it('natal is the same natalChart the lens runs on the same birth', () => {
    const b = curated.jung.birth as { date: string; time: string; lat: number; lon: number; place: string; offset: string };
    const offsetMinutes = b.offset === 'mean-time' ? meanTimeOffset(b.lon) : (b.offset as unknown as number);
    const want = JSON.parse(JSON.stringify(natalChart({ date: b.date, time: b.time, offsetMinutes, lat: b.lat, lon: b.lon, place: b.place })));
    expect(jung.natal).toEqual(want);
  });

  it('the Sun stood in Leo (26 July is three days past the solstice sign change), with a time cast', () => {
    const sun = jung.natal!.bodies.sun!;
    expect(sun.sign).toBe('Leo');
    expect(sun.lon).toBeGreaterThan(120);
    expect(sun.lon).toBeLessThan(126);
    expect(jung.natal!.timeKnown).toBe(true);
  });

  it('only a person with a birth carries natal placements', () => {
    for (const p of published.people) expect(!!p.natal, p.id).toBe(!!curated[p.id].birth);
  });
});
