// Generate the sky layer's data (public/data/sky.json) from three honest inputs:
//   • curation/sky/*.json          — site-side mythic character and ties, reviewable
//   • the ephemeris sidecar        — the one astronomical authority (Kerykeion / libephemeris, JPL DE440)
//   • the read-only Jung vault     — every `jung` quotation is checked verbatim against its cited page
// Nothing is fabricated: no sidecar, no sky.json. `--check` regenerates and compares (ignoring
// generatedAt) and also checks the running sidecar against the version pin in ephemeris/requirements.txt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT, normalizePassage } from './aion.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SIDECAR_URL = process.env.EPHEMERIS_URL || 'http://127.0.0.1:5187';
export const SIDECAR_NAME = 'archetypal-earth-ephemeris';
export const SIDECAR_VERSION = '1.2.0';
/** the packages whose exact versions the sidecar must report (single-sourced from requirements.txt) */
const PINNED_PACKAGES = ['kerykeion', 'libephemeris', 'fastapi', 'uvicorn', 'timezonefinder'];

export const SPAN = { from: '2015-01-01T00:00:00Z', to: '2040-01-01T00:00:00Z' };
const PLANET_STEP_HOURS = 48;
/** one sidereal period of each orbit, sampled around this epoch to draw the rings from real positions */
const ORBIT_EPOCH = '2026-01-01T00:00:00Z';
const ORBIT_SAMPLES = 180;
/** general precession in longitude, degrees per Julian century (IAU 2006 linear term) */
const PRECESSION_DEG_PER_CENTURY = 1.3969713;
const MOON_STEP_HOURS = 6;
const BODY_KEYS = ['sun', 'moon', 'earth', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const HELIO = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const BASES = new Set(['jung', 'inferred', 'site']);
const HEX = /^#[0-9a-f]{6}$/i;
const AU_KM = 149597870.7;
const EARTH_RADIUS_KM = 6371.0084;
const LOCATOR = /^(?:¶(\d+) \(pdf p(\d+)\)|pdf p(\d+))$/;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// ── curation validation ────────────────────────────────────────────────────

export function validateCuration({ bodies, ties, cultures }, { field } = {}) {
  const errors = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  const str = (v, where, max = Infinity) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max) fail(where, `expected nonempty string${max < Infinity ? ` of at most ${max} characters` : ''}`);
  };
  const num = (v, where, lo = -Infinity, hi = Infinity) => {
    if (!Number.isFinite(v) || v < lo || v > hi) fail(where, `expected number in [${lo}, ${hi}]`);
  };

  const list = bodies?.bodies;
  if (!Array.isArray(list)) return ['bodies: expected array'];
  const keys = list.map((b) => b.key);
  for (const k of BODY_KEYS) if (!keys.includes(k)) fail('bodies', `missing body ${k}`);
  for (const k of keys) if (!BODY_KEYS.includes(k)) fail('bodies', `unknown body ${k}`);
  if (new Set(keys).size !== keys.length) fail('bodies', 'duplicate body');
  const orders = list.map((b) => b.order);
  if (new Set(orders).size !== orders.length) fail('bodies', 'duplicate order');

  for (const b of list) {
    const w = `body ${b.key}`;
    str(b.name, `${w}.name`); str(b.oneLine, `${w}.oneLine`, 90); str(b.palette_from, `${w}.palette_from`);
    num(b.order, `${w}.order`, 0, 10); num(b.spectrum, `${w}.spectrum`, 0, 1); num(b.radiusKm, `${w}.radiusKm`, 1);
    for (const k of ['core', 'glow', 'fog', 'deep']) if (!HEX.test(b.palette?.[k] || '')) fail(w, `invalid palette ${k}`);
    if (typeof b.modern !== 'boolean') fail(w, 'modern must be boolean');
    if (b.modern !== (b.discovered !== undefined)) fail(w, 'modern bodies carry a dated discovery, and only they do');
    if (b.discovered) num(b.discovered.year, `${w}.discovered.year`, 1781, 2026);
    if (b.key !== 'sun') {
      if (!b.orbit) fail(w, 'missing orbit');
      else {
        num(b.orbit.au, `${w}.orbit.au`, 1e-6); num(b.orbit.eccentricity, `${w}.orbit.eccentricity`, 0, 0.99);
        num(b.orbit.siderealDays, `${w}.orbit.siderealDays`, 1); num(b.orbit.inclinationDeg, `${w}.orbit.inclinationDeg`, 0, 30);
        if (b.key === 'moon' && b.orbit.around !== 'earth') fail(w, 'moon must orbit earth');
      }
    }
    if (!Array.isArray(b.sources) || !b.sources.length) fail(w, 'missing sources');
    else b.sources.forEach((s, i) => {
      str(s.claim, `${w}.sources[${i}].claim`); str(s.ref, `${w}.sources[${i}].ref`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.retrieved || '')) fail(w, `sources[${i}] needs a retrieved date`);
    });
  }

  const archetypeIds = field ? new Set(field.archetypes.map((x) => x.id)) : null;
  const familyIds = field ? new Set(field.families.map((x) => x.id)) : null;
  const resolves = (t, where) => {
    if (!t || !['family', 'archetype'].includes(t.type)) { fail(where, 'target needs type family|archetype'); return; }
    const known = t.type === 'family' ? familyIds : archetypeIds;
    if (known && !known.has(t.id)) fail(where, `unresolved ${t.type} ${t.id}`);
  };

  const tieList = ties?.ties;
  if (!Array.isArray(tieList)) fail('ties', 'expected array');
  else {
    const seen = new Set();
    for (const t of tieList) {
      const w = `tie ${t.body}→${t.target?.type}:${t.target?.id}`;
      if (!BODY_KEYS.includes(t.body)) fail(w, 'unknown body');
      resolves(t.target, w);
      if (!BASES.has(t.basis)) fail(w, 'basis must be jung|inferred|site');
      str(t.note, `${w}.note`);
      const id = `${t.body}|${t.target?.type}|${t.target?.id}`;
      if (seen.has(id)) fail(w, 'duplicate tie'); seen.add(id);
      if (t.basis === 'jung' && !(t.cites?.length)) fail(w, 'a jung tie needs a cited passage');
      if (t.basis === 'site' && t.cites?.length) fail(w, 'a site tie carries no citation');
      for (const c of t.cites || []) cite(c, w);
    }
    for (const k of BODY_KEYS) if (!tieList.some((t) => t.body === k)) fail(`body ${k}`, 'has no resolved field link (no body card without one)');
  }
  function cite(c, w) {
    for (const k of ['work', 'workTitle', 'locator', 'quote']) str(c[k], `${w}.cite.${k}`);
    if (typeof c.locator === 'string' && !LOCATOR.test(c.locator)) fail(w, `unsupported locator ${c.locator}`);
  }

  for (const r of ties?.readings || []) {
    const w = `reading ${r.id}`;
    str(r.id, `${w}.id`); str(r.name, `${w}.name`); str(r.statement, `${w}.statement`);
    if (!BASES.has(r.basis)) fail(w, 'basis must be jung|inferred|site');
    for (const b of r.bodies || []) if (!BODY_KEYS.includes(b)) fail(w, `unknown body ${b}`);
    for (const t of r.targets || []) resolves(t, w);
    if (!r.cites?.length) fail(w, 'a reading needs cited passages');
    for (const c of r.cites || []) cite(c, w);
  }

  const cultureIds = field ? new Set(field.cultures.map((x) => x.id)) : null;
  for (const [cid, per] of Object.entries(cultures?.cultures || {})) {
    if (cultureIds && !cultureIds.has(cid)) fail(`culture ${cid}`, 'unresolved against the field');
    for (const [bk, p] of Object.entries(per)) {
      const w = `culture ${cid}/${bk}`;
      if (!BODY_KEYS.includes(bk)) fail(w, 'unknown body');
      str(p.name, `${w}.name`); str(p.source, `${w}.source`);
      if (!['deity', 'element'].includes(p.kind)) fail(w, 'kind must be deity|element');
      if (!BASES.has(p.basis)) fail(w, 'basis must be jung|inferred|site');
    }
  }
  return errors;
}

