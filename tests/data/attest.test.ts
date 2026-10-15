// Attestations: the occurrences of the families curation admits on its own, built from the pages they carry and nothing
// else (scripts/lib/attest.mjs). These tests hold the rules; tests/data/field.test.ts holds what the published field says.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script
import { buildAttestations, chooseQuote, lastYear, locatorLine, reads, shortWork, workDates } from '../../scripts/lib/attest.mjs';

const q = (text: string, extra: Record<string, unknown> = {}, loc = 'pdf p1') => ({ text, cite: { work: 'book-of-thoth', workTitle: 'The Book of Thoth', locator: loc }, voice: 'Crowley', ...extra });

describe('the years a cite string names', () => {
  it('takes the last year of the span, expanding a two-digit end', () => {
    expect(lastYear('1943-54')).toEqual({ year: 1954, from: 1943 });
    expect(lastYear('1911–12/1952')).toEqual({ year: 1952, from: 1911 });
    expect(lastYear('1936/44')).toEqual({ year: 1944, from: 1936 });
    expect(lastYear('1957 vol.')).toEqual({ year: 1957, from: 1957 });
    expect(lastYear('undated')).toBeNull();
  });

  it('dates a Jung volume by the field’s own cites and any other work by the curated table, which wins', () => {
    const occ = [
      { jung: [{ work: 'cw12', year: '1944' }, { work: 'cw12', year: '1936/44' }, { work: 'cw12', year: '1944' }] },
      { jung: [{ work: 'cw14', year: '1943-54' }, { work: 'cw14', year: '1955–56' }] },
    ];
    const d = workDates(occ, { works: { 'book-of-thoth': { year: 1944, display: '1944', voice: 'Crowley' }, cw14: { voice: 'Jung' } } });
    expect(d.get('cw12')).toMatchObject({ year: 1944, display: '1944', range: [1936, 1944] });
    expect(d.get('book-of-thoth')).toEqual({ year: 1944, display: '1944', voice: 'Crowley' });
    // a voice-only entry names whose words a cite is without dating the work again
    expect(d.get('cw14')).toMatchObject({ voice: 'Jung' });
    expect(d.get('cw14')?.year).toBeGreaterThanOrEqual(1954);
  });
});

describe('which quotation stands for a work', () => {
  it('prefers a whole sentence to a bare heading, a plate caption or a damaged one', () => {
    const quotes = [
      q('THE ROOT OF THE POWERS OF WATER'),
      q('Plate: Ace of Cups', { caption: true }),
      q('a cosmic “memory system’”’;” it functions, simultaneously, as a means'),
      q('The Ace of Cups is the essential form of the Holy Grail.'),
    ];
    expect(chooseQuote(quotes).text).toBe('The Ace of Cups is the essential form of the Holy Grail.');
  });

  it('takes the longest under the cap, and the shortest when none fits', () => {
    expect(chooseQuote([q('Short one is here for a reason.'), q('This is a longer sentence that still fits the cap by a wide margin.')]).text).toMatch(/^This is a longer/);
    const long = `${'A very long quotation '.repeat(20)}ends.`;
    const longer = `${'A very long quotation '.repeat(25)}ends.`;
    expect(chooseQuote([q(longer), q(long)]).text).toBe(long);
  });

  it('reads a quotation whole: a capital or an opening mark, paired marks, no stacked ones', () => {
    expect(reads('The Two of Wands is called the Lord of Dominion.')).toBe(true);
    expect(reads('“Wands”, attributed to Fire; “Cups”, to Water;')).toBe(true);
    expect(reads('(Iliad, Book I) Listening to the intellect')).toBe(false);
    expect(reads('and then it goes on mid-sentence')).toBe(false);
    expect(reads('A word “unclosed here')).toBe(true); // an unclosed opening mark is the corpus’s own, not damage
    expect(reads('Ends with a stray.”')).toBe(false);
  });
});

