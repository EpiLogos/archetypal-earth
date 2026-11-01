import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The depth page names each instance by the field's family, or else by the name its page prints ("Christ Asleep in a
// Ship"), never by the reading pass's slug ("christ-asleep-on-a-sheep", "female-figurines-lower-assyria-clay").
describe("the depth page names an instance as the book does", () => {
  it("a plate that is not a family is named by the title its page prints", () => {
    const read = (f: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/data', f), 'utf8'));
    const families = new Set((read('field.json').families as { id: string }[]).map((f) => f.id));
    type Inst = { terms: string[]; names?: string[]; cite: { work: string; locator: string } };
    // the Great Mother's plate pages, where the old reading made the slugs out of misread captions
    const plate = (x: Inst) => x.cite.work === 'neumann-great-mother' && (Number(x.cite.locator.replace(/\D+/g, '')) || 0) >= 215;
    const missing: string[] = [];
    for (const a of Object.values(read('depth.json').archetypes as Record<string, { instances?: { items: Inst[]; undated: Inst[] } }>)) {
      for (const x of [...(a.instances?.items ?? []), ...(a.instances?.undated ?? [])]) {
        if (plate(x)) x.terms.forEach((t, i) => { if (!families.has(t) && !x.names?.[i]) missing.push(t); });
      }
    }
    expect(missing.slice(0, 8), `${missing.length} instances named by their slug`).toEqual([]);
  });
});
