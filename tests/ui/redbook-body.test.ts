// The Red Book card's reader-facing text, checked against the real field and the published Red Book data:
// no plate-inventory paragraph reaches the reader, no cite or footer carries a raw work slug, the genesis
// doctrine carries no raw CW key, and exactly the expected stops lead with a key passage (open, cited in
// Jung's voice). A stop without a key passage has none: nothing is invented.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { citeLine, genesisCite, keyPassage, readerBody, readerCite, READING_TITLES, VETTED_BODY_QUOTES } from '../../src/redbook/text';
import type { Cite, Field, Occurrence } from '../../src/types/field';
import type { RedBook } from '../../src/types/redbook';

const ROOT = path.resolve(__dirname, '..', '..');
const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const field = read<Field>('public/data/field.json');
const redbook = read<RedBook>('public/data/redbook.json');
const history = read<{ readings: { id: string; title: string }[] }>('public/data/history.json');
const walk: Occurrence[] = redbook.stops.map((s) => field.occurrences.find((o) => o.id === s.id)!);
const PLATE_LEAK = /^PLATES?\b/i;
const PLATE_MARK = /\bPLATES?\s*[(:]\s*p\d{4}\.jpg/i;
const RAW_SLUG = /\b(liber-novus|redbook|memories)\b/;
const RAW_CW = /\b(cw\d|sem-\d)/i;

/** The vetted body quotations: the only stops whose key words come from their own body. Reviewed by hand. */
const VETTED = [
  'liber-novus-god-in-egg-incantations-ms50',
  'liber-novus-dead-serpent-umbilical-cord-ms111',
  'liber-novus-atmavictu-kabir-manikin-ms117',
  'liber-novus-cabiri-holy-water-caster-ms123',
  'liber-novus-lapis-atmavictu-stone-face-ms122',
  'liber-novus-sermones-man-is-a-gateway-lonely-star-pdf385',
  'liber-novus-epilogue-1959-ms190',
];
/** The stops with no key passage at all: no field quote, no curated genesis words, not vetted. Named, so a regression shows. */
const NONE = [
  'liber-novus-izdubar-reborn-from-egg-ms65',
  'liber-novus-sigg-memorial-mandala-liverpool-ms159',
  'liber-novus-satan-dialogue-absolute-vs-life-ms162',
  'liber-novus-phallos-hap-daimons-of-the-dead-pdf370',
  'liber-novus-communion-of-the-dead-last-supper-1916',
];

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

  it('readerBody removes every one of them and keeps every other paragraph', () => {
    for (const o of walk) {
      const kept = readerBody(o.body);
      expect(kept.filter((p) => PLATE_LEAK.test(p.trim()) || PLATE_MARK.test(p))).toEqual([]);
      expect(kept.filter((p) => o.body.includes(p))).toEqual(o.body.filter((p) => !PLATE_LEAK.test(p.trim()) && !PLATE_MARK.test(p)));
    }
    expect(walk.reduce((n, o) => n + readerBody(o.body).length, 0)).toBe(bodies.length - leaks.length);
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

  it('a plate note merged into prose leaves the prose: the sentence before the marker stays, the inventory goes', () => {
    const serpent = field.occurrences.find((o) => o.id.endsWith('izdubar-serpent-weave-image-fol36'))!;
    expect(serpent.body[0]).toContain('PLATE (p0067.jpg');
    expect(readerBody(serpent.body)[0]).toBe('The one fully worked painting of the Izdubar cycle, inserted at the end of the "great wandering" before First Day.');
    expect(readerBody(serpent.body).join(' ')).not.toMatch(/p0067|LS p\.|PLATE/);
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

  it('the reviewed doctrine lines read as written: no same-year claim, no forty-year claim, the short Aion cite', () => {
    const doctrine = (id: string) => redbook.genesis.find((g) => g.id === id)!.doctrine;
    expect(doctrine('genesis-transcendent-function')).not.toMatch(/same year/);
    expect(doctrine('genesis-aeon')).not.toMatch(/forty years/);
    expect(doctrine('genesis-aeon')).toContain('(Aion ¶135–49)');
    expect(doctrine('genesis-abraxas')).toContain('(Aion ch. III, Aion ¶76)');
  });
});

describe('the key passage: exactly the expected stops lead with one, the rest have none', () => {
  const fieldQuoted = walk.filter((o) => o.quote).map((o) => o.id);
  const genesisNamed = walk.filter((o) => !o.quote && redbook.genesis.some((g) => g.stopId === o.id)).map((o) => o.id);
  const expected = [...fieldQuoted, ...genesisNamed, ...VETTED];

  it('the allowlist is exactly the seven vetted stops, and the expected total is 32', () => {
    expect(Object.keys(VETTED_BODY_QUOTES).sort()).toEqual([...VETTED].sort());
    expect(fieldQuoted.length).toBe(20);
    expect(genesisNamed.length).toBe(5);
    expect(expected.length).toBe(32);
    expect(new Set(expected).size).toBe(32);
  });

  it('the stops with a key passage are exactly the expected 32; the other five have none', () => {
    const withKey = walk.filter((o) => keyPassage(o, redbook.genesis.find((g) => g.stopId === o.id)) !== null).map((o) => o.id);
    expect([...withKey].sort()).toEqual([...expected].sort());
    expect(walk.filter((o) => !withKey.includes(o.id)).map((o) => o.id).sort()).toEqual([...NONE].sort());
  });

  it('every key passage is non-empty words with a footer in Jung’s voice', () => {
    for (const o of walk) {
      const key = keyPassage(o, redbook.genesis.find((g) => g.stopId === o.id));
      if (!key) continue;
      expect(key.words.length, o.id).toBeGreaterThan(20);
      expect(key.footer, o.id).toMatch(/^Jung · /);
      expect(key.words, o.id).not.toMatch(PLATE_LEAK);
    }
  });

  it('for each vetted stop the quotation is verbatim in its body in field.json, and the footer is complete', () => {
    for (const id of VETTED) {
      const o = walk.find((x) => x.id === id)!;
      const key = keyPassage(o)!;
      expect(key, id).not.toBeNull();
      expect(o.body.some((p) => p.includes(key.words)), `${id}: quote verbatim in body`).toBe(true);
      expect(key.footer, id).toBe(citeLine(o.jung[0]));
      expect(key.footer.length, id).toBeGreaterThan(12);
      expect(key.footer, `${id}: footer not clipped`).not.toMatch(/…/);
      expect(key.footer, `${id}: footer ends on a whole token`).toMatch(/[\p{L}\p{N})\.]$/u);
    }
  });

  it('the field quote wins; a stop with a field quote is never given a body quotation', () => {
    const quoted = walk.find((o) => o.quote)!;
    expect(keyPassage(quoted)!.words).toBe(quoted.quote);
    for (const id of NONE) {
      const o = walk.find((x) => x.id === id)!;
      expect(keyPassage(o, undefined), id).toBeNull();
    }
  });
});

describe('the readings the genesis rows name are titled as the history names them', () => {
  it('READING_TITLES matches history.json', () => {
    for (const [id, title] of Object.entries(READING_TITLES)) {
      expect(history.readings.find((r) => r.id === id)?.title, id).toBe(title);
    }
  });
});
