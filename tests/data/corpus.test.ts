// @ts-expect-error Plain ESM shared with the CLI.
import { DEFAULT_VAULT } from '../../scripts/lib/vault.mjs';
// @ts-expect-error Plain ESM shared with the CLI.
import { externalRegister } from '../../scripts/lib/external.mjs';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error Plain ESM data generator, shared with the CLI.
import { parseCorpusMarkdown } from '../../scripts/lib/corpus.mjs';
import { parseLocator, resolveInWork, neighbourInWork } from '../../src/data/corpus';
import type { CorpusIndex, CorpusWork } from '../../src/types/corpus';

const ROOT = path.resolve(__dirname, '..', '..');
// No fixtures and no skips: the corpus index is built data, and a missing
// volume is a failed acceptance check, the same law the history tests keep.
const index: CorpusIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/corpus/index.json'), 'utf8'));
const vault = DEFAULT_VAULT;
const loadWork = (work: string): CorpusWork =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/corpus', `${work}.json`), 'utf8'));
const cw12 = loadWork('cw12');
const cw09ii = loadWork('cw09ii');
const semVisions = loadWork('sem-visions');

describe('corpus index (citation deep links)', () => {
  it('holds every vault volume with its pages and ¶ anchors', () => {
    // every corpus volume, then each external work the site registers whose pages the vault holds (_raw-ext)
    const files = fs.readdirSync(path.join(vault, 'corpus')).filter((f) => f.endsWith('.md')).sort();
    const externals = Object.keys(externalRegister(path.resolve(__dirname, '../..'))).filter((w) => fs.existsSync(path.join(vault, '_raw-ext', w, 'pages')));
    expect(index.works.map((w) => w.work)).toEqual([...files.map((f) => f.replace(/\.md$/, '')), ...externals]);
    for (const entry of index.works) {
      const doc = loadWork(entry.work);
      expect(doc.pages.length).toBe(entry.pages);
      expect(doc.paras.length).toBe(entry.paras);
      expect(doc.pages.length).toBeGreaterThan(50);
      for (let i = 1; i < doc.pages.length; i++) expect(doc.pages[i].p).toBeGreaterThan(doc.pages[i - 1].p);
      const withText = doc.pages.filter((p) => p.text.length > 0).length;
      expect(withText).toBeGreaterThan(doc.pages.length * 0.9); // blank backs of plates are the honest exception
    }
  });

  it('resolves the vault ledger’s own self-test: cw12 ¶452 opens the alchemist passage', () => {
    expect(parseLocator('¶452 (pdf p350)')).toEqual({ para: 452, pages: [350, undefined] });
    const ref = resolveInWork(cw12, '¶452 (pdf p350)');
    expect(ref).not.toBeNull();
    expect(ref!.para).toBe(452);
    expect(ref!.text).toContain('Without knowing it, the alchemist carries the idea of the');
    expect(ref!.pageText).toContain('¶452');
    expect(ref!.chapter).toBeTruthy();
    const next = neighbourInWork(cw12, ref!.index, 1);
    expect(next!.para).toBe(453);
  });

  it('resolves an anchored footnote locator and a seminar page cite', () => {
    const fn = resolveInWork(cw09ii, '¶149, n.84 (pdf p106)');
    expect(fn).not.toBeNull();
    expect(fn!.text).toContain('Aquarian Age');
    const page = resolveInWork(semVisions, 'pdf p804');
    expect(page).not.toBeNull();
    expect(page!.page).toBe(804);
    expect(page!.text.length).toBeGreaterThan(200);
  });

  it('resolves a lane volume by its printed page: Burt p. 9 opens the pdf page behind it', () => {
    const burt = loadWork('burt-zodiac');
    expect(burt.pages.length).toBeGreaterThan(500);
    // the sky card's Burt cites carry the verified pdf page in the locator; the
    // book's own printed page is what the reader knows, and the corpus keeps it
    const ref = resolveInWork(burt, 'p. 9 (pdf p31)');
    expect(ref).not.toBeNull();
    expect(ref!.page).toBe(31);
    expect(ref!.print).toBe('9');
    expect(ref!.text).toContain('Aries energy');
    expect(ref!.para).toBeUndefined();
  });

  it('keeps page-true anchors for ¶ numbers that restart across essays', () => {
    // same ¶ number twice in one volume resolves by the cited page
    const dup = cw09ii.paras.filter((p) => p.para === 1);
    if (dup.length > 1) {
      const picked = resolveInWork(cw09ii, `¶1 (pdf p${dup[1].p})`);
      expect(picked!.page).toBe(dup[1].p);
    }
    expect(parseLocator('fol. v(v) (pdf p276-278)')).toEqual({ pages: [276, 278] });
    expect(parseLocator('fig. 131, ¶357 (pdf p268)')).toEqual({ para: 357, pages: [268, undefined] });
  });

  it('round-trips the vault citation spine through the parsed corpus', () => {
    const spine = fs.readFileSync(path.join(vault, 'data', 'paragraphs.jsonl'), 'utf8').split('\n').filter(Boolean);
    let checked = 0;
    for (const line of spine) {
      const rec = JSON.parse(line);
      if (rec.para == null) continue;
      const doc = loadWork(rec.vol);
      const hit = doc.paras.find((p) => p.para === rec.para && Math.abs(p.p - rec.pdf_page) <= 1);
      expect(hit, `${rec.vol} ¶${rec.para}`).toBeTruthy();
      const ref = resolveInWork(doc, `¶${rec.para} (pdf p${rec.pdf_page})`);
      // the span opens at the ¶ marker itself; the spine snippet may carry the
      // page's figure captions before it, so anchor on the marker, not the head
      expect(ref!.text.startsWith(`**¶${rec.para}**`), `${rec.vol} ¶${rec.para} span`).toBe(true);
      expect(Math.abs(ref!.page - rec.pdf_page), `${rec.vol} ¶${rec.para} page`).toBeLessThanOrEqual(1);
      if (++checked >= 500) break; // a full sweep is the ingest's own spine check
    }
    expect(checked).toBe(500);
  });

  it('parses the raw corpus identically to the built file (spot volume)', () => {
    const raw = fs.readFileSync(path.join(vault, 'corpus', 'cw12.md'), 'utf8');
    const parsed = parseCorpusMarkdown('cw12', raw);
    expect(parsed.pages.length).toBe(cw12.pages.length);
    expect(parsed.paras.length).toBe(cw12.paras.length);
    expect(parsed.pages[350].text.slice(0, 40)).toBe(cw12.pages[350].text.slice(0, 40));
  });
});
