import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain ESM script
import { validateField } from '../../scripts/validate.mjs';
import { buildModel, joinsOf } from '../../src/data/model';
import type { Field, Join } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const INGEST = path.join(ROOT, 'scripts', 'ingest.mjs');
const base: Field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'field.json'), 'utf8'));
const famId = base.families[0].id;
const theoId = base.theoretics[0].id;

const join = (over: Partial<Join> & { id: string }): Join => ({
  a: { type: 'family', id: famId },
  b: { type: 'archetype', id: 'self' },
  basis: 'site',
  note: 'A plain sentence about the two ends.',
  ...over,
});

function withJoins(joins: unknown[]): Field {
  const f: Field = JSON.parse(JSON.stringify(base));
  f.joins = joins as Join[];
  f.meta.counts.joins = joins.length;
  return f;
}

describe('joins: validator', () => {
  it('accepts a good field with joins (system and voice optional)', () => {
    const good = [
      join({ id: 'fam-self' }),
      join({ id: 'self-theo', a: { type: 'archetype', id: 'self' }, b: { type: 'theoretic', id: theoId }, basis: 'jung', system: 'thoth', voice: 'Crowley' }),
    ];
    expect(validateField(withJoins(good))).toEqual([]);
  });

  it('accepts a field with no joins key at all (older files)', () => {
    expect(validateField(JSON.parse(JSON.stringify(base)))).toEqual([]);
  });

  it('reports each bad shape', () => {
    const cases: [string, unknown[], string][] = [
      ['unknown endpoint', [join({ id: 'bad-end', b: { type: 'archetype', id: 'no-such-archetype' } })], 'unresolved'],
      ['self-join', [join({ id: 'self-join', b: { type: 'family', id: famId } })], 'self-join'],
      ['bad basis', [{ ...join({ id: 'bad-basis' }), basis: 'vibes' }], 'basis vibes'],
      ['duplicate id', [join({ id: 'dup' }), join({ id: 'dup', b: { type: 'theoretic', id: theoId } })], 'duplicate id'],
      ['bad endpoint type', [{ ...join({ id: 'bad-type' }), a: { type: 'culture', id: 'latin' } }], 'endpoint type culture'],
      ['wikilink in note', [join({ id: 'wiki', note: 'See [[self]] here.' })], 'wikilink'],
      ['note too long', [join({ id: 'long', note: 'x'.repeat(401) })], 'over 400'],
      ['id not kebab-case', [join({ id: 'Not_Kebab' })], 'kebab-case'],
    ];
    for (const [label, joins, needle] of cases) {
      const errs: string[] = validateField(withJoins(joins));
      expect(errs.some((e) => e.includes(needle)), `${label}: ${errs.join(' | ')}`).toBe(true);
    }
  }, 120_000);
});

describe('joins: joinsOf', () => {
  const j1 = join({ id: 'fam-self', system: 'thoth' });
  const j2 = join({ id: 'self-theo', a: { type: 'archetype', id: 'self' }, b: { type: 'theoretic', id: theoId }, basis: 'jung' });
  const m = buildModel(withJoins([j1, j2]));

  it('returns the far end from either direction, jung before site', () => {
    const fromSelf = joinsOf(m, { type: 'archetype', id: 'self' });
    expect(fromSelf.map((x) => x.join.id)).toEqual(['self-theo', 'fam-self']);
    expect(fromSelf.map((x) => x.other)).toEqual([
      { type: 'theoretic', id: theoId },
      { type: 'family', id: famId },
    ]);
    const fromFam = joinsOf(m, { type: 'family', id: famId });
    expect(fromFam).toHaveLength(1);
    expect(fromFam[0].join.id).toBe('fam-self');
    expect(fromFam[0].other).toEqual({ type: 'archetype', id: 'self' });
    const fromTheo = joinsOf(m, { type: 'theoretic', id: theoId });
    expect(fromTheo.map((x) => x.other)).toEqual([{ type: 'archetype', id: 'self' }]);
  });

  it('is empty for a node with no joins', () => {
    expect(joinsOf(m, { type: 'archetype', id: 'no-such-archetype' })).toEqual([]);
  });
});

