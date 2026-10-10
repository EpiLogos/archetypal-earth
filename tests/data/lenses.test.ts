import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Plain ESM shared with the CLI.
import { DEFAULT_VAULT } from '../../scripts/lib/vault.mjs';
// @ts-expect-error Plain ESM shared with the CLI.
import { verify, workLoader, locate } from '../../scripts/lib/cite.mjs';
// @ts-expect-error Plain ESM shared with the CLI.
import { buildTheory } from '../../scripts/theory.mjs';
// @ts-expect-error Plain ESM shared with the CLI.
import { buildAstrology } from '../../scripts/astrology.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', f), 'utf8'));
type Q = { text: string; cite: { work: string; locator: string } };

/** Every quotation object anywhere in a published lens file. */
function quotes(node: unknown, out: Q[] = []): Q[] {
  if (Array.isArray(node)) for (const x of node) quotes(x, out);
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.text === 'string' && o.cite && typeof (o.cite as Q['cite']).locator === 'string') out.push(o as unknown as Q);
    for (const v of Object.values(o)) quotes(v, out);
  }
  return out;
}

describe('the lens data: provenance lives in the quotes', () => {
  const load = workLoader(DEFAULT_VAULT);
  for (const file of ['theory.json', 'astrology.json']) {
    it(`${file}: every quotation stands verbatim on its cited page of the read-only vault`, () => {
      const qs = quotes(read(file));
      expect(qs.length).toBeGreaterThan(10);
      expect(qs.map((q) => verify(load, { work: q.cite.work, locator: q.cite.locator, quote: q.text })).filter(Boolean)).toEqual([]);
    });
  }

  it('a quotation that is not in the corpus is refused, and a moved one fails its page', () => {
    expect(locate(load, 'cw09ii', 'the self is a modern invention of the twentieth century')).toHaveProperty('error');
    expect(verify(load, { work: 'cw09ii', locator: 'pdf p100', quote: 'Psychologically the self is a union of conscious (masculine) and unconscious (feminine).' })).toMatch(/not verbatim/);
  });

  it('the published files are what the vault gives now (no hand edits)', () => {
    const t = buildTheory({ vault: DEFAULT_VAULT });
    const a = buildAstrology({ vault: DEFAULT_VAULT });
    expect(t.errors).toEqual([]);
    expect(a.errors).toEqual([]);
    expect(read('theory.json')).toEqual(t.data);
    expect(read('astrology.json')).toEqual(a.data);
  });

  it('Jung, the first chart, carries no birth time the corpus does not give', () => {
    const jung = read('astrology.json').people.find((p: { id: string }) => p.id === 'jung');
    expect(jung.birth.time).toBeNull();
    expect(jung.quote.cite.work).toBe('cw01');
  });
});
