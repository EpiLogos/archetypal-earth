// Scan-error normaliser: undoes OCR damage in vault text, never rewords.
//
// The Jung vault's scanned volumes carry known artefacts (vault SCOPE.md): capital-initial and
// mid-word splits (`T he`, `m an`, `b y m yself`), ligature glyphs, hyphenated line breaks
// (`transfor- mation`), soft hyphens, odd whitespace. This module repairs exactly those.
//
// Joining is dictionary-driven. The vocabulary is built from the CORPUS ITSELF — word frequencies of
// the clean volumes in <vault>/corpus/*.md (cw09i, cw13 and hinkle are the dirty ones and excluded) —
// so Latin, Greek transliterations, alchemical terms and proper names count as words, plus a standard
// English wordlist. Two adjacent tokens are joined only when the joined form is a known word AND at
// least one part is not (`m an` -> `man`, `T he` -> `The`, `a nd` -> `and`, but never `a man`).
// A small dynamic programme over each token run handles multi-way splits (`b y m yself`).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

export const OCR_VERSION = 4;
export const DIRTY_VOLUMES = new Set(['cw09i', 'cw13', 'hinkle-1916', 'hinkle']);

const WORD_RE = /[\p{L}][\p{L}'’]*/gu;

// ---------------------------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------------------------
/** Canonical lookup key: lowercase, possessive/clitic stripped, edge apostrophes removed. */
export function wordKey(w) {
  return w
    .toLowerCase()
    .normalize('NFC')
    .replace(/[’]/g, "'")
    .replace(/'s$/, '')
    .replace(/^'+|'+$/g, '');
}

function loadEnglish() {
  // Both lists carry junk the other lacks (`resex`, `nese`, `soland`); a word counts only when both agree,
  // or when only one list exists.
  const lists = [];
  try {
    const require = createRequire(import.meta.url);
    lists.push(new Set(require('an-array-of-english-words').map((w) => w.toLowerCase())));
  } catch { /* optional dev dependency */ }
  try {
    lists.push(new Set(fs.readFileSync('/usr/share/dict/words', 'utf8').split('\n').filter(Boolean).map((w) => w.toLowerCase())));
  } catch { /* optional */ }
  if (!lists.length) return new Set();
  if (lists.length === 1) return lists[0];
  const [a, b] = lists;
  const out = new Set();
  for (const w of a) if (b.has(w)) out.add(w);
  return out;
}

/**
 * Build (or load from cache) the vocabulary.
 * @returns {{ freq: Map<string, number>, english: Set<string>, pairs: Map<string, number>, source: object }}
 */
export function buildVocab({ vault, cacheDir, log = () => {} } = {}) {
  const corpusDir = vault ? path.join(vault, 'corpus') : null;
  const files = corpusDir && fs.existsSync(corpusDir)
    ? fs.readdirSync(corpusDir).filter((f) => f.endsWith('.md') && !DIRTY_VOLUMES.has(f.replace(/\.md$/, ''))).sort()
    : [];
  const stamp = crypto.createHash('sha1');
  stamp.update(`v${OCR_VERSION}`);
  for (const f of files) {
    const st = fs.statSync(path.join(corpusDir, f));
    stamp.update(`${f}:${st.size}:${Math.floor(st.mtimeMs)}`);
  }
  const key = stamp.digest('hex').slice(0, 16);
  const cacheFile = cacheDir ? path.join(cacheDir, 'ocr-vocab.json') : null;
  const english = loadEnglish();

  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (j.key === key || (!files.length && j.freq)) {
        log(`ocr vocabulary: cache ${path.basename(cacheFile)} (${j.words} words from ${j.files.length} volumes)`);
        return { freq: new Map(Object.entries(j.freq)), pairs: new Map(Object.entries(j.pairs || {})), english, source: { files: j.files, key: j.key, words: j.words, cached: true } };
      }
    } catch { /* rebuild */ }
  }
  if (!files.length) {
    log('ocr vocabulary: no corpus available, English wordlist only');
    return { freq: new Map(), pairs: new Map(), english, source: { files: [], key: 'none', words: 0, cached: false } };
  }

  const freq = new Map();
  const seq = [];
  const TOK = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;
  for (const f of files) {
    const text = fs.readFileSync(path.join(corpusDir, f), 'utf8');
    for (const line of text.split('\n')) {
      if (line.startsWith('<!--')) continue;
      let prev = '';
      for (const m of line.matchAll(TOK)) {
        const raw = m[0];
        if (/\p{N}/u.test(raw)) { prev = ''; continue; } // "19th", "p268", "n5": not words
        const k = wordKey(raw);
        if (k.length < 2 && k !== 'a' && k !== 'i') { prev = ''; continue; }
        freq.set(k, (freq.get(k) || 0) + 1);
        if (prev) seq.push(prev + ' ' + k);
        prev = k;
      }
    }
    log(`  corpus ${f}`);
  }
  // pair statistics, kept only for pairs whose concatenation is itself a frequent word
  const pairs = new Map();
  for (const p of seq) {
    const [a, b] = p.split(' ');
    const j = a + b;
    if ((freq.get(j) || 0) >= 8) pairs.set(p, (pairs.get(p) || 0) + 1);
  }
  const keep = {};
  for (const [w, c] of freq) if (c >= 2 || w === 'a' || w === 'i') keep[w] = c;
  const out = { key, files, words: Object.keys(keep).length, freq: keep, pairs: Object.fromEntries(pairs) };
  if (cacheFile) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(out));
  }
  log(`ocr vocabulary: built from ${files.length} clean volumes (${out.words} words, >=2 occurrences)`);
  return { freq: new Map(Object.entries(keep)), pairs, english, source: { files, key, words: out.words, cached: false } };
}

