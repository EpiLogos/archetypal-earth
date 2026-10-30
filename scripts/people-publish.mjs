#!/usr/bin/env node
// Publishes the People to the app: curation/people.json (the records, each field sourced or blank with a reason) + the Works
// registry (curation/works.json) + the occurrences of public/data/field.json  ->  public/data/people.json.
//
// A Person is a record; what is read off other files is never typed into it:
//   works  the Works whose `author`, `with` or `editor` names him, by his id exactly; a slug that is no person's id is an
//          author with no record here.
//   own    how many occurrences carry his own `subject` (82 for Jung).
//   natal  where a birth is given, the placements src/astro/natal.ts computes for it (the same natalChart the Astrology
//          lens runs; offset "mean-time" is the place's local mean time, as in src/astro/charts.ts). Computed at build, so a
//          person page can show the sky at his birth without loading the ephemeris.
//
//   node scripts/people-publish.mjs          write public/data/people.json
//   node scripts/people-publish.mjs --check  fail when the file is stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { meanTimeOffset, natalChart } from '../src/astro/natal.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const OUT = path.join(DATA, 'people.json');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const serialise = (o) => `${JSON.stringify(o, null, 1)}\n`;

export function birthData(b) {
  const offsetMinutes = b.offset === 'mean-time' ? meanTimeOffset(b.lon) : b.offset;
  return { date: b.date, time: b.time, offsetMinutes, lat: b.lat, lon: b.lon, place: b.place };
}

export function buildPeople({ people, works, field }) {
  const ids = Object.keys(people);
  const authored = new Map(ids.map((id) => [id, new Set()]));
  for (const [wid, w] of Object.entries(works)) {
    for (const slug of [w.author, w.with, w.editor]) {
      if (!slug) continue;
      // a Work names its author by a person id exactly; a slug with no record here is an author with no person (freud, corrie)
      if (authored.has(slug)) authored.get(slug).add(wid);
    }
  }
  const own = new Map();
  for (const o of field.occurrences) own.set(o.subject, (own.get(o.subject) ?? 0) + 1);
  const out = [];
  for (const [key, p] of Object.entries(people)) {
    if (p.id !== key) throw new Error(`${key}: id ${p.id} does not match its key`);
    out.push({
      id: p.id,
      name: p.name,
      born: p.born,
      died: p.died,
      role: p.role,
      portrait: p.portrait,
      ...(p.subjectKey ? { subjectKey: p.subjectKey } : {}),
      ...(p.birth ? { birth: p.birth } : {}),
      works: [...authored.get(key)].sort(),
      own: p.subjectKey ? (own.get(p.subjectKey) ?? 0) : 0,
      ...(p.birth ? { natal: JSON.parse(JSON.stringify(natalChart(birthData(p.birth)))) } : {}),
      sources: p.sources ?? {},
      reasons: p.reasons ?? {},
    });
  }
  return { schema: 1, source: 'curation/people.json + curation/works.json + public/data/field.json', people: out };
}

export function load() {
  return {
    people: readJson(path.join(ROOT, 'curation', 'people.json')).people,
    works: readJson(path.join(ROOT, 'curation', 'works.json')).works,
    field: readJson(path.join(DATA, 'field.json')),
  };
}

function main() {
  const built = buildPeople(load());
  const text = serialise(built);
  const nWorks = built.people.reduce((n, p) => n + p.works.length, 0);
  if (process.argv.includes('--check')) {
    const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (onDisk !== text) { console.error('public/data/people.json is stale: run node scripts/people-publish.mjs'); process.exit(1); }
    console.log(`people-publish: ok (${built.people.length} people, ${nWorks} works)`);
    return;
  }
  fs.writeFileSync(OUT, text);
  console.log(`people-publish: wrote ${path.relative(ROOT, OUT)} (${built.people.length} people, ${nWorks} works, ${(text.length / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
