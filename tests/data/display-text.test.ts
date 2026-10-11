// The display-text hygiene rules: the scan's glued footnote digits leave the DISPLAYED string, and a trailing
// reading-pass trim is completed from the corpus sentence it cut — placement and the corpus itself stay verbatim.
// Every rule here carries its must-NOT-touch twin: years, decimals, note references and Jung's own ellipses survive.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
// @ts-expect-error Plain ESM shared with the generators.
import { stripFootnoteMarkers, sentenceEndsBeforeTrailingEllipsis, TRAILING_ELLIPSIS } from '../../scripts/lib/display.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { citeQuotes, completeTrailingQuote } from '../../scripts/lib/quotes.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { verify, workLoader } from '../../scripts/lib/cite.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { DEFAULT_VAULT } from '../../scripts/lib/vault.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { parseInstanceBody } from '../../scripts/lib/text.mjs';

/** A loader over one fake work: pages of text with optional ¶ markers inline, as the flattened corpus holds them. */
function fakeLoader(work: string, pages: { page: number; text: string }[]) {
  let flat = '';
  const ps: { page: number; print: string | null; at: number }[] = [];
  const marks: { n: number; at: number }[] = [];
  for (const p of pages) {
    ps.push({ page: p.page, print: null, at: flat.length });
    for (const part of p.text.split(/(\[¶\d+\])/)) {
      const m = /^\[¶(\d+)\]$/.exec(part);
      if (m) marks.push({ n: Number(m[1]), at: flat.length });
      else flat += part;
    }
    flat += ' ';
  }
  const corpus = { text: flat, pages: ps, marks };
  return (w: string) => (w === work ? corpus : null);
}

describe('glued footnote markers leave the displayed string', () => {
  const strip = [
    ['a traditional mantic significance.43', 'a traditional mantic significance.'],
    ['the conclusions of Silberer.9', 'the conclusions of Silberer.'],
    ['the last ram74 (άρνίον, lamb) of the declining Aries era.75', 'the last ram74 (άρνίον, lamb) of the declining Aries era.'],
    ['the archetypal self.5 He represents a totality', 'the archetypal self. He represents a totality'],
    ['less than half the width of the full moon.37', 'less than half the width of the full moon.'],
    ['… of nature.” 2', '… of nature.”'],
    ['mandala, “Deus est circulus …,”74 the Pythagorean tetraktys,75 the quaternity', 'mandala, “Deus est circulus …,” the Pythagorean tetraktys, the quaternity'],
    ['the “marriage quaternio,”18 can also be found in fairytales.', 'the “marriage quaternio,” can also be found in fairytales.'],
    ['facts.43 44 follow here', 'facts. follow here'],
    ['El-Khidr in Sura 18 of the Koran.27 I conjecture further', 'El-Khidr in Sura 18 of the Koran. I conjecture further'],
  ];
  it.each(strip)('%s', (a, b) => {
    expect(stripFootnoteMarkers(a)).toBe(b);
  });

  const keep = [
    'The year 1913 changed everything.',
    'see paragraph 440 and ¶452',
    'pp. 75s. and pp.387, 423f',
    'ch. II nn.24-25 and vv.26–27',
    'cw09ii ¶149, n.83 (pdf p105)',
    'only 0.21 degrees apart, decimals like 3.14',
    'in the year 7 B.C. this famed conjunction',
    'Editorial note n.1 and noten.1 stay',
    'the ratio 1 to 9 holds',
    'May 29, 1913',
    'the “waited.” 2 hours passed', // a number after a closing quote, not a marker
    'the footnote section stands: quote.”\n53 Quicherat, Procès', // a digit after a line break begins the notes
    'he said “18 times” to me', // an opening quote before digits may quote a number
  ];
  it.each(keep)('%s', (s) => {
    expect(stripFootnoteMarkers(s)).toBe(s);
  });

  it('is idempotent', () => {
    for (const s of ['significance.43 silberer.9 tetraktys,75 quaternio,”18 nature.” 2', 'completed text.34 more.55']) {
      const once = stripFootnoteMarkers(s);
      expect(stripFootnoteMarkers(once)).toBe(once);
    }
  });
});

