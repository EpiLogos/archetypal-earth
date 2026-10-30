// An occurrence's own quotation reaches the one Quote component with its first cite, its voice and its kind (a plate caption
// stays a caption); an occurrence with no quotation or no cite gives none, so nothing is ever drawn without its cite.
import { describe, expect, it } from 'vitest';
import { occurrenceQuote } from '../../src/lenses/ui';

const cite = { work: 'cw09ii', workTitle: 'Aion', locator: '¶426 (pdf p284)', year: '1951' };

describe('occurrenceQuote', () => {
  it('takes the quotation with the first cite', () => {
    expect(occurrenceQuote({ quote: 'the words', jung: [cite, { ...cite, work: 'cw12' }] })).toEqual({ text: 'the words', cite: { work: 'cw09ii', workTitle: 'Aion', locator: '¶426 (pdf p284)' } });
  });
  it('carries the voice of the cite when it is not Jung', () => {
    expect(occurrenceQuote({ quote: 'x', jung: [{ ...cite, voice: 'von Franz' }] })?.voice).toBe('von Franz');
  });
  it('keeps a plate caption a caption', () => {
    expect(occurrenceQuote({ quote: 'Fig. 3', caption: true, jung: [cite] })?.kind).toBe('caption');
  });
  it('gives none without a quotation or without a cite', () => {
    expect(occurrenceQuote({ jung: [cite] })).toBeNull();
    expect(occurrenceQuote({ quote: 'x', jung: [] })).toBeNull();
  });
});
