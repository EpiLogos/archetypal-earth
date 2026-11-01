// N12-data / S10b: a text as a lens. workLens() hands the Texts lens one pure object per Work (title, voice, year, contents
// with their stop ranges, scope, page walk, plates). Every figure below is made again here from the raw cites and the corpus
// volumes, with no help from the code under test.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildModel } from '../../src/data/model';
import { workLens, workOfCite, worksByVoice } from '../../src/data/texts';
import type { Field } from '../../src/types/field';
import type { WorksData } from '../../src/types/works';
import type { WalksData } from '../../src/types/walks';

const ROOT = path.resolve(__dirname, '..', '..');
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const field = json('public/data/field.json') as Field;
const works = json('public/data/works.json') as WorksData;
const walks = json('public/data/walks.json') as WalksData;
const registry = json('curation/works.json').works as Record<string, { aliases?: string[]; corpus?: string }>;
const m = buildModel(field, undefined, undefined, { works, walks });

const idOfKey = new Map<string, string>();
for (const [id, w] of Object.entries(registry)) for (const k of [id, ...(w.aliases ?? [])]) idOfKey.set(k, id);
const volumes = new Map<string, { paras: { para: number; p: number }[] }>();
const volume = (id: string) => { if (!volumes.has(id)) volumes.set(id, json(`public/data/corpus/${registry[id].corpus}`)); return volumes.get(id)!; };

/** The page a locator names in a volume, read here independently: a ¶ through the volume's anchors, else `pdf pN`. */
function pageOf(id: string, locator: string): number | null {
  const para = /¶\s*(\d+)/.exec(locator);
  const pdf = /pdf\s*p\.?\s*(\d+)/.exec(locator);
  if (para) {
    let c = volume(id).paras.filter((x) => x.para === Number(para[1]));
    if (pdf) { const on = c.filter((x) => x.p === Number(pdf[1])); if (on.length) c = on; }
    if (c.length) return c[0].p;
  }
  return pdf ? Number(pdf[1]) : null;
}

/** For one Work: every placed cite (occurrence id, page), the occurrence's lowest page being its stop. */
function independent(id: string) {
  const cites: { id: string; page: number }[] = [];
  for (const o of field.occurrences) for (const c of o.jung) if (idOfKey.get(c.work) === id) {
    const p = pageOf(id, c.locator ?? '');
    if (p !== null) cites.push({ id: o.id, page: p });
  }
  const low = new Map<string, number>();
  for (const c of cites) low.set(c.id, Math.min(low.get(c.id) ?? Infinity, c.page));
  return { cites: cites.length, stops: [...low].map(([oid, page]) => ({ id: oid, page })).sort((a, b) => a.page - b.page || (a.id < b.id ? -1 : 1)) };
}

describe('the page walk of a text', () => {
  it('cw12 walks 204 occurrences in page order (218 located cites fold to 204 occurrences)', () => {
    const lens = workLens(m, 'cw12')!;
    expect(lens.walk).toBeDefined();
    const want = independent('cw12');
    expect(want.cites).toBe(218);
    expect(want.stops.length).toBe(204);
    expect(lens.walk!.stops).toHaveLength(204);
    expect(lens.walk!.kind).toBe('text');
    expect(lens.walk!.ordered).toBe('page');
    const pages = lens.walk!.stops.map((s) => s.page!.page);
    for (let i = 1; i < pages.length; i++) expect(pages[i]).toBeGreaterThanOrEqual(pages[i - 1]);
    expect(lens.walk!.stops.map((s) => ({ id: s.subject!.id, page: s.page!.page }))).toEqual(want.stops);
    for (const s of lens.walk!.stops) expect(s.page!.work).toBe('cw12');
  });

  it('every Work with a placed cite has one page walk, with the independent count of its occurrences', () => {
    let withWalk = 0;
    for (const w of works.works) {
      const want = independent(w.id);
      const walk = walks.walks.find((x) => x.id === `text/${w.id}`);
      if (!want.stops.length) { expect(walk, w.id).toBeUndefined(); continue; }
      withWalk++;
      expect(walk, w.id).toBeDefined();
      expect(walk!.stops.length, w.id).toBe(want.stops.length);
    }
    expect(withWalk).toBe(34);
    expect(walks.walks.filter((x) => x.kind === 'text')).toHaveLength(34);
  });

  it('a stop carries the occurrence\'s own year and place, and the cite\'s engagement year where it names one', () => {
    const occ = new Map(field.occurrences.map((o) => [o.id, o]));
    for (const s of workLens(m, 'cw12')!.walk!.stops) {
      const o = occ.get(s.subject!.id)!;
      expect(s.subject!.type).toBe('occurrence');
      expect(s.year).toBe(o.year);
      const placed = o.geoPrecision !== 'none' && Number.isFinite(o.lat) && Number.isFinite(o.lon);
      if (placed) expect(s.place).toEqual({ lat: o.lat, lon: o.lon }); else expect(s.place).toBeUndefined();
    }
    expect(workLens(m, 'cw12')!.walk!.stops.some((s) => typeof s.citeYear === 'number')).toBe(true);
  });
});

