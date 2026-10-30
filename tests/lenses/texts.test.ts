// N12: the Texts lens. A text is a lens whose subject is a Work; everything it shows is read from the registry and the Work's
// page walk (src/data/texts.ts), and the walk is stepped by the one runner (src/walk/runner.ts). These tests make the lens's
// claims again from the raw data files, with no help from the code under test.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { workLens, worksByVoice } from '../../src/data/texts';
import { chapterOfStop } from '../../src/lenses/texts';
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

  it('its title is the work, its scope the work\'s members, its contents the chapters', () => {
    const lens = workLens(m, 'cw12')!;
    expect(lens.title).toBe(m.workById.get('cw12')!.title);
    expect([...lens.scope].sort((a, b) => a - b)).toEqual([...(m.workMem.get('cw12') ?? [])].sort((a, b) => a - b));
    const c = textsContract(m, 'cw12')!;
    expect(c.set).toHaveLength(lens.scope.size);
    expect(c.stops).toHaveLength(204);
    expect(c.groups[0].items).toHaveLength(m.workById.get('cw12')!.chapters.length);
  });

  it('a chapter holds the stops from its page to the next chapter of its rank; chapterOfStop finds the narrowest', () => {
    const lens = workLens(m, 'cw12')!;
    const stops = lens.walk!.stops;
    for (const [i, s] of stops.entries()) {
      const ch = chapterOfStop(lens.contents, i);
      if (!ch) continue;
      expect(ch.from).toBeLessThanOrEqual(i);
      expect(i).toBeLessThan(ch.to);
      expect(s.page!.page).toBeGreaterThanOrEqual(ch.page);
    }
    // at least one stop sits in a chapter at all
    expect(stops.some((_, i) => chapterOfStop(lens.contents, i))).toBe(true);
  });

  it('the picker lists every Work exactly once, grouped by voice and kind', () => {
    const listed = worksByVoice(m).flatMap((g) => g.kinds.flatMap((k) => k.works.map((w) => w.id)));
    expect(listed.sort()).toEqual(works.works.map((w) => w.id).sort());
    expect(new Set(listed).size).toBe(listed.length);
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
