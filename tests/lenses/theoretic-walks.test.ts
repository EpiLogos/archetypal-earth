// Each of the fourteen theoretics is a real walk: the quotations of its own theory page (public/data/theory-pages.json), one stop each,
// in the page's own section order, every stop on a corpus page, played by the one Walk runner. These tests make the claim again
// from the raw data files, with no help from the code under test. WALKS_FILE points the data tests at another build of the walk
// file (a failing run on an older build is how they were shown to fail first).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Plain ESM shared with the generators.
import { loadSources, pdfPage, verifyWalks } from '../../scripts/verify-walks.mjs';
import { createTimeScale } from '../../src/data/time';
import { theoryContentsGroups, walkSections } from '../../src/lenses/theory-contents';
import { WalkRunner } from '../../src/walk/runner';
import type { Field } from '../../src/types/field';
import type { DynamicsRoute } from '../../src/types/dynamics';
import type { Walk, WalksData } from '../../src/types/walks';

const ROOT = path.resolve(__dirname, '..', '..');
const json = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8')) as T;
const field = json<Field>('field.json');
const route = json<DynamicsRoute>('dynamics-route.json');
const walks = JSON.parse(fs.readFileSync(process.env.WALKS_FILE ?? path.join(ROOT, 'public/data/walks.json'), 'utf8')) as WalksData;
type Page = { concept: string; line: string; sections: { id: string; title: string; line: string; quotes: { text: string; voice?: string; caption?: true; cite: { work: string; locator: string } }[] }[] };
const pages = json<{ pages: Record<string, Page> }>('theory-pages.json').pages;
const corpus = json<{ works: { work: string; file: string }[] }>('corpus/index.json');
const pagesOf = new Map<string, Set<number>>();
const corpusPages = (work: string) => {
  if (!pagesOf.has(work)) {
    const entry = corpus.works.find((w) => w.work === work);
    pagesOf.set(work, new Set(entry ? json<{ pages: { p: number }[] }>(`corpus/${entry.file}`).pages.map((p) => p.p) : []));
  }
  return pagesOf.get(work)!;
};
const theoreticWalks = walks.walks.filter((w) => w.kind === 'theoretic');
const SNAP = { u: 0, focus: null, reading: null, centre: null, walk: null };

describe('each theoretic is a walk of its own page', () => {
  it('there is one walk for each of the fourteen theoretics, curated in the page\'s own order', () => {
    expect(theoreticWalks.map((w) => w.id)).toEqual(field.theoretics.map((t) => `theoretic/${t.id}`));
    expect(theoreticWalks).toHaveLength(14);
    for (const w of theoreticWalks) expect(w.ordered, w.id).toBe('curated');
  });

  it('a walk\'s stops are its page\'s quotations, one each, in the page\'s section order, with Jung\'s words and cite as the page holds them', () => {
    for (const t of field.theoretics) {
      const w = theoreticWalks.find((x) => x.id === `theoretic/${t.id}`)!;
      const want = pages[t.id].sections.flatMap((sec) => sec.quotes.map((q) => ({ sec, q })));
      expect(w.stops, t.id).toHaveLength(want.length);
      w.stops.forEach((s, i) => {
        const { sec, q } = want[i];
        expect(s.subject, `${t.id} ${i}`).toEqual({ type: 'theoretic', id: t.id });
        expect(s.text, `${t.id} ${i}`).toBe(q.text);
        expect(s.cite, `${t.id} ${i}`).toEqual({ work: q.cite.work, locator: q.cite.locator });
        expect(s.section, `${t.id} ${i}`).toEqual({ id: sec.id, title: sec.title, line: sec.line });
        expect(s.voice, `${t.id} ${i}`).toBe(q.voice);
        expect(s.place, `${t.id} ${i}: the page names no place for a passage`).toBeUndefined();
      });
    }
  });

  it('every stop opens a real page of the corpus: the pdf page its cite names, in the volume of its work', () => {
    for (const w of theoreticWalks) {
      for (const [i, s] of w.stops.entries()) {
        expect(s.page, `${w.id} ${i}`).toBeTruthy();
        expect(s.page!.work, `${w.id} ${i}`).toBe(s.cite!.work);
        expect(s.page!.page, `${w.id} ${i}`).toBe(pdfPage(s.cite!.locator));
        expect(corpusPages(s.page!.work).has(s.page!.page), `${w.id} ${i}: ${s.cite!.work} pdf p${s.page!.page}`).toBe(true);
      }
    }
  });

  it('the psychoid begins at Jung\'s naming of it, not at an occurrence of the field', () => {
    const w = theoreticWalks.find((x) => x.id === 'theoretic/psychoid')!;
    expect(w.stops[0].section?.title).toBe('The naming');
    expect(w.stops[0].cite).toEqual({ work: 'cw08', locator: '¶840 (pdf p448)' });
    expect(w.stops[0].year).toBe(1952);
    for (const t of theoreticWalks) for (const s of t.stops) expect(s.subject!.type).toBe('theoretic');
    expect(JSON.stringify(theoreticWalks)).not.toContain('palaeolithic');
  });

  it('a stop stands on a year only where the field or the registry attests it, and most do', () => {
    const dated = theoreticWalks.flatMap((w) => w.stops).filter((s) => s.year !== undefined);
    const all = theoreticWalks.flatMap((w) => w.stops);
    expect(all.length).toBeGreaterThan(150);
    expect(dated.length / all.length).toBeGreaterThan(0.75);
    // the oracle used by the build reads the same sources, independently of the generator
    const { errors } = verifyWalks(walks.walks, loadSources());
    expect(errors).toEqual([]);
  }, 120_000);
});