// ---------------------------------------------------------------------------------------------
// evidence model
// ---------------------------------------------------------------------------------------------
// Whether a split run should be joined is a likelihood comparison, not a yes/no dictionary test:
//   split reading  = the tokens are separate words      P(a) * P(b) ...
//   joined reading = one word that OCR broke apart      P(ab) * eps per break
// `m an` joins (P(m) is nil), `a man` does not (P(aman) is nil), `Sol and` does not (soland is rare),
// `Him alaya` does (Himalaya is far commoner than the chance meeting of two rare words).
const SHORT_WORDS = new Set(
  ('a am an as at be by do go he if in is it me my no of on or so to up us we ' +
    'ace act add age ago aid aim air all and any are arm art ask ate bad bag bed big bit box boy but buy can cap car cat cry cut dad day did die dig dog dry due ear eat egg end eye far fat few fit fly for fox fun gap gas get god got gun had has hat her hid him his hit hot how hut ice ill ink its job joy key kid kin lad lap law lay led leg let lid lie lip lit log lot low mad man map may men met mix mud nor not now nut oak odd off oil old one our out owe own pay pen per pet pie pin pit pot put raw ray red rib rid rod row run sad sat saw say sea see set sew she shy sin sir sit six sky son sow spy sun tap tar tax tea ten the tie tin tip toe too top toy try two use van war was way web wed wet who why win wit won woe yes yet you').split(' '),
);
const ENGLISH_FLOOR = 6; // an English-list word the corpus never shows still counts as a (rare) word
const MIN_JOIN = 8; // a word the corpus shows at least this often (6 suffices when a part is plainly a fragment)
const MIN_JOIN_FRAGMENT = 6;
const JOIN_MARGIN = 1; // log-odds a break must clear when a part is not a word
const JOIN_MARGIN_KNOWN = 1.5; // ... when every part is a word (`sham an`)
const EPS_SHARP = 0.2; // a break that leaves a single stray letter (the classic `T he`, `m an`)
const EPS_PLAIN = 0.02; // any other break

