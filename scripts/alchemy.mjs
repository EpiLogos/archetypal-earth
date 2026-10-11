// The Alchemy lens's data: curation/alchemy.json → public/data/alchemy.json (ProjectCentral/docs/ELEMENTS-ALCHEMY-SKY-TAROT-PLAN.md,
// track B). The opus as an ordered walk of its stages, the operations and the matter they work on, and the elements the
// work draws on. Every quotation is placed in the read-only corpus by scripts/lib/cite.mjs, exactly as the Theory
// generator places its own; one it cannot place exactly once fails the build. Every family, archetype and theoretic a
// page names must stand in the field, and every operation a stage names must stand in the operations list.
//   npm run alchemy          regenerate
//   npm run alchemy:check    verify the published file matches what the vault gives now
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUBJECT_TYPES = ['family', 'archetype', 'theoretic'];

/** Build the published lens data. Returns { data, errors, warnings }; data is null when the curation cannot be published. */
export function buildAlchemy({ root = ROOT, vault = DEFAULT_VAULT } = {}) {
  const errors = [];
  const warnings = [];
  const curationFile = path.join(root, 'curation', 'alchemy.json');
  const fieldFile = path.join(root, 'public', 'data', 'field.json');
  if (!fs.existsSync(curationFile)) return { data: null, errors: [`curation/alchemy.json is missing: the Alchemy lens has nothing to publish until it is curated`], warnings };
  if (!fs.existsSync(fieldFile)) return { data: null, errors: [`public/data/field.json is missing: run npm run ingest first, then npm run alchemy`], warnings };
  const cur = JSON.parse(fs.readFileSync(curationFile, 'utf8'));
  const field = JSON.parse(fs.readFileSync(fieldFile, 'utf8'));
  const load = workLoader(vault);
  const titles = workTitles(root);

  const known = {
    family: new Set(field.families.map((f) => f.id)),
    archetype: new Set(field.archetypes.map((a) => a.id)),
    theoretic: new Set((field.theoretics ?? []).map((t) => t.id)),
  };
  const need = (value, what, where) => { if (typeof value !== 'string' || !value.trim()) errors.push(`${where}: ${what} is missing`); };
  const unique = (list, what) => {
    const seen = new Set();
    for (const x of list) { if (seen.has(x.id)) errors.push(`${what} ${x.id} is named twice`); seen.add(x.id); }
    return seen;
  };
  const subjects = (list, where) => (list ?? []).map((l) => {
    if (!SUBJECT_TYPES.includes(l.type)) errors.push(`${where}: a subject of type ${l.type} is not a family, archetype or theoretic`);
    else if (!known[l.type].has(l.id)) errors.push(`${where}: no ${l.type} ${l.id} in the field`);
    return { type: l.type, id: l.id };
  });
  const quotes = (qs, where) => citeQuotes(load, titles, qs ?? [], where, errors, warnings);

  const opus = cur.opus ?? {};
  const stages = opus.stages ?? [];
  const operations = cur.operations ?? [];
  const matter = cur.matter ?? [];
  need(cur.line, 'the lens line', 'curation');
  need(opus.line, 'the opus line', 'opus');
  const stageIds = unique(stages, 'stage');
  const opIds = unique(operations, 'operation');
  unique(matter, 'matter');

  const placedStages = stages.map((s) => {
    const where = `stage ${s.id}`;
    need(s.name, 'name', where); need(s.colour, 'colour', where); need(s.line, 'line', where);
    if (!known.family.has(s.family)) errors.push(`${where}: no family ${s.family} in the field`);
    if (!s.psyche?.line) errors.push(`${where}: the psychological reading has no line`);
    for (const op of s.operations ?? []) if (!opIds.has(op)) errors.push(`${where}: no operation ${op} in the operations list`);
    return {
      id: s.id, family: s.family, name: s.name, colour: s.colour, line: s.line,
      quotes: quotes(s.quotes, where),
      psyche: { line: s.psyche?.line ?? '', quotes: quotes(s.psyche?.quotes, `${where} psyche`) },
      operations: [...(s.operations ?? [])],
      subjects: subjects(s.subjects, where),
    };
  });

  const placedOps = operations.map((o) => {
    const where = `operation ${o.id}`;
    need(o.name, 'name', where); need(o.line, 'line', where);
    if (o.stage !== undefined && !stageIds.has(o.stage)) errors.push(`${where}: no stage ${o.stage} in the opus`);
    return {
      id: o.id, name: o.name, line: o.line, quotes: quotes(o.quotes, where),
      ...(o.stage !== undefined ? { stage: o.stage } : {}),
      subjects: subjects(o.subjects, where),
    };
  });

  const placedMatter = matter.map((m) => {
    const where = `matter ${m.id}`;
    need(m.name, 'name', where); need(m.line, 'line', where);
    return { id: m.id, name: m.name, line: m.line, quotes: quotes(m.quotes, where), subjects: subjects(m.subjects, where) };
  });

  const elements = cur.elements ?? {};
  need(elements.line, 'the elements line', 'elements');
  const data = {
    version: 1,
    line: cur.line,
    opus: {
      line: opus.line,
      stages: placedStages,
      bridge: { line: opus.bridge?.line ?? '', quotes: quotes(opus.bridge?.quotes, 'bridge') },
    },
    operations: placedOps,
    matter: placedMatter,
    elements: { line: elements.line ?? '', quotes: quotes(elements.quotes, 'elements'), subjects: subjects(elements.subjects, 'elements') },
  };
  return { data, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { data, errors, warnings } = buildAlchemy();
  for (const w of warnings) console.warn(`note: ${w}`);
  if (errors.length || !data) { console.error(errors.join('\n')); process.exit(1); }
  const out = path.join(ROOT, 'public', 'data', 'alchemy.json');
  const text = `${JSON.stringify(data, null, 1)}\n`;
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { console.error('public/data/alchemy.json differs from what the vault gives now: run npm run alchemy'); process.exit(1); }
    console.log('alchemy: verified');
  } else {
    fs.writeFileSync(out, text);
    const n = [...data.opus.stages.flatMap((s) => [...s.quotes, ...s.psyche.quotes]), ...data.opus.bridge.quotes,
      ...data.operations.flatMap((o) => o.quotes), ...data.matter.flatMap((m) => m.quotes), ...data.elements.quotes].length;
    console.log(`alchemy: ${data.opus.stages.length} stages, ${data.operations.length} operations, ${data.matter.length} matter, ${n} quotations placed`);
  }
}
