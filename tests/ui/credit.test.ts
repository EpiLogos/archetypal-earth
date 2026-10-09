import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanCredit, creditLine, creditLineFull, sanitiseCredit, sanitiseLicense, sanitiseTitle } from '../../src/ui/credit';

// Input -> output pairs from the image audit (docs/IMAGE-REGISTER-2026-10-09.md). Inputs that the report abbreviates
// with an ellipsis use the string the data actually carries.
const CREDITS: [string, string][] = [
  ['This file was donated to Wikimedia Commons as part of a project by the Metropolitan Museum of Art . See the Image and Data Resources Open Access Policy', 'Metropolitan Museum of Art'],
  ['Unknown author Unknown author', 'Unknown author'],
  ['Unknown artist Unknown artist , perhaps Félix Lajard', 'Unknown artist, perhaps Félix Lajard'],
  ['Unknown Unknown', 'Unknown'],
  ['Unknown source Unknown source', 'Unknown source'],
  ['Anonymous ( Category:Roman Empire ) Unknown author', 'Anonymous (Roman Empire)'],
  ['Anonymous ( Germany ) Unknown author (active in 1400s in Westphalia)', 'Anonymous (Germany), active in 1400s in Westphalia'],
  ['https://clevelandart.org/art/1972.6', 'Cleveland Museum of Art'],
  ['https://wellcomeimages.org/indexplus/obf_images/98/13/056e7a018baf5110ca95c601f6ff.jpg Gallery: https://wellcomeimages.org/indexplus/image/V0025535.html Wellcome Collection gallery (2018-03-23): https://wellcomecollectio', 'Wellcome Collection'],
  ['Image: http://collections.lacma.org/sites/default/files/remote_images/piction/ma-31965721-O3.jpg Gallery: http://collections.lacma.org/node/242261 archive copy at the Wayback Machine', 'Los Angeles County Museum of Art'],
  ['https://www.britishmuseum.org/collection/object/P_SL-5275-4', 'British Museum'],
  ['This image is available from the National Gallery of Slovenia website under the reference number NGS1497 .', 'National Gallery of Slovenia'],
  ['No machine-readable author provided. Deeptrivia assumed (based on copyright claims).', 'Deeptrivia'],
  ['Photography: Statens Museum for Kunst, SMK API: entry KMS3851 Statens Museum for Kunst, SMK Open: entry KMS3851', 'Statens Museum for Kunst'],
  ['Shiva_as_the_Lord_of_Dance_LACMA.jpg , photographed by the LACMA. derivative work: Julia \\ talk', 'Photographed by the LACMA. Derivative work: Julia'],
  ['Own work , Vassil', 'Vassil (own work)'],
  ['User:Bibi Saint-Pol , own work, 2007-02-08', 'Bibi Saint-Pol (own work), 2007-02-08'],
  ['Anonymous Russian icon painter (before 1917) Public domain image (according to PD-Russia-expired )', 'Anonymous Russian icon painter (before 1917)'],
  ['original file: C2RMF: Galerie de tableaux en très haute définition : image page', 'C2RMF'],
  ['Tibetan, Central Tibet, Tsang (Ngor Monastery), Sakya order Details on Google Art Project', 'Tibetan, Central Tibet, Tsang (Ngor Monastery), Sakya order'],
  ['w:Splendor Solis', 'Splendor Solis'],
  ['Hartmann Linge .', 'Hartmann Linge'],
  ['A.-K. D.', 'A.-K. D.'],
  ['Wikimedia Commons', 'Wikimedia Commons'],
  ['Dante Gabriel Rossetti', 'Dante Gabriel Rossetti'],
  ['Rembrandt', 'Rembrandt'],
  ['', ''],
];

const LICENCES: [string, string][] = [
  ['CC BY-SA 3.0 at', 'CC BY-SA 3.0 AT'],
  ['CC BY-SA 4.0', 'CC BY-SA 4.0'],
  ['Public domain', 'Public domain'],
  ['', ''],
];

const TITLES: [string, string][] = [
  ['Hylas and the Nymphs label QS:Lde,"Hylas und die Nymphen" label QS:Len,"Hylas and the Nymphs"', 'Hylas and the Nymphs'],
  ['Saturn (Ovid, Fasti, IV, 197-200) title QS:P1476,en:"Saturn (Ovid, Fasti, IV, 197-200) " label QS:Len,"Saturn (Ovid, Fasti, IV, 197-200) " label QS:Les,"Saturno"', 'Saturn (Ovid, Fasti, IV, 197-200)'],
  ['German: Die Toteninsel Isle of the Dead title QS:P1476,de:"Die Toteninsel" label QS:Lde,"Die Toteninsel"', 'Die Toteninsel Isle of the Dead'],
  ['Hylas and the Nymphs label QS:Lde,"Hylas und die Nymphen" label QS:Lcs,"Hylás a Nymfy" label QS:Lit,"Ila e le ninfe" label QS:Lfr,"Hylas et les Nymphes" label Q', 'Hylas and the Nymphs'],
  ['Four Mandalas of the Vajravali Series.', 'Four Mandalas of the Vajravali Series.'],
  ['', ''],
];

const BAD = /https?:|donated to|Unknown (author|artist|source) Unknown|QS:/;

interface RawRef { where: string; credit: string; license: string; title: string }

