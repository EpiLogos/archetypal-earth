// The founding corpus is named by its provider, in data, never in code (C2-b8, O-I #755). Every line a person reads
// that names whose field this is, whose word a tie is or whose reading a page follows takes its words from
// FieldMeta.provider.labels: the code holds a neutral default for each, and Archetypal Earth's own provider data
// (curation/provider.json, published by the ingest as field.json meta.provider) supplies the words it always showed.
//   - no string in src/ names the founding author: the scan reads string and template literals, not comments;
//   - the provider data is what the field publishes, and each of its words is the line the code carried before;
//   - over those words every surface reads exactly as before; with no provider words, none names a corpus.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { NEUTRAL_LABELS, providerLabels, setProviderLabels } from '../../src/data/labels';
import type { Field, FieldProvider, ProviderLabels } from '../../src/types/field';
import { landingCopy } from '../../src/shell/landing';
import { lensDef } from '../../src/shell/lens';
import { birthFraming, birthLimits } from '../../src/sky/chart';
import { CONVENTION_INFO } from '../../src/aion/precession';
import { skyClockLede, signSpans } from '../../src/aion/skyclock';
import { SYSTEM_LABEL } from '../../src/ui/related';
import { citeLine } from '../../src/ui/format';
import { jTitle, vTitle } from '../../src/dynamics/marks';
import type { HistoryReading } from '../../src/types/history';

const ROOT = path.resolve(__dirname, '..', '..');
const provider: FieldProvider = JSON.parse(fs.readFileSync(path.join(ROOT, 'curation', 'provider.json'), 'utf8'));
const founding = provider.labels as Required<ProviderLabels>;

// The lines as the code carried them at 36ac83f, each with where it stood: the parity the provider data must keep.
const FORMER: Required<ProviderLabels> = {
  landing: 'I built this to see Jung’s whole field in one place: every archetype, symbol and instance he wrote about, set where and when it appeared and cited to the page. Everything in it connects back to one centre, which Jung called the Self. That’s where it starts.', // shell/landing.ts LANDING_COPY
  lensAion: 'Jung’s history of the aeons, Pisces to Aquarius.', // shell/lens.ts, the Aion blurb
  lensAstrology: 'Your birth sky beside Jung’s, read through the corpus.', // shell/lens.ts, the Astrology blurb
  readingTagline: 'Jung’s history of the aeons — the precession of the equinoxes through Pisces into Aquarius, read on the Earth.', // aion/view.ts
  readingOwnText: 'Asserted in Jung’s own text', // aion/view.ts, the J chip's title
  conventionOwn: 'Jung’s equal months', // aion/precession.ts CONVENTION_INFO['jung-equal']
  skyClockLede: 'Where the spring equinox lies among the stars is a calculation, and it depends on how the zodiac is drawn. These are the sky’s own boundaries under stated conventions, set beside Jung’s months, which stay as the reading gives them. Nothing here is a forecast.', // aion/skyclock.ts SKY_CLOCK_LEDE
  skyClockOwnSpan: 'Jung’s display boundaries', // aion/skyclock.ts signSpans
  skyClockFishes: 'The two fishes are Jung’s division of Pisces; no astronomical convention divides it.', // aion/skyclock-view.ts
  skyClockMarkBy: 'Jung', // aion/skyclock-view.ts, 'Jung, conditional' and 'Jung’s range'
  dynamicsOwnText: "Asserted in Jung's own text", // dynamics/marks.ts J_TITLE
  dynamicsOtherText: "Van Eenwyk's reading — not Jung's", // dynamics/marks.ts V_TITLE
  theoryRoute: "Jung's theory", // dynamics/view.ts and lenses/theory.ts Options
  voiceHeading: 'Jung', // lenses/theory.ts and ui/deep.ts, the heading over the author's own lines
  basisOwn: 'Jung', // graph/tools.ts tie filter and ui/related.ts SYSTEM_LABEL
  tieOwnNote: ' (Jung’s tie)', // ui/deep.ts
  citesHeading: 'Jung’s texts', // ui/deep.ts
  citesMeet: 'Where Jung meets it', // ui/deep.ts
  citePrefix: 'Jung', // ui/format.ts jungLine
  tieOwnLink: 'Jung’s own link', // lenses/astrology.ts BASIS and sky/orbits.ts
  astrologyIntro: 'Enter a birthday and you get a walk through that sky, planet by planet, with what Jung and Kathleen Burt wrote about each planet and sign. Jung’s own chart is here as the first one, so you can read yours beside his.',
  astrologySun: 'Every walk here ends at the Sun, and Jung reads the sun as a symbol of the self. So whoever’s chart it is, the line runs to the same centre.',
  astrologyOtherTies: 'Links the atlas draws, not Jung',
  astrologyOtherTiesOnly: 'Links the atlas draws (Jung gives none)',
  astrologyCharts: 'Jung’s chart and your birth form',
  quaternityLink: 'Jung’s four: the elements, the functions', // lenses/card-reading.ts
  coincidencesFraming: 'Jung on what counts, and on runs of chance', // lenses/coincidences.ts
  dreamsIntro: 'Write a dream down. The images in it that the field knows are picked out; each one opens onto the dreams and visions in the corpus that carry the same image. That is how Jung read a dream: by lining it up with its parallels.',
  dreamsMethod: 'How Jung read a dream',
  symbolsIntro: 'Name a symbol and see how it runs through the field: what Jung said it is, every dated instance of it, the dreams and visions it turns up in, and what it expresses.',
  symbolsNone: 'It holds the images Jung wrote about, under the names his texts use.',
  amplifyTieOwn: 'Jung ties it', // practice/amplify-view.ts BASIS
  amplifyDreams: 'The dreams and visions in the corpus where this image appears: the parallels Jung lined up beside a dream image.',
  amplifyNoDefinition: 'Jung gives no definition of this image in the vault’s records.',
  subjectOwn: 'Jung’s own', // practice/amplify-view.ts and lenses/depth.ts, a record of the author's own
  redbookLede: 'Each vision of the book, and what it became in Jung’s later work.', // redbook/view.ts
  birthFraming: 'the sky at that moment, read in Jung’s keys', // sky/chart.ts BIRTH_FRAMING
  birthLimits: 'It states where the Sun, Moon and planets stood and links each to what Jung wrote of it. It makes no forecast and passes no verdict on a person.', // sky/chart.ts BIRTH_LIMITS
};

