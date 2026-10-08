import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain ESM script
import { stripLinks, linkTargets, parseFm, splitFrontmatter } from '../../scripts/lib/vault.mjs';
// @ts-expect-error plain ESM script
import { shortLabel, parseInstanceBody, plain, oneLineFromForm } from '../../scripts/lib/text.mjs';
// @ts-expect-error plain ESM script
import { loadGazetteer, matchPlace, jitter, normCultureSlug } from '../../scripts/lib/geo.mjs';
// @ts-expect-error plain ESM script
import { validateField } from '../../scripts/validate.mjs';

const ROOT = path.resolve(__dirname, '..', '..');

describe('wikilink handling', () => {
  it('strips [[x|y]], [[x]] and triple-bracket typos', () => {
    expect(stripLinks('see [[a|Alpha]] and [[b]] and [[[c]] done')).toBe('see Alpha and b and c done');
    expect(plain('The [[serpent]] **bites** its tail')).toBe('The serpent bites its tail');
  });
  it('extracts link targets from quoted, unquoted and nested forms', () => {
    expect(linkTargets('[[self]], [[shadow]]')).toEqual(['self', 'shadow']);
    expect(linkTargets([['lumen naturae']])).toEqual(['lumen-naturae']);
    expect(linkTargets('[[a|b]]')).toEqual(['a']);
  });
});

describe('defensive frontmatter', () => {
  it('repairs malformed YAML field by field', () => {
    const raw = '---\ntitle: "ok"\nco_manifests: [[a]], [[b]]\nyear_int: 12\nculture: [x, y]\n---\nbody';
    const { fm } = splitFrontmatter(raw);
    const r = parseFm(fm);
    expect(r.data.title).toBe('ok');
    expect(r.data.year_int).toBe(12);
    expect(linkTargets(r.data.co_manifests)).toEqual(['a', 'b']);
  });
});

describe('labels and text', () => {
  const titles = [
    'Ouroboros with \'hen to pan\' inscription — Codex Marcianus',
    'Case Z — the \'unknown woman\' dream series: eleven transformations of the anima',
    'Horridas nostrae mentis purga tenebras, accende lumen sensibus, and further words that run on',
    'A very very very very very very very very very very long unbroken title with no separators at all',
    'Short',
  ];
  it('keeps labels <= 48 chars, non-empty and without dangling stop words', () => {
    for (const t of titles) {
      const l = shortLabel(t);
      expect(l.length).toBeGreaterThan(0);
      expect(l.length).toBeLessThanOrEqual(48);
      expect(l).not.toMatch(/\b(the|a|of|and|to|in)…$/i);
    }
    expect(shortLabel(titles[0])).toMatch(/^Ouroboros with/);
    expect(shortLabel('Short title stays as is')).toBe('Short title stays as is');
  });
  it('pulls the first quote and parallels out of an instance body', () => {
    const p = parseInstanceBody('Para one with [[x|a link]].\n\n> "A verbatim line." (cw12 ¶5, pdf p9)\n\nParallels: [[one-a]] · [[two-b]].\n');
    expect(p.quote).toBe('A verbatim line.');
    expect(p.parallels).toEqual(['one-a', 'two-b']);
    expect(p.body).toEqual(['Para one with a link.']);
  });
  it('derives a one-liner from a Form line within 90 chars', () => {
    const o = oneLineFromForm('---\nForm: the stone that kills and quickens; a long tail follows here with plenty of words that must be trimmed away.');
    expect(o === null || o.length <= 90).toBe(true);
  });
});

describe('geocoding', () => {
  const gaz = loadGazetteer(path.join(ROOT, 'curation', 'gazetteer.json'));
  it('longest match wins within a precision tier, places beat regions', () => {
    expect(matchPlace('Zurich (Burghölzli)', gaz).key).toBe('burgholzli');
    expect(matchPlace('Europe (Basel)', gaz).key).toBe('basel');
    expect(matchPlace('Frankfurt (print)', gaz).precision).toBe('place');
    expect(matchPlace('Germany', gaz).precision).toBe('region');
  });
  it('matches on word boundaries only', () => {
    expect(matchPlace('Codex Parisinus Latinus', gaz)?.key).not.toBe('paris');
    expect(matchPlace('nowhere in particular', gaz)).toBeNull();
  });
  it('jitter is deterministic and bounded', () => {
    const a = jitter('some-id', 47.37, 8.54, 0.08);
    const b = jitter('some-id', 47.37, 8.54, 0.08);
    expect(a).toEqual(b);
    expect(Math.abs(a[0] - 47.37)).toBeLessThanOrEqual(0.0801);
    expect(jitter('other-id', 47.37, 8.54, 0.08)).not.toEqual(a);
  });
  it('normalises culture slugs', () => {
    const aliases = { paracelsan: 'paracelsian', judaic: 'jewish' };
    expect(normCultureSlug("'christian'", aliases)).toBe('christian');
    expect(normCultureSlug('Paracelsan', aliases)).toBe('paracelsian');
    expect(normCultureSlug('judaic', aliases)).toBe('jewish');
  });
});

describe('validator', () => {
  it('rejects a broken field loudly', () => {
    const f = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'field.json'), 'utf8'));
    f.occurrences[0].familyId = 'does-not-exist';
    f.occurrences[0].title = 'leaks [[a wikilink]]';
    f.families[0].palette.core = 'red';
    f.families[0].archetypes = [];
    const errs = validateField(f);
    expect(errs.some((e: string) => e.includes('familyId'))).toBe(true);
    expect(errs.some((e: string) => e.includes('wikilink'))).toBe(true);
    expect(errs.some((e: string) => e.includes('palette'))).toBe(true);
    expect(errs.some((e: string) => e.includes('archetype tie'))).toBe(true);
  });
});

describe('ingest', () => {
  it('is deterministic: same vault and clock give byte-identical output', () => {
    const run = (dir: string) => {
      const r = spawnSync('node', [path.join(ROOT, 'scripts', 'ingest.mjs')], { env: { ...process.env, FIELD_OUT_DIR: dir, FIELD_GENERATED_AT: '2026-01-01T00:00:00.000Z' }, encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      return fs.readFileSync(path.join(dir, 'field.json'), 'utf8');
    };
    const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-a-'));
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-b-'));
    expect(run(d1)).toBe(run(d2));
  }, 60_000);
});
