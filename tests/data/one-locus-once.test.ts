import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Two harvest names for one plate ("bronze-mirror-hormone-goddess", "goddess-soul-birds-on-lion-sumer") once made the same
// Great Mother plate two occurrences of one family. A family shows a locus once.
describe('a family shows each locus once', () => {
  it('no family carries two occurrences with the same title at the same cite', () => {
    const field = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/data/field.json'), 'utf8')) as {
      occurrences: { id: string; familyId: string; title: string; jung?: { work: string; locator: string }[] }[];
    };
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const o of field.occurrences) {
      const c = o.jung?.[0];
      if (!c) continue;
      const key = `${o.familyId}|${c.work}|${c.locator}|${o.title}`;
      if (seen.has(key)) twice.push(`${seen.get(key)} = ${o.id}`);
      else seen.set(key, o.id);
    }
    expect(twice).toEqual([]);
  });
});
