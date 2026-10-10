// The amplification engine (Thread 4): Jung's method as a function. A word or a dream's text is matched against the
// field's own names for its image families and archetypes (the vault's names and aliases, nothing typed here); a family
// is then laid out as Jung laid images out: its definition in his words, its dated instances in order, the dreams and
// visions among them as parallels, and the archetypes it expresses (with the basis of each tie).
// Pure over the model: no DOM, no storage, testable.
import type { Model } from '../data/model';
import type { Archetype, Family, Occurrence, TieBasis } from '../types/field';

export interface ImageMatch {
  start: number;
  end: number;
  text: string;
  target: { type: 'family' | 'archetype'; id: string };
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[’']/g, "'").trim();
/** A naive singular: enough to meet "snakes" with "snake" and "boxes" with "box", never to invent a word. */
const singular = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && /(ches|shes|xes|ses)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Words too common to name an image on their own, even where a vault alias happens to be one. */
const TOO_COMMON = new Set(['the', 'a', 'an', 'one', 'man', 'woman', 'old', 'it', 'he', 'she', 'world', 'life', 'god', 'self']);

export interface Vocabulary {
  /** phrase (normalised, singular last word) → target */
  phrases: Map<string, ImageMatch['target']>;
  /** the longest phrase, in words */
  longest: number;
}

export function vocabulary(m: Model): Vocabulary {
  const phrases = new Map<string, ImageMatch['target']>();
  const add = (t: string, target: ImageMatch['target']) => {
    const words = norm(t).replace(/[^\p{L}\p{N}' -]+/gu, ' ').split(/[\s-]+/).filter(Boolean);
    if (!words.length) return;
    if (words[0] === 'the' && words.length > 1) words.shift();
    const key = [...words.slice(0, -1), singular(words[words.length - 1])].join(' ');
    if (words.length === 1 && TOO_COMMON.has(key)) return;
    if (!phrases.has(key)) phrases.set(key, target);
  };
  // archetypes first: "shadow", "anima", "great mother" name the archetype, not a family that borrows the word
  for (const a of m.field.archetypes) { add(a.name, { type: 'archetype', id: a.id }); add(a.id, { type: 'archetype', id: a.id }); }
  for (const f of m.field.families) {
    add(f.name, { type: 'family', id: f.id });
    add(f.id, { type: 'family', id: f.id });
    for (const al of f.aliases) add(al, { type: 'family', id: f.id });
  }
  let longest = 1;
  for (const k of phrases.keys()) longest = Math.max(longest, k.split(' ').length);
  return { phrases, longest: Math.min(longest, 5) };
}

/** The images a text names, longest phrase first, non-overlapping, in reading order. */
export function matchImages(v: Vocabulary, text: string): ImageMatch[] {
  const tokens: { word: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}']+/gu)) tokens.push({ word: singular(norm(m[0])), start: m.index!, end: m.index! + m[0].length });
  const out: ImageMatch[] = [];
  for (let i = 0; i < tokens.length;) {
    let used = 0;
    for (let n = Math.min(v.longest, tokens.length - i); n >= 1 && !used; n--) {
      const target = v.phrases.get(tokens.slice(i, i + n).map((t) => t.word).join(' '));
      if (target) {
        out.push({ start: tokens[i].start, end: tokens[i + n - 1].end, text: text.slice(tokens[i].start, tokens[i + n - 1].end), target });
        used = n;
      }
    }
    i += used || 1;
  }
  return out;
}

/** Families and archetypes whose names begin with (or contain) a query: the Symbols search. */
export function findImages(_m: Model, v: Vocabulary, query: string, limit = 8): ImageMatch['target'][] {
  const q = singular(norm(query).replace(/[^\p{L}\p{N}' ]+/gu, ' ').trim());
  if (!q) return [];
  const exact = v.phrases.get(q);
  const seen = new Set<string>();
  const out: ImageMatch['target'][] = [];
  const push = (t: ImageMatch['target']) => { const k = `${t.type}:${t.id}`; if (!seen.has(k)) { seen.add(k); out.push(t); } };
  if (exact) push(exact);
  const starts: [string, ImageMatch['target']][] = [];
  const contains: [string, ImageMatch['target']][] = [];
  for (const [k, t] of v.phrases) {
    if (k.startsWith(q)) starts.push([k, t]);
    else if (q.length >= 3 && k.includes(q)) contains.push([k, t]);
  }
  for (const [, t] of [...starts.sort((a, b) => a[0].length - b[0].length), ...contains.sort((a, b) => a[0].length - b[0].length)]) push(t);
  // more instances first among equals is not wanted: the name the person typed leads
  return out.slice(0, limit);
}

export interface Amplification {
  family: Family;
  /** every dated instance of the family, oldest first (occurrence indices) */
  instances: number[];
  /** the dreams and visions among them: the parallels to a dream image */
  dreams: number[];
  archetypes: { archetype: Archetype; basis: TieBasis }[];
  /** the families that appear in the same loci most often */
  companions: { family: Family; count: number }[];
  span: { from: Occurrence; to: Occurrence } | null;
}

export function amplify(m: Model, familyId: string, passes: (i: number) => boolean = () => true): Amplification | null {
  const family = m.famById.get(familyId);
  if (!family) return null;
  const instances = (m.famOcc.get(familyId) ?? []).filter(passes);
  const dreams = instances.filter((i) => m.occ[i].locusType === 'dream' || m.occ[i].locusType === 'vision');
  const archetypes = family.archetypes.map((t) => ({ archetype: m.archById.get(t.id)!, basis: t.basis })).filter((x) => !!x.archetype);
  const co = new Map<string, number>();
  for (const i of instances) for (const f of m.occ[i].coFamilyIds) if (f !== familyId) co.set(f, (co.get(f) ?? 0) + 1);
  const companions = [...co].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, count]) => ({ family: m.famById.get(id)!, count })).filter((x) => !!x.family);
  const span = instances.length ? { from: m.occ[instances[0]], to: m.occ[instances[instances.length - 1]] } : null;
  return { family, instances, dreams, archetypes, companions, span };
}

/** All dream and vision instances in the field (the corpus's dream evidence), indices. */
export function dreamEvidence(m: Model): number[] {
  const out: number[] = [];
  m.occ.forEach((o, i) => { if (o.locusType === 'dream' || o.locusType === 'vision') out.push(i); });
  return out;
}
