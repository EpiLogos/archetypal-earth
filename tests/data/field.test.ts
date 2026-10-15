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
    // the globe's track is set by what the globe can show: an occurrence with no Earth place keeps its year and does not set the ends
    const onTrack = field.occurrences.filter((o) => o.geoPrecision !== 'none');
    expect(field.meta.yearMin).toBe(Math.min(...onTrack.map((o) => o.year)));
    expect(field.meta.yearMax).toBe(Math.max(...onTrack.map((o) => o.year)));
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

  it('family definitions, where present, are quoted passages with a locating cite', () => {
    let seen = 0;
    for (const f of field.families) {
      if (!f.definition) continue;
      seen++;
      expect(f.definition.text.length, f.id).toBeGreaterThan(40);
      expect(f.definition.cite, f.id).toMatch(/¶|pdf p/);
    }
    expect(seen, 'the enrichment pass has landed').toBeGreaterThan(50);
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

  it('every family holds at least one occurrence: its own, a co-manifest, or one its vault note lists', () => {
    const held = new Set<string>();
    for (const o of field.occurrences) for (const f of [o.familyId, ...o.coFamilyIds]) held.add(f);
    // the entry class the build once let through: a node that carried nothing and described its own absence
    expect(field.families.filter((f) => !held.has(f.id)).map((f) => f.id)).toEqual([]);
  });

  it('no family says of itself that it is named in the field with nothing recorded', () => {
    const boiler = /named in the field|no recorded instance|no instance yet|records no instance/i;
    expect(field.families.filter((f) => boiler.test(f.oneLine)).map((f) => `${f.id}: ${f.oneLine}`)).toEqual([]);
    // nor a line the automatic derivation cut off mid-thought
    const cut = /\b(and|or|of|the|with|a|an|in|to|by|for|from|at|originating)\.$/i;
    const stranded = /\b(and|or),\s+\w+\.$/i; // "…and, dimmed." — a clause left standing after the thought was cut
    expect(field.families.filter((f) => cut.test(f.oneLine) || stranded.test(f.oneLine)).map((f) => `${f.id}: ${f.oneLine}`)).toEqual([]);
  });

  it('a merge key is an alias of its target, never a node that carries nothing', () => {
    const merges: Record<string, string> = JSON.parse(fs.readFileSync(path.join(ROOT, 'curation', 'families.json'), 'utf8')).merges ?? {};
    const ids = new Set(field.families.map((f) => f.id));
    for (const key of Object.keys(merges)) expect(ids.has(key), `${key} is a merge key and still a family`).toBe(false);
  });

  it('what hangs in the sky is stored apart from the Earth: no coordinates are invented for it', () => {
    const sky = field.occurrences.filter((o) => o.sky?.length);
    expect(sky.length).toBeGreaterThan(100);
    for (const o of sky) {
      // either it has an Earth place of its own (Crowley’s region for an Ace or a Princess) or it stands at 0,0 / none
      if (o.geoPrecision === 'none') expect([o.lat, o.lon], o.id).toEqual([0, 0]);
      for (const l of o.sky!) expect(l.via.every((x) => typeof x === 'string'), o.id).toBe(true);
    }
  });

  it('an attestation’s quotation stands on the first page its cite names (verbatim, up to the field’s own OCR repair)', () => {
    const norm = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
    const shingles = (t: string, n = 14) => { const out: string[] = []; for (let i = 0; i + n <= t.length; i += 7) out.push(t.slice(i, i + n)); return out; };
    const corpus = new Map<string, Map<number, string>>();
    const pageOf = (work: string, n: number) => {
      if (!corpus.has(work)) {
        const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'corpus', `${work}.json`), 'utf8')) as { pages: { p: number; text: string }[] };
        corpus.set(work, new Map(j.pages.map((x) => [x.p, norm(x.text)])));
      }
      return corpus.get(work)!.get(n) ?? '';
    };
    const off: string[] = [];
    let checked = 0;
    for (const o of field.occurrences) {
      const c = o.jung[0];
      if (!c || o.id !== `${o.familyId}-in-${c.work}` || !o.quote) continue;
      const first = c.locator.split('; ')[0];
      const pg = /pdf p(\d+)/.exec(first)?.[1];
      if (!pg) { off.push(`${o.id}: locator ${first}`); continue; }
      checked++;
      const page = pageOf(c.work, Number(pg));
      const q = norm(o.quote);
      if (page.includes(q)) continue;
      // the field repairs scan damage in every string it carries: a handful of characters, never a different passage
      const sh = shingles(q);
      const found = sh.filter((x) => page.includes(x)).length;
      if (!sh.length || found / sh.length < 0.75) off.push(`${o.id}: not on pdf p${pg}`);
    }
    expect(checked).toBeGreaterThan(200);
    expect(off).toEqual([]);
  });

  it('an attestation is dated by its work and cites its words, never Jung’s unless they are', () => {
    const attested = field.occurrences.filter((o) => o.id === `${o.familyId}-in-${o.jung[0]?.work}`);
    expect(attested.length).toBeGreaterThan(150);
    for (const o of attested) {
      expect(o.jung, o.id).toHaveLength(1);
      expect(o.quote, `${o.id} carries a placed quotation`).toBeTruthy();
      expect(o.locusType).toBe('text-passage');
      if (o.jung[0].work === 'book-of-thoth') expect(o.jung[0].voice, o.id).toBe('Crowley');
    }
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
    const imgs = [...field.archetypes, ...field.theoretics, ...field.families, ...field.occurrences].filter((x) => x.image);
    for (const x of imgs) {
      for (const p of [x.image!.src, x.image!.thumb]) expect(fs.existsSync(path.join(ROOT, 'public', p)), `${x.id}: ${p}`).toBe(true);
      if (x.image!.license === 'Attribution') {
        // This Commons file grants reuse for any purpose with the named author's credit.
        // (the credit is the author's, and the file is a Commons page: the plate names who must be thanked and where it came from)
        expect(x.image!.credit.trim(), `${x.id}: attribution needs a credit`).not.toBe('');
        expect(x.image!.sourceUrl, `${x.id}: attribution needs its Commons page`).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      } else expect(x.image!.license).toMatch(/Public domain|CC0|CC BY|owner's ruling \(D8\)/); // D8: the Thoth plates ship on the owner's ruling
    }
    expect(field.meta.counts.images).toBe(imgs.length);
  });
});
