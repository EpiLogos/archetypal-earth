// Generate Aion from reviewable curation, checking the real source corpus and field links.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createNormalizer, OCR_VERSION } from './lib/ocr.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export { DEFAULT_VAULT } from './lib/vault.mjs';
import { DEFAULT_VAULT } from './lib/vault.mjs';
const POLARITIES = new Set(['light', 'shadow', 'union', 'neutral']);
const HEX = /^#[0-9a-f]{6}$/i;
// Quotes use the existing OCR module's safe mode: whitespace/ligatures only, never word repair.
const normalizer = createNormalizer({ freq: new Map(), english: new Set(), pairs: new Map() });
export const normalizePassage = (text) => normalizer.normalize(text, { mode: 'safe' }).text;

/** Check the public data contract, temporal relationships, extension isolation and real field links. */
export function validateHistory(history, { field } = {}) {
  const errors = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  const string = (value, where, max = Infinity) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail(where, `expected nonempty string${max < Infinity ? ` of at most ${max} characters` : ''}`);
  };
  const number = (value, where) => { if (!Number.isFinite(value)) fail(where, 'expected finite number'); };
  const list = (value, where) => {
    if (!Array.isArray(value)) { fail(where, 'expected array'); return []; }
    return value;
  };
  const ids = (items, where) => {
    const result = new Map();
    for (const item of items) {
      if (!item || typeof item !== 'object') { fail(where, 'expected object'); continue; }
      string(item.id, `${where}.id`);
      if (result.has(item.id)) fail(where, `duplicate id ${item.id}`);
      result.set(item.id, item);
    }
    return result;
  };
  const prose = (item, where) => {
    string(item.name, `${where}.name`);
    string(item.oneLine, `${where}.oneLine`, 90);
    if (!POLARITIES.has(item.polarity)) fail(where, 'unknown polarity');
  };
  const grounded = (item, where) => {
    prose(item, where);
    const body = list(item.body, `${where}.body`);
    if (!body.length) fail(where, 'missing summary');
    body.forEach((text, i) => string(text, `${where}.body[${i}]`));
    const passages = list(item.passages, `${where}.passages`);
    if (!passages.length) fail(where, 'missing source passage');
    passages.forEach((p, i) => {
      if (!p || typeof p !== 'object') { fail(where, 'invalid passage'); return; }
      for (const k of ['text', 'work', 'locator']) string(p[k], `${where}.passages[${i}].${k}`);
      if (typeof p.locator === 'string' && !/^(?:¶\d+(?:–\d+)?(?:, n\.\d+)? \(pdf p\d+(?:–\d+)?\)|pdf p\d+(?:–\d+)?)$/.test(p.locator)) fail(where, `unsupported locator ${p.locator}`);
    });
  };
  if (!history || typeof history !== 'object') return ['history: expected object'];
  string(history.generatedAt, 'generatedAt');
  if (!Number.isFinite(Date.parse(history.generatedAt))) fail('generatedAt', 'expected ISO timestamp');
  const readings = list(history.readings, 'readings');
  if (!readings.length) fail('readings', 'missing reading');
  const readingIds = ids(readings, 'readings');
  const familyIds = field ? new Set(field.families.map((x) => x.id)) : null;
  const occurrenceIds = field ? new Set(field.occurrences.map((x) => x.id)) : null;
  const archetypeIds = field ? new Set(field.archetypes.map((x) => x.id)) : null;
  for (const reading of readings) {
    if (!reading || typeof reading !== 'object') continue;
    const rw = `reading ${reading.id}`;
    for (const k of ['title', 'author']) string(reading[k], `${rw}.${k}`);
    number(reading.from, `${rw}.from`); number(reading.to, `${rw}.to`);
    if (!(reading.from < reading.to)) fail(rw, 'invalid reading span');
    if (reading.work !== undefined) string(reading.work, `${rw}.work`);
    if (reading.extends !== undefined) {
      if (!readingIds.has(reading.extends) || reading.extends === reading.id) fail(rw, 'missing or self extension target');
      const seen = new Set([reading.id]);
      let parent = readingIds.get(reading.extends);
      while (parent) {
        if (seen.has(parent.id)) { fail(rw, 'extension cycle'); break; }
        seen.add(parent.id); parent = readingIds.get(parent.extends);
      }
    }
    const epochs = list(reading.epochs, `${rw}.epochs`);
    const events = list(reading.events, `${rw}.events`);
    const threads = list(reading.threads, `${rw}.threads`);
    if (!epochs.length) fail(rw, 'missing epochs');
    const epochIds = ids(epochs, `${rw}.epochs`);
    const eventIds = ids(events, `${rw}.events`);
    ids(threads, `${rw}.threads`);
    let previousEpoch = -Infinity;
    for (const epoch of epochs) {
      if (!epoch || typeof epoch !== 'object') continue;
      const ew = `${rw}, epoch ${epoch.id}`;
      grounded(epoch, ew);
      number(epoch.from, `${ew}.from`); number(epoch.to, `${ew}.to`);
      if (!(epoch.from < epoch.to) || epoch.from < reading.from || epoch.to > reading.to) fail(ew, 'span outside reading or reversed');
      if (epoch.from < previousEpoch) fail(ew, 'epochs not ordered by start year');
      previousEpoch = epoch.from;
      if (!Number.isFinite(epoch.spectrum) || epoch.spectrum < 0 || epoch.spectrum > 1) fail(ew, 'spectrum outside 0..1');
      for (const k of ['core', 'glow', 'fog', 'deep']) if (!HEX.test(epoch.palette?.[k] || '')) fail(ew, `invalid palette ${k}`);
      if (epoch.parentId !== undefined) {
        const parent = epochIds.get(epoch.parentId);
        if (!parent || parent === epoch) fail(ew, 'missing or self parent');
        else if (epoch.from < parent.from || epoch.to > parent.to) fail(ew, 'child outside parent span');
        const seen = new Set([epoch.id]); let ancestor = parent;
        while (ancestor) {
          if (seen.has(ancestor.id)) { fail(ew, 'epoch parent cycle'); break; }
          seen.add(ancestor.id); ancestor = epochIds.get(ancestor.parentId);
        }
      }
      if (epoch.archetypeIds !== undefined) {
        const values = list(epoch.archetypeIds, `${ew}.archetypeIds`);
        if (new Set(values).size !== values.length) fail(ew, 'duplicate archetypeIds');
        for (const id of values) {
          string(id, `${ew}.archetypeIds`);
          if (archetypeIds && !archetypeIds.has(id)) fail(ew, `unresolved archetypeIds: ${id}`);
        }
      }
    }
    // Nested spans are allowed. Siblings may meet at a boundary but cannot overlap.
    for (let i = 0; i < epochs.length; i++) for (let j = i + 1; j < epochs.length; j++) {
      const a = epochs[i], b = epochs[j];
      if (a && b && a.parentId === b.parentId && Math.max(a.from, b.from) < Math.min(a.to, b.to)) fail(rw, `sibling epochs overlap: ${a.id}, ${b.id}`);
    }
    let previousEvent = -Infinity;
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      const ew = `${rw}, event ${event.id}`;
      grounded(event, ew); string(event.yearDisplay, `${ew}.yearDisplay`); number(event.year, `${ew}.year`);
      if (event.year < previousEvent) fail(ew, 'events not ordered by year');
      previousEvent = event.year;
      const epoch = epochIds.get(event.epochId);
      if (!epoch) fail(ew, 'missing epoch');
      else if (event.year < epoch.from || event.year > epoch.to) fail(ew, 'event outside epoch span');
      const hasLat = event.lat !== undefined, hasLon = event.lon !== undefined;
      if (hasLat !== hasLon) fail(ew, 'coordinate pair incomplete');
      if (hasLat && (!Number.isFinite(event.lat) || event.lat < -90 || event.lat > 90)) fail(ew, 'latitude outside -90..90');
      if (hasLon && (!Number.isFinite(event.lon) || event.lon < -180 || event.lon > 180)) fail(ew, 'longitude outside -180..180');
      if (hasLat && !event.place) fail(ew, 'coordinates require a place');
      if (event.place !== undefined) string(event.place, `${ew}.place`);
      for (const [key, known] of [['familyIds', familyIds], ['occurrenceIds', occurrenceIds]]) {
        const values = list(event[key], `${ew}.${key}`);
        if (new Set(values).size !== values.length) fail(ew, `duplicate ${key}`);
        for (const id of values) {
          string(id, `${ew}.${key}`);
          if (known && !known.has(id)) fail(ew, `unresolved ${key}: ${id}`);
        }
      }
      if (event.archetypeIds !== undefined) {
        const values = list(event.archetypeIds, `${ew}.archetypeIds`);
        if (new Set(values).size !== values.length) fail(ew, 'duplicate archetypeIds');
        for (const id of values) {
          string(id, `${ew}.archetypeIds`);
          if (archetypeIds && !archetypeIds.has(id)) fail(ew, `unresolved archetypeIds: ${id}`);
        }
      }
    }
    for (const thread of threads) {
      if (!thread || typeof thread !== 'object') continue;
      const tw = `${rw}, thread ${thread.id}`;
      prose(thread, tw);
      const eventList = list(thread.eventIds, `${tw}.eventIds`);
      if (eventList.length < 2) fail(tw, 'thread needs at least two events');
      if (new Set(eventList).size !== eventList.length) fail(tw, 'repeated thread event');
      let previous = -Infinity;
      for (const id of eventList) {
        const event = eventIds.get(id);
        if (!event) { fail(tw, `unresolved event ${id}`); continue; }
        if (event.year < previous) fail(tw, 'events not in chronological order');
        previous = event.year;
      }
    }
  }
  return errors;
}

