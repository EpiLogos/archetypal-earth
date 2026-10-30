import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captionBlock, entered, qlBlock, qlSource, quoteBlock, voiceOf, type LensQuote } from '../../src/lenses/ui';
import type { PassageBridge } from '../../src/ui/passage';
import { FakeEl, installFakeDom } from './fake-dom';

// G2, characterisation: what the shared quotation block draws today, before the one Quote component replaces it
// (ProjectCentral/docs/PRODUCT-ALIGNMENT-PLAN.md §3 item 5). These pin the cite footer, the voice chip, the passage
// link, the damaged-scan notice, the caption form and the QL form as they stand.

const read = (rel: string) => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf8'));

let restore: () => void;
beforeAll(() => { restore = installFakeDom(); });
afterAll(() => restore());

const asEl = (x: HTMLElement) => x as unknown as FakeEl;
const bridge = (known: string[]): PassageBridge & { opened: [string, string][] } => {
  const opened: [string, string][] = [];
  return { known: (w: string) => known.includes(w), open: (w: string, loc: string) => { opened.push([w, loc]); }, opened } as unknown as PassageBridge & { opened: [string, string][] };
};

const JUNG: LensQuote = {
  text: 'The archetype is essentially an unconscious content that is altered by becoming conscious and by being perceived.',
  cite: { work: 'cw09i', workTitle: 'The Archetypes and the Collective Unconscious', locator: '¶6', print: '5' },
};

describe('the quote block (today)', () => {
  it('is a blockquote.lq with the words and a cite footer: work, locator, printed page', () => {
    const b = asEl(quoteBlock(JUNG, undefined));
    expect(b.tag).toBe('blockquote');
    expect(b.hasClass('lq')).toBe(true);
    expect(b.first('p')!.textContent).toBe(JUNG.text);
    const footer = b.first('footer')!;
    expect(footer.first('.lq-cite')!.textContent).toBe('The Archetypes and the Collective Unconscious, ¶6 · p. 5');
  });

  it('omits the printed page when the cite has none', () => {
    const q = { ...JUNG, cite: { ...JUNG.cite, print: undefined } };
    expect(asEl(quoteBlock(q, undefined)).first('.lq-cite')!.textContent).toBe('The Archetypes and the Collective Unconscious, ¶6');
  });

  it('draws the cite as a button that opens the passage when the corpus holds the work, else as plain text', () => {
    const passages = bridge(['cw09i']);
    const held = asEl(quoteBlock(JUNG, passages)).first('.lq-cite')!;
    expect(held.tag).toBe('button');
    expect(held.hasClass('link-quiet')).toBe(true);
    expect(held.getAttribute('title')).toBe('Open the passage in the corpus');
    held.click();
    expect(passages.opened).toEqual([['cw09i', '¶6']]);
    const unheld = asEl(quoteBlock(JUNG, bridge([]))).first('.lq-cite')!;
    expect(unheld.tag).toBe('span');
  });

  it('names whose words they are when they are not Jung\'s: by the work, or by a curated voice', () => {
    expect(voiceOf('cw09i')).toBeNull();
    expect(voiceOf('vonzfranz-number-and-time')).toBe('von Franz');
    expect(voiceOf('neumann-great-mother')).toBe('Neumann');
    expect(voiceOf('burt-zodiac')).toBe('Burt');
    expect(voiceOf('a-blue-fire')).toBe('Hillman');
    expect(voiceOf('van-eenwyk')).toBe('Van Eenwyk');
    expect(voiceOf('book-of-thoth')).toBe('Crowley');
    const vf = asEl(quoteBlock({ ...JUNG, cite: { ...JUNG.cite, work: 'vonzfranz-number-and-time' } }, undefined));
    expect(vf.first('.lq-voice')!.textContent).toBe('von Franz');
    // a Jung quote carries no chip
    expect(asEl(quoteBlock(JUNG, undefined)).first('.lq-voice')).toBeNull();
    // a curated voice wins over the work's, and a known one is shown by its name
    expect(asEl(quoteBlock({ ...JUNG, voice: 'pauli' }, undefined)).first('.lq-voice')!.textContent).toBe('Pauli');
    expect(asEl(quoteBlock({ ...JUNG, voice: 'someone-else' }, undefined)).first('.lq-voice')!.textContent).toBe('someone-else');
  });

  it('marks a quotation taken up mid-sentence with a leading ellipsis, and leaves a whole sentence alone', () => {
    expect(entered('and by being perceived.')).toBe('…and by being perceived.');
    expect(entered('The archetype is…')).toBe('The archetype is…');
    expect(asEl(quoteBlock({ ...JUNG, text: 'and by being perceived.' }, undefined)).first('p')!.textContent).toBe('…and by being perceived.');
  });

  it('says a quotation is a damaged scan, in a real scanned quote from the data, and says nothing otherwise', () => {
    const scanned = read('theory-pages.json').pages.psychoid.sections[4].quotes[5] as LensQuote;
    expect(scanned.scan).toBe(true);
    const b = asEl(quoteBlock(scanned, undefined));
    expect(b.first('.dp-scan')!.textContent).toBe('Damaged scan: the words are as the scan reads them');
    expect(b.first('p')!.textContent).toBe(entered(scanned.text));
    expect(asEl(quoteBlock(JUNG, undefined)).first('.dp-scan')).toBeNull();
  });
});

