#!/usr/bin/env node
// Publishes the Works to the app: curation/works.json (the registry) + curation/work-chapters.json + the cites in
// public/data/field.json  ->  public/data/works.json.
//
// Why a file of its own and not a block in field.json: the Field is rebuilt by the ingest from the vault, the Works are
// curated and derived from the Field's cites; a separate small file loads in parallel with it, can be rebuilt without
// touching the 12 MB Field, and leaves field.json (and its consumers and fixtures) exactly as they are.
//
// A Work is a record; its relations are never typed in. Every cite in the Field names its text by a key (`cite.work`); the
// registry folds the aliases (redbook -> liber-novus), so a cite keeps its key and is read through the registry. The weights
// are cite counts: a cite adds one to the Work's tie with the family of the occurrence it stands on, with each archetype
// that family is tied to, and with each theoretic whose material that family is (the rule src/data/model.ts keeps).
//
//   node scripts/works-publish.mjs          write public/data/works.json
//   node scripts/works-publish.mjs --check  fail when the file is stale or a tie does not follow from the cites
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const OUT = path.join(DATA, 'works.json');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const serialise = (o) => `${JSON.stringify(o, null, 1)}\n`;

const byWeight = (m) => [...m].map(([id, weight]) => ({ id, weight })).sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1));

/** Which theoretics stand for a family's material: the families they name, and the families of the archetypes they name. */
export function theoreticsOfFamilies(field) {
  const archById = new Map(field.archetypes.map((a) => [a.id, a]));
  const byFam = new Map(field.families.map((f) => [f.id, []]));
  for (const t of field.theoretics ?? []) {
    const fams = new Set([...t.families.map((x) => x.id), ...t.archetypes.flatMap((x) => archById.get(x.id)?.familyIds ?? [])]);
    for (const fid of fams) byFam.get(fid)?.push(t.id);
  }
  return byFam;
}

export function buildWorks({ works, chapters, field }) {
  const key = new Map();
  for (const [id, w] of Object.entries(works)) for (const k of [id, ...(w.aliases ?? [])]) key.set(k, id);
  const famArch = new Map(field.families.map((f) => [f.id, (f.archetypes ?? []).map((t) => t.id)]));
  const famTheo = theoreticsOfFamilies(field);
  const acc = new Map(Object.keys(works).map((id) => [id, { cites: 0, occ: new Set(), arch: new Map(), theo: new Map(), fam: new Map() }]));
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const o of field.occurrences) {
    for (const c of o.jung ?? []) {
      const id = key.get(c.work);
      if (!id) throw new Error(`cite key "${c.work}" on ${o.id} resolves to no Work (curation/works.json)`);
      const a = acc.get(id);
      a.cites += 1;
      a.occ.add(o.id);
      bump(a.fam, o.familyId);
      for (const x of famArch.get(o.familyId) ?? []) bump(a.arch, x);
      for (const x of famTheo.get(o.familyId) ?? []) bump(a.theo, x);
    }
  }
  const out = [];
  for (const [id, w] of Object.entries(works)) {
    const a = acc.get(id);
    const ch = chapters[id];
    out.push({
      id,
      title: w.title,
      kind: w.kind,
      author: w.author,
      ...(w.with ? { with: w.with } : {}),
      ...(w.editor ? { editor: w.editor } : {}),
      voice: w.voice ?? 'Jung',
      ...(w.year !== undefined ? { year: w.year, display: w.display ?? String(w.year) } : {}),
      aliases: w.aliases ?? [],
      ...(w.corpus ? { corpus: id } : {}),
      ...(w.lens ? { lens: w.lens } : {}),
      chapters: (ch?.chapters ?? []).map((c) => ({ title: c.title, page: c.page, level: c.level ?? 1 })),
      chaptersDerived: ch ? ch.derived === true : false,
      cites: a.cites,
      occurrences: a.occ.size,
      ties: { archetypes: byWeight(a.arch), theoretics: byWeight(a.theo), families: byWeight(a.fam) },
    });
  }
  out.sort((x, y) => (x.id < y.id ? -1 : 1));
  return { schema: 1, source: 'curation/works.json + public/data/field.json', works: out };
}

export function load() {
  return {
    works: readJson(path.join(ROOT, 'curation', 'works.json')).works,
    chapters: readJson(path.join(ROOT, 'curation', 'work-chapters.json')).works,
    field: readJson(path.join(DATA, 'field.json')),
  };
}

function main() {
  const built = buildWorks(load());
  const text = serialise(built);
  const cites = built.works.reduce((n, w) => n + w.cites, 0);
  if (process.argv.includes('--check')) {
    const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (onDisk !== text) { console.error('public/data/works.json is stale: run node scripts/works-publish.mjs'); process.exit(1); }
    console.log(`works-publish: ok (${built.works.length} works, ${cites} cites)`);
    return;
  }
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${built.works.length} works, ${cites} cites`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
