// Related: the joins a node takes part in, grouped by the tradition each join belongs to. Pure: read from the model alone,
// so the deep sheet can show it without waiting on the network. The join's own cites live in field-pages.json, elsewhere.
import { joinsOf, subjectName, type Model, type Subject } from '../data/model';
import type { ImageRef, Palette, TieBasis } from '../types/field';

/** The order the systems stand in on the sheet; a system the list does not name goes after them all. */
const SYSTEM_ORDER = ['jung', 'alchemy', 'thoth', 'qabalah', 'astrology', 'burt', 'site', 'other'];

/** The label each system carries on the sheet. */
export const SYSTEM_LABEL: Record<string, string> = {
  jung: 'Jung',
  alchemy: 'Alchemy',
  thoth: 'Thoth tarot',
  qabalah: 'Qabalah',
  astrology: 'Astrology',
  burt: 'Burt',
  site: 'Read here',
  other: 'Also',
};

const BASIS_RANK: Record<TieBasis, number> = { jung: 0, inferred: 1, site: 2 };

export interface RelatedRow {
  other: Subject;
  name: string;
  basis: TieBasis;
  voice?: string;
  note: string;
  joinId: string;
  /** The far node's own plate, when it has one (family / archetype / theoretic); a row without one shows none. */
  image?: ImageRef;
  /** The far node's palette: the tint of its plate before the image loads, or if it fails. */
  palette?: Palette;
}

export interface RelatedGroup {
  system: string;
  rows: RelatedRow[];
}

/** A node's own image and palette: the three node types carry them; a culture or a place has neither. */
export function subjectPlate(m: Model, s: Subject): { image?: ImageRef; palette?: Palette } {
  const node = s.type === 'archetype' ? m.archById.get(s.id) : s.type === 'family' ? m.famById.get(s.id) : s.type === 'theoretic' ? m.theoById.get(s.id) : undefined;
  return node ? { image: node.image, palette: node.palette } : {};
}

const systemRank = (system: string) => {
  const i = SYSTEM_ORDER.indexOf(system);
  return i < 0 ? SYSTEM_ORDER.length : i;
};

/**
 * The joins of a subject, both directions (a join is listed under each of its ends), grouped by system. Groups stand in
 * SYSTEM_ORDER; within a group, Jung's basis before inferred before site, then by name. No joins: an empty list.
 */
export function relatedRows(m: Model, s: Subject): RelatedGroup[] {
  const seen = new Set<string>();
  const groups = new Map<string, RelatedRow[]>();
  for (const { join, other } of joinsOf(m, s)) {
    // a join whose two ends are the same node is listed once
    if (seen.has(join.id)) continue;
    seen.add(join.id);
    const system = join.system ?? 'other';
    const { image, palette } = subjectPlate(m, other);
    const row: RelatedRow = {
      other,
      name: subjectName(m, other),
      basis: join.basis,
      voice: join.voice,
      note: join.note,
      joinId: join.id,
      ...(image ? { image } : {}),
      ...(palette ? { palette } : {}),
    };
    const list = groups.get(system);
    if (list) list.push(row); else groups.set(system, [row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => systemRank(a) - systemRank(b) || a.localeCompare(b))
    .map(([system, rows]) => ({
      system,
      rows: rows.sort((x, y) => BASIS_RANK[x.basis] - BASIS_RANK[y.basis] || x.name.localeCompare(y.name)),
    }));
}

/** The order systems stand in when plates are drawn from a node's joins: the cards' own system first. */
const PLATE_SYSTEM_ORDER = ['thoth', 'alchemy', 'astrology', 'qabalah', 'jung', 'burt', 'site', 'other'];

export interface RelatedPlate {
  other: Subject;
  name: string;
  image: ImageRef;
  palette?: Palette;
  system: string;
}

/**
 * The plates a node with no image of its own is shown by: the plates of the nodes it joins (both directions), at most
 * `limit`. Tarot cards (ids starting `thoth-`) stand first, then the rest; each in system order (thoth, alchemy,
 * astrology, qabalah, then the others), Jung's basis before inferred before site, then by name. A node that appears
 * through several joins, or whose plate is the same file as one already taken (a decan borrows its card's), is taken
 * once. A node with an image of its own, or with fewer than two plates to show, has none: the strip is for the node
 * that would otherwise be text alone.
 */
export function relatedPlates(m: Model, s: Subject, limit = 8): RelatedPlate[] {
  if (limit < 1 || subjectPlate(m, s).image) return [];
  const rank = (system: string) => { const i = PLATE_SYSTEM_ORDER.indexOf(system); return i < 0 ? PLATE_SYSTEM_ORDER.length : i; };
  const found: (RelatedPlate & { card: boolean; basis: TieBasis })[] = [];
  for (const { join, other } of joinsOf(m, s)) {
    if (other.type === s.type && other.id === s.id) continue;
    const { image, palette } = subjectPlate(m, other);
    if (!image?.src) continue;
    found.push({ other, name: subjectName(m, other), image, palette, system: join.system ?? 'other', card: other.id.startsWith('thoth-'), basis: join.basis });
  }
  found.sort((x, y) => Number(y.card) - Number(x.card) || rank(x.system) - rank(y.system) || BASIS_RANK[x.basis] - BASIS_RANK[y.basis] || x.name.localeCompare(y.name));
  const seenSrc = new Set<string>();
  const out: RelatedPlate[] = [];
  for (const { card: _card, basis: _basis, ...p } of found) {
    if (seenSrc.has(p.image.src)) continue;
    seenSrc.add(p.image.src);
    out.push(p);
  }
  return out.length < 2 ? [] : out.slice(0, limit);
}