export function singleLetterWord(c) {
  return c === 'a' || c === 'A' || c === 'I' || c === 'O';
}

export function makeLexicon(vocab, exceptions = {}) {
  const { freq, english, pairs } = vocab;
  const extra = new Set((exceptions.knownWords || []).map((w) => w.toLowerCase()));
  let total = 0;
  for (const v of freq.values()) total += v;
  total = Math.max(total, 1_000_000);

  /** effective occurrence count of a word key */
  function count(w) {
    if (!w) return 0;
    if (w.length === 1) return w === 'a' || w === 'i' ? Math.max(freq.get(w) || 0, 20000) : 0.3;
    let c = freq.get(w) || 0;
    if (SHORT_WORDS.has(w)) c = Math.max(c, 3000);
    if (extra.has(w)) c = Math.max(c, 50);
    if (w.length >= 4 && english.has(w)) c = Math.max(c, ENGLISH_FLOOR);
    return c;
  }
  const logP = (w) => Math.log(Math.max(count(w), 0.2) / total);
  /** confidently a word */
  function isKnown(raw) {
    if (!raw) return false;
    if (raw.length === 1) return singleLetterWord(raw);
    const w = wordKey(raw);
    // short strings are noisy in a scanned corpus (`ing`, `eth`, `ea`): only the real small words count
    if (w.length <= 3) return SHORT_WORDS.has(w) || extra.has(w) || count(w) >= 300;
    return count(w) >= 8;
  }
  const strength = (raw) => count(wordKey(raw));
  /** any evidence at all that it is a word (corpus twice or the English list) */
  const isWordish = (raw) => {
    if (!raw) return false;
    if (raw.length === 1) return singleLetterWord(raw);
    const w = wordKey(raw);
    if (count(w) >= 1) return true;
    // inflected forms the lists lack (`haloed`, `nears`, `outwits`): a stem the corpus knows well
    for (const suf of ['s', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'est', 'ness', 'ful', 'less', 'ish', 'y']) {
      if (w.length > suf.length + 3 && w.endsWith(suf)) {
        const stem = w.slice(0, -suf.length);
        if (count(stem) >= 8 || (suf === 'ing' || suf === 'ed' || suf === 'er' || suf === 'est' ? count(stem + 'e') >= 8 : false)) return true;
      }
    }
    return false;
  };
  const pairCount = (a, b) => pairs.get(`${wordKey(a)} ${wordKey(b)}`) || 0;

  const sharpAt = (a, b) => (a.length === 1 && !singleLetterWord(a)) || (b.length === 1 && !singleLetterWord(b));

  /**
   * Evidence that `parts` (letters only, in order) are one word split by OCR.
   * @returns {{ odds: number, ok: boolean }} log-odds of "one broken word" over "separate words";
   *          `ok` is true only when the gates also pass (joined form is a word, a part is not, the phrase is not attested).
   */
  function joinDecision(parts) {
    const no = { odds: -Infinity, ok: false };
    if (parts.length < 2) return no;
    const j = parts.join('');
    // OCR breaks a word at the start of a fragment; a capital opening a later part begins a NEW word,
    // and a capital inside the result (`mAdam`) means the pieces were never one word
    for (let k = 1; k < parts.length; k++) if (/^\p{Lu}/u.test(parts[k])) return no;
    if (/\p{Ll}\p{Lu}/u.test(j)) return no;
    // `D E`, `B C`: runs of capital single letters are labels, not broken words
    if (parts.every((x) => x.length === 1 && /\p{Lu}/u.test(x))) return no;
    const cj = count(wordKey(j));
    const unknown = parts.some((x) => !isKnown(x));
    if (j.length < 2 || cj < (unknown ? MIN_JOIN_FRAGMENT : MIN_JOIN)) return no;
    // two-letter results (`m e`, `b y`) only from stray letters and only for the commonest words
    if (j.length === 2 && !(cj >= 1000 && parts.every((x) => x.length === 1))) return no;
    let lo = Math.log(cj / total);
    for (let k = 1; k < parts.length; k++) lo += Math.log(sharpAt(parts[k - 1], parts[k]) ? EPS_SHARP : EPS_PLAIN);
    for (const x of parts) lo -= logP(wordKey(x));
    let attested = 0;
    for (let k = 1; k < parts.length; k++) attested = Math.max(attested, pairCount(parts[k - 1], parts[k]));
    // a pair the clean volumes themselves print (`hieros gamos`, `a round`) is a phrase, not damage
    if (attested >= 3 || attested >= 0.05 * cj) return { odds: lo, ok: false };
    return { odds: lo, ok: lo >= (unknown ? JOIN_MARGIN : JOIN_MARGIN_KNOWN) };
  }
  const joinOdds = (parts) => joinDecision(parts).odds;
  const joinCost = (parts) => {
    const j = parts.join('');
    let lo = Math.log(count(wordKey(j)) / total);
    for (let k = 1; k < parts.length; k++) {
      const a = parts[k - 1], b = parts[k];
      lo += Math.log(sharpAt(a, b) ? EPS_SHARP : EPS_PLAIN);
    }
    return -lo;
  };
  return { isKnown, isWordish, strength, count, logP, joinOdds, joinDecision, joinCost, pairCount, english, total };
}

