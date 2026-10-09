// The Red Book card's reader-facing text, checked against the real field and the published Red Book data:
// no plate-inventory paragraph reaches the reader, no cite or footer carries a raw work slug, the genesis
// doctrine carries no raw CW key, and every stop leads with a verbatim key passage that carries its cite.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { citeLine, firstQuotation, genesisCite, isGerman, keyPassage, readerBody, readerCite, READING_TITLES } from '../../src/redbook/text';
import type { Cite, Field, Occurrence } from '../../src/types/field';
import type { RedBook } from '../../src/types/redbook';

const ROOT = path.resolve(__dirname, '..', '..');
const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const field = read<Field>('public/data/field.json');
const redbook = read<RedBook>('public/data/redbook.json');
const history = read<{ readings: { id: string; title: string }[] }>('public/data/history.json');
const walk: Occurrence[] = redbook.stops.map((s) => field.occurrences.find((o) => o.id === s.id)!);
const PLATE_LEAK = /^PLATES?\b/i;
const RAW_SLUG = /\b(liber-novus|redbook|memories)\b/;
const RAW_CW = /\b(cw\d|sem-\d)/i;

describe('plate inventory never reaches the reader', () => {
  const bodies = walk.flatMap((o) => o.body);
  const leaks = bodies.filter((p) => PLATE_LEAK.test(p.trim()));

  it('the field really carries the leaking paragraphs (PLATE (, Plate (, PLATES (, PLATES:)', () => {
    expect(leaks.length).toBeGreaterThanOrEqual(20);
    expect(leaks.some((p) => p.startsWith('PLATES (p0024.jpg'))).toBe(true);
    expect(leaks.some((p) => p.startsWith('PLATES: p0072.jpg'))).toBe(true);
    expect(leaks.some((p) => p.startsWith('Plate (p0148.jpg'))).toBe(true);
    expect(leaks.some((p) => p.startsWith('PLATE (p0046.jpg'))).toBe(true);
  });

  it('readerBody removes every one of them and keeps every other paragraph, in order', () => {
    for (const o of walk) {
      const kept = readerBody(o.body);
      expect(kept.filter((p) => PLATE_LEAK.test(p.trim()) || /\bPLATES?\s*[(:]\s*p\d{4}\.jpg/i.test(p))).toEqual([]);
      // a paragraph without plate inventory passes through untouched
      expect(kept.filter((p) => o.body.includes(p))).toEqual(o.body.filter((p) => !PLATE_LEAK.test(p.trim()) && !/\bPLATES?\s*[(:]\s*p\d{4}\.jpg/i.test(p)));
    }
    expect(walk.reduce((n, o) => n + readerBody(o.body).length, 0)).toBe(bodies.length - leaks.length);
  });

  it('a plate note merged into prose leaves the prose: the sentence before the marker stays, the inventory goes', () => {
    const serpent = field.occurrences.find((o) => o.id.endsWith('izdubar-serpent-weave-image-fol36'))!;
    expect(serpent.body[0]).toContain('PLATE (p0067.jpg');
    expect(readerBody(serpent.body)[0]).toBe('The one fully worked painting of the Izdubar cycle, inserted at the end of the "great wandering" before First Day.');
    expect(readerBody(serpent.body).join(' ')).not.toMatch(/p0067|LS p\.|PLATE/);
  });

  it('removes the literal leak shapes, and keeps prose that merely begins with the word', () => {
    const kept = readerBody([
      'PLATES (p0024.jpg = RB fol. iii(v)/iv(r)): two paintings',
      'PLATES: p0072.jpg (LS p.41) — set in a Ravenna-like panel',
      'PLATE (p0046.jpg = LS p.15): illuminated D',
      'Plate (p0148.jpg = ms p. 117). Left half',
      'Plates were rare in the printed edition, and this one is not.',
      'Jung drew the plate himself.',
    ]);
    expect(kept).toEqual([
      'Plates were rare in the printed edition, and this one is not.',
      'Jung drew the plate himself.',
    ]);
  });
});

describe('cites read as the core reads them', () => {
  it('names the Red Book works and carries no slug in any stop cite', () => {
    for (const o of walk) for (const c of o.jung) {
      const line = citeLine(c);
      expect(line, o.id).toMatch(/^Jung · /);
      expect(line, o.id).not.toMatch(RAW_SLUG);
      expect(line, o.id).not.toMatch(RAW_CW);
    }
  });

  it('renders the Liber Novus folio and the Red Book ms cite in the core voice', () => {
    expect(citeLine({ work: 'liber-novus', workTitle: 'liber-novus', year: '1913-1930', locator: 'fol. 15/16-19/20 (pdf p298-300)' }))
      .toBe('Jung · Liber Novus · 1913-1930 · fol. 15/16-19/20');
    expect(citeLine({ work: 'redbook', workTitle: 'redbook', year: 'c. 1917/22', locator: 'liber-novus ms p. 117, image 117 (pdf p334, Nox Quarta)' }))
      .toBe('Jung · The Red Book · c. 1917/22 · ms p. 117, image 117');
    expect(citeLine({ work: 'memories', workTitle: 'memories', year: '1920/1962', locator: 'x' })).toBe('Jung · Memories, Dreams, Reflections · 1920/1962 · x');
  });

  it('leaves a field work title that is already a title alone', () => {
    const c: Cite = { work: 'cw12', workTitle: 'Psychology and Alchemy (CW12)', year: '1944', locator: '¶561' };
    expect(readerCite(c).workTitle).toBe('Psychology and Alchemy (CW12)');
    expect(citeLine(c)).toBe('Jung · Psychology and Alchemy · 1944 · ¶561');
  });

  it('genesis cites from the curation read as jungLine, never as a bare work key', () => {
    for (const row of redbook.genesis) {
      const line = genesisCite(row.cite);
      expect(line, row.id).toMatch(/^Jung · The Red Book · pdf p\d+/);
      expect(line, row.id).not.toMatch(RAW_SLUG);
    }
  });
});

describe('the genesis doctrine carries no raw work key or method narration', () => {
  it('no doctrine string holds a cw/sem key, the vault, or the atlas', () => {
    for (const row of redbook.genesis) {
      expect(row.doctrine, row.id).not.toMatch(RAW_CW);
      expect(row.doctrine, row.id).not.toMatch(/\bvault\b|\batlas\b|\bthe map\b|\barc assembled\b/i);
    }
  });
});

describe('every stop leads with its key passage', () => {
  it('each of the 37 stops has a key passage with a footer and words of its own', () => {
    expect(walk.length).toBe(37);
    for (const [i, o] of walk.entries()) {
      const row = redbook.genesis.find((g) => g.stopId === o.id);
      const key = keyPassage(o, row);
      expect(key, `stop ${i + 1} ${o.id}`).not.toBeNull();
      expect(key!.words.length, o.id).toBeGreaterThan(20);
      expect(key!.footer, o.id).toMatch(/^Jung · /);
      expect(key!.words, o.id).not.toMatch(PLATE_LEAK);
      expect(isGerman(key!.words), o.id).toBe(false);
    }
  });

  it('the field quote wins; the body quotation is verbatim from the stop', () => {
    const quoted = walk.find((o) => o.quote)!;
    expect(keyPassage(quoted)!.words).toBe(quoted.quote);
    const bodyOnly = walk.find((o) => !o.quote && !redbook.genesis.some((g) => g.stopId === o.id))!;
    const key = keyPassage(bodyOnly)!;
    expect(bodyOnly.body.join(' ')).toContain(key.words);
  });
});

describe('quotation rules', () => {
  it('skips German blackletter and takes the English translation beside it', () => {
    const body = ['Legend: "Die Schlange fiel tot auf die Erde. Das war die Nabelschnur einer Neugeburt" — "The serpent fell dead unto the earth. And that was the umbilical cord of a new birth."'];
    expect(firstQuotation(body)).toBe('The serpent fell dead unto the earth. And that was the umbilical cord of a new birth.');
  });

  it('never takes a fragment torn from its sentence', () => {
    expect(firstQuotation(['He spoke of "the red sun disk" and then left.'])).toBeNull();
    expect(firstQuotation(['the list ends with "and cut off mid-sentence like the transcription it follows:"'])).toBeNull();
  });

  it('a long quotation is cut at a whole sentence, under ninety words', () => {
    const sentence = 'This is a sentence of exactly ten words in it.';
    const long = Array.from({ length: 14 }, () => sentence).join(' ');
    const out = firstQuotation([`He wrote "${long}" afterwards.`])!;
    expect(out.split(/\s+/).length).toBeLessThanOrEqual(90);
    expect(out.endsWith('.')).toBe(true);
  });

  it('a quotation from a plate paragraph is never a key passage', () => {
    expect(firstQuotation(['PLATE (p0046.jpg): "This is a whole sentence that a plate note once carried."'])).toBeNull();
  });
});

describe('the readings the genesis rows name are titled as the history names them', () => {
  it('READING_TITLES matches history.json', () => {
    for (const [id, title] of Object.entries(READING_TITLES)) {
      expect(history.readings.find((r) => r.id === id)?.title, id).toBe(title);
    }
  });
});