/** Verify quotation bytes against the cited page window of the actual read-only corpus. */
export function verifySourcePassages(curated, { vault = DEFAULT_VAULT } = {}) {
  const errors = [];
  const sources = new Map();
  for (const [work, source] of Object.entries(curated.sources || {})) {
    const file = path.resolve(vault, source.file);
    if (!file.startsWith(`${path.resolve(vault)}${path.sep}`)) { errors.push(`${work}: source outside vault`); continue; }
    if (!fs.existsSync(file)) { errors.push(`${work}: source corpus unavailable: ${file}`); continue; }
    const raw = fs.readFileSync(file, 'utf8');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    if (hash !== source.sha256) errors.push(`${work}: source revision changed; recheck the curation before updating its source hash`);
    const pieces = raw.split(new RegExp(`<!-- ${work} · pdf p(\\d+)(?: · print p[^>]*)? -->`, 'u'));
    const pages = new Map();
    for (let i = 1; i < pieces.length; i += 2) pages.set(Number(pieces[i]), pieces[i + 1]);
    sources.set(work, pages);
  }
  for (const reading of curated.readings || []) for (const item of [...reading.epochs, ...reading.events]) for (const passage of item.passages) {
    const where = `${reading.id}/${item.id}/${passage.locator}`;
    const binding = curated.sourceBindings?.[`${passage.work}:${passage.locator}`];
    if (!binding || binding.work !== passage.work || binding.locator !== passage.locator) { errors.push(`${where}: unregistered source locator`); continue; }
    const source = sources.get(passage.work);
    if (!source) { errors.push(`${where}: source work unavailable`); continue; }
    if (!Array.isArray(binding.pages) || !binding.pages.length || binding.pages.some((p) => !source.has(p))) { errors.push(`${where}: cited source page unavailable`); continue; }
    const content = normalizePassage(binding.pages.map((p) => source.get(p)).join(' '));
    if (binding.witness && !content.includes(normalizePassage(binding.witness))) errors.push(`${where}: paragraph witness not found on cited pages`);
    if (!content.includes(normalizePassage(passage.text))) errors.push(`${where}: quotation not verbatim on cited pages`);
  }
  return errors;
}

