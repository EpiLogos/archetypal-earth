import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error Plain ESM data generator, shared with the CLI.
import { buildRedbook, DEFAULT_VAULT } from '../../scripts/redbook.mjs';
import type { RedBook } from '../../src/types/redbook';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const vault = process.env.VAULT || DEFAULT_VAULT;
const published: RedBook = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/redbook.json'), 'utf8'));
const field: Field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/field.json'), 'utf8'));

describe('Red Book data (Liber Novus mode)', () => {
  it('matches the curation exactly, without regenerating or changing timestamps', () => {
    const { doc } = buildRedbook({ root: ROOT, vault });
    expect({ ...doc, generatedAt: published.generatedAt }).toEqual(published);
  });

  it('walks every liber-novus occurrence, each stop subject: Jung', () => {
    const inField = new Map(field.occurrences.map((o) => [o.id, o]));
    const walk = new Set(published.stops.map((s) => s.id));
    for (const stop of published.stops) {
      const o = inField.get(stop.id);
      expect(o, stop.id).toBeTruthy();
      expect(o!.subject).toBe('jung');
    }
    const all = field.occurrences.filter((o) => o.id.includes('liber-novus')).map((o) => o.id);
    for (const id of all) expect(walk.has(id), `${id} missing from the walk`).toBe(true);
    for (const section of published.sections) {
      expect(published.stops.some((s) => s.sectionId === section.id), section.id).toBe(true);
    }
    expect(published.stops.length).toBeGreaterThanOrEqual(35);
  });

  it('carries the licence law: plates are local-only, never a shipped path', () => {
    expect(published.licence.plates).toContain('never enter git');
    expect(published.plates.served).toBe('dev-only');
    for (const stop of published.stops) {
      if (stop.plate) expect(stop.plate).toMatch(/^p\d{4}\.jpg$/);
      // no stop may reference a site-relative or absolute image path: the plates live in the vault
      expect(stop.plate ?? '').not.toMatch(/(^\/|img\/|\.\.)/);
    }
  });

  it('genesis rows resolve and quote the vault’s own capstone map verbatim', () => {
    const arch = new Set(field.archetypes.map((a) => a.id));
    const fam = new Set(field.families.map((f) => f.id));
    const stops = new Set(published.stops.map((s) => s.id));
    const bearing = norm(fs.readFileSync(path.join(vault, 'wiki/maps/red-book-bearing.md'), 'utf8'));
    expect(published.genesis.length).toBeGreaterThanOrEqual(14);
    for (const row of published.genesis) {
      expect(stops.has(row.stopId), row.id).toBe(true);
      for (const target of [row.target, row.also]) {
        if (!target) continue;
        if (target.kind === 'archetype') expect(arch.has(target.id), `${row.id} archetype`).toBe(true);
        if (target.kind === 'family') expect(fam.has(target.id), `${row.id} family`).toBe(true);
        if (target.kind === 'reading') expect(['jung-aion', 'jung-turn', 'jung-aquarius-horizon']).toContain(target.id);
      }
      expect(bearing.includes(norm(row.words)), `${row.id} words verbatim`).toBe(true);
    }
  });

  it('the plates named actually exist in the vault copy (and only there)', () => {
    const dir = path.join(vault, published.plates.vaultRelativeDir);
    const withPlates = published.stops.filter((s) => s.plate);
    expect(withPlates.length).toBeGreaterThanOrEqual(10);
    for (const stop of withPlates) expect(fs.existsSync(path.join(dir, stop.plate!)), stop.plate).toBe(true);
  });
});

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
void os;
