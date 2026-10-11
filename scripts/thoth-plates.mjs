#!/usr/bin/env node
// Thoth card plates (ruling D8): the 78 cards of the Quaternal Tarot local art pack become
// plates of the Thoth card families. Writes public/img/families/<id>.jpg (long edge <= 1280,
// JPEG q82) and <id>.thumb.jpg (400px wide, q45), and merges the entries into
// public/data/images-ext.json. Never reads or writes public/data/images.json.
// Mapping mirrors Quaternal's buildCatalogue() (quaternal.html) and catalogue_images()
// (build_art_pack.py): majors are major_NN with 8 <-> 11 swapped (Adjustment = major_11,
// Lust = major_08); pips <suit>_01..10 (Ace..Ten); courts Knight,Queen,Prince,Princess =
// _14,_13,_12,_11.
// Usage: node scripts/thoth-plates.mjs [--dry]
//   THOTH_SRC=<dir> overrides the source directory (default ~/Central/Work/Quaternal-Tarot/art/thoth).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.THOTH_SRC
  ? path.resolve(process.env.THOTH_SRC)
  : path.join(os.homedir(), 'Central', 'Work', 'Quaternal-Tarot', 'art', 'thoth');
const FAM_DIR = path.join(ROOT, 'public', 'img', 'families');
const EXT = path.join(ROOT, 'public', 'data', 'images-ext.json');
const FAMILIES = path.join(ROOT, 'curation', 'families.json');
const ART_BASE = 'https://cdn.arcanika.com/cards/thoth/en/';
const PLATE_W = 1280;
const THUMB_W = 400;
const CREDIT = 'Frieda Harris, The Thoth Tarot (for Aleister Crowley); local pack of the Quaternal Tarot app';
const LICENSE = "All rights reserved; shipped on the owner's ruling (D8)";
const GROUPS = ['archetypes', 'families', 'theoretics', 'occurrences'];
const dry = process.argv.includes('--dry');

const pad = (n) => String(n).padStart(2, '0');

