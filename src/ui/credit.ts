// Display-time clean-up of the credit, licence and title a reader sees on a plate (SPEC §14: no metadata dumps).
// Pure: no DOM, no data writes. Every output derives only from its input; nothing is invented, and a
// non-empty input never yields an empty output. Source data stays as it is in public/data/*.json.

/** The displayed credit is at most this long, ellipsis included. */
const MAX_CREDIT = 90;

/** Hosts whose URL is the institution's own page: the credit is the institution, not the address. */
const HOSTS: readonly [RegExp, string][] = [
  [/(^|\.)wellcomeimages\.org$|(^|\.)wellcomecollection\.org$/i, 'Wellcome Collection'],
  [/(^|\.)clevelandart\.org$/i, 'Cleveland Museum of Art'],
  [/(^|\.)britishmuseum\.org$/i, 'British Museum'],
  [/(^|\.)lacma\.org$/i, 'Los Angeles County Museum of Art'],
];

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const DONOR = /^This file was donated to Wikimedia Commons as part of a project by (?:the )?(.+?)\s*\.\s*See the\b.*$/i;
const HOST_URL = /^(?:Image:\s*)?https?:\/\/([^\s/?#:]+)/i;
const AVAILABLE_FROM = /^This image is available from the (.+?) website\b/i;
const NO_MACHINE_AUTHOR = /^No machine-readable author provided\.\s*(.+?) assumed\b/i;
const SMK_PHOTO = /^Photography:\s*(.+?),\s*SMK API\b/i;
const DOUBLED_UNKNOWN = /\bUnknown (author|artist|source)\s+Unknown \1\b/gi;
const ANONYMOUS_PLACE = /^Anonymous \(\s*(?:Category:)?([^)]+?)\s*\)\s*Unknown author\s*(?:\(([^)]*)\))?\s*$/i;
const FILE_NAME_TOKEN = /^\S+\.(?:jpe?g|png|tiff?|gif|svg)\s*,\s*/i;
const USER_TALK_RESIDUE = /\s*\\+\s*talk$/i;
const OWN_WORK = /^Own work\s*,\s*(.+)$/i;
const USER_OWN_WORK = /^User:\s*(.+?)\s*,\s*own work\b/i;
const PUBLIC_DOMAIN_NOTE = /\s*Public domain image \(according to [^)]*\)/i;
const GOOGLE_ART_NOTE = /\s*Details on Google Art Project$/i;
const C2RMF_FILE = /^original file:\s*(C2RMF)\b.*$/;

/** Language prefixes a Wikidata-derived title can open with ("German: Die Toteninsel …"). */
const LANGUAGE_PREFIX = /^(?:German|French|Italian|Polish|Dutch|Spanish|Danish|Russian|Tahitian|Portuguese|Czech):\s*/;
const QS_MARK = /\b(?:title|label) QS:/;

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Tags are removed by the caller; entities are decoded here. An unknown entity is left as written. */
function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Spacing and trailing punctuation of a joined credit: "Name , role." becomes "Name, role". */
function tidy(s: string): string {
  return squash(s)
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/[\s,;:]+$/, '')
    // a full stop ends the credit unless it follows an initial ("A.-K. D." keeps its period)
    .replace(/(\p{L}{2,}|[0-9)\]])\.+$/u, '$1')
    .replace(/^[\s,;:]+/, '')
    .trim();
}

const sentenceCase = (s: string): string => s.replace(/([.!?]\s+)([a-z])/g, (_, stop: string, c: string) => stop + c.toUpperCase());

/**
 * The whole credit, cleaned and not yet clipped. The plate's title attribute carries this string;
 * the caption shows `sanitiseCredit`, which is this clipped to MAX_CREDIT.
 */