/** Every string and template literal in a source file, with its line: what a person can be shown. Comments are not read. */
function literals(file: string): { line: number; text: string }[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      out.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? sources(p) : /\.ts$/.test(d.name) ? [p] : [];
  });
}

const reading = (): HistoryReading => {
  const history = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'history.json'), 'utf8'));
  return history.readings[0];
};

afterEach(() => setProviderLabels(founding)); // the suite's own setup binds the founding words; a test that unbinds restores them

describe('the founding corpus is named by its provider, in data (C2-b8)', () => {
  it('no string in src/ names the founding author: those words are the provider’s', () => {
    // src/dev/ is the dev server's synthetic fixture, never part of a build (vite only serves it in dev)
    const found = sources(path.join(ROOT, 'src'))
      .filter((f) => !f.includes(`${path.sep}dev${path.sep}`))
      .flatMap((f) => literals(f).filter((l) => /Jung/.test(l.text)).map((l) => `${path.relative(ROOT, f)}:${l.line} ${l.text.slice(0, 60)}`));
    expect(found).toEqual([]);
  });

  it('the field publishes the provider data, and each of its words is the line the code carried before', () => {
    const field: Field = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'field.json'), 'utf8'));
    expect(field.meta.provider).toEqual(provider);
    expect(provider.name).toBe('the Jung corpus');
    expect(founding).toEqual(FORMER);
    // every key the provider names is one the code reads (a misspelt key would silently fall back to neutral)
    expect(Object.keys(founding).sort()).toEqual(Object.keys(NEUTRAL_LABELS).sort());
  });

  it('over the founding words every surface reads as before', () => {
    expect(landingCopy()).toBe(FORMER.landing);
    expect(lensDef('aion').blurb).toBe(FORMER.lensAion);
    expect(lensDef('astrology').blurb).toBe(FORMER.lensAstrology);
    expect(birthFraming()).toBe('the sky at that moment, read in Jung’s keys');
    expect(birthLimits()).toBe(FORMER.birthLimits);
    expect(CONVENTION_INFO['jung-equal'].label).toBe(FORMER.conventionOwn);
    expect(skyClockLede()).toBe(FORMER.skyClockLede);
    expect(signSpans(reading(), 'Pisces')[0].label).toBe(FORMER.skyClockOwnSpan);
    expect(SYSTEM_LABEL.jung).toBe('Jung');
    expect(jTitle()).toBe(FORMER.dynamicsOwnText);
    expect(vTitle()).toBe(FORMER.dynamicsOtherText);
    expect(citeLine({ work: 'cw12', workTitle: 'Psychology and Alchemy (CW12)', year: '1944', locator: '¶561' })).toBe('Jung · Psychology and Alchemy · 1944 · ¶561');
    expect(citeLine({ work: 'thoth', workTitle: 'The Book of Thoth', year: '1944', locator: 'p. 7', voice: 'Crowley' })).toBe('Crowley · The Book of Thoth · 1944 · p. 7');
  });

  it('with no provider words every surface is neutral, and none names a corpus', () => {
    setProviderLabels(undefined);
    expect(providerLabels()).toEqual(NEUTRAL_LABELS);
    for (const [key, words] of Object.entries(NEUTRAL_LABELS)) expect(words, key).not.toMatch(/Jung/);
    for (const line of [landingCopy(), lensDef('aion').blurb, lensDef('astrology').blurb, birthFraming(), birthLimits(), CONVENTION_INFO['jung-equal'].label, skyClockLede(), signSpans(reading(), 'Pisces')[0].label, SYSTEM_LABEL.jung, jTitle(), vTitle()]) {
      expect(line).not.toMatch(/Jung/);
    }
    // no prefix at all: the cite reads from its work
    expect(citeLine({ work: 'cw12', workTitle: 'Psychology and Alchemy (CW12)', year: '1944', locator: '¶561' })).toBe('Psychology and Alchemy · 1944 · ¶561');
  });

  it('a key the provider leaves out keeps its neutral default; a key the code does not read is ignored', () => {
    setProviderLabels({ lensAion: 'A reading of the ages.', notAKey: 'x' } as ProviderLabels);
    expect(lensDef('aion').blurb).toBe('A reading of the ages.');
    expect(lensDef('astrology').blurb).toBe(NEUTRAL_LABELS.lensAstrology);
    expect(providerLabels()).not.toHaveProperty('notAKey');
  });
});
