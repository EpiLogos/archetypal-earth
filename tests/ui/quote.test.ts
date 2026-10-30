import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { citeParts, entered, qlSource, quote, quoteList, voiceOf, type ListedQuote, type QuoteCite, type QuoteSpec } from '../../src/ui/quote';
import type { PassageBridge } from '../../src/ui/passage';
import { FakeEl, installFakeDom } from './fake-dom';

// Q8b: the one Quote component (src/ui/quote.ts), one case per variant, the cite on every quotation, and the list form.
// The shape is the accepted mock, ProjectCentral/docs/QUOTE-MOCK.html, without the variants the owner struck (30 Oct): no
// label, no verdict, no notice. Prose that is not a quotation is not drawn here.

const read = (rel: string) => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf8'));

let restore: () => void;
beforeAll(() => { restore = installFakeDom(); });
afterAll(() => restore());

const asEl = (x: HTMLElement) => x as unknown as FakeEl;
const bridge = (known: string[]): PassageBridge & { opened: [string, string][] } => {
  const opened: [string, string][] = [];
  return { known: (w: string) => known.includes(w), open: (w: string, loc: string) => { opened.push([w, loc]); }, opened } as unknown as PassageBridge & { opened: [string, string][] };
};
const fire = (e: FakeEl, type: string) => { for (const fn of e.listeners.get(type) ?? []) fn({}); };

const JUNG_CITE: QuoteCite = { work: 'cw09i', workTitle: 'The Archetypes and the Collective Unconscious', locator: '¶6 (pdf p20)', print: '5' };
const JUNG: QuoteSpec = { text: 'The archetype is essentially an unconscious content that is altered by becoming conscious and by being perceived.', cite: JUNG_CITE };

