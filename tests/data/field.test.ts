import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ESM script
import { validateField } from '../../scripts/validate.mjs';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const FIELD_PATH = path.join(ROOT, 'public', 'data', 'field.json');
const field: Field = JSON.parse(fs.readFileSync(FIELD_PATH, 'utf8'));
const HEX = /^#[0-9a-fA-F]{6}$/;

describe('field.json contract', () => {
  it('passes the runtime validator with no errors', () => {
    expect(validateField(field)).toEqual([]);
  });

  it('has the expected tiers populated', () => {
    expect(field.archetypes.length).toBeGreaterThanOrEqual(13);
    expect(field.families.length).toBeGreaterThan(100);
    expect(field.occurrences.length).toBeGreaterThan(500);
    expect(field.archetypes.filter((a) => a.prime).map((a) => a.id)).toEqual(['self']);
  });

  it('every occurrence references an existing family and culture', () => {
    const fam = new Set(field.families.map((f) => f.id));
    const cul = new Set(field.cultures.map((c) => c.id));
    for (const o of field.occurrences) {
      expect(fam.has(o.familyId), `${o.id} familyId ${o.familyId}`).toBe(true);
      for (const c of o.coFamilyIds) expect(fam.has(c), `${o.id} coFamily ${c}`).toBe(true);
      for (const c of o.cultureIds) expect(cul.has(c), `${o.id} culture ${c}`).toBe(true);
    }
  });

  it('every family has at least one archetype tie to an existing archetype', () => {
    const arch = new Set(field.archetypes.map((a) => a.id));
    for (const f of field.families) {
      expect(f.archetypes.length, `${f.id} ties`).toBeGreaterThanOrEqual(1);
      for (const t of f.archetypes) {
        expect(arch.has(t.id), `${f.id} -> ${t.id}`).toBe(true);
        expect(['jung', 'inferred', 'site']).toContain(t.basis);
      }
    }
  });

  it('years are within [-10000, 2030] and coordinates in range', () => {
    for (const o of field.occurrences) {
      expect(o.year).toBeGreaterThanOrEqual(-10000);
      expect(o.year).toBeLessThanOrEqual(2030);
      expect(o.lat).toBeGreaterThanOrEqual(-90);
      expect(o.lat).toBeLessThanOrEqual(90);
      expect(o.lon).toBeGreaterThanOrEqual(-180);
      expect(o.lon).toBeLessThanOrEqual(180);
      if (o.geoPrecision === 'none') expect([o.lat, o.lon]).toEqual([0, 0]);
    }
    expect(field.meta.yearMin).toBe(Math.min(...field.occurrences.map((o) => o.year)));
    expect(field.meta.yearMax).toBe(Math.max(...field.occurrences.map((o) => o.year)));
  });

  it('leaves no wikilink syntax in any string', () => {
    const bad: string[] = [];
    const walk = (v: unknown, where: string) => {
      if (typeof v === 'string') {
        if (v.includes('[[') || v.includes(']]')) bad.push(`${where}: ${v.slice(0, 50)}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
    };
    walk(field, 'field');
    expect(bad).toEqual([]);
  });

  it('palettes are valid hex and spectrum positions in 0..1', () => {
    for (const x of [...field.archetypes, ...field.families]) {
      for (const k of ['core', 'glow', 'fog', 'deep'] as const) expect(x.palette[k], `${x.id}.${k}`).toMatch(HEX);
      expect(x.spectrum.position).toBeGreaterThanOrEqual(0);
      expect(x.spectrum.position).toBeLessThanOrEqual(1);
    }
  });

  it('length limits hold: label <= 48, oneLine <= 90 (families may have no line)', () => {
    for (const o of field.occurrences) expect(o.label.length, o.id).toBeLessThanOrEqual(48);
    for (const a of field.archetypes) {
      expect(a.oneLine.length, a.id).toBeLessThanOrEqual(90);
      expect(a.oneLine.length, a.id).toBeGreaterThan(0);
    }
    for (const f of field.families) expect(f.oneLine.length, f.id).toBeLessThanOrEqual(90);
  });

  it('parallelIds only reference existing occurrences', () => {
    const ids = new Set(field.occurrences.map((o) => o.id));
    for (const o of field.occurrences) for (const p of o.parallelIds) expect(ids.has(p), `${o.id} -> ${p}`).toBe(true);
  });

  it('archetype definitions are verbatim vault quotes with a cite, never invented', () => {
    for (const a of field.archetypes) if (a.definition) {
      expect(a.definition.text.length).toBeGreaterThan(20);
      expect(a.definition.cite).toMatch(/¶\d+/);
    }
    const self = field.archetypes.find((a) => a.id === 'self');
    expect(self?.definition?.cite).toContain('426');
  });

  it('geographic precision target: >= 85% of occurrences at place or region', () => {
    const good = field.occurrences.filter((o) => o.geoPrecision === 'place' || o.geoPrecision === 'region').length;
    expect(good / field.occurrences.length).toBeGreaterThanOrEqual(0.85);
  });

  it('family occurrence lists are sorted by year and point back at the family', () => {
    const byId = new Map(field.occurrences.map((o) => [o.id, o]));
    for (const f of field.families) {
      let prev = -Infinity;
      for (const id of f.occurrenceIds) {
        const o = byId.get(id)!;
        expect(o.familyId).toBe(f.id);
        expect(o.year).toBeGreaterThanOrEqual(prev);
        prev = o.year;
      }
    }
  });

  it('attached images point at real files', () => {
    const imgs = [...field.archetypes, ...field.families, ...field.occurrences].filter((x) => x.image);
    for (const x of imgs) {
      for (const p of [x.image!.src, x.image!.thumb]) expect(fs.existsSync(path.join(ROOT, 'public', p)), `${x.id}: ${p}`).toBe(true);
      if (x.image!.license === 'Attribution') {
        // This Commons file grants reuse for any purpose with the named author's credit.
        expect(x.image!.credit).toBe("Giovanni Dall'Orto");
        expect(x.image!.sourceUrl).toBe("https://commons.wikimedia.org/wiki/File:XV01_-_Roma,_Museo_civilt%C3%A0_romana_-_Iscrizione_di_Abercio_-_Foto_Giovanni_Dall%27Orto_12-Apr-2008.jpg");
      } else expect(x.image!.license).toMatch(/Public domain|CC0|CC BY/);
    }
    expect(field.meta.counts.images).toBe(imgs.length);
  });
});
