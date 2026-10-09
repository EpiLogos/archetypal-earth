#!/usr/bin/env node
// Metadata-only verification of the shipped image corpus. Opens no image: trust here
// is provenance (title/credit/license/sourceUrl recorded per file), byte identity
// (sha256), manifest↔disk↔field agreement — never a model's look at the picture.
// Usage: node scripts/images-verify.mjs   (exit 1 on any error, warnings allowed)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG_DIR = path.join(ROOT, 'public', 'img');
const OUT = path.join(ROOT, 'public', 'data', 'images.json');
const FIELD = path.join(ROOT, 'public', 'data', 'field.json');
const GROUPS = ['archetypes', 'families', 'occurrences'];

// the same licence law the fetcher enforces (scripts/images.mjs); "No restrictions"
// is Commons' marker for no known copyright restrictions
const IMPROPER_LICENSE = /\b(NC|ND|GFDL|fair use|all rights reserved|non-?commercial)\b/i;
const licenseOk = (l) => !!l && !IMPROPER_LICENSE.test(l) &&
  /^(public domain|pd\b|pd-|pdm\b|pdm-|cc0|cc[ -]by\b|cc[ -]by[ -]sa|attribution|no restrictions)/i.test(l);

const errors = [];
const warnings = [];
const seenWarn = new Set();
const err = (m) => errors.push(m);
const warn = (m) => { if (!seenWarn.has(m)) { seenWarn.add(m); warnings.push(m); } };

const images = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const field = JSON.parse(fs.readFileSync(FIELD, 'utf8'));

const entries = []; // { group, id, ref }
for (const g of GROUPS) for (const [id, ref] of Object.entries(images[g] || {})) entries.push({ group: g, id, ref });

// ── manifest ↔ disk ↔ field ────────────────────────────────────────────────
const referenced = new Set();
for (const { group, id, ref } of entries) {
  const where = `${group}/${id}`;
  for (const k of ['src', 'thumb', 'title', 'credit', 'license', 'sourceUrl']) {
    if (!ref[k] || typeof ref[k] !== 'string') err(`${where}: provenance field ${k} missing`);
  }
  if (ref.license && !licenseOk(ref.license)) err(`${where}: licence not allowed: ${ref.license}`);
  if (!Number.isInteger(ref.width) || ref.width <= 0 || !Number.isInteger(ref.height) || ref.height <= 0) err(`${where}: dimensions invalid`);
  if (ref.tone != null && !/^#[0-9a-fA-F]{6}$/.test(ref.tone)) err(`${where}: tone not hex`);
  if (!ref._file) warn(`${where}: no _file (Commons source title) recorded`);
  for (const k of ['src', 'thumb']) {
    const p = path.join(ROOT, 'public', ref[k]);
    if (!fs.existsSync(p)) err(`${where}: ${k} missing on disk: ${ref[k]}`);
    else referenced.add(path.relative(IMG_DIR, p));
  }
}

const fieldIds = {
  archetypes: new Set(field.archetypes.map((x) => x.id)),
  families: new Set(field.families.map((x) => x.id)),
  occurrences: new Set(field.occurrences.map((x) => x.id)),
};
for (const g of GROUPS) {
  for (const id of Object.keys(images[g] || {})) {
    if (!fieldIds[g].has(id)) err(`${g}/${id}: manifest entry for an id the field does not have`);
  }
}

for (const dir of GROUPS) {
  const d = path.join(IMG_DIR, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!referenced.has(path.join(dir, f))) err(`orphan file on disk: img/${dir}/${f}`);
  }
}

// ── byte identity: the duplicate-image detector ────────────────────────────
const byHash = new Map(); // sha256 -> [{ where, kind }]
const bySource = new Map(); // Commons File: -> [{ where }]
const hashOf = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for (const { group, id, ref } of entries) {
  const where = `${group}/${id}`;
  for (const k of ['src', 'thumb']) {
    const p = path.join(ROOT, 'public', ref[k]);
    if (!fs.existsSync(p)) continue;
    const h = hashOf(p);
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push({ where, kind: k });
  }
  if (ref._file) {
    if (!bySource.has(ref._file)) bySource.set(ref._file, []);
    bySource.get(ref._file).push(where);
  }
}
for (const [h, list] of byHash) {
  const wheres = [...new Set(list.map((x) => x.where))];
  if (wheres.length < 2) continue;
  // byte-identity under one recorded source is intended curation (two records of one plate);
  // identical bytes with no source, or under different sources, means one claim is not honest
  const sharing = entries.filter((e) => wheres.includes(`${e.group}/${e.id}`));
  const withSource = sharing.filter((e) => e.ref._file);
  if (withSource.length < sharing.length) err(`byte-identical ${list[0].kind} with a record missing its source: ${wheres.join(' ≡ ')}`);
  else {
    const sources = new Set(withSource.map((e) => e.ref._file));
    if (sources.size > 1) err(`byte-identical ${list[0].kind} across different sources: ${wheres.join(' ≡ ')}`);
    else warn(`one Commons plate serves several entries (${wheres.join(', ')}): ${[...sources][0]}`);
  }
}
for (const [file, wheres] of bySource) {
  const uniq = [...new Set(wheres)];
  if (uniq.length > 1) warn(`one Commons source serves several entries (${uniq.join(', ')}): ${file}`);
}

// ── the published fold agrees with the manifest ────────────────────────────
let attached = 0;
for (const [group, list] of [['archetypes', field.archetypes], ['families', field.families], ['occurrences', field.occurrences]]) {
  for (const obj of list) {
    if (obj.image) {
      attached++;
      const im = (images[group] || {})[obj.id];
      if (!im) err(`field ${group}/${obj.id} carries an image the manifest does not have`);
      else if (im.src !== obj.image.src) err(`field ${group}/${obj.id} image src disagrees with the manifest`);
    } else if ((images[group] || {})[obj.id]) {
      err(`manifest has ${group}/${obj.id} but the field does not carry it`);
    }
  }
}
if (field.meta?.counts?.images !== attached) {
  err(`meta.counts.images is ${field.meta?.counts?.images}, the fold holds ${attached}`);
}

const mb = (n) => (n / 1048576).toFixed(1);
const total = fs.readdirSync(IMG_DIR, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).reduce((s, e) => s + fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size, 0);
const BUDGET_BYTES = 320 * 1024 * 1024; // kept in step with scripts/images.mjs (2026-10 uniqueness round)
if (total > BUDGET_BYTES) err(`image dir ${mb(total)} MB over budget`);
else if (total > BUDGET_BYTES * 0.9) warn(`image dir ${mb(total)} MB is above 90% of budget`);

// ── report ─────────────────────────────────────────────────────────────────
console.log(`images: ${entries.length} entries (archetypes ${Object.keys(images.archetypes || {}).length}, families ${Object.keys(images.families || {}).length}, occurrences ${Object.keys(images.occurrences || {}).length}), ${attached} folded, ${mb(total)} MB`);
for (const w of warnings) console.log(`warn: ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
if (errors.length) {
  console.log(`\nimages-verify: FAILED (${errors.length} error(s), ${warnings.length} warning(s))`);
  process.exit(1);
}
console.log(`images-verify: ok (${warnings.length} warning(s))`);
