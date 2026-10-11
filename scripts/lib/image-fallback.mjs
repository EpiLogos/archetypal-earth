// The acceptance rule for automatic (uncurated) image picks. Pure: no network, no disk.
// Used by scripts/images.mjs and tested by tests/data/images-fallback.test.ts.
//
// An automatic pick has no curator. It is accepted only when all of these hold:
//   1. a node name or alias occurs in the file title or description as a whole word;
//   2. that name is not the start of another proper name ("Seven Sisters", "Ether Dome",
//      "Princess Sophia") — a capitalised word directly after it in the file title;
//   3. the file reads as art: the ART vocabulary appears in title, description, categories
//      or object name;
//   4. no photograph, daguerreotype, numeral, typeface, satire or caricature marker;
//   5. no BAD_TITLE / BAD_CATS junk (logos, maps, diagrams, stamps …);
//   6. the scorer's result is at least MIN_FALLBACK_SCORE.

/** Floor for an automatic pick. The scorer tops out near 104 (rank 40, size 10, art 24,
 *  query overlap 30). 70 is the floor the curated close-match pass already uses. The score
 *  does not separate the audited wrong picks (they scored 82–96): rules 1–5 do. The floor
 *  only drops the weakest matches. */
export const MIN_FALLBACK_SCORE = 70;

export function fold(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/cauldron/g, 'caldron');
}

export const ART = /(manuscript|codex|miniature|illuminat|engraving|woodcut|etching|lithograph|plate|fresco|relief|sculpture|statue|statuette|bronze|marble|mosaic|vase|amphora|krater|lekythos|painting|oil on|tempera|tapestry|emblem|alchem|stele|tomb|sarcophag|papyrus|cylinder seal|intaglio|gem|historical images|paintings|sculptures|woodcuts|engravings|museum|temple|cathedral|miniatures|drawings|reliefs|artwork|icon|ivory|terracotta|bas-relief)/i;

export const BAD_TITLE = /\b(logo|icon|flag|map|maps|diagram|chart|graph|coat of arms|stamp|banner|screenshot|template|poster|pdf|djvu|index|contents|cover|title ?page|signature|autograph|catalogue|wikimania|selfie|bookplate|invoice|passport|typeface|font|sketch of)\b|\b(IMG|DSC|DSCN|DSCF|PXL|P\d{7}|SAM)[_ -]?\d{3,}/i;
export const BAD_CATS = /(portraits of living|photographs by|wikimania|maps of|diagrams|logos|flags of|coats of arms|postage stamps|selfies|banknotes|coins of the|bookplates|signatures|text pages|book covers|title pages)/i;

/** Markers that make a file a modern photograph, a number glyph, a type specimen or a satirical print. */
const FALLBACK_NOT = /\b(photo|photos|photograph|photographs|photographic|photographed|daguerreotypes?|cropped|selfie|snapshot|digits?|numerals?|typeface|font|glyph|logo|satir\w*|caricatur\w*|cartoons?|lampoons?|parod\w*)\b/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A name as a regular expression over folded text: its words, whitespace between them, an optional plural s. */
function phrasePattern(name) {
  const words = fold(name).trim().split(/\s+/).filter(Boolean).map(escapeRe);
  return words.length ? `${words.join('[^a-z0-9]+')}s?` : '';
}

/** True when the folded name occurs in the folded text as a whole word (not inside "together" or "whether"). */
export function wholeWordIn(text, name) {
  const p = phrasePattern(name);
  return !!p && new RegExp(`(?:^|[^a-z0-9])${p}(?:[^a-z0-9]|$)`).test(fold(text));
}

/** True when the name is directly followed by a capitalised word in the raw title: "Seven Sisters", "Princess Sophia". */
function startsAnotherProperName(title, name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean).map(escapeRe).join('\\s+');
  if (!words) return false;
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${words})\\s+(\\p{L}[\\p{L}'’-]*)`, 'giu');
  for (const m of title.matchAll(re)) {
    if (/^\p{Lu}/u.test(m[1])) return true;
  }
  return false;
}

/**
 * Decide whether an automatic candidate may be used for a node.
 * @param {{title?: string, descr?: string, cats?: string[], objectName?: string}} c
 * @param {{names?: string[], score?: number}} opts  names = the node's name and aliases (or, for a
 *        passage, its distinctive words); score = the scorer's result for this candidate.
 * @returns {{ok: true} | {ok: false, why: string}}
 */
export function acceptFallback(c, { names = [], score = 0 } = {}) {
  const no = (why) => ({ ok: false, why });
  const usable = names.map((n) => String(n ?? '').trim()).filter((n) => n.length >= 3);
  if (!usable.length) return no('no name to test');
  const title = String(c.title ?? '').replace(/^File:/, '');
  const descr = String(c.descr ?? '');
  const cats = (c.cats ?? []).join(' ');
  const objectName = String(c.objectName ?? '');
  const hits = usable.filter((n) => wholeWordIn(`${title} ${descr}`, n));
  if (!hits.length) return no('name is not a whole word in title or description');
  if (hits.some((n) => startsAnotherProperName(title, n))) return no('name starts another proper name');
  const all = `${title} ${descr} ${cats} ${objectName}`;
  if (!ART.test(all)) return no('no art context');
  if (FALLBACK_NOT.test(fold(all))) return no('photograph, numeral, type or satire');
  if (BAD_TITLE.test(title) || BAD_CATS.test(cats)) return no('junk title or category');
  if (!(score >= MIN_FALLBACK_SCORE)) return no(`score ${Math.round(score)} below ${MIN_FALLBACK_SCORE}`);
  return { ok: true };
}
