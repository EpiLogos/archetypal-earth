#!/usr/bin/env node
// Wikimedia Commons image fetcher: hero images for archetypes + families, selected occurrences.
// Usage: node scripts/images.mjs [--only archetypes|families|occurrences|theoretics] [--id a,b] [--redo a,b] [--dry]
//        node scripts/images.mjs --family-batch [--workers 6]   (parallel lanes, shared request gate)
//        node scripts/images.mjs --remeta   (refresh baked title/credit/license from Commons; bytes untouched)
// Re-runnable: already-downloaded ids are skipped (their ImageRef lives in public/data/images.json).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ART, BAD_TITLE, BAD_CATS, fold, acceptFallback } from './lib/image-fallback.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ArchetypalEarth/0.1 (local research build)';
const CACHE = path.join(ROOT, '.cache', 'commons');
const IMG_DIR = path.join(ROOT, 'public', 'img');
const OUT = process.env.IMAGES_OUT ? path.resolve(process.env.IMAGES_OUT) : path.join(ROOT, 'public', 'data', 'images.json');
const FIELD = path.join(ROOT, 'public', 'data', 'field.json');
const QUERIES = process.env.IMAGE_QUERIES ? path.resolve(process.env.IMAGE_QUERIES) : path.join(ROOT, 'curation', 'image-queries.json');
// raised 175 -> 200 (2026-10 audit): the shipped tree already measured 175.8MB,
// so the old guard blocked every refetch; replaces are size-neutral swaps.
// raised 200 -> 240 (2026-10 coverage round): the owner asked that every family
// with a depictable tradition carry a plate; ~100 more families ≈ 40-55MB.
// raised 240 -> 320 (2026-10 uniqueness round): the owner asked for complete
// coverage and accepted close-match plates where the best scan is scarce.
// raised 320 -> 1024 (2026-10 full-field round): 100% unique plates for every
// occurrence (~2.6k still unplated) cannot fit at 320 MB even at occurrence
// width 720; the budget is the stop, and the owner asked for the coverage.
const BUDGET_BYTES = 1024 * 1024 * 1024;

// Wikimedia only serves "standard" thumbnail widths.
// occurrences at 640 (was 960): Commons only serves standard thumb widths
// (320/640/800/1024…); 720 400s. Instance plates are many — 640 roughly
// halves bytes per plate while still reading in the deep sheet and field float.
const WIDTH = { archetypes: 1920, families: 1280, theoretics: 1280, occurrences: 640 };
const THUMB_W = 400;

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
// --only takes a group (archetypes|families|occurrences|theoretics) or, if it is not a group, a comma list of ids to fetch across groups
const RAW_ONLY = opt('--only');
const GROUPS = ['archetypes', 'families', 'theoretics', 'occurrences'];
const only = RAW_ONLY && GROUPS.includes(RAW_ONLY) ? RAW_ONLY : null;
const onlyIds = RAW_ONLY && !only ? (opt('--id')?.split(',') || RAW_ONLY.split(',')) : opt('--id')?.split(',');
const redo = new Set(opt('--redo')?.split(',') || []);
const dry = args.includes('--dry');

fs.mkdirSync(CACHE, { recursive: true });
for (const g of GROUPS) fs.mkdirSync(path.join(IMG_DIR, g), { recursive: true });

const field = JSON.parse(fs.readFileSync(FIELD, 'utf8'));
// Budget is the real stop. The old cap of 260 left thousands of occurrences
// borrowing a family plate while disk still had room.
const OCC_CAP = field.occurrences.length;
const queries = JSON.parse(fs.readFileSync(QUERIES, 'utf8'));
const images = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
// Every register already holding a plate (the main images.json and each images-ext*.json), read-only: a plate that exists
// anywhere is never fetched again, whichever file this run writes to.
const known = { archetypes: {}, families: {}, occurrences: {}, theoretics: {} };
for (const f of fs.readdirSync(path.join(ROOT, 'public', 'data')).filter((x) => /^images(-ext[\w-]*)?\.json$/.test(x))) {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', f), 'utf8')); } catch { continue; }
  for (const g of Object.keys(known)) Object.assign(known[g], j[g] || {});
}
for (const g of GROUPS) images[g] ||= {};
const log = [];
const say = (m) => { console.log(m); log.push(m); };

// ---------- http ----------
// One shared gate for every request. Parallel workers wait their turn to *start*
// a request, then overlap the body transfer — that is the throughput win, not
// "wait 25s between plates". Commons throttles the IP; lanes share the channel.
let interval = 1200; // ms between request starts; adapts on 429 / success streaks
let okStreak = 0;
let gate = Promise.resolve();
let nextSlot = 0;
function throttle() {
  const run = gate.then(async () => {
    const wait = Math.max(0, nextSlot - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    nextSlot = Date.now() + interval;
  });
  // Keep the chain alive even if a waiter throws.
  gate = run.catch(() => {});
  return run;
}
async function http(url, { binary = false, tries = 6 } = {}) {
  for (let i = 0; i < tries; i++) {
    await throttle();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: binary ? 'image/*' : 'application/json' } });
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Math.min(Math.max(Number(res.headers.get('retry-after')) || 0, 5), 45);
      interval = Math.min(Math.round(interval * 1.35), 3500);
      okStreak = 0;
      say(`  http ${res.status}, backing off ${ra}s (interval now ${Math.round(interval)}ms)`);
      await new Promise((r) => setTimeout(r, ra * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    if (++okStreak >= 20) { interval = Math.max(550, Math.round(interval * 0.92)); okStreak = 0; }
    return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
  }
  throw new Error(`gave up on ${url}`);
}
async function api(params) {
  const q = new URLSearchParams({ format: 'json', formatversion: '2', action: 'query', ...params });
  const url = `${API}?${q}`;
  const key = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  if (fs.existsSync(key)) return JSON.parse(fs.readFileSync(key, 'utf8'));
  const j = await http(url);
  // Never cache empty or error answers — a 429/transient miss used to poison
  // the rest of the wave (thousands of zero-hit files on disk).
  const pages = j.query?.pages;
  const n = Array.isArray(pages) ? pages.length : (pages ? Object.keys(pages).length : 0);
  const hits = n || (j.query?.search?.length ?? 0);
  if (!j.error && hits > 0) fs.writeFileSync(key, JSON.stringify(j));
  return j;
}