// ---------------------------------------------------------------------------------------------
// text repair
// ---------------------------------------------------------------------------------------------
const CH = (...n) => String.fromCodePoint(...n);
const BS = String.fromCharCode(92);
const LIGATURES = { [CH(0xfb00)]: 'ff', [CH(0xfb01)]: 'fi', [CH(0xfb02)]: 'fl', [CH(0xfb03)]: 'ffi', [CH(0xfb04)]: 'ffl', [CH(0xfb05)]: 'st', [CH(0xfb06)]: 'st' };
const LIG_RE = new RegExp('[' + CH(0xfb00) + '-' + CH(0xfb06) + ']', 'g');
const ODD_SPACE_RE = new RegExp('[' + [0xa0, 0x1680, 0x202f, 0x205f, 0x3000, 0x2028, 0x2029].map((c) => CH(c)).join('') + CH(0x2000) + '-' + CH(0x200a) + BS + 't' + BS + 'r' + BS + 'n' + BS + 'v' + BS + 'f]', 'g');
const ZERO_WIDTH_RE = new RegExp('[' + CH(0x200b) + '-' + CH(0x200d) + CH(0x2060) + CH(0xfeff) + ']', 'g');
const SOFT_HYPHEN = CH(0xad);
const SOFT_HYPHEN_RE = new RegExp(SOFT_HYPHEN + BS + 's*', 'g');

// the trailing group carries punctuation and hyphenated compounds (`orld-tree`): only the head word is a join part
const TOKEN_RE = /^([^\p{L}\p{N}]*)(\p{L}(?:[\p{L}'’]*\p{L})?)((?:-\p{L}(?:[\p{L}'’]*\p{L})?)*[^\p{L}\p{N}]*)$/u;
const MAX_GROUP = 10;

/**
 * Create a normaliser bound to a vocabulary.
 * @param vocab  result of buildVocab
 * @param exceptions  parsed curation/ocr-exceptions.json
 */
