// The quote oracle (scripts/quote-oracle.mjs, engine in scripts/lib/quote-oracle.mjs): every record the app presents as a
// quotation must be verbatim on the page it cites. These tests hold the normaliser, the matcher, the locator reader, the
// gate's exit codes, and the datasets that pass today (so a regression there turns the suite red while field.json is still
// being repaired). They never depend on field.json being clean.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain ESM script
import { normalise, fragmentsOf, parseLocator, prepareVolume, matchQuote, judge, citedPages, runOracle } from '../../scripts/lib/quote-oracle.mjs';
// @ts-expect-error plain ESM script
import { applyQuoteFixes, validateQuoteFixes } from '../../scripts/lib/quote-fixes.mjs';

const ROOT = path.resolve(__dirname, '..', '..');

// a small volume: pdf pages 10..14, printed pages i..v on the same, ¶ anchors on p11 and p13
const vol = prepareVolume({
  work: 'tv',
  paras: [
    { para: 5, p: 11, off: 0, len: 10 },
    { para: 6, p: 13, off: 0, len: 10 },
  ],
  pages: [
    { p: 10, print: 'i', text: 'The beginning of the argument is dedi-\ncated to the question of what the self may be.' },
    { p: 11, print: 'ii', text: 'A voice said, “That is art.” Then it fell silent for a long while, and the room was still.' },
    { p: 12, print: 'iii', text: 'The rolling sea came in and went out; the shore Th e psychoid form stayed as it was, unmoved by the tide.' },
    { p: 13, print: 'iv', text: 'He ended the sentence here, and the next one began on the following page and ran on past the foot of it' },
    { p: 14, print: 'v', text: 'into the margin where nobody had written anything. Then the book closed.' },
  ],
});

describe('normalise: the stated folds, both sides', () => {
  it('folds a line-end hyphen into the word, and the "dedi- cated" a quotation keeps', () => {
    expect(normalise('dedi-\ncated to')).toBe('dedicated to');
    expect(normalise('dedi- cated to')).toBe('dedicated to');
    expect(normalise('a self-contained thing')).toBe('a self-contained thing'); // a real hyphen stays
  });
  it('treats every quote mark as one mark and every dash as a hyphen', () => {
    expect(normalise('“a” ‘b’ "c" \'d\'')).toBe('"a" "b" "c" "d"');
    expect(normalise('one–two—three―four')).toBe('one-two-three-four');
  });
  it('folds ligatures, soft hyphens, ¶ anchors, brackets, verse slashes and whitespace', () => {
    expect(normalise('ﬁnal ofﬁce')).toBe('final office');
    expect(normalise('co­operate')).toBe('cooperate');
    expect(normalise('**¶12** the  words\n\nrun')).toBe('the words run');
    expect(normalise('[the] words')).toBe('the words');
    expect(normalise('a maid / and a son')).toBe('a maid and a son');
    expect(normalise('a maid/ and a son')).toBe('a maid and a son');
  });
  it('folds the scan’s glued footnote digits and the case', () => {
    expect(normalise('a traditional mantic significance.43 And')).toBe('a traditional mantic significance. and');
  });
  it('reads the ellipsis character as three dots', () => {
    expect(normalise('and so… on')).toBe(normalise('and so... on'));
  });
});

describe('fragmentsOf: an ellipsis splits a quotation', () => {
  it('splits at …, ... and ". . ." and drops fragments too short to name a place', () => {
    expect(fragmentsOf('A voice said to me… that is art and more')).toEqual(['A voice said to me', 'that is art and more']);
    expect(fragmentsOf('A voice said to me... that is art and more')).toEqual(['A voice said to me', 'that is art and more']);
    expect(fragmentsOf('A voice said to me . . . that is art and more')).toEqual(['A voice said to me', 'that is art and more']);
    expect(fragmentsOf('A voice said to me, that is art... and so')).toEqual(['A voice said to me, that is art']);
  });
  it('is null when the quotation has no ellipsis', () => {
    expect(fragmentsOf('A voice said to me, that is art.')).toBeNull();
  });
});