// ---------- candidate model ----------
// Tags are removed first; every entity form (named and numeric) is decoded here, an
// unknown entity left as written — mirrors src/ui/credit.ts decodeEntities.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const strip = (h) =>
  String(h ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ').trim();

// ── bake-time sanitisation, mirroring src/ui/credit.ts ─────────────────────
// The display-time sanitiser cleans the credit a reader sees; the manifest should
// simply not carry the dump in the first place (2026-10 data round). Pure string
// law: nothing is invented, a non-empty input never yields an empty output.
const HOSTS = [
  [/(^|\.)wellcomeimages\.org$|(^|\.)wellcomecollection\.org$/i, 'Wellcome Collection'],
  [/(^|\.)clevelandart\.org$/i, 'Cleveland Museum of Art'],
  [/(^|\.)britishmuseum\.org$/i, 'British Museum'],
  [/(^|\.)lacma\.org$/i, 'Los Angeles County Museum of Art'],
];
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
const LANGUAGE_PREFIX = /^(?:German|French|Italian|Polish|Dutch|Spanish|Danish|Russian|Tahitian|Portuguese|Czech):\s*/;
const QS_MARK = /\b(?:title|label) QS:/;

const tidy = (s) => String(s)
  .replace(/\s+([,.;:!?)])/g, '$1')
  .replace(/\(\s+/g, '(')
  .replace(/[\s,;:]+$/, '')
  // a full stop ends the credit unless it follows an initial ("A.-K. D." keeps its period)
  .replace(/(\p{L}{2,}|[0-9)\]])\.+$/u, '$1')
  .replace(/^[\s,;:]+/, '')
  .trim();
const sentenceCase = (s) => s.replace(/([.!?]\s+)([a-z])/g, (_, stop, c) => stop + c.toUpperCase());

function cleanCredit(raw) {
  const input = String(raw ?? '').trim();
  const done = (out) => out || input;
  let s = input;
  let m;
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

/** An image title without the Wikidata dump: the English label when one is quoted, otherwise
 *  the text before the first "title QS:" / "label QS:" marker. Titles without a dump pass through. */
function sanitiseTitle(raw) {
  const s = String(raw ?? '').trim();
  if (!QS_MARK.test(s)) return s;
  let m;
  if ((m = s.match(/\blabel QS:Len,\s*"\s*([^"]+?)\s*"/))) return m[1];
  if ((m = s.match(/\btitle QS:P1476,en:\s*"\s*([^"]+?)\s*"/))) return m[1];
  const marker = s.search(/(^|\s)(title|label) QS:/);
  const head = s.slice(0, Math.max(0, marker)).trim().replace(LANGUAGE_PREFIX, '').trim();
  return head || s;
}

/** The baked title: curation override, else the ObjectName, else the Commons file title — QS dumps out. */
function bakeTitle(spec, c) {
  if (spec?.title) return spec.title;
  const file = c.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
  return sanitiseTitle(c.objectName) || sanitiseTitle(file) || file;
}
/** The baked credit: curation override, else the plain-text Artist, else the Credit field — boilerplate out. */
function bakeCredit(spec, c) {
  if (spec?.credit) return spec.credit;
  return cleanCredit(c.artist) || cleanCredit(c.credit) || 'Wikimedia Commons';
}
const bakeLicense = (l) =>
  // Commons' "No restrictions" is its marker for no known copyright restrictions — public domain, said in full
  String(l || '').replace(/^No restrictions$/i, 'Public domain (no known restrictions)').replace(/^(PD|PDM)\b[-\w]*/i, 'Public domain');

// The type of the file we actually store: Commons serves SVG and TIFF originals as PNG or JPEG thumbnails.
function servedMime(thumb, original) {
  const m = /\.(png|jpe?g)(?:\?|$)/i.exec(cleanUrl(thumb));
  if (!m) return original;
  return m[1].toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
}

function toCandidate(p, rank, widthReq) {
  const ii = p.imageinfo?.[0];
  if (!ii) return null;
  const em = ii.extmetadata || {};
  const v = (k) => strip(em[k]?.value);
  return {
    title: p.title,
    rank,
    mime: ii.mime,
    servedMime: servedMime(ii.thumburl || ii.url, ii.mime),
    // a vector original is rendered by Commons at the requested width, so its native pixel size says nothing about it
    width: ii.mime === 'image/svg+xml' ? widthReq : ii.width,
    height: ii.mime === 'image/svg+xml' ? Math.round(widthReq * (ii.height / (ii.width || 1))) : ii.height,
    url: ii.url,
    thumburl: ii.thumburl,
    page: ii.descriptionurl,
    license: v('LicenseShortName'),
    artist: v('Artist'),
    credit: v('Credit'),
    descr: v('ImageDescription'),
    objectName: v('ObjectName'),
    cats: v('Categories').split('|').filter(Boolean),
    widthReq,
  };
}

const IMPROPER_LICENSE = /\b(NC|ND|GFDL|fair use|all rights reserved|non-?commercial)\b/i;
function licenseOk(l) {
  if (!l || IMPROPER_LICENSE.test(l)) return false;
  // "No restrictions" is Commons' marker for no known copyright restrictions (public domain)
  return /^(public domain|pd\b|pd-|pdm\b|pdm-|cc0|cc[ -]by\b|cc[ -]by[ -]sa|attribution|no restrictions)/i.test(l);
}
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'and', 'or', 'with', 'for', 'to', 'by', 'from', 'at', 'as', 'is', 'file', 'jpg', 'jpeg', 'les', 'des', 'du', 'de', 'la', 'le', 'und', 'der', 'die', 'das']);
// Words that name a class of object, not which object. An automatic search may
// use them, but they do not by themselves prove the file is the named thing.
const GENERIC = new Set(('relief stone stones detail bronze marble gold ivory alabaster limestone male man men head heads plate plates fresco statue statues statuette symbol symbols art history museum ancient painting paintings sculpture sculptures image photo photograph view left right side front small large group clay second first third century upper lower box coin vessel vessels jar jars mirror shaped bell fragment fragments piece pieces part parts form forms type types scene scenes around circa about early late period culture cultures monument monuments tomb tombs temple temples myth mythology legend illustration drawing sketch book page pages text seated standing holding emerging drawn flanked procession cart wagon car black white red yellow green blue terra cotta terracotta').split(/\s+/));
// Internet Archive / Flickr book-scan filenames, and titles that are the book rather than the object.
const BOOK_SCAN = /\(\d{4}\)\s*\(\d{5,}\)|\b(an introduction to|a guide to|acts and proceedings|outlines from the|a comparative account of|catalogue of the|catalog of the)\b/i;

// Same object, other spelling or the name this corpus and Commons do not share.
const ALIAS = {
  kore: ['persephone'],
  caldron: ['cauldron'],
  phallus: ['phallos'],
  cybele: ['kybele'],
  astarte: ['ashtart'],
  rome: ['roma'],
  roma: ['rome'],
  ephesus: ['ephesos'],
};
function hasTok(hay, t) {
  const forms = [t, ...(ALIAS[t] || [])];
  return forms.some((f) => {
    if (f.length <= 3) return new RegExp(`(?:^|[^a-z0-9])${f}(?:[^a-z0-9]|$)`).test(hay);
    if (hay.includes(f)) return true;
    // cyclades ~ cycladic, and the same stem for a plural or an adjective
    return f.length >= 6 && hay.includes(f.slice(0, f.length - 2));
  });
}
function contentTokens(q) {
  return [...new Set(fold(q).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)))];
}
function distinctiveTokens(q) {
  return contentTokens(q).filter((t) => t.length > 3 && !GENERIC.has(t));
}
/** An automatic search has no curator. The file's own title has to carry the object's name;
 *  a book scan, or a caption that merely mentions the words, is not that object. */
