// Build public/data/walks.json: the walks the Walk runner steps (S9). No stop is authored here. Each is a record of a file
// that already exists: the Aion threads (history.json), the Aion chapters (aionbook.json), the Red Book folios
// (redbook.json), the Theory route (dynamics-route.json), the alchemy opus stages (alchemy.json), and one derived walk per
// theoretic (field.json: the members the model gives it, placed, by year, thinned as thread.ts thins a thread).
// A stop's year and place are its subject's own; its cite is the subject's first citation, its page the pdf page of it.
// One more walk per Work whose cites the field places on its corpus volume (S10b): the occurrences that cite it, in the
// order of the pages they cite, an occurrence once at the lowest page it cites (aliases folded: `redbook` is Liber Novus).
//   npm run walks          write public/data/walks.json
//   npm run walks:check    build in memory, verify every stop (scripts/verify-walks.mjs), and fail if the file differs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSources, pdfPage, ROOT, verifyWalks } from './verify-walks.mjs';
import { citeYear } from './lib/cite-year.mjs';
import { keyMap, loadWorks, placeCite, volume } from './works-registry.mjs';

/** The most stops a derived walk keeps: thread.ts's THREAD_MAX, one per time bucket. */
export const THEORETIC_MAX = 26;
const OUT = path.join('public', 'data', 'walks.json');

const isPlaced = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon);

// A cite is carried only when its work has a corpus volume to open at the page; the Red Book's own works (liber-novus,
// redbook) have none yet (Q9), so their cites are counted and left out rather than written unverifiable.
let corpusWorks = new Set();
let citesDropped = 0;
function citeOf(c) {
  if (!c || typeof c.locator !== 'string') return undefined;
  if (!corpusWorks.has(c.work)) { citesDropped++; return undefined; }
  return { work: c.work, locator: c.locator };
}

/** One stop, its keys in the order a reader expects: subject, page, year, place, cite. Absent keys are left out. */
function stop({ subject, cite, year, place }) {
  const out = {};
  if (subject) out.subject = subject;
  const page = cite ? pdfPage(cite.locator) : undefined;
  if (page !== undefined) out.page = { work: cite.work, page };
  if (year !== undefined) out.year = year;
  if (place) out.place = place;
  if (cite) out.cite = cite;
  return out;
}

/** thread.ts's thinBuckets: the sorted list cut into `max` buckets, each keeping its image-bearing member if it has one. */
function thinBuckets(sorted, max, prefer) {
  if (sorted.length <= max) return sorted.slice();
  const out = [];
  for (let b = 0; b < max; b++) {
    const lo = Math.floor((b * sorted.length) / max);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * sorted.length) / max));
    const slice = sorted.slice(lo, hi);
    out.push(slice.find(prefer) ?? slice[Math.floor(slice.length / 2)]);
  }
  return out;
}

/** The Aion threads: one walk per curated thread, its steps the thread's events in the curated order. */
function aionThreads(src) {
  return src.history.readings.flatMap((r) => r.threads.map((t) => ({
    id: `${r.id}/${t.id}`,
    kind: 'aion-thread',
    title: t.name,
    source: `history.json#${r.id}/threads/${t.id}`,
    ordered: 'curated',
    stops: t.eventIds.map((id) => {
      const e = r.events.find((x) => x.id === id);
      if (!e) throw new Error(`walks: thread ${r.id}/${t.id} names event ${id}, which the reading does not hold`);
      return stop({
        subject: { type: 'event', id },
        year: e.year,
        place: isPlaced(e.lat, e.lon) ? { lat: e.lat, lon: e.lon } : undefined,
        cite: citeOf(e.passages?.[0]),
      });
    }),
  })));
}

/** The Aion chapters, the book's order. A chapter sets no clock: the chapter walk leaves the time where it is. */
function aionChapters(src) {
  return {
    id: 'aion-chapters',
    kind: 'aion-chapters',
    title: src.aionbook.title,
    source: 'aionbook.json#chapters',
    ordered: 'curated',
    stops: src.aionbook.chapters.map((c) => stop({ subject: { type: 'chapter', id: c.id }, cite: citeOf(c.quotes?.[0]?.cite) })),
  };
}