describe('the lens of a Work', () => {
  it('names the Work, its voice and its year, and folds the aliases', () => {
    const a = workLens(m, 'cw12')!;
    expect(a.id).toBe('cw12');
    expect(a.title).toBe('Psychology and Alchemy (CW12)');
    expect(a.voice).toBe('Jung');
    expect(workLens(m, 'jung')!.id).toBe('cw11');
    expect(workLens(m, 'no-such-work')).toBeUndefined();
  });

  it('CW9ii hands off to the Aion lens, Liber Novus (and the redbook alias) to the Red Book lens, the rest to none', () => {
    expect(workLens(m, 'cw09ii')!.lens).toBe('aion');
    expect(workLens(m, 'liber-novus')!.lens).toBe('redbook');
    expect(workLens(m, 'redbook')!.lens).toBe('redbook');
    expect(workLens(m, 'redbook')!.id).toBe('liber-novus');
    expect(workLens(m, 'cw12')!.lens).toBeUndefined();
    expect(works.works.filter((w) => workLens(m, w.id)!.lens).map((w) => w.id).sort()).toEqual(['cw09ii', 'liber-novus']);
  });

  it('scope is the Work\'s membership: the occurrences that cite it, aliases folded', () => {
    const lens = workLens(m, 'liber-novus')!;
    const cited = new Set(field.occurrences.map((o, i) => (o.jung.some((c) => idOfKey.get(c.work) === 'liber-novus') ? i : -1)).filter((i) => i >= 0));
    expect(lens.scope).toEqual(cited);
    expect(cited.size).toBeGreaterThan(0);
    expect(workLens(m, 'cw12')!.scope.size).toBe(204);
  });

  it('contents are the Work\'s chapters, each with the range of stops that fall on its pages; a chapter holds its sub-chapters', () => {
    const lens = workLens(m, 'cw12')!;
    expect(lens.contents.length).toBe(works.works.find((w) => w.id === 'cw12')!.chapters.length);
    const stops = lens.walk!.stops;
    const ch = works.works.find((w) => w.id === 'cw12')!.chapters;
    lens.contents.forEach((c, k) => {
      expect(c.title).toBe(ch[k].title);
      expect(c.page).toBe(ch[k].page);
      let end = Infinity;
      for (let j = k + 1; j < ch.length; j++) if (ch[j].level <= ch[k].level) { end = ch[j].page; break; }
      const want = stops.map((s, i) => (s.page!.page >= ch[k].page && s.page!.page < end ? i : -1)).filter((i) => i >= 0);
      expect(c.to - c.from, c.title).toBe(want.length);
      if (want.length) { expect(c.from).toBe(want[0]); expect(c.to).toBe(want[want.length - 1] + 1); }
    });
    // the chapters of level 1 together hold every stop that is not front matter
    const top = lens.contents.filter((c) => c.level === 1);
    expect(top.reduce((n, c) => n + (c.to - c.from), 0)).toBeLessThanOrEqual(stops.length);
    expect(top.reduce((n, c) => n + (c.to - c.from), 0)).toBeGreaterThan(stops.length * 0.9);
  });

  it('plates are the images the stops carry, once each', () => {
    const lens = workLens(m, 'cw12')!;
    const occ = new Map(field.occurrences.map((o) => [o.id, o]));
    const want = [...new Set(lens.walk!.stops.map((s) => occ.get(s.subject!.id)!.image?.src).filter((x): x is string => !!x))];
    expect(want.length).toBeGreaterThan(0);
    expect(lens.plates).toEqual(want);
  });

  it('a Work with no placed cite has a lens and no walk', () => {
    const lens = workLens(m, 'a-blue-fire')!;
    expect(lens.walk).toBeUndefined();
    expect(lens.scope.size).toBe(0);
    expect(lens.plates).toEqual([]);
    expect(lens.contents.every((c) => c.from === c.to)).toBe(true);
  });
});

describe('the picker and the cite door', () => {
  it('groups the 40 Works that attest an instance once, by voice and then kind (the three no instance cites have nothing to show)', () => {
    const groups = worksByVoice(m);
    const ids = groups.flatMap((g) => g.kinds.flatMap((k) => k.works.map((w) => w.id)));
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
    expect(new Set(ids)).toEqual(new Set(works.works.map((w) => w.id).filter((id) => (m.workMem.get(id) ?? []).length)));
    expect(groups.map((g) => g.voice)[0]).toBe('Jung');
    const sizes = groups.map((g) => g.kinds.reduce((n, k) => n + k.works.length, 0));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    for (const g of groups) for (const k of g.kinds) for (const w of k.works) { expect(w.voice).toBe(g.voice); expect(w.kind).toBe(k.kind); }
    expect(new Set(groups.map((g) => g.voice)).size).toBe(groups.length);
  });

  it('workOfCite folds a cite key to its Work, and knows no other', () => {
    expect(workOfCite(m, 'redbook')!.id).toBe('liber-novus');
    expect(workOfCite(m, 'memories')!.id).toBe('mdr');
    expect(workOfCite(m, 'cw12')!.id).toBe('cw12');
    expect(workOfCite(m, 'nothing')).toBeUndefined();
    for (const k of new Set(field.occurrences.flatMap((o) => o.jung.map((c) => c.work)))) expect(workOfCite(m, k), k).toBeDefined();
  });
});