function identityOk(c, q, { narrative = false } = {}) {
  const title = fold(`${c.title} ${c.objectName}`);
  if (BOOK_SCAN.test(fold(c.title)) && !BOOK_SCAN.test(fold(q))) return false;
  const toks = contentTokens(q);
  const distinctive = toks.filter((t) => !GENERIC.has(t) && (t.length > 3 || t.length >= 2));
  const pool = (distinctive.length ? distinctive : toks).filter((t) => t.length > 3 || !GENERIC.has(t));
  if (!pool.length) return false;
  const art = ART.test(fold(`${c.title} ${c.descr} ${c.cats.join(' ')} ${c.objectName}`));
  const inTitle = pool.filter((t) => hasTok(title, t));
  if (!narrative) {
    // a family is named for an object: every word of that name has to be in the file title
    const long = pool.filter((t) => t.length >= 6);
    if (long.length && !long.every((t) => hasTok(title, t))) return false;
    if (inTitle.length < pool.length) return false;
    if (inTitle.length === 1 && inTitle[0].length < 5 && !art) return false;
    return true;
  }
  // an occurrence is a passage. The file has to be a work, and its title has to carry
  // two words of the passage — or one rare name, with a second word in the description.
  if (/\b(map of|geographicus|sauna|mhnt\.|fisherman|wildlife refuge)\b|\bNARA\b/i.test(c.title)) return false;
  if (!art) return false;
  const names = pool.filter((t) => t.length >= 4);
  if (!names.length) return false;
  const hitTitle = names.filter((t) => hasTok(title, t));
  const longest = Math.max(...names.map((t) => t.length));
  if (!names.some((t) => t.length === longest && hasTok(title, t))) return false;
  if (hitTitle.length >= 2) return true;
  if (hitTitle.length === 1 && hitTitle[0].length >= 6) {
    const hay = fold(`${c.descr} ${c.cats.join(' ')}`);
    return names.some((t) => t !== hitTitle[0] && hasTok(hay, t));
  }
  return false;
}
function clipQuery(q) {
  return String(q).replace(/[…]+/g, ' ').replace(/↔/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/).slice(0, 12).join(' ');
}
// names: the words an automatic pick must carry as whole words (acceptFallback). A node passes its
// name and aliases; a passage (occurrence) defaults to its distinctive words.
function autoSpec(name, { museum = false, narrative = false, family = '', names = null } = {}) {
  const cleaned = clipQuery(name);
  const toks = distinctiveTokens(cleaned);
  const short = clipQuery(toks.slice(0, 4).join(' '));
  const pair = clipQuery(toks.slice(0, 2).join(' '));
  const famWords = clipQuery(String(family || '').replace(/[-_↔]/g, ' '));
  const queries = [];
  // Short distinctive queries first — long passage titles often return zero Commons hits.
  if (pair.length > 2) queries.push(pair);
  if (short.length > 2 && short !== pair) queries.push(short);
  if (famWords.length > 2 && toks[0]) queries.push(clipQuery(`${toks[0]} ${famWords}`));
  if (famWords.length > 2) queries.push(famWords);
  if (cleaned.length > 2) queries.push(cleaned);
  if (museum && short.length > 2) queries.push(clipQuery(`${toks.slice(0, 3).join(' ')} museum`));
  const aliased = cleaned.replace(/\bcaldron\b/gi, 'cauldron').replace(/\bkore\b/gi, 'persephone').replace(/\bcybele\b/gi, 'kybele').replace(/\bphallus\b/gi, 'phallos');
  if (aliased !== cleaned) queries.push(clipQuery(aliased));
  const uniq = [...new Set(queries.filter(Boolean))];
  if (!uniq.length) return null;
  const nameList = names?.length ? names : narrative ? toks : [cleaned];
  return { queries: uniq, relaxed: true, allowBad: true, auto: true, identity: cleaned, narrative, names: nameList };
}

function evaluate(c, q, ctx) {
  const hay = `${c.title} ${c.descr} ${c.cats.join(' ')} ${c.objectName}`.toLowerCase();
  const mime = c.servedMime || c.mime;
  if (mime !== 'image/jpeg' && !(mime === 'image/png' && hasSips)) return { ok: false, why: 'mime' };
  if (/\b(airbus|boeing|a320|a330|a340|a350|a380|airliner|aircraft|locomotive|squadron)\b/i.test(c.title)) return { ok: false, why: 'not the object' };
  if (!licenseOk(c.license)) return { ok: false, why: `license ${c.license}` };
  // a spec may ask for close-match plates: scarce scans pass a lower resolution floor
  // Explicit floors (pins pass minLongest/minShort) win over the relaxed defaults.
  const minLongest = ctx.minLongest ?? (ctx.relaxed ? 600 : 900);
  const minShort = ctx.minShort ?? (ctx.relaxed ? 320 : 450);
  const longest = Math.max(c.width, c.height);
  if (longest < minLongest || Math.min(c.width, c.height) < minShort) return { ok: false, why: 'low-res' };
  // and a tall or wide plate: relaxed widens the aspect band (a standing figure, a frieze)
  const [arMax, arMin] = ctx.relaxed ? [ctx.arMax ?? 3.4, 0.29] : [2.6, 0.36];
  const ar = c.width / c.height;
  if (ar > arMax || ar < arMin) return { ok: false, why: 'aspect' };
  if (BAD_TITLE.test(c.title.replace(/^File:/, '')) && !ctx.allowBad) return { ok: false, why: 'bad title' };
  if (BAD_CATS.test(c.cats.join('|')) && !ctx.allowBad) return { ok: false, why: 'bad category' };
  if ((ctx.exclude || []).some((x) => hay.includes(x.toLowerCase()))) return { ok: false, why: 'excluded' };
  for (const group of ctx.require || []) if (!group.some((t) => hay.includes(t.toLowerCase()))) return { ok: false, why: `missing ${group[0]}` };
  if (ctx.used.has(c.title) && !ctx.reuseOk) return { ok: false, why: 'already used' };
  let score = 40 - c.rank * 1.2 + Math.min(1, longest / 2400) * 10;
  const artHits = new Set((hay.match(new RegExp(ART.source, 'gi')) || []).map((x) => x.toLowerCase()));
  score += Math.min(24, artHits.size * 4);
  const qtok = [...new Set(q.toLowerCase().replace(/[^a-z0-9À-ɏ ]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t)))];
  const hit = qtok.filter((t) => hay.includes(t)).length;
  score += (hit / Math.max(1, qtok.length)) * 30;
  if (/photograph|photo\b|\b20[0-2]\d\b/i.test(c.title)) score -= 12;
  // enormous originals make Commons render the scaled copy slowly (and often 429); mild preference against them
  if (c.width * c.height > 60e6) score -= 8;
  else if (c.width * c.height > 30e6) score -= 3;
  if (/\b(page|pages|folio|fol\.)\b/i.test(c.title) && !ctx.allowPage) score -= 10;
  return { ok: true, score };
}

