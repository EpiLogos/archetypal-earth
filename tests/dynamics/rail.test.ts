// The dynamical lens's data rail (scripts/lib/dynamics.mjs, scripts/dynamics.mjs), tested against a TEMPORARY FAKE
// corpus built here. No test reads the vault: every vault path below is a directory this file creates.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
// @ts-expect-error Plain ESM rail, shared with the CLI.
import { buildFromVault, matchQuotation, parseCorpusPages, validateCuration } from '../../scripts/lib/dynamics.mjs';
// @ts-expect-error Plain ESM generator, shared with the CLI.
import { generateDynamics } from '../../scripts/dynamics.mjs';
import { parseDynamics } from '../../src/dynamics/load';

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// Synthetic text, invented for this test: it is not any author's words.
const VEE_TEXT = [
  '<!-- fakevee · pdf p110 · print p96 -->',
  'FAKE CORPUS: the bounded orbit holds its shape across the page.',
  '',
  '<!-- fakevee · pdf p111 · print p97 -->',
  'FAKE CORPUS: a second invented sentence, unrelated to the first.',
  '',
  '<!-- fakevee · pdf p112 -->',
  'FAKE CORPUS: a page without any printed label, in invented words here.',
  '',
].join('\n');
const JUNG_TEXT = [
  '<!-- fakejung · pdf p40 -->',
  'FAKE JUNG: the spirit answers to the instinct as a fish to the water.',
  '',
].join('\n');
const VEE2_TEXT = [
  '<!-- fakevee2 · pdf p7 · print p3 -->',
  'FAKE SECOND: a bounded passage from another volume, invented here.',
  '',
].join('\n');
const VEE2_MATCH = 'FAKE SECOND: a bounded passage from another volume, invented here.';
const VEE_MATCH = 'FAKE CORPUS: the bounded orbit holds its shape across the page.';
const JUNG_MATCH = 'FAKE JUNG: the spirit answers to the instinct as a fish to the water.';

