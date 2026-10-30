import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captionBlock, qlBlock, quoteBlock, type LensQuote } from '../../src/lenses/ui';
import type { PassageBridge } from '../../src/ui/passage';
import { FakeEl, installFakeDom } from './fake-dom';

// G2 pinned what the shared quotation blocks drew; they are now doors to the one Quote component (src/ui/quote.ts, Q8c), and
// these pin that they stay so: the lens data's shapes in, the component's blocks out. The component's own cases are
// tests/ui/quote.test.ts. By the owner's ruling (30 Oct) a scanned quotation carries no notice.

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

describe('quoteBlock is the Quote component', () => {
  it('draws a blockquote.q with the words and a cite: work · locator · printed page', () => {
    const b = asEl(quoteBlock(JUNG, undefined));
    expect(b.tag).toBe('blockquote');
    expect(b.hasClass('q')).toBe(true);
    expect(b.first('p')!.textContent).toBe(JUNG.text);
    expect(b.first('.q-cite')!.elements.map((s) => s.textContent)).toEqual(['The Archetypes and the Collective Unconscious', '¶6', 'p. 5']);
  });

  it('offers "open the page" only when the corpus holds the work, and it opens work and locator', () => {
    const passages = bridge(['cw09i']);
    const open = asEl(quoteBlock(JUNG, passages)).first('button.q-open')!;
    open.click();
    expect(passages.opened).toEqual([['cw09i', '¶6']]);
    expect(asEl(quoteBlock(JUNG, bridge([]))).find('button')).toHaveLength(0);
  });

  it('names whose words they are when they are not Jung\'s: by the work, or by a curated voice; Jung wears no chip', () => {
    const vf = asEl(quoteBlock({ ...JUNG, cite: { ...JUNG.cite, work: 'vonzfranz-number-and-time' } }, undefined));
    expect(vf.first('.q-voice')!.textContent).toBe('von Franz');
    expect(asEl(quoteBlock(JUNG, undefined)).find('.q-voice')).toHaveLength(0);
    expect(asEl(quoteBlock({ ...JUNG, voice: 'pauli' }, undefined)).first('.q-voice')!.textContent).toBe('Pauli');
  });

  it('a scanned quotation in the data is drawn like any other, with no notice', () => {
    const scanned = read('theory-pages.json').pages.psychoid.sections[4].quotes[5] as LensQuote;
    const b = asEl(quoteBlock(scanned, undefined));
    expect(b.textContent).not.toMatch(/damaged|scan/i);
    expect(b.find('.dp-scan')).toHaveLength(0);
    expect(b.first('.q-cite')).not.toBeNull();
  });

  it('the compact option reaches the quotation, the caption and nothing is compact by default', () => {
    expect(asEl(quoteBlock(JUNG, undefined, { compact: true })).hasClass('q-compact')).toBe(true);
    expect(asEl(quoteBlock({ ...JUNG, caption: true }, undefined, { compact: true })).hasClass('q-compact')).toBe(true);
    expect(asEl(quoteBlock(JUNG, undefined)).hasClass('q-compact')).toBe(false);
  });
});

describe('the caption and QL doors', () => {
  it('a caption (by flag or by captionBlock) is a figure.q-caption with its cite, never a blockquote', () => {
    const CAP: LensQuote = { ...JUNG, text: 'Fig. 2. The Great Mother', caption: true };
    for (const c of [asEl(quoteBlock(CAP, undefined)), asEl(captionBlock(JUNG, undefined))]) {
      expect(c.tag).toBe('figure');
      expect(c.hasClass('q-caption')).toBe(true);
      expect(c.find('blockquote')).toHaveLength(0);
      expect(c.first('.q-loc')!.textContent).toBe('¶6');
    }
  });

  it('a QL formulation is a blockquote.q-ql chipped QL, with its source', () => {
    const b = asEl(qlBlock({ text: 'The indeterminate ground before anything is spoken. Pure capacity.', source: 'W § I' }));
    expect(b.tag).toBe('blockquote');
    expect(b.hasClass('q-ql')).toBe(true);
    expect(b.first('.q-voice')!.textContent).toBe('QL');
    expect(b.first('.q-cite')!.textContent).toBe('epi-logos.org · § I');
  });
});

describe('every real quotation in the shared datasets draws a cite', () => {
  it('numbers.json and theory-pages.json: no quote block comes out without a cite', () => {
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
      const cite = b.first('.q-cite');
      expect(cite!.getAttribute('aria-label')).toBe(`${q.cite.workTitle.replace(/\s*\((?:cw|CW)[^)]*\)\s*$/, '')}, ${q.cite.locator}`);
    }
  });
});
