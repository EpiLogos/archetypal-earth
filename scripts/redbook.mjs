// Build public/data/redbook.json — the Red Book mode's data — from
// curation/redbook.json + public/data/field.json + the vault's Red Book layer.
// Laws kept here:
//   · the vault is read-only; plates are looked at (existence and pixel size) and
//     never copied;
//   · plates stay OUT of git and OUT of dist: redbook.json records plate file
//     names only, and they resolve against a dev-server-only route;
//   · every stop must be an ingested occurrence with subject "jung";
//   · every genesis quote must stand verbatim in the vault's red-book-bearing
//     map — the curation may not improve on the vault's words.
// --check verifies the published output without rewriting it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createNormalizer } from './lib/ocr.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export { DEFAULT_VAULT } from './lib/vault.mjs';
import { DEFAULT_VAULT } from './lib/vault.mjs';
const normalizer = createNormalizer({ freq: new Map(), english: new Set(), pairs: new Map() });
const norm = (t) => normalizer.normalize(t, { mode: 'safe' }).text;
// the vault's plate note in an instance file, in each of the forms the notes use: "PLATE (p0046.jpg = LS p.15): …",
// "PLATES (p0024.jpg = …): …", "PLATES: p0032.jpg (LS p.1) — …", "**Plate (p0081.jpg = ms p. 50, image 50).** …",
// at the start of a line or inside a paragraph
const PLATE_RE = /(?:^|\s)\**\s*PLATES?\b[^\n]*?(p\d{4})\.jpg[^\n]*?(?:\)\s*[:：.]?\**|\s—)\s*([^\n]+)/im;

/** The pixel size of a baseline or progressive JPEG, read from its frame header; null when the file is not one. */
function jpegSize(file) {
  const b = fs.readFileSync(file);
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}

export function buildRedbook({ root = ROOT, vault = DEFAULT_VAULT } = {}) {
  const curation = JSON.parse(fs.readFileSync(path.join(root, 'curation/redbook.json'), 'utf8'));
  const field = JSON.parse(fs.readFileSync(path.join(root, 'public/data/field.json'), 'utf8'));
  const occ = new Map(field.occurrences.map((o) => [o.id, o]));
  const arch = new Set(field.archetypes.map((a) => a.id));
  const fam = new Set(field.families.map((f) => f.id));

  const errors = [];
  const sections = new Map(curation.sections.map((s) => [s.id, s]));
  const platesDir = path.join(vault, curation.plates.vaultRelativeDir);
  const warnings = [];

  // aion reading ids, for genesis targets of kind "reading"
  let readingIds = [];
  try {
    const dir = path.join(root, 'curation/aion');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!Array.isArray(parsed.readings)) continue;
      readingIds.push(...parsed.readings.map((r) => r.id));
    }
  } catch { warnings.push('curation/aion unreadable; reading targets unresolved'); }

  const stops = curation.stops.map((stop) => {
    const o = occ.get(stop.id);
    if (!o) { errors.push(`stop ${stop.id}: not in field.json`); return stop; }
    if (o.subject !== 'jung') errors.push(`stop ${stop.id}: subject is ${o.subject}, expected jung`);
    if (!sections.has(stop.section)) errors.push(`stop ${stop.id}: unknown section ${stop.section}`);
    // a plate the curation names, else the vault's own PLATE note for the instance
    let plate = stop.plate ?? null;
    let plateCaption = stop.plateCaption ?? null;
    if (!plate) {
      // the vault's own note for the instance (the field's body no longer carries the vault's plate inventory)
      const note = path.join(vault, 'wiki/instances', `${stop.id}.md`);
      const m = fs.existsSync(note) ? PLATE_RE.exec(fs.readFileSync(note, 'utf8')) : null;
      if (m) { plate = `${m[1]}.jpg`; plateCaption = m[2].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim() || null; }
    }
    if (plate && !/^[a-z0-9_.-]+$/i.test(plate)) { errors.push(`stop ${stop.id}: bad plate name ${plate}`); plate = null; }
    if (plate && !fs.existsSync(path.join(platesDir, plate))) {
      warnings.push(`stop ${stop.id}: plate ${plate} not in the vault; dropped`);
      plate = null; plateCaption = null;
    }
    const plateSize = plate ? jpegSize(path.join(platesDir, plate)) : null;
    return { id: stop.id, sectionId: stop.section, ...(plate ? { plate, ...(plateSize ? { plateSize } : {}), ...(plateCaption ? { plateCaption } : {}) } : {}) };
  });

  const bearingPath = path.join(vault, 'wiki/maps/red-book-bearing.md');
  let bearing = '';
  try { bearing = norm(fs.readFileSync(bearingPath, 'utf8')); } catch { errors.push(`cannot read ${bearingPath}`); }

  const genesis = curation.genesis.map((row) => {
    const check = (t) => {
      if (!t) return;
      if (t.kind === 'archetype' && !arch.has(t.id)) errors.push(`genesis ${row.id}: unknown archetype ${t.id}`);
      if (t.kind === 'family' && !fam.has(t.id)) errors.push(`genesis ${row.id}: unknown family ${t.id}`);
      if (t.kind === 'reading' && !readingIds.includes(t.id)) errors.push(`genesis ${row.id}: unknown reading ${t.id}`);
    };
    check(row.target); check(row.also);
    if (!occ.has(row.stopId)) errors.push(`genesis ${row.id}: unknown stop ${row.stopId}`);
    if (bearing && !bearing.includes(norm(row.words))) errors.push(`genesis ${row.id}: words not verbatim in the vault's red-book-bearing map`);
    return row;
  });

  // the walk covers every liber-novus occurrence, and every section is populated
  const walkIds = new Set(stops.map((s) => s.id));
  for (const o of field.occurrences) if (o.id.includes('liber-novus') && !walkIds.has(o.id)) warnings.push(`occurrence ${o.id} is liber-novus but not on the walk`);
  for (const s of curation.sections) if (!stops.some((st) => st.sectionId === s.id)) errors.push(`section ${s.id} has no stops`);

  if (errors.length) throw new Error(`redbook curation invalid:\n${errors.map((e) => `  - ${e}`).join('\n')}`);

  return {
    doc: {
      generatedAt: new Date().toISOString(),
      licence: curation.licence,
      plates: curation.plates,
      mode: curation.mode,
      sections: curation.sections,
      stops,
      genesis,
    },
    warnings,
  };
}

function main() {
  const check = process.argv.includes('--check');
  try {
    const { doc, warnings } = buildRedbook();
    const target = path.join(ROOT, 'public/data/redbook.json');
    if (check) {
      const previous = JSON.parse(fs.readFileSync(target, 'utf8'));
      const a = { ...doc, generatedAt: previous.generatedAt };
      if (JSON.stringify(a) !== JSON.stringify(previous)) throw new Error('redbook.json differs from the curation; run npm run redbook');
    } else {
      fs.writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`);
    }
    const plates = doc.stops.filter((s) => s.plate).length;
    console.log(`${check ? 'Verified' : 'Generated'} Red Book: ${doc.stops.length} stops (${plates} with plates), ${doc.sections.length} sections, ${doc.genesis.length} genesis rows`);
    for (const w of warnings) console.log(`  · ${w}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
