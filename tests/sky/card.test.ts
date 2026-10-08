import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, subjectExists } from '../../src/data/model';
import type { Field } from '../../src/types/field';
import type { BodyKey, SkyData } from '../../src/types/sky';
import { BASIS_LABEL, canOpenCard, describePosition, formatMoment, resolveTies } from '../../src/sky/card';
import { SkyEphemeris } from '../../src/sky/ephemeris';
import { signOf } from '../../src/sky/frames';
import { BODY_GLYPH, bodyTiesFor, glyphOf, type TiesIndex } from '../../src/sky/ties';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf8'));
const data = read('sky.json') as SkyData;
const index = read('sky.ties.json') as TiesIndex;
const model = buildModel(read('field.json') as Field);
const eph = new SkyEphemeris(data);
const probe = data.golden.epochs.find((e) => e.label === 'Off-grid probe')!;

describe('every body card is earned', () => {
  it('each of the eleven bodies has at least one tie that resolves to a living field node', () => {
    expect(data.bodies).toHaveLength(11);
    for (const b of data.bodies) {
      expect(canOpenCard(b, model), b.key).toBe(true);
      expect(resolveTies(b, model).unresolved, `${b.key} has a tie to something the field does not have`).toEqual([]);
    }
  });

  it('a body with no resolvable tie opens no card', () => {
    expect(canOpenCard({ ties: [{ body: 'mars', target: { type: 'family', id: 'no-such-family' }, basis: 'site', note: 'x' }] }, model)).toBe(false);
  });

  it('every tie states its basis; Jung\'s are quoted, the atlas\'s own are not dressed as Jung\'s', () => {
    for (const b of data.bodies) {
      for (const t of b.ties) {
        expect(Object.keys(BASIS_LABEL)).toContain(t.basis);
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

describe('the position line', () => {
  const ms = Date.parse(probe.iso);
  it('reads the Sun\'s tropical sign at the probe epoch, labelled as such, with its moment', () => {
    const r = describePosition('sun', eph, ms, `as of ${formatMoment(ms)}`);
    expect(r.known).toBe(true);
    expect(r.line).toContain(signOf(probe.sun!.lon).sign);
    expect(r.line).toContain('tropical, ecliptic of date');
    expect(r.line).toContain('2026-03-17 07:23 UTC');
  });

  it('reads every other body without inventing: planets too', () => {
    for (const k of ['moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as BodyKey[]) {
      expect(describePosition(k, eph, ms, 'x').known, k).toBe(true);
    }
  });

  it('declines, with the span stated, outside the generated sky', () => {
    const r = describePosition('mars', eph, Date.UTC(1875, 6, 26), 'as of 1875-07-26');
    expect(r.known).toBe(false);
    expect(r.line).toMatch(/No position/);
    expect(r.line).toContain('2015–2039');
  });

  it('gives the Earth no place in its own sky', () => {
    const r = describePosition('earth', eph, ms, 'x');
    expect(r.known).toBe(false);
    expect(r.line).toMatch(/observer/);
  });
});
