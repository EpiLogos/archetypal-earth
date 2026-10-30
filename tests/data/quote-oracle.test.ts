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

const GREEN = ['theory-pages.json', 'field-pages.json', 'theory.json', 'alchemy.json', 'numbers.json', 'astrology.json', 'practice.json', 'aionbook.json', 'depth.json', 'dynamics-route.json', 'sky-cards.json', 'history.json', 'sky.json'];
// The only three records of those datasets the oracle holds red, found by the 30 Oct measurement. The build's own verifier accepts
// them; the oracle is stricter: two close on a period where the cited sentence goes on ("…not individual but universal."), and one
// joins a section heading to a sentence that begins on the next page. They can be fixed (never added to): the list only shrinks.
const KNOWN_RESIDUE = new Set([
  'field-pages.json#pages.family:quintessence.sections[3].quotes[1]',
  'theory-pages.json#pages.archetype-as-such.sections[0].quotes[2]',
  'theory-pages.json#pages.collective-unconscious.sections[0].quotes[0]',
]);

describe('regression: the datasets that verify today keep verifying', () => {
  type Row = { dataset: string; id: string; cls: string; pass: boolean };
  let all: { results: Row[]; unclassified: unknown[] };
  beforeAll(() => { all = runOracle(path.join(ROOT, 'public/data')); }, 60_000);
  it('holds at least 3,208 of the 3,211 quotations of the 13 datasets verbatim on their cited pages', () => {
    const green = all.results.filter((r) => GREEN.includes(r.dataset));
    expect(green.length).toBeGreaterThanOrEqual(3211);
    expect(green.filter((r) => r.pass).length).toBeGreaterThanOrEqual(3208);
  });
  it('fails no quotation of those datasets beyond the three known', () => {
    const bad = all.results.filter((r) => GREEN.includes(r.dataset) && !r.pass && !KNOWN_RESIDUE.has(r.id)).map((r) => `${r.cls} ${r.id}`);
    expect(bad).toEqual([]);
  });
  it('finds every quotation-shaped record in the published data (no unclassified shape)', () => {
    expect(all.unclassified).toEqual([]);
  });
  it('does not let field.json get worse than the 30 Oct baseline (it is still being repaired; this is a ceiling, not a target)', () => {
    const failing = (ds: string) => all.results.filter((r) => r.dataset === ds && !r.pass).length;
    expect(failing('field.json#occurrences')).toBeLessThanOrEqual(317);
    expect(failing('field.json#definitions')).toBeLessThanOrEqual(35);
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
  it('is valid empty today', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'curation/quote-fixes.json'), 'utf8'));
    expect(validateQuoteFixes(doc)).toEqual([]);
    expect(doc.fixes).toEqual({});
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
  it('refuses a fix with no basis, an unknown field, a stale id, or a change that changes nothing', () => {
    expect(validateQuoteFixes({ version: 1, fixes: { a: { text: 'x' } } })).toEqual(['a: a "basis" line is required']);
    expect(validateQuoteFixes({ version: 1, fixes: { a: { text: 'x', basis: 'b', colour: 'red' } } })).toEqual(['a: unknown field "colour"']);
    expect(validateQuoteFixes({ version: 1, fixes: { a: { basis: 'b' } } })).toEqual(['a: the fix changes nothing']);
    const r = applyQuoteFixes(field(), { version: 1, fixes: { 'occ-zzz': { text: 'x', basis: 'b' } } });
    expect(r.problems).toEqual(['occ-zzz: no such record (a stale fix)']);
  });
});
