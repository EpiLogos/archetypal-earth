// The walk oracle (S10): every stop of public/data/walks.json resolves to a subject, a page or a cite of the corpus; a
// chronological walk is monotone in year; a curated walk keeps the order of the source it was read from. The sources are
// read here from disk, independently of scripts/walks.mjs, so the check does not trust the generator's own reading.
//   node scripts/verify-walks.mjs     verify public/data/walks.json (exit 1 on any error)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KINDS = ['aion-thread', 'aion-chapters', 'redbook', 'theory-route', 'alchemy-stages', 'theoretic', 'text'];
const ORDER_OF_KIND = { 'aion-thread': 'curated', 'aion-chapters': 'curated', redbook: 'curated', 'theory-route': 'curated', 'alchemy-stages': 'curated', theoretic: 'chronological', text: 'page' };
const SUBJECT_TYPES = ['occurrence', 'event', 'chapter', 'stage', 'concept', 'route-stop'];

/** The data the walks are read from, loaded from disk. */
export function loadSources(root = ROOT) {
  const read = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));
  return {
    root,
    field: read('public', 'data', 'field.json'),
    history: read('public', 'data', 'history.json'),
    aionbook: read('public', 'data', 'aionbook.json'),
    redbook: read('public', 'data', 'redbook.json'),
    route: read('public', 'data', 'dynamics-route.json'),
    dynamics: read('public', 'data', 'dynamics.json'),
    alchemy: read('public', 'data', 'alchemy.json'),
    corpus: read('public', 'data', 'corpus', 'index.json'),
    registry: read('curation', 'works.json').works,
  };
}

/** The first four-digit year of a cite's engagement string ("1936/44" -> 1936), or null. Read here, not by the generator. */
const engagementYear = (text) => { const m = /\b(1[5-9]\d\d|20\d\d)\b/.exec(String(text ?? '')); return m ? Number(m[1]) : null; };

/**
 * The page walk each Work must have, made from field.json, the registry and the corpus volumes alone: the occurrences that
 * cite the Work (every key folded through its aliases) at the lowest page their cites name, in page order. A ¶ is read
 * through the volume's paragraph anchors (the one on the cited pdf page when several match), else `pdf p`.
 */
