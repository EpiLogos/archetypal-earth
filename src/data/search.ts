// Type-ahead across archetypes, families (+aliases), occurrences, cultures,
// places and periods. Pure: results carry an action, the UI decides how to act.
import type { ImageRef } from '../types/field';
import type { Model, Subject } from './model';
import { formatYear, type TimeScale } from './time';
import { eraShort } from './text';

export type SearchKind = 'archetype' | 'family' | 'occurrence' | 'culture' | 'place' | 'period';

export type SearchAction =
  | { type: 'subject'; subject: Subject }
  | { type: 'occurrence'; occId: string }
  | { type: 'period'; from: number; to: number; year: number };

export interface SearchResult {
  kind: SearchKind;
  key: string;
  label: string;
  sub: string;
  score: number;
  action: SearchAction;
  image?: ImageRef;
  tone?: string;
}

interface Entry {
  kind: SearchKind;
  key: string;
  label: string;
  names: string[]; // normalised primary names (label first)
  aliases: string[]; // normalised
  secondary: string[]; // normalised, weaker
  sub: string;
  action: SearchAction;
  image?: ImageRef;
  tone?: string;
  bias: number;
}

export interface SearchIndex {
  entries: Entry[];
  model: Model;
}

export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BIAS: Record<SearchKind, number> = { archetype: 14, family: 12, period: 9, culture: 6, place: 5, occurrence: 0 };

export function buildSearchIndex(m: Model): SearchIndex {
  const entries: Entry[] = [];
  for (const a of m.field.archetypes) {
    entries.push({
      kind: 'archetype', key: `a:${a.id}`, label: a.name, names: [norm(a.name)], aliases: [], secondary: [norm(a.oneLine)],
      sub: 'archetype', action: { type: 'subject', subject: { type: 'archetype', id: a.id } }, image: a.image, tone: a.palette.core, bias: BIAS.archetype,
    });
  }
  for (const f of m.field.families) {
    entries.push({
      kind: 'family', key: `f:${f.id}`, label: f.name, names: [norm(f.name)], aliases: f.aliases.map(norm).filter(Boolean), secondary: [norm(f.oneLine)],
      sub: 'form', action: { type: 'subject', subject: { type: 'family', id: f.id } }, image: f.image, tone: f.palette.core, bias: BIAS.family,
    });
  }
  for (const c of m.field.cultures) {
    entries.push({
      kind: 'culture', key: `c:${c.id}`, label: c.name, names: [norm(c.name)], aliases: [], secondary: [],
      sub: 'culture', action: { type: 'subject', subject: { type: 'culture', id: c.id } }, bias: BIAS.culture,
    });
  }
  for (const p of m.places.values()) {
    if (p.occ.length < 1) continue;
    entries.push({
      kind: 'place', key: `p:${p.id}`, label: p.name, names: [norm(p.name)], aliases: [], secondary: [],
      sub: 'place', action: { type: 'subject', subject: { type: 'place', id: p.id } }, bias: BIAS.place,
    });
  }
  m.occ.forEach((o, i) => {
    if (!m.located[i]) return;
    const fam = m.famById.get(o.familyId);
    const cultures = o.cultureIds.map((c) => m.cultureById.get(c)?.name ?? '').filter(Boolean);
    entries.push({
      kind: 'occurrence', key: `o:${o.id}`, label: o.label, names: [norm(o.label), norm(o.title)],
      aliases: [], secondary: [norm(o.place ?? ''), ...cultures.map(norm), norm(fam?.name ?? '')],
      sub: eraShort(o.yearDisplay, 22), action: { type: 'occurrence', occId: o.id },
      image: o.image ?? fam?.image, tone: fam?.palette.core, bias: BIAS.occurrence,
    });
  });
  return { entries, model: m };
}

function wordPrefix(text: string, tok: string): boolean {
  return text.startsWith(tok) || text.includes(' ' + tok);
}

