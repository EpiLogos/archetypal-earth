// The theory nodes' pages (public/data/theory-pages.json): every concept of the tier has a real page, every quotation
// is corpus-placed with a locating cite and stands verbatim on its cited page, and nothing in the file is typed prose
// where a source belongs. The psychoid carries its own CW8 material in full — the owner's named requirement — and no
// page speaks the build (the interface shows the page, never the pipeline).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error Plain ESM shared with the generators.
import { DEFAULT_VAULT } from '../../scripts/lib/vault.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { verify, workLoader } from '../../scripts/lib/cite.mjs';
// @ts-expect-error Plain ESM shared with the generators.
import { buildTheoryPages } from '../../scripts/theory-pages.mjs';
import { voiceOf } from '../../src/lenses/ui';
import type { Field } from '../../src/types/field';

const ROOT = path.resolve(__dirname, '..', '..');
const field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'field.json'), 'utf8')) as Field;
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'theory-pages.json'), 'utf8'));
const load = workLoader(DEFAULT_VAULT);

type Page = { concept: string; line: string; sections: { id: string; title: string; line: string; quotes: { text: string; cite: { work: string; workTitle: string; locator: string }; voice?: string; scan?: true }[] }[]; subjects: { type: string; id: string }[] };
type Q = Page['sections'][number]['quotes'][number];

/** Every quotation of a page (or of the file), with the page it belongs to named for failure messages. */
function quotes(pages: Record<string, Page>): (Q & { where: string })[] {
  const out: (Q & { where: string })[] = [];
  for (const [id, p] of Object.entries(pages)) for (const s of p.sections) for (const q of s.quotes) out.push({ ...q, where: `${id}.${s.id}` });
  return out;
}

describe('the theory nodes have pages', () => {
  it('every concept of the tier carries a non-empty page, with a line and sections that say what they hold', () => {
    expect(Object.keys(data.pages).length).toBe(field.theoretics.length);
    for (const t of field.theoretics) {
      const p = data.pages[t.id] as Page | undefined;
      expect(p, `${t.id}: no page`).toBeTruthy();
      expect(p!.line.length, t.id).toBeGreaterThan(20);
      expect(p!.sections.length, t.id).toBeGreaterThan(0);
      for (const s of p!.sections) {
        expect(s.title.length, `${t.id}.${s.id} title`).toBeGreaterThan(0);
        expect(s.line.length, `${t.id}.${s.id} line`).toBeGreaterThan(20);
        expect(s.quotes.length, `${t.id}.${s.id} has no quotations`).toBeGreaterThan(0);
      }
    }
  });

  it('every quotation is corpus-placed with a locating cite and stands verbatim on its cited page', () => {
    const qs = quotes(data.pages);
    expect(qs.length).toBeGreaterThan(100);
    for (const q of qs) {
      expect(q.cite.work, q.where).toBeTruthy();
      expect(q.cite.workTitle, q.where).toBeTruthy();
      expect(q.cite.locator, q.where).toMatch(/^(?:¶\d+ \(pdf p\d+\)|pdf p\d+)$/);
      expect(q.text.length, q.where).toBeGreaterThan(30);
      expect(verify(load, { work: q.cite.work, locator: q.cite.locator, quote: q.text }), q.where).toBeNull();
    }
  }, 120_000);

  it('the psychoid carries its own CW8 material in full, as the owner named it', () => {
    const p = data.pages.psychoid as Page;
    const all = p.sections.flatMap((s) => s.quotes);
    const start = (need: string) => expect(all.some((q) => `${q.cite.work} ${q.cite.locator}`.startsWith(need)), need).toBe(true);
    start('cw08 ¶840'); // the naming
    start('cw08 ¶368'); // the three reservations
    start('cw08 ¶417'); // the psychoid factor, the ultra-violet end
    start('cw08 ¶419'); // the physics parallel
    start('cw08 ¶420'); // psyche and matter as two aspects of one thing
    start('cw08 ¶841'); // the specific charge
    start('cw10 ¶851'); // non-locality
    start('cw13 ¶350'); // the psychoid form under the image
    start('cw18 ¶1208'); // the psychoid factor, i.e. the unconscious archetype
    // the correspondence: the Pauli letters 59 and 63 in Jung's voice, 47P in Pauli's
    const letters = all.filter((q) => q.cite.work === 'letters-pauli');
    expect(letters.length).toBe(3);
    expect(letters.filter((q) => q.voice === 'Pauli').length).toBe(1);
    // a quotation kept as a damaged scan reads it says so; the generated display of a clean span says nothing
    expect(letters.some((q) => q.scan === true)).toBe(true);
  });

  it('the other voices are kept apart: von Franz and Van Eenwyk are never Jung\'s', () => {
    const qs = quotes(data.pages);
    for (const q of qs) {
      // the cite names the book; the voice chip names the author (src/lenses/ui.ts voiceOf), and neither ever
      // claims Jung's name for another's words
      if (q.cite.work.startsWith('vonzfranz')) expect(voiceOf(q.cite.work), q.where).toBe('von Franz');
      if (q.cite.work === 'van-eenwyk') expect(voiceOf(q.cite.work), q.where).toBe('Van Eenwyk');
      if (q.voice) expect(['Pauli', 'von Franz', 'Neumann', 'Van Eenwyk'], q.where).toContain(q.voice);
    }
    // the concepts that name a dynamical system carry Van Eenwyk's own reading
    for (const id of ['aion-time', 'compensation', 'libido', 'transcendent-function']) {
      const p = data.pages[id] as Page;
      expect(p.sections.flatMap((s) => s.quotes).some((q) => q.cite.work === 'van-eenwyk'), id).toBe(true);
    }
  });

  it('the pages speak the field, not the pipeline', () => {
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/curation|public\/data|npm run|\.mjs|pipeline|git /i);
  });

  it('the published file is what the sources give now (no hand edits)', () => {
    const built = buildTheoryPages();
    expect(built.errors).toEqual([]);
    expect(data).toEqual(built.data);
  }, 120_000);
});
