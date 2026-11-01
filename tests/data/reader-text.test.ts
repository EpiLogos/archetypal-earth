import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ESM script
import { readerBody, readerLocator, readerPlace, readerSectionLine, readerTitle, withoutAsides, withoutPdfPages } from '../../scripts/lib/reader-text.mjs';

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

  it('a date, a caption and a locator lose the note and keep their own punctuation', () => {
    expect(withoutAsides('A Baubo figure from Priene, Asia Minor, V century B.C. (as printed).')).toBe('A Baubo figure from Priene, Asia Minor, V century B.C.');
    expect(withoutAsides('c. 450 B.C. (as printed, OCR \'ec. 450 nc.\')')).toBe('c. 450 B.C.');
    expect(withoutAsides('he breaks off... (as given)')).toBe('he breaks off...');
    expect(readerLocator('¶232-235 (pdf p163-165; ¶s unmarked in chunk)')).toBe('¶232-235 (pdf p163-165)');
    expect(readerLocator('¶33 (pdf p28) — ¶ marker lost in OCR, reconstructed')).toBe('¶33 (pdf p28)');
  });

  it('the published field carries none of it', () => {
    const field = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/data/field.json'), 'utf8')) as { occurrences: { id: string; title: string; body?: string[] }[] };
    const NOTE = /\bOCR\b|garbled|\bas printed\b|reading[- ]pass|verbatim from the scan|p0\d{3}\.jpg|\bthis vault\b|\bthe vault's\b|\bchunk\b|\bflag(?:ged)? for\b|\bmention record\b/i;
    const leaks = field.occurrences.filter((o) => NOTE.test(o.title) || (o.body ?? []).some((p) => NOTE.test(p))).map((o) => o.id);
    expect(leaks.slice(0, 8), `${leaks.length} instances`).toEqual([]);
  });

  // Every published file, every string the reader can be shown: dates, places, captions, locators, section lines, chapter
  // titles. Ids and file paths are slugs nobody reads; a person's `reasons` and the plates' `note` are never rendered.
  it('no published file shows it either', () => {
    const dir = path.resolve(__dirname, '../../public/data');
    const NOTE = /\bOCR(?:'ed)?\b|garbled|\(as printed|\(as given|\bas printed\b|reading[- ]pass(?:es)?\b|\bthe scan\b|\bscan (?:of the letter )?is damaged|\bthis vault\b|\bthe vault(?:'s| note| records| reads| keeps)\b|\bvault note\b|\bvault’s\b|\bchunk\b|\bunmarked in\b/i;
    const UNREAD = /(?:^|\.)(?:id|src|thumb|sourceUrl|sha256|occurrenceIds|reasons|cites\[\]\.id|subject\.id|plates\.note|licence)(?:$|\.|\[)/;
    const leaks: string[] = [];
    const walk = (v: unknown, at: string, file: string) => {
      if (typeof v === 'string') { if (NOTE.test(v) && !UNREAD.test(at)) leaks.push(`${file}${at}: ${v.slice(0, 90)}`); }
      else if (Array.isArray(v)) v.forEach((x) => walk(x, `${at}[]`, file));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`, file);
    };
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) walk(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), '', f);
    expect(leaks.slice(0, 12), `${leaks.length} strings`).toEqual([]);
  });

  // owner, 1 Nov 2026: the Crowley lines on a card read as a ledger ("Crowley on the title (pdf p178); on Mars in Leo (pdf p192).")
  it('the pdf pages a line was drawn from go; the cite under a quotation says where it is', () => {
    expect(withoutPdfPages('Crowley’s Seven of Wands: Valour (pdf p178); Mars in Leo (pdf p192); Netzach (pdf p178).')).toBe('Crowley’s Seven of Wands: Valour; Mars in Leo; Netzach.');
    expect(withoutPdfPages('Crowley on the Knights: Yodh (pdf p24, p79, p139, p141, p26).')).toBe('Crowley on the Knights: Yodh.');
    expect(withoutPdfPages('The liver (pdf p1483, on the hero in the whale-dragon’s belly) — what the shadow-bird feeds on.')).toBe('The liver (on the hero in the whale-dragon’s belly) — what the shadow-bird feeds on.');
    expect(withoutPdfPages('"she must be a ghost" (sem-kundalini pdf p148). Jung proposed it.')).toBe('"she must be a ghost". Jung proposed it.');
    expect(withoutPdfPages('a lamp in a windless place" (v.26, sem-kundalini pdf p165).')).toBe('a lamp in a windless place" (v.26).');
    expect(withoutPdfPages('early struck (CW10 ¶384; footnote pdf p904; cf. 5 June 1935).')).toBe('early struck (CW10 ¶384; cf. 5 June 1935).');
    expect(withoutPdfPages('Crowley, pdf p175: “Thus, roughly.”')).toBe('Crowley: “Thus, roughly.”');
  });

  it('a line that only indexes pages, or only captions the quotations under it, goes; a reading that names a page stays', () => {
    expect(readerBody(['Burt, chapter on Aries (pdf pp. 23–58): pdf p23, p24, p25 and p37.'])).toEqual([]);
    expect(readerBody(['Images of air, breath and wind: CW9i pdf p347 and p357.'])).toEqual([]);
    expect(readerBody(['Crowley on the title (pdf p178); on Mars in Leo (pdf p192).'])).toEqual([]);
    expect(readerBody(['Jung on the numbers: 5 + 6 + 8 = 19. The cherries are red.'])).toEqual(['Jung on the numbers: 5 + 6 + 8 = 19. The cherries are red.']);
    expect(readerSectionLine('Jung on the ram: Dream Analysis seminar, pdf p448 and p434; CW9ii pdf p101.')).toBe('');
    expect(readerSectionLine('Crowley on the Sevens and Netzach (pdf p178).')).toBe('');
  });

  it('no page line, section line or card instance in the published field reads as a ledger', () => {
    const read = (f: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/data', f), 'utf8'));
    const pages = read('field-pages.json').pages as Record<string, { line: string; sections: { line: string }[] }>;
    const lines = Object.entries(pages).flatMap(([k, p]) => [p.line, ...p.sections.map((x) => x.line)].map((l) => `${k}: ${l}`));
    expect(lines.filter((l) => /\bpdf\s+pp?\.?\s*\d/.test(l)).slice(0, 8)).toEqual([]);
    expect(lines.filter((l) => /: (?:Crowley|Burt) on\b/.test(l)).slice(0, 8)).toEqual([]);
    const occ = read('field.json').occurrences as { id: string; body?: string[] }[];
    expect(occ.filter((o) => o.id.startsWith('thoth-') && (o.body ?? []).some((b) => /\bpdf\s+p|^Crowley on\b/.test(b))).map((o) => o.id).slice(0, 8)).toEqual([]);
  });

  it('a place says where, not how the harvest worked it out', () => {
    expect(readerPlace("Greece (inferred from 'Gren')")).toBe('Greece');
    expect(readerPlace('Möttlingen, Württemberg (inferred from Zündel)')).toBe('Möttlingen, Württemberg');
    expect(readerPlace("Zurich? (Jung's practice)")).toBe("Zurich? (Jung's practice)");
    expect(readerPlace('not legible (OCR)')).toBe('');
    const read = (f: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/data', f), 'utf8'));
    const gm = read('depth.json').archetypes['great-mother'].instances as { items: { place: string }[]; undated: { place: string }[] };
    const places = [...(read('field.json').occurrences as { place: string }[]), ...gm.items, ...gm.undated].map((o) => o.place);
    const leaks = places.filter((p) => /\binferred\b|^not (?:given|legible)$/i.test(p));
    expect(leaks.slice(0, 8), `${leaks.length} places`).toEqual([]);
  });
});
