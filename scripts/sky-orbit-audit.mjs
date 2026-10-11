#!/usr/bin/env node
// Sky orbit audit. For every body and tie in public/data/astrology.json, replays the join the sky orbits
// take at runtime (src/data/model.ts buildModel + subjectOccurrences; src/app/controller.ts pickShowcase and
// gazeFallbackFloats) over the baked field, and reports whether each orbit opens a plate, and whether its
// family-form plates would descend to a different family's focus (the Anima -> serpent bug).
//
// Usage: node scripts/sky-orbit-audit.mjs [--out <file.json>]
//   JSON report -> --out, or stdout when absent. Summary table -> stderr.
// Limits: pickShowcase's camera-visibility filter (`visible`) and the `passing` filter are view-dependent,
// so plate and leak counts are upper bounds.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(readFileSync(path.join(ROOT, 'public', 'data', name), 'utf8'));
const field = read('field.json');
const images = read('images.json'); // keyed store; the runtime reads the refs inlined in field.json
const astro = read('astrology.json');
const skyTies = read('sky.ties.json');
const outFlag = process.argv.indexOf('--out');
const outPath = outFlag > -1 ? process.argv[outFlag + 1] : null;
const PLATE_MAX = 5; // pickShowcase: 5 on desktop, 3 when narrow

