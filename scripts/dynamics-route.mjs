// The dynamical lens's route: curation/dynamics-route.json → public/data/dynamics-route.json. Van Eenwyk's terms in four
// movements, each stop naming the native figure that draws it. A concept stop's own quotations stay on the hash-pinned
// rail (public/data/dynamics.json, scripts/dynamics.mjs) and are only referred to here, by id; the further quotations a
// stop carries (Neumann; Van Eenwyk on Neumann) are placed in the read-only corpus by scripts/lib/cite.mjs, and one it
// cannot place fails the build. QL formulations are the published site's words, kept with their section.
//   npm run dynamics-route | npm run dynamics-route:check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VAULT } from './lib/vault.mjs';
import { workLoader } from './lib/cite.mjs';
import { citeQuotes, workTitles } from './lib/quotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

/** The figures src/dynamics/figures.ts draws (kept in step by tests/dynamics/route.test.ts). */
export const FIGURES = ['limit-cycle', 'homoclinic', 'stuck', 'cascade', 'edge', 'lorenz', 'flip', 'pitchfork', 'window', 'focus', 'sync', 'saddle', 'julia', 'mandelbrot', 'landscape', 'torus'];
const QL_SOURCE = /^W § (?:I|II|III|IV|V|VI)$/;
const VOICE = { 'van-eenwyk': 'vaneenwyk', 'neumann-origins': 'neumann', 'neumann-great-mother': 'neumann' };

export function buildRoute({ root = ROOT, vault = DEFAULT_VAULT } = {}) {
  const cur = read('curation', 'dynamics-route.json');
  const concepts = new Map(read('public', 'data', 'dynamics.json').concepts.map((c) => [c.id, c]));
  const field = read('public', 'data', 'field.json');
  const families = new Set(field.families.map((f) => f.id));
  const load = workLoader(vault);
  const titles = workTitles(root);
  const errors = [];
  const warnings = [];
  const seen = new Set();

  const movements = cur.movements.map((mv) => ({
    id: mv.id, n: mv.n, title: mv.title, line: mv.line,
    stops: mv.stops.map((s) => {
      const id = s.concept ?? s.id;
      const where = `${mv.id}/${id}`;
      if (!id) errors.push(`${mv.id}: a stop names a concept or its own id`);
      if (seen.has(id)) errors.push(`${where}: the route visits it twice`);
      seen.add(id);
      if (s.concept && !concepts.has(s.concept)) errors.push(`${where}: no concept ${s.concept} in public/data/dynamics.json`);
      if (!s.concept && (!s.name || !s.familyIds?.length)) errors.push(`${where}: a stop of its own needs a name and its families`);
      if (!FIGURES.includes(s.figure)) errors.push(`${where}: no figure ${s.figure}`);
      if (!s.line) errors.push(`${where}: a stop needs its line`);
      for (const f of s.familyIds ?? []) if (!families.has(f)) errors.push(`${where}: no family ${f} in the field`);
      for (const q of s.ql ?? []) if (!q.text || !QL_SOURCE.test(q.source ?? '')) errors.push(`${where}: a QL formulation needs its text and its section of the published site (W § I–VI)`);
      const quotes = citeQuotes(load, titles, (s.quotes ?? []).map((q) => ({ ...q, voice: VOICE[q.work] })), where, errors, warnings);
      return {
        id, figure: s.figure, line: s.line,
        ...(s.concept ? { concept: s.concept } : { name: s.name, familyIds: s.familyIds }),
        ...(quotes.length ? { quotes } : {}),
        ...(s.ql?.length ? { ql: s.ql } : {}),
      };
    }),
  }));
  for (const c of concepts.keys()) if (!seen.has(c)) errors.push(`concept ${c}: not on the route (every concept the rail ships is walked)`);
  return { data: { version: 1, title: cur.title, line: cur.line, movements }, errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { data, errors, warnings } = buildRoute();
  for (const w of warnings) console.warn(`note: ${w}`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const out = path.join(ROOT, 'public', 'data', 'dynamics-route.json');
  const text = `${JSON.stringify(data, null, 1)}\n`;
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { console.error('public/data/dynamics-route.json differs from what the vault gives now: run npm run dynamics-route'); process.exit(1); }
    console.log('dynamics-route: verified');
  } else {
    fs.writeFileSync(out, text);
    const stops = data.movements.reduce((n, m) => n + m.stops.length, 0);
    console.log(`dynamics-route: ${data.movements.length} movements, ${stops} stops`);
  }
}