export function cleanCredit(raw: string | undefined): string {
  const input = squash(decodeEntities(String(raw ?? '').replace(/<[^>]*>/g, ' ')));
  const done = (out: string): string => out || input;
  let s = input;
  let m: RegExpMatchArray | null;

  // Boilerplate that names the institution: the institution is the credit.
  if ((m = s.match(DONOR))) return done(tidy(m[1]));
  if ((m = s.match(HOST_URL))) {
    const host = m[1].toLowerCase();
    const known = HOSTS.find(([re]) => re.test(host));
    return done(known ? known[1] : host.replace(/^www\./, ''));
  }
  if ((m = s.match(AVAILABLE_FROM))) return done(tidy(m[1]));
  if ((m = s.match(NO_MACHINE_AUTHOR))) return done(tidy(m[1]));
  if ((m = s.match(SMK_PHOTO))) return done(tidy(m[1]));

  // Commons placeholders rendered twice, and the bare "Unknown Unknown".
  s = s.replace(DOUBLED_UNKNOWN, 'Unknown $1').replace(/^Unknown Unknown\b/, 'Unknown');
  if ((m = s.match(ANONYMOUS_PLACE))) {
    const note = m[2]?.trim();
    return done(tidy(`Anonymous (${m[1].trim()})${note ? `, ${note}` : ''}`));
  }

  // File-name token and user-page residue left by the upload template.
  if (FILE_NAME_TOKEN.test(s)) s = s.replace(FILE_NAME_TOKEN, '').replace(/^./, (c) => c.toUpperCase());
  s = s.replace(USER_TALK_RESIDUE, '').replace(/^w:\s*/, '');

  // "Own work , X" and "User:X , own work, date" say the same thing: X made it.
  s = s.replace(OWN_WORK, '$1 (own work)').replace(USER_OWN_WORK, '$1 (own work)');

  // Licence chatter and museum-site residue that belong to the licence line or nowhere.
  s = s.replace(PUBLIC_DOMAIN_NOTE, '').replace(GOOGLE_ART_NOTE, '');
  s = s.replace(C2RMF_FILE, '$1');

  return done(sentenceCase(tidy(s)));
}

/** Cut at a word boundary with an ellipsis; the result is at most MAX_CREDIT characters, so cutting it again changes nothing. */
function clip(s: string): string {
  if (s.length <= MAX_CREDIT) return s;
  const cut = s.slice(0, MAX_CREDIT - 1);
  const space = cut.lastIndexOf(' ');
  const base = (space >= 40 ? cut.slice(0, space) : cut).replace(/[\s,;:(\[]+$/, '');
  return `${base || cut}…`;
}

/** The credit a reader sees: cleaned, and at most MAX_CREDIT characters. */
export function sanitiseCredit(raw: string | undefined): string {
  return clip(cleanCredit(raw));
}

const CC_LOCAL_VERSION = /^(CC BY(?:-SA)? \d\.\d) (at|de|nl|pl|it|fr|es|au|ch|uk|us)$/i;

/** The licence as printed; only the national-version suffix is set in capitals ("CC BY-SA 3.0 at" -> "CC BY-SA 3.0 AT"). */
export function sanitiseLicense(raw: string | undefined): string {
  return squash(String(raw ?? '')).replace(CC_LOCAL_VERSION, (_, base: string, place: string) => `${base} ${place.toUpperCase()}`);
}

/**
 * An image title without the Wikidata dump: the English or German label when one is quoted, otherwise the text
 * before the first "title QS:" / "label QS:" marker. Titles without a dump are returned as written.
 */
export function sanitiseTitle(raw: string | undefined): string {
  const s = squash(String(raw ?? ''));
  if (!QS_MARK.test(s)) return s;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/\blabel QS:Len,\s*"\s*([^"]+?)\s*"/))) return m[1];
  if ((m = s.match(/\btitle QS:P1476,en:\s*"\s*([^"]+?)\s*"/))) return m[1];
  const marker = s.search(/(^|\s)(title|label) QS:/);
  const head = s.slice(0, marker).trim().replace(LANGUAGE_PREFIX, '').trim();
  return head || s;
}

/** Shape of the fields a plate caption reads (ImageRef satisfies it). */
export interface CreditSource {
  credit?: string;
  license?: string;
}

const joinParts = (credit: string, license: string): string => [credit, license].filter(Boolean).join(' · ');

/** The caption line: the displayed credit and the licence, joined with ' · ', empties skipped. */
export function creditLine(ref: CreditSource): string {
  return joinParts(sanitiseCredit(ref.credit), sanitiseLicense(ref.license));
}

/** The same line without the clip: the plate's title attribute. */
export function creditLineFull(ref: CreditSource): string {
  return joinParts(cleanCredit(ref.credit), sanitiseLicense(ref.license));
}