describe('parseLocator: pdf pages, ranges, lists, printed pages', () => {
  it('reads "pdf p", "pdf pp" and ranges with hyphen or en dash', () => {
    expect(parseLocator('¶452 (pdf p350)').pdf).toEqual([350]);
    expect(parseLocator('¶289–293 (pdf pp169–170)').pdf).toEqual([169, 170]);
    expect(parseLocator('24 Feb + 2 Mar 1932 (pdf pp669-675)').pdf).toEqual([669, 670, 671, 672, 673, 674, 675]);
    expect(parseLocator('¶¶335-336 (pdf pp204-205)').pdf).toEqual([204, 205]);
  });
  it('reads page lists: "pdf pp62, 64–66" is 62, 64, 65, 66', () => {
    expect(parseLocator('Lectures 5–6 (pdf pp62, 64–66)').pdf).toEqual([62, 64, 65, 66]);
    expect(parseLocator('Letters 58/59 (pdf pp147, 159)').pdf).toEqual([147, 159]);
  });
  it('reads every run of a multi-cite locator, and not a note number after a comma', () => {
    expect(parseLocator('pdf p5; pdf p9; pdf p12').pdf).toEqual([5, 9, 12]);
    expect(parseLocator('¶181 (pdf p71); ¶185 (pdf p72)').pdf).toEqual([71, 72]);
    expect(parseLocator('pdf p12, n.3').pdf).toEqual([12]);
  });
  it('reads printed pages only where no pdf page is named', () => {
    expect(parseLocator('p. 67')).toMatchObject({ pdf: [], printed: ['67'] });
    expect(parseLocator('pp. 67–68')).toMatchObject({ pdf: [], printed: ['67', '68'] });
    expect(parseLocator('p. 9 (pdf p31)')).toMatchObject({ pdf: [31], printed: ['9'] });
  });
  it('reads ¶ numbers', () => {
    expect(parseLocator('¶¶335-336 (pdf pp204-205)').paras).toEqual([335, 336]);
  });
});

describe('citedPages: pdf, printed→pdf, ¶→pdf', () => {
  it('reads the pdf page of "p. 9 (pdf p31)", not the printed one', () => {
    const v2 = prepareVolume({ work: 'x', pages: [{ p: 31, print: '9', text: 'a' }, { p: 32, print: '9', text: 'b' }], paras: [] });
    expect(citedPages(v2, 'p. 9 (pdf p32)')).toEqual({ pages: [32], via: 'pdf', missing: [] });
  });
  it('maps a printed page to the pdf page whose label it is', () => {
    expect(citedPages(vol, 'p. iii')).toMatchObject({ pages: [], via: null }); // a roman numeral is not a "p. 12" cite
    const v2 = prepareVolume({ work: 'x', pages: [{ p: 31, print: '9', text: 'a' }, { p: 32, print: '10', text: 'b' }], paras: [] });
    expect(citedPages(v2, 'p. 9')).toEqual({ pages: [31], via: 'printed', missing: [] });
    expect(citedPages(v2, 'pp. 9–10')).toEqual({ pages: [31, 32], via: 'printed', missing: [] });
  });
  it('maps a ¶ to the page of its anchor, and names the pages the volume lacks', () => {
    expect(citedPages(vol, '¶5')).toEqual({ pages: [11], via: 'para', missing: [] });
    expect(citedPages(vol, 'pdf p99')).toEqual({ pages: [], via: 'pdf', missing: [99] });
  });
});