// ── vault quotation check (read-only) ──────────────────────────────────────

/**
 * Every cited quote must appear verbatim (OCR-safe normalisation only) on the cited PDF page of the
 * read-only vault corpus; when a ¶ number is stated it must equal the nearest preceding paragraph
 * marker, otherwise the citation is the PDF page alone.
 */
export function verifyCitations(cites, { vault = DEFAULT_VAULT } = {}) {
  const errors = [];
  const corpora = new Map();
  const load = (work) => {
    if (corpora.has(work)) return corpora.get(work);
    const file = path.join(vault, 'corpus', `${work}.md`);
    let value = null;
    if (fs.existsSync(file)) {
      const text = normalizePassage(fs.readFileSync(file, 'utf8'));
      const pages = [...text.matchAll(new RegExp(`<!-- ${work} · pdf p(\\d+)[^>]*-->`, 'gu'))].map((m) => ({ page: Number(m[1]), at: m.index }));
      value = { text, pages, marks: [...text.matchAll(/\*\*¶(\d+)\*\*/gu)].map((m) => ({ n: Number(m[1]), at: m.index })) };
    }
    corpora.set(work, value);
    return value;
  };
  for (const { cite: c, where } of cites) {
    const m = LOCATOR.exec(c.locator);
    if (!m) continue;
    const wantPara = m[1] ? Number(m[1]) : null;
    const wantPage = Number(m[2] ?? m[3]);
    const corpus = load(c.work);
    if (!corpus) { errors.push(`${where}: source corpus unavailable for ${c.work} (${path.join(vault, 'corpus', `${c.work}.md`)})`); continue; }
    const idx = corpus.pages.findIndex((p) => p.page === wantPage);
    if (idx < 0) { errors.push(`${where}: pdf p${wantPage} not in ${c.work}`); continue; }
    const from = corpus.pages[idx].at;
    const to = idx + 1 < corpus.pages.length ? corpus.pages[idx + 1].at : corpus.text.length;
    const rel = corpus.text.slice(from, to).indexOf(normalizePassage(c.quote));
    if (rel < 0) { errors.push(`${where}: quotation not verbatim on ${c.work} pdf p${wantPage}`); continue; }
    if (wantPara !== null) {
      const at = from + rel;
      const near = [...corpus.marks].reverse().find((k) => k.at < at);
      if (!near || near.n !== wantPara) errors.push(`${where}: cited ¶${wantPara} but the nearest paragraph marker is ¶${near ? near.n : 'none'}; cite the pdf page alone`);
    }
  }
  return errors;
}