/** The Red Book folios in the order the book gives them. Each stop is its folio's occurrence: its year, its place. */
function redBook(src) {
  const occ = new Map(src.field.occurrences.map((o) => [o.id, o]));
  return {
    id: 'redbook',
    kind: 'redbook',
    title: 'Liber Novus, folio by folio',
    source: 'redbook.json#stops',
    ordered: 'curated',
    stops: src.redbook.stops.map((s) => {
      const o = occ.get(s.id);
      if (!o) throw new Error(`walks: Red Book folio ${s.id} is not an occurrence in field.json`);
      return stop({
        subject: { type: 'occurrence', id: o.id },
        year: o.year,
        place: isPlaced(o.lat, o.lon) && o.geoPrecision !== 'none' ? { lat: o.lat, lon: o.lon } : undefined,
        cite: citeOf(o.jung?.[0]),
      });
    }),
  };
}

/** The Theory route, in the order the curation walks it (its four movements). Time is not its order, so it sets no clock. */
function theoryRoute(src) {
  return {
    id: 'theory-route',
    kind: 'theory-route',
    title: src.route.title,
    source: 'dynamics-route.json#movements',
    ordered: 'curated',
    stops: src.route.movements.flatMap((m) => m.stops).map((s) => stop({
      subject: s.concept ? { type: 'concept', id: s.concept } : { type: 'route-stop', id: s.id },
      cite: citeOf(s.quotes?.[0]?.cite),
    })),
  };
}

/** The four stages of the opus, in order. */
function alchemyStages(src) {
  return {
    id: 'alchemy-stages',
    kind: 'alchemy-stages',
    title: 'The opus: four stages',
    source: 'alchemy.json#opus.stages',
    ordered: 'curated',
    stops: src.alchemy.opus.stages.map((s) => stop({ subject: { type: 'stage', id: s.id }, cite: citeOf(s.quotes?.[0]?.cite) })),
  };
}

/**
 * A theoretic's members, the way src/data/model.ts gives them: the families it names, and the families of the archetypes
 * it names (an archetype's families are its own plus those that list it). Each family's members are its home and its
 * co-manifests. Returns occurrence indices sorted by year.
 */
function theoreticMembers(field, t) {
  const occ = field.occurrences;
  const famMem = new Map();
  occ.forEach((o, i) => {
    for (const f of new Set([o.familyId, ...(o.coFamilyIds ?? [])])) {
      if (!famMem.has(f)) famMem.set(f, []);
      famMem.get(f).push(i);
    }
  });
  const archFamilies = (id) => {
    const a = field.archetypes.find((x) => x.id === id);
    const fams = new Set(a?.familyIds ?? []);
    for (const f of field.families) if (f.archetypes.some((x) => x.id === id)) fams.add(f.id);
    return fams;
  };
  const set = new Set();
  for (const tie of t.archetypes) for (const f of archFamilies(tie.id)) for (const i of famMem.get(f) ?? []) set.add(i);
  for (const tie of t.families) for (const i of famMem.get(tie.id) ?? []) set.add(i);
  return [...set].sort((a, b) => occ[a].year - occ[b].year || a - b);
}

/** One walk per theoretic: its placed members by year, thinned to THEORETIC_MAX (thread.ts thins a thread the same way). */
function theoreticWalks(src) {
  const occ = src.field.occurrences;
  return src.field.theoretics.map((t) => {
    const placed = theoreticMembers(src.field, t).filter((i) => occ[i].geoPrecision !== 'none' && isPlaced(occ[i].lat, occ[i].lon));
    const picks = thinBuckets(placed, THEORETIC_MAX, (i) => !!occ[i].image);
    return {
      id: `theoretic/${t.id}`,
      kind: 'theoretic',
      title: t.name,
      source: `field.json#theoretics/${t.id}`,
      ordered: 'chronological',
      stops: picks.map((i) => stop({
        subject: { type: 'occurrence', id: occ[i].id },
        year: occ[i].year,
        place: { lat: occ[i].lat, lon: occ[i].lon },
        cite: citeOf(occ[i].jung?.[0]),
      })),
    };
  });
}

