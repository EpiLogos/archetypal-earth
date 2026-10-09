// Runtime validator for public/data/field.json against src/types/field.ts.
const HEX = /^#[0-9a-fA-F]{6}$/;
const LOCUS = new Set(['artifact', 'text-passage', 'myth-episode', 'ritual', 'dream', 'vision', 'active-imagination', 'clinical-case', 'historical-event']);
const SUBJECT = new Set(['jung', 'patient-anon', 'n/a']);
const PREC = new Set(['place', 'region', 'culture', 'none']);
const BASIS = new Set(['jung', 'inferred', 'site']);
const SUBTYPE = new Set(['figure', 'object', 'process', 'scene', 'unknown']);

export function validateField(f) {
  const errs = [];
  const err = (m) => errs.push(m);
  const isStr = (v) => typeof v === 'string';
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!f || typeof f !== 'object') return ['field is not an object'];
  for (const k of ['meta', 'archetypes', 'families', 'occurrences', 'cultures']) if (f[k] == null) err(`missing top-level ${k}`);
  if (errs.length) return errs;

  const noLinks = (where, v) => {
    if (isStr(v) && /\[\[|\]\]/.test(v)) err(`${where}: wikilink syntax left in text: ${v.slice(0, 60)}`);
  };
  const palette = (where, p) => {
    if (!p || typeof p !== 'object') return err(`${where}: palette missing`);
    for (const k of ['core', 'glow', 'fog', 'deep']) if (!isStr(p[k]) || !HEX.test(p[k])) err(`${where}: palette.${k} not #rrggbb (${p[k]})`);
  };
  const spectrum = (where, s) => {
    if (!s || !isNum(s.position) || s.position < 0 || s.position > 1) err(`${where}: spectrum.position not in 0..1`);
  };
  const image = (where, im) => {
    if (im == null) return;
    for (const k of ['src', 'thumb', 'title', 'credit', 'license', 'sourceUrl']) if (!isStr(im[k]) || !im[k]) err(`${where}: image.${k} missing`);
    for (const k of ['width', 'height']) if (!isNum(im[k]) || im[k] <= 0) err(`${where}: image.${k} invalid`);
    if (im.tone != null && !HEX.test(im.tone)) err(`${where}: image.tone not hex`);
  };

  const archIds = new Set();
  for (const a of f.archetypes) {
    const w = `archetype ${a.id}`;
    if (!isStr(a.id) || !a.id) err('archetype without id');
    if (archIds.has(a.id)) err(`${w}: duplicate id`);
    archIds.add(a.id);
    if (!isStr(a.name)) err(`${w}: name`);
    if (!isStr(a.oneLine) || !a.oneLine || a.oneLine.length > 90) err(`${w}: oneLine empty or >90 (${(a.oneLine || '').length})`);
    if (typeof a.prime !== 'boolean') err(`${w}: prime`);
    spectrum(w, a.spectrum);
    palette(w, a.palette);
    if (a.definition && (!isStr(a.definition.text) || !isStr(a.definition.cite))) err(`${w}: definition shape`);
    if (!Array.isArray(a.body)) err(`${w}: body`);
    else a.body.forEach((p) => noLinks(w, p));
    image(w, a.image);
    if (!Array.isArray(a.familyIds)) err(`${w}: familyIds`);
    if (!isNum(a.occurrenceCount)) err(`${w}: occurrenceCount`);
    for (const k of ['name', 'oneLine']) noLinks(w, a[k]);
  }
  if (f.archetypes.filter((a) => a.prime).length !== 1) err('exactly one prime archetype expected');

  const famIds = new Set();
  for (const fam of f.families) {
    const w = `family ${fam.id}`;
    if (!isStr(fam.id) || !fam.id) err('family without id');
    if (famIds.has(fam.id)) err(`${w}: duplicate id`);
    famIds.add(fam.id);
    if (!isStr(fam.name) || !fam.name) err(`${w}: name`);
    if (!SUBTYPE.has(fam.subtype)) err(`${w}: subtype ${fam.subtype}`);
    if (!Array.isArray(fam.aliases)) err(`${w}: aliases`);
    // a family the vault gives no line for has no line; invented filler is the violation
    if (!isStr(fam.oneLine) || fam.oneLine.length > 90) err(`${w}: oneLine >90 (${(fam.oneLine || '').length})`);
    if (!Array.isArray(fam.archetypes) || fam.archetypes.length < 1) err(`${w}: needs >=1 archetype tie`);
    else
      for (const t of fam.archetypes) {
        if (!archIds.has(t.id)) err(`${w}: tie to unknown archetype ${t.id}`);
        if (!BASIS.has(t.basis)) err(`${w}: tie basis ${t.basis}`);
      }
    spectrum(w, fam.spectrum);
    palette(w, fam.palette);
    if (!Array.isArray(fam.body)) err(`${w}: body`);
    else fam.body.forEach((p) => noLinks(w, p));
    if (fam.definition && (!isStr(fam.definition.text) || !isStr(fam.definition.cite))) err(`${w}: definition shape`);
    image(w, fam.image);
    if (typeof fam.synthesised !== 'boolean') err(`${w}: synthesised`);
    for (const k of ['name', 'oneLine']) noLinks(w, fam[k]);
    (fam.aliases || []).forEach((x) => noLinks(w, x));
  }

  const cultIds = new Set();
  for (const c of f.cultures) {
    const w = `culture ${c.id}`;
    if (cultIds.has(c.id)) err(`${w}: duplicate`);
    cultIds.add(c.id);
    if (!isStr(c.name)) err(`${w}: name`);
    if (!isNum(c.lat) || c.lat < -90 || c.lat > 90) err(`${w}: lat`);
    if (!isNum(c.lon) || c.lon < -180 || c.lon > 180) err(`${w}: lon`);
  }

  const occIds = new Set(f.occurrences.map((o) => o.id));
  if (occIds.size !== f.occurrences.length) err('duplicate occurrence ids');
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const o of f.occurrences) {
    const w = `occurrence ${o.id}`;
    if (!isStr(o.title) || !o.title) err(`${w}: title`);
    if (!isStr(o.label) || !o.label || o.label.length > 48) err(`${w}: label empty or >48 (${(o.label || '').length})`);
    if (!famIds.has(o.familyId)) err(`${w}: familyId ${o.familyId} not a family`);
    for (const c of o.coFamilyIds || []) if (!famIds.has(c)) err(`${w}: coFamilyId ${c} not a family`);
    if (!LOCUS.has(o.locusType)) err(`${w}: locusType ${o.locusType}`);
    if (!SUBJECT.has(o.subject)) err(`${w}: subject ${o.subject}`);
    for (const c of o.cultureIds || []) if (!cultIds.has(c)) err(`${w}: cultureId ${c} not a culture`);
    if (!isStr(o.place)) err(`${w}: place`);
    if (!isNum(o.lat) || o.lat < -90 || o.lat > 90) err(`${w}: lat ${o.lat}`);
    if (!isNum(o.lon) || o.lon < -180 || o.lon > 180) err(`${w}: lon ${o.lon}`);
    if (!PREC.has(o.geoPrecision)) err(`${w}: geoPrecision ${o.geoPrecision}`);
    if (o.geoPrecision === 'none' && (o.lat !== 0 || o.lon !== 0)) err(`${w}: precision none must be 0,0`);
    if (!isNum(o.year) || o.year < -10000 || o.year > 2030) err(`${w}: year ${o.year} out of range`);
    else {
      yMin = Math.min(yMin, o.year);
      yMax = Math.max(yMax, o.year);
    }
    if (!isStr(o.yearDisplay)) err(`${w}: yearDisplay`);
    if (o.yearRange && !(Array.isArray(o.yearRange) && o.yearRange.length === 2 && o.yearRange.every(isNum))) err(`${w}: yearRange`);
    if (!Array.isArray(o.jung)) err(`${w}: jung`);
    else for (const c of o.jung) for (const k of ['work', 'workTitle', 'year', 'locator']) if (!isStr(c[k])) err(`${w}: cite.${k}`);
    if (!Array.isArray(o.body)) err(`${w}: body`);
    for (const p of o.parallelIds || []) if (!occIds.has(p)) err(`${w}: parallelId ${p} unresolved`);
    for (const k of ['title', 'label', 'place', 'quote']) noLinks(w, o[k]);
    (o.body || []).forEach((p) => noLinks(w, p));
    image(w, o.image);
  }
  // cross-consistency
  for (const fam of f.families) for (const id of fam.occurrenceIds || []) if (!occIds.has(id)) err(`family ${fam.id}: occurrenceId ${id} unknown`);
  for (const a of f.archetypes) for (const id of a.familyIds || []) if (!famIds.has(id)) err(`archetype ${a.id}: familyId ${id} unknown`);
  if (f.meta) {
    const c = f.meta.counts || {};
    if (c.archetypes !== f.archetypes.length || c.families !== f.families.length || c.occurrences !== f.occurrences.length || c.cultures !== f.cultures.length) err('meta.counts disagree with arrays');
    if (f.occurrences.length && (f.meta.yearMin !== yMin || f.meta.yearMax !== yMax)) err('meta.yearMin/Max disagree with occurrences');
  }
  return errs;
}

// CLI: node scripts/validate.mjs [path/to/field.json]
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'field.json');
  const errs = validateField(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (errs.length) {
    console.error(`${errs.length} validation errors in ${file}`);
    errs.slice(0, 50).forEach((e) => console.error('  - ' + e));
    process.exit(2);
  }
  console.log(`${file}: valid`);
}
