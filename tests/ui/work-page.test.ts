// A Work's page opens with a passage of the text's own introductory matter, drawn by the one Quote component, before the
// instances it attests are listed (a first-time visitor learns what the text is before they meet the entries). A Work with no
// blurb opens as it did. The Work records here are the published ones with a blurb set on, so this holds whatever the curation says.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildModel } from '../../src/data/model';
import { workPage } from '../../src/ui/deep';
import type { Field } from '../../src/types/field';
import type { WalksData } from '../../src/types/walks';
import type { Work, WorksData } from '../../src/types/works';
import type { PassageBridge } from '../../src/ui/passage';
import { FakeEl, installFakeDom } from './fake-dom';

const read = <T>(rel: string) => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf8')) as T;
const field = read<Field>('field.json');
const walks = read<WalksData>('walks.json');
const published = read<WorksData>('works.json');

const TEXT = 'It was, indeed, my endeavours as a medical psychologist to understand the ills of the soul that led me to all my later insights.';
const blurb: NonNullable<Work['blurb']> = { text: TEXT, cite: { work: 'cw16', workTitle: 'The Practice of Psychotherapy', locator: 'pdf p7' } };
const withBlurb = (id: string): WorksData => ({ ...published, works: published.works.map((w) => (w.id === id ? { ...w, blurb } : { ...w, blurb: undefined })) });

let restore: () => void;
beforeAll(() => { restore = installFakeDom(); });
afterAll(() => restore());

const handlers = (opened: [string, string][] = []) => ({
  onSubject() {},
  onOccurrence() {},
  passage: { known: (w: string) => w === 'cw16', open: (w: string, l: string) => { opened.push([w, l]); } } as unknown as PassageBridge,
});
const kids = (nodes: HTMLElement[]) => nodes as unknown as FakeEl[];
const quoteOf = (page: FakeEl[]) => page.findIndex((n) => n.tag === 'blockquote');

describe('a Work page opens with its blurb', () => {
  const m = buildModel(field, undefined, undefined, { works: withBlurb('cw16'), walks });

  it('draws it as a lead quotation, with the Work as its cite, after the byline and before the instances', () => {
    const page = kids(workPage(m, 'cw16', handlers()));
    const q = quoteOf(page);
    expect(q, 'the page has a quotation').toBeGreaterThan(0);
    expect(page[q].hasClass('q-lead')).toBe(true);
    expect(page[q].textContent).toContain(TEXT);
    expect(page[q].textContent).toContain('The Practice of Psychotherapy');
    // the title and the byline come first; the instances come after the words, never before them
    expect(page[0].tag).toBe('h2');
    const instances = page.findIndex((n) => n.tag === 'h3' && n.textContent === 'Its instances');
    expect(instances, 'the page lists its instances').toBeGreaterThan(q);
  });

  it('opens the page the cite names when the visitor asks for it', () => {
    const opened: [string, string][] = [];
    const page = kids(workPage(m, 'cw16', handlers(opened)));
    const open = page[quoteOf(page)].first('button.q-open');
    expect(open, 'the quotation offers its page').toBeDefined();
    open!.click();
    expect(opened).toEqual([['cw16', 'pdf p7']]);
  });

  it('steps down from the lead size when the passage is long, so it does not fill the first screen', () => {
    const long = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ');
    const longM = buildModel(field, undefined, undefined, { works: { ...published, works: published.works.map((w) => (w.id === 'cw16' ? { ...w, blurb: { ...blurb, text: long } } : { ...w, blurb: undefined })) }, walks });
    const page = kids(workPage(longM, 'cw16', handlers()));
    expect(page[quoteOf(page)].hasClass('q-lead')).toBe(false);
  });

  it('names whose words they are when they are not the author\'s (an editors\' note), and only then', () => {
    const edited = buildModel(field, undefined, undefined, { works: { ...published, works: published.works.map((w) => (w.id === 'cw16' ? { ...w, blurb: { ...blurb, voice: 'The editors' } } : { ...w, blurb: undefined })) }, walks });
    const chip = (mm: typeof m) => { const page = kids(workPage(mm, 'cw16', handlers())); return page[quoteOf(page)].first('span.q-voice')?.textContent; };
    expect(chip(edited)).toBe('The editors');
    expect(chip(m), 'Jung\'s own words wear no chip').toBeUndefined();
  });

  it('a Work with no blurb draws no quotation at all', () => {
    const none = buildModel(field, undefined, undefined, { works: withBlurb('cw12'), walks });
    const page = kids(workPage(none, 'cw16', handlers()));
    expect(quoteOf(page)).toBe(-1);
  });
});
