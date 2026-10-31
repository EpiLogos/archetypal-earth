import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useFolios } from '../../src/redbook/load';
import type { Field } from '../../src/types/field';
import type { RedBook } from '../../src/types/redbook';

const ROOT = path.resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')) as T;

describe('the Red Book folios', () => {
  const redbook = read<RedBook>('public/data/redbook.json');

  it('every stop the facsimile holds names its folio and its size', () => {
    const missing = redbook.stops.filter((s) => !s.plate).map((s) => s.id);
    // the Sermones and the Scrutinies are not in the facsimile: those four have no folio
    expect(missing.every((id) => /sermones|pdf370|1916/.test(id)), missing.join(', ')).toBe(true);
    expect(redbook.stops.filter((s) => s.plate).length).toBeGreaterThanOrEqual(33);
    for (const s of redbook.stops.filter((x) => x.plate)) expect(s.plateSize?.every((n) => n > 0), s.id).toBe(true);
  });

  it('where the facsimile is served, an instance shows its own folio, not a picture from elsewhere', () => {
    const field = read<Field>('public/data/field.json');
    const n = useFolios(field, redbook);
    const byId = new Map(field.occurrences.map((o) => [o.id, o]));
    expect(n).toBe(redbook.stops.filter((s) => s.plate && byId.has(s.id)).length);
    const ammonius = byId.get('liber-novus-anchorite-ammonius-fol15')!;
    expect(ammonius.image?.src).toBe('redbook-plates/p0046.jpg');
    expect(ammonius.image?.credit).toBe('C. G. Jung');
    // a stop the facsimile does not hold keeps what it had
    const abraxas = redbook.stops.find((s) => s.id === 'liber-novus-sermones-abraxas-hymn-pdf381');
    if (abraxas) expect(byId.get(abraxas.id)?.image?.src ?? '').not.toMatch(/redbook-plates/);
  });

  it('no instance body carries the vault plate inventory', () => {
    const field = read<Field>('public/data/field.json');
    const leaks = field.occurrences.filter((o) => (o.body ?? []).some((p) => /p0\d{3}\.jpg/.test(p))).map((o) => o.id);
    expect(leaks).toEqual([]);
  });
});