describe('quotation', () => {
  it('is a blockquote.q with the words as given and a foot: work · locator · printed page', () => {
    const b = asEl(quote(JUNG));
    expect(b.tag).toBe('blockquote');
    expect(b.hasClass('q')).toBe(true);
    expect(b.getAttribute('data-kind')).toBe('quotation');
    expect(b.first('p.q-text')!.textContent).toBe((JUNG as { text: string }).text);
    const parts = b.first('.q-cite')!.elements.map((s) => [s.className, s.textContent]);
    expect(parts).toEqual([['q-work', 'The Archetypes and the Collective Unconscious'], ['q-loc', '¶6'], ['q-pg', 'p. 5']]);
  });

  it('adds no quotation marks, no label, no notice and no mark of verification', () => {
    const b = asEl(quote({ ...JUNG, voice: undefined } as QuoteSpec));
    expect(b.first('p.q-text')!.textContent).not.toMatch(/[“”"]/);
    expect(b.all().map((x) => x.className).join(' ')).not.toMatch(/scan|atlas|verified|dp-def|lq/);
    expect(b.textContent).not.toMatch(/damaged|verified|atlas/i);
  });

  it('where no printed page is known, the pdf page is drawn as such; a locator that is a printed page is drawn as one', () => {
    const pdfOnly = citeParts({ work: 'cw09ii', workTitle: 'Aion', locator: '¶426 (pdf p284)' });
    expect(pdfOnly.map((p) => p.text)).toEqual(['Aion', '¶426', 'pdf p284']);
    expect(citeParts({ work: 'sem-visions', workTitle: 'Visions', locator: 'pdf p74' }).map((p) => p.text)).toEqual(['Visions', 'pdf p74']);
    expect(citeParts({ work: 'liber-novus', workTitle: 'Liber Novus', locator: 'fol. 5/6 (pdf p292-295)' }).map((p) => p.text)).toEqual(['Liber Novus', 'fol. 5/6', 'pdf p292-295']);
    expect(citeParts({ work: 'van-eenwyk', workTitle: 'Archetypes & Strange Attractors', locator: 'p. 171 (pdf p172)' }).map((p) => p.text)).toEqual(['Archetypes & Strange Attractors', 'p. 171']);
  });

  it('the list drops the work from the cite (cite: locator)', () => {
    const b = asEl(quote(JUNG, { cite: 'locator' }));
    expect(b.find('.q-work')).toHaveLength(0);
    expect(b.find('.q-loc')).toHaveLength(1);
  });

  it('a quotation taken up mid-sentence starts with an ellipsis; a whole sentence is left alone', () => {
    expect(entered('and by being perceived.')).toBe('…and by being perceived.');
    expect(entered('The archetype is…')).toBe('The archetype is…');
    expect(asEl(quote({ ...JUNG, text: 'and by being perceived.' } as QuoteSpec)).first('p')!.textContent).toBe('…and by being perceived.');
  });

  it('"open the page" is its own control, drawn only when the corpus holds the work, and opens work and locator', () => {
    const held = bridge(['cw09i']);
    const b = asEl(quote(JUNG, { passages: held }));
    const open = b.first('button.q-open')!;
    expect(open.textContent).toBe('open the page');
    expect(open.hasClass('link-quiet')).toBe(true);
    expect(open.getAttribute('title')).toBe('Open The Archetypes and the Collective Unconscious at ¶6 (pdf p20)');
    // the cite itself is not the button
    expect(b.first('.q-cite')!.tag).toBe('span');
    open.click();
    expect(held.opened).toEqual([['cw09i', '¶6 (pdf p20)']]);
    expect(asEl(quote(JUNG, { passages: bridge([]) })).find('button')).toHaveLength(0);
    expect(asEl(quote(JUNG)).find('button')).toHaveLength(0);
    expect(asEl(quote({ ...JUNG, passage: false } as QuoteSpec, { passages: held })).find('button')).toHaveLength(0);
  });

  it('a registry title\'s trailing CW code is not drawn: the book is named by its title', () => {
    expect(citeParts({ work: 'cw09ii', workTitle: 'Aion: Researches into the Phenomenology of the Self (CW9ii)', locator: '¶70 (pdf p49)' }).map((p) => p.text)).toEqual(['Aion: Researches into the Phenomenology of the Self', '¶70', 'pdf p49']);
    const b = asEl(quote({ text: 'Words.', cite: { work: 'cw10', workTitle: 'Civilization in Transition (CW10)', locator: '¶589 (pdf p284)' } }, { passages: bridge(['cw10']) }));
    expect(b.first('.q-cite')!.getAttribute('aria-label')).toBe('Civilization in Transition, ¶589 (pdf p284)');
    expect(b.first('button.q-open')!.getAttribute('title')).toBe('Open Civilization in Transition at ¶589 (pdf p284)');
    expect(citeParts({ work: 'liber-novus', workTitle: 'Liber Novus (The Red Book)', locator: 'pdf p232' }).map((p) => p.text)).toEqual(['Liber Novus (The Red Book)', 'pdf p232']);
  });

  it('a cite still held as a string is drawn as text', () => {
    const b = asEl(quote({ text: 'Self text.', cite: 'Aion (CW9ii) ¶426' }));
    expect(b.first('.q-cite')!.textContent).toBe('Aion (CW9ii) ¶426');
    expect(b.find('button')).toHaveLength(0);
  });
});

describe('voice', () => {
  it('Jung wears no chip; another voice is named, by the work or by a curated voice', () => {
    expect(voiceOf('cw09i')).toBeNull();
    expect(voiceOf('vonzfranz-number-and-time')).toBe('von Franz');
    expect(voiceOf('neumann-great-mother')).toBe('Neumann');
    expect(voiceOf('burt-zodiac')).toBe('Burt');
    expect(voiceOf('a-blue-fire')).toBe('Hillman');
    expect(voiceOf('van-eenwyk')).toBe('Van Eenwyk');
    expect(voiceOf('book-of-thoth')).toBe('Crowley');
    expect(voiceOf('book-of-symbols')).toBe('Ronnberg');
    expect(asEl(quote(JUNG)).find('.q-voice')).toHaveLength(0);
    const vf = asEl(quote({ ...JUNG, cite: { ...JUNG_CITE, work: 'vonzfranz-number-and-time' } } as QuoteSpec));
    expect(vf.first('.q-voice')!.textContent).toBe('von Franz');
    expect(asEl(quote({ ...JUNG, voice: 'pauli' } as QuoteSpec)).first('.q-voice')!.textContent).toBe('Pauli');
    expect(asEl(quote({ ...JUNG, voice: 'someone-else' } as QuoteSpec)).first('.q-voice')!.textContent).toBe('someone-else');
  });
});

describe('caption', () => {
  const CAP: QuoteSpec = { text: 'Fig. 2. The Great Mother', kind: 'caption', cite: JUNG_CITE };
  it('is a figure.q-caption, never a blockquote, the label as printed, with its cite', () => {
    const c = asEl(quote(CAP));
    expect(c.tag).toBe('figure');
    expect(c.hasClass('q-caption')).toBe(true);
    expect(c.getAttribute('data-kind')).toBe('caption');
    expect(c.find('blockquote')).toHaveLength(0);
    expect(c.first('.q-text')!.textContent).toBe('Fig. 2. The Great Mother');
    expect(c.first('.q-loc')!.textContent).toBe('¶6');
  });
  it('is not lifted with an ellipsis', () => {
    expect(asEl(quote({ ...CAP, text: 'lower-case label' } as QuoteSpec)).first('.q-text')!.textContent).toBe('lower-case label');
  });
});

describe('QL', () => {
  it('is a blockquote.q-ql, chipped QL, with the published site\'s section or the framework\'s notes, and needs no work cite', () => {
    expect(qlSource('W § I')).toBe('epi-logos.org · § I');
    expect(qlSource('S2')).toBe('the QL framework’s notes · S2');
    const b = asEl(quote({ kind: 'ql', text: 'The indeterminate ground before anything is spoken. Pure capacity.', source: 'W § I' }));
    expect(b.tag).toBe('blockquote');
    expect(b.hasClass('q-ql')).toBe(true);
    expect(b.first('.q-voice')!.textContent).toBe('QL');
    expect(b.first('.q-cite')!.textContent).toBe('epi-logos.org · § I');
    expect(b.find('button')).toHaveLength(0);
  });
});

describe('size and tint', () => {
  it('a definition is lead size; compact wins over it; the surface can ask for compact for everything', () => {
    const def = { ...JUNG, emphasis: 'lead' } as QuoteSpec;
    expect(asEl(quote(def)).hasClass('q-lead')).toBe(true);
    expect(asEl(quote(def, { emphasis: 'compact' })).hasClass('q-lead')).toBe(false);
    expect(asEl(quote(def, { emphasis: 'compact' })).hasClass('q-compact')).toBe(true);
    expect(asEl(quote(def, { emphasis: 'body' })).hasClass('q-lead')).toBe(true);
    expect(asEl(quote(JUNG, { emphasis: 'compact' })).hasClass('q-compact')).toBe(true);
    expect(asEl(quote({ ...JUNG, emphasis: 'compact' } as QuoteSpec)).hasClass('q-compact')).toBe(true);
    const plain = asEl(quote(JUNG));
    expect(plain.hasClass('q-lead') || plain.hasClass('q-compact')).toBe(false);
  });
  it('a tint colours the bar through --q-tint', () => {
    expect(asEl(quote({ ...JUNG, tint: '#aa5533' } as QuoteSpec)).getAttribute('style')).toBe('--q-tint: #aa5533');
    expect(asEl(quote(JUNG)).getAttribute('style')).toBeNull();
  });
});

describe('every quotation carries its cite (QL excepted)', () => {
  it('a quotation or caption without one is refused, not drawn', () => {
    expect(() => quote({ text: 'No cite.' } as unknown as QuoteSpec)).toThrow(/cite/);
    expect(() => quote({ text: 'No cite.', kind: 'caption' } as unknown as QuoteSpec)).toThrow(/cite/);
  });

  it('the shared datasets: every quotation draws a cite that names its work and its locator', () => {
    const quotes: { text: string; cite: QuoteCite }[] = [];
    const walk = (o: unknown) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        if (typeof r.text === 'string' && r.cite && typeof (r.cite as { work?: unknown }).work === 'string') quotes.push(r as unknown as { text: string; cite: QuoteCite });
        Object.values(r).forEach(walk);
      }
    };
    walk(read('numbers.json'));
    walk(read('theory-pages.json'));
    expect(quotes.length).toBeGreaterThan(50);
    for (const q of quotes) {
      const b = asEl(quote(q as QuoteSpec));
      const cite = b.first('.q-cite');
      expect(cite).not.toBeNull();
      const title = q.cite.workTitle.replace(/\s*\((?:cw|CW)[^)]*\)\s*$/, '');
      expect(cite!.textContent.startsWith(title)).toBe(true);
      expect(cite!.getAttribute('aria-label')).toBe(`${title}, ${q.cite.locator}`);
    }
  });
});

