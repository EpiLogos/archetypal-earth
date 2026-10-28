#!/usr/bin/env node
// Vault -> public/data/field.json (+ field.stats.json). Re-runnable, deterministic, tolerant.
// Env: VAULT overrides the vault path; CURATION_DIR overrides the curation/ directory and IMAGES_JSON the
// public/data/images.json read (tests run against copies); FIELD_OUT_DIR overrides the output directory;
// FIELD_GENERATED_AT fixes meta.generatedAt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT, readNotes, asList, linkTargets, slugify, stripLinks } from './lib/vault.mjs';
import { plain, shortLabel, parseInstanceBody, oneLineFromForm, collapse } from './lib/text.mjs';
import { loadGazetteer, matchPlace, loadCultures, normCultureSlug, jitter, JIT } from './lib/geo.mjs';
import { validateField } from './validate.mjs';
import { buildVocab, createNormalizer, visitFieldText } from './lib/ocr.mjs';
import { buildCorpusIndex, corpusTitles } from './lib/corpus.mjs';
import { isPlateCaption } from './lib/quotes.mjs';
import { externalRegister } from './lib/external.mjs';
import { buildFieldPages } from './field-pages.mjs';
import { workLoader } from './lib/cite.mjs';
import { citeQuotes, workTitles as corpusWorkTitles } from './lib/quotes.mjs';
import { skyAddresses, parseRank, parseCourt } from './lib/sky-address.mjs';
import { workDates, buildAttestations } from './lib/attest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = process.env.VAULT || DEFAULT_VAULT;
const OUT_DIR = process.env.FIELD_OUT_DIR ? path.resolve(process.env.FIELD_OUT_DIR) : path.join(ROOT, 'public', 'data');
const IMAGES_JSON = process.env.IMAGES_JSON ? path.resolve(process.env.IMAGES_JSON) : path.join(ROOT, 'public', 'data', 'images.json');
const CURATION_DIR = process.env.CURATION_DIR ? path.resolve(process.env.CURATION_DIR) : path.join(ROOT, 'curation');
const CUR = (f) => path.join(CURATION_DIR, f);
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
const curTheo = readJson(CUR('theoretics.json'), { theoretics: {} }).theoretics;
const curFam = readJson(CUR('families.json'));
const famMerges = curFam.merges || {};
const famOver = curFam.families || {};
const curTies = readJson(CUR('family-ties.json')).ties;
const gaz = loadGazetteer(CUR('gazetteer.json'));
const { aliases: cultAliases, cultures: cultTable } = loadCultures(CUR('cultures.json'));
const yearOver = readJson(CUR('year-overrides.json'), { years: {} }).years;
// the works whose words are not Jung's (curation/works.json): their cites say whose voice they are, and the attestations
// are dated by them. Jung's own volumes need no entry: their cites carry their years already.
const worksCur = readJson(CUR('works.json'), { works: {} });
// the field's provider (curation/provider.json): its id, its name and its own words for every line that names it. The
// app's code names no corpus (C2-b8): field.json's meta.provider carries these, and the boot binds them (src/data/labels.ts).
const provider = readJson(CUR('provider.json'), null);
const imagesJson = readJson(IMAGES_JSON, { archetypes: {}, families: {}, theoretics: {}, occurrences: {} });
// An additive register beside images.json (public/data/images-ext.json, same shape): plates fetched while another run
// owns images.json. Its entries fill ids the main register does not hold; the main register wins on a clash.
const extFiles = fs.readdirSync(path.dirname(IMAGES_JSON)).filter((f) => /^images-ext[\w-]*\.json$/.test(f)).sort();
for (const f of extFiles) {
  const imagesExt = readJson(path.join(path.dirname(IMAGES_JSON), f), {});
  for (const g of ['archetypes', 'families', 'theoretics', 'occurrences']) {
    imagesJson[g] ||= {};
    for (const [id, im] of Object.entries(imagesExt[g] || {})) if (!imagesJson[g][id]) imagesJson[g][id] = im;
  }
}

// ---------- scan-error normaliser ----------
// Vocabulary comes from the vault's own clean volumes (see scripts/lib/ocr.mjs); cached in .cache/.
const ocrExceptions = readJson(CUR('ocr-exceptions.json'), {});
const ocrVocab = buildVocab({ vault: VAULT, cacheDir: path.join(ROOT, '.cache'), log: (m) => console.log(m) });
const ocr = createNormalizer(ocrVocab, ocrExceptions);
const ocrLog = new Map(); // "kind | before -> after" -> { kind, before, after, count, where: [] }
let ocrTouched = 0;
function ocrRecord(where, changes) {
  for (const c of changes) {
    const key = `${c.kind} | ${c.before} -> ${c.after}`;
    let e = ocrLog.get(key);
    if (!e) ocrLog.set(key, (e = { kind: c.kind, before: c.before, after: c.after, count: 0, where: [] }));
    e.count++;
    if (e.where.length < 3 && !e.where.includes(where)) e.where.push(where);
  }
}
/** Normalise one string, logging what changed. */
function fixText(text, where, mode = 'prose') {
  if (typeof text !== 'string' || !text) return text;
  const r = ocr.normalize(text, { mode });
  if (r.text !== text) { ocrTouched++; ocrRecord(where, r.changes); }
  return r.text;
}