describe('the runner plays a theoretic\'s walk', () => {
  const scale = createTimeScale(-10000, 2025);

  it('each step opens its passage\'s page and puts the clock on its year; an undated passage leaves the clock', () => {
    for (const w of theoreticWalks) {
      const run = new WalkRunner({ scale, wrap: true });
      w.stops.forEach((s, i) => {
        const step = i === 0 ? run.start(w, SNAP)! : run.next()!;
        expect(step.i).toBe(i);
        expect(step.effects.openPage).toEqual(s.page);
        expect(step.effects.flyTo).toBeNull();
        if (s.year === undefined) expect(step.effects.setClock).toBeNull();
        else expect(step.effects.setClock).toBeCloseTo(scale.toU(s.year), 10);
      });
    }
  });

  it('past the last stop comes the first, and back from the first comes the last (the walk, not the next theoretic)', () => {
    const w = theoreticWalks[0];
    const run = new WalkRunner({ scale, wrap: true });
    run.start(w, SNAP, w.stops.length - 1);
    expect(run.next()!.i).toBe(0);
    expect(run.prev()!.i).toBe(w.stops.length - 1);
  });
});

describe('the walk\'s sections and the Contents', () => {
  const psychoid = theoreticWalks.find((w) => w.id === 'theoretic/psychoid') as Walk;

  it('the sections a walk passes through are those of its page, each at its first stop and with the stops it holds', () => {
    const secs = walkSections(psychoid);
    expect(secs.map((s) => s.id)).toEqual(pages.psychoid.sections.map((s) => s.id));
    expect(secs.map((s) => s.count)).toEqual(pages.psychoid.sections.map((s) => s.quotes.length));
    expect(secs[0].first).toBe(0);
    secs.forEach((s, k) => { if (k > 0) expect(s.first).toBe(secs[k - 1].first + secs[k - 1].count); });
    expect(secs.reduce((n, s) => n + s.count, 0)).toBe(psychoid.stops.length);
  });

  it('the Contents of a playing theoretic lead with its sections, the one the walk stands in marked; elsewhere there is no such group', () => {
    const picked: number[] = [];
    const secs = walkSections(psychoid);
    const input = {
      model: { field }, theoryTitle: 'The theory', sections: [], route, stopName: (s: { id: string }) => s.id,
      at: { kind: 'theoretic' as const, id: 'psychoid' },
      go: { section: () => {}, theoretic: () => {}, overview: () => {}, stop: () => {} },
      walk: { title: 'The Psychoid', sections: secs.map((s, k) => ({ title: s.title, current: k === 1, onPick: () => picked.push(s.first) })) },
    };
    const groups = theoryContentsGroups(input);
    expect(groups[0].title).toBe('The Psychoid');
    expect(groups[0].items.map((i) => i.label)).toEqual(secs.map((s) => s.title));
    expect(groups[0].items.filter((i) => i.current).map((i) => i.label)).toEqual([secs[1].title]);
    groups[0].items[2].onPick!();
    expect(picked).toEqual([secs[2].first]);
    expect(theoryContentsGroups({ ...input, walk: undefined })[0].title).toBe('The theory');
  });
});