describe('quoteList', () => {
  const mk = (work: string, workTitle: string, pdf: number, text = `Words on pdf p${pdf}.`): ListedQuote => ({ text, cite: { work, workTitle, locator: `pdf p${pdf}` } });
  const items: ListedQuote[] = [
    mk('cw12', 'Psychology and Alchemy', 40), mk('cw12', 'Psychology and Alchemy', 12), mk('cw12', 'Psychology and Alchemy', 90), mk('cw12', 'Psychology and Alchemy', 7), mk('cw12', 'Psychology and Alchemy', 55), mk('cw12', 'Psychology and Alchemy', 30),
    mk('cw09ii', 'Aion', 9), mk('cw09ii', 'Aion', 3),
    mk('book-of-symbols', 'The Book of Symbols', 18),
  ];

  it('groups by work in order of first appearance, each in page order, with a count per work and the head\'s total', () => {
    const l = asEl(quoteList(items, { title: 'Quotations' }));
    expect(l.tag).toBe('section');
    expect(l.first('.qs-count')!.textContent).toBe('9 from 3 works');
    const groups = l.find('.qs-group');
    expect(groups.map((g) => g.getAttribute('data-work'))).toEqual(['cw12', 'cw09ii', 'book-of-symbols']);
    expect(groups[0].first('.qs-n')!.textContent).toBe('6 quotations');
    expect(groups[2].first('.qs-n')!.textContent).toBe('1 quotation');
    // page order within Aion
    expect(groups[1].find('.q-text').map((t) => t.textContent)).toEqual(['Words on pdf p3.', 'Words on pdf p9.']);
    // the group head names the work once, so each cite is the locator alone
    expect(l.find('.q-work')).toHaveLength(0);
  });

  it('collapses beyond three, "Show all N" opens them and "Show fewer" folds them; one hidden quotation is never hidden', () => {
    const l = asEl(quoteList(items));
    const cw12 = () => l.find('.qs-group')[0];
    expect(cw12().find('.q')).toHaveLength(3);
    const more = cw12().first('.qs-more')!.first('button')!;
    expect(more.textContent).toBe('Show all 6');
    more.click();
    expect(cw12().find('.q')).toHaveLength(6);
    expect(cw12().first('.qs-more')!.first('button')!.textContent).toBe('Show fewer');
    cw12().first('.qs-more')!.first('button')!.click();
    expect(cw12().find('.q')).toHaveLength(3);
    const four = asEl(quoteList(items.slice(0, 4)));
    expect(four.find('.q')).toHaveLength(4);
    expect(four.find('.qs-more')).toHaveLength(0);
  });

  it('holds a work filter inside: chips, a count on each, and choosing one shows only that work; none for a single work', () => {
    const l = asEl(quoteList(items, { workLabel: (w) => ({ cw12: 'Alchemy', cw09ii: 'Aion', 'book-of-symbols': 'Symbols' } as Record<string, string>)[w] }));
    const chips = l.find('button.sf-pill');
    expect(chips.map((c) => c.textContent)).toEqual(['All9', 'Alchemy6', 'Aion2', 'Symbols1']);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    chips[2].click();
    expect(chips[2].getAttribute('aria-pressed')).toBe('true');
    expect(chips[0].getAttribute('aria-pressed')).toBe('false');
    expect(l.first('.qs-count')!.textContent).toBe('2 from 1 work');
    expect(l.find('.qs-group')).toHaveLength(1);
    chips[0].click();
    expect(l.find('.qs-group')).toHaveLength(3);
    expect(asEl(quoteList(items.filter((q) => q.cite.work === 'cw12'))).find('.qs-filter')).toHaveLength(0);
    expect(asEl(quoteList(items, { filter: false })).find('.qs-filter')).toHaveLength(0);
  });

  it('a compact panel takes a select for the filter; choosing a work shows all of it', () => {
    const l = asEl(quoteList(items, { emphasis: 'compact' }));
    const sel = l.first('select.qs-select')!;
    expect(sel.find('option').map((o) => o.textContent)).toEqual(['All works (9)', 'Psychology and Alchemy (6)', 'Aion (2)', 'The Book of Symbols (1)']);
    (sel as unknown as { value: string }).value = 'cw12';
    fire(sel, 'change');
    expect(l.find('.qs-group')).toHaveLength(1);
    expect(l.find('.q')).toHaveLength(6);
    expect(l.find('.q.q-compact')).toHaveLength(6);
  });

  it('an empty set says so, and says it in the words it is given', () => {
    expect(asEl(quoteList([])).first('.qs-empty')!.textContent).toBe('No quotation from this work in this set.');
    expect(asEl(quoteList([], { emptyText: 'Choose another work.' })).first('.qs-empty')!.textContent).toBe('Choose another work.');
  });

  it('the passage link reaches every quotation in the list', () => {
    const held = bridge(['cw09ii']);
    const l = asEl(quoteList(items, { passages: held }));
    expect(l.find('button.q-open')).toHaveLength(2);
    l.find('button.q-open')[0].click();
    expect(held.opened).toEqual([['cw09ii', 'pdf p3']]);
  });
});