async function searchOne(q, width, limit = 28) {
  const j = await api({
    generator: 'search', gsrnamespace: '6', gsrlimit: String(limit), gsrsearch: `${q} filetype:bitmap`,
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(width),
    iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription|Categories|ObjectName|Credit',
  });
  const pages = (j.query?.pages || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.map((p, i) => {
    const c = toCandidate(p, i, width);
    if (c) c.source = 'commons';
    return c;
  }).filter(Boolean);
}

// Second open-licence channels — same PD/CC0 bar as licenseOk, different rate
// limits. Used when Commons is empty or throttled for a family/occurrence.
async function searchMet(q, limit = 12) {
  const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1.1/search?${new URLSearchParams({ q })}`;
  let j;
  try { j = await http(searchUrl); } catch { return []; }
  const ids = (j.objectIDs || []).slice(0, Math.min(limit * 3, 40));
  const out = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    let o;
    try { o = await http(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`); } catch { continue; }
    if (!o?.isPublicDomain || !o.primaryImage) continue;
    const title = `Met:${id}`;
    out.push({
      title,
      rank: out.length,
      mime: 'image/jpeg',
      width: 2000,
      height: 2000,
      url: o.primaryImage,
      thumburl: o.primaryImageSmall || o.primaryImage,
      page: o.objectURL || `https://www.metmuseum.org/art/collection/search/${id}`,
      license: 'CC0',
      artist: o.artistDisplayName || 'Metropolitan Museum of Art',
      credit: [o.artistDisplayName, o.creditLine, 'The Metropolitan Museum of Art'].filter(Boolean).join('; '),
      descr: o.title || '',
      objectName: o.title || '',
      cats: [o.department, o.objectName, o.culture].filter(Boolean),
      source: 'met',
    });
  }
  return out;
}

async function searchCleveland(q, limit = 12) {
  const url = `https://openaccess-api.clevelandart.org/api/artworks/?${new URLSearchParams({
    q, has_image: '1', cc0: '1', limit: String(Math.min(limit, 20)),
  })}`;
  let j;
  try { j = await http(url); } catch { return []; }
  const out = [];
  for (const r of j.data || []) {
    if (out.length >= limit) break;
    const img = r.images?.web?.url || r.images?.print?.url || r.images?.full?.url;
    if (!img) continue;
    const id = r.accession_number || r.id;
    const title = `CMA:${id}`;
    out.push({
      title,
      rank: out.length,
      mime: 'image/jpeg',
      width: r.images?.web?.width || 1200,
      height: r.images?.web?.height || 1200,
      url: img,
      thumburl: r.images?.web?.url || img,
      page: r.url || `https://www.clevelandart.org/art/${id}`,
      license: 'CC0',
      artist: r.creators?.[0]?.description || 'Cleveland Museum of Art',
      credit: [r.creators?.[0]?.description, r.credit_line, 'Cleveland Museum of Art'].filter(Boolean).join('; '),
      descr: r.title || '',
      objectName: r.title || '',
      cats: [r.type, r.technique].filter(Boolean),
      source: 'cleveland',
    });
  }
  return out;
}

async function searchMuseums(q, limit = 16) {
  const [met, cma] = await Promise.all([searchMet(q, Math.ceil(limit / 2)), searchCleveland(q, Math.ceil(limit / 2))]);
  return [...met, ...cma];
}

async function fetchPinned(title, width) {
  const t = title.startsWith('File:') ? title : `File:${title}`;
  const j = await api({
    titles: t, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(width),
    iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription|Categories|ObjectName|Credit',
  });
  const p = (j.query?.pages || [])[0];
  if (!p || p.missing) return null;
  return toCandidate(p, 0, width);
}

