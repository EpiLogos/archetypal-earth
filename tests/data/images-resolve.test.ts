import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// A family may borrow its instance's plate through a side register (images-ext-families.json); when that instance's plate
// is pruned, the family must not be left pointing at a file that is gone.
describe('every plate a register names is on disk', () => {
  it('each src and thumb in public/data/images*.json resolves to a file', () => {
    const root = path.resolve(__dirname, '../..');
    const dir = path.join(root, 'public/data');
    const missing: string[] = [];
    for (const f of fs.readdirSync(dir).filter((n) => /^images.*\.json$/.test(n))) {
      const reg = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, Record<string, { src?: string; thumb?: string }>>;
      for (const [group, entries] of Object.entries(reg)) {
        if (!entries || typeof entries !== 'object') continue;
        for (const [id, ref] of Object.entries(entries)) {
          for (const p of [ref?.src, ref?.thumb]) if (p && !fs.existsSync(path.join(root, 'public', p))) missing.push(`${f} ${group}/${id}: ${p}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
