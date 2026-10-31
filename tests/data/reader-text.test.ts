import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ESM script
import { readerBody, readerTitle } from '../../scripts/lib/reader-text.mjs';

// The cases are the vault's own sentences, as field.json carried them before the reader's text was cut from them.
describe('the reader is not shown the vault bookkeeping', () => {
  it('a plate inventory goes; a plate the book reproduces stays', () => {
    expect(readerBody(['PLATE (p0046.jpg = LS p.15): "Der Anachoret. Cap. IV." — the great illuminated D']).length).toBe(0);
    expect(readerBody(['**Plate (p0081.jpg = ms p. 50, image 50).** Full-page illumination on a dense red ground']).length).toBe(0);
    expect(readerBody(['Plate 131: "Adam as prima materia, pierced by the arrow of Mercurius."'])).toEqual(['Plate 131: "Adam as prima materia, pierced by the arrow of Mercurius."']);
    expect(readerBody(['Plate: EARTH, miniature from a manuscript of the Abbey of Monte Cassino, eleventh century. (Monte Cassino (Abbey), XI century (as given).)']))
      .toEqual(['Plate: EARTH, miniature from a manuscript of the Abbey of Monte Cassino, eleventh century.']);
  });

  it('notes on the scan and on the reading pass go', () => {
    expect(readerBody(['The quotation is verbatim from the scan, noise included ("ocr": true in the reading-pass record).', 'Source: neumann-great-mother reading pass.'])).toEqual([]);
    expect(readerBody(['Neumann reads this as a concrete appearing of the artemis orthia ivory (artemis-orthia-ivory); the reading pass dates and places the locus as recorded here, as an inference of the harvest.'])).toEqual([]);
    expect(readerTitle("Artemis Orthia Ivory — Fig. 63: Artemis Orthia on an ivory plaque from Sparta, dated c. 740 (OCR 'ce. (Sparta, c. 740 (as printed; 'ws' probably B.C.))"))
      .toBe('Artemis Orthia Ivory — Fig. 63: Artemis Orthia on an ivory plaque from Sparta, dated c. 740');
    expect(readerBody(['Her painting shows "the melancholy eye of a beast" [OCR]. The Dionysian cortege has led her back.'])).toEqual(['Her painting shows "the melancholy eye of a beast". The Dionysian cortege has led her back.']);
    expect(readerBody(["where he is named [Greek lost to OCR], 'round and square.'"])).toEqual(["where he is named […], 'round and square.'"]);
  });

  it('what the vault keeps, tracks or harvested goes, and the reading around it stays', () => {
    expect(readerBody(['It condenses the whole series of dream 15 and the Puer row of dream 12, and stands in the Adam-cycle the vault already tracks.']))
      .toEqual(['It condenses the whole series of dream 15 and the Puer row of dream 12.']);
    expect(readerBody(['Jung cites the stag (soul) and unicorn (spirit) in the forest (body) — the latter already harvested from cw13. The motif returns.']))
      .toEqual(['Jung cites the stag (soul) and unicorn (spirit) in the forest (body). The motif returns.']);
    expect(readerBody(["The attribution is theirs, not Jung's sentence — a distinction this vault keeps. Jung quotes the line."])).toEqual(['Jung quotes the line.']);
    expect(readerBody(['The bull-gnawing-saint interpretation proper falls beyond this chunk\'s page range.'])).toEqual([]);
  });

  it('the published field carries none of it', () => {
    const field = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/data/field.json'), 'utf8')) as { occurrences: { id: string; title: string; body?: string[] }[] };
    const NOTE = /\bOCR\b|garbled|\bas printed\b|reading[- ]pass|verbatim from the scan|p0\d{3}\.jpg|\bthis vault\b|\bthe vault's\b|\bchunk\b|\bflag(?:ged)? for\b|\bmention record\b/i;
    const leaks = field.occurrences.filter((o) => NOTE.test(o.title) || (o.body ?? []).some((p) => NOTE.test(p))).map((o) => o.id);
    expect(leaks.slice(0, 8), `${leaks.length} instances`).toEqual([]);
  });
});