describe('matchQuote: verbatim on the cited page', () => {
  it('passes a quotation verbatim on the cited page, curly marks and all', () => {
    expect(matchQuote(vol, "A voice said, 'That is art.' Then it fell silent", 'pdf p11').cls).toBe('exact');
  });
  it('folds the line-end hyphen: "dedicated" stands on a page that prints "dedi-\\ncated"', () => {
    expect(matchQuote(vol, 'The beginning of the argument is dedicated to the question', 'pdf p10').cls).toBe('exact');
  });
  it('lets a quotation start on the cited page and run over the break', () => {
    expect(matchQuote(vol, 'the next one began on the following page and ran on past the foot of it into the margin', 'pdf p13').cls).toBe('exact');
  });
  it('accepts ellipsis fragments that stand in order on the cited page', () => {
    expect(matchQuote(vol, 'A voice said, “That is art.” … the room was still.', 'pdf p11').cls).toBe('ellipsis');
    expect(matchQuote(vol, 'A voice said, “That is art.”... the room was still.', 'pdf p11').cls).toBe('ellipsis');
  });
  it('refuses ellipsis fragments out of order', () => {
    const r = matchQuote(vol, 'the room was still. … A voice said, “That is art.”', 'pdf p11');
    expect(r.cls).not.toBe('ellipsis');
    expect(r.cls).not.toBe('exact');
  });
  it('lets a "pdf pp N–M" range hold the quotation on any of its pages', () => {
    expect(matchQuote(vol, 'The rolling sea came in and went out', 'pdf pp 11–13').cls).toBe('exact');
    expect(matchQuote(vol, 'The rolling sea came in and went out', 'pdf pp10, 12').cls).toBe('exact');
    expect(matchQuote(vol, 'The rolling sea came in and went out', 'pdf pp13–14').cls).toBe('wrong-page-adjacent');
  });
  it('reports a printed-page cite that holds the words as printed-only: it cannot open the passage', () => {
    const r = matchQuote(vol, 'A voice said, “That is art.”', 'p. ii');
    // roman labels are not read as printed pages; the labelled volume below is the arabic case
    expect(r.cls).toBe('no-locator');
    const v2 = prepareVolume({ work: 'x', pages: [{ p: 31, print: '9', text: 'The words stand here and nowhere else in the book.' }], paras: [] });
    expect(matchQuote(v2, 'The words stand here and nowhere else', 'p. 9')).toMatchObject({ cls: 'printed-only', pdfPages: [31] });
  });
  it('resolves a ¶-only cite through the ¶ anchors', () => {
    expect(matchQuote(vol, 'A voice said, “That is art.”', '¶5').cls).toBe('exact');
    expect(matchQuote(vol, 'A voice said, “That is art.”', '¶6').cls).toBe('wrong-page-elsewhere');
    expect(matchQuote(vol, 'A voice said, “That is art.”', '¶99')).toMatchObject({ cls: 'locator-unresolved', foundPdf: 11 });
  });
  it('names the page of a quotation cited one page off, and further off', () => {
    expect(matchQuote(vol, 'A voice said, “That is art.”', 'pdf p10')).toMatchObject({ cls: 'wrong-page-adjacent', foundPdf: 11, delta: 1 });
    expect(matchQuote(vol, 'A voice said, “That is art.”', 'pdf p14')).toMatchObject({ cls: 'wrong-page-elsewhere', foundPdf: 11, delta: 3 });
  });
  it('accepts a damaged scan’s split word as scan, a trimmed closing as ending-only, other punctuation as letters-only', () => {
    expect(matchQuote(vol, 'the shore The psychoid form stayed as it was', 'pdf p12').cls).toBe('scan');
    expect(matchQuote(vol, 'A voice said, “That is art.” Then it fell silent for a long while', 'pdf p11').cls).toBe('exact');
    expect(matchQuote(vol, 'The rolling sea came in and went out.', 'pdf p12').cls).toBe('ending-only');
    expect(matchQuote(vol, 'The rolling sea came in, and went out; the shore', 'pdf p12').cls).toBe('letters-only');
  });
  it('fails words that stand nowhere, and a cite that names no page', () => {
    expect(matchQuote(vol, 'A sword or a pistol stood by the door of the room', 'pdf p11').cls).toBe('not-verbatim');
    expect(matchQuote(vol, 'A voice said, “That is art.”', 'in the second lecture')).toMatchObject({ cls: 'no-locator', foundPdf: 11 });
  });
});

