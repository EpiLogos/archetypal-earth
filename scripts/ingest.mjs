#!/usr/bin/env node
// Vault -> public/data/field.json (+ field.stats.json). Re-runnable, deterministic, tolerant.
// Env: VAULT overrides the vault path.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT, readNotes, asList, linkTargets, slugify, stripLinks } from './lib/vault.mjs';
import { plain, shortLabel, parseInstanceBody, oneLineFromForm, collapse } from './lib/text.mjs';
import { loadGazetteer, matchPlace, loadCultures, normCultureSlug, jitter, JIT } from './lib/geo.mjs';
import { validateField } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = process.env.VAULT || DEFAULT_VAULT;
const OUT_DIR = process.env.FIELD_OUT_DIR ? path.resolve(process.env.FIELD_OUT_DIR) : path.join(ROOT, 'public', 'data');
const IMAGES_JSON = path.join(ROOT, 'public', 'data', 'images.json');
const CUR = (f) => path.join(ROOT, 'curation', f);
const readJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    if (fallback !== undefined) return fallback;
    throw new Error(`cannot read ${f}`);
  }
};

const LOCUS = new Set(['artifact', 'text-passage', 'myth-episode', 'ritual', 'dream', 'vision', 'active-imagination', 'clinical-case', 'historical-event']);
const BASIS_RANK = { jung: 0, inferred: 1, site: 2 };
const BASIS_WEIGHT = { jung: 3, inferred: 2, site: 1 };

const skips = []; // {kind, id, reason}
const warnings = [];
const skip = (kind, id, reason) => skips.push({ kind, id, reason });
const warn = (m) => warnings.push(m);

if (!fs.existsSync(path.join(VAULT, 'wiki'))) {
  console.error(`Vault not found at ${VAULT} (set VAULT=...)`);
  process.exit(1);
}

// ---------- color / blend helpers ----------
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c) => '#' + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
function blendPalettes(items) {
  const tot = items.reduce((s, i) => s + i.w, 0);
  const out = {};
  for (const k of ['core', 'glow', 'fog', 'deep']) {
    const acc = [0, 0, 0];
    for (const it of items) hex2rgb(it.palette[k]).forEach((v, j) => (acc[j] += v * it.w));
    out[k] = rgb2hex(acc.map((v) => v / tot));
  }
  return out;
}
const r3 = (x) => Math.round(x * 1000) / 1000;

// ---------- load curation ----------
const curArch = readJson(CUR('archetypes.json')).archetypes;
const curFam = readJson(CUR('families.json'));
const famMerges = curFam.merges || {};
const famOver = curFam.families || {};
const curTies = readJson(CUR('family-ties.json')).ties;
const gaz = loadGazetteer(CUR('gazetteer.json'));
const { aliases: cultAliases, cultures: cultTable } = loadCultures(CUR('cultures.json'));
const yearOver = readJson(CUR('year-overrides.json'), { years: {} }).years;
const imagesJson = readJson(IMAGES_JSON, { archetypes: {}, families: {}, occurrences: {} });

// ---------- load vault ----------
const W = (d) => path.join(VAULT, 'wiki', d);
const archNotes = readNotes(W('archetypes'));
const imgNotes = readNotes(W('images'));
const instNotes = readNotes(W('instances'));
const manifest = readJson(path.join(VAULT, '_raw', 'manifest.json'), []);
const workTitles = Object.fromEntries(manifest.map((m) => [m.vol, m.title]));
let mentions = [];
try {
  mentions = fs.readFileSync(path.join(VAULT, 'data', 'mentions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
} catch { warn('data/mentions.jsonl unreadable; archetype definitions omitted'); }
let lexicon = [];
try { lexicon = readJson(path.join(VAULT, 'data', 'lexicon.json')).entries || []; } catch { warn('lexicon.json unreadable'); }

let ledgerLine;
try {
  const heads = fs.readFileSync(path.join(VAULT, 'LEDGER.md'), 'utf8').split(/\r?\n/).filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, '').trim());
  const dated = heads.filter((h) => /^\d{4}-\d{2}-\d{2}/.test(h));
  // freshness: newest dated heading (ledger is newest-first), else the literal last heading
  ledgerLine = dated.length ? dated.reduce((a, b) => (b.slice(0, 10) > a.slice(0, 10) ? b : a)) : heads[heads.length - 1];
} catch { warn('LEDGER.md unreadable'); }

