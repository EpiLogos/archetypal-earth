// Generate the sky layer's data (public/data/sky.json) from three honest inputs:
//   • curation/sky/*.json          — site-side mythic character and ties, reviewable
//   • the ephemeris sidecar        — the one astronomical authority (Kerykeion / libephemeris, JPL DE440)
//   • the read-only Jung vault     — every `jung` quotation is checked verbatim against its cited page
// Nothing is fabricated: no sidecar, no sky.json. `--check` regenerates and compares (ignoring
// generatedAt) and also checks the running sidecar against the version pin in ephemeris/requirements.txt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT, normalizePassage } from './aion.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SIDECAR_URL = process.env.EPHEMERIS_URL || 'http://127.0.0.1:5187';
export const SIDECAR_NAME = 'archetypal-earth-ephemeris';
export const SIDECAR_VERSION = '1.1.0';
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
  const field = readJson(path.join(root, 'public/data/field.json'));
  const errors = [...validateCuration(curation, { field }), ...verifyCitations(collectCites(curation), { vault })];
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
    .map(({ palette_from, ...b }) => ({
      ...b,
      paletteFrom: palette_from,
      ties: curation.ties.ties.filter((t) => t.body === b.key).map(({ body, ...t }) => t),
      provenance: 'curation',
    }));
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