describe('matchQuote: the furniture a scan puts inside a quotation (running heads, folios, footnotes, footnote calls)', () => {
  // pdf 20 ends on a sentence that goes on at the top of pdf 21; between them the scan holds a footnote block and, on 21, a running head
  const book = prepareVolume({
    work: 'bk',
    paras: [],
    pages: [
      { p: 19, print: '1', text: 'An unrelated page that ends here.' },
      {
        p: 20,
        print: '2',
        text: 'The anima stood on the other bank and the dreamer on this one, and they talked to each other about how to\n12 Cf. Aion, p. 14.\n13 See also the letter of 3 May.\nSEMINAR 5\n396',
      },
      { p: 21, print: '3', text: 'SPRING TERM\nbuild a function between them, for the bridge must be made from both sides, not from one side only.' },
      { p: 22, print: '4', text: '3 DECEMBER 1930\nThere is a black Virgin at Einsiedeln, 11 though they say it is black from a fire; and the marble4 was cold, the souls21 slept.' },
      { p: 23, print: '5', text: 'The government of the old world was gov-' },
      { p: 24, print: '6', text: 'WINTER TERM\nernment by the dead, and nothing else. Then a new paragraph begins.' },
    ],
  });
  it('lets a quotation run over a page break past a footnote block and a running head', () => {
    const q = 'the dreamer on this one, and they talked to each other about how to build a function between them, for the bridge must be made from both sides';
    expect(matchQuote(book, q, 'pdf p20')).toMatchObject({ cls: 'scan', scanKind: 'page-break' });
  });
  it('lets a word divided by the page break stand (a hyphen at the foot, the rest after the head)', () => {
    expect(matchQuote(book, 'The government of the old world was government by the dead, and nothing else.', 'pdf p23')).toMatchObject({ cls: 'scan', scanKind: 'page-break' });
  });
  it('does not bridge a quotation that joins two places that are not a page break', () => {
    // the first half is on p20, the second half is on p21, but not at its head: a line of the page's own text lies between
    const q = 'the dreamer on this one, and they talked to each other about how to not from one side only.';
    expect(matchQuote(book, q, 'pdf p20').cls).not.toBe('scan');
    // a changed word is still not verbatim
    expect(matchQuote(book, 'the dreamer on this one, and they talked to each other about how to construct a function between them', 'pdf p20').cls).toBe('not-verbatim');
  });
  it('does not bridge to a page that is not next', () => {
    expect(matchQuote(book, 'the dreamer on this one, and they talked to each other about how to build a function between them', 'pdf p19').cls).not.toBe('scan');
  });
  it('lets a footnote call stand in the page and not in the quotation', () => {
    expect(matchQuote(book, 'There is a black Virgin at Einsiedeln, though they say it is black from a fire', 'pdf p22')).toMatchObject({ cls: 'scan', scanKind: 'notes' });
    expect(matchQuote(book, 'and the marble was cold, the souls slept.', 'pdf p22')).toMatchObject({ cls: 'scan', scanKind: 'notes' });
  });
  it('lets a footnote call after a capitalised name stand in the page and not in the quotation', () => {
    const v = prepareVolume({ work: 'x', pages: [{ p: 5, print: '1', text: 'the drawings of Opicinus de Canistris 40 afford us an interesting glimpse of the way in which it was used' }], paras: [] });
    expect(matchQuote(v, 'the drawings of Opicinus de Canistris afford us an interesting glimpse of the way', 'pdf p5')).toMatchObject({ cls: 'scan', scanKind: 'notes' });
    const w = prepareVolume({ work: 'x', pages: [{ p: 5, print: '1', text: 'the farmers in that valley had 12 sons and a great many more daughters than anyone' }], paras: [] });
    expect(matchQuote(w, 'the farmers in that valley had sons and a great many more daughters than anyone', 'pdf p5').cls).not.toBe('scan');
  });
  it('lets a footnote call and a split word stand together in the page (the scan: "Magdeburg 39-approached", "s ublimated")', () => {
    const v = prepareVolume({ work: 'x', pages: [{ p: 7, print: '1', text: 'the image of the hieros gamos was s ublimated on a lofty plane, as for instance with Mechthild of\nMagdeburg \n39-approached the physical sphere in emotional intensity' }], paras: [] });
    expect(matchQuote(v, 'the image of the hieros gamos was sublimated on a lofty plane, as for instance with Mechthild of Magdeburg-approached the physical sphere', 'pdf p7')).toMatchObject({ cls: 'scan', scanKind: 'notes+spacing' });
  });
  it('lets the page break fall inside the first words of the quotation ("His" at the foot, "death induces" after the head)', () => {
    const v = prepareVolume({ work: 'x', pages: [
      { p: 30, print: '1', text: 'The only one she really loves is the young man Tammuz, mentioned earlier. His\nSEMINAR ON CHILDREN’S DREAMS, 1936/37' },
      { p: 31, print: '2', text: 'death induces her to go on a journey through the underworld. In doing so, she falls into the hands of Ereshkigal.' },
    ], paras: [] });
    expect(matchQuote(v, 'His death induces her to go on a journey through the underworld. In doing so, she falls into the hands of Ereshkigal.', 'pdf pp30-31')).toMatchObject({ cls: 'scan', scanKind: 'page-break' });
  });
  it('bridges each fragment of an ellipsis quotation across a footnote block and a running head', () => {
    const v = prepareVolume({ work: 'x', pages: [
      { p: 40, print: '1', text: 'It demanded the sacrifice) from among a great crowd of peoPle) of a young man) who obeyed this demand. The dream was repeated a little later, but this time the snake\n57 Miss X was referring to my remarks in an earlier essay.' },
      { p: 41, print: '2', text: 'A STUDY IN THE PROCESS OF INDIVIDUATION\npicked on the dreamer herself. The assembled people regarded her compassionately.' },
    ], paras: [] });
    expect(matchQuote(v, 'It demanded the sacrifice … of a young man … The dream was repeated a little later, but this time the snake picked on the dreamer herself.', 'pdf pp40-41')).toMatchObject({ cls: 'scan', scanKind: 'page-break' });
  });
  it('folds a footnote call the scan reads as letter and digits ("Goddessl86-it"), a doubled opening mark ("\'\'Apage") and a stray middle dot, in the page only', () => {
    const v = prepareVolume({ work: 'x', pages: [{ p: 9, print: '1', text: 'a many-armed bloody Goddessl86-it is Salome desperately wringing her handsl87-it takes hold of me, she is my own soul' }, { p: 10, print: '2', text: "Ammonius exclaims horrified: ''Apage, Satanas!\" The Red One: \"Damned pagan riffraff!\" If one wounds the abdominal region in order to create the · anahata psychology, it is right" }], paras: [] });
    expect(matchQuote(v, 'a many-armed bloody Goddess-it is Salome desperately wringing her hands', 'pdf p9')).toMatchObject({ cls: 'scan', scanKind: 'notes' });
    expect(matchQuote(v, 'Ammonius exclaims horrified: \"Apage, Satanas!\" The Red One: \"Damned pagan riffraff!\"', 'pdf p10')).toMatchObject({ cls: 'scan', scanKind: 'notes' });
    expect(matchQuote(v, 'If one wounds the abdominal region in order to create the anahata psychology, it is right', 'pdf p10')).toMatchObject({ cls: 'scan', scanKind: 'notes' });
  });
  it('folds a caret the scan sets after a word for a footnote mark ("Cabiri^ were"), in the page only', () => {
    const v = prepareVolume({ work: 'x', pages: [{ p: 9, print: '1', text: 'and then the Greek Cabiri^ were adorned with pointed caps. I think it was Pausanias who reported' }], paras: [] });
    expect(matchQuote(v, 'the Greek Cabiri were adorned with pointed caps. I think it was Pausanias', 'pdf p9')).toMatchObject({ cls: 'scan', scanKind: 'notes' });
  });
  it('lets a short last word stand over the page break ("Kundalini" at the foot, "serpent" after the head)', () => {
    const v = prepareVolume({ work: 'x', pages: [
      { p: 50, print: '1', text: 'this ring of mine with the snake engraved on it is two thousand years old; 2 it is the agathodaimon, and it is also the Kundalini\n1 The philosophers’ stone: one of the goals of the alchemical process.' },
      { p: 51, print: '2', text: 'serpent in the mind of the dreamer, and nothing else.' },
    ], paras: [] });
    expect(matchQuote(v, 'this ring of mine with the snake engraved on it is two thousand years old; it is the agathodaimon, and it is also the Kundalini serpent', 'pdf pp50-51')).toMatchObject({ cls: 'scan', scanKind: 'notes+page-break' });
  });
  it('lets a footnote call that the layout sets on a line of its own stand in the page, not in the quotation', () => {
    const v = prepareVolume({ work: 'x', pages: [{ p: 9, print: '1', text: 'The worst case was the prophet Hosea, \n1 \nwho married a prostitute as a symbolic act because the Lord ordered him to do so' }], paras: [] });
    expect(matchQuote(v, 'The worst case was the prophet Hosea, who married a prostitute as a symbolic act', 'pdf p9')).toMatchObject({ cls: 'scan', scanKind: 'notes' });
  });
  it('folds a lone number between two plain words when the same page opens a footnote line with that number', () => {
    const v = prepareVolume({ work: 'x', pages: [{ p: 9, print: '1', text: 'The churinga 70 of the Australian aborigines is a similar energic concept and the sacred bull-roarer also.\nthe farmers came and 12 men came in with them that day\n70 Spencer and Gillen, Native Tribes of Central Australia.' }], paras: [] });
    expect(matchQuote(v, 'The churinga of the Australian aborigines is a similar energic concept', 'pdf p9')).toMatchObject({ cls: 'scan', scanKind: 'notes' });
    // 12 is not a footnote number on this page (no footnote line opens with it): a quotation that drops it is not matched
    expect(matchQuote(v, 'the farmers came and men came in with them that day', 'pdf p9').cls).not.toBe('scan');
  });
  it('keeps a real number: a quotation that carries a number the page lacks is not lenient', () => {
    expect(matchQuote(book, 'There is a black Virgin at Einsiedeln, 12 though they say it is black', 'pdf p22').cls).not.toBe('scan');
  });
  it('still calls a plain verbatim quotation exact, and a footnote-free break exact', () => {
    expect(matchQuote(book, 'An unrelated page that ends here.', 'pdf p19').cls).toBe('exact');
  });
});

