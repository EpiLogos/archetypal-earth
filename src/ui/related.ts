// Related: the joins a node takes part in, grouped by the tradition each join belongs to. Pure: read from the model alone,
// so the deep sheet can show it without waiting on the network. The join's own cites live in field-pages.json, elsewhere.
import { joinsOf, subjectName, type Model, type Subject } from '../data/model';
import type { TieBasis } from '../types/field';

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
}

export interface RelatedGroup {
  system: string;
  rows: RelatedRow[];
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
    const row: RelatedRow = {
      other,
      name: subjectName(m, other),
      basis: join.basis,
      voice: join.voice,
      note: join.note,
      joinId: join.id,
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
