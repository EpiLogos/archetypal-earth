import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ESM scripts
import { buildVocab, createNormalizer, visitFieldText } from '../../scripts/lib/ocr.mjs';
// @ts-expect-error plain ESM scripts
import { DEFAULT_VAULT } from '../../scripts/lib/vault.mjs';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const VAULT = process.env.VAULT || DEFAULT_VAULT;
const CACHE = path.join(ROOT, '.cache');
const haveVocab = fs.existsSync(path.join(CACHE, 'ocr-vocab.json')) || fs.existsSync(path.join(VAULT, 'corpus'));
const exceptions = JSON.parse(fs.readFileSync(path.join(ROOT, 'curation', 'ocr-exceptions.json'), 'utf8'));

type Normalizer = {
  normalize(s: string, o?: { mode?: 'prose' | 'safe' }): { text: string; changes: { kind: string; before: string; after: string }[] };
  scan(s: string): { kind: string; token: string; context: string }[];
};
const fix = (n: Normalizer, s: string) => n.normalize(s).text;

// ── algorithm, against a tiny hand-made vocabulary (no vault needed) ─────────────────────────────
describe('ocr normaliser: algorithm (toy vocabulary)', () => {
  const counts: Record<string, number> = {
    the: 9000, man: 800, a: 20000, i: 20000, am: 500, and: 9000, of: 9000, in: 9000, nomine: 40, lapis: 60, est: 400, world: 700, river: 200,
    rising: 60, from: 5000, transformation: 120, transform: 30, myself: 300, by: 3000, without: 500, mirror: 90, introspection: 40, is: 5000,
    sun: 300, moon: 300, round: 100, around: 150, hieros: 30, gamos: 30, hierosgamos: 60, mercurius: 400, woman: 300, wom: 0,
  };
  const vocab = { freq: new Map(Object.entries(counts)), pairs: new Map([['hieros gamos', 12], ['a round', 6]]), english: new Set<string>() };
  const n: Normalizer = createNormalizer(vocab, {});

  it('joins a stray capital or letter to the fragment it belongs to', () => {
    expect(fix(n, 'T he world')).toBe('The world');
    expect(fix(n, 'the "m an rising from the river"')).toBe('the "man rising from the river"');
    expect(fix(n, 'W ithout a mirror')).toBe('Without a mirror');
    expect(fix(n, 'wom an')).toBe('woman');
  });

  it('handles multi-way splits and keeps punctuation and case', () => {
    expect(fix(n, 'b y m yself,')).toBe('by myself,');
    expect(fix(n, 'i ntrospection.')).toBe('introspection.');
    expect(fix(n, '(M irror)')).toBe('(Mirror)');
  });

  it('never joins real words', () => {
    for (const s of ['a man', 'I am', 'in nomine', 'lapis est', 'sun and moon', 'a round', 'hieros gamos', 'of the world']) expect(fix(n, s)).toBe(s);
  });

  it('fixes ligatures, soft hyphens, odd whitespace and hyphenated line breaks', () => {
    expect(fix(n, 'the ﬁre')).toBe('the fire');
    expect(fix(n, 'trans­form­ation')).toBe('transformation');
    expect(fix(n, 'the  world  and')).toBe('the world and');
    expect(fix(n, 'transfor- mation')).toBe('transformation');
  });

  it('keeps suspended hyphens and bibliographic strings', () => {
    expect(fix(n, 'seven- and twelve-rayed')).toBe('seven- and twelve-rayed');
    expect(n.normalize('ch. V n. 134', { mode: 'safe' }).text).toBe('ch. V n. 134');
  });

  it('is idempotent', () => {
    const once = fix(n, 'T he m an and wom an');
    expect(fix(n, once)).toBe(once);
  });
});