// ---- text helpers, same rules as src/data/model.ts ----
function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function shortPlace(place) {
  const first = place.split(/[,;(–—/]| - /)[0].trim();
  if (first.length < 3 || first.length > 34 || /\d/.test(first)) return '';
  if (/\b(print|edition|ms|manuscript|version|milieu|tradition|collection)\b/i.test(first)) return '';
  return first;
}

// ---- buildModel indexes ----
const archById = new Map(field.archetypes.map((a) => [a.id, a]));
const famById = new Map(field.families.map((f) => [f.id, f]));
const theoById = new Map((field.theoretics ?? []).map((t) => [t.id, t]));
const cultureById = new Map(field.cultures.map((c) => [c.id, c]));
const occ = field.occurrences;
const push = (map, key, i) => (map.has(key) ? map.get(key).push(i) : map.set(key, [i]));

const located = occ.map((o) => o.geoPrecision !== 'none' && Number.isFinite(o.lat) && Number.isFinite(o.lon));
const famOcc = new Map();
const cultureOcc = new Map();
const placeOcc = new Map(); // slug -> { name, occ }, located only, kept when >= 2 (buildModel's rule)
occ.forEach((o, i) => {
  push(famOcc, o.familyId, i);
  for (const c of o.cultureIds) push(cultureOcc, c, i);
  const sp = shortPlace(o.place ?? '');
  if (sp && located[i]) {
    const id = slug(sp);
    if (!placeOcc.has(id)) placeOcc.set(id, { name: sp, occ: [] });
    placeOcc.get(id).occ.push(i);
  }
});
for (const [id, p] of placeOcc) if (p.occ.length < 2) placeOcc.delete(id);

// archetype -> families (its own familyIds plus any family listing it) -> occurrences
const archOcc = new Map();
for (const a of field.archetypes) {
  const fams = new Set(a.familyIds);
  for (const f of field.families) if (f.archetypes.some((t) => t.id === a.id)) fams.add(f.id);
  const set = new Set();
  for (const fid of fams) for (const i of famOcc.get(fid) ?? []) set.add(i);
  archOcc.set(a.id, [...set]);
}
const theoOcc = new Map();
for (const t of field.theoretics ?? []) {
  const set = new Set();
  for (const tie of t.archetypes) for (const i of archOcc.get(tie.id) ?? []) set.add(i);
  for (const tie of t.families) for (const i of famOcc.get(tie.id) ?? []) set.add(i);
  theoOcc.set(t.id, [...set]);
}

// ---- subject helpers (subjectOccurrences / subjectExists / subjectName / own image) ----
function members(s) {
  if (s.type === 'archetype') return archOcc.get(s.id) ?? [];
  if (s.type === 'theoretic') return theoOcc.get(s.id) ?? [];
  if (s.type === 'family') return famOcc.get(s.id) ?? [];
  if (s.type === 'culture') return cultureOcc.get(s.id) ?? [];
  return placeOcc.get(s.id)?.occ ?? [];
}
function resolves(s) {
  if (s.type === 'archetype') return archById.has(s.id);
  if (s.type === 'theoretic') return theoById.has(s.id);
  if (s.type === 'family') return famById.has(s.id);
  if (s.type === 'culture') return cultureById.has(s.id);
  return placeOcc.has(s.id);
}
function subjectName(s) {
  const e = s.type === 'archetype' ? archById.get(s.id)
    : s.type === 'theoretic' ? theoById.get(s.id)
    : s.type === 'family' ? famById.get(s.id)
    : s.type === 'culture' ? cultureById.get(s.id)
    : placeOcc.get(s.id);
  return e?.name ?? s.id;
}
function ownImage(s) {
  const e = s.type === 'archetype' ? archById.get(s.id)
    : s.type === 'theoretic' ? theoById.get(s.id)
    : s.type === 'family' ? famById.get(s.id)
    : null;
  return e?.image ?? null;
}
const STORE_KEY = { archetype: 'archetypes', theoretic: 'theoretics', family: 'families' };
const skyKeys = new Set(Object.values(skyTies.ties).map((t) => `${t.body}|${t.type}:${t.id}|${t.basis}`));

// ---- one tie ----
function auditTie(body, tie, seen) {
  const s = tie.target;
  const key = `${s.type}:${s.id}`;
  const all = members(s);
  const idx = all.filter((i) => located[i]);
  const own = ownImage(s);
  const occImg = idx.filter((i) => occ[i].image).length;

  // pickShowcase offers a family plate for each family among the located occurrences that has an image; its
  // target is family:<that family>, which descends to a different subject when the orbit is not a family.
  const leaks = [];
  if (s.type !== 'family') {
    for (const i of idx) {
      const f = occ[i].familyId;
      if (famById.get(f)?.image && !leaks.includes(f)) leaks.push(f);
    }
  }

  const raw = (own ? 1 : 0) + occImg + leaks.length;
  // no located instances: gazeFallbackFloats gives one placard; no images: pickShowcase gives tonal plates
  const plates = !idx.length ? 1 : raw ? Math.min(raw, PLATE_MAX) : Math.min(idx.length, PLATE_MAX);
  const reachable = idx.length || own ? 'ok' : resolves(s) ? 'fallback-only' : 'dead';

  return {
    body,
    target: s,
    basis: tie.basis,
    name: subjectName(s),
    resolves: resolves(s),
    occurrences: all.length,
    located: idx.length,
    withImage: occImg + (own ? 1 : 0),
    ownImage: !!own,
    plates,
    reachable,
    familyLeaks: leaks,
    wrongTargetSuspects: leaks.slice(0, 3).map((id) => ({ id, name: famById.get(id).name })),
    duplicate: seen.has(key),
    skyTiesMatch: skyKeys.has(`${body}|${key}|${tie.basis}`),
    storeImageNotInField: !own && !!(STORE_KEY[s.type] && images[STORE_KEY[s.type]]?.[s.id]),
  };
}

// ---- run over every body ----
const records = [];
const bodies = [];
for (const [key, b] of Object.entries(astro.bodies)) {
  const seen = new Set();
  const rows = b.ties.map((t) => {
    const r = auditTie(key, t, seen);
    seen.add(`${t.target.type}:${t.target.id}`);
    return r;
  });
  records.push(...rows);
  const n = (f) => rows.filter(f).length;
  bodies.push({
    body: key,
    name: b.name,
    ties: rows.length,
    ok: n((r) => r.reachable === 'ok'),
    fallbackOnly: n((r) => r.reachable === 'fallback-only'),
    dead: n((r) => r.reachable === 'dead'),
    leaking: n((r) => r.familyLeaks.length > 0),
    unresolved: n((r) => !r.resolves),
    duplicates: n((r) => r.duplicate),
  });
}

const sum = (k) => bodies.reduce((acc, b) => acc + b[k], 0);
const totals = Object.fromEntries(['ties', 'ok', 'fallbackOnly', 'dead', 'leaking', 'unresolved', 'duplicates'].map((k) => [k, sum(k)]));
const astroKeys = new Set(records.map((r) => `${r.body}|${r.target.type}:${r.target.id}|${r.basis}`));
const crossCheck = {
  astrologyNotInSkyTies: [...astroKeys].filter((k) => !skyKeys.has(k)),
  skyTiesNotInAstrology: [...skyKeys].filter((k) => !astroKeys.has(k)),
};

// ---- outputs ----
const report = { generatedAt: new Date().toISOString(), totals, bodies, crossCheck, ties: records };
const json = JSON.stringify(report, null, 2) + '\n';
if (outPath) writeFileSync(path.resolve(outPath), json);
else process.stdout.write(json);

const head = ['body', 'ties', 'ok', 'fallback', 'dead', 'leaking', 'unresolved', 'dupes'];
const row = (cells) => cells.map((c, i) => (i === 0 ? String(c).padEnd(10) : String(c).padStart(12))).join('');
const table = [
  row(head),
  ...bodies.map((b) => row([b.body, b.ties, b.ok, b.fallbackOnly, b.dead, b.leaking, b.unresolved, b.duplicates])),
  row(['TOTAL', totals.ties, totals.ok, totals.fallbackOnly, totals.dead, totals.leaking, totals.unresolved, totals.duplicates]),
  `sky.ties.json vs astrology.json: ${crossCheck.astrologyNotInSkyTies.length} astrology-only, ${crossCheck.skyTiesNotInAstrology.length} sky-only`,
];
process.stderr.write(table.join('\n') + '\n');