// ---------- local image tools (macOS sips) ----------
const hasSips = spawnSync('sips', ['--version']).status === 0;
function probe(file) {
  if (!hasSips) return {};
  const r = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = Number(r.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const h = Number(r.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  let tone;
  const tmp = path.join(CACHE, 'tone.bmp');
  const t = spawnSync('sips', ['-z', '1', '1', '-s', 'format', 'bmp', file, '--out', tmp], { encoding: 'utf8' });
  if (t.status === 0 && fs.existsSync(tmp)) {
    const b = fs.readFileSync(tmp);
    const off = b.readUInt32LE(10);
    const bpp = b.readUInt16LE(28);
    if (bpp >= 24) tone = '#' + [b[off + 2], b[off + 1], b[off]].map((x) => x.toString(16).padStart(2, '0')).join('');
    fs.rmSync(tmp, { force: true });
  }
  return { width: w || undefined, height: h || undefined, tone };
}

const dirSize = (d) => fs.readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).reduce((s, e) => s + fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size, 0);

function cleanUrl(u) {
  return String(u || '').split('?')[0];
}
function thumbUrl(cand, w) {
  // Prefer the API's own thumburl as returned — rewriting the px- width often
  // 400s on thumb.wikimedia.org (Commons only materialises some widths).
  const apiThumb = cleanUrl(cand.thumburl);
  if (apiThumb.includes('/thumb/')) return apiThumb;
  const base = cleanUrl(cand.url);
  if (base.includes('/thumb/')) return base.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`);
  const m = base.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/(\w\/\w\w)\/([^/]+)$/);
  return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/${w}px-${m[3]}` : base;
}
function mainUrl(cand, w) {
  // Museum / non-Commons candidates carry a direct image URL — never FilePath.
  if (cand.source && cand.source !== 'commons') {
    return cleanUrl(cand.thumburl || cand.url);
  }
  // Special:FilePath serves a width-limited copy through commons.wikimedia.org
  // and is kinder under rate limits than hammering thumb.wikimedia.org / originals.
  if (/^File:/i.test(cand.title || '')) {
    const title = String(cand.title).replace(/^File:/i, '');
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=${w}`;
  }
  const apiThumb = cleanUrl(cand.thumburl);
  if (apiThumb.includes('/thumb/')) return apiThumb;
  return cleanUrl(cand.url) || thumbUrl(cand, w);
}

// ---------- main ----------
async function resolveFor(group, id, spec, ctx) {
  const width = WIDTH[group];
  if (spec.pin) {
    const c = await fetchPinned(spec.pin, width);
    if (!c) return { error: `pin not found: ${spec.pin}` };
    const floors = {
      minLongest: spec.minLongest ?? 450,
      minShort: spec.minShort ?? 300,
      relaxed: spec.relaxed,
      arMax: spec.arMax,
    };
    const ev = evaluate(c, spec.pin, { ...ctx, allowBad: true, reuseOk: true, require: [], exclude: [], ...floors });
    if (!ev.ok) return { error: `pin rejected (${ev.why}): ${spec.pin}`, cand: c };
    return { cand: c, score: 999, query: 'pin' };
  }
  let best = null;
  for (let qi = 0; qi < spec.queries.length; qi++) {
    const q = spec.queries[qi];
    let cands;
    try { cands = await searchOne(q, width); } catch (e) { say(`  search failed (${q}): ${e.message}`); continue; }
    for (const c of cands) {
      const ev = evaluate(c, q, { ...ctx, require: spec.require, exclude: spec.exclude, allowPage: spec.allowPage, allowBad: spec.allowBad, relaxed: spec.relaxed });
      if (!ev.ok) continue;
      if (spec.auto && !identityOk(c, spec.identity || q, { narrative: !!spec.narrative })) continue;
      if (spec.auto && !acceptFallback(c, { names: spec.names, score: ev.score }).ok) continue;
      // 60 (was 72): full-field coverage accepts a close historical plate when
      // the passage itself has no Commons photograph; uniqueness is still gated
      // by usedTitles, so two occurrences never share a file.
      if (spec.narrative && ev.score < 60) continue;
      const score = ev.score + (qi === 0 ? 6 : qi === 1 ? 3 : 0);
      if (!best || score > best.score) best = { cand: c, score, query: q };
    }
    if (best && best.score >= 85 && !spec.exhaustive) break; // good enough; stop spending requests
  }
  // Close-match pass for occurrences: when the passage has no Commons photograph,
  // take a unique art plate that matches the family / distinctive tokens without
  // the strict identityOk gate. Still refuses usedTitles (uniqueness) and junk.
  // A node whose curated spec has `require` never takes a close match: a miss is recorded.
  if (!best && spec.narrative && !spec.require?.length) {
    for (const q of spec.queries) {
      let cands;
      try { cands = await searchOne(q, width); } catch { continue; }
      for (const c of cands) {
        const ev = evaluate(c, q, { ...ctx, require: [], exclude: spec.exclude, allowPage: true, allowBad: true, relaxed: true });
        if (!ev.ok) continue;
        if (ev.score < 70) continue;
        const hay = fold(`${c.title} ${c.descr} ${c.cats.join(' ')}`);
        if (!ART.test(hay)) continue;
        // Close-match is for historical plates, not tourist photos of the word.
        if (/\b(geograph|photograph|photo by|flickr|selfie|wildlife|harbour|harbor|moored)\b/i.test(c.title)) continue;
        if (/\b(20[0-2]\d)\b/.test(c.title) && !ART.test(fold(c.title))) continue;
        if (!acceptFallback(c, { names: spec.names || distinctiveTokens(q), score: ev.score }).ok) continue;
        const score = ev.score - 8; // prefer identity hits when both exist
        if (!best || score > best.score) best = { cand: c, score, query: `${q} [close]` };
      }
      if (best && best.score >= 78) break;
    }
  }
  // Every automatic pick is logged on one line, so a wrong subject can be found by its title.
  if (best && spec.auto) say(`  auto pick: "${best.cand.title}" score ${Math.round(best.score)} q="${best.query}"`);
  return best || { error: 'no acceptable candidate' };
}

async function download(group, id, spec, pick) {
  const c = pick.cand;
  const dir = path.join(IMG_DIR, group);
  const mainPath = path.join(dir, `${id}.jpg`);
  const thumbPath = path.join(dir, `${id}.thumb.jpg`);
  const w = WIDTH[group];
  let main = await http(mainUrl(c, w), { binary: true });
  const tmpIn = path.join(CACHE, `${id}.src`);
  fs.writeFileSync(tmpIn, main);
  if (hasSips) {
    // Always recompress through sips: Commons originals at the requested width
    // are often 200–400 KB; q70 at the group width packs the full-field wave.
    const q = group === 'occurrences' ? '70' : '80';
    const r = spawnSync('sips', ['-Z', String(w), '-s', 'format', 'jpeg', '-s', 'formatOptions', q, tmpIn, '--out', mainPath], { encoding: 'utf8' });
    fs.rmSync(tmpIn, { force: true });
    if (r.status !== 0 || !fs.existsSync(mainPath)) throw new Error('jpeg recompress failed');
    main = fs.readFileSync(mainPath);
  } else {
    fs.rmSync(tmpIn, { force: true });
    if (main[0] === 0x89 && main[1] === 0x50) throw new Error('png->jpeg needs sips');
    fs.writeFileSync(mainPath, main);
  }
  // occurrence plates at 720/q70 can land under 15 KB; 6 KB is still a real image
  const minBytes = group === 'occurrences' ? 6000 : 15000;
  if (main[0] !== 0xff || main[1] !== 0xd8 || main.length < minBytes) throw new Error('main download is not a plausible JPEG');
  // small variant: resize locally (saves a rate-limited request); fall back to the Commons thumb
  let madeThumb = false;
  if (hasSips) {
    const r = spawnSync('sips', ['-Z', String(THUMB_W), '-s', 'format', 'jpeg', '-s', 'formatOptions', '45', mainPath, '--out', thumbPath], { encoding: 'utf8' });
    madeThumb = r.status === 0 && fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 2000;
  }
  if (!madeThumb) {
    const thumb = await http(thumbUrl(c, THUMB_W), { binary: true });
    if (thumb[0] !== 0xff || thumb[1] !== 0xd8) throw new Error('thumb download is not a JPEG');
    fs.writeFileSync(thumbPath, thumb);
  }
  const pr = probe(mainPath);
  const ow = Math.max(c.width, c.height);
  const scale = ow > w ? w / ow : 1;
  const width = pr.width || Math.round(c.width * scale);
  const height = pr.height || Math.round(c.height * scale);
  const ref = {
    src: `img/${group}/${id}.jpg`,
    thumb: `img/${group}/${id}.thumb.jpg`,
    width, height,
    ...(pr.tone ? { tone: pr.tone } : {}),
    title: bakeTitle(spec, c).slice(0, 160),
    credit: bakeCredit(spec, c).slice(0, 220),
    license: bakeLicense(c.license),
    sourceUrl: c.page,
  };
  return ref;
}

// Ids this process pruned (skip / redo) — merge-on-save must not resurrect them.
const deleted = new Set(); // `${group}/${id}`
// Ids this process fetched in this run. Only these are written over the disk copy: any other entry on disk is newer than
// what this run loaded at its start, so a concurrent run's edit (a credit, a pin's plate) is never reverted.
const written = new Set(); // `${group}/${id}`
let saveChain = Promise.resolve();
function save() {
  // Serialize writes across parallel family workers; still merge-on-save so a
  // foreign process cannot clobber ids we have not touched.
  saveChain = saveChain.then(() => {
    let disk = {};
    try { disk = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* fresh */ }
    const out = { ...disk };
    const groupKeys = new Set([...GROUPS, ...Object.keys(disk), ...Object.keys(images)]);
    for (const g of groupKeys) {
      if (g.startsWith('_')) { out[g] = disk[g] ?? images[g]; continue; }
      out[g] = { ...(disk[g] || {}) };
      for (const [id, ref] of Object.entries(images[g] || {})) {
        if (written.has(`${g}/${id}`) || !(id in out[g])) out[g][id] = ref;
      }
      for (const id of Object.keys(out[g])) {
        if (deleted.has(`${g}/${id}`)) delete out[g][id];
      }
      images[g] = out[g];
    }
    const tmp = `${OUT}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 1) + '\n');
    fs.renameSync(tmp, OUT);
  }).catch((e) => say(`save failed: ${e.message}`));
  return saveChain;
}

