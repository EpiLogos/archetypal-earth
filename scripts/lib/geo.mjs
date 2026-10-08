// Geocoding: place prose -> gazetteer; culture centroids; deterministic jitter.
import fs from 'node:fs';
import path from 'node:path';
import { slugify } from './vault.mjs';

export function normPlace(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function loadGazetteer(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')).places;
  const entries = Object.entries(raw).map(([key, e]) => ({ key, ...e, re: new RegExp(`(?:^| )${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`) }));
  return entries.sort((a, b) => b.key.length - a.key.length || a.key.localeCompare(b.key));
}

const TIER = { place: 0, region: 1 };

/** Best gazetteer hit: precision tier (place > region), then longest key, then earliest. */
export function matchPlace(text, gaz) {
  const n = normPlace(text);
  if (!n) return null;
  let best = null;
  for (const e of gaz) {
    const m = e.re.exec(n);
    if (!m) continue;
    const idx = m.index + (m[0].startsWith(' ') ? 1 : 0);
    const cand = { e, idx, len: e.key.length };
    if (
      !best ||
      TIER[e.precision] < TIER[best.e.precision] ||
      (TIER[e.precision] === TIER[best.e.precision] && (cand.len > best.len || (cand.len === best.len && idx < best.idx)))
    ) best = cand;
  }
  return best ? best.e : null;
}

export function loadCultures(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { aliases: j.aliases || {}, cultures: j.cultures || {} };
}

export function normCultureSlug(raw, aliases) {
  const s = slugify(String(raw).replace(/^[\s'"`]+|[\s'"`]+$/g, ''));
  return aliases[s] || s;
}

/** FNV-1a -> two independent uniform floats in [0,1). */
function hash2(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const next = () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
  next();
  return [next(), next()];
}

/** Deterministic disc jitter of radius `radius` degrees. */
export function jitter(id, lat, lon, radius) {
  const [u, v] = hash2(id);
  const r = radius * Math.sqrt(u);
  const th = 2 * Math.PI * v;
  const dLat = r * Math.sin(th);
  const dLon = (r * Math.cos(th)) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const round = (x) => Math.round(x * 10000) / 10000;
  let la = lat + dLat;
  let lo = lon + dLon;
  la = Math.max(-85, Math.min(85, la));
  if (lo > 180) lo -= 360;
  if (lo < -180) lo += 360;
  return [round(la), round(lo)];
}

export const JIT = { place: 0.08, region: 0.5, culture: 0.6 };