/** Every image ref the app reads: the keyed images.json and the refs inlined in field.json. */
function allRefs(): { images: RawRef[]; field: RawRef[] } {
  const load = (rel: string) => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf8')) as Record<string, unknown>;
  const images: RawRef[] = [];
  const im = load('images.json') as Record<string, Record<string, { credit: string; license: string; title: string }>>;
  for (const group of ['archetypes', 'families', 'occurrences'] as const) {
    for (const [id, r] of Object.entries(im[group])) images.push({ where: `${group}/${id}`, credit: r.credit, license: r.license, title: r.title });
  }
  const field: RawRef[] = [];
  const f = load('field.json') as Record<string, { id: string; image?: { credit: string; license: string; title: string } }[]>;
  for (const group of ['archetypes', 'families', 'occurrences', 'cultures'] as const) {
    for (const e of f[group]) if (e.image) field.push({ where: `${group}/${e.id}`, credit: e.image.credit, license: e.image.license, title: e.image.title });
  }
  return { images, field };
}

describe('the credit a reader sees (the audit table)', () => {
  it.each(CREDITS)('sanitiseCredit(%j) -> %j', (input, expected) => {
    expect(sanitiseCredit(input)).toBe(expected);
  });

  it.each(LICENCES)('sanitiseLicense(%j) -> %j', (input, expected) => {
    expect(sanitiseLicense(input)).toBe(expected);
  });

  it.each(TITLES)('sanitiseTitle(%j) -> %j', (input, expected) => {
    expect(sanitiseTitle(input)).toBe(expected);
  });

  it('is idempotent on the table', () => {
    for (const [input] of CREDITS) expect(sanitiseCredit(sanitiseCredit(input))).toBe(sanitiseCredit(input));
    for (const [input] of TITLES) expect(sanitiseTitle(sanitiseTitle(input))).toBe(sanitiseTitle(input));
    for (const [input] of LICENCES) expect(sanitiseLicense(sanitiseLicense(input))).toBe(sanitiseLicense(input));
  });
});

describe('the caption line', () => {
  it('joins the cleaned credit and the licence, skipping empties', () => {
    expect(creditLine({ credit: 'Rembrandt', license: 'Public domain' })).toBe('Rembrandt · Public domain');
    expect(creditLine({ credit: '', license: 'CC0' })).toBe('CC0');
    expect(creditLine({ credit: 'Rembrandt' })).toBe('Rembrandt');
    expect(creditLine({})).toBe('');
  });

  it('shows the Met credit and licence for the phallus plate', () => {
    expect(creditLine({
      credit: 'This file was donated to Wikimedia Commons as part of a project by the Metropolitan Museum of Art . See the Image and Data Resources Open Access Policy',
      license: 'CC0',
    })).toBe('Metropolitan Museum of Art · CC0');
  });

  it('keeps the unclipped line for the title attribute', () => {
    const long = 'Anonymous Russian icon painter of the Old Believer workshops at Vetka and the Stary Dub district, school of the eighteenth century';
    const ref = { credit: long, license: 'Public domain' };
    const shown = creditLine(ref);
    expect(shown.split(' · ')[0].length).toBeLessThanOrEqual(90);
    expect(shown.endsWith('… · Public domain')).toBe(true);
    expect(creditLineFull(ref)).toBe(`${cleanCredit(long)} · Public domain`);
  });
});

describe('the clip', () => {
  const long = 'Anonymous Russian icon painter of the Old Believer workshops at Vetka and the Stary Dub district and the surrounding villages';

  it('cuts at a word boundary with an ellipsis, at most 90 characters', () => {
    const out = sanitiseCredit(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(90);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
    expect(out.slice(0, -1).endsWith(' ')).toBe(false);
  });

  it('is stable once clipped', () => {
    const out = sanitiseCredit(long);
    expect(sanitiseCredit(out)).toBe(out);
  });
});

describe('the image register, every ref in the data', () => {
  const { images, field } = allRefs();

  it('reads every ref in images.json and field.json', () => {
    expect(images.length).toBeGreaterThan(400);
    expect(field.length).toBeGreaterThan(400);
  });

  it.each([
    ['images.json', () => images],
    ['field.json', () => field],
  ])('%s: outputs are idempotent, non-empty, free of dumps, and within the length bound', (_name, refs) => {
    for (const r of refs()) {
      const credit = sanitiseCredit(r.credit);
      const title = sanitiseTitle(r.title);
      const license = sanitiseLicense(r.license);
      expect(sanitiseCredit(credit), `${r.where} credit idempotent`).toBe(credit);
      expect(sanitiseTitle(title), `${r.where} title idempotent`).toBe(title);
      expect(sanitiseLicense(license), `${r.where} licence idempotent`).toBe(license);
      if (r.credit.trim()) expect(credit, `${r.where} credit non-empty`).not.toBe('');
      if (r.title.trim()) expect(title, `${r.where} title non-empty`).not.toBe('');
      expect(BAD.test(credit), `${r.where} credit ${JSON.stringify(credit)}`).toBe(false);
      expect(BAD.test(title), `${r.where} title ${JSON.stringify(title)}`).toBe(false);
      expect(credit.length, `${r.where} credit length`).toBeLessThanOrEqual(91);
    }
  });

  it('counts the refs whose credit is still the bare "Wikimedia Commons" (reported, not hidden)', () => {
    const generic = (refs: RawRef[]) => refs.filter((r) => sanitiseCredit(r.credit) === 'Wikimedia Commons').map((r) => r.where);
    const a = generic(images);
    const b = generic(field);
    console.log(`credit "Wikimedia Commons" still shown: images.json ${a.length} (${a.join(', ')}); field.json ${b.length}`);
    expect(b.length).toBe(a.length);
  });
});