for (const n of [...archNotes, ...imgNotes, ...instNotes]) {
  if (n.failed) skip('note', n.slug, 'frontmatter unrecoverable');
  else if (n.fallback) warn(`frontmatter repaired field-by-field: ${n.slug}`);
}

// ---------- cite helpers ----------
function workLabel(key) {
  const k = key.toLowerCase().replace(/^cw(\d)([a-z]*)$/, (m, d, s) => `cw${d.padStart(2, '0')}${s}`);
  const m = k.match(/^cw(\d+)([a-z]*)$/);
  const title = workTitles[k];
  const short = m ? `CW${Number(m[1])}${m[2]}` : null;
  return { key: k, title: title ? (short ? `${title} (${short})` : title) : short || key, short, bare: title };
}
function parseCite(s) {
  const parts = String(s).split('|').map((x) => x.trim());
  let work = parts[0];
  let year = '';
  let locator = '';
  if (parts.length >= 3) { year = parts[1]; locator = parts.slice(2).join(' | '); }
  else if (parts.length === 2) { year = parts[1]; }
  else {
    const m = String(s).match(/^(\S+)\s+(.*)$/);
    if (m) { work = m[1]; locator = m[2]; }
  }
  const wl = workLabel(work.replace(/[^\w-]/g, ''));
  return { work: wl.key, workTitle: wl.title, year: collapse(year), locator: collapse(locator) };
}

// ---------- archetypes ----------
const archSlugs = new Set(archNotes.filter((n) => !n.failed).map((n) => n.slug));
const archById = {};
const archList = [];
for (const n of archNotes.filter((x) => !x.failed)) {
  const c = curArch[n.slug];
  if (!c) { skip('archetype', n.slug, 'no curation/archetypes.json entry'); archSlugs.delete(n.slug); continue; }
  const a = {
    id: n.slug,
    name: c.name,
    oneLine: c.oneLine,
    prime: n.data.prime === true || n.data.prime === 'true',
    spectrum: { position: r3(c.position) },
    palette: c.palette,
    body: (c.body || []).map(collapse),
    familyIds: [],
    occurrenceCount: 0,
  };
  if (c.definitionPick?.length) {
    const recs = c.definitionPick.map((p) => mentions.find((m) => m.vol === p.vol && Number(m.para) === Number(p.para) && String(m.quote).trimStart().startsWith(p.starts)));
    if (recs.every(Boolean)) {
      const p0 = c.definitionPick[0];
      const wl = workLabel(p0.vol);
      const short = (wl.bare || wl.title).split(':')[0];
      a.definition = { text: collapse(recs.map((r) => r.quote).join(' ')), cite: `${short} (${wl.short}) ¶${p0.para}` };
    } else warn(`definitionPick for ${n.slug} not found verbatim in mentions.jsonl; definition omitted`);
  }
  archById[a.id] = a;
  archList.push(a);
}
for (const k of Object.keys(curArch)) if (!archSlugs.has(k)) warn(`curation archetype ${k} has no vault note`);
archList.sort((a, b) => (b.prime - a.prime) || a.id.localeCompare(b.id));

