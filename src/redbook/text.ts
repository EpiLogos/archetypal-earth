// Reader-facing text for the Red Book card: pure and DOM-free, so the rules are unit-tested
// against the real field. Nothing here writes prose: it chooses among verbatim passages and
// renders cites in the core's voice (jungLine), with the Red Book's own works named in full.
import type { Cite, Occurrence } from '../types/field';
import type { GenesisRow } from '../types/redbook';
import { jungLine } from '../ui/format';

/** The Red Book's own works. The field and the curation name them by slug; the reader sees these titles. */
export const RED_BOOK_WORKS: Record<string, string> = {
  'liber-novus': 'Liber Novus',
  redbook: 'The Red Book',
  memories: 'Memories, Dreams, Reflections',
};

/** The readings a genesis row can name, as history.json titles them. */
export const READING_TITLES: Record<string, string> = {
  'jung-aion': 'Aion',
  'jung-turn': 'The Turn',
  'jung-aquarius-horizon': 'The Aquarius Horizon',
};

/** Plate-inventory paragraphs ("PLATE (p0046.jpg …", "Plate (…", "PLATES: …") are the vault's, never the reader's. */
const PLATE_PARAGRAPH = /^PLATES?\b\s*[(:]/i;
/** Plate inventory merged into the prose of a paragraph: the reader keeps the sentences before it. */
const PLATE_INVENTORY = /\bPLATES?\s*[(:]\s*p\d{4}\.jpg/i;

export function readerBody(paragraphs: readonly string[]): string[] {
  const kept: string[] = [];
  for (const p of paragraphs) {
    if (PLATE_PARAGRAPH.test(p.trim())) continue;
    const at = p.search(PLATE_INVENTORY);
    const text = at < 0 ? p : p.slice(0, at).trim();
    if (text) kept.push(text);
  }
  return kept;
}

/** A cite as the reader sees it: the Red Book's works by name, and no slug left in the locator. */
export function readerCite(c: Cite): Cite {
  return { ...c, workTitle: RED_BOOK_WORKS[c.work] ?? c.workTitle, locator: c.locator.replace(/^liber-novus\s+/i, '') };
}

export function citeLine(c: Cite): string {
  return jungLine(readerCite(c));
}

/** A genesis row's cite, written as the curation holds it ("redbook pdf p232") → "Jung · The Red Book · pdf p232". */
export function genesisCite(cite: string): string {
  const m = /^(\S+)\s+(.+)$/.exec(cite.trim());
  const title = m ? RED_BOOK_WORKS[m[1]] : undefined;
  return m && title ? jungLine({ work: m[1], workTitle: title, year: '', locator: m[2] }) : cite;
}

/**
 * Body-derived key passages, vetted one by one: the only stops whose key words are a quotation the field
 * holds in the stop's own body. Each is verbatim in that body (the unit test checks it against field.json).
 * Any other stop with neither a field quote nor a curated genesis word has no key passage: nothing is invented.
 */
export const VETTED_BODY_QUOTES: Record<string, string> = {
  "liber-novus-god-in-egg-incantations-ms50": "Set the egg before you, the God in his beginning. / And behold it. / And incubate it with the magical warmth of your gaze",
  "liber-novus-dead-serpent-umbilical-cord-ms111": "The serpent fell dead unto the earth. And that was the umbilical cord of a new birth",
  "liber-novus-atmavictu-kabir-manikin-ms117": "The dragon wants to eat the sun and the youth beseeches him not to. But he eats it nevertheless.",
  "liber-novus-cabiri-holy-water-caster-ms123": "This is the caster of holy water. The Cabiri grow out of the flowers which spring from the body of the dragon. Above is the temple",
  "liber-novus-lapis-atmavictu-stone-face-ms122": "This stone, set so beautifully, is certainly the Lapis Philosophorum. It is harder than diamond. But it expands into space through four distinct qualities, namely breadth, height, depth, and time. It is hence invisible and you can pass through it without noticing it. The four streams of Aquarius flow from the stone. This is the incorruptible seed that lies between the father and the mother and prevents the heads of both cones from touching: it is the monad which countervails the Pleroma.",
  "liber-novus-sermones-man-is-a-gateway-lonely-star-pdf385": "Man is a gateway, through which you pass from the outer world of Gods, daimons, and souls into the inner world, out of the greater, into the smaller world... At immeasurable distance a lonely star stands in the zenith. This is the one God of this one man, this is his world, his Pleroma, his divinity. In this world, man is Abraxas, the creator and destroyer of his own world. This star is the God and the goal of man",
  "liber-novus-epilogue-1959-ms190": "I worked on this book for 16 years. My acquaintance with alchemy in 1930 took me away from it. The beginning of the end came in 1928, when Wilhelm sent me the text of the 'Golden Flower,' an alchemical treatise. There the contents of this book found their way into actuality and I could no longer continue working on it. To the superficial observer, it will appear like madness. It would also have developed into one, had I not been able to absorb the overpowering force of the original experiences.",
};

export interface KeyPassage {
  words: string;
  footer: string;
}

/**
 * The stop's key words, leading the card: the field's own quote; else the curated genesis words that
 * name this stop; else a vetted quotation from its body. Each carries its own cite. Else none.
 */
export function keyPassage(o: Occurrence, genesis?: GenesisRow): KeyPassage | null {
  const cite = o.jung[0];
  if (o.quote) return { words: o.quote, footer: cite ? citeLine(cite) : '' };
  if (genesis) return { words: genesis.words, footer: genesisCite(genesis.cite) };
  const words = VETTED_BODY_QUOTES[o.id];
  return words && cite ? { words, footer: citeLine(cite) } : null;
}
