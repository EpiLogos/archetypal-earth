// The one filter: slices of the field (a book, a culture, an era, a kind of material) are filters, never modes
// (ProjectCentral/docs/MODES-RFC.md §4). Pure: parse, serialise, test an occurrence, and build the engine's mask.
import type { LocusType, Occurrence } from '../types/field';
import type { OccurrenceTags } from '../data/model';

export interface FieldFilter {
  /** Jung volumes the occurrence is cited from (Occurrence.jung[].work) */
  works?: string[];
  cultures?: string[];
  /** inclusive year range on Occurrence.year (negative = BCE) */
  era?: [number, number];
  kinds?: LocusType[];
  /** the archetypes whose material the occurrence is — its own family's ties (Model.tags) */
  archetypes?: string[];
  /** the theoretics whose material the occurrence is — the concept the field reads it under */
  theoretics?: string[];
}

export const NO_FILTER: FieldFilter = {};

const LOCUS: readonly LocusType[] = ['artifact', 'text-passage', 'myth-episode', 'ritual', 'dream', 'vision', 'active-imagination', 'clinical-case', 'historical-event'];

export function isEmpty(f: FieldFilter): boolean {
  return !f.works?.length && !f.cultures?.length && !f.era && !f.kinds?.length && !f.archetypes?.length && !f.theoretics?.length;
}

/**
 * Does the occurrence pass the filter? Every set dimension must hold; within a dimension any value may. The
 * archetype and theoretic dimensions test what governs the occurrence (its family's ties, `Model.tags`): without
 * those tags the question is unanswerable, so a filter naming them passes nothing — never everything.
 */
export function passes(o: Occurrence, f: FieldFilter, tags?: OccurrenceTags): boolean {
  if (f.works?.length && !o.jung.some((c) => f.works!.includes(c.work))) return false;
  if (f.cultures?.length && !o.cultureIds.some((c) => f.cultures!.includes(c))) return false;
  if (f.era && (o.year < f.era[0] || o.year > f.era[1])) return false;
  if (f.kinds?.length && !f.kinds.includes(o.locusType)) return false;
  if (f.archetypes?.length && !(tags?.archetypes ?? []).some((id) => f.archetypes!.includes(id))) return false;
  if (f.theoretics?.length && !(tags?.theoretics ?? []).some((id) => f.theoretics!.includes(id))) return false;
  return true;
}

/**
 * 1 for every occurrence that passes, 0 for the rest; null when nothing is filtered (the engine then draws all).
 * `tags` is the model's per-occurrence governance (Model.tags), index-aligned with `occ`.
 */
export function maskOf(occ: readonly Occurrence[], f: FieldFilter, tags?: readonly OccurrenceTags[]): Float32Array | null {
  if (isEmpty(f)) return null;
  const mask = new Float32Array(occ.length);
  for (let i = 0; i < occ.length; i++) mask[i] = passes(occ[i], f, tags?.[i]) ? 1 : 0;
  return mask;
}

const SLUG = /^[\w.-]+$/;

/** `w=cw12,cw9ii&c=gnostic&e=-200..400&k=dream` — the hash's query part, after `?`. Unknown or malformed parts are dropped. */
export function parseFilter(query: string): FieldFilter {
  const f: FieldFilter = {};
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    let value: string;
    try { value = decodeURIComponent(part.slice(eq + 1)); } catch { continue; }
    const list = value.split(',').map((s) => s.trim()).filter((s) => SLUG.test(s));
    if (key === 'w' && list.length) f.works = [...new Set(list)];
    else if (key === 'c' && list.length) f.cultures = [...new Set(list)];
    else if (key === 'k') {
      const kinds = list.filter((k): k is LocusType => (LOCUS as readonly string[]).includes(k));
      if (kinds.length) f.kinds = [...new Set(kinds)];
    } else if (key === 'a' && list.length) f.archetypes = [...new Set(list)];
    else if (key === 't' && list.length) f.theoretics = [...new Set(list)];
    else if (key === 'e') {
      const m = /^(-?\d+)\.\.(-?\d+)$/.exec(value);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        f.era = a <= b ? [a, b] : [b, a];
      }
    }
  }
  return f;
}

