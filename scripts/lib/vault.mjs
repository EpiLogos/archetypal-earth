// Defensive vault reading: frontmatter via YAML with per-field regex fallback.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const DEFAULT_VAULT = '/Users/admin/Documents/books/jung-archetypal-field';

export function splitFrontmatter(raw) {
  const m = raw.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: null, body: raw };
  return { fm: m[1], body: m[2] };
}

/** Remove wikilink syntax from prose: [[a|b]] -> b, [[a]] -> a, [[[a]] -> a. */
export function stripLinks(s) {
  if (s == null) return s;
  return String(s)
    .replace(/\[{2,3}([^\]|]*)\|([^\]]*)\]{2,3}/g, '$2')
    .replace(/\[{2,3}([^\]]*)\]{2,3}/g, '$1')
    .replace(/\[{2,3}/g, '')
    .replace(/\]{2,3}/g, '')
;
}

export function linkTarget(s) {
  if (s == null) return null;
  const m = String(s).match(/\[{1,3}\s*([^\]|]+?)\s*(?:\|[^\]]*)?\]{1,3}/);
  const t = (m ? m[1] : String(s)).trim().replace(/^["']|["']$/g, '');
  return t ? slugify(t) : null;
}

export function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function flat(v) {
  if (Array.isArray(v)) return v.flatMap(flat);
  if (v == null) return [];
  return [v];
}

/** Parse frontmatter text into an object. Whole-document YAML first; on failure, per top-level key. */
export function parseFm(text) {
  if (text == null) return { data: {}, fallback: true, failed: true };
  try {
    const data = YAML.parse(text);
    if (data && typeof data === 'object') return { data, fallback: false };
  } catch { /* fall through */ }
  const blocks = [];
  for (const line of text.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):(.*)$/);
    if (kv) blocks.push({ key: kv[1], lines: [line] });
    else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
  }
  const data = {};
  const badKeys = [];
  for (const b of blocks) {
    const src = b.lines.join('\n');
    try {
      const o = YAML.parse(src);
      data[b.key] = o[b.key];
      continue;
    } catch { /* regex fallback below */ }
    badKeys.push(b.key);
    const first = b.lines[0].replace(/^[^:]+:\s*/, '').trim();
    const rest = b.lines.slice(1).filter((l) => /^\s+-\s+/.test(l)).map((l) => l.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, ''));
    if (rest.length) data[b.key] = rest;
    else if (first.startsWith('[') && first.endsWith(']') && !first.startsWith('[[')) {
      data[b.key] = (first.slice(1, -1).match(/"[^"]*"|'[^']*'|[^,]+/g) || []).map((x) => x.trim().replace(/^["']|["']$/g, ''));
    } else data[b.key] = first.replace(/^["']|["']$/g, '');
  }
  return { data, fallback: true, badKeys, failed: Object.keys(data).length === 0 };
}

export function asList(v) {
  return flat(v).map((x) => (typeof x === 'string' ? x : String(x))).filter(Boolean);
}

export function readNotes(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const { fm, body } = splitFrontmatter(raw);
    const p = parseFm(fm);
    return { slug: f.replace(/\.md$/, ''), file: f, data: p.data, fallback: p.fallback, failed: !!p.failed, body };
  });
}

/** All wikilink targets (as slugs) found in a frontmatter value (handles unquoted/nested/triple-bracket forms). */
export function linkTargets(v) {
  const out = [];
  for (const s of asList(v)) {
    const found = [...String(s).matchAll(/\[{1,3}\s*([^\]|\[]+?)\s*(?:\|[^\]]*)?\]{1,3}/g)].map((m) => slugify(m[1]));
    if (found.length) out.push(...found);
    else for (const piece of String(s).split(',')) { const t = slugify(piece); if (t) out.push(t); }
  }
  return [...new Set(out.filter(Boolean))];
}
