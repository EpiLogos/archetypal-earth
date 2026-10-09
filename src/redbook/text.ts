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

const GERMAN_WORDS = /\b(die|der|das|und|einer|einen|auf|ich|nicht|ist|den|dem|sich|Die|Der|Das|Und|Ich|Nicht|Ist|Auf)\b/g;
const MAX_QUOTE_WORDS = 90;

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The blackletter folios are quoted in German beside the English translation: only the translation is a key passage. */
export function isGerman(s: string): boolean {
  return /[äöüßÄÖÜ]/.test(s) || (s.match(GERMAN_WORDS)?.length ?? 0) >= 2;
}

/** One quotation, fitted to a card: a whole sentence, six words or more, never a fragment or a caption. */
function fitQuotation(t: string): string | null {
  if (!t || t.endsWith(':') || isGerman(t) || wordCount(t) < 6) return null;
  // a lower-case opening is a sentence torn from its narration: only accepted when it is long enough to stand
  if (!/^[A-Z]/.test(t) && wordCount(t) < 10) return null;
  if (wordCount(t) <= MAX_QUOTE_WORDS) return t;
  let out = '';
  for (const s of t.match(/[^.!?]+[.!?]+(\s|$)/g) ?? []) {
    if (wordCount(out + s) > MAX_QUOTE_WORDS) break;
    out += s;
  }
  out = out.trim();
  return wordCount(out) >= 6 ? out : null;
}

/** The first verbatim quotation in the body: quotes are the odd-numbered segments of the split on the double quote. */
export function firstQuotation(paragraphs: readonly string[]): string | null {
  for (const p of readerBody(paragraphs)) {
    const parts = p.split('"');
    for (let i = 1; i < parts.length; i += 2) {
      const q = fitQuotation(parts[i].trim());
      if (q) return q;
    }
  }
  return null;
}

export interface KeyPassage {
  words: string;
  footer: string;
}

/**
 * The stop's key words, leading the card: the field's own quote; else the curated genesis words that
 * name this stop; else the first verbatim quotation in its body. Each carries its own cite.
 */
export function keyPassage(o: Occurrence, genesis?: GenesisRow): KeyPassage | null {
  const cite = o.jung[0];
  if (o.quote) return { words: o.quote, footer: cite ? citeLine(cite) : '' };
  if (genesis) return { words: genesis.words, footer: genesisCite(genesis.cite) };
  const words = firstQuotation(o.body ?? []);
  return words ? { words, footer: cite ? citeLine(cite) : '' } : null;
}
