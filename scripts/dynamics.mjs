// Build public/data/dynamics.json — the dynamical lens's optional concept data — from curation/dynamics.json,
// matching every quotation verbatim against the vault corpus (docs/DYNAMICAL.md §5; the rail of scripts/aion.mjs).
//   npm run dynamics         write public/data/dynamics.json (only when concepts are curated)
//   npm run dynamics:check   verify the curation, every quotation and the published file; write nothing
// With no concepts curated, nothing is written and nothing is deleted: an absent file is the normal state.
// The vault is read-only. JUNG_VAULT can name another vault (the same default as scripts/aion.mjs).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildFromVault, validateCuration } from './lib/dynamics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export { DEFAULT_VAULT } from './lib/vault.mjs';
import { DEFAULT_VAULT } from './lib/vault.mjs';
const CURATION = 'curation/dynamics.json';
const TARGET = 'public/data/dynamics.json';

/**
 * Generate (or, with `check`, verify) the published concept data. Returns { status, message }. Throws, naming each
 * failing concept, on any mismatch.
 */
export function generateDynamics({ root = ROOT, vault = process.env.JUNG_VAULT || DEFAULT_VAULT, check = false } = {}) {
  const curation = JSON.parse(fs.readFileSync(path.join(root, CURATION), 'utf8'));
  const target = path.join(root, TARGET);
  const exists = fs.existsSync(target);
  const shape = validateCuration(curation);
  if (shape.length) throw new Error(shape.join('\n'));
  if (!curation.concepts.length) {
    // --check never passes vacuously: with no concepts there is nothing to verify, and a published file with no curation
    // behind it is a failure, not an absence
    if (check && exists) throw new Error(`${TARGET} exists but ${CURATION} curates no concepts; remove the published file deliberately, or curate the concepts`);
    if (check) return { status: 'none', message: 'no concepts curated: nothing to check' };
    return { status: 'none', message: exists ? `no concepts curated; ${TARGET} is left as it is` : 'no concepts curated; nothing written' };
  }
  const field = JSON.parse(fs.readFileSync(path.join(root, 'public/data/field.json'), 'utf8'));
  const families = new Set(field.families.map((f) => f.id));
  const { data, errors } = buildFromVault(curation, { families, vault });
  if (errors.length) throw new Error(errors.join('\n'));
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (check) {
    const published = exists ? fs.readFileSync(target, 'utf8') : null;
    if (published !== text) throw new Error(`${TARGET} ${published === null ? 'is missing' : 'differs from the curation'}; run npm run dynamics`);
    return { status: 'verified', message: `verified dynamics: ${data.concepts.length} concept(s), every quotation verbatim` };
  }
  fs.writeFileSync(target, text);
  return { status: 'written', message: `wrote ${TARGET}: ${data.concepts.length} concept(s)` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const check = process.argv.includes('--check');
    if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/dynamics.mjs [--check]');
    console.log(generateDynamics({ check }).message);
  } catch (error) {
    console.error(`Dynamics validation failed:\n${error.message}`);
    process.exitCode = 1;
  }
}