// ── real vocabulary built from the vault's clean volumes ─────────────────────────────────────────
describe.skipIf(!haveVocab)('ocr normaliser: vault vocabulary', () => {
  let n: Normalizer;
  beforeAll(() => {
    n = createNormalizer(buildVocab({ vault: VAULT, cacheDir: CACHE }), exceptions);
  }, 240_000);

  it('repairs the known scan artefacts', () => {
    expect(fix(n, 'he is the "m an rising from the river"')).toBe('he is the "man rising from the river"');
    expect(fix(n, 'T he archetype of the Self, W ithout the M irror')).toBe('The archetype of the Self, Without the Mirror');
    expect(fix(n, 'a nd then i ntrospection')).toBe('and then introspection');
    expect(fix(n, 'b y m yself')).toBe('by myself');
    expect(fix(n, 'im m ortality')).toBe('immortality');
    expect(fix(n, 'the wom an and the m an')).toBe('the woman and the man');
  });

  it('repairs shredded passages', () => {
    expect(fix(n, 'to id en ti fy th ea ni mus at lea st p ro v is io na lly with wholeness')).toBe('to identify the animus at least provisionally with wholeness');
  });

  it('joins hyphenated line breaks only when the joined word is known', () => {
    expect(fix(n, 'the transfor- mation of the soul')).toBe('the transformation of the soul');
    expect(fix(n, 'hearth- and fire-spirits')).toBe('hearth- and fire-spirits');
  });

  it('leaves real words, Latin and spelling variants alone', () => {
    for (const s of [
      'a man', 'I am', 'in nomine', 'lapis est', 'per se', 'sub specie aeternitatis', 'hieros gamos', 'the anima mundi',
      'Mercurius duplex', 'the prima materia', 'of the Self', 'Case Y iii', 'Miss X', 'a round table', 'to me', 'any one',
      'solve et coagula', 'ex nihilo', 'nigredo, albedo, rubedo', 'unus mundus', 'he re-reads the text',
    ]) expect(fix(n, s), s).toBe(s);
  });

  it('never rewrites bibliographic locators', () => {
    expect(n.normalize('fig. 131, ¶357 (pdf p268)', { mode: 'safe' }).text).toBe('fig. 131, ¶357 (pdf p268)');
  });

  it('flags a split it declined to join (the scanner has teeth)', () => {
    expect(n.scan('the m ysterious sun').length).toBeGreaterThan(0);
    expect(n.scan('the quiet world of the sun').length).toBe(0);
  });
});

// ── the ingested field ───────────────────────────────────────────────────────────────────────────
describe('ingested field.json carries no scan damage', () => {
  const field: Field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'field.json'), 'utf8'));
  const stats = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'field.stats.json'), 'utf8'));

  it('the ingest logged its repairs and found no residual suspects', () => {
    expect(stats.ocr, 'field.stats.json lacks the ocr section — run npm run ingest').toBeTruthy();
    expect(stats.ocr.changes).toBeGreaterThan(100);
    expect(stats.ocr.samples.length).toBe(stats.ocr.unique);
    expect(stats.ocr.residual).toBe(0);
  });

  it('has no ligature glyphs, soft hyphens, odd whitespace or doubled spaces in any text', () => {
    const bad: string[] = [];
    for (const list of [field.archetypes, field.families, field.occurrences, field.cultures]) {
      for (const item of list as { id: string }[]) {
        visitFieldText(item, (where: string, value: string) => {
          if (/[ﬀ-ﬆ­​-‍﻿  -  ]| {2}|^\s|\s$/.test(value)) bad.push(`${item.id}${where}`);
        });
      }
    }
    expect(bad).toEqual([]);
  });

  it('has none of the classic split-word signatures', () => {
    const sig = /\b(?:T he|Th e|W ithout|M irror|a nd|th e|m an|wom an|tim e|som e|hum an|becom e|nam e|know n)\b/;
    const bad: string[] = [];
    for (const list of [field.archetypes, field.families, field.occurrences, field.cultures]) {
      for (const item of list as { id: string }[]) {
        visitFieldText(item, (where: string, value: string) => {
          if (sig.test(value)) bad.push(`${item.id}${where}: ${value.match(sig)![0]}`);
        });
      }
    }
    expect(bad).toEqual([]);
  });

  it.skipIf(!haveVocab)('the residual scanner, run afresh over field.json, flags nothing', () => {
    const scan = createNormalizer(buildVocab({ vault: VAULT, cacheDir: CACHE }), exceptions) as Normalizer;
    const hits: string[] = [];
    for (const list of [field.archetypes, field.families, field.occurrences, field.cultures]) {
      for (const item of list as { id: string }[]) {
        visitFieldText(item, (where: string, value: string, mode: string) => {
          if (mode === 'safe') return;
          for (const h of scan.scan(value)) hits.push(`${item.id}${where} [${h.kind}] ${h.token} :: ${h.context}`);
        });
      }
    }
    expect(hits).toEqual([]);
  }, 240_000);

  it('the quote that started it all reads correctly', () => {
    const q = field.occurrences.find((o) => /rising from the river/.test(o.quote ?? ''));
    expect(q?.quote).toMatch(/"man rising from the river,?"/);
  });
});