describe('judge: the primary cite is the gate', () => {
  const load = (w: string) => (w === 'tv' ? vol : null);
  it('passes on the primary cite', () => {
    expect(judge({ text: 'A voice said, “That is art.”', cites: [{ work: 'tv', locator: 'pdf p11' }] }, load)).toMatchObject({ cls: 'exact', citeIndex: 0 });
  });
  it('fails other-cite when only a later cite holds the words', () => {
    const r = judge({ text: 'A voice said, “That is art.”', cites: [{ work: 'tv', locator: 'pdf p14' }, { work: 'tv', locator: 'pdf p11' }] }, load);
    expect(r).toMatchObject({ cls: 'other-cite', citeIndex: 1 });
  });
  it('fails no-corpus for a work with no volume', () => {
    expect(judge({ text: 'anything at all here', cites: [{ work: 'liber-novus', locator: 'pdf p5' }] }, load).cls).toBe('no-corpus');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// the gate: exit codes against a synthetic data directory
// ---------------------------------------------------------------------------------------------------------------------

const made: string[] = [];
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function fixtureData(text: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-oracle-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'corpus'));
  fs.writeFileSync(path.join(dir, 'corpus', 'index.json'), JSON.stringify({ works: [{ work: 'tv', title: 'Test Volume', file: 'tv.json', pages: 2, paras: 0, chapters: 0 }] }));
  fs.writeFileSync(path.join(dir, 'corpus', 'tv.json'), JSON.stringify({ work: 'tv', title: 'Test Volume', chapters: [], paras: [], pages: [{ p: 1, text: 'Nothing here.' }, { p: 2, text: 'A voice said, “That is art.” Then it fell silent.' }] }));
  fs.writeFileSync(path.join(dir, 'theory.json'), JSON.stringify({ items: [{ text, cite: { work: 'tv', workTitle: 'Test Volume', locator: 'pdf p2' } }] }));
  return dir;
}
const gate = (data: string, exceptions: unknown) => {
  const exc = path.join(data, 'exceptions.json');
  fs.writeFileSync(exc, JSON.stringify(exceptions));
  return spawnSync('node', [path.join(ROOT, 'scripts/quote-oracle.mjs'), '--check', '--data', data, '--exceptions', exc, '--report', '-'], { encoding: 'utf8' });
};

describe('quote-oracle --check: the gate', () => {
  it('exits 0 when every quotation is verbatim', () => {
    const r = gate(fixtureData('A voice said, “That is art.” Then it fell silent.'), { version: 1, exceptions: [] });
    expect(r.status).toBe(0);
  });
  it('exits non-zero when a failing record is not listed, and 0 once a reviewed exception names it', () => {
    const data = fixtureData('A voice said, “That is a pistol.” Then it fell silent.');
    const red = gate(data, { version: 1, exceptions: [] });
    expect(red.status).toBe(1);
    expect(red.stdout).toContain('not-verbatim');
    const ok = gate(data, { version: 1, exceptions: [{ dataset: 'theory.json', id: 'theory.json#items[0]', reason: 'a reconstruction the owner keeps, labelled' }] });
    expect(ok.status).toBe(0);
  });
  it('exits non-zero for a stale exception (the record now passes) and for an exception with no reason', () => {
    const data = fixtureData('A voice said, “That is art.” Then it fell silent.');
    expect(gate(data, { version: 1, exceptions: [{ dataset: 'theory.json', id: 'theory.json#items[0]', reason: 'was wrong' }] }).status).toBe(1);
    expect(gate(data, { version: 1, exceptions: [{ dataset: 'theory.json', id: 'x' }] }).status).toBe(1);
  });
  it('exits non-zero for a quotation-shaped node that matches no known shape (a new dataset cannot slip by)', () => {
    const data = fixtureData('A voice said, “That is art.” Then it fell silent.');
    fs.writeFileSync(path.join(data, 'newthing.json'), JSON.stringify({ q: [{ quote: 'Something quoted from a book somewhere', locator: 'p. 4' }] }));
    expect(gate(data, { version: 1, exceptions: [] }).status).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// regression: the 13 generated datasets that verify today (plan Q6), against the real published data
// ---------------------------------------------------------------------------------------------------------------------

const EXCEPTIONS_FILE = path.join(ROOT, 'curation/quote-oracle-exceptions.json');

describe('regression: every quotation in the published data is verbatim, or excepted for a reason', () => {
  type Row = { dataset: string; id: string; cls: string; pass: boolean; excepted?: unknown };
  const doc = JSON.parse(fs.readFileSync(EXCEPTIONS_FILE, 'utf8')) as { exceptions: { dataset: string; id: string; reason: string }[] };
  let all: { results: Row[]; unclassified: unknown[]; stale: unknown[] };
  beforeAll(() => { all = runOracle(path.join(ROOT, 'public/data'), { exceptions: doc.exceptions }); }, 60_000);
  it('holds every quotation of every dataset verbatim on its cited pages (the gate is green)', () => {
    const red = all.results.filter((r) => !r.pass && r.excepted === undefined).map((r) => `${r.cls} ${r.dataset} ${r.id}`);
    expect(red).toEqual([]);
  });
  it('checks the whole published data (5,300 quotations and more)', () => {
    expect(all.results.length).toBeGreaterThanOrEqual(5300);
  });
  it('finds every quotation-shaped record in the published data (no unclassified shape)', () => {
    expect(all.unclassified).toEqual([]);
  });
  it('keeps no stale exception, and every exception names what the scan does', () => {
    expect(all.stale).toEqual([]);
    for (const e of doc.exceptions) expect(e.reason, e.id).toMatch(/^damaged scan: .{20,}/);
  });
  it('never lets the exceptions grow: it only shrinks (34 on 30 Oct)', () => {
    expect(doc.exceptions.length).toBeLessThanOrEqual(34);
  });
  it('the seven Pauli-letter records the scan once hid are quotations again: none is demoted, each is verbatim on its page', () => {
    const passed = new Set(all.results.filter((r) => r.pass).map((r) => r.id));
    const field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8'));
    const fixes = JSON.parse(fs.readFileSync(path.join(ROOT, 'curation/quote-fixes.json'), 'utf8')).fixes as Record<string, { demote?: boolean }>;
    expect(Object.entries(fixes).filter(([, f]) => f.demote).map(([id]) => id)).toEqual([]);
    for (const id of ['anima-unknown-woman-diffraction-dream-1955', 'number-aucker-206-306-dream-1954', 'quaternity-preacher-french-formulas-dream-1955', 'quaternity-sommerfeld-h-atom-splitting-dream-1948', 'mandala-pauli-rotation-inquisition-dream-zurich-1946', 'nigredo-secret-laboratory-radioactive-dream-sweden-1954', 'scales-pauli-spindles-scales-dream-zollikon-1950']) {
      const o = field.occurrences.find((x: { id: string }) => x.id === id);
      expect(o?.quote, id).toBeTruthy();
      expect([...passed].some((r) => r.includes(id)), id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// curation/quote-fixes.json: the reviewed override layer, applied in ingest
// ---------------------------------------------------------------------------------------------------------------------

describe('quote-fixes: the reviewed override layer', () => {
  const field = () => ({
    occurrences: [{ id: 'occ-a', quote: 'Old words.', jung: [{ work: 'cw08', workTitle: 'W8', year: '1947', locator: '¶1 (pdf p10)' }, { work: 'cw09ii', workTitle: 'Aion', year: '1951', locator: '¶5 (pdf p20)' }] }],
    families: [{ id: 'fam', definition: { text: 'Old definition.', cite: 'Aion (CW9ii) ¶9' } }],
    archetypes: [{ id: 'arc' }],
    theoretics: [],
  });
  it('is valid, and every fix names its basis', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'curation/quote-fixes.json'), 'utf8'));
    expect(validateQuoteFixes(doc)).toEqual([]);
    for (const [id, fix] of Object.entries(doc.fixes as Record<string, { basis?: string }>)) expect(fix.basis, id).toMatch(/\S/);
  });
  it('corrects the words and the primary cite of an occurrence', () => {
    const f = field();
    const r = applyQuoteFixes(f, { version: 1, fixes: { 'occ-a': { text: 'New words.', locator: '¶1 (pdf p11)', basis: 'cw08 pdf p11, third line' } } });
    expect(r.problems).toEqual([]);
    expect(r.applied).toEqual(['occ-a']);
    expect(f.occurrences[0].quote).toBe('New words.');
    expect(f.occurrences[0].jung[0].locator).toBe('¶1 (pdf p11)');
    expect(f.occurrences[0].jung[1].locator).toBe('¶5 (pdf p20)');
  });
  it('promotes a later cite to primary (the other-cite class)', () => {
    const f = field();
    applyQuoteFixes(f, { version: 1, fixes: { 'occ-a': { primary: 1, basis: 'the words stand on the Aion cite' } } });
    expect(f.occurrences[0].jung.map((c: { work: string }) => c.work)).toEqual(['cw09ii', 'cw08']);
  });
  it('corrects a definition’s words and cite', () => {
    const f = field();
    applyQuoteFixes(f, { version: 1, fixes: { 'family:fam': { text: 'New definition.', cite: 'Aion (CW9ii) ¶10 (pdf p31)', basis: 'cw09ii pdf p31' } } });
    expect(f.families[0].definition).toEqual({ text: 'New definition.', cite: 'Aion (CW9ii) ¶10 (pdf p31)' });
  });
  it('demotes a record: the record stays with its body and cite, its quote is not published, and the oracle has nothing to ask of it', () => {
    const f = field();
    const r = applyQuoteFixes(f, { version: 1, fixes: { 'occ-a': { demote: true, basis: 'no corpus page carries these words; the record retells the passage' }, 'family:fam': { demote: true, basis: 'the definition paraphrases the cited page' } } });
    expect(r.problems).toEqual([]);
    expect(r.applied).toEqual(['occ-a', 'family:fam']);
    expect(f.occurrences[0].id).toBe('occ-a');
    expect(f.occurrences[0]).not.toHaveProperty('quote');
    expect(f.occurrences[0]).not.toHaveProperty('quoteKind');
    expect(f.families[0]).not.toHaveProperty('definition');
  });
  it('refuses a demotion that also changes words, or a demotion that is not true', () => {
    expect(validateQuoteFixes({ version: 1, fixes: { a: { demote: true, text: 'x', basis: 'b' } } })).toEqual(['a: a demotion changes nothing else']);
    expect(validateQuoteFixes({ version: 1, fixes: { a: { demote: false, basis: 'b' } } })).toEqual(['a: "demote" must be true']);
  });
  it('refuses a fix with no basis, an unknown field, a stale id, or a change that changes nothing', () => {
    expect(validateQuoteFixes({ version: 1, fixes: { a: { text: 'x' } } })).toEqual(['a: a "basis" line is required']);
    expect(validateQuoteFixes({ version: 1, fixes: { a: { text: 'x', basis: 'b', colour: 'red' } } })).toEqual(['a: unknown field "colour"']);
    expect(validateQuoteFixes({ version: 1, fixes: { a: { basis: 'b' } } })).toEqual(['a: the fix changes nothing']);
    const r = applyQuoteFixes(field(), { version: 1, fixes: { 'occ-zzz': { text: 'x', basis: 'b' } } });
    expect(r.problems).toEqual(['occ-zzz: no such record (a stale fix)']);
  });
});