/** Score one token against one entry; 0 means no match. */
function scoreToken(e: Entry, tok: string): number {
  let best = 0;
  for (const n of e.names) {
    if (n === tok) best = Math.max(best, 100);
    else if (n.startsWith(tok)) best = Math.max(best, 85);
    else if (wordPrefix(n, tok)) best = Math.max(best, 66);
    else if (tok.length >= 3 && n.includes(tok)) best = Math.max(best, 46);
  }
  for (const n of e.aliases) {
    if (n === tok) best = Math.max(best, 92);
    else if (n.startsWith(tok)) best = Math.max(best, 76);
    else if (wordPrefix(n, tok)) best = Math.max(best, 58);
  }
  if (best < 40) {
    for (const n of e.secondary) {
      if (wordPrefix(n, tok)) best = Math.max(best, 32);
      else if (tok.length >= 4 && n.includes(tok)) best = Math.max(best, 20);
    }
  }
  return best;
}

// ── periods ──────────────────────────────────────────────────────────────

export interface Period {
  label: string;
  from: number;
  to: number;
  year: number;
}

const ERA_ALIASES: Record<string, string> = { medieval: 'Middle Ages', ancient: 'Antiquity', classical: 'Antiquity' };

export function parsePeriod(q: string, scale: TimeScale): Period | null {
  const s = norm(q);
  if (!s) return null;
  // named era (prefix of the name, min 3 letters)
  if (s.length >= 3 && /^[a-z ]+$/.test(s)) {
    const target = ERA_ALIASES[s] ?? undefined;
    for (const e of scale.eras) {
      if ((target && e.name === target) || norm(e.name).startsWith(s)) {
        const to = Math.min(e.to, scale.yearMax);
        return { label: e.name, from: e.from, to, year: to };
      }
    }
    return null;
  }
  const bce = /\b(bce|bc)\b/.test(s);
  // centuries: "13th century", "5th c bce"
  const cent = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s*(?:c|cent|century)\b/);
  if (cent) {
    const n = Number(cent[1]);
    const from = bce ? -n * 100 : (n - 1) * 100;
    const to = bce ? -(n - 1) * 100 : n * 100;
    const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
    return { label: `${n}${suffix} century${bce ? ' BCE' : ''}`, from, to, year: to };
  }
  const num = s.match(/^(\d{1,5})\s*(s|bce|bc|ce|ad)?$/);
  const neg = /^-\s*\d/.test(q.trim());
  if (num) {
    let y = Number(num[1]);
    const unit = num[2];
    if (neg || unit === 'bce' || unit === 'bc') y = -y;
    if (unit === 's') {
      const span = y % 100 === 0 ? 100 : 10;
      return { label: `${y}s`, from: y, to: y + span, year: y + span };
    }
    if (y < scale.yearMin - 500 || y > scale.yearMax + 200) return null;
    return { label: formatYear(y), from: y, to: y, year: y };
  }
  return null;
}

export function search(idx: SearchIndex, query: string, limit = 7): SearchResult[] {
  const q = norm(query);
  const m = idx.model;
  if (!q) {
    // quiet invitation: the archetypes
    return idx.entries.filter((e) => e.kind === 'archetype').slice(0, limit).map((e) => toResult(e, e.bias));
  }
  const toks = q.split(' ');
  const scored: SearchResult[] = [];
  for (const e of idx.entries) {
    let total = 0;
    let ok = true;
    for (const t of toks) {
      const sc = scoreToken(e, t);
      if (!sc) { ok = false; break; }
      total += sc;
    }
    if (!ok) continue;
    scored.push(toResult(e, total / toks.length + e.bias));
  }
  const per = new Map<string, number>();
  const period = parsePeriod(query, m.scale);
  if (period) {
    scored.push({
      kind: 'period', key: `y:${period.label}`, label: period.label,
      sub: period.from === period.to ? 'in time' : `${formatYear(period.from)} – ${formatYear(period.to)}`,
      score: 140, action: { type: 'period', from: period.from, to: period.to, year: period.year },
    });
  }
  scored.sort((a, b) => b.score - a.score || a.label.length - b.label.length);
  const out: SearchResult[] = [];
  const nonOcc = scored.filter((r) => r.kind !== 'occurrence').length;
  for (const r of scored) {
    const n = per.get(r.kind) ?? 0;
    const cap = r.kind === 'occurrence' ? (nonOcc >= 3 ? 3 : 5) : 4;
    if (n >= cap) continue;
    per.set(r.kind, n + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

function toResult(e: Entry, score: number): SearchResult {
  return { kind: e.kind, key: e.key, label: e.label, sub: e.sub, score, action: e.action, image: e.image, tone: e.tone };
}