describe('a trailing trim is completed from the corpus sentence it cut', () => {
  const load = fakeLoader('wx', [
    { page: 10, text: '[¶17] The theme is the magical travelling companion, of whom I will give three famous examples: the disciples on the road to Emmaus, Krishna and Arjuna in the Bhagavad Gita.27 The treasure is the self.' },
    { page: 11, text: '[¶18] A second page repeats nothing of the first and speaks instead of the moon, which was believed to make rain.' },
  ]);

  it('extends the display to the corpus sentence end, its footnote digits stripped', () => {
    const r = completeTrailingQuote(load, 'wx', 'The theme is the magical travelling companion, of whom I will give three famous examples: the disciples on the road to Emmaus…');
    expect(r.done).toBe(true);
    expect(r.text).toBe('The theme is the magical travelling companion, of whom I will give three famous examples: the disciples on the road to Emmaus, Krishna and Arjuna in the Bhagavad Gita.');
  });

  it('joins a trim that cut right before a comma without a stray space', () => {
    const r = completeTrailingQuote(load, 'wx', 'of whom I will give three famous examples: the disciples on the road to Emmaus…');
    expect(r.done).toBe(true);
    expect(r.text).toContain('Emmaus, Krishna');
  });

  it('keeps a quote the corpus itself pauses for (its own ellipsis)', () => {
    const pauses = fakeLoader('pause', [{ page: 10, text: 'The theme is the magical travelling companion, of whom the disciples on the road … and the companion appears to him in person.' }]);
    const r = completeTrailingQuote(pauses, 'pause', 'The theme is the magical travelling companion, of whom the disciples on the road…');
    expect(r.done).toBe(false);
    expect(r.text).toBe('The theme is the magical travelling companion, of whom the disciples on the road…');
  });

  it('keeps a trailing ellipsis that follows a complete sentence (an intentional omission)', () => {
    expect(sentenceEndsBeforeTrailingEllipsis('It rises and sets there. …')).toBe(true);
    const r = completeTrailingQuote(load, 'wx', 'The treasure is the self. …');
    expect(r.done).toBe(false);
  });

  it('declines when the stem names no place, two places, or no corpus stands behind the work', () => {
    const short = fakeLoader('wx', [{ page: 1, text: 'Nothing here matches the words at all.' }]);
    expect(completeTrailingQuote(short, 'wx', 'words wholly missing from every page of the book…').done).toBe(false);
    const twice = fakeLoader('dup', [{ page: 1, text: 'the same sentence twice over and once more, for the same sentence twice over is what the page holds, and then it stops here.' }]);
    expect(completeTrailingQuote(twice, 'dup', 'the same sentence twice over…').reason).toMatch(/more than one place/);
    expect(completeTrailingQuote(load, 'nowhere', 'words wholly missing from every page of the book…').reason).toMatch(/no corpus/);
  });

  it('never fires without a trailing ellipsis', () => {
    const r = completeTrailingQuote(load, 'wx', 'The treasure is the self, wholly and completely.');
    expect(r.done).toBe(false);
    expect(r.text).toBe('The treasure is the self, wholly and completely.');
  });
});

describe('citeQuotes publishes cleaned displays and places the curator’s own words', () => {
  const load = fakeLoader('wx', [
    { page: 10, text: '[¶17] Psychologically the enigma.9 The mandala is a crossing of circles, and its totality is discernible above all in the countless variants of the self. The trimming harvest cut here, yet the corpus continues with a whole sentence.' },
  ]);
  const titles = new Map([['wx', 'A Fake Work']]);

  it('strips the marker, completes the trim, and cites the page the words stand on', () => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const out = citeQuotes(load, titles, [
      { work: 'wx', page: 10, para: 17, quote: 'Psychologically the enigma.9 The mandala is a crossing of circles, and its totality is discernible above all in the countless variants of the self. The trimming harvest cut…' },
    ], 'test', errors, warnings);
    expect(errors).toEqual([]);
    expect(out[0].text).toBe('Psychologically the enigma. The mandala is a crossing of circles, and its totality is discernible above all in the countless variants of the self. The trimming harvest cut here, yet the corpus continues with a whole sentence.');
    expect(out[0].cite.locator).toBe('¶17 (pdf p10)');
  });

  it('leaves a clean quote byte for byte as the curation gave it', () => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const q = 'The mandala is a crossing of circles, and its totality is discernible above all in the countless variants of the self.';
    const out = citeQuotes(load, titles, [{ work: 'wx', para: 17, quote: q }], 'test', errors, warnings);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(out[0].text).toBe(q);
  });
});

