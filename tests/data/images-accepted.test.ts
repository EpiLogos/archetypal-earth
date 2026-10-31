import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The plates on the site are the accepted set (the owner's 15 Oct restore). A curation note may stop a search
// from fetching a known-wrong picture; it must never stand against a plate the site serves, because the image
// script reads such a note as "delete this plate" and the set then flips between two states. A plate changes only
// by a better picture taking its place.
const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const REGISTERS = ['public/data/images.json', 'public/data/images-ext-families.json', 'public/data/images-ext-commons.json', 'public/data/images-ext.json']
  .filter((f) => fs.existsSync(path.join(ROOT, f)));

describe('the accepted image set', () => {
  it('no served plate carries a curation note that rejects it', () => {
    const queries = read('curation/image-queries.json') as Record<string, Record<string, { skip?: string }>>;
    const served = new Map<string, Set<string>>();
    for (const f of REGISTERS) {
      for (const [group, entries] of Object.entries(read(f) as Record<string, unknown>)) {
        if (!entries || typeof entries !== 'object') continue;
        for (const [id, ref] of Object.entries(entries as Record<string, { src?: string }>)) {
          if (ref?.src && fs.existsSync(path.join(ROOT, 'public', ref.src))) (served.get(group) ?? served.set(group, new Set()).get(group)!).add(id);
        }
      }
    }
    const clashes: string[] = [];
    for (const [group, entries] of Object.entries(queries)) {
      if (!entries || typeof entries !== 'object') continue;
      for (const [id, spec] of Object.entries(entries)) if (spec && typeof spec === 'object' && spec.skip && served.get(group)?.has(id)) clashes.push(`${group}/${id}`);
    }
    expect(clashes.slice(0, 5), `${clashes.length} served plates carry a rejecting note`).toEqual([]);
  });

  it('no picture credit carries a description or a judgement', () => {
    const bad: string[] = [];
    for (const f of REGISTERS) {
      for (const [group, entries] of Object.entries(read(f) as Record<string, unknown>)) {
        if (!entries || typeof entries !== 'object') continue;
        for (const [id, ref] of Object.entries(entries as Record<string, { credit?: string }>)) {
          if (/representative picture|stand-?in|not the /i.test(ref?.credit ?? '')) bad.push(`${f} ${group}/${id}`);
        }
      }
    }
    expect(bad.slice(0, 5), `${bad.length} credits`).toEqual([]);
  });
});