describe('the caption form (today)', () => {
  const CAP: LensQuote = { ...JUNG, text: 'Fig. 2. The Great Mother', caption: true };
  it('is a figure.lq-caption, never a blockquote, with the cite beneath', () => {
    const c = asEl(quoteBlock(CAP, undefined));
    expect(c.tag).toBe('figure');
    expect(c.hasClass('lq-caption')).toBe(true);
    expect(c.find('blockquote')).toHaveLength(0);
    expect(c.first('.lq-caption-text')!.textContent).toBe('Fig. 2. The Great Mother');
    expect(c.first('.lq-cite')!.textContent).toContain('¶6');
    expect(asEl(captionBlock(CAP, undefined)).tag).toBe('figure');
  });
  it('does not lift the text with an ellipsis and carries the damaged-scan notice', () => {
    const c = asEl(captionBlock({ ...CAP, text: 'lower-case label', scan: true }, undefined));
    expect(c.first('.lq-caption-text')!.textContent).toBe('lower-case label');
    expect(c.first('.dp-scan')).not.toBeNull();
  });
  it('the compact option reaches both forms', () => {
    expect(asEl(quoteBlock(JUNG, undefined, { compact: true })).hasClass('lq-compact')).toBe(true);
    expect(asEl(quoteBlock(CAP, undefined, { compact: true })).hasClass('lq-compact')).toBe(true);
    expect(asEl(quoteBlock(JUNG, undefined)).hasClass('lq-compact')).toBe(false);
  });
});

describe('the QL form (today)', () => {
  it('is a blockquote.lq-ql with a QL chip and the published site\'s section, or the framework\'s notes', () => {
    expect(qlSource('W § I')).toBe('epi-logos.org, § I');
    expect(qlSource('S2')).toBe('the QL framework\'s notes, S2');
    const b = asEl(qlBlock({ text: 'The indeterminate ground before anything is spoken. Pure capacity.', source: 'W § I' }));
    expect(b.tag).toBe('blockquote');
    expect(b.hasClass('lq-ql')).toBe(true);
    expect(b.first('.lq-voice.ql')!.textContent).toBe('QL');
    expect(b.first('.lq-cite')!.textContent).toBe('epi-logos.org, § I');
  });
});

describe('every real quotation in the shared datasets draws a cite', () => {
  it('numbers.json and theory-pages.json: no quote block comes out without a cite line', () => {
    const quotes: LensQuote[] = [];
    const walk = (o: unknown) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        if (typeof r.text === 'string' && r.cite && typeof (r.cite as { work?: unknown }).work === 'string') quotes.push(r as unknown as LensQuote);
        Object.values(r).forEach(walk);
      }
    };
    walk(read('numbers.json'));
    walk(read('theory-pages.json'));
    expect(quotes.length).toBeGreaterThan(50);
    for (const q of quotes) {
      const b = asEl(quoteBlock(q, undefined));
      const cite = b.first('.lq-cite');
      expect(cite!.textContent.startsWith(q.cite.workTitle)).toBe(true);
      expect(cite!.textContent).toContain(q.cite.locator);
    }
  });
});
