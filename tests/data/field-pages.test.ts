// The field pages (public/data/field-pages.json): a page for a node of the field is built from its curation file, every
// quotation is corpus-placed with a locator and stands verbatim on its cited page, the join cites publish under their join
// id, and the build is deterministic. The real-data checks run only when the build has written the published file.
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error Plain ESM shared with the generators.
import { DEFAULT_VAULT } from '../../scripts/lib/vault.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { LOCATOR, verify, workLoader } from '../../scripts/lib/cite.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { buildFieldPages } from '../../scripts/field-pages.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const FIELD = path.join(ROOT, 'public', 'data', 'field.json');
const CORPUS_INDEX = path.join(ROOT, 'public', 'data', 'corpus', 'index.json');
const REAL = path.join(ROOT, 'public', 'data', 'field-pages.json');
/** The heavy tests load corpus volumes; they get the explicit timeout the repo uses for them, not the 5s default. */
const HEAVY = 120_000;
const load = workLoader(DEFAULT_VAULT);

/** A sentence of CW10 (¶68, pdf p44), copied verbatim from the corpus and placed by the rail before it went in here. */
const AIR_QUOTE = 'The earth he plays with, the fire he warms himself at, the rain and wind that chill him, were always realities, but because of his twilight consciousness they were seen and understood only as qualities of the parents.';
/** A sentence that is not in the corpus anywhere: it must fail to place. */
const UNPLACEABLE = 'This sentence is not in the corpus at all, not in any volume the vault holds.';

/** A one-page family file on `fire`, the reading line and sections shaped as the curation files are. */
const firePage = (over: Record<string, unknown> = {}) => ({
  version: 1,
  type: 'family',
  id: 'fire',
  line: 'Fire here is the warmth the parents tend before the child knows what warms it.',
  sections: [{
    id: 'warmth',
    title: 'The warmth',
    line: 'Fire is first a thing the parents keep, and only later a thing the child can name.',
    quotes: [{ work: 'cw10', quote: AIR_QUOTE }],
  }],
  subjects: [{ type: 'archetype', id: 'child' }],
  ...over,
});

const made: string[] = [];
afterAll(() => {
  for (const root of made) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A temp root holding a copy of the real field.json (with any extra top-level keys) and the real corpus index (for the
 * work titles), plus the files given by their path under the root. Never touches the repo's public/data.
 */
function tempRoot(files: Record<string, unknown>, extraField: Record<string, unknown> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'field-pages-'));
  made.push(root);
  const base = JSON.parse(fs.readFileSync(FIELD, 'utf8'));
  fs.mkdirSync(path.join(root, 'public', 'data', 'corpus'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'data', 'field.json'), JSON.stringify({ ...base, ...extraField }));
  fs.copyFileSync(CORPUS_INDEX, path.join(root, 'public', 'data', 'corpus', 'index.json'));
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(body, null, 1));
  }
  return root;
}