// ---------- load vault ----------
const W = (d) => path.join(VAULT, 'wiki', d);
const archNotes = readNotes(W('archetypes'));
const theoNotes = readNotes(W('concepts'));
const imgNotes = readNotes(W('images'));
const instNotes = readNotes(W('instances'));
const manifest = readJson(path.join(VAULT, '_raw', 'manifest.json'), []);
const externals = externalRegister(ROOT);
const workTitles = { ...Object.fromEntries(Object.entries(externals).map(([w, x]) => [w, x.title])), ...corpusTitles(VAULT), ...Object.fromEntries(manifest.map((m) => [m.vol, m.title])) };
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

for (const n of [...archNotes, ...theoNotes, ...imgNotes, ...instNotes]) {
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
  const voice = worksCur.works?.[wl.key]?.voice;
  return { work: wl.key, workTitle: wl.title, year: collapse(year), locator: collapse(locator), ...(voice ? { voice } : {}) };
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
  foldArchDefinition(c, a);
  archById[a.id] = a;
  archList.push(a);
}

// families carry the same rail: a definition is never typed, it is picked verbatim
// from the vault's own mention records (vol + para + quote prefix), or it is omitted.
// Seminar and Red Book records carry no paragraph numbers: there the verified prefix
// alone (plus the volume) identifies the record, and the cite names the pdf page.
function foldFamilyDefinition(over, fam) {
  if (!over.definitionPick?.length) return;
  const recs = over.definitionPick.map((p) => mentions.find((m) => m.vol === p.vol
    && (p.para == null || Number(m.para) === Number(p.para))
    && String(m.quote).trimStart().startsWith(p.starts)));
  if (recs.every(Boolean)) {
    const p0 = over.definitionPick[0];
    const wl = workLabel(p0.vol);
    const short = (wl.bare || wl.title).split(':')[0];
    fam.definition = {
      text: collapse(recs.map((r) => r.quote).join(' ')),
      cite: p0.para != null ? `${short} (${wl.short}) ¶${p0.para}` : `${short} (${wl.short}) pdf p${recs[0].pdf_page}`,
    };
  } else warn(`definitionPick for ${fam.id} not found verbatim in mentions.jsonl; definition omitted`);
}

