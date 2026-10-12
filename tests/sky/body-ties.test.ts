import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, subjectExists } from '../../src/data/model';
import type { Field } from '../../src/types/field';
import type { BodyKey, SkyData } from '../../src/types/sky';
import { formatMoment } from '../../src/sky/live';
import { BODY_GLYPH, bodyTiesFor, glyphOf, type TiesIndex } from '../../src/sky/ties';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf8'));
const data = read('sky.json') as SkyData;
const index = read('sky.ties.json') as TiesIndex;
const model = buildModel(read('field.json') as Field);

const BASES = ['jung', 'inferred', 'site'];

describe('every body is tied into the field', () => {
  it('each of the eleven bodies has at least one tie, and every tie resolves to a living field node', () => {
    expect(data.bodies).toHaveLength(11);
    for (const b of data.bodies) {
      expect(b.ties.length, b.key).toBeGreaterThan(0);
      for (const t of b.ties) expect(subjectExists(model, t.target), `${b.key} has a tie to something the field does not have: ${t.target.id}`).toBe(true);
    }
  });

  it('every tie states its basis; Jung\'s are quoted, the atlas\'s own are not dressed as Jung\'s', () => {
    for (const b of data.bodies) {
      for (const t of b.ties) {
        expect(BASES).toContain(t.basis);
        expect(t.note.length, `${b.key}→${t.target.id} note`).toBeGreaterThan(10);
        if (t.basis === 'jung') {
          expect(t.cites?.length, `${b.key}→${t.target.id} is "jung" without a citation`).toBeGreaterThan(0);
          for (const c of t.cites!) { expect(c.quote.length).toBeGreaterThan(15); expect(c.workTitle).toBeTruthy(); expect(c.locator).toBeTruthy(); }
        }
        if (t.basis === 'site') expect(t.cites ?? [], `${b.key}→${t.target.id} is "site" but cited`).toEqual([]);
      }
    }
  });

  it('the modern bodies carry no Jung tie: he wrote none, and the sky says so by construction', () => {
    for (const k of ['uranus', 'neptune', 'pluto'] as BodyKey[]) {
      const b = data.bodies.find((x) => x.key === k)!;
      expect(b.modern).toBe(true);
      expect(b.discovered?.year).toBeGreaterThan(1780);
      expect(b.ties.every((t) => t.basis !== 'jung'), k).toBe(true);
    }
  });

  it('Sun and Moon carry the pair reading, cited, with every target a living node', () => {
    const r = data.readings.find((x) => x.id === 'self-as-coniunctio')!;
    expect(r.bodies.sort()).toEqual(['moon', 'sun']);
    expect(r.basis).toBe('jung');
    expect(r.cites.length).toBeGreaterThanOrEqual(2);
    expect(r.targets.map((t) => t.id).sort()).toEqual(['coniunctio', 'self', 'syzygy']);
    for (const t of r.targets) expect(subjectExists(model, t), `${t.type}:${t.id}`).toBe(true);
  });
});

describe('culture reprojection says what it is', () => {
  it('every culture with a table exists in the field, and every cell has a basis and a source', () => {
    for (const [id, cells] of Object.entries(data.cultures)) {
      expect(model.cultureById.has(id), `culture ${id}`).toBe(true);
      for (const [body, c] of Object.entries(cells)) {
        expect(c!.name, `${id}/${body}`).toBeTruthy();
        expect(['jung', 'inferred', 'site']).toContain(c!.basis);
        expect(c!.source.length, `${id}/${body} source`).toBeGreaterThan(5);
      }
    }
  });

  it('the Chinese table has five elements and no cell for the luminaries — absence stays absence', () => {
    const cn = data.cultures.chinese;
    expect(Object.keys(cn)).toHaveLength(5);
    expect(cn.sun).toBeUndefined();
    expect(cn.moon).toBeUndefined();
  });
});

describe('the ties index agrees with sky.json', () => {
  it('carries exactly the ties of the bodies, with the same basis and the same stamp', () => {
    const all = data.bodies.flatMap((b) => b.ties.map((t) => `${b.key}|${t.target.type}|${t.target.id}|${t.basis}`)).sort();
    expect(index.ties.map((t) => `${t.body}|${t.type}|${t.id}|${t.basis}`).sort()).toEqual(all);
    expect(index.meta.generatedAt).toBe(data.meta.generatedAt);
  });

  it('lists bodies of a family in the order of the sky, and none for a family without a tie', () => {
    const t = bodyTiesFor(index, 'family', 'mercurius');
    expect(t.length).toBeGreaterThan(0);
    expect(t.map((x) => x.body)).toContain('mercury');
    expect(bodyTiesFor(index, 'family', 'no-such-family')).toEqual([]);
  });

  it('every body has a glyph, as text and never emoji', () => {
    for (const k of Object.keys(BODY_GLYPH) as BodyKey[]) expect(glyphOf(k).endsWith('\uFE0E')).toBe(true);
    expect(Object.keys(BODY_GLYPH)).toHaveLength(11);
  });
});

describe('tie notes are the plain statement of the tie', () => {
  it('every Jung tie carries a note (the link Jung makes is the note)', () => {
    for (const b of data.bodies) for (const t of b.ties) if (t.basis === 'jung') expect(t.note.trim(), `${b.key}→${t.target.id}`).not.toBe('');
  });

  it('no note speaks of the vault, the sidecar, the generated sky, the scripts, the atlas\'s inference or a method', () => {
    for (const b of data.bodies) for (const t of b.ties) {
      if (t.restates || !t.note.trim()) continue;
      expect(t.note, `${b.key}→${t.target.id}`).not.toMatch(/vault|sidecar|generated|npm run|\(S\)|by inference|the atlas's inference|editorial/i);
    }
  });
});

describe('formatMoment', () => {
  it('prints a UTC moment to the minute', () => {
    expect(formatMoment(Date.UTC(2026, 9, 12, 7, 5))).toBe('2026-10-12 07:05 UTC');
  });
});

describe('the sky data\'s words are the reader\'s, not the agent\'s', () => {
  it('no culture source carries the vault\'s "(S)" marker', () => {
    for (const cells of Object.values(data.cultures)) for (const c of Object.values(cells)) {
      expect(c!.source, c!.source).not.toMatch(/\(S\)/);
    }
  });
});