export function filterQuery(f: FieldFilter): string {
  const parts: string[] = [];
  if (f.works?.length) parts.push(`w=${f.works.map(encodeURIComponent).join(',')}`);
  if (f.cultures?.length) parts.push(`c=${f.cultures.map(encodeURIComponent).join(',')}`);
  if (f.era) parts.push(`e=${f.era[0]}..${f.era[1]}`);
  if (f.kinds?.length) parts.push(`k=${f.kinds.join(',')}`);
  if (f.archetypes?.length) parts.push(`a=${f.archetypes.map(encodeURIComponent).join(',')}`);
  if (f.theoretics?.length) parts.push(`t=${f.theoretics.map(encodeURIComponent).join(',')}`);
  return parts.join('&');
}

export function filterEq(a: FieldFilter, b: FieldFilter): boolean {
  return filterQuery(a) === filterQuery(b);
}

/** The era buckets the vault's own instances-by-era map uses; offered as the filter's era choices. */
export const ERAS: { id: string; label: string; range: [number, number] }[] = [
  { id: 'bce', label: 'Before the common era', range: [-40000, -1] },
  { id: 'antiquity', label: '0–499', range: [0, 499] },
  { id: 'medieval', label: '500–1499', range: [500, 1499] },
  { id: 'early-modern', label: '1500–1799', range: [1500, 1799] },
  { id: 'nineteenth', label: '1800–1899', range: [1800, 1899] },
  { id: 'modern', label: '1900 on', range: [1900, 2100] },
];

export const KIND_LABELS: Record<LocusType, string> = {
  artifact: 'Artifacts',
  'text-passage': 'Texts',
  'myth-episode': 'Myths',
  ritual: 'Rituals',
  dream: 'Dreams',
  vision: 'Visions',
  'active-imagination': 'Active imagination',
  'clinical-case': 'Clinical cases',
  'historical-event': 'Historical events',
};

/** Short chip labels for the active filter, each with the filter that removes it. */
export function chips(f: FieldFilter, names: { work(id: string): string; culture(id: string): string; archetype(id: string): string; theoretic(id: string): string }): { label: string; without: FieldFilter }[] {
  const out: { label: string; without: FieldFilter }[] = [];
  for (const w of f.works ?? []) out.push({ label: names.work(w), without: { ...f, works: f.works!.filter((x) => x !== w) } });
  for (const c of f.cultures ?? []) out.push({ label: names.culture(c), without: { ...f, cultures: f.cultures!.filter((x) => x !== c) } });
  if (f.era) {
    const era = ERAS.find((e) => e.range[0] === f.era![0] && e.range[1] === f.era![1]);
    const { era: _e, ...rest } = f;
    out.push({ label: era?.label ?? `${f.era[0]}–${f.era[1]}`, without: rest });
  }
  for (const k of f.kinds ?? []) out.push({ label: KIND_LABELS[k], without: { ...f, kinds: f.kinds!.filter((x) => x !== k) } });
  for (const a of f.archetypes ?? []) out.push({ label: names.archetype(a), without: { ...f, archetypes: f.archetypes!.filter((x) => x !== a) } });
  for (const t of f.theoretics ?? []) out.push({ label: names.theoretic(t), without: { ...f, theoretics: f.theoretics!.filter((x) => x !== t) } });
  return out.map((c) => ({ ...c, without: tidy(c.without) }));
}

function tidy(f: FieldFilter): FieldFilter {
  const out: FieldFilter = {};
  if (f.works?.length) out.works = f.works;
  if (f.cultures?.length) out.cultures = f.cultures;
  if (f.era) out.era = f.era;
  if (f.kinds?.length) out.kinds = f.kinds;
  if (f.archetypes?.length) out.archetypes = f.archetypes;
  if (f.theoretics?.length) out.theoretics = f.theoretics;
  return out;
}