describe('joins: ingest over a temp copy of curation/', () => {
  let tmp = '';
  let cur = '';
  let imagesJson = ''; // a snapshot: the image lane rewrites public/data/images.json while suites run
  const VALID = {
    id: 'zz-test-self',
    a: { type: 'family', id: 'zz-test-family' },
    b: { type: 'archetype', id: 'self' },
    basis: 'site',
    note: 'A test join between the synthesised family and the Self.',
    system: 'test',
    voice: 'Test',
  };
  const INVALID = {
    id: 'zz-test-bad',
    a: { type: 'family', id: 'zz-test-family' },
    b: { type: 'archetype', id: 'no-such-archetype' },
    basis: 'site',
    note: 'This end does not resolve, so it must be dropped.',
  };

  const run = (outDir: string, generatedAt: string) =>
    execFileSync('node', [INGEST], {
      cwd: ROOT,
      env: { ...process.env, CURATION_DIR: cur, IMAGES_JSON: imagesJson, FIELD_OUT_DIR: outDir, FIELD_GENERATED_AT: generatedAt },
      encoding: 'utf8',
      timeout: 300_000, // one full ingest takes ~50s alone; under the parallel vitest load it has run past 120s
      stdio: 'pipe',
    });

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-joins-'));
    cur = path.join(tmp, 'curation');
    fs.cpSync(path.join(ROOT, 'curation'), cur, { recursive: true });
    imagesJson = path.join(tmp, 'images.json');
    fs.copyFileSync(path.join(ROOT, 'public', 'data', 'images.json'), imagesJson);
    const famsPath = path.join(cur, 'families.json');
    const fams = JSON.parse(fs.readFileSync(famsPath, 'utf8'));
    // the real curation now carries synthesised families of its own: the fixture isolates the one under test
    for (const [k, v] of Object.entries(fams.families as Record<string, { synthesised?: boolean }>)) if (v?.synthesised) delete fams.families[k];
    fams.families['zz-test-family'] = {
      synthesised: true,
      name: 'Zz test family',
      subtype: 'figure',
      oneLine: 'A family that exists only in curation, for the test.',
    };
    fs.writeFileSync(famsPath, JSON.stringify(fams, null, 2));
    const tiesPath = path.join(cur, 'family-ties.json');
    const ties = JSON.parse(fs.readFileSync(tiesPath, 'utf8'));
    ties.ties['zz-test-family'] = [{ archetype: 'self', basis: 'site' }];
    fs.writeFileSync(tiesPath, JSON.stringify(ties, null, 2));
    fs.writeFileSync(path.join(cur, 'joins.json'), JSON.stringify({ _note: 'test fixture', joins: [VALID, INVALID] }, null, 2));
  });

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('admits the curation family, keeps the valid join, drops and counts the invalid one, and is deterministic', () => {
    const out1 = path.join(tmp, 'out1');
    const out2 = path.join(tmp, 'out2');
    run(out1, '2026-01-01T00:00:00.000Z');
    const field: Field = JSON.parse(fs.readFileSync(path.join(out1, 'field.json'), 'utf8'));
    const stats = JSON.parse(fs.readFileSync(path.join(out1, 'field.stats.json'), 'utf8'));

    const fam = field.families.find((f) => f.id === 'zz-test-family');
    expect(fam).toBeDefined();
    expect(fam!.synthesised).toBe(true);
    expect(fam!.occurrenceIds).toEqual([]);
    expect(fam!.archetypes).toEqual([{ id: 'self', basis: 'site' }]);

    expect(field.joins).toEqual([
      { id: 'zz-test-self', a: VALID.a, b: VALID.b, basis: 'site', note: VALID.note, system: 'test', voice: 'Test' },
    ]);
    expect(field.meta.counts.joins).toBe(1);
    expect(stats.joins).toBe(1);
    expect(stats.joinsDropped).toBe(1);
    expect(stats.curationFamilies).toEqual(['zz-test-family']);

    // a second run with a different clock differs only in meta.generatedAt
    run(out2, '2026-01-02T00:00:00.000Z');
    const t1 = fs.readFileSync(path.join(out1, 'field.json'), 'utf8');
    const t2 = fs.readFileSync(path.join(out2, 'field.json'), 'utf8');
    expect(t1).toContain('"generatedAt":"2026-01-01T00:00:00.000Z"');
    expect(t2).toContain('"generatedAt":"2026-01-02T00:00:00.000Z"');
    expect(t1.replace(/"generatedAt":"[^"]*",/, '')).toBe(t2.replace(/"generatedAt":"[^"]*",/, ''));
  }, 600_000);
});