export function loadCuration(root = ROOT) {
  // Each author owns a separate curation file. Extensions never modify jung-aion.json.
  // jung-aion loads first so the core reading stays the mode's default and history
  // keeps its shape for everything that reads readings[0].
  const dir = path.join(root, 'curation/aion');
  const order = (name) => (name === 'jung-aion.json' ? `0-${name}` : name);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort((a, b) => order(a).localeCompare(order(b)));
  return files.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

export function generateHistory({ root = ROOT, vault = process.env.JUNG_VAULT || DEFAULT_VAULT, check = false } = {}) {
  const curated = loadCuration(root);
  const target = path.join(root, 'public/data/history.json');
  const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
  const readings = curated.flatMap((source) => source.readings);
  const same = previous && JSON.stringify(previous.readings) === JSON.stringify(readings);
  const history = { generatedAt: same ? previous.generatedAt : new Date().toISOString(), readings };
  const field = JSON.parse(fs.readFileSync(path.join(root, 'public/data/field.json'), 'utf8'));
  const errors = validateHistory(history, { field });
  for (const source of curated) errors.push(...verifySourcePassages(source, { vault }));
  if (check && !same) errors.push('history.json differs from curated readings; run npm run aion');
  if (errors.length) throw new Error(errors.join('\n'));
  if (!check) fs.writeFileSync(target, `${JSON.stringify(history, null, 2)}\n`);
  return { readings: readings.length, epochs: readings.reduce((n, r) => n + r.epochs.length, 0), events: readings.reduce((n, r) => n + r.events.length, 0), threads: readings.reduce((n, r) => n + r.threads.length, 0), ocrVersion: OCR_VERSION };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const check = process.argv.includes('--check');
    if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/aion.mjs [--check]');
    console.log(`${check ? 'Verified' : 'Generated'} Aion: ${JSON.stringify(generateHistory({ check }))}`);
  } catch (error) {
    console.error(`Aion validation failed:\n${error.message}`);
    process.exitCode = 1;
  }
}
