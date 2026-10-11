#!/usr/bin/env node
// Fold every public/data/images-ext*.json into public/data/images.json (or --out <file>).
// Main wins: an id already in the target is reported and kept, never overwritten. Among ext
// files the first in name order wins a clash, and the clash is reported. The ext files stay in
// place; the ingest merges them too, main first, so the result is the same either way.
// Usage: node scripts/images-merge-ext.mjs [--dry] [--out <file>] [--force]
//   --dry    count only, write nothing
//   --out    the file to write (default: the live public/data/images.json)
//   --force  write to the live file even while scripts/images.mjs is running
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const LIVE = path.join(DATA, 'images.json');
const GROUPS = ['archetypes', 'families', 'theoretics', 'occurrences'];

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const force = args.includes('--force');
const outArg = (() => { const i = args.indexOf('--out'); return i >= 0 ? args[i + 1] : null; })();
if (args.includes('--out') && !outArg) { console.error('--out needs a file'); process.exit(2); }
const target = outArg ? path.resolve(outArg) : LIVE;
const onLive = target === LIVE;
const show = (p) => (p.startsWith(ROOT + path.sep) ? path.relative(ROOT, p) : p);

// The live file is the batch's output too: refuse to write it while the fetcher runs.
function runningFetchers() {
  const r = spawnSync('pgrep', ['-f', 'scripts/images\\.mjs'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).map(Number).filter((pid) => pid !== process.pid);
}
if (onLive && !dry && !force) {
  const pids = runningFetchers();
  if (pids.length) {
    console.error(`refused: scripts/images.mjs is running (pid ${pids.join(', ')}). It rewrites ${show(LIVE)}; merge after it finishes, or pass --force.`);
    process.exit(1);
  }
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const main = fs.existsSync(target) ? readJson(target) : {};
const exts = fs.readdirSync(DATA).filter((f) => /^images-ext[\w-]*\.json$/.test(f)).sort();

const isRef = (r) => r && typeof r === 'object' && typeof r.src === 'string' && typeof r.thumb === 'string';
const counts = { added: {}, alreadyInMain: {}, clashBetweenExt: {}, malformed: {} };
const reportIds = { alreadyInMain: [], clashBetweenExt: [] };
const bump = (k, g) => { counts[k][g] = (counts[k][g] || 0) + 1; };
const merged = { ...main };
for (const g of GROUPS) merged[g] = { ...(main[g] || {}) };
const fromExt = {}; // group -> id -> file that supplied it

for (const f of exts) {
  const ext = readJson(path.join(DATA, f));
  for (const g of GROUPS) {
    for (const [id, ref] of Object.entries(ext[g] || {})) {
      if (!isRef(ref)) { bump('malformed', g); continue; }
      if (Object.prototype.hasOwnProperty.call(main[g] || {}, id)) {
        bump('alreadyInMain', g);
        reportIds.alreadyInMain.push(`${g}/${id}`);
        continue;
      }
      if (fromExt[g]?.[id]) {
        bump('clashBetweenExt', g);
        reportIds.clashBetweenExt.push(`${g}/${id} (${fromExt[g][id]} wins over ${f})`);
        continue;
      }
      (fromExt[g] ||= {})[id] = f;
      merged[g][id] = ref;
      bump('added', g);
    }
  }
}

const total = (obj) => GROUPS.reduce((n, g) => n + Object.keys(obj[g] || {}).length, 0);
const sum = (m) => Object.values(m).reduce((a, b) => a + b, 0);
const perGroup = (m) => GROUPS.map((g) => `${g} ${m[g] || 0}`).join(', ');

console.log(`target: ${show(target)}${onLive ? ' (live)' : ''}${dry ? ' [dry run]' : ''}`);
console.log(`ext files: ${exts.length ? exts.join(', ') : 'none'}`);
console.log(`main before: ${total(main)} entries`);
console.log(`added: ${sum(counts.added)} (${perGroup(counts.added)})`);
console.log(`already in main, kept as is: ${sum(counts.alreadyInMain)} (${perGroup(counts.alreadyInMain)})`);
if (reportIds.alreadyInMain.length) console.log(`  ids: ${reportIds.alreadyInMain.slice(0, 40).join(' ')}${reportIds.alreadyInMain.length > 40 ? ` … +${reportIds.alreadyInMain.length - 40}` : ''}`);
console.log(`clash between ext files, first in name order kept: ${sum(counts.clashBetweenExt)}`);
if (reportIds.clashBetweenExt.length) console.log(`  ${reportIds.clashBetweenExt.slice(0, 20).join('\n  ')}`);
if (sum(counts.malformed)) console.log(`malformed (no src/thumb), skipped: ${sum(counts.malformed)} (${perGroup(counts.malformed)})`);
console.log(`main after: ${total(merged)} entries (${perGroup(Object.fromEntries(GROUPS.map((g) => [g, Object.keys(merged[g] || {}).length])))})`);

if (dry) { console.log('dry run: nothing written'); process.exit(0); }
if (!sum(counts.added)) { console.log('nothing to add; target left as it is'); process.exit(0); }

// atomic: write a temp file beside the target, then rename over it
const tmp = `${target}.merge-${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(merged, null, 1) + '\n');
fs.renameSync(tmp, target);
console.log(`written: ${show(target)}`);