export function createNormalizer(vocab, exceptions = {}) {
  const lex = makeLexicon(vocab, exceptions);
  const lc = (list) => new Set((list || []).map((s) => s.toLowerCase()));
  const keepPhrases = lc(exceptions.keep); // phrases that must stay as written
  const acceptPhrases = lc(exceptions.accept); // phrases the residual scanner should not flag
  // verbatim before -> after repairs, matched on word boundaries
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forceRes = Object.entries(exceptions.join || {}).map(([from, to]) => [
    new RegExp((/^\p{L}/u.test(from) ? '(?<![\\p{L}])' : '') + esc(from) + (/\p{L}$/u.test(from) ? '(?![\\p{L}])' : ''), 'gu'),
    from,
    to,
  ]);

  /** token -> { lead, core, trail } or null when it is not a plain word token */
  const parse = (tok) => {
    const m = TOKEN_RE.exec(tok);
    return m ? { lead: m[1], core: m[2], trail: m[3] } : null;
  };

  function joinRun(tokens, changes) {
    const n = tokens.length;
    const info = tokens.map(parse);
    const single = (i) => (info[i] ? -lex.logP(wordKey(info[i].core)) : 0);
    const best = new Array(n + 1).fill(Infinity);
    const choice = new Array(n + 1).fill(1);
    best[n] = 0;
    for (let i = n - 1; i >= 0; i--) {
      best[i] = single(i) + best[i + 1];
      choice[i] = 1;
      if (!info[i] || info[i].trail) continue;
      const parts = [info[i].core];
      for (let e = i + 1; e < n && e < i + MAX_GROUP; e++) {
        const p = info[e];
        if (!p || p.lead) break;
        // `re-reads`: a hyphenated word stays whole unless its head is a long fragment (`orld-tree`) or a stray letter
        if (p.trail.startsWith('-') && p.core.length < 3 && p.core.length > 1) break;
        parts.push(p.core);
        if (parts.join('').length > 26) break;
        if (lex.joinDecision(parts).ok) {
          const phrase = parts.join(' ').toLowerCase();
          if (!keepPhrases.has(phrase)) {
            const cost = lex.joinCost(parts) + best[e + 1];
            if (cost < best[i] - 1e-9) { best[i] = cost; choice[i] = e - i + 1; }
          }
        }
        if (p.trail) break;
      }
    }
    const out = [];
    for (let i = 0; i < n;) {
      const len = choice[i];
      if (len === 1) { out.push(tokens[i]); i++; continue; }
      const first = info[i];
      const last = info[i + len - 1];
      const core = [];
      for (let k = 0; k < len; k++) core.push(info[i + k].core);
      const joined = first.lead + core.join('') + last.trail;
      changes.push({ kind: 'join', before: tokens.slice(i, i + len).join(' '), after: joined });
      out.push(joined);
      i += len;
    }
    return out;
  }

  // A few passages (CW13 notes especially) are shredded: spaces fall in the middle of words AND the
  // true word boundaries are missing (`th ea ni mu s at lea st` = `the animus at least`). Where fragments
  // cluster, re-segment the letter stream into the most probable words.
  const LETTERS_RE = /^([^\p{L}\p{N}]*)(\p{L}(?:[\p{L}'’-]*\p{L})?)([^\p{L}\p{N}]*)$/u;
  function unknownCost(len) {
    return Math.log(lex.total / 0.2) + 2.3 * (len - 1);
  }
  function wordCost(w) {
    const k = wordKey(w);
    if (k.length === 1 && !singleLetterWord(w)) return unknownCost(1) + 4;
    const c = lex.count(k);
    return c >= 6 ? -lex.logP(k) : unknownCost(w.length) + 4;
  }
  function segment(stream) {
    const n = stream.length;
    const best = new Array(n + 1).fill(Infinity);
    const back = new Array(n + 1).fill(0);
    best[0] = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = Math.max(0, i - 26); j < i; j++) {
        const w = stream.slice(j, i);
        if (/-/.test(w)) continue; // hyphens are literal boundaries, handled by the caller
        const c = best[j] + wordCost(w);
        if (c < best[i]) { best[i] = c; back[i] = j; }
      }
    }
    const words = [];
    for (let i = n; i > 0; i = back[i]) words.unshift(stream.slice(back[i], i));
    return { words, cost: best[n] };
  }
  /** Rebuild text from segmented pieces, restoring the hyphens (literal) and a space at camel breaks. */
  function rejoinParts(stream, res) {
    let out = '';
    let pos = 0;
    for (const r of res) {
      if (out) {
        // what separated this piece from the last in the stream: a hyphen, or a lower->upper camel break
        out += stream[pos] === '-' ? '-' : ' ';
        if (stream[pos] === '-') pos++;
      }
      out += r.words.join(' ');
      pos += r.words.join('').length;
    }
    return out;
  }
  function shredRun(tokens, changes) {
    const info = tokens.map((t) => LETTERS_RE.exec(t));
    const latin = (w) => /^[\p{Script=Latin}'’-]+$/u.test(w);
    const isFrag = (i) => {
      const m = info[i];
      if (!m) return false;
      const body = m[2];
      if (body.includes('-')) return false;
      if (body.length === 1) return /\p{Ll}/u.test(body) && !singleLetterWord(body) && body !== 'i';
      const w = wordKey(body);
      return body.length <= 4 && !SHORT_WORDS.has(w) && lex.count(w) < 100 && !/^\p{Lu}/u.test(body);
    };
    const out = tokens.slice();
    const used = new Array(tokens.length).fill(false);

    const tryRegion = (lo0, hi0, grow) => {
      let lo = lo0, hi = hi0;
      for (let k = 0; k < grow; k++) if (lo > 0 && info[lo - 1] && !info[lo - 1][3] && !used[lo - 1] && !info[lo][1]) lo--;
      for (let k = 0; k < grow; k++) if (hi < tokens.length - 1 && info[hi + 1] && !used[hi + 1] && !info[hi][3] && !info[hi + 1][1]) hi++;
      for (let k = lo; k <= hi; k++) {
        if (!info[k] || used[k]) return;
        if (k > lo && info[k][1]) return;
        if (k < hi && info[k][3]) return;
      }
      const lead = info[lo][1], trail = info[hi][3];
      const stream = tokens.slice(lo, hi + 1).map((_, k) => info[lo + k][2]).join('');
      // hyphens and lower->upper breaks are literal boundaries of the stream
      const parts = stream.split('-').flatMap((x) => x.split(/(?<=\p{Ll})(?=\p{Lu})/u));
      const res = parts.map((part) => segment(part));
      const newCost = res.reduce((a, r) => a + r.cost, 0);
      const oldCost = tokens.slice(lo, hi + 1).reduce((a, _, k) => a + wordCost(info[lo + k][2].replace(/-.*/, '')), 0);
      const origWords = new Set(tokens.slice(lo, hi + 1).map((_, k) => info[lo + k][2].toLowerCase()));
      const tokenStarts = new Set();
      { let pos = 0; for (let k = lo; k <= hi; k++) { tokenStarts.add(pos); pos += info[k][2].replace(/-/g, '').length; } }
      let cut = 0; let latinTail = false;
      for (const r of res) for (const w of r.words) {
        if (w === 'a' && !tokenStarts.has(cut)) {
          // which original token does this `a` end?
          let pos = 0, tk = lo;
          for (let k = lo; k <= hi; k++) { const L = info[k][2].replace(/-/g, '').length; if (cut >= pos && cut < pos + L) { tk = k; break; } pos += L; }
          if (!isFrag(tk)) latinTail = true;
        }
        cut += w.length;
      }
      const allKnown = !latinTail && res.every((r) => r.words.every((w) => origWords.has(w.toLowerCase()) || lex.count(wordKey(w)) >= (/^\p{Lu}/u.test(w) ? 3 : 20)));
      const rebuilt = lead + rejoinParts(stream, res) + trail;
      if (process.env.OCR_DEBUG) console.error('SHRED', allKnown, (oldCost - newCost).toFixed(1), tokens.slice(lo, hi + 1).join(' '), '=>', rebuilt);
      if (!allKnown || newCost >= oldCost - 12 || rebuilt === tokens.slice(lo, hi + 1).join(' ')) return;
      changes.push({ kind: 'reflow', before: tokens.slice(lo, hi + 1).join(' '), after: rebuilt });
      out[lo] = rebuilt;
      for (let k = lo + 1; k <= hi; k++) out[k] = null;
      for (let k = lo; k <= hi; k++) used[k] = true;
    };

    // 1. clusters of fragments (`th ea ni mus`)
    const frags = [];
    for (let i = 0; i < tokens.length; i++) if (isFrag(i)) frags.push(i);
    for (let c = 0; c < frags.length;) {
      let d = c;
      while (d + 1 < frags.length && frags[d + 1] - frags[d] <= 3) d++;
      if (d > c) tryRegion(frags[c], frags[d], 2);
      c = d + 1;
    }
    return out.filter((x) => x !== null);
  }

  /**
   * Repair one string. mode 'prose' does everything; 'safe' only ligatures, soft hyphens and whitespace
   * (for locators, years and other bibliographic strings where a join could change a reference).
   */
  function normalizeOnce(input, { mode = 'prose' } = {}) {
    if (typeof input !== 'string' || !input) return { text: input, changes: [] };
    const changes = [];
    let t = input.normalize('NFC');

    t = t.replace(LIG_RE, (m) => { changes.push({ kind: 'ligature', before: m, after: LIGATURES[m] }); return LIGATURES[m]; });
    if (t.includes(SOFT_HYPHEN)) {
      // a soft hyphen at a line break disappears with the break
      t = t.replace(SOFT_HYPHEN_RE, () => { changes.push({ kind: 'soft-hyphen', before: 'soft hyphen', after: '' }); return ''; });
    }
    t = t.replace(ZERO_WIDTH_RE, () => { changes.push({ kind: 'whitespace', before: 'zero-width', after: '' }); return ''; });
    const spaced = t.replace(ODD_SPACE_RE, ' ').replace(/ {2,}/g, ' ').trim();
    if (spaced !== t) {
      changes.push({ kind: 'whitespace', before: 'odd or doubled space', after: 'single space' });
      t = spaced;
    }
    if (mode === 'safe') return { text: t, changes };

    // a possessive cut from its noun (`Adam ’s`)
    t = t.replace(/(\p{L}) (['’]s)(?![\p{L}])/gu, (m, a, b) => { changes.push({ kind: 'join', before: m, after: a + b }); return a + b; });

    // hyphenated line breaks: `transfor- mation` -> `transformation` (only when the joined word is known)
    t = t.replace(/(\p{L}{2,})-\s(\p{Ll}[\p{L}]*)/gu, (m, a, b) => {
      if (['and', 'or', 'to', 'und', 'oder', 'et', 'bis', 'but', 'nor'].includes(b.toLowerCase())) return m;
      const joined = a + b;
      const ak = lex.isKnown(a), bk = lex.isKnown(b);
      const jc = lex.count(wordKey(joined));
      if (jc >= MIN_JOIN && (!ak || !bk)) {
        changes.push({ kind: 'hyphen-break', before: m, after: joined });
        return joined;
      }
      if (ak && bk && jc >= 40 && lex.english.has(joined.toLowerCase())) {
        changes.push({ kind: 'hyphen-break', before: m, after: joined });
        return joined;
      }
      return m;
    });

    for (const [re, from, to] of forceRes) {
      if (re.test(t)) {
        re.lastIndex = 0;
        t = t.replace(re, () => to);
        changes.push({ kind: 'curated', before: from, after: to });
      }
      re.lastIndex = 0;
    }

    t = shredRun(joinRun(t.split(' '), changes), changes).join(' ');
    return { text: t, changes };
  }

  /** Repair to a fixpoint (a join can expose another), at most three passes. */
  function normalize(input, opts) {
    let cur = input;
    const all = [];
    for (let pass = 0; pass < 3; pass++) {
      const r = normalizeOnce(cur, opts);
      all.push(...r.changes);
      if (r.text === cur) break;
      cur = r.text;
    }
    return { text: cur, changes: all };
  }

  /** Suspicious tokens that remain in an (already normalised) string. */
  function scan(input) {
    if (typeof input !== 'string' || !input) return [];
    const hits = [];
    const toks = input.split(' ');
    const info = toks.map(parse);
    const accepted = (...ts) => acceptPhrases.has(ts.join(' ').toLowerCase());
    for (let i = 0; i < toks.length; i++) {
      const p = info[i];
      if (!p) continue;
      const ctx = toks.slice(Math.max(0, i - 2), i + 3).join(' ');
      const nx = info[i + 1];
      const pv = info[i - 1];
      // 1. a stray single letter that completes a word with a neighbour, or sits beside an unknown fragment
      if (p.core.length === 1 && !singleLetterWord(p.core) && !p.lead && !p.trail) {
        const bad = (q, a, b) => q && ((!lex.isWordish(q.core) && q.core.length >= 2) || lex.joinOdds([a, b]) > -3);
        if (!accepted(ctx) && !accepted(toks[i - 1] ?? '', toks[i], toks[i + 1] ?? '')) {
          if (bad(nx, p.core, nx?.core ?? '') || bad(pv, pv?.core ?? '', p.core)) hits.push({ kind: 'stray-letter', token: toks[i], context: ctx });
        }
        continue;
      }
      // 2. adjacent words that read at least as plausibly as one word (the normaliser declined: gate or margin)
      if (nx && !p.trail && !nx.lead) {
        const d = lex.joinDecision([p.core, nx.core]);
        const phrase = `${p.core} ${nx.core}`.toLowerCase();
        if (d.odds > 0 && !d.ok && lex.pairCount(p.core, nx.core) === 0 && lex.strength(p.core + nx.core) >= 12 && !accepted(toks[i], toks[i + 1]) && !keepPhrases.has(phrase)) {
          hits.push({ kind: 'split-word', token: `${toks[i]} ${toks[i + 1]}`, context: ctx });
        }
      }
      // 3. a lone article welded to the next word (`aface`, `adeep`)
      if (!lex.isWordish(p.core) && /^a\p{Ll}{3,}$/u.test(p.core) && lex.count(wordKey(p.core.slice(1))) >= 50 && !accepted(toks[i])) {
        hits.push({ kind: 'welded-article', token: toks[i], context: ctx });
      }
    }
    return hits;
  }

  return { normalize, scan, lex };
}

// ---------------------------------------------------------------------------------------------
// walking field.json text
// ---------------------------------------------------------------------------------------------
const SKIP_KEYS = new Set([
  'id', 'familyId', 'src', 'thumb', 'sourceUrl', 'tone', 'work', 'license', 'credit', 'image', 'subtype', 'locusType', 'subject',
  'geoPrecision', 'generatedAt', 'vaultPath', 'vaultLedgerLine', 'palette', 'basis', 'coFamilyIds', 'parallelIds', 'occurrenceIds',
  'familyIds', 'cultureIds', 'meta',
]);
const SAFE_KEYS = new Set(['locator', 'year', 'workTitle', 'yearDisplay', 'cite']);

/**
 * Visit every human-readable string of a Field. `cb(path, value, mode, set)`; ids, urls, colours and
 * image credits (not scanned text) are skipped, and bibliographic strings are visited in 'safe' mode.
 */
export function visitFieldText(node, cb, path = '', mode = 'prose') {
  if (typeof node === 'string') return;
  if (Array.isArray(node)) {
    node.forEach((x, i) => {
      if (typeof x === 'string') cb(`${path}[${i}]`, x, mode, (v) => { node[i] = v; });
      else visitFieldText(x, cb, `${path}[${i}]`, mode);
    });
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = node[k];
    const m = SAFE_KEYS.has(k) ? 'safe' : mode;
    if (typeof v === 'string') cb(`${path}.${k}`, v, m, (nv) => { node[k] = nv; });
    else visitFieldText(v, cb, `${path}.${k}`, m);
  }
}