export function expectedTextWalks(src, cache = new Map()) {
  const keyOf = new Map();
  for (const [id, w] of Object.entries(src.registry)) for (const k of [id, ...(w.aliases ?? [])]) keyOf.set(k, id);
  const vols = new Map();
  const vol = (id) => {
    if (!vols.has(id)) vols.set(id, src.registry[id].corpus ? JSON.parse(fs.readFileSync(path.join(src.root, 'public', 'data', 'corpus', src.registry[id].corpus), 'utf8')) : null);
    return vols.get(id);
  };
  const out = new Map();
  for (const o of src.field.occurrences) {
    for (const c of o.jung ?? []) {
      const id = keyOf.get(c.work);
      if (!id || !vol(id)) continue;
      const loc = c.locator ?? '';
      const para = /¶\s*(\d+)/.exec(loc);
      const pdf = /pdf\s*p\.?\s*(\d+)/.exec(loc);
      let page = null;
      if (para) {
        let cands = (vol(id).paras ?? []).filter((x) => x.para === Number(para[1]));
        if (pdf) { const on = cands.filter((x) => x.p === Number(pdf[1])); if (on.length) cands = on; }
        if (cands.length) page = cands[0].p;
      }
      if (page === null && pdf) page = Number(pdf[1]);
      if (page === null) continue;
      if (!out.has(id)) out.set(id, new Map());
      const mine = out.get(id);
      const had = mine.get(o.id);
      if (!had || page < had.page) mine.set(o.id, { id: o.id, page, citeYear: engagementYear(c.year) });
    }
  }
  const res = new Map();
  for (const [id, m] of out) res.set(id, [...m.values()].sort((a, b) => a.page - b.page || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return res;
}

/** The pdf page a locator names ("¶149 (pdf p105)" -> 105; "pdf p91–92" -> 91), or undefined. */
export function pdfPage(locator) {
  const m = /pdf p(\d+)/.exec(locator ?? '');
  return m ? Number(m[1]) : undefined;
}

/** The pdf pages a corpus volume holds, read once per volume. */
function volumePages(src, work, cache) {
  if (cache.has(work)) return cache.get(work);
  const entry = src.corpus.works.find((w) => w.work === work);
  if (!entry) return null;
  const vol = JSON.parse(fs.readFileSync(path.join(src.root, 'public', 'data', 'corpus', entry.file), 'utf8'));
  const set = new Set(vol.pages.map((p) => p.p));
  const value = { min: Math.min(...set), max: Math.max(...set), set };
  cache.set(work, value);
  return value;
}

/** The subject sequence each curated walk must keep, read from its own source (never from the generated stops). */
export function curatedSequence(src, walk) {
  if (walk.kind === 'aion-thread') {
    const [readingId, threadId] = walk.id.split('/');
    const reading = src.history.readings.find((r) => r.id === readingId);
    const thread = reading?.threads.find((t) => t.id === threadId);
    return thread ? thread.eventIds.map((id) => ({ type: 'event', id })) : null;
  }
  if (walk.kind === 'aion-chapters') return src.aionbook.chapters.map((c) => ({ type: 'chapter', id: c.id }));
  if (walk.kind === 'redbook') return src.redbook.stops.map((s) => ({ type: 'occurrence', id: s.id }));
  if (walk.kind === 'alchemy-stages') return src.alchemy.opus.stages.map((s) => ({ type: 'stage', id: s.id }));
  if (walk.kind === 'theory-route') {
    return src.route.movements.flatMap((m) => m.stops).map((s) => (s.concept ? { type: 'concept', id: s.concept } : { type: 'route-stop', id: s.id }));
  }
  return null;
}

/**
 * Verify the walks against the sources. Returns { errors, counts } where counts is the number of stops per walk id.
 * Each error names its walk and stop.
 */
export function verifyWalks(walks, src) {
  const errors = [];
  const fail = (where, msg) => errors.push(`${where}: ${msg}`);
  const occ = new Map(src.field.occurrences.map((o) => [o.id, o]));
  const events = new Map();
  for (const r of src.history.readings) for (const e of r.events) events.set(e.id, e);
  const chapters = new Set(src.aionbook.chapters.map((c) => c.id));
  const stages = new Set(src.alchemy.opus.stages.map((s) => s.id));
  const concepts = new Set(src.dynamics.concepts.map((c) => c.id));
  const routeOwn = new Set(src.route.movements.flatMap((m) => m.stops).filter((s) => !s.concept).map((s) => s.id));
  const theoretics = new Set(src.field.theoretics.map((t) => t.id));
  const resolve = {
    occurrence: (id) => occ.has(id),
    event: (id) => events.has(id),
    chapter: (id) => chapters.has(id),
    stage: (id) => stages.has(id),
    concept: (id) => concepts.has(id),
    'route-stop': (id) => routeOwn.has(id),
  };
  const pages = new Map();
  const counts = {};
  const seen = new Set();
  const cache = new Map();
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  const checkCite = (where, cite, label) => {
    if (typeof cite?.work !== 'string' || typeof cite.locator !== 'string') return fail(where, `${label} needs work and locator`);
    const vol = volumePages(src, cite.work, cache);
    if (!vol) return fail(where, `${label}: no corpus volume for ${cite.work}`);
    const p = pdfPage(cite.locator);
    if (p !== undefined && (p < vol.min || p > vol.max || !vol.set.has(p))) fail(where, `${label}: pdf page ${p} of ${cite.work} is outside the corpus (${vol.min}-${vol.max})`);
    return undefined;
  };

  for (const walk of walks) {
    const wid = walk.id;
    const where = `walk ${wid}`;
    if (typeof wid !== 'string' || !wid) { fail(where, 'a walk needs an id'); continue; }
    if (seen.has(wid)) fail(where, 'walk id repeats');
    seen.add(wid);
    if (!KINDS.includes(walk.kind)) fail(where, `unknown kind ${walk.kind}`);
    if (!walk.title || typeof walk.title !== 'string') fail(where, 'a walk needs a title');
    if (typeof walk.source !== 'string' || !walk.source) fail(where, 'a walk needs its source');
    if (ORDER_OF_KIND[walk.kind] !== walk.ordered) fail(where, `kind ${walk.kind} is ${ORDER_OF_KIND[walk.kind]}, not ${walk.ordered}`);
    if (!Array.isArray(walk.stops) || walk.stops.length === 0) { fail(where, 'a walk needs stops'); continue; }
    counts[wid] = walk.stops.length;

    walk.stops.forEach((stop, i) => {
      const at = `${where} stop ${i}`;
      if (!stop.subject && !stop.page) fail(at, 'a stop needs a subject or a page');
      if (stop.subject) {
        const { type, id } = stop.subject;
        if (!SUBJECT_TYPES.includes(type)) fail(at, `unknown subject type ${type}`);
        else if (!resolve[type](id)) fail(at, `${type} ${id} does not resolve`);
      }
      if (stop.cite) checkCite(at, stop.cite, 'cite');
      if (stop.page) {
        const vol = volumePages(src, stop.page.work, cache);
        if (!vol) fail(at, `page: no corpus volume for ${stop.page.work}`);
        else if (!Number.isInteger(stop.page.page) || stop.page.page < vol.min || stop.page.page > vol.max || !vol.set.has(stop.page.page)) fail(at, `page ${stop.page.page} of ${stop.page.work} is outside the corpus`);
        if (stop.cite && (stop.cite.work !== stop.page.work || pdfPage(stop.cite.locator) !== stop.page.page)) fail(at, 'page does not match the cite it came from');
      }
      if (stop.year !== undefined && !isNum(stop.year)) fail(at, 'year must be a number');
      if (stop.place !== undefined && !(isNum(stop.place.lat) && isNum(stop.place.lon))) fail(at, 'place needs lat and lon');
      // a stop's year and place are its subject's own (the clock and the flight read the same record)
      if (stop.subject?.type === 'event' && events.has(stop.subject.id)) {
        const e = events.get(stop.subject.id);
        if (stop.year !== e.year) fail(at, `year ${stop.year} is not the event's ${e.year}`);
        if (stop.place && (stop.place.lat !== e.lat || stop.place.lon !== e.lon)) fail(at, 'place is not the event\'s own');
      }
      if (stop.subject?.type === 'occurrence' && occ.has(stop.subject.id)) {
        const o = occ.get(stop.subject.id);
        if (stop.year !== undefined && stop.year !== o.year) fail(at, `year ${stop.year} is not the occurrence's ${o.year}`);
        const located = o.geoPrecision !== 'none' && isNum(o.lat) && isNum(o.lon);
        if (stop.place && (!located || stop.place.lat !== o.lat || stop.place.lon !== o.lon)) fail(at, 'place is not the occurrence\'s own');
        if (!stop.place && located && walk.kind === 'theoretic') fail(at, 'a theoretic stop must be placed (thread.ts walks located members only)');
      }
    });

    if (walk.ordered === 'chronological') {
      walk.stops.forEach((stop, i) => {
        if (!isNum(stop.year)) fail(`${where} stop ${i}`, 'a chronological stop needs a year');
        else if (i > 0 && stop.year < walk.stops[i - 1].year) fail(`${where} stop ${i}`, `year ${stop.year} goes back from ${walk.stops[i - 1].year}`);
      });
    }

    if (walk.ordered === 'page') {
      walk.stops.forEach((stop, i) => {
        if (!stop.page) fail(`${where} stop ${i}`, 'a page-ordered stop needs a page');
        else if (i > 0 && walk.stops[i - 1].page && stop.page.page < walk.stops[i - 1].page.page) fail(`${where} stop ${i}`, `page ${stop.page.page} goes back from ${walk.stops[i - 1].page.page}`);
        if (stop.page && stop.page.work !== wid.replace(/^text\//, '')) fail(`${where} stop ${i}`, `page is of ${stop.page.work}, not of the walk's Work`);
        if (stop.subject?.type !== 'occurrence') fail(`${where} stop ${i}`, 'a text stop is an occurrence');
      });
      const want = expectedTextWalks(src).get(wid.replace(/^text\//, ''));
      if (!want) fail(where, 'no Work of this id cites a placed page');
      else {
        const got = walk.stops.map((s) => `${s.subject?.id}@${s.page?.page}`);
        const exp = want.map((w) => `${w.id}@${w.page}`);
        if (got.length !== want.length) fail(where, `${got.length} stops, the field's cites give ${want.length}`);
        else if (got.some((g, i) => g !== exp[i])) fail(where, 'stops are not the field\'s cites in page order');
        else walk.stops.forEach((s, i) => { if ((s.citeYear ?? null) !== want[i].citeYear) fail(`${where} stop ${i}`, `citeYear ${s.citeYear} is not the cite's ${want[i].citeYear}`); });
      }
    }

    if (walk.ordered === 'curated') {
      const expected = curatedSequence(src, walk);
      if (!expected) fail(where, 'no source for this curated walk');
      else {
        const got = walk.stops.map((s) => (s.subject ? `${s.subject.type}:${s.subject.id}` : '-'));
        const want = expected.map((s) => `${s.type}:${s.id}`);
        if (got.length !== want.length || got.some((g, i) => g !== want[i])) fail(where, `stops do not keep the source order (${got.length} stops, source ${want.length})`);
      }
    }

    if (walk.kind === 'theoretic' && !theoretics.has(wid.replace(/^theoretic\//, ''))) fail(where, 'no such theoretic in field.json');
  }

  // every curated source appears once: each Aion thread, the chapters, the Red Book, the route, the stages
  const want = new Set(src.history.readings.flatMap((r) => r.threads.map((t) => `${r.id}/${t.id}`)));
  for (const id of want) if (!seen.has(id)) fail('walks', `Aion thread ${id} has no walk`);
  for (const id of ['aion-chapters', 'redbook', 'theory-route', 'alchemy-stages']) {
    if (!walks.some((w) => w.kind === id)) fail('walks', `no ${id} walk`);
  }
  // every Work whose cites the field places has its page walk (and no other Work has one)
  for (const id of expectedTextWalks(src, cache).keys()) if (!seen.has(`text/${id}`)) fail('walks', `Work ${id} has placed cites and no page walk`);
  return { errors, counts };
}

function kindCounts(walks) {
  const out = {};
  for (const w of walks) out[w.kind] = (out[w.kind] ?? 0) + w.stops.length;
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = loadSources();
  const file = path.join(ROOT, 'public', 'data', 'walks.json');
  const { walks } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { errors, counts } = verifyWalks(walks, src);
  for (const w of walks) console.log(`${w.id.padEnd(40)} ${w.kind.padEnd(16)} ${w.ordered.padEnd(13)} ${String(counts[w.id] ?? 0).padStart(4)} stops`);
  console.log('stops by kind:', JSON.stringify(kindCounts(walks)));
  if (errors.length) {
    console.error(`verify-walks: ${errors.length} error(s)\n${errors.join('\n')}`);
    process.exit(1);
  }
  console.log(`verify-walks: ${walks.length} walks, every stop resolves, every curated walk keeps its source order`);
}