describe('verify reads a cleaned display through the folded markers', () => {
  it('a display whose digits were stripped still stands verbatim on its cited page', () => {
    const load = fakeLoader('wx', [
      { page: 10, text: 'The alchemist reaches the conclusions of Silberer.9 and stops there for good. The rest of the page fills with other words entirely, so the match cannot wander.' },
    ]);
    expect(verify(load, { work: 'wx', locator: 'pdf p10', quote: 'The alchemist reaches the conclusions of Silberer. and stops there for good.' })).toBeNull();
    expect(verify(load, { work: 'wx', locator: 'pdf p10', quote: 'The alchemist reaches the conclusions nobody reached.' })).toMatch(/not verbatim/);
  });
});

describe('the ingest quote rail: capQuote completes a half-thought from the note’s own words', () => {
  it('a long quote without an inner boundary runs on to the first real sentence end', () => {
    const long = `> "The little god is seated upon his shoulder as a baby, and Priapus is holding up a bunch of grapes to him, and looking at him with an indescribable smile, that marvelous archaic smile which is the laughter of the gods and of the morning of the world." (cw99 pdf p9)`;
    const p = parseInstanceBody(`Para one.\n\n${long}\n`);
    expect(p.quote?.endsWith('of the world.')).toBe(true);
    expect(p.quote).not.toMatch(/…/);
  });

  it('the ellipsis pause inside a quote is not mistaken for a sentence end', () => {
    const long = `> "He travelled up and up until he reached that light... And there he came to another world and discovered the spiritual world which he had not made, and there the great enlightenment came to him at last, that worlds and worlds had existed and would continue to exist besides this miserable little world." (cw99 pdf p9)`;
    const p = parseInstanceBody(`Para one.\n\n${long}\n`);
    expect(p.quote?.endsWith('little world.')).toBe(true);
  });

  it('a quote the note itself leaves trailing stays as it is when no corpus can complete it', () => {
    const line = '> "Our Father which art not in heaven..." (cwzz pdf p9)';
    const p = parseInstanceBody(`Para one.\n\n${line}\n`);
    expect(p.quote).toBe('Our Father which art not in heaven...');
  });

  it('a short quote is untouched', () => {
    const p = parseInstanceBody('Para one with [[x|a link]].\n\n> "A verbatim line." (cw12 ¶5, pdf p9)\n\nParallels: [[one-a]] · [[two-b]].\n');
    expect(p.quote).toBe('A verbatim line.');
    expect(p.parallels).toEqual(['one-a', 'two-b']);
    expect(p.body).toEqual(['Para one with a link.']);
  });
});

describe('the vault corpus itself: a real trim completes against real pages', () => {
  // No fixtures: the corpus is the court of appeal, so the completion engine is heard against it when it stands.
  it.runIf(fs.existsSync(`${DEFAULT_VAULT}/corpus`))('the Emmaus trim completes to its sentence end in Aion', () => {
    const load = workLoader(DEFAULT_VAULT);
    const r = completeTrailingQuote(load, 'cw12', 'This is the theme of the magical travelling companion, of whom I will give three famous examples: the disciples on the road to Emmaus…');
    expect(r.done).toBe(true);
    expect(r.text).toMatch(/Emmaus, Krishna and Arjuna in the Bhagavad Gita, Moses and El-Khidr in Sura 18 of the Koran\.$/);
  });
});
