#!/usr/bin/env node
// Wikimedia Commons image fetcher: hero images for archetypes + families, selected occurrences.
// Usage: node scripts/images.mjs [--only archetypes|families|occurrences] [--id a,b] [--redo a,b] [--dry]
//        node scripts/images.mjs --remeta   (refresh baked title/credit/license from Commons; bytes untouched)
// Re-runnable: already-downloaded ids are skipped (their ImageRef lives in public/data/images.json).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ArchetypalEarth/0.1 (local research build)';
const CACHE = path.join(ROOT, '.cache', 'commons');
const IMG_DIR = path.join(ROOT, 'public', 'img');
const OUT = path.join(ROOT, 'public', 'data', 'images.json');
const FIELD = path.join(ROOT, 'public', 'data', 'field.json');
const QUERIES = path.join(ROOT, 'curation', 'image-queries.json');
// raised 175 -> 200 (2026-10 audit): the shipped tree already measured 175.8MB,
// so the old guard blocked every refetch; replaces are size-neutral swaps.
// raised 200 -> 240 (2026-10 coverage round): the owner asked that every family
// with a depictable tradition carry a plate; ~100 more families ≈ 40-55MB.
// raised 240 -> 320 (2026-10 uniqueness round): the owner asked for complete
// coverage and accepted close-match plates where the best scan is scarce.
const BUDGET_BYTES = 320 * 1024 * 1024;

// Wikimedia only serves "standard" thumbnail widths.
const WIDTH = { archetypes: 1920, families: 1280, occurrences: 960 };
const THUMB_W = 500;
const OCC_CAP = 260;

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
// --only takes a group (archetypes|families|occurrences) or, if it is not a group, a comma list of ids to fetch across groups
const RAW_ONLY = opt('--only');
const GROUPS = ['archetypes', 'families', 'occurrences'];
const only = RAW_ONLY && GROUPS.includes(RAW_ONLY) ? RAW_ONLY : null;
const onlyIds = RAW_ONLY && !only ? (opt('--id')?.split(',') || RAW_ONLY.split(',')) : opt('--id')?.split(',');
const redo = new Set(opt('--redo')?.split(',') || []);
const dry = args.includes('--dry');

fs.mkdirSync(CACHE, { recursive: true });
for (const g of ['archetypes', 'families', 'occurrences']) fs.mkdirSync(path.join(IMG_DIR, g), { recursive: true });

const field = JSON.parse(fs.readFileSync(FIELD, 'utf8'));
const queries = JSON.parse(fs.readFileSync(QUERIES, 'utf8'));
const images = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
for (const g of ['archetypes', 'families', 'occurrences']) images[g] ||= {};
const log = [];
const say = (m) => { console.log(m); log.push(m); };