// ---------- families ----------
const famMap = {};
const titleCase = (slug) => {
  const t = slug.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const lexAliases = {};
for (const e of lexicon) {
  if (e.tier !== 'image') continue;
  const slug = slugify(e.canonical || '');
  lexAliases[slug] = (lexAliases[slug] || []).concat(asList(e.aliases));
}
for (const n of imgNotes.filter((x) => !x.failed)) {
  const over = famOver[n.slug] || {};
  const st = String(n.data.subtype || '').toLowerCase();
  const als = [...asList(n.data.aliases), ...(lexAliases[n.slug] || [])].map((x) => collapse(plain(x).replace(/^["']|["']$/g, ''))).filter(Boolean);
  famMap[n.slug] = {
    id: n.slug,
    name: over.name || titleCase(n.slug),
    subtype: ['figure', 'object', 'process', 'scene'].includes(st) ? st : 'unknown',
    aliases: [],
    _aliases: als,
    oneLine: over.oneLine || oneLineFromForm(n.body),
    _form: !over.oneLine,
    _over: over,
    archetypes: [],
    body: (over.body || []).map(collapse),
    occurrenceIds: [],
    synthesised: false,
    _vault: n,
  };
}
// alias -> family (only unambiguous aliases), so [[snake]] resolves to serpent
const aliasIndex = {};
const aliasClash = new Set();
for (const fam of Object.values(famMap)) {
  for (const a of fam._aliases) {
    const k = slugify(a);
    if (!k || famMap[k]) continue;
    if (aliasIndex[k] && aliasIndex[k] !== fam.id) aliasClash.add(k);
    else aliasIndex[k] = fam.id;
  }
}
for (const k of aliasClash) delete aliasIndex[k];
const resolveFam = (slug) => {
  if (!slug) return null;
  const s = famMerges[slug] || slug;
  if (famMap[s]) return s;
  if (!archSlugs.has(s) && aliasIndex[s]) return aliasIndex[s];
  return s;
};

// ---------- occurrences ----------
const cultureCount = {};
const unknownCultures = {};
const geoSource = { place: 0, 'patient-default': 0, title: 0, culture: 0, none: 0 };
const unresolvedPlaces = [];
const occList = [];
const occIds = new Set(instNotes.filter((x) => !x.failed).map((n) => n.slug));

function guessYear(display) {
  const d = String(display || '');
  let m = d.match(/(\d{1,2})(?:st|nd|rd|th)\s*c\.?\s*(BCE|BC|AD|CE)?/i);
  if (m) {
    const c = Number(m[1]);
    const bce = /BC/i.test(m[2] || '') || /BCE|BC\b/.test(d);
    return bce ? -(c * 100 - 50) : c * 100 - 50;
  }
  m = d.match(/(\d{3,4})\s*(BCE|BC)?/i);
  if (m) return /BC/i.test(m[2] || '') ? -Number(m[1]) : Number(m[1]);
  return null;
}

for (const n of instNotes.filter((x) => !x.failed)) {
  const d = n.data;
  const id = n.slug;
  const title = collapse(plain(d.title || ''));
  if (!title) { skip('instance', id, 'no title'); continue; }
  const primaryRaw = linkTargets(d.instance_of)[0];
  if (!primaryRaw) { skip('instance', id, 'no instance_of'); continue; }
  const familyId = resolveFam(primaryRaw);
  let year = Number.isFinite(Number(d.year_int)) && d.year_int !== null && d.year_int !== '' ? Number(d.year_int) : null;
  let yearDisplay = collapse(plain(d.year_display ?? ''));
  if (year === null && yearOver[id] != null) year = Number(yearOver[id]);
  if (year === null) year = guessYear(d.year_display);
  if (year === null) { skip('instance', id, `no usable year (year_display: ${yearDisplay || 'none'})`); continue; }
  if (year < -10000 || year > 2030) { skip('instance', id, `year ${year} out of range`); continue; }
  if (!yearDisplay) yearDisplay = year < 0 ? `${-year} BCE` : `${year}`;
  let locusType = String(d.locus_type || '').trim().toLowerCase();
  if (!LOCUS.has(locusType)) { warn(`${id}: unknown locus_type "${locusType}" -> text-passage`); locusType = 'text-passage'; }
  const subj = String(d.subject || 'n/a').toLowerCase();
  const subject = subj === 'jung' ? 'jung' : subj === 'patient-anon' ? 'patient-anon' : 'n/a';

  const cultureIds = [];
  for (const raw of asList(d.culture)) {
    const slug = normCultureSlug(raw, cultAliases);
    if (!slug) continue;
    if (!cultTable[slug]) { unknownCultures[slug] = (unknownCultures[slug] || 0) + 1; continue; }
    if (!cultureIds.includes(slug)) cultureIds.push(slug);
  }
  for (const c of cultureIds) cultureCount[c] = (cultureCount[c] || 0) + 1;

  let place = collapse(plain(d.place ?? ''));
  if (/^(undefined|null|none|n\/a|\?)$/i.test(place)) place = '';

  // geocoding chain
  let lat = 0, lon = 0, precision = 'none';
  const hit = place ? matchPlace(place, gaz) : null;
  if (hit) {
    [lat, lon] = jitter(id, hit.lat, hit.lon, hit.jit ?? JIT[hit.precision]);
    precision = hit.precision;
    geoSource.place++;
  } else if (subject === 'patient-anon') {
    const z = matchPlace('Zurich', gaz);
    [lat, lon] = jitter(id, z.lat, z.lon, 0.15);
    precision = 'region';
    geoSource['patient-default']++;
  } else {
    const alt = matchPlace(`${title} ${stripLinks(asList(d.appears_in).join(' '))}`, gaz);
    if (alt) {
      [lat, lon] = jitter(id, alt.lat, alt.lon, alt.jit ?? JIT.region);
      precision = 'region';
      geoSource.title++;
    } else if (cultureIds.length) {
      const c = cultTable[cultureIds[0]];
      [lat, lon] = jitter(id, c.lat, c.lon, JIT.culture);
      precision = 'culture';
      geoSource.culture++;
      unresolvedPlaces.push(place || '(none)');
    } else {
      geoSource.none++;
      unresolvedPlaces.push(place || '(none)');
    }
  }

  const coFamilyIds = [];
  for (const raw of linkTargets(d.co_manifests)) {
    const f = resolveFam(raw);
    if (f && f !== familyId && !coFamilyIds.includes(f)) coFamilyIds.push(f);
  }

  const parsed = parseInstanceBody(n.body);
  const jung = asList(d.jung_engagement).map(parseCite).filter((c) => c.work);
  let yearRange;
  const yr = Array.isArray(d.year_range) ? d.year_range.map(Number) : null;
  if (yr && yr.length === 2 && yr.every(Number.isFinite)) yearRange = [Math.min(...yr), Math.max(...yr)];

  const occ = {
    id,
    title,
    label: shortLabel(title),
    familyId,
    coFamilyIds,
    locusType,
    subject,
    cultureIds,
    place,
    lat,
    lon,
    geoPrecision: precision,
    year,
    yearDisplay,
    ...(yearRange ? { yearRange } : {}),
    jung,
    ...(parsed.quote ? { quote: parsed.quote } : {}),
    body: parsed.body,
    parallelIds: parsed.parallels.filter((p) => p !== id && occIds.has(p)),
    _parallelsRaw: parsed.parallels,
  };
  occList.push(occ);
}
occList.sort((a, b) => a.id.localeCompare(b.id));
const occById = Object.fromEntries(occList.map((o) => [o.id, o]));
// parallelIds must resolve against occurrences actually kept
for (const o of occList) {
  o.parallelIds = [...new Set(o._parallelsRaw.filter((p) => p !== o.id && occById[p]))];
  delete o._parallelsRaw;
}

// synthesise families for instance_of / co_manifests targets without a note
const unresolvedFamilies = {};
for (const o of occList) {
  for (const f of [o.familyId, ...o.coFamilyIds]) {
    if (famMap[f]) continue;
    if (archSlugs.has(f) || !/^[a-z0-9][a-z0-9-]*$/.test(f)) continue; // co_manifest naming an archetype / junk: not a family
    if (f === o.familyId) {
      unresolvedFamilies[f] = (unresolvedFamilies[f] || 0) + 1;
      const over = famOver[f] || {};
      famMap[f] = {
        id: f, name: over.name || titleCase(f), subtype: 'unknown', aliases: [], _aliases: [],
        oneLine: over.oneLine || null, _form: false, _over: over, archetypes: [], body: (over.body || []).map(collapse),
        occurrenceIds: [], synthesised: true, _vault: null,
      };
    }
  }
}
// co-manifests that are not families (archetype names, unresolvable) are dropped, and tallied
const droppedCo = {};
for (const o of occList) {
  o.coFamilyIds = o.coFamilyIds.filter((f) => {
    if (famMap[f]) return true;
    droppedCo[f] = (droppedCo[f] || 0) + 1;
    return false;
  });
}
if (Object.keys(droppedCo).length) warn(`co_manifests dropped (not a family): ${Object.entries(droppedCo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}x${v}`).join(', ')}`);

// ---------- ties, palettes, spectrum ----------
for (const fam of Object.values(famMap)) {
  const ties = new Map();
  const put = (a, basis) => {
    if (!archById[a]) return;
    const cur = ties.get(a);
    if (cur === undefined || BASIS_RANK[basis] < BASIS_RANK[cur]) ties.set(a, basis);
  };
  for (const t of curTies[fam.id] || []) put(t.archetype, t.basis);
  if (fam._vault) {
    for (const a of linkTargets(fam._vault.data.expresses_jung)) put(a, 'jung');
    for (const a of linkTargets(fam._vault.data.expresses_inferred)) put(a, 'inferred');
  }
  fam.archetypes = [...ties.entries()]
    .map(([id, basis]) => ({ id, basis }))
    .sort((a, b) => BASIS_RANK[a.basis] - BASIS_RANK[b.basis] || a.id.localeCompare(b.id));
  if (!fam.archetypes.length) warn(`family ${fam.id} has no archetype tie (add to curation/family-ties.json)`);
  const items = fam.archetypes.map((t) => ({ w: BASIS_WEIGHT[t.basis], palette: archById[t.id].palette, pos: archById[t.id].spectrum.position }));
  const tot = items.reduce((s, i) => s + i.w, 0) || 1;
  const over = fam._over || {};
  fam.spectrum = { position: r3(over.position ?? (items.length ? items.reduce((s, i) => s + i.w * i.pos, 0) / tot : 0.5)) };
  fam.palette = over.palette || (items.length ? blendPalettes(items) : archById.self?.palette);
}

// aliases
for (const fam of Object.values(famMap)) {
  const seen = new Set([fam.name.toLowerCase(), fam.id]);
  const out = [];
  for (const a of fam._aliases || []) {
    const k = a.toLowerCase();
    if (seen.has(k) || a.length > 60) continue;
    seen.add(k);
    out.push(a);
  }
  fam.aliases = out.slice(0, 12);
}

// fill family occurrenceIds (primary), oneLines
for (const o of occList) famMap[o.familyId]?.occurrenceIds.push(o.id);
const formFallbacks = [];
for (const fam of Object.values(famMap)) {
  fam.occurrenceIds.sort((a, b) => occById[a].year - occById[b].year || a.localeCompare(b));
  if (!fam.oneLine) { formFallbacks.push(fam.id); fam.oneLine = 'A recurring image of the archetypal field.'; }
}

// ---------- archetype membership ----------
const famList = Object.values(famMap).sort((a, b) => a.id.localeCompare(b.id));
for (const a of archList) {
  const fams = famList.filter((f) => f.archetypes.some((t) => t.id === a.id));
  a.familyIds = fams.sort((x, y) => y.occurrenceIds.length - x.occurrenceIds.length || x.id.localeCompare(y.id)).map((f) => f.id);
  a.occurrenceCount = new Set(fams.flatMap((f) => f.occurrenceIds)).size;
}

// ---------- images ----------
let imageCount = 0;
const attach = (obj, group) => {
  const im = imagesJson[group]?.[obj.id];
  if (im) {
    const { src, thumb, width, height, tone, title, credit, license, sourceUrl } = im;
    obj.image = { src, thumb, width, height, ...(tone ? { tone } : {}), title, credit, license, sourceUrl };
    imageCount++;
  }
};
archList.forEach((a) => attach(a, 'archetypes'));
famList.forEach((f) => attach(f, 'families'));
occList.forEach((o) => attach(o, 'occurrences'));

// ---------- cultures ----------
const cultures = Object.keys(cultureCount).sort().map((id) => ({
  id, name: cultTable[id].name, lat: cultTable[id].lat, lon: cultTable[id].lon, occurrenceCount: cultureCount[id],
}));

// ---------- assemble ----------
const cleanFam = famList.map((f) => {
  const { _aliases, _form, _over, _vault, ...rest } = f;
  return { id: rest.id, name: rest.name, subtype: rest.subtype, aliases: rest.aliases, oneLine: rest.oneLine, archetypes: rest.archetypes, spectrum: rest.spectrum, palette: rest.palette, body: rest.body, ...(rest.image ? { image: rest.image } : {}), occurrenceIds: rest.occurrenceIds, synthesised: rest.synthesised };
});
const years = occList.map((o) => o.year);
const field = {
  meta: {
    generatedAt: process.env.FIELD_GENERATED_AT || new Date().toISOString(),
    vaultPath: VAULT,
    ...(ledgerLine ? { vaultLedgerLine: ledgerLine } : {}),
    counts: { archetypes: archList.length, families: cleanFam.length, occurrences: occList.length, cultures: cultures.length, images: imageCount },
    yearMin: years.length ? Math.min(...years) : 0,
    yearMax: years.length ? Math.max(...years) : 0,
  },
  archetypes: archList,
  families: cleanFam,
  occurrences: occList,
  cultures,
};

const errors = validateField(field);
if (errors.length) {
  console.error(`VALIDATION FAILED (${errors.length} errors):`);
  errors.slice(0, 60).forEach((e) => console.error('  - ' + e));
  process.exit(2);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'field.json'), JSON.stringify(field));

// ---------- stats ----------
const hist = { place: 0, region: 0, culture: 0, none: 0 };
occList.forEach((o) => hist[o.geoPrecision]++);
const pct = (n) => Math.round((n / (occList.length || 1)) * 1000) / 10;
const labelLens = occList.map((o) => o.label.length);
const stats = {
  counts: field.meta.counts,
  vaultLedgerLine: ledgerLine,
  geoPrecision: { ...hist, 'place+region %': pct(hist.place + hist.region), pct: Object.fromEntries(Object.entries(hist).map(([k, v]) => [k, pct(v)])) },
  geoSource,
  imagesAttached: imageCount,
  locusTypes: occList.reduce((m, o) => ((m[o.locusType] = (m[o.locusType] || 0) + 1), m), {}),
  quotes: occList.filter((o) => o.quote).length,
  occurrencesWithJungCites: occList.filter((o) => o.jung.length).length,
  labelMaxLen: Math.max(0, ...labelLens),
  yearRange: [field.meta.yearMin, field.meta.yearMax],
  familiesSynthesised: cleanFam.filter((f) => f.synthesised).map((f) => f.id),
  unresolvedFamilyTargets: unresolvedFamilies,
  mergedFamilyTargets: famMerges,
  familiesWithoutOccurrences: cleanFam.filter((f) => !f.occurrenceIds.length).map((f) => f.id),
  familiesOneLineFallback: formFallbacks,
  familiesOneLineFromVault: famList.filter((f) => f._form && f.oneLine && !formFallbacks.includes(f.id)).length,
  unknownCultures,
  droppedCoManifests: droppedCo,
  culturePrecisionPlaces: [...new Set(unresolvedPlaces)].sort(),
  archetypesWithDefinition: archList.filter((a) => a.definition).map((a) => a.id),
  skips,
  warnings,
};
fs.writeFileSync(path.join(OUT_DIR, 'field.stats.json'), JSON.stringify(stats, null, 2) + '\n');

console.log(`field.json: ${archList.length} archetypes, ${cleanFam.length} families (${stats.familiesSynthesised.length} synthesised), ${occList.length} occurrences, ${cultures.length} cultures, ${imageCount} images`);
console.log(`geo: place ${hist.place} (${pct(hist.place)}%), region ${hist.region} (${pct(hist.region)}%), culture ${hist.culture} (${pct(hist.culture)}%), none ${hist.none} | place+region ${pct(hist.place + hist.region)}%`);
console.log(`skips: ${skips.length}${skips.length ? ' -> ' + skips.map((s) => `${s.kind}:${s.id} (${s.reason})`).join('; ') : ''}`);
console.log(`warnings: ${warnings.length} (see field.stats.json)`);
if (formFallbacks.length) console.log(`families lacking a oneLine: ${formFallbacks.join(', ')}`);