// Quaternal's MAJOR_NAMES (index 0..21, Crowley's order)
const MAJORS = [
  'The Fool', 'The Magus', 'The Priestess', 'The Empress', 'The Emperor',
  'The Hierophant', 'The Lovers', 'The Chariot', 'Adjustment', 'The Hermit',
  'Fortune', 'Lust', 'The Hanged Man', 'Death', 'Art', 'The Devil',
  'The Tower', 'The Star', 'The Moon', 'The Sun', 'The Aeon', 'The Universe',
];
const RANKS = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const RANK_ID = ['ace', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
// Quaternal's suit name, its image stem, and the family-id suit segment
const SUITS = [
  { name: 'Wands', stem: 'wands', id: 'wands' },
  { name: 'Cups', stem: 'cups', id: 'cups' },
  { name: 'Swords', stem: 'swords', id: 'swords' },
  { name: 'Disks', stem: 'pentacles', id: 'disks' },
];
const COURTS = [
  { name: 'Knight', n: 14, id: 'knight' },
  { name: 'Queen', n: 13, id: 'queen' },
  { name: 'Prince', n: 12, id: 'prince' },
  { name: 'Princess', n: 11, id: 'princess' },
];

/** One row per catalogue index 0..77: family id, card name (as the catalogue gives it), source file. */
function table() {
  const rows = [];
  MAJORS.forEach((name, i) => {
    const n = i === 8 ? 11 : i === 11 ? 8 : i;
    rows.push({
      index: i,
      id: 'thoth-' + name.replace(/^The /, '').toLowerCase().replace(/ /g, '-'),
      name,
      file: `major_${pad(n)}.jpg`,
    });
  });
  SUITS.forEach((s, g) => {
    const base = 22 + g * 14;
    RANKS.forEach((r, i) => rows.push({
      index: base + i,
      id: `thoth-${RANK_ID[i]}-of-${s.id}`,
      name: `${r} of ${s.name}`,
      file: `${s.stem}_${pad(i + 1)}.jpg`,
    }));
    COURTS.forEach((c, i) => rows.push({
      index: base + 10 + i,
      id: `thoth-${c.id}-of-${s.id}`,
      name: `${c.name} of ${s.name}`,
      file: `${s.stem}_${pad(c.n)}.jpg`,
    }));
  });
  return rows;
}

const rows = table();
if (rows.length !== 78 || new Set(rows.map((r) => r.index)).size !== 78) throw new Error('mapping is not 78 distinct indices');
if (new Set(rows.map((r) => r.id)).size !== 78) throw new Error('duplicate family ids in mapping');
if (new Set(rows.map((r) => r.file)).size !== 78) throw new Error('duplicate source files in mapping');

if (dry) {
  for (const r of rows) console.log(`${String(r.index).padStart(2)}  ${r.file.padEnd(16)} ${r.id.padEnd(28)} ${r.name}`);
  process.exit(0);
}

// ---------- preconditions ----------
const families = JSON.parse(fs.readFileSync(FAMILIES, 'utf8')).families;
const missing = rows.filter((r) => !families[r.id]).map((r) => r.id);
if (missing.length) throw new Error(`ids not in curation/families.json: ${missing.join(', ')}`);

for (const r of rows) {
  const p = path.join(SRC, r.file);
  const head = fs.readFileSync(p).subarray(0, 2);
  if (head[0] !== 0xff || head[1] !== 0xd8) throw new Error(`${p} is not a JPEG (magic bytes)`);
}

fs.mkdirSync(FAM_DIR, { recursive: true });

// ---------- ext file (merge, never read-modify-write images.json) ----------
let ext = { archetypes: {}, families: {}, theoretics: {}, occurrences: {} };
if (fs.existsSync(EXT)) ext = JSON.parse(fs.readFileSync(EXT, 'utf8'));
for (const g of GROUPS) ext[g] ||= {};

const plateRel = (id) => `img/families/${id}.jpg`;
const thumbRel = (id) => `img/families/${id}.thumb.jpg`;
const plateAbs = (id) => path.join(FAM_DIR, `${id}.jpg`);
const thumbAbs = (id) => path.join(FAM_DIR, `${id}.thumb.jpg`);

let added = 0;
let skipped = 0;
let bytesAdded = 0;
const log = [];

for (const r of rows) {
  const id = r.id;
  if (fs.existsSync(plateAbs(id)) && fs.existsSync(thumbAbs(id)) && ext.families[id]) {
    skipped++;
    continue;
  }
  const src = path.join(SRC, r.file);
  const plateBuf = await sharp(src)
    .rotate()
    .resize({ width: PLATE_W, height: PLATE_W, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const thumbBuf = await sharp(plateBuf)
    .resize({ width: THUMB_W, withoutEnlargement: true })
    .jpeg({ quality: 45 })
    .toBuffer();
  const meta = await sharp(plateBuf).metadata();
  const stats = await sharp(plateBuf).stats();
  // tone: channel means of the plate (the average colour images.mjs takes from a 1x1 resample)
  const tone = '#' + stats.channels.slice(0, 3)
    .map((c) => Math.round(c.mean).toString(16).padStart(2, '0')).join('');

  fs.writeFileSync(plateAbs(id), plateBuf);
  fs.writeFileSync(thumbAbs(id), thumbBuf);
  bytesAdded += plateBuf.length + thumbBuf.length;

  ext.families[id] = {
    src: plateRel(id),
    thumb: thumbRel(id),
    width: meta.width,
    height: meta.height,
    tone,
    title: `${r.name} — The Thoth Tarot (Frieda Harris, for Aleister Crowley)`,
    credit: CREDIT,
    license: LICENSE,
    sourceUrl: ART_BASE + r.file,
  };
  added++;
  log.push(`${id}  ${meta.width}x${meta.height}  plate ${(plateBuf.length / 1024).toFixed(0)}KB  thumb ${(thumbBuf.length / 1024).toFixed(0)}KB  ${tone}`);
}

if (added) {
  const tmp = `${EXT}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ext, null, 1) + '\n');
  fs.renameSync(tmp, EXT);
}

for (const line of log) console.log(line);
console.log(`thoth-plates: ${added} written, ${skipped} already present, bytes added ${bytesAdded} (${(bytesAdded / 1048576).toFixed(2)} MiB)`);

// ---------- verification ----------
const reread = JSON.parse(fs.readFileSync(EXT, 'utf8'));
let bad = 0;
for (const r of rows) {
  const e = reread.families[r.id];
  if (!e || !families[r.id]) { console.error(`missing ext/family entry: ${r.id}`); bad++; continue; }
  for (const p of [plateAbs(r.id), thumbAbs(r.id)]) {
    const b = fs.readFileSync(p);
    if (b[0] !== 0xff || b[1] !== 0xd8) { console.error(`bad JPEG magic: ${p}`); bad++; }
    const m = await sharp(p).metadata();
    if (!m.width || !m.height) { console.error(`zero dimensions: ${p}`); bad++; }
  }
}
const extCount = Object.keys(reread.families).filter((k) => rows.some((r) => r.id === k)).length;
console.log(`verify: ${rows.length - bad} of ${rows.length} ok, ext entries for thoth cards: ${extCount}, errors: ${bad}`);
if (bad) process.exit(1);