export function collectCites({ ties }) {
  const out = [];
  for (const t of ties.ties) for (const c of t.cites || []) out.push({ cite: c, where: `tie ${t.body}→${t.target.id}` });
  for (const r of ties.readings || []) for (const c of r.cites) out.push({ cite: c, where: `reading ${r.id}` });
  return out;
}

// ── the zodiac book (read-only, the owner's library) ───────────────────────

/** Comparison form for book text: curly quotes and dashes to ASCII, soft hyphens gone, whitespace collapsed. */
function normalizeBookText(text) {
  return text
    .replace(/[\u00AD\u201A\u201B]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Letters and digits only, case-folded: the text layer's spacing, case and hyphen-line-breaks are noise, its letters are the evidence. */
function canonicalBookText(text) {
  return normalizeBookText(text).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Smallest edit distance from the quote to any substring of the page (Sellers' search). */
function approximateSubstringDistance(page, quote) {
  const m = quote.length;
  let prev = new Array(m + 1).fill(0).map((_, j) => j);
  let best = m;
  for (let i = 1; i <= page.length; i++) {
    const cur = [0];
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (page[i - 1] === quote[j - 1] ? 0 : 1));
    }
    best = Math.min(best, cur[m]);
    prev = cur;
  }
  return best;
}

/** Shape checks for curation/sky/burt.json: one file, one source, short page-cited quotations. */
export function validateBurt(burt) {
  const errors = [];
  const fail = (w, m) => errors.push(`${w}: ${m}`);
  if (!burt || typeof burt !== 'object') return ['burt: expected object'];
  const src = burt.source;
  if (!src || typeof src !== 'object') return ['burt.source: expected object'];
  for (const k of ['title', 'author', 'file']) if (typeof src[k] !== 'string' || !src[k].trim()) fail(`burt.source.${k}`, 'expected nonempty string');
  if (!/^[0-9a-f]{64}$/.test(src.sha256 || '')) fail('burt.source.sha256', 'expected the PDF revision hash');
  if (!Number.isFinite(src.year)) fail('burt.source.year', 'expected number');
  if (!Array.isArray(burt.entries) || !burt.entries.length) return [...errors, 'burt.entries: expected a nonempty array'];
  burt.entries.forEach((e, i) => {
    const w = `burt.entries[${i}]`;
    if (!/^(?:planet|sign|ruler-of):[a-z]+$/.test(e?.subject || '')) fail(w, `unsupported subject ${e?.subject}`);
    if (!Number.isInteger(e?.pdfPage) || e.pdfPage < 1) fail(w, 'pdfPage must be a positive integer');
    if (e.bookPage !== undefined && e.bookPage !== null && !Number.isFinite(e.bookPage)) fail(w, 'bookPage must be a number');
    const words = typeof e.quote === 'string' ? e.quote.trim().split(/\s+/).filter(Boolean).length : 0;
    if (!words || words > 45) fail(w, `quote must be 1..45 words (got ${words})`);
  });
  return errors;
}

/**
 * Every Burt quotation must sit verbatim (book-text normalisation only) on its cited PDF page of the
 * library copy, whose revision hash must equal the pin. Fails loudly when pdftotext or the book is absent:
 * an unverifiable quotation is not shipped.
 */
export function verifyBurtQuotes(burt, { root = ROOT } = {}) {
  const errors = [];
  const fail = (w, m) => errors.push(`${w}: ${m}`);
  if (!burt?.source?.file || !burt.source.sha256) return ['burt.source: file and sha256 are required before any quotation is verified'];
  const pdf = burt.source.file.replace(/^~(?=\/|$)/, process.env.HOME ?? '');
  if (!fs.existsSync(pdf)) return [`burt: the book is not in the library: ${pdf}`];
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(pdf));
  if (hash.digest('hex') !== burt.source.sha256) {
    fail('burt.source.sha256', 'the library copy changed; recheck every quotation before updating the pin');
  }
  const tool = spawnSync('pdftotext', [pdf, '-'], { maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' });
  if (tool.error || tool.status !== 0) {
    return [...errors, 'burt: pdftotext is required to verify quotations against the cited pages (install poppler)'];
  }
  const pages = tool.stdout.split('\f');
  const pageText = (n) => canonicalBookText(pages[n - 1] ?? '');
  for (const [i, e] of (burt.entries || []).entries()) {
    if (!e?.quote || !Number.isInteger(e.pdfPage)) continue; // shape is validateBurt's report
    // the text layer mis-spaces, mis-hyphenates and occasionally mis-letters what the rendered page
    // shows plainly; a real misquotation cannot hide inside a 1%-of-characters tolerance
    const quote = canonicalBookText(e.quote);
    const tol = Math.max(2, Math.ceil(quote.length * 0.01));
    const page = pageText(e.pdfPage);
    if (approximateSubstringDistance(page, quote) > tol) fail(`burt.entries[${i}] (${e.subject})`, `quotation not verbatim on pdf p${e.pdfPage}`);
  }
  return errors;
}

/** A body's page-cited quotations from the book, in curation order (empty for bodies the book does not define). */
export function burtQuotesFor(burt, key) {
  return (burt.entries || [])
    .filter((e) => e.subject === `planet:${key}`)
    .map(({ subject: _s, pdfPage, bookPage, chapter, quote }) => ({ text: quote, page: pdfPage, ...(Number.isFinite(bookPage) ? { bookPage } : {}), ...(chapter ? { chapter } : {}) }));
}

// ── sidecar ────────────────────────────────────────────────────────────────

export function pinnedPackages(root = ROOT) {
  const out = {};
  for (const line of fs.readFileSync(path.join(root, 'ephemeris/requirements.txt'), 'utf8').split('\n')) {
    const m = /^([A-Za-z0-9_.-]+)==(\S+)$/.exec(line.trim());
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

async function get(pathname, params = {}) {
  const url = new URL(pathname, SIDECAR_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(300_000) }); }
  catch (error) {
    throw new Error(`no ephemeris sidecar at ${SIDECAR_URL} (${error.cause?.code || error.message}). Start it with ephemeris/run.sh (setup: docs/SKY-SOURCES.md). The sky layer is never fabricated without it.`);
  }
  if (!res.ok) throw new Error(`sidecar ${url.pathname} answered ${res.status}: ${await res.text()}`);
  return res.json();
}

export function checkSidecarPin(ping, root = ROOT) {
  const errors = [];
  if (ping.name !== SIDECAR_NAME) errors.push(`sidecar name ${ping.name}, expected ${SIDECAR_NAME}`);
  if (ping.version !== SIDECAR_VERSION) errors.push(`sidecar version ${ping.version}, pinned ${SIDECAR_VERSION}`);
  const pins = pinnedPackages(root);
  for (const p of PINNED_PACKAGES) {
    if (ping.packages?.[p] !== pins[p]) errors.push(`sidecar package ${p} is ${ping.packages?.[p]}, requirements.txt pins ${pins[p]}`);
  }
  return errors;
}

const clean = (v) => (v === 0 ? 0 : v); // fold -0 into 0
function tidy(columns) {
  return { lon: columns.lon.map(clean), lat: columns.lat.map(clean), r: columns.r.map(clean) };
}

/** Do the orbit constants agree with the positions the ephemeris actually reports? */
export function crossCheckOrbits(bodies, planets, moon) {
  const errors = [];
  for (const b of bodies) {
    if (!b.orbit) continue;
    const col = b.key === 'moon' ? moon.bodies.moon : planets.bodies[b.key];
    if (!col) { errors.push(`orbit ${b.key}: no sampled positions`); continue; }
    const a = b.orbit.au; const e = b.orbit.eccentricity;
    const lo = a * (1 - e) * 0.97; const hi = a * (1 + e) * 1.03;
    const min = Math.min(...col.r); const max = Math.max(...col.r);
    if (min < lo || max > hi) errors.push(`orbit ${b.key}: sampled r ${min}–${max} au outside a(1±e) ${lo.toFixed(5)}–${hi.toFixed(5)}`);
  }
  return errors;
}

/** The gazetteer behind the birth-sky place field: named places with coordinates, and where they come from. */
export function validateGazetteer(g) {
  const errors = [];
  const src = g?.source;
  for (const k of ['claim', 'ref', 'retrieved']) if (typeof src?.[k] !== 'string' || !src[k].trim()) errors.push(`gazetteer.source.${k}: expected nonempty string`);
  if (!Array.isArray(g?.places) || !g.places.length) return [...errors, 'gazetteer.places: expected a nonempty array'];
  const seen = new Set();
  for (const [i, p] of g.places.entries()) {
    const w = `gazetteer.places[${i}]${p?.name ? ` ${p.name}` : ''}`;
    if (typeof p?.name !== 'string' || !p.name.trim()) errors.push(`${w}: expected nonempty name`);
    if (typeof p?.country !== 'string' || !p.country.trim()) errors.push(`${w}: expected nonempty country`);
    if (!Number.isFinite(p?.lat) || Math.abs(p.lat) > 90) errors.push(`${w}: lat must be within ±90`);
    if (!Number.isFinite(p?.lon) || Math.abs(p.lon) > 180) errors.push(`${w}: lon must be within ±180`);
    const id = `${p?.name}|${p?.country}`.toLowerCase();
    if (seen.has(id)) errors.push(`${w}: duplicate place`);
    seen.add(id);
  }
  return errors;
}

// ── assemble ───────────────────────────────────────────────────────────────

const equalIgnoringGeneratedAt = (a, b) => {
  const strip = (o) => JSON.stringify({ ...o, meta: { ...o.meta, generatedAt: undefined } });
  return strip(a) === strip(b);
};

export async function buildSky({ root = ROOT, vault = process.env.JUNG_VAULT || DEFAULT_VAULT } = {}) {
  const curation = {
    bodies: readJson(path.join(root, 'curation/sky/bodies.json')),
    ties: readJson(path.join(root, 'curation/sky/ties.json')),
    cultures: readJson(path.join(root, 'curation/sky/cultures.json')),
  };
  const gazetteer = readJson(path.join(root, 'curation/sky/gazetteer.json'));
  const burt = readJson(path.join(root, 'curation/sky/burt.json'));
  const field = readJson(path.join(root, 'public/data/field.json'));
  const errors = [...validateCuration(curation, { field }), ...validateGazetteer(gazetteer), ...validateBurt(burt), ...verifyCitations(collectCites(curation), { vault }), ...verifyBurtQuotes(burt, { root })];
  if (errors.length) throw new Error(errors.join('\n'));

  const ping = await get('/ping');
  const pin = checkSidecarPin(ping, root);
  if (pin.length) throw new Error(pin.join('\n'));
  const spanFrom = Date.parse(SPAN.from); const spanTo = Date.parse(SPAN.to);
  // floor: a grid never runs past the stated span
  const planetCount = Math.floor((spanTo - spanFrom) / 3_600_000 / PLANET_STEP_HOURS) + 1;
  const moonCount = Math.floor((spanTo - spanFrom) / 3_600_000 / MOON_STEP_HOURS) + 1;
  const orbitJobs = curation.bodies.bodies.filter((b) => b.orbit && HELIO.includes(b.key));
  const orbitEpoch = Date.parse(ORBIT_EPOCH);
  const [planetRaw, moonRaw, golden, orbitRaw] = await Promise.all([
    get('/positions', { start: SPAN.from, stepHours: PLANET_STEP_HOURS, count: planetCount, bodies: HELIO.join(','), frame: 'helio' }),
    get('/positions', { start: SPAN.from, stepHours: MOON_STEP_HOURS, count: moonCount, bodies: 'moon', frame: 'geo' }),
    get('/golden'),
    Promise.all(orbitJobs.map((b) => {
      const periodHours = b.orbit.siderealDays * 24;
      const start = new Date(orbitEpoch - (periodHours / 2) * 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z');
      return get('/positions', { start, stepHours: Number((periodHours / ORBIT_SAMPLES).toFixed(4)), count: ORBIT_SAMPLES, bodies: b.key, frame: 'helio' });
    })),
  ]);
  // Orbit rings: one real period of each body, with the precession accumulated since the epoch taken
  // out so the ring closes on itself instead of shearing across centuries.
  const orbits = Object.fromEntries(orbitJobs.map((b, i) => {
    const raw = orbitRaw[i];
    const col = raw.bodies[b.key];
    const startMs = Date.parse(raw.start);
    const lon = col.lon.map((x, k) => {
      const years = (startMs + k * raw.stepHours * 3_600_000 - orbitEpoch) / (365.25 * 86_400_000);
      const corrected = (((x - (PRECESSION_DEG_PER_CENTURY / 100) * years) % 360) + 360) % 360;
      return Number(corrected.toFixed(3));
    });
    return [b.key, { start: raw.start, stepHours: raw.stepHours, count: raw.count, frame: 'heliocentric ecliptic, precession since 2026.0 removed', lon, lat: col.lat.map(clean), r: col.r.map(clean) }];
  }));
  const planets = {
    start: planetRaw.start, stepHours: planetRaw.stepHours, count: planetRaw.count,
    bodies: Object.fromEntries(HELIO.map((k) => [k, tidy(planetRaw.bodies[k])])),
  };
  const moon = {
    start: moonRaw.start, stepHours: moonRaw.stepHours, count: moonRaw.count,
    bodies: { moon: tidy(moonRaw.bodies.moon) },
  };
  for (const g of [planets, moon]) for (const col of Object.values(g.bodies)) {
    for (const k of ['lon', 'lat', 'r']) if (col[k].length !== g.count || col[k].some((x) => !Number.isFinite(x))) throw new Error(`sidecar returned a malformed ${k} column`);
  }

  const bodies = curation.bodies.bodies
    .slice().sort((a, b) => a.order - b.order)
    .map(({ palette_from, ...b }) => {
      const quotes = burtQuotesFor(burt, b.key);
      return {
        ...b,
        paletteFrom: palette_from,
        ties: curation.ties.ties.filter((t) => t.body === b.key).map(({ body, ...t }) => t),
        ...(quotes.length ? { quotes } : {}),
        provenance: 'curation',
      };
    });
  const orbitErrors = crossCheckOrbits(bodies, planets, moon);
  if (orbitErrors.length) throw new Error(orbitErrors.join('\n'));

  const sky = {
    meta: {
      generatedAt: new Date().toISOString(),
      sidecar: { name: ping.name, version: ping.version, packages: ping.packages },
      ephemeris: { kernel: ping.ephemeris.kernel, from: ping.ephemeris.from, to: ping.ephemeris.to },
      span: SPAN,
      frame: 'geocentric ecliptic of date for the Moon; heliocentric ecliptic of date for planets and Earth; tropical longitudes in degrees, radii in au',
      counts: { bodies: bodies.length, ties: curation.ties.ties.length, planetSamples: planetCount, moonSamples: moonCount },
    },
    constants: { auKm: AU_KM, earthRadiusKm: EARTH_RADIUS_KM, moonOrbitEarthRadii: Number((384400 / EARTH_RADIUS_KM).toFixed(2)) },
    bodies,
    readings: curation.ties.readings || [],
    cultures: curation.cultures.cultures,
    gazetteer,
    planets,
    moon,
    orbits,
    golden: {
      epochs: golden.epochs,
      ayanamsa: golden.ayanamsa,
      constellationBoundaries: golden.constellationBoundaries,
      boundaryFrame: golden.equinoxFrame,
    },
  };
  return sky;
}

/** Pretty-print, with arrays of numbers kept on one line so the grids stay reviewable. */
export function formatSky(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === 'number')) return `[${value.join(', ')}]`;
    if (!value.length) return '[]';
    return `[\n${value.map((x) => `${pad}  ${formatSky(x, indent + 1)}`).join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, v]) => `${pad}  ${JSON.stringify(k)}: ${formatSky(v, indent + 1)}`).join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

/**
 * The few kilobytes the atlas needs *before* the sky is loaded: which field families and archetypes stand in a
 * tie with which body, and on what basis. Earth mode shows a quiet glyph from this without fetching the 2 MB of grids.
 * Derived from sky.json only (same `generatedAt`), so it cannot disagree with it.
 */
export function tiesIndex(sky) {
  return {
    meta: { generatedAt: sky.meta.generatedAt, from: 'public/data/sky.json' },
    bodies: sky.bodies.map((b) => ({ key: b.key, name: b.name, order: b.order, modern: b.modern, palette: { core: b.palette.core, glow: b.palette.glow }, spectrum: b.spectrum })),
    ties: sky.bodies.flatMap((b) => b.ties.map((t) => ({ body: b.key, type: t.target.type, id: t.target.id, basis: t.basis }))),
    readings: sky.readings.map((r) => ({ id: r.id, bodies: r.bodies, targets: r.targets, basis: r.basis })),
  };
}

export async function generateSky({ root = ROOT, vault, check = false } = {}) {
  const target = path.join(root, 'public/data/sky.json');
  const previous = fs.existsSync(target) ? readJson(target) : null;
  const sky = await buildSky({ root, vault });
  const same = previous && equalIgnoringGeneratedAt(previous, sky);
  if (same) sky.meta.generatedAt = previous.meta.generatedAt;
  if (check) {
    if (!previous) throw new Error('public/data/sky.json is missing; run npm run sky');
    if (!same) throw new Error('public/data/sky.json differs from a fresh regeneration (curation, sidecar or vault moved); run npm run sky and review the diff');
  } else if (!same) fs.writeFileSync(target, `${formatSky(sky)}\n`);
  // the ties index is derived from sky.json and must match it byte for byte
  const indexTarget = path.join(root, 'public/data/sky.ties.json');
  const indexText = `${formatSky(tiesIndex(sky))}\n`;
  const indexSame = fs.existsSync(indexTarget) && fs.readFileSync(indexTarget, 'utf8') === indexText;
  if (check) {
    if (!indexSame) throw new Error('public/data/sky.ties.json is missing or differs from sky.json; run npm run sky');
  } else if (!indexSame) fs.writeFileSync(indexTarget, indexText);
  return { bodies: sky.bodies.length, ties: sky.meta.counts.ties, readings: sky.readings.length, planetSamples: sky.meta.counts.planetSamples, moonSamples: sky.meta.counts.moonSamples, sidecar: `${sky.meta.sidecar.name}@${sky.meta.sidecar.version}`, kernel: sky.meta.ephemeris.kernel, unchanged: Boolean(same) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const check = process.argv.includes('--check');
    if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/sky.mjs [--check]');
    console.log(`${check ? 'Verified' : 'Generated'} sky: ${JSON.stringify(await generateSky({ check }))}`);
  } catch (error) {
    console.error(`Sky generation failed:\n${error.message}`);
    process.exitCode = 1;
  }
}