// ---------- http ----------
let lastReq = 0;
let interval = 1400; // adaptive: Wikimedia's edge rate limiter answers 429 + Retry-After when we are too eager
let okStreak = 0;
async function throttle() {
  const wait = lastReq + interval - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
}
async function http(url, { binary = false, tries = 6 } = {}) {
  for (let i = 0; i < tries; i++) {
    await throttle();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: binary ? 'image/*' : 'application/json' } });
    } catch (e) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Math.max(Number(res.headers.get('retry-after')) || 0, 5);
      interval = Math.min(interval * 1.4, 5000);
      okStreak = 0;
      say(`  http ${res.status}, backing off ${ra}s (interval now ${Math.round(interval)}ms)`);
      await new Promise((r) => setTimeout(r, ra * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    if (++okStreak >= 15) { interval = Math.max(1200, interval * 0.9); okStreak = 0; }
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
  fs.writeFileSync(key, JSON.stringify(j));
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

function toCandidate(p, rank, widthReq) {
  const ii = p.imageinfo?.[0];
  if (!ii) return null;
  const em = ii.extmetadata || {};
  const v = (k) => strip(em[k]?.value);
  return {
    title: p.title,
    rank,
    mime: ii.mime,
    width: ii.width,
    height: ii.height,
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
const BAD_TITLE = /\b(logo|icon|flag|map|maps|diagram|chart|graph|coat of arms|stamp|banner|screenshot|template|poster|pdf|djvu|index|contents|cover|title ?page|signature|autograph|catalogue|wikimania|selfie|bookplate|invoice|passport|typeface|font|sketch of)\b|\b(IMG|DSC|DSCN|DSCF|PXL|P\d{7}|SAM)[_ -]?\d{3,}/i;
const BAD_CATS = /(portraits of living|photographs by|wikimania|maps of|diagrams|logos|flags of|coats of arms|postage stamps|selfies|banknotes|coins of the|bookplates|signatures|text pages|book covers|title pages)/i;
const ART = /(manuscript|codex|miniature|illuminat|engraving|woodcut|etching|lithograph|plate|fresco|relief|sculpture|statue|statuette|bronze|marble|mosaic|vase|amphora|krater|lekythos|painting|oil on|tempera|tapestry|emblem|alchem|stele|tomb|sarcophag|papyrus|cylinder seal|intaglio|gem|historical images|paintings|sculptures|woodcuts|engravings|museum|temple|cathedral|miniatures|drawings|reliefs|artwork|icon|ivory|terracotta|bas-relief)/i;
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'and', 'or', 'with', 'for', 'to', 'by', 'from', 'at', 'as', 'is', 'file', 'jpg', 'jpeg']);

function evaluate(c, q, ctx) {
  const hay = `${c.title} ${c.descr} ${c.cats.join(' ')} ${c.objectName}`.toLowerCase();
  if (c.mime !== 'image/jpeg' && !(c.mime === 'image/png' && hasSips)) return { ok: false, why: 'mime' };
  if (!licenseOk(c.license)) return { ok: false, why: `license ${c.license}` };
  // a spec may ask for close-match plates: scarce scans pass a lower resolution floor
  const minLongest = ctx.relaxed ? 600 : (ctx.minLongest || 900);
  const minShort = ctx.relaxed ? 320 : (ctx.minShort || 450);
  const longest = Math.max(c.width, c.height);
  if (longest < minLongest || Math.min(c.width, c.height) < minShort) return { ok: false, why: 'low-res' };
  // and a tall or wide plate: relaxed widens the aspect band (a standing figure, a frieze)
  const [arMax, arMin] = ctx.relaxed ? [3.4, 0.29] : [2.6, 0.36];
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

async function searchOne(q, width) {
  const j = await api({
    generator: 'search', gsrnamespace: '6', gsrlimit: '28', gsrsearch: `${q} filetype:bitmap`,
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(width),
    iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription|Categories|ObjectName|Credit',
  });
  const pages = (j.query?.pages || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.map((p, i) => toCandidate(p, i, width)).filter(Boolean);
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

function thumbUrl(cand, w) {
  const base = (cand.thumburl && cand.thumburl.includes('/thumb/') ? cand.thumburl : cand.url).split('?')[0];
  if (base.includes('/thumb/')) return base.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`);
  const m = base.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/(\w\/\w\w)\/([^/]+)$/);
  return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/${w}px-${m[3]}` : base;
}
function mainUrl(cand, w) {
  // original is smaller than the requested width -> the original itself
  if (Math.max(cand.width, cand.height) <= w && !cand.thumburl?.includes('/thumb/')) return cand.url.split('?')[0];
  return thumbUrl(cand, w);
}

// ---------- main ----------
async function resolveFor(group, id, spec, ctx) {
  const width = WIDTH[group];
  if (spec.pin) {
    const c = await fetchPinned(spec.pin, width);
    if (!c) return { error: `pin not found: ${spec.pin}` };
    const ev = evaluate(c, spec.pin, { ...ctx, allowBad: true, reuseOk: true, require: [], exclude: [], minLongest: 450, minShort: 300, relaxed: spec.relaxed });
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
      const score = ev.score + (qi === 0 ? 6 : qi === 1 ? 3 : 0);
      if (!best || score > best.score) best = { cand: c, score, query: q };
    }
    if (best && best.score >= 85 && !spec.exhaustive) break; // good enough; stop spending requests
  }
  return best || { error: 'no acceptable candidate' };
}

async function download(group, id, spec, pick) {
  const c = pick.cand;
  const dir = path.join(IMG_DIR, group);
  const mainPath = path.join(dir, `${id}.jpg`);
  const thumbPath = path.join(dir, `${id}.thumb.jpg`);
  const w = WIDTH[group];
  let main = await http(mainUrl(c, w), { binary: true });
  if (main[0] === 0x89 && main[1] === 0x50 && hasSips) {
    // PNG scan -> JPEG (the site serves jpg only)
    const tmpPng = path.join(CACHE, `${id}.png`);
    fs.writeFileSync(tmpPng, main);
    const r = spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', tmpPng, '--out', mainPath], { encoding: 'utf8' });
    fs.rmSync(tmpPng, { force: true });
    if (r.status !== 0 || !fs.existsSync(mainPath)) throw new Error('png->jpeg conversion failed');
    main = fs.readFileSync(mainPath);
  }
  if (main[0] !== 0xff || main[1] !== 0xd8 || main.length < 15000) throw new Error('main download is not a plausible JPEG');
  fs.writeFileSync(mainPath, main);
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

function save() {
  fs.writeFileSync(OUT, JSON.stringify(images, null, 1) + '\n');
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

const usedOcc = new Set(Object.values(images.occurrences).map((r) => r._file).filter(Boolean));
const summary = { archetypes: [0, 0], families: [0, 0], occurrences: [0, 0] };
const missing = [];
let occDone = Object.keys(images.occurrences).length;
for (const group of groups) {
  const ids = group === 'archetypes' ? field.archetypes.map((x) => x.id) : group === 'families' ? field.families.map((x) => x.id) : Object.keys(queries.occurrences || {});
  const nameOf = (id) => (group === 'archetypes' ? field.archetypes : group === 'families' ? field.families : field.occurrences).find((x) => x.id === id)?.name || id;
  for (const id of ids) {
    if (onlyIds && !onlyIds.includes(id)) continue;
    summary[group][1]++;
    const spec = (queries[group] || {})[id];
    if (spec?.skip) {
      if (images[group][id]) {
        for (const f of [`${id}.jpg`, `${id}.thumb.jpg`]) fs.rmSync(path.join(IMG_DIR, group, f), { force: true });
        delete images[group][id];
        say(`pruned ${group}/${id}: ${spec.skip}`);
      }
      continue;
    }
    if (redo.has(id)) {
      for (const f of [`${id}.jpg`, `${id}.thumb.jpg`]) fs.rmSync(path.join(IMG_DIR, group, f), { force: true });
      delete images[group][id];
    }
    const have = images[group][id];
    if (have && fs.existsSync(path.join(ROOT, 'public', have.src)) && fs.existsSync(path.join(ROOT, 'public', have.thumb))) { summary[group][0]++; continue; }
    if (group === 'occurrences' && occDone >= OCC_CAP) { say(`occurrence cap ${OCC_CAP} reached`); break; }
    // an uncurated family is named for the object itself; search that name, and accept a scarce museum photograph
    const auto = group === 'occurrences' ? null : { queries: [nameOf(id), `${nameOf(id)} museum`], relaxed: true, allowBad: true };
    const useSpec = spec || auto;
    if (!useSpec || (!useSpec.pin && !(useSpec.queries || []).length)) { missing.push(`${group}/${id}: no queries`); continue; }
    if (!spec) say(`  note: ${group}/${id} has no curated queries, using auto`);
    if (dir_over_budget()) { say('image budget reached; stopping'); break; }
    if (dry) { say(`[dry] ${group}/${id}: ${(useSpec.queries || [useSpec.pin]).join(' | ')}`); continue; }
    say(`${group}/${id}`);
    let pick;
    try { pick = await resolveFor(group, id, useSpec, { used: group === 'occurrences' ? usedOcc : usedTitles }); } catch (e) { say(`  resolve failed: ${e.message}`); missing.push(`${group}/${id}: ${e.message}`); continue; }
    if (pick.error) { say(`  -> ${pick.error}`); missing.push(`${group}/${id}: ${pick.error}`); continue; }
    try {
      const ref = await download(group, id, useSpec, pick);
      ref._file = pick.cand.title;
      images[group][id] = ref;
      usedTitles.add(pick.cand.title);
      if (group === 'occurrences') usedOcc.add(pick.cand.title);
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
console.log(`\ncoverage: archetypes ${summary.archetypes[0]}/${field.archetypes.length}, families ${summary.families[0]}/${field.families.length}, occurrences ${Object.keys(images.occurrences).length} (${summary.occurrences[1]} requested); total ${mb} MB`);
if (missing.length) console.log(`missing (${missing.length}):\n  ${missing.join('\n  ')}`);