// ---------- --remeta: refresh baked metadata without touching bytes ----------
// Re-fetches the Commons extmetadata of every entry's recorded _file and rewrites
// title/credit/license clean (bakeTitle/bakeCredit/bakeLicense, curation overrides
// honoured). The pictures on disk and their src/thumb/width/height/tone stay as
// shipped — this is the data-fix lane for manifests baked by the old, verbatim fetcher.
const remeta = args.includes('--remeta');
async function remetaAll() {
  let touched = 0, same = 0, stale = 0;
  for (const group of GROUPS) {
    for (const [id, ref] of Object.entries(images[group])) {
      if (!ref._file) { say(`remeta ${group}/${id}: no _file recorded, skipped`); continue; }
      const c = await fetchPinned(ref._file, WIDTH[group]);
      if (!c) { say(`remeta ${group}/${id}: Commons source gone (${ref._file}) — kept as baked`); stale++; continue; }
      const spec = (queries[group] || {})[id];
      const next = {
        title: bakeTitle(spec, c).slice(0, 160),
        credit: bakeCredit(spec, c).slice(0, 220),
        license: bakeLicense(c.license),
      };
      const before = JSON.stringify([ref.title, ref.credit, ref.license]);
      const after = JSON.stringify([next.title, next.credit, next.license]);
      if (before === after) { same++; continue; }
      Object.assign(ref, next);
      touched++;
      say(`remeta ${group}/${id}: ${ref.title} / ${ref.credit}`);
    }
  }
  save();
  say(`remeta: ${touched} rewritten, ${same} already clean, ${stale} stale sources kept`);
}

const groups = only ? [only] : GROUPS;
if (remeta) { await remetaAll(); process.exit(0); }
const usedTitles = new Set(Object.values(images).flatMap((g) => Object.values(g)).map((r) => r._file).filter(Boolean));

