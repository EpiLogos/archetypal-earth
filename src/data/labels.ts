// The provider's words (C2-b8): the founding corpus is named by its provider, in data, never in code. Every line a
// person reads that names whose field this is, whose word a tie is, or whose reading a page follows reads its words
// here. The code carries only the neutral defaults below; the boot binds the provider's own labels
// (FieldMeta.provider.labels) once the field has loaded, so a field that declares none reads in a voice that names no
// one. A line is read when it is drawn, never captured at import: the binding comes after the modules load.
import type { ProviderLabels } from '../types/field';

export type Labels = Readonly<Required<ProviderLabels>>;

export const NEUTRAL_LABELS: Labels = {
  landing: 'This is the whole field in one place: every archetype, symbol and instance it holds, set where and when it appeared and cited to its source. Everything in it connects back to one centre, the Self. That’s where it starts.',
  lensAion: 'A history of the aeons, Pisces to Aquarius.',
  lensAstrology: 'Your birth sky, read through the field.',
  readingTagline: 'An archetypal reading of history',
  readingOwnText: 'Asserted in the reading’s own text',
  conventionOwn: 'The reading’s equal months',
  skyClockLede: 'Where the spring equinox lies among the stars is a calculation, and it depends on how the zodiac is drawn. These are the sky’s own boundaries under stated conventions, set beside the reading’s months, which stay as the reading gives them. Nothing here is a forecast.',
  skyClockOwnSpan: 'The reading’s display boundaries',
  skyClockFishes: 'The two fishes are the reading’s division of Pisces; no astronomical convention divides it.',
  skyClockMarkBy: 'The reading',
  dynamicsOwnText: "Asserted in the source's own text",
  dynamicsOtherText: "Van Eenwyk's reading — not the source's",
  theoryRoute: 'Theory',
  voiceHeading: 'The source',
  basisOwn: 'Source',
  tieOwnNote: ' (the source’s tie)',
  citesHeading: 'Cited texts',
  citesMeet: 'Where the reading meets it',
  citePrefix: '',
  tieOwnLink: 'the source’s own link',
  astrologyIntro: 'Enter a birthday and you get a walk through that sky, planet by planet, with what the field holds on each planet and sign.',
  astrologySun: 'Every walk here ends at the Sun, read as a symbol of the self. So whoever’s chart it is, the line runs to the same centre.',
  astrologyOtherTies: 'Links the atlas draws, not the source',
  astrologyOtherTiesOnly: 'Links the atlas draws (the source gives none)',
  astrologyCharts: 'The charts and your birth form',
  quaternityLink: 'The four: the elements, the functions',
  coincidencesFraming: 'On what counts, and on runs of chance',
  dreamsIntro: 'Write a dream down. The images in it that the field knows are picked out; each one opens onto the dreams and visions in the corpus that carry the same image, so the dream is read beside its parallels.',
  dreamsMethod: 'How a dream is read',
  symbolsIntro: 'Name a symbol and see how it runs through the field: what its source says it is, every dated instance of it, the dreams and visions it turns up in, and what it expresses.',
  symbolsNone: 'It holds the images its sources write about, under the names they use.',
  amplifyTieOwn: 'its source ties it',
  amplifyDreams: 'The dreams and visions in the corpus where this image appears: the parallels lined up beside a dream image.',
  amplifyNoDefinition: 'The source gives no definition of this image in its records.',
  subjectOwn: 'the author’s own',
  redbookLede: 'Each vision of the book, and what it became in the later work.',
  birthFraming: 'the sky at that moment, read in the field’s keys',
  birthLimits: 'It states where the Sun, Moon and planets stood and links each to what the field holds of it. It makes no forecast and passes no verdict on a person.',
};

let bound: Labels = NEUTRAL_LABELS;

/** Bind the provider's labels. A key it leaves out keeps its neutral default; a key the code does not read is ignored. */
export function setProviderLabels(labels: ProviderLabels | null | undefined): void {
  const next: Record<string, string> = { ...NEUTRAL_LABELS };
  for (const [key, words] of Object.entries(labels ?? {})) if (key in NEUTRAL_LABELS && typeof words === 'string') next[key] = words;
  bound = next as Labels;
}

/** The words in force: the provider's where it gave them, the neutral defaults elsewhere. */
export function providerLabels(): Labels {
  return bound;
}