let tmp: string;
let vault: string;
let root: string;
let families: Set<string>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyn-rail-'));
  vault = path.join(tmp, 'vault');
  root = path.join(tmp, 'site');
  fs.mkdirSync(path.join(vault, 'corpus'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'corpus/fakevee.md'), VEE_TEXT);
  fs.writeFileSync(path.join(vault, 'corpus/fakejung.md'), JUNG_TEXT);
  fs.writeFileSync(path.join(vault, 'corpus/fakevee2.md'), VEE2_TEXT);
  fs.mkdirSync(path.join(root, 'curation'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public/data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/data/field.json'), JSON.stringify({ families: [{ id: 'serpent' }, { id: 'tree' }] }));
  families = new Set(['serpent', 'tree']);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A curation over the fake corpus. Each test edits a copy, never the shared object. */
function curation(over: Record<string, unknown> = {}, concept: Record<string, unknown> = {}) {
  const base = {
    id: 'bounded-orbit',
    name: 'Bounded orbit',
    familyIds: ['serpent'],
    quote: { work: 'fakevee', page: 110, locator: 'p. 96', match: VEE_MATCH },
    jung: { work: 'fakejung', page: 40, locator: '¶1 (pdf p40)', match: JUNG_MATCH },
    render: 'lorenz',
  };
  return {
    version: 1,
    source: { work: 'Archetypes & Strange Attractors', author: 'John R. Van Eenwyk', year: '1997' },
    sources: {
      fakevee: { file: 'corpus/fakevee.md', sha256: sha(VEE_TEXT), title: 'Archetypes & Strange Attractors', year: '1997', voice: 'V' },
      fakejung: { file: 'corpus/fakejung.md', sha256: sha(JUNG_TEXT), title: 'Fake Jung', year: '1951', voice: 'J' },
    },
    concepts: [{ ...base, ...concept }],
    ...over,
  };
}

describe('the verbatim rail', () => {
  it('a verbatim match passes, and the output has the published shape', () => {
    const { data, errors } = buildFromVault(curation(), { families, vault });
    expect(errors).toEqual([]);
    expect(data.concepts[0].quote.text).toBe(VEE_MATCH);
    expect(data.concepts[0].quote.cite).toEqual({ workTitle: 'Archetypes & Strange Attractors', year: '1997', locator: 'p. 96' });
    expect(data.concepts[0].jung.cite).toEqual({ work: 'fakejung', workTitle: 'Fake Jung', year: '1951', locator: '¶1 (pdf p40)' });
    expect(data.concepts[0].render).toBe('lorenz');
    // the same contract the site reads: parseDynamics accepts it, and it round-trips
    expect(parseDynamics(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it('a one-word change fails loudly and names the concept', () => {
    const edited = VEE_MATCH.replace('holds', 'holding');
    const { data, errors } = buildFromVault(curation({}, { quote: { work: 'fakevee', page: 110, locator: 'p. 96', match: edited } }), { families, vault });
    expect(data).toBeNull();
    expect(errors.join('\n')).toMatch(/concept bounded-orbit quote: the match is not found verbatim/);
  });

  it('a missing page fails loudly and names the page', () => {
    const { data, errors } = buildFromVault(curation({}, { quote: { work: 'fakevee', page: 999, locator: 'p. 1', match: VEE_MATCH } }), { families, vault });
    expect(data).toBeNull();
    expect(errors.join('\n')).toMatch(/concept bounded-orbit quote: pdf page 999 of fakevee is not in the corpus/);
  });

  it('a corpus file that has changed since curation fails before anything is matched', () => {
    const c = curation();
    c.sources.fakevee.sha256 = sha('something else');
    const { data, errors } = buildFromVault(c, { families, vault });
    expect(data).toBeNull();
    expect(errors.join('\n')).toMatch(/sources\.fakevee: corpus file changed/);
  });

  it('a corpus file that is absent fails loudly', () => {
    const c = curation();
    c.sources.fakevee.file = 'corpus/absent.md';
    const { data, errors } = buildFromVault(c, { families, vault });
    expect(data).toBeNull();
    expect(errors.join('\n')).toMatch(/corpus file unavailable/);
  });

  it('an ambiguous match is refused: it must name one place on the page', () => {
    const twice = 'alpha beta gamma delta epsilon zeta';
    expect(matchQuotation(`${twice} and then ${twice}`, twice).ok).toBe(false);
    expect(matchQuotation(`${twice} and then`, twice).ok).toBe(true);
    expect(matchQuotation(`${twice} and then`, 'not here at all, nowhere').ok).toBe(false);
  });

  it('a quotation must name a source of its own voice: Van Eenwyk never reads as Jung', () => {
    const { errors } = buildFromVault(curation({}, { quote: { work: 'fakejung', page: 40, locator: 'p. 1', match: JUNG_MATCH } }), { families, vault });
    expect(errors.join('\n')).toMatch(/is voice J, not V: a Van Eenwyk quotation must name a voice V source/);
  });

  it('an unresolved family fails the curation', () => {
    const { errors } = buildFromVault(curation({}, { familyIds: ['nope'] }), { families, vault });
    expect(errors.join('\n')).toMatch(/unresolved family nope/);
  });

  it('a misspelt field fails rather than being dropped', () => {
    const { errors } = buildFromVault(curation({}, { quot: {} }), { families, vault });
    expect(errors.join('\n')).toMatch(/unknown field "quot"/);
  });

  it('the match must already be in normalized form, so the curation shows exactly what is published', () => {
    const errors = validateCuration(curation({}, { quote: { work: 'fakevee', page: 110, locator: 'p. 96', match: 'FAKE CORPUS:  the bounded' } }), { families });
    expect(errors.join('\n')).toMatch(/normalized form/);
  });

  it('validation reports a malformed source block without touching the corpus', () => {
    const c = curation();
    c.sources.fakevee.voice = 'X';
    expect(validateCuration(c, { families }).join('\n')).toMatch(/voice must be "V"/);
  });

  it('the corpus parser reads one work and ends a page at another work\'s marker', () => {
    const raw = '<!-- w · pdf p1 -->\nalpha\n<!-- other · pdf p2 -->\nbeta\n<!-- w · pdf p3 · print p2 -->\ngamma\n';
    const { pages, duplicates } = parseCorpusPages(raw, 'w');
    expect([...pages.keys()]).toEqual([1, 3]);
    expect(pages.get(1)).toBe('alpha');
    expect(pages.get(3)).toBe('gamma');
    expect(duplicates).toEqual([]);
    expect(parseCorpusPages('<!-- w · pdf p1 -->\na\n<!-- w · pdf p1 -->\nb\n', 'w').duplicates).toEqual([1]);
  });
});

describe('the rail CLI core: empty curation and the published file', () => {
  it('no concepts curated: nothing is written and no vault is read', () => {
    const r = path.join(tmp, 'empty');
    fs.mkdirSync(path.join(r, 'curation'), { recursive: true });
    fs.mkdirSync(path.join(r, 'public/data'), { recursive: true });
    fs.writeFileSync(path.join(r, 'public/data/field.json'), JSON.stringify({ families: [] }));
    fs.writeFileSync(path.join(r, 'curation/dynamics.json'), JSON.stringify({ ...curation(), sources: {}, concepts: [] }));
    const out = generateDynamics({ root: r, vault: path.join(tmp, 'no-such-vault') });
    expect(out.status).toBe('none');
    expect(out.message).toMatch(/no concepts curated/);
    expect(fs.existsSync(path.join(r, 'public/data/dynamics.json'))).toBe(false);
    expect(generateDynamics({ root: r, vault: path.join(tmp, 'no-such-vault'), check: true }).status).toBe('none');
  });

  it('no concepts curated: an existing published file is left exactly as it is', () => {
    const r = path.join(tmp, 'keep');
    fs.mkdirSync(path.join(r, 'curation'), { recursive: true });
    fs.mkdirSync(path.join(r, 'public/data'), { recursive: true });
    fs.writeFileSync(path.join(r, 'public/data/field.json'), JSON.stringify({ families: [] }));
    fs.writeFileSync(path.join(r, 'curation/dynamics.json'), JSON.stringify({ ...curation(), sources: {}, concepts: [] }));
    fs.writeFileSync(path.join(r, 'public/data/dynamics.json'), 'KEEP');
    const out = generateDynamics({ root: r, vault: path.join(tmp, 'no-such-vault') });
    expect(out.status).toBe('none');
    expect(fs.readFileSync(path.join(r, 'public/data/dynamics.json'), 'utf8')).toBe('KEEP');
    // a stale published file is a failure of --check, never a silent pass
    expect(() => generateDynamics({ root: r, vault: path.join(tmp, 'no-such-vault'), check: true })).toThrow(/remove the published file/);
  });

  it('with concepts: generation writes the file, --check verifies it, and a stale file fails --check', () => {
    const r = path.join(tmp, 'curated');
    fs.mkdirSync(path.join(r, 'curation'), { recursive: true });
    fs.mkdirSync(path.join(r, 'public/data'), { recursive: true });
    fs.writeFileSync(path.join(r, 'public/data/field.json'), JSON.stringify({ families: [{ id: 'serpent' }, { id: 'tree' }] }));
    fs.writeFileSync(path.join(r, 'curation/dynamics.json'), JSON.stringify(curation()));
    const target = path.join(r, 'public/data/dynamics.json');
    const written = generateDynamics({ root: r, vault });
    expect(written.status).toBe('written');
    expect(parseDynamics(JSON.parse(fs.readFileSync(target, 'utf8'))).concepts).toHaveLength(1);
    expect(generateDynamics({ root: r, vault, check: true }).status).toBe('verified');
    fs.writeFileSync(target, '{"version":1,"concepts":[]}\n');
    expect(() => generateDynamics({ root: r, vault, check: true })).toThrow(/differs from the curation/);
  });

  it('a failing curation writes nothing: the published file is only replaced by a verified build', () => {
    const r = path.join(tmp, 'failing');
    fs.mkdirSync(path.join(r, 'curation'), { recursive: true });
    fs.mkdirSync(path.join(r, 'public/data'), { recursive: true });
    fs.writeFileSync(path.join(r, 'public/data/field.json'), JSON.stringify({ families: [{ id: 'serpent' }] }));
    const bad = curation({}, { quote: { work: 'fakevee', page: 110, locator: 'p. 96', match: 'FAKE CORPUS: the bounded orbit holding its shape across the page.' } });
    fs.writeFileSync(path.join(r, 'curation/dynamics.json'), JSON.stringify(bad));
    fs.writeFileSync(path.join(r, 'public/data/dynamics.json'), 'KEEP');
    expect(() => generateDynamics({ root: r, vault })).toThrow(/bounded-orbit quote/);
    expect(fs.readFileSync(path.join(r, 'public/data/dynamics.json'), 'utf8')).toBe('KEEP');
  });
});

// ── adversarial cases: each rail rule refused where it must be, and accepted where it may be ─────────────────────────

describe('adversarial (A): the cite is the matched page, as the corpus marker prints it', () => {
  it('a Van Eenwyk locator that is not the printed page of the matched pdf page is refused', () => {
    const { data, errors } = buildFromVault(curation({}, { quote: { work: 'fakevee', page: 110, locator: 'p. 999', match: VEE_MATCH } }), { families, vault });
    expect(data).toBeNull();
    expect(errors.join('\n')).toMatch(/concept bounded-orbit quote: locator "p\. 999" must be "p\. 96", the printed page of pdf page 110/);
  });

  it('a Van Eenwyk passage on a page with no printed label cannot be cited to a page', () => {
    const { data, errors } = buildFromVault(curation({}, { quote: { work: 'fakevee', page: 112, locator: 'p. 112', match: 'FAKE CORPUS: a page without any printed label, in invented words here.' } }), { families, vault });
    expect(data).toBeNull();
    expect(errors.join('\n')).toMatch(/has no printed page label/);
  });

  it('a Jung locator must name the matched pdf page: another page, or a longer number that contains it, is refused', () => {
    const other = buildFromVault(curation({}, { jung: { work: 'fakejung', page: 40, locator: '¶1 (pdf p41)', match: JUNG_MATCH } }), { families, vault });
    expect(other.errors.join('\n')).toMatch(/must name the matched page \(pdf p40\)/);
    const longer = buildFromVault(curation({}, { jung: { work: 'fakejung', page: 40, locator: '¶1 (pdf p400)', match: JUNG_MATCH } }), { families, vault });
    expect(longer.errors.join('\n')).toMatch(/must name the matched page \(pdf p40\)/);
  });

  it('the printed label is the one the corpus gives: the parser reports it per pdf page', () => {
    const raw = '<!-- w · pdf p1 · print p10 -->\nalpha\n<!-- w · pdf p2 -->\nbeta\n';
    const { labels } = parseCorpusPages(raw, 'w');
    expect(labels.get(1)).toBe('10');
    expect(labels.get(2)).toBeNull();
  });
});

describe('adversarial (B): a match starts and ends at a word, and names at least six words', () => {
  it('a match that begins inside a word is refused, even when it is found verbatim', () => {
    expect(matchQuotation('the strange attractor is the shape of the field', 'ttractor is the shape of the fie').ok).toBe(false);
    expect(matchQuotation('the strange attractor is the shape of the field', 'ttractor is the shape of the fie').reason).toMatch(/inside a word/);
  });

  it('a match that ends inside a word is refused', () => {
    const r = matchQuotation('the strange attractor is the shape of the field', 'attractor is the shape of the fie');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/inside a word/);
  });

  it('a match at word boundaries, of six words or more, is accepted', () => {
    expect(matchQuotation('the strange attractor is the shape of the field', 'attractor is the shape of the field').ok).toBe(true);
    expect(matchQuotation('x alpha beta gamma delta epsilon zeta.', 'alpha beta gamma delta epsilon zeta.').ok).toBe(true);
  });

  it('a single word, or five words, is refused as a match', () => {
    expect(matchQuotation('the strange attractor is the shape of the field', 'attractor').reason).toMatch(/at least 6 words/);
    expect(matchQuotation('the strange attractor is the shape of the field', 'attractor is the shape of').reason).toMatch(/at least 6 words/);
  });

  it('the curation refuses a short match before anything is read', () => {
    const errors = validateCuration(curation({}, { quote: { work: 'fakevee', page: 110, locator: 'p. 96', match: 'FAKE CORPUS: the bounded' } }), { families });
    expect(errors.join('\n')).toMatch(/at least 6 words/);
  });
});

describe('adversarial (C): a line-break hyphen is never de-hyphenated by a guess', () => {
  it('a match that spans a hyphen at a printed line break is refused, with the reason named', () => {
    const r = matchQuotation('the shape re-\npeats across the whole page here.', 'the shape re- peats across the whole page here.');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/spans a hyphen at a printed line break/);
  });

  it('a match that begins after the break publishes the word whole, with no artefact', () => {
    const r = matchQuotation('the shape re-\npeats across the whole page here now.', 'peats across the whole page here now.');
    expect(r.ok).toBe(true);
    expect(r.text).toBe('peats across the whole page here now.');
    expect(r.text).not.toMatch(/- /);
  });

  it('a plain line break (no hyphen) joins to a single space, which is the printed word spacing', () => {
    const r = matchQuotation('the shape\nacross the whole page here now.', 'the shape across the whole page here now.');
    expect(r.ok).toBe(true);
    expect(r.text).toBe('the shape across the whole page here now.');
  });
});

describe('adversarial (D): a Van Eenwyk cite names the source that matched', () => {
  it('a quotation from a second V source is cited to that source, not to the curation source', () => {
    const c = curation();
    (c.sources as Record<string, unknown>).fakevee2 = { file: 'corpus/fakevee2.md', sha256: sha(VEE2_TEXT), title: 'A Second Van Eenwyk Work', year: '2003', voice: 'V' };
    c.concepts[0].quote = { work: 'fakevee2', page: 7, locator: 'p. 3', match: VEE2_MATCH };
    const { data, errors } = buildFromVault(c, { families, vault });
    expect(errors).toEqual([]);
    expect(data.concepts[0].quote.cite).toEqual({ workTitle: 'A Second Van Eenwyk Work', year: '2003', locator: 'p. 3' });
    expect(data.concepts[0].quote.cite.workTitle).not.toBe(c.source.work);
  });
});

describe('adversarial (E): --check with no concepts is never a vacuous pass', () => {
  it('says so explicitly, and writes nothing', () => {
    const r = path.join(tmp, 'vacuous');
    fs.mkdirSync(path.join(r, 'curation'), { recursive: true });
    fs.mkdirSync(path.join(r, 'public/data'), { recursive: true });
    fs.writeFileSync(path.join(r, 'public/data/field.json'), JSON.stringify({ families: [] }));
    fs.writeFileSync(path.join(r, 'curation/dynamics.json'), JSON.stringify({ ...curation(), sources: {}, concepts: [] }));
    const out = generateDynamics({ root: r, vault: path.join(tmp, 'no-such-vault'), check: true });
    expect(out.message).toBe('no concepts curated: nothing to check');
    expect(fs.existsSync(path.join(r, 'public/data/dynamics.json'))).toBe(false);
  });

  it('a published file with no curation behind it fails --check (exit 1 in the CLI)', () => {
    const r = path.join(tmp, 'orphan');
    fs.mkdirSync(path.join(r, 'curation'), { recursive: true });
    fs.mkdirSync(path.join(r, 'public/data'), { recursive: true });
    fs.writeFileSync(path.join(r, 'public/data/field.json'), JSON.stringify({ families: [] }));
    fs.writeFileSync(path.join(r, 'curation/dynamics.json'), JSON.stringify({ ...curation(), sources: {}, concepts: [] }));
    fs.writeFileSync(path.join(r, 'public/data/dynamics.json'), '{"version":1,"concepts":[]}\n');
    expect(() => generateDynamics({ root: r, vault: path.join(tmp, 'no-such-vault'), check: true })).toThrow(/curates no concepts/);
  });
});