// --family-batch [--workers N]: N lanes share one request gate. Each lane takes
// a family, builds a Commons pool, assigns unique plates, downloads. Throughput
// comes from overlapping transfers, not from waiting 25s between plates.
const familyBatch = args.includes('--family-batch');
const WORKERS = Math.max(1, Math.min(12, Number(opt('--workers') || 4)));
async function runFamilyBatch() {
  const width = WIDTH.occurrences;
  const byFam = new Map();
  for (const o of field.occurrences) {
    if (images.occurrences[o.id] && fs.existsSync(path.join(ROOT, 'public', images.occurrences[o.id].src))) continue;
    const fid = o.familyId || o.family || '_none';
    if (!byFam.has(fid)) byFam.set(fid, []);
    byFam.get(fid).push(o);
  }
  const famQueue = [...byFam.entries()].sort((a, b) => b[1].length - a[1].length);
  const unplated = famQueue.reduce((n, [, a]) => n + a.length, 0);
  say(`family-batch: ${unplated} unplated across ${famQueue.length} families; ${WORKERS} workers on one request gate`);
  const missing = [];
  let got = 0;
  let stop = false;
  const titleLock = { chain: Promise.resolve() };
  function claimTitle(title) {
    let ok = false;
    titleLock.chain = titleLock.chain.then(() => {
      if (usedTitles.has(title)) { ok = false; return; }
      usedTitles.add(title);
      ok = true;
    });
    return titleLock.chain.then(() => ok);
  }
  function releaseTitle(title) {
    titleLock.chain = titleLock.chain.then(() => { usedTitles.delete(title); });
    return titleLock.chain;
  }
  // Synonyms keep depleted families (serpent/tree/…) finding unused Commons files
  // after the first wave has claimed the obvious titles.
  const FAM_ALIAS = {
    serpent: ['snake', 'naja', 'ouroboros', 'python', 'cobra', 'asp'],
    tree: ['oak', 'pine', 'cedar', 'yggdrasil', 'arbor', 'world tree'],
    'mother-goddess': ['mother goddess', 'magna mater', 'demeter', 'isis'],
    'god-image': ['god image', 'deus', 'christ pantocrator', 'yhwh'],
    coniunctio: ['coniunctio', 'chemical wedding', 'hieros gamos', 'rosarium'],
    quaternity: ['quaternity', 'four evangelists', 'tetramorph', 'mandala'],
    fish: ['fish', 'ichthys', 'vesica', 'piscis'],
    fire: ['fire', 'flame', 'ignis', 'phoenix'],
    water: ['water', 'fountain', 'fons', 'aqua'],
    anthropos: ['anthropos', 'primordial man', 'adam kadmon', 'purusha'],
  };
  const artQs = (fam) => {
    const name = String(fam).replace(/[-_↔]/g, ' ').trim();
    const aliases = FAM_ALIAS[fam] || FAM_ALIAS[name] || [];
    const qs = [
      `${name} (manuscript OR engraving OR woodcut OR relief OR painting OR alchemy)`,
      `${name} art`,
      name,
      ...aliases.map((a) => `${a} (engraving OR woodcut OR manuscript OR relief)`),
      ...aliases,
    ];
    return [...new Set(qs.filter((q) => q.replace(/\s+/g, '').length > 2))];
  };
  async function poolFor(fam, need) {
    const pool = [];
    const seen = new Set();
    const famToks = [
      ...distinctiveTokens(String(fam).replace(/[-_↔]/g, ' ')),
      ...(FAM_ALIAS[fam] || []).flatMap((a) => distinctiveTokens(a)),
    ];
    const accept = (c, q, bonus = 0) => {
      if (seen.has(c.title) || usedTitles.has(c.title)) return;
      const ev = evaluate(c, q, { used: usedTitles, allowBad: true, relaxed: true, allowPage: true });
      if (!ev.ok || ev.score < 50) return;
      const hay = fold(`${c.title} ${c.descr} ${c.cats.join(' ')}`);
      if (!ART.test(hay) && c.source === 'commons') return;
      if (famToks.length && !famToks.some((t) => t.length >= 4 && hasTok(hay, t))) return;
      if (/\b(geograph|flickr|selfie|wildlife|harbour|harbor|moored|park|borrego|sculpture by|great-wall|van gogh|starry|dolní|vestonice|gravettian)\b/i.test(c.title)) return;
      if (c.source === 'commons' && /\b(20[01]\d|202\d)\b/.test(c.title) && !/\b(manuscript|engraving|woodcut|fresco|painting)\b/i.test(c.title)) return;
      if (famToks.includes('serpent') && /\b(forveille|ophicleide|bass horn|serpentone|in b-flat|church figure playing)\b/i.test(c.title)) return;
      seen.add(c.title);
      pool.push({ cand: c, score: ev.score + bonus, query: `${q}${c.source && c.source !== 'commons' ? ` [${c.source}]` : ''}` });
    };
    for (const q of artQs(fam)) {
      if (pool.length >= need) break;
      let cands;
      try { cands = await searchOne(q, width, 50); } catch (e) { say(`  search failed (${q}): ${e.message}`); continue; }
      for (const c of cands) accept(c, q);
    }
    // Fill short Commons pools from Met + Cleveland (separate rate limits).
    if (pool.length < need) {
      const q = String(fam).replace(/[-_↔]/g, ' ').trim();
      try {
        const museum = await searchMuseums(q, need - pool.length + 4);
        for (const c of museum) accept(c, q, 2);
      } catch (e) { say(`  museum search failed (${q}): ${e.message}`); }
    }
    pool.sort((a, b) => b.score - a.score);
    return pool;
  }
  async function plateOne(o, pool, fam) {
    const spec = (queries.occurrences || {})[o.id];
    if (spec?.skip) return;
    if (spec?.pin) {
      let pick;
      try { pick = await resolveFor('occurrences', o.id, spec, { used: usedTitles }); } catch (e) { missing.push(`${o.id}: ${e.message}`); return; }
      if (pick.error) { missing.push(`${o.id}: ${pick.error}`); return; }
      if (!(await claimTitle(pick.cand.title))) { missing.push(`${o.id}: pin already used`); return; }
      try {
        const ref = await download('occurrences', o.id, spec, pick);
        ref._file = pick.cand.title;
        images.occurrences[o.id] = ref; written.add(`occurrences/${o.id}`);
        got++;
        say(`  ${o.id} -> ${pick.cand.title} (pin)`);
        await save();
      } catch (e) {
        await releaseTitle(pick.cand.title);
        missing.push(`${o.id}: download ${e.message}`);
      }
      return;
    }
    // Root rule (2026-10 image audit): a passage is plated only from a curated statement of what the
    // picture must show. A pin names the file; a require-spec names the subject. The family pool, the
    // automatic search, the close-match pass and the museum search picked by word overlap and put
    // unrelated art under captions, so an occurrence without such a spec is recorded and left unplated.
    if (!(spec?.pin || spec?.require?.length)) { missing.push(`${o.id}: no pin or require spec (uncurated passage left unplated)`); return; }
    // Every fallback below is an automatic pick: it must pass acceptFallback (a whole-word name,
    // art context, no photograph or junk) and is logged with its title and score.
    const name = o.label || o.title || o.id;
    const toks = distinctiveTokens(name);
    // A spec with `require` is the curated statement of what the picture must show: a miss is recorded.
    const required = !!spec?.require?.length;
    const commit = async (pick, dlSpec, how) => {
      if (!(await claimTitle(pick.cand.title))) return false;
      try {
        const ref = await download('occurrences', o.id, dlSpec, pick);
        ref._file = pick.cand.title;
        images.occurrences[o.id] = ref; written.add(`occurrences/${o.id}`);
        got++;
        say(`  ${o.id} -> ${pick.cand.title} (${how} score ${Math.round(pick.score)})`);
        await save();
        return true;
      } catch (e) {
        await releaseTitle(pick.cand.title);
        missing.push(`${o.id}: download ${e.message}`);
        return 'failed';
      }
    };
    // 1. the curated queries, as the main pass runs them
    if (spec?.queries?.length) {
      let pick;
      try { pick = await resolveFor('occurrences', o.id, spec, { used: usedTitles }); } catch (e) { pick = { error: e.message }; }
      if (!pick.error) {
        const done = await commit(pick, { title: name, relaxed: true }, 'curated');
        if (done !== false) return;
      }
      if (required) { missing.push(`${o.id}: ${pick.error || 'curated pick already used'}`); return; }
    } else if (required) {
      missing.push(`${o.id}: curated spec has no queries`);
      return;
    }
    // 2. the family pool, only a plate whose file carries one of the passage's words
    if (!pool.length) pool.push(...(await poolFor(fam, 40)));
    const i = pool.findIndex((p) => acceptFallback(p.cand, { names: toks, score: p.score }).ok);
    if (i >= 0) {
      const [pick] = pool.splice(i, 1);
      if ((await commit(pick, { title: name, relaxed: true }, 'pool')) !== false) return;
    }
    // 3. an automatic search on the occurrence's own words
    const auto = autoSpec(name, { narrative: true, family: fam });
    if (auto) {
      let pick;
      try { pick = await resolveFor('occurrences', o.id, auto, { used: usedTitles }); } catch (e) { pick = { error: e.message }; }
      if (!pick.error && (await commit(pick, auto, 'auto')) !== false) return;
    }
    // 4. Met / Cleveland, under the same acceptance rule
    const mq = clipQuery(`${distinctiveTokens(name).slice(0, 3).join(' ')} ${String(fam).replace(/[-_]/g, ' ')}`);
    let museum = [];
    try { museum = await searchMuseums(mq || name, 8); } catch (e) { missing.push(`${o.id}: museum ${e.message}`); return; }
    for (const c of museum) {
      const ev = evaluate(c, mq || name, { used: usedTitles, allowBad: true, relaxed: true, allowPage: true });
      if (!ev.ok || !acceptFallback(c, { names: toks, score: ev.score }).ok) continue;
      if ((await commit({ cand: c, score: ev.score, query: c.source }, { title: name, relaxed: true }, c.source)) !== false) return;
    }
    missing.push(`${o.id}: no acceptable plate`);
  }
  async function worker(wid) {
    while (!stop) {
      const job = famQueue.shift();
      if (!job) return;
      const [fam, occs] = job;
      if (dir_over_budget()) { stop = true; say('image budget reached; stopping'); return; }
      say(`[w${wid}] family ${fam} (${occs.length} unplated)`);
      const pool = await poolFor(fam, Math.min(occs.length + 8, 80));
      say(`[w${wid}]   pool ${pool.length}${pool.length ? '' : ' — falling back to per-occurrence auto'}`);
      // Overlap downloads inside the family too — gate serializes request starts.
      const q = [...occs];
      const inner = Math.min(2, Math.max(1, occs.length));
      await Promise.all(Array.from({ length: inner }, async () => {
        while (!stop) {
          const o = q.shift();
          if (!o) return;
          if (dir_over_budget()) { stop = true; return; }
          if (images.occurrences[o.id]?.src) continue;
          await plateOne(o, pool, fam);
        }
      }));
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));
  await save();
  const mb = (dirSize(IMG_DIR) / 1048576).toFixed(1);
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\nfamily-batch: plated +${got} in ${mins}m (${WORKERS} workers), occurrences now ${Object.keys(images.occurrences).length}/${field.occurrences.length}; total ${mb} MB`);
  if (missing.length) {
    const show = missing.slice(0, 80);
    console.log(`missing (${missing.length}):\n  ${show.join('\n  ')}${missing.length > show.length ? `\n  … ${missing.length - show.length} more` : ''}`);
  }
}
if (familyBatch) { await runFamilyBatch(); process.exit(0); }

const summary = { archetypes: [0, 0], families: [0, 0], theoretics: [0, 0], occurrences: [0, 0] };
const missing = [];
let occDone = Object.keys(images.occurrences).length;
for (const group of groups) {
  const rows = group === 'archetypes' ? field.archetypes
    : group === 'families' ? field.families
    : group === 'theoretics' ? field.theoretics
    : field.occurrences;
  // Curated occurrence queries are tried first: they name the picture on purpose.
  // The rest are searched from the occurrence's own label.
  const ids = group === 'occurrences'
    ? [...Object.keys(queries.occurrences || {}), ...rows.map((x) => x.id).filter((id) => !(queries.occurrences || {})[id])]
    : rows.map((x) => x.id);
  const byId = new Map(rows.map((x) => [x.id, x]));
  const nameOf = (id) => {
    const row = byId.get(id);
    return row?.label || row?.title || row?.name || id;
  };
  for (const id of ids) {
    if (onlyIds && !onlyIds.includes(id)) continue;
    summary[group][1]++;
    const spec = (queries[group] || {})[id];
    if (spec?.skip) {
      if (images[group][id]) {
        for (const f of [`${id}.jpg`, `${id}.thumb.jpg`]) fs.rmSync(path.join(IMG_DIR, group, f), { force: true });
        deleted.add(`${group}/${id}`);
        delete images[group][id];
        say(`pruned ${group}/${id}: ${spec.skip}`);
      }
      continue;
    }
    if (redo.has(id)) {
      const prev = images[group][id];
      if (prev?._file) usedTitles.delete(prev._file);
      for (const f of [`${id}.jpg`, `${id}.thumb.jpg`]) fs.rmSync(path.join(IMG_DIR, group, f), { force: true });
      delete images[group][id];
    }
    const have = images[group][id] || known[group][id];
    if (have && fs.existsSync(path.join(ROOT, 'public', have.src)) && fs.existsSync(path.join(ROOT, 'public', have.thumb))) { summary[group][0]++; continue; }
    if (group === 'occurrences' && occDone >= OCC_CAP) { say(`occurrence cap ${OCC_CAP} reached`); break; }
    // An uncurated entry is searched by its own name. Families are objects, so a
    // museum qualifier helps; occurrences are passages, so the label is the query.
    // allowBad lets a scarce museum photograph through; identityOk refuses a file
    // whose title is not the named thing.
    const row = byId.get(id);
    // Root rule: an occurrence without a pin or require-spec is never searched automatically.
    if (group === 'occurrences' && !(spec?.pin || spec?.require?.length)) { missing.push(`${group}/${id}: no pin or require spec (uncurated passage left unplated)`); continue; }
    const auto = autoSpec(nameOf(id), {
      museum: group === 'families',
      narrative: group === 'occurrences',
      family: row?.familyId || row?.family || '',
      // a node is named for itself: its name and aliases must be whole words in the file
      names: group === 'occurrences' ? null : [row?.name, ...(row?.aliases || [])].filter(Boolean),
    });
    const useSpec = spec || auto;
    if (!useSpec || (!useSpec.pin && !(useSpec.queries || []).length)) { missing.push(`${group}/${id}: no queries`); continue; }
    if (!spec) say(`  note: ${group}/${id} has no curated queries, using auto`);
    if (dir_over_budget()) { say('image budget reached; stopping'); break; }
    if (dry) { say(`[dry] ${group}/${id}: ${(useSpec.queries || [useSpec.pin]).join(' | ')}`); continue; }
    say(`${group}/${id}`);
    let pick;
    try { pick = await resolveFor(group, id, useSpec, { used: usedTitles }); } catch (e) { say(`  resolve failed: ${e.message}`); missing.push(`${group}/${id}: ${e.message}`); continue; }
    // Curated queries that miss still get the auto family/title pass — unless the curated
    // spec carries `require`: that spec names what the picture must show, so a miss is recorded.
    if (pick.error && spec && auto && !spec.pin && !spec.skip && !spec.require?.length) {
      say(`  curated miss (${pick.error}); trying auto`);
      try { pick = await resolveFor(group, id, auto, { used: usedTitles }); } catch (e) { pick = { error: e.message }; }
    }
    if (pick.error) { say(`  -> ${pick.error}`); missing.push(`${group}/${id}: ${pick.error}`); continue; }
    try {
      const ref = await download(group, id, useSpec, pick);
      ref._file = pick.cand.title;
      images[group][id] = ref; written.add(`${group}/${id}`);
      usedTitles.add(pick.cand.title);
      summary[group][0]++;
      if (group === 'occurrences') occDone++;
      say(`  -> ${pick.cand.title} (${pick.cand.license}, ${pick.cand.width}x${pick.cand.height}, score ${Math.round(pick.score)}, q="${pick.query}")`);
      save();
    } catch (e) {
      say(`  download failed: ${e.message}`);
      missing.push(`${group}/${id}: download ${e.message}`);
    }
  }
}
function dir_over_budget() { return dirSize(IMG_DIR) > BUDGET_BYTES; }

save();
const mb = (dirSize(IMG_DIR) / 1048576).toFixed(1);
console.log(`\ncoverage: archetypes ${summary.archetypes[0]}/${field.archetypes.length}, families ${summary.families[0]}/${field.families.length}, theoretics ${summary.theoretics[0]}/${field.theoretics.length}, occurrences ${Object.keys(images.occurrences).length} (${summary.occurrences[1]} requested); total ${mb} MB`);
if (missing.length) {
  const show = missing.slice(0, 60);
  console.log(`missing (${missing.length}):\n  ${show.join('\n  ')}${missing.length > show.length ? `\n  … ${missing.length - show.length} more` : ''}`);
}