/**
 * One page-ordered walk per Work. The Work's cites are placed on its corpus volume the way the works-index places them (a ¶
 * through the volume's paragraph anchors, else `pdf p`); an occurrence that cites the Work more than once stands at the
 * lowest page it cites, and its stop carries the engagement year of that cite where the cite names one. A Work with no
 * placed cite has no walk.
 */
function textWalks(src) {
  const works = loadWorks();
  const { map } = keyMap(works);
  const byWork = new Map();
  for (const o of src.field.occurrences) {
    o.jung?.forEach((c, k) => {
      const id = map.get(c.work);
      if (!id || !works[id].corpus) return;
      const placed = placeCite(volume(works[id].corpus), c.locator ?? '');
      if (!placed) return;
      if (!byWork.has(id)) byWork.set(id, new Map());
      const mine = byWork.get(id);
      const had = mine.get(o.id);
      if (!had || placed.page < had.page) mine.set(o.id, { o, page: placed.page, year: citeYear(c.year) });
    });
  }
  return Object.keys(works).sort().filter((id) => byWork.has(id)).map((id) => {
    const picks = [...byWork.get(id).values()].sort((a, b) => a.page - b.page || (a.o.id < b.o.id ? -1 : a.o.id > b.o.id ? 1 : 0));
    return {
      id: `text/${id}`,
      kind: 'text',
      title: works[id].title,
      source: `works-index.json#works/${id}`,
      ordered: 'page',
      stops: picks.map(({ o, page, year }) => {
        const out = { subject: { type: 'occurrence', id: o.id }, page: { work: id, page }, year: o.year };
        if (year !== null) out.citeYear = year;
        if (o.geoPrecision !== 'none' && isPlaced(o.lat, o.lon)) out.place = { lat: o.lat, lon: o.lon };
        return out;
      }),
    };
  });
}

/** Every walk, from the sources as they stand. */
export function buildWalks(src) {
  corpusWorks = new Set(src.corpus.works.map((w) => w.work));
  citesDropped = 0;
  return [...aionThreads(src), aionChapters(src), redBook(src), theoryRoute(src), alchemyStages(src), ...theoreticWalks(src), ...textWalks(src)];
}

const pad = (s, n) => String(s).padEnd(n);
function report(walks, counts) {
  for (const w of walks) console.log(`${pad(w.id, 42)} ${pad(w.kind, 16)} ${pad(w.ordered, 13)} ${String(counts[w.id] ?? w.stops.length).padStart(4)} stops`);
  const byKind = {};
  for (const w of walks) byKind[w.kind] = (byKind[w.kind] ?? 0) + w.stops.length;
  console.log(`walks: ${walks.length} walks; stops by kind ${JSON.stringify(byKind)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--check')) {
    console.error('Usage: node scripts/walks.mjs [--check]');
    process.exit(1);
  }
  const check = args.includes('--check');
  const src = loadSources();
  const walks = buildWalks(src);
  if (citesDropped) console.log(`walks: ${citesDropped} cite(s) left out: their work has no corpus volume yet (the Red Book, Q9)`);
  const { errors, counts } = verifyWalks(walks, src);
  if (errors.length) {
    console.error(`walks: ${errors.length} error(s)\n${errors.join('\n')}`);
    process.exit(1);
  }
  const text = `${JSON.stringify({ version: 1, walks }, null, 1)}\n`;
  const out = path.join(ROOT, OUT);
  if (check) {
    const published = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
    if (published !== text) {
      console.error(`${OUT} ${published === null ? 'is missing' : 'differs from the sources'}: run npm run walks`);
      process.exit(1);
    }
    report(walks, counts);
    console.log('walks: verified (every stop resolves; chronological walks monotone; curated walks keep their source order; page walks monotone in page)');
  } else {
    fs.writeFileSync(out, text);
    report(walks, counts);
    console.log(`walks: wrote ${OUT}`);
  }
}