describe('the field pages build', () => {
  it('builds a family page, places its quotation with a locator, and is deterministic', () => {
    const root = tempRoot({ 'curation/field-pages/air-test.json': firePage() });
    const first = buildFieldPages({ root, vault: DEFAULT_VAULT });
    expect(first.errors).toEqual([]);
    const second = buildFieldPages({ root, vault: DEFAULT_VAULT });
    expect(JSON.stringify(second.data)).toBe(JSON.stringify(first.data));

    expect(first.data.version).toBe(1);
    expect(Object.keys(first.data.pages)).toEqual(['family:fire']);
    expect(first.data.joins).toEqual({});
    const page = first.data.pages['family:fire'];
    expect(page.type).toBe('family');
    expect(page.id).toBe('fire');
    expect(page.subjects).toEqual([{ type: 'archetype', id: 'child' }]);
    expect(page.sections.length).toBe(1);
    const q = page.sections[0].quotes[0];
    expect(q.text).toBe(AIR_QUOTE);
    expect(q.cite.work).toBe('cw10');
    expect(q.cite.workTitle).toBeTruthy();
    expect(q.cite.locator).toMatch(LOCATOR);
    expect(verify(load, { work: 'cw10', locator: q.cite.locator, quote: q.text })).toBeNull();
  }, HEAVY);

  it('names an unknown node, an unknown subject and an unplaceable quotation as errors', () => {
    const root = tempRoot({
      'curation/field-pages/nowhere.json': firePage({ type: 'family', id: 'nowhere' }),
      'curation/field-pages/shadow-bad-subject.json': firePage({ type: 'archetype', id: 'shadow', subjects: [{ type: 'family', id: 'not-a-family' }] }),
      'curation/field-pages/child-unplaced.json': firePage({
        type: 'archetype',
        id: 'child',
        sections: [{ id: 's', title: 't', line: 'l', quotes: [{ work: 'cw10', quote: UNPLACEABLE }] }],
      }),
    });
    const { data, errors } = buildFieldPages({ root, vault: DEFAULT_VAULT });
    expect(errors.some((e: string) => e.includes('nowhere') && e.includes('no family nowhere in the field'))).toBe(true);
    expect(errors.some((e: string) => e.includes('no family not-a-family in the field'))).toBe(true);
    expect(errors.some((e: string) => e.includes('archetype:child.s') && e.includes('not found verbatim'))).toBe(true);
    // the unknown node is not published; the unplaceable quotation is never printed as if it had placed
    expect(data.pages['family:nowhere']).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain(UNPLACEABLE);
  }, HEAVY);

  it('names a second page for the same node as an error and keeps the first', () => {
    const root = tempRoot({
      'curation/field-pages/fire-a.json': firePage({ line: 'The first reading of fire, written once.' }),
      'curation/field-pages/fire-b.json': firePage({ line: 'A second reading of the same node.' }),
    });
    const { data, errors } = buildFieldPages({ root, vault: DEFAULT_VAULT });
    expect(errors.some((e: string) => e.includes('fire-b.json') && e.includes('a second page for family:fire'))).toBe(true);
    expect(data.pages['family:fire'].line).toBe('The first reading of fire, written once.');
  }, HEAVY);

  it('places the join cites and publishes them under their join id; an id outside the field is a warning', () => {
    const cite = { work: 'cw10', quote: AIR_QUOTE };
    const root = tempRoot({
      'curation/joins.json': [
        { id: 'j-fire-air', text: 'fire and the air it is fed by', cites: [cite] },
        { id: 'j-not-in-field', text: 'a join the ingest may have dropped', cites: [cite] },
        { id: 'j-no-cites', text: 'a join with nothing placed yet' },
      ],
    }, { joins: [{ id: 'j-fire-air' }] });
    const { data, errors, warnings } = buildFieldPages({ root, vault: DEFAULT_VAULT });
    expect(errors).toEqual([]);
    expect(warnings.some((w: string) => w.includes('j-not-in-field'))).toBe(true);
    expect(warnings.some((w: string) => w.includes('j-fire-air'))).toBe(false);
    expect(Object.keys(data.joins)).toEqual(['j-fire-air', 'j-not-in-field']);
    expect(data.joins['j-no-cites']).toBeUndefined();
    const q = data.joins['j-fire-air'][0];
    expect(q.text).toBe(AIR_QUOTE);
    expect(q.cite.work).toBe('cw10');
    expect(q.cite.locator).toMatch(LOCATOR);
    expect(verify(load, { work: 'cw10', locator: q.cite.locator, quote: q.text })).toBeNull();
  }, HEAVY);

  it('names a join cite that will not place as an error', () => {
    const root = tempRoot({
      'curation/joins.json': [{ id: 'j-bad', text: 'x', cites: [{ work: 'cw10', quote: UNPLACEABLE }] }],
    }, { joins: [{ id: 'j-bad' }] });
    const { errors } = buildFieldPages({ root, vault: DEFAULT_VAULT });
    expect(errors.some((e: string) => e.includes('join j-bad') && e.includes('not found verbatim'))).toBe(true);
  }, HEAVY);

  it('a missing field-pages directory and a missing joins file give empty output without an error', () => {
    const root = tempRoot({});
    const { data, errors, warnings } = buildFieldPages({ root, vault: DEFAULT_VAULT });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(data).toEqual({ version: 1, pages: {}, joins: {} });
  });
});

// The published file exists only after the build has written it (npm run field-pages). Until then these checks are
// skipped, and the skip says why; once it exists they hold every quotation to its cited page.
const real = fs.existsSync(REAL);
const realReason = 'public/data/field-pages.json is absent (npm run field-pages writes it)';

const suite = real ? describe : describe.skip;
suite(real ? 'the published field pages' : `the published field pages (skipped: ${realReason})`, () => {
  it('every quotation of the published file re-verifies verbatim on its cited page', () => {
    const data = JSON.parse(fs.readFileSync(REAL, 'utf8'));
    const cites = [
      ...Object.values(data.pages as Record<string, { sections: { quotes: { text: string; cite: { work: string; locator: string } }[] }[] }>)
        .flatMap((p) => p.sections.flatMap((s) => s.quotes)),
      ...Object.values(data.joins as Record<string, { text: string; cite: { work: string; locator: string } }[]>).flat(),
    ];
    const failures = cites.map((q) => verify(load, { work: q.cite.work, locator: q.cite.locator, quote: q.text })).filter(Boolean);
    expect(failures).toEqual([]);
  }, HEAVY);

  it('the published file is what the sources give now (no hand edits)', () => {
    const data = JSON.parse(fs.readFileSync(REAL, 'utf8'));
    const built = buildFieldPages({ vault: DEFAULT_VAULT });
    expect(built.errors).toEqual([]);
    expect(data).toEqual(built.data);
  }, HEAVY);
});