describe('the attestations of a page set', () => {
  const pages = {
    'family:decan-aries-1': {
      sections: [
        { id: 'a', line: 'Crowley on the Two of Wands (pdf p175).', quotes: [q('The Two of Wands is called the Lord of Dominion.', {}, 'pdf p175')] },
        { id: 'b', line: 'Von Franz on the decanate images (pdf p199).', quotes: [{ ...q('Bruno arranges the thirty-six images of the decanates.', {}, 'pdf p199'), cite: { work: 'vonzfranz-number-time', workTitle: 'Number and Time', locator: 'pdf p199' }, voice: 'von Franz' }] },
      ],
    },
    'family:thoth-ace-of-wands': { sections: [{ id: 'a', line: 'Crowley on the Ace of Wands (pdf p190).', quotes: [q('The Ace of Wands is the Root of the Powers of Fire.', {}, 'pdf p190')] }] },
    'family:thinking': { sections: [{ id: 'a', line: 'Jung on thinking.', quotes: [{ text: 'Thinking is the psychological function which brings given contents into conceptual connection.', cite: { work: 'cw06', workTitle: 'Psychological Types (CW6)', locator: '¶731 (pdf p400)' }, voice: 'Jung' }] }] },
    'family:not-attested': { sections: [{ id: 'a', line: 'A page of a vault family.', quotes: [q('Anything at all.')] }] },
  };
  const dates = new Map([
    ['book-of-thoth', { year: 1944, display: '1944', voice: 'Crowley' }],
    ['vonzfranz-number-time', { year: 1970, display: '1970 (English 1974)', voice: 'von Franz' }],
    ['cw06', { year: 1921, display: '1921' }],
  ]);
  const earth = { place: 'Asia', page: '175', quote: 'Thus, roughly, Aces‐Princesses Wands cover Asia.', pole: null };
  const run = () => buildAttestations({
    pages,
    include: (id: string) => id !== 'not-attested',
    loci: (id: string) => (id === 'decan-aries-1' ? [{ ring: 'zodiac', lon: 0, span: 10, basis: 'site', via: [] }] : []),
    earthOf: (id: string) => (id === 'thoth-ace-of-wands' ? earth : null),
    dates,
    titleOf: (w: string) => ({ 'book-of-thoth': 'The Book of Thoth', 'vonzfranz-number-time': 'Number and Time', cw06: 'Psychological Types (CW6)' }[w] ?? w),
    familyName: (id: string) => ({ 'decan-aries-1': 'Aries · first decan', 'thoth-ace-of-wands': 'Ace of Wands', thinking: 'Thinking' }[id] ?? id),
  });

  it('makes one occurrence per family per work, dated by the work, in the words the page placed', () => {
    const { attestations, missing } = run();
    expect(missing).toEqual([]);
    expect(attestations.map((a: { id: string }) => a.id)).toEqual([
      'decan-aries-1-in-book-of-thoth',
      'decan-aries-1-in-vonzfranz-number-time',
      'thinking-in-cw06',
      'thoth-ace-of-wands-in-book-of-thoth',
    ]);
    const a = attestations[0];
    expect(a).toMatchObject({ year: 1944, yearDisplay: '1944', title: 'Aries · first decan — The Book of Thoth', quote: 'The Two of Wands is called the Lord of Dominion.' });
    expect(a.jung[0]).toEqual({ work: 'book-of-thoth', workTitle: 'The Book of Thoth', year: '1944', locator: 'pdf p175', voice: 'Crowley' });
    expect(a.sky).toEqual([{ ring: 'zodiac', lon: 0, span: 10, basis: 'site', via: [] }]);
    // a work that is not Crowley’s keeps its own date and voice
    expect(attestations[1]).toMatchObject({ year: 1970, yearDisplay: '1970 (English 1974)' });
    expect(attestations[1].jung[0].voice).toBe('von Franz');
    // Jung’s own volume carries no voice: the interface says Jung where none is named
    expect(attestations[2].jung[0].voice).toBeUndefined();
  });

  it('gives an Ace Crowley’s region, with his line placed beside the card’s own', () => {
    const a = run().attestations.find((x: { id: string }) => x.id === 'thoth-ace-of-wands-in-book-of-thoth');
    expect(a.place).toBe('Asia');
    expect(a.body.at(-1)).toBe('Crowley, pdf p175: “Thus, roughly, Aces‐Princesses Wands cover Asia.”');
    expect(a.jung[0].locator).toBe('pdf p190; pdf p175');
  });

  it('voices a quotation as its own words when they are not Jung’s, in a work that has no voice of its own', () => {
    const pauli = buildAttestations({
      pages: { 'family:ether': { sections: [{ id: 'a', line: 'Pauli on the ether.', quotes: [{ text: 'The ether is a picture the physicists gave up and the psyche kept.', cite: { work: 'letters-pauli', workTitle: 'Atom and Archetype', locator: 'letter 12P (pdf p60)' }, voice: 'Pauli' }] }] } },
      include: () => true, loci: () => [], earthOf: () => null,
      dates: new Map([['letters-pauli', { year: 1956, display: '1956' }]]), titleOf: (w: string) => w, familyName: () => 'Ether',
    });
    expect(pauli.attestations[0].jung[0].voice).toBe('Pauli');
  });

  it('leaves a family with no place unplaced rather than inventing one, and skips what is not attested', () => {
    const { attestations } = run();
    const t = attestations.find((x: { id: string }) => x.id === 'thinking-in-cw06');
    expect(t.sky).toEqual([]);
    expect(t.place).toBeUndefined();
    expect(attestations.some((x: { familyId: string }) => x.familyId === 'not-attested')).toBe(false);
  });

  it('names a family whose page holds no quotation, and a work it cannot date, instead of dressing either', () => {
    const none = buildAttestations({
      pages: { 'family:empty': { sections: [{ id: 'a', line: 'x', quotes: [] }] }, 'family:undated': { sections: [{ id: 'a', line: 'x', quotes: [{ ...q('A sentence that is long enough.'), cite: { work: 'mystery', workTitle: 'Mystery', locator: 'pdf p1' } }] }] } },
      include: () => true, loci: () => [], earthOf: () => null, dates: new Map(), titleOf: (w: string) => w, familyName: (id: string) => id,
    });
    expect(none.attestations).toEqual([]);
    expect(none.missing).toEqual(['empty', 'undated: no date for mystery']);
  });
});

describe('small helpers', () => {
  it('shortens a work title to the book’s name', () => {
    expect(shortWork('Psychology and Alchemy (CW12)')).toBe('Psychology and Alchemy');
    expect(shortWork('The Book of Thoth: A Short Essay on the Tarot of the Egyptians')).toBe('The Book of Thoth');
  });
  it('lists a work’s locators once each, the displayed quotation’s own page first', () => {
    const qs = [q('a', {}, 'pdf p2'), q('b', {}, 'pdf p1'), q('c', {}, 'pdf p2')];
    expect(locatorLine(qs)).toBe('pdf p2; pdf p1');
    expect(locatorLine(qs, qs[1])).toBe('pdf p1; pdf p2');
    // the chosen quotation is always named, even when the page set is longer than the list can hold
    const many = Array.from({ length: 9 }, (_, i) => q(`quote ${i}`, {}, `pdf p${i + 1}`));
    expect(locatorLine(many, many[8]).split('; ')).toContain('pdf p9');
    expect(locatorLine(many, many[8]).split('; ')).toHaveLength(6);
  });
});
