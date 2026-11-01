// N12: the Texts lens. A text is a lens whose subject is a Work; everything it shows is read from the registry and the Work's
// page walk (src/data/texts.ts), and the walk is stepped by the one runner (src/walk/runner.ts). These tests make the lens's
// claims again from the raw data files, with no help from the code under test.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { workInstances, workLens, worksByVoice } from '../../src/data/texts';
import { textsContract } from '../../src/lenses/contract';
import { WalkRunner } from '../../src/walk/runner';
import type { Field } from '../../src/types/field';
import type { WalksData } from '../../src/types/walks';
import type { WorksData } from '../../src/types/works';

const ROOT = path.resolve(__dirname, '..', '..');
const json = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8')) as T;
const field = json<Field>('field.json');
const walks = json<WalksData>('walks.json');
const works = json<WorksData>('works.json');
const m = buildModel(field, undefined, undefined, { works, walks });

describe('the Texts lens', () => {
  it('cw12 is read through in 204 steps, in page order', () => {
    const lens = workLens(m, 'cw12')!;
    expect(lens.walk?.stops).toHaveLength(204);
    // the raw file, not the lens: the walk of CW12 has 204 stops and their pages never go back
    const raw = walks.walks.find((w) => w.id === 'text/cw12')!;
    expect(raw.stops).toHaveLength(204);
    const pages = raw.stops.map((s) => s.page!.page);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
    expect(raw.ordered).toBe('page');
    // the runner steps through every one of them, forward, from the first to the last, and then stops
    const run = new WalkRunner({ scale: m.scale });
    const seen: number[] = [];
    for (let s = run.start(raw, { u: 0, focus: null, reading: null, centre: null, walk: null }); s; s = run.next()) seen.push(s.i);
    expect(seen).toEqual([...Array(204).keys()]);
  });

  it('a page walk is ordered by page, not by year, so the lens leaves the clock where the visitor put it', () => {
    const raw = walks.walks.find((w) => w.id === 'text/cw12')!;
    const years = raw.stops.map((s) => s.year).filter((y): y is number => y !== undefined);
    // the years of a page-ordered walk go back on themselves: gliding the clock to each would make it jump about
    expect(years.some((y, i) => i > 0 && y < years[i - 1])).toBe(true);
    // every stop names the page it opens; a cite's own locator is kept where the data has one
    for (const s of raw.stops) { expect(s.page?.work).toBe('cw12'); expect(s.page!.page).toBeGreaterThan(0); }
  });

  it('its title is the work, its scope the work\'s members, its contents its instances', () => {
    const lens = workLens(m, 'cw12')!;
    expect(lens.title).toBe(m.workById.get('cw12')!.title);
    expect([...lens.scope].sort((a, b) => a - b)).toEqual([...(m.workMem.get('cw12') ?? [])].sort((a, b) => a - b));
    const c = textsContract(m, 'cw12')!;
    expect(c.set).toHaveLength(lens.scope.size);
    // read through its instances: no page walk, and no chapter of the pdf in its Contents
    expect(c.stops).toHaveLength(0);
    expect(c.groups[0].items).toHaveLength(lens.scope.size);
  });

  it('the picker lists every Work an instance cites, once each, grouped by voice and kind; a Work with none is not listed', () => {
    const listed = worksByVoice(m).flatMap((g) => g.kinds.flatMap((k) => k.works.map((w) => w.id)));
    // made again from the raw cites: the Works some occurrence names by id or alias
    const key = new Map<string, string>();
    for (const w of works.works) for (const k of [w.id, ...(w.aliases ?? [])]) key.set(k, w.id);
    const cited = new Set(field.occurrences.flatMap((o) => o.jung.map((c) => key.get(c.work)).filter((x): x is string => !!x)));
    expect(listed.sort()).toEqual([...cited].sort());
    expect(new Set(listed).size).toBe(listed.length);
    for (const empty of ['a-blue-fire', 'book-of-symbols', 'van-eenwyk']) expect(listed).not.toContain(empty);
  });

  it('a work is read through its instances, by date, as an archetype is; every one cites the work', () => {
    const idx = workInstances(m, 'cw12');
    expect(idx).toHaveLength(workLens(m, 'cw12')!.scope.size);
    const years = idx.map((i) => m.occ[i].year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    for (const i of idx) expect(m.occ[i].jung.some((c) => m.workKey.get(c.work) === 'cw12')).toBe(true);
    expect(workInstances(m, 'nonesuch')).toEqual([]);
  });

  it('opening CW9ii and Liber Novus names the lens each has of its own, which the controller hands to', () => {
    expect(workLens(m, 'cw09ii')!.lens).toBe('aion');
    expect(workLens(m, 'liber-novus')!.lens).toBe('redbook');
    expect(workLens(m, 'redbook')!.id).toBe('liber-novus');
    expect(workLens(m, 'cw12')!.lens).toBeUndefined();
  });

  it('no key that names no Work opens a lens', () => {
    expect(workLens(m, 'nonesuch')).toBeUndefined();
    expect(textsContract(m, 'nonesuch')).toBeUndefined();
  });
});