// Number archetypes (and any later synthesised archetype) are admitted from curation alone
// when `synthesised: true` — the same law as synthesised families. The vault wins the note
// back the moment wiki/archetypes/<id>.md lands; until then curation is the claim.
function foldArchDefinition(c, a) {
  if (!c.definitionPick?.length) return;
  const recs = c.definitionPick.map((p) => mentions.find((m) => m.vol === p.vol && Number(m.para) === Number(p.para) && String(m.quote).trimStart().startsWith(p.starts)));
  if (recs.every(Boolean)) {
    const p0 = c.definitionPick[0];
    const wl = workLabel(p0.vol);
    const short = (wl.bare || wl.title).split(':')[0];
    a.definition = { text: collapse(recs.map((r) => r.quote).join(' ')), cite: `${short} (${wl.short}) ¶${p0.para}` };
  } else warn(`definitionPick for ${a.id} not found verbatim in mentions.jsonl; definition omitted`);
}
for (const [id, c] of Object.entries(curArch)) {
  if (archById[id]) continue;
  if (!c.synthesised) { warn(`curation archetype ${id} has no vault note`); continue; }
  const a = {
    id,
    name: c.name,
    oneLine: c.oneLine,
    prime: false,
    spectrum: { position: r3(c.position) },
    palette: c.palette,
    body: (c.body || []).map(collapse),
    familyIds: [],
    occurrenceCount: 0,
    synthesised: true,
  };
  foldArchDefinition(c, a);
  archById[a.id] = a;
  archList.push(a);
  archSlugs.add(id);
}
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
const mergedIn = {}; // merge target -> the names and aliases of the notes merged into it
for (const n of imgNotes.filter((x) => !x.failed)) {
  if (String(n.data.status || '').toLowerCase() === 'redirect') continue; // canonical family is the merge target
  if (famMerges[n.slug] && famMerges[n.slug] !== n.slug) {
    // a merge key is an alias, not a node: its instances already resolve to the target (resolveFam), and a node of its own
    // would carry nothing — the empty family the interface used to describe as "no instance yet"
    const als = [...asList(n.data.aliases), ...(lexAliases[n.slug] || [])].map((x) => collapse(plain(x).replace(/^["']|["']$/g, ''))).filter(Boolean);
    (mergedIn[famMerges[n.slug]] ||= []).push(titleCase(n.slug), ...als);
    skip('family', n.slug, `merged into ${famMerges[n.slug]} (curation/families.json merges): kept as an alias`);
    continue;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(n.slug)) {
    // a vault stub whose id is not a slug (an arrow in a filename) and which no instance names: nothing to carry
    skip('family', n.slug, 'id is not a slug and no instance names it (vault stub)');
    continue;
  }
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
  foldFamilyDefinition(over, famMap[n.slug]);
}
for (const [target, names] of Object.entries(mergedIn)) {
  if (famMap[target]) famMap[target]._aliases.push(...names);
  else warn(`merge target ${target} is not a family: the names merged into it are dropped`);
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
  const title = fixText(collapse(plain(d.title || '')), `occ:${id}.title`);
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

  let place = fixText(collapse(plain(d.place ?? '')), `occ:${id}.place`);
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

  // the note's own first engagement hints which corpus completes a quote whose line names no volume
  const jung = asList(d.jung_engagement).map(parseCite).filter((c) => c.work);
  const parsed = parseInstanceBody(n.body, { workHint: jung[0]?.work });
  parsed.body = parsed.body.map((b, k) => fixText(b, `occ:${id}.body[${k}]`));
  if (parsed.quote) parsed.quote = fixText(parsed.quote, `occ:${id}.quote`);
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
    ...(parsed.quote && isPlateCaption(parsed.quote) ? { caption: true } : {}),
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
    // an archetype slug becomes a family only when curation claims it with a tie —
    // deliberate, reviewable, and the vault wins it back the moment it lands a note
    if ((archSlugs.has(f) && !famOver[f] && !curTies[f]) || !/^[a-z0-9][a-z0-9-]*$/.test(f)) continue; // co_manifest naming an archetype / junk: not a family
    if (f === o.familyId) {
      unresolvedFamilies[f] = (unresolvedFamilies[f] || 0) + 1;
      const over = famOver[f] || {};
      famMap[f] = {
        id: f, name: over.name || titleCase(f), subtype: 'unknown', aliases: [], _aliases: [],
        oneLine: over.oneLine || null, _form: false, _over: over, archetypes: [], body: (over.body || []).map(collapse),
        occurrenceIds: [], synthesised: true, _vault: null,
      };
      foldFamilyDefinition(over, famMap[f]);
    }
  }
}
// Families admitted from curation alone (the four elements, the zodiac signs, the ten sephiroth): an entry with
// `synthesised: true` in curation/families.json and no vault note. Admitted after the occurrence pass, so a family
// a vault note or an occurrence has already made wins, and the curation flag is ignored with one warning. Ties,
// palette and spectrum then come from the same code as every other family.
const curationFamilies = [];
for (const [id, over] of Object.entries(famOver)) {
  if (!over || over.synthesised !== true) continue;
  if (famMerges[id]) { warn(`curation family ${id} is synthesised but is a merge key; not admitted`); skip('family', id, 'synthesised id is a merge key'); continue; }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { warn(`curation family ${id}: id not kebab-case; not admitted`); skip('family', id, 'synthesised id not kebab-case'); continue; }
  const have = famMap[id];
  if (have) { warn(`curation family ${id} is marked synthesised, but ${have._vault ? 'a vault note' : 'occurrences'} already produced it; curation flag ignored`); continue; }
  const st = String(over.subtype || '').toLowerCase();
  famMap[id] = {
    id,
    name: collapse(over.name || '') || titleCase(id),
    subtype: ['figure', 'object', 'process', 'scene'].includes(st) ? st : 'unknown',
    aliases: [],
    _aliases: asList(over.aliases).map((x) => collapse(plain(x).replace(/^["']|["']$/g, ''))).filter(Boolean),
    oneLine: over.oneLine ? collapse(over.oneLine) : '',
    _form: false,
    _over: over,
    archetypes: [],
    body: (over.body || []).map(collapse),
    occurrenceIds: [],
    synthesised: true,
    _vault: null,
  };
  foldFamilyDefinition(over, famMap[id]);
  curationFamilies.push(id);
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

// ---------- membership ----------
// An occurrence belongs to its primary family and to every family that co-manifests in it (coFamilyIds). A family's own
// vault note also lists instances (its "Instances:" section): when one is filed under another family the note still says
// it is an instance of this one, and the note is the family's own statement of what it holds. Both count, so a thread,
// a label and a count see what the family holds (owner's ruling, 2026-10-14). Provenance is kept in the stats.
const listedMembership = {};
for (const fam of Object.values(famMap)) {
  if (!fam._vault) continue;
  const lines = String(fam._vault.body || '').split('\n');
  // the note's own list of instances, and only that: what stands under an "Instances" label up to the next heading, plus
  // the bulleted links of a note that lists its instances before any section (some do, with no heading). A link in a
  // "Parallels / adjacent" section or in a later additive subsection only mentions; it is never a membership.
  const listed = new Set();
  const isHeading = (l) => /^#{1,6}\s/.test(l);
  lines.forEach((l, i) => {
    if (!/^\W*(?:#{1,6}\s*)?(?:\*\*)?instances\b/i.test(l)) return;
    for (let j = i + 1; j < lines.length && !isHeading(lines[j]); j++) {
      for (const m of lines[j].matchAll(/\[\[([^\]|#]+)/g)) listed.add(slugify(m[1]));
    }
  });
  const firstSection = lines.findIndex((l) => /^#{2,6}\s/.test(l));
  for (const l of lines.slice(0, firstSection < 0 ? lines.length : firstSection)) {
    const m = /^\s*[*\-]\s+(?:\*\*)?\[\[([^\]|#]+)/.exec(l);
    if (m) listed.add(slugify(m[1]));
  }
  for (const slug of listed) {
    const o = occById[slug];
    if (!o || o.familyId === fam.id || o.coFamilyIds.includes(fam.id)) continue;
    o.coFamilyIds.push(fam.id);
    listedMembership[fam.id] = (listedMembership[fam.id] || 0) + 1;
  }
}

// ---------- attestations ----------
// The families curation admits on its own (synthesised, no vault note) are attested by the page they carry: one
// occurrence per family per work, from placed quotations only (scripts/lib/attest.mjs). Where a source attributes a place
// it is carried: in the sky (scripts/lib/sky-address.mjs, the same derivation the card rings read) and, for the Aces and
// Princesses, the region of the Earth Crowley names (curation/sky/earth.json).
const attestStats = { occurrences: 0, sky: 0, earth: 0, unplaced: 0, byWork: {}, missing: [], pageErrors: [] };
{
  const cardsCur = readJson(CUR('sky/cards.json'), null);
  const earthCur = readJson(CUR('sky/earth.json'), null);
  const famIds = new Set(Object.keys(famMap));
  const key = (e) => (e && typeof e === 'object' && e.type === 'family' ? { type: 'family', id: famMerges[e.id] || e.id } : null);
  const rawJoins = (readJson(CUR('joins.json'), { joins: [] }).joins ?? [])
    .map((j) => ({ id: j.id, system: j.system, basis: j.basis, a: key(j.a), b: key(j.b) }))
    .filter((j) => j.a && j.b && famIds.has(j.a.id) && famIds.has(j.b.id));
  const addrErrors = [];
  const { addresses } = cardsCur
    ? skyAddresses({ cur: cardsCur, famIds, famName: (id) => famMap[id]?.name, joins: rawJoins, errors: addrErrors })
    : { addresses: new Map() };
  addrErrors.forEach((e) => warn(`sky address: ${e}`));

  // the pages, with every quotation placed exactly as scripts/field-pages.mjs publishes them
  const nodes = {
    family: famIds,
    archetype: new Set([...archSlugs, ...Object.keys(curArch)]),
    theoretic: new Set([...theoNotes.filter((n) => !n.failed).map((n) => n.slug), ...Object.keys(curTheo)]),
  };
  const built = buildFieldPages({
    root: ROOT, vault: VAULT, curation: CURATION_DIR,
    field: { families: [...famIds].map((id) => ({ id })), archetypes: [...nodes.archetype].map((id) => ({ id })), theoretics: [...nodes.theoretic].map((id) => ({ id })), joins: [] },
  });
  built.errors.forEach((e) => { attestStats.pageErrors.push(e); warn(`field page: ${e}`); });

  // Crowley's region lines, placed (a line the corpus will not place is dropped and said)
  let earth = null;
  if (earthCur) {
    const errs = [];
    const placed = citeQuotes(workLoader(VAULT), corpusWorkTitles(ROOT), [earthCur.regions, earthCur.pole], 'earth.json', errs, []);
    errs.forEach((e) => warn(`earth.json: ${e}`));
    if (placed.length === 2) earth = { regions: placed[0], pole: placed[1], suits: earthCur.suits, applies: earthCur.applies };
  }
  const earthOf = (id) => {
    if (!earth) return null;
    const r = parseRank(id);
    const c = parseCourt(id);
    const suit = r && r.number === 1 && earth.applies.includes('ace') ? r.suit : c && c.court === 'princess' && earth.applies.includes('princess') ? c.suit : null;
    if (!suit || !earth.suits[suit]) return null;
    return { place: earth.suits[suit], page: earth.regions.cite.locator.replace(/^pdf p/, ''), quote: earth.regions.text, pole: c ? earth.pole.text : null };
  };

  const dates = workDates(occList, worksCur);
  const attested = new Set(curationFamilies);
  // a Jung volume is cited as the field's other cites name it ("Psychology and Alchemy (CW12)"); any other work by the
  // corpus's own short title, as the field pages print it
  const corpusT = corpusWorkTitles(ROOT);
  const titleOf = (w) => { const l = workLabel(w); return l.short ? l.title : corpusT.get(w) || l.title; };
  const { attestations, missing } = buildAttestations({
    pages: built.data.pages,
    include: (id) => attested.has(id),
    loci: (id) => addresses.get(id) ?? [],
    earthOf,
    dates,
    titleOf,
    familyName: (id) => famMap[id].name,
  });
  attestStats.missing = missing;
  for (const m of missing) warn(`attestation: ${m}`);

  const taken = new Set(occList.map((o) => o.id));
  for (const a of attestations) {
    let id = a.id;
    if (taken.has(id)) { warn(`attestation ${id} collides with an existing occurrence id; skipped`); continue; }
    taken.add(id);
    const title = fixText(collapse(plain(a.title)), `occ:${id}.title`);
    let lat = 0, lon = 0, precision = 'none';
    if (a.place) {
      const hit = matchPlace(a.place, gaz);
      if (hit) {
        [lat, lon] = jitter(id, hit.lat, hit.lon, hit.jit ?? JIT[hit.precision]);
        precision = hit.precision;
        geoSource.place++;
      } else { geoSource.none++; warn(`attestation ${id}: place "${a.place}" is not in the gazetteer`); }
    } else geoSource.none++;
    const o = {
      id,
      title,
      label: shortLabel(title),
      familyId: a.familyId,
      coFamilyIds: [],
      locusType: 'text-passage',
      subject: 'n/a',
      cultureIds: [],
      place: a.place || '',
      lat,
      lon,
      geoPrecision: precision,
      year: a.year,
      yearDisplay: a.yearDisplay,
      ...(a.yearRange ? { yearRange: a.yearRange } : {}),
      jung: a.jung,
      ...(a.quote ? { quote: fixText(a.quote, `occ:${id}.quote`) } : {}),
      ...(a.caption ? { caption: true } : {}),
      body: a.body.map((b, k) => fixText(b, `occ:${id}.body[${k}]`)),
      parallelIds: [],
      ...(a.sky.length ? { sky: a.sky } : {}),
    };
    occList.push(o);
    occById[id] = o;
    attestStats.occurrences++;
    if (a.sky.length) attestStats.sky++;
    if (precision !== 'none') attestStats.earth++;
    if (!a.sky.length && precision === 'none') attestStats.unplaced++;
    attestStats.byWork[a.work] = (attestStats.byWork[a.work] || 0) + 1;
  }
  occList.sort((a, b) => a.id.localeCompare(b.id));
}

// who holds what: primary, co-manifest and listed instances together
const memberIds = {};
for (const o of occList) for (const f of [o.familyId, ...o.coFamilyIds]) (memberIds[f] ||= new Set()).add(o.id);

// ---------- ties, palettes, spectrum ----------
/** Vault `expresses_*` may name an archetype or another family; families inherit that family's curation ties (one hop). */
const absorbExpressLink = (ties, put, slug, basis, depth = 0) => {
  const s = famMerges[slug] || slug;
  if (archById[s]) { put(s, basis); return; }
  if (depth > 1) return;
  for (const t of curTies[s] || []) put(t.archetype, t.basis);
  const note = imgNotes.find((n) => n.slug === s && !n.failed);
  if (!note) return;
  for (const a of linkTargets(note.data.expresses_jung)) absorbExpressLink(ties, put, a, 'jung', depth + 1);
  for (const a of linkTargets(note.data.expresses_inferred)) absorbExpressLink(ties, put, a, 'inferred', depth + 1);
};
for (const fam of Object.values(famMap)) {
  const ties = new Map();
  const put = (a, basis) => {
    if (!archById[a]) return;
    const cur = ties.get(a);
    if (cur === undefined || BASIS_RANK[basis] < BASIS_RANK[cur]) ties.set(a, basis);
  };
  for (const key of new Set([fam.id, famMerges[fam.id]].filter(Boolean)))
    for (const t of curTies[key] || []) put(t.archetype, t.basis);
  if (fam._vault) {
    for (const a of linkTargets(fam._vault.data.expresses_jung)) absorbExpressLink(ties, put, a, 'jung');
    for (const a of linkTargets(fam._vault.data.expresses_inferred)) absorbExpressLink(ties, put, a, 'inferred');
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
  // a family the vault gives no line for simply has no line; the interface lets the image show
  if (!fam.oneLine) { formFallbacks.push(fam.id); fam.oneLine = ''; }
}

// ---------- archetype membership ----------
const famList = Object.values(famMap).sort((a, b) => a.id.localeCompare(b.id));
for (const a of archList) {
  const fams = famList.filter((f) => f.archetypes.some((t) => t.id === a.id));
  const held = (f) => memberIds[f.id]?.size ?? 0;
  a.familyIds = fams.sort((x, y) => held(y) - held(x) || x.id.localeCompare(y.id)).map((f) => f.id);
  a.occurrenceCount = new Set(fams.flatMap((f) => [...(memberIds[f.id] ?? [])])).size;
}
// Ties between archetypes, from curation alone (the number archetypes to the Self, the dyad to syzygy and shadow).
// Each is checked to resolve, so an archetype never names a node the field does not have; the basis is carried.
for (const a of archList) {
  a.archetypes = [];
  for (const x of curArch[a.id]?.archetypes ?? []) {
    if (x.id === a.id) { warn(`archetype ${a.id}: tie to itself dropped`); continue; }
    if (!archById[x.id]) { warn(`archetype ${a.id}: tie to unknown archetype ${x.id} dropped`); continue; }
    if (a.archetypes.some((y) => y.id === x.id)) continue;
    a.archetypes.push({ id: x.id, basis: BASIS_RANK[x.basis] !== undefined ? x.basis : 'inferred' });
  }
  a.archetypes.sort((x, y) => BASIS_RANK[x.basis] - BASIS_RANK[y.basis] || x.id.localeCompare(y.id));
}

// ---------- theoretics ----------
// The vault's wiki/concepts/ tier carried into the field: Jung's theoretical instruments, the tier
// the vault's own SCHEMA.md names and the site spec never had. A note is admitted only when
// curation/theoretics.json claims it, exactly as for archetypes. The two keystones carry `ground`:
// psychoid is the vault's ontological tier-marker, archetype-as-such its epistemological keystone.
// They sit first, because they are the field's foundation and not two more nodes beside it.
const GROUND_RANK = { ontological: 0, epistemological: 1 };
const theoSlugs = new Set(theoNotes.filter((n) => !n.failed).map((n) => n.slug));
const theoById = {};
const theoList = [];
for (const n of theoNotes.filter((x) => !x.failed)) {
  const c = curTheo[n.slug];
  if (!c) { skip('theoretic', n.slug, 'no curation/theoretics.json entry'); theoSlugs.delete(n.slug); continue; }
  const t = {
    id: n.slug,
    name: c.name,
    oneLine: c.oneLine,
    ground: GROUND_RANK[c.ground] !== undefined ? c.ground : null,
    spectrum: { position: r3(c.position) },
    palette: c.palette,
    body: (c.body || []).map(collapse),
    archetypes: [],
    families: [],
    theoretics: [],
    occurrenceCount: 0,
  };
  if (c.section) t.section = c.section;
  if (c.lens) t.lens = c.lens;
  // the definition is never typed: picked verbatim from the vault's mentions, or omitted and said so
  if (c.definitionPick?.length) {
    const recs = c.definitionPick.map((p) => mentions.find((m) => m.vol === p.vol
      && (p.para == null || Number(m.para) === Number(p.para))
      && String(m.quote).trimStart().startsWith(p.starts)));
    if (recs.every(Boolean)) {
      const p0 = c.definitionPick[0];
      const wl = workLabel(p0.vol);
      const short = (wl.bare || wl.title).split(':')[0];
      t.definition = {
        text: collapse(recs.map((r) => r.quote).join(' ')),
        cite: p0.para != null ? `${short} (${wl.short}) ¶${p0.para}` : `${short} (${wl.short}) pdf p${recs[0].pdf_page}`,
      };
    } else warn(`definitionPick for ${n.slug} not found verbatim in mentions.jsonl; definition omitted`);
  }
  theoById[t.id] = t;
  theoList.push(t);
}
for (const k of Object.keys(curTheo)) if (!theoSlugs.has(k)) warn(`curation theoretic ${k} has no vault note`);
theoList.sort((a, b) => (GROUND_RANK[a.ground] ?? 2) - (GROUND_RANK[b.ground] ?? 2) || a.id.localeCompare(b.id));

// ties: each is checked to resolve, so a theoretic never names a node the field does not have.
const pickTies = (t, kind, raw, has) => {
  const out = [];
  for (const x of raw || []) {
    if (kind === 'theoretic' && x.id === t.id) { warn(`theoretic ${t.id}: tie to itself dropped`); continue; }
    if (!has(x.id)) { warn(`theoretic ${t.id}: tie to unknown ${kind} ${x.id} dropped`); continue; }
    if (out.some((o) => o.id === x.id)) continue;
    out.push({ id: x.id, basis: BASIS_RANK[x.basis] !== undefined ? x.basis : 'inferred' });
  }
  return out.sort((a, b) => BASIS_RANK[a.basis] - BASIS_RANK[b.basis] || a.id.localeCompare(b.id));
};
for (const t of theoList) {
  const c = curTheo[t.id];
  t.archetypes = pickTies(t, 'archetype', c.archetypes, (id) => !!archById[id]);
  t.families = pickTies(t, 'family', c.families, (id) => !!famMap[id]);
  t.theoretics = pickTies(t, 'theoretic', c.theoretics, (id) => !!theoById[id]);
}
// how much of the field a theoretic stands for: every occurrence its tied archetypes and families carry
for (const t of theoList) {
  const fams = new Set(t.families.map((x) => x.id));
  for (const x of t.archetypes) for (const fid of archById[x.id]?.familyIds ?? []) fams.add(fid);
  const ids = new Set();
  for (const fid of fams) for (const oid of memberIds[fid] ?? []) ids.add(oid);
  t.occurrenceCount = ids.size;
}

// ---------- joins ----------
// A general relation between any two nodes (archetype, theoretic or family), from curation/joins.json and nothing else.
// Each join is checked against the finished tiers: a bad one is dropped and said, never repaired. Symmetric duplicates
// (same unordered pair, same system) keep the first by id. Joins carry no quotations; a later generator places any cite.
const JOIN_TYPES = new Set(['archetype', 'theoretic', 'family']);
const JOIN_BASIS = new Set(['jung', 'inferred', 'site']);
const joinsFile = readJson(CUR('joins.json'), { joins: [] });
const joinsRaw = Array.isArray(joinsFile.joins) ? joinsFile.joins : [];
const joinEnd = (e) => {
  if (!e || typeof e !== 'object' || !JOIN_TYPES.has(e.type) || typeof e.id !== 'string') return null;
  if (e.type === 'archetype') return Object.hasOwn(archById, e.id) ? { type: 'archetype', id: e.id } : null;
  if (e.type === 'theoretic') return Object.hasOwn(theoById, e.id) ? { type: 'theoretic', id: e.id } : null;
  const s = famMerges[e.id] || e.id;
  return Object.hasOwn(famMap, s) ? { type: 'family', id: s } : null;
};
let joinsDropped = 0;
const joinsDuplicates = [];
const dropJoin = (why, j) => { joinsDropped++; warn(`join ${j?.id ?? '(no id)'} dropped: ${why}`); };
const accepted = [];
const seenJoinIds = new Set();
for (const j of joinsRaw) {
  if (!j || typeof j !== 'object') { dropJoin('not an object', j); continue; }
  if (typeof j.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(j.id)) { dropJoin('id not kebab-case', j); continue; }
  if (seenJoinIds.has(j.id)) { dropJoin('duplicate id', j); continue; }
  seenJoinIds.add(j.id);
  const a = joinEnd(j.a);
  const b = joinEnd(j.b);
  if (!a || !b) { dropJoin(`unresolved endpoint ${JSON.stringify(a ? j.b : j.a)}`, j); continue; }
  if (a.type === b.type && a.id === b.id) { dropJoin('self-join', j); continue; }
  if (!JOIN_BASIS.has(j.basis)) { dropJoin(`basis ${JSON.stringify(j.basis)} is not jung, inferred or site`, j); continue; }
  const note = typeof j.note === 'string' ? collapse(j.note) : '';
  if (!note) { dropJoin('note empty', j); continue; }
  if (note.length > 400 || /\[\[|\]\]/.test(note)) { dropJoin('note over 400 chars or wikilink syntax', j); continue; }
  if ((j.system !== undefined && typeof j.system !== 'string') || (j.voice !== undefined && typeof j.voice !== 'string')) { dropJoin('voice or system is not a string', j); continue; }
  const out = { id: j.id, a, b, basis: j.basis, note };
  if (j.system && collapse(j.system)) out.system = collapse(j.system);
  if (j.voice && collapse(j.voice)) out.voice = collapse(j.voice);
  accepted.push(out);
}
const joins = [];
const seenPair = new Set();
for (const j of accepted.sort((x, y) => x.id.localeCompare(y.id))) {
  const key = [`${j.a.type}:${j.a.id}`, `${j.b.type}:${j.b.id}`].sort().join('|') + '#' + (j.system ?? '');
  if (seenPair.has(key)) { joinsDropped++; joinsDuplicates.push(j.id); warn(`join ${j.id} dropped: symmetric duplicate of an earlier join (same pair, same system)`); continue; }
  seenPair.add(key);
  joins.push(j);
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
theoList.forEach((t) => attach(t, 'theoretics'));
famList.forEach((f) => attach(f, 'families'));
occList.forEach((o) => attach(o, 'occurrences'));

// ---------- cultures ----------
const cultures = Object.keys(cultureCount).sort().map((id) => ({
  id, name: cultTable[id].name, lat: cultTable[id].lat, lon: cultTable[id].lon, occurrenceCount: cultureCount[id],
}));

// ---------- assemble ----------
const cleanFam = famList.map((f) => {
  const { _aliases, _form, _over, _vault, ...rest } = f;
  return { id: rest.id, name: rest.name, subtype: rest.subtype, aliases: rest.aliases, oneLine: rest.oneLine, archetypes: rest.archetypes, spectrum: rest.spectrum, palette: rest.palette, body: rest.body, ...(rest.definition ? { definition: rest.definition } : {}), ...(rest.image ? { image: rest.image } : {}), occurrenceIds: rest.occurrenceIds, synthesised: rest.synthesised };
});
// the time axis is the globe's: it is set by what the globe can show. An occurrence with no place on the Earth (one that
// hangs in the sky, or names no place) keeps its own year — an attestation is dated by its source, 1970, 1988 — and the
// scale clamps it (src/data/time.ts); it does not bend the track the globe's time control runs along
const onTrack = (o) => o.geoPrecision !== 'none';
const years = occList.filter(onTrack).map((o) => o.year);
const field = {
  meta: {
    generatedAt: process.env.FIELD_GENERATED_AT || new Date().toISOString(),
    ...(provider ? { provider } : {}),
    vaultPath: VAULT,
    ...(ledgerLine ? { vaultLedgerLine: ledgerLine } : {}),
    counts: { archetypes: archList.length, theoretics: theoList.length, families: cleanFam.length, occurrences: occList.length, cultures: cultures.length, images: imageCount, joins: joins.length },
    yearMin: years.length ? Math.min(...years) : 0,
    yearMax: years.length ? Math.max(...years) : 0,
  },
  archetypes: archList,
  theoretics: theoList,
  families: cleanFam,
  occurrences: occList,
  cultures,
  joins,
};

// Final pass over EVERY human-readable string that reaches field.json (the early passes above cover the
// occurrence fields the geocoder and label derivation read; this one catches the rest and proves the lot).
for (const [kind, list] of [['arch', field.archetypes], ['theo', field.theoretics], ['fam', field.families], ['occ', field.occurrences], ['culture', field.cultures], ['join', field.joins]]) {
  for (const item of list) {
    visitFieldText(item, (where, value, mode, set) => {
      const r = ocr.normalize(value, { mode });
      if (r.text !== value) { set(r.text); ocrTouched++; ocrRecord(`${kind}:${item.id}${where}`, r.changes); }
    });
  }
}
// residual scanner: whatever still looks like scan damage (target: none; reviewed exceptions live in curation/ocr-exceptions.json)
const ocrResidual = [];
for (const [kind, list] of [['arch', field.archetypes], ['theo', field.theoretics], ['fam', field.families], ['occ', field.occurrences], ['culture', field.cultures], ['join', field.joins]]) {
  for (const item of list) {
    visitFieldText(item, (where, value, mode) => {
      if (mode === 'safe') return;
      for (const h of ocr.scan(value)) ocrResidual.push({ where: `${kind}:${item.id}${where}`, ...h });
    });
  }
}
if (ocrResidual.length) {
  console.error(`OCR RESIDUAL: ${ocrResidual.length} suspect(s) remain (fix the rule or add a reviewed entry to curation/ocr-exceptions.json):`);
  ocrResidual.slice(0, 40).forEach((h) => console.error(`  - ${h.where} [${h.kind}] ${h.token} :: ${h.context}`));
  if (process.env.OCR_STRICT === '1') process.exit(3);
}

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
  curationFamilies,
  joins: joins.length,
  joinsDropped,
  joinsDuplicates,
  unresolvedFamilyTargets: unresolvedFamilies,
  mergedFamilyTargets: famMerges,
  familiesWithoutOccurrences: cleanFam.filter((f) => !(memberIds[f.id]?.size)).map((f) => f.id),
  listedMembership,
  attestations: attestStats,
  familiesOneLineFallback: formFallbacks,
  familiesOneLineFromVault: famList.filter((f) => f._form && f.oneLine && !formFallbacks.includes(f.id)).length,
  unknownCultures,
  droppedCoManifests: droppedCo,
  culturePrecisionPlaces: [...new Set(unresolvedPlaces)].sort(),
  archetypesWithDefinition: archList.filter((a) => a.definition).map((a) => a.id),
  ocr: {
    vocabulary: ocrVocab.source,
    stringsChanged: ocrTouched,
    changes: [...ocrLog.values()].reduce((n, e) => n + e.count, 0),
    byKind: [...ocrLog.values()].reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + e.count), m), {}),
    unique: ocrLog.size,
    residual: ocrResidual.length,
    residualSuspects: ocrResidual,
    // every distinct repair with its count and up to three places it was made, so the work is auditable
    samples: [...ocrLog.values()].sort((a, b) => b.count - a.count || a.before.localeCompare(b.before)),
  },
  skips,
  warnings,
};
fs.writeFileSync(path.join(OUT_DIR, 'field.stats.json'), JSON.stringify(stats, null, 2) + '\n');

// ---------- corpus index (citation deep links) ----------
// The read-only vault corpus becomes public/data/corpus/: index.json plus one
// file per volume (chapters, pages, ¶ anchor spans). field.json is untouched.
let corpus = null;
try {
  const spineLines = fs.existsSync(path.join(VAULT, 'data', 'paragraphs.jsonl'))
    ? fs.readFileSync(path.join(VAULT, 'data', 'paragraphs.jsonl'), 'utf8').split('\n').filter(Boolean)
    : [];
  corpus = buildCorpusIndex({
    vault: VAULT,
    outDir: path.join(OUT_DIR, 'corpus'),
    manifest,
    spineLines,
    externals,
    log: (m) => console.log(m),
  });
  stats.corpus = corpus;
} catch (e) {
  warn(`corpus index not built: ${e.message}`);
}

console.log(`field.json: ${archList.length} archetypes, ${theoList.length} theoretics (${theoList.filter((t) => t.ground).length} keystones), ${cleanFam.length} families (${stats.familiesSynthesised.length} synthesised), ${occList.length} occurrences, ${cultures.length} cultures, ${imageCount} images`);
if (corpus) console.log(`corpus: ${corpus.works} volumes, ${corpus.pages} pages, ${corpus.paras} ¶ anchors${corpus.spine ? ` (spine: ${corpus.spine.checked} checked, ${corpus.spine.missing} off-page)` : ''}`);
console.log(`geo: place ${hist.place} (${pct(hist.place)}%), region ${hist.region} (${pct(hist.region)}%), culture ${hist.culture} (${pct(hist.culture)}%), none ${hist.none} | place+region ${pct(hist.place + hist.region)}%`);
console.log(`skips: ${skips.length}${skips.length ? ' -> ' + skips.map((s) => `${s.kind}:${s.id} (${s.reason})`).join('; ') : ''}`);
console.log(`warnings: ${warnings.length} (see field.stats.json)`);
console.log(`ocr: ${stats.ocr.changes} repairs in ${stats.ocr.stringsChanged} strings (${stats.ocr.unique} distinct), residual suspects: ${stats.ocr.residual}`);
console.log(`curation families: ${curationFamilies.length}${curationFamilies.length ? ` (${curationFamilies.join(', ')})` : ''} | joins: ${joins.length} (dropped ${joinsDropped})`);
if (formFallbacks.length) console.log(`families lacking a oneLine: ${formFallbacks.join(', ')}`);
