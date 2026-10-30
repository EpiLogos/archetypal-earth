// The lens contract (S1): one object per lens that says, in one place, what the lens stands on. Its set of presences, the filter
// dimensions that vary inside the set, the marks it puts on the time strip, its ordered stops, the plates it shows, the groups of
// its Contents, and the record it writes when the visitor engages with it. The lenses used to state these inline (each tuned the
// globe on its own); the controller, the strip, the filter and the Contents all read this instead. `scopeOf` stays the primitive:
// the contract names the own set, `scopeOf` ranks the field around it.
//
// Pure: the Model and the lens data files in, plain objects out. Nothing here draws, loads or writes (`engage` takes the store).
import { subjectMembers, type Model, type Subject } from '../data/model';
import { workLens } from '../data/texts';
import type { PlateSubject } from '../data/plates';
import { ERAS, PERSON_SUBJECTS, SKY_RINGS, type FieldFilter, type PersonSubject, type SkyRing } from '../shell/filter';
import type { LensId } from '../shell/lens';
import type { EngagementKind, PracticeStore } from '../practice/store';
import type { History } from '../types/history';
import type { RedBook } from '../types/redbook';
import type { Symbols } from '../types/symbols';
import type { Walk, WalkKind } from '../types/walks';

/** The sets of occurrences a lens stands on are read from the lens's own data file, which the lens loads on first use. */
export interface LensData {
  /** Theory: the dynamical concepts and the families each is bound to (public/data/dynamics.json) */
  dynamics?: { concepts: { id: string; name: string; familyIds: string[] }[] };
  /** Aion: the readings with their epochs and events (public/data/history.json) */
  history?: Pick<History, 'readings'>;
  redbook?: Pick<RedBook, 'stops' | 'sections'>;
  /** Alchemy: every subject a stage, operation, matter or the elements names (public/data/alchemy.json) */
  alchemy?: {
    opus: { stages: { id: string; name: string; subjects: Subject[] }[] };
    operations: { id: string; name: string; subjects: Subject[] }[];
    matter: { id: string; name: string; subjects: Subject[] }[];
    elements: { subjects: Subject[] };
  };
  symbols?: Pick<Symbols, 'entries'>;
}

/** The dimensions of the field filter (`FieldFilter`): the six of the field, and the two facets of whose and where in the sky. */
export type FilterDimension = keyof FieldFilter;
export const DIMENSIONS: readonly FilterDimension[] = ['works', 'cultures', 'era', 'kinds', 'archetypes', 'theoretics', 'subjects', 'rings'];

/** A mark a lens puts on the time strip: a band over a span (an epoch) or a tick at a year (an event, a folio). */
export interface TimeMark {
  kind: 'band' | 'tick';
  id: string;
  label: string;
  from: number;
  to: number;
  /** the occurrence a tick stands for, when it stands for one (a folio): the filter can then say it is out */
  occ?: number;
}

/** One stop of a lens's ordered walk: the walk's own record, and the stop's index in it. */
export interface ContractStop {
  walk: string;
  i: number;
  kind: WalkKind;
}

/** A group of the Contents: a heading and the items under it, each an id the lens opens. */
export interface ContentsGroup {
  id: string;
  title: string;
  items: { id: string; title: string }[];
}

export interface LensContract {
  id: LensId;
  /** the occurrences the lens stands on (indices into `Model.occ`), placed or not, in index order */
  set: number[];
  /** how many of the set stand on the Earth */
  placed: number;
  /**
   * What the filter and the strip count over: the set, where the lens has one. Astrology reads the occurrences that hang in
   * the sky; Dreams and Coincidences match the visitor's own material against the whole field, so they slice all of it.
   */
  slice: number[];
  /** how many of the slice stand on the Earth: what the count under the filter says */
  slicePlaced: number;
  /** the filter dimensions that take more than one value inside the slice; a dimension that cannot vary there is not offered */
  dimensions: FilterDimension[];
  /** the values of the two facets that the slice holds, so only those are offered as pills */
  facets: { subjects: PersonSubject[]; rings: SkyRing[] };
  /** what the lens writes on the strip; empty where it writes none */
  marks: TimeMark[];
  /** the lens's ordered stops, across its walks, in the walks' own order */
  stops: ContractStop[];
  /** the subjects whose plates the lens shows, for `plates()` */
  plates: PlateSubject[];
  groups: ContentsGroup[];
  /** the record the lens writes when the visitor engages with its subject */
  engages: EngagementKind;
}

/** The lenses that have a contract: the nine of the menu. A Work's page is the Texts lens (`textsContract`). */
export const CONTRACT_LENSES: readonly LensId[] = ['field', 'theory', 'alchemy', 'aion', 'redbook', 'astrology', 'dreams', 'symbols', 'coincidences'];

const sorted = (s: Iterable<number>): number[] => [...s].sort((a, b) => a - b);

function walksOf(m: Model, kind: WalkKind): Walk[] {
  return [...m.walkById.values()].filter((w) => w.kind === kind);
}

const stopsOf = (walks: Walk[]): ContractStop[] => walks.flatMap((w) => w.stops.map((_, i) => ({ walk: w.id, i, kind: w.kind })));

/** The own set of a lens, derived the way the lens derives it. */
export function setOf(id: LensId, m: Model, d: LensData): number[] {
  const out = new Set<number>();
  switch (id) {
    case 'field':
      for (let i = 0; i < m.occ.length; i++) out.add(i);
      break;
    case 'theory':
      for (const c of d.dynamics?.concepts ?? []) for (const f of c.familyIds) for (const i of m.famOcc.get(f) ?? []) out.add(i);
      break;
    case 'aion':
      for (const r of d.history?.readings ?? []) {
        for (const e of r.events) {
          for (const oid of e.occurrenceIds) { const i = m.occIndex.get(oid); if (i !== undefined) out.add(i); }
          for (const f of e.familyIds) for (const i of m.famOcc.get(f) ?? []) out.add(i);
        }
      }
      break;
    case 'redbook':
      for (const s of d.redbook?.stops ?? []) { const i = m.occIndex.get(s.id); if (i !== undefined) out.add(i); }
      break;
    case 'alchemy': {
      const a = d.alchemy;
      const subjects = a ? [...a.operations.flatMap((o) => o.subjects), ...a.matter.flatMap((x) => x.subjects), ...a.elements.subjects] : [];
      for (const s of subjects) for (const i of subjectMembers(m, s)) out.add(i);
      break;
    }
    case 'symbols':
      for (const e of d.symbols?.entries ?? []) for (const i of m.famOcc.get(e.familyId) ?? []) out.add(i);
      break;
    // Astrology stands on the sky, which has no globe scope; Dreams and Coincidences stand on what the visitor has written,
    // which the field does not hold: their set is empty until a lens narrows the globe to a subject of the visitor's own
    case 'astrology':
    case 'dreams':
    case 'coincidences':
    default:
      break;
  }
  return sorted(out);
}

/** The dimensions that take more than one value inside a set. The era dimension counts the era chips, not the years. */
export function dimensionsOf(m: Model, set: readonly number[]): FilterDimension[] {
  if (!set.length) return [];
  const distinct = (vals: (i: number) => Iterable<string>) => {
    const seen = new Set<string>();
    for (const i of set) { for (const v of vals(i)) seen.add(v); if (seen.size > 1) return true; }
    return false;
  };
  const eraOf = (y: number) => ERAS.find((e) => y >= e.range[0] && y <= e.range[1])?.id ?? 'none';
  const out: FilterDimension[] = [];
  if (distinct((i) => m.occ[i].jung.map((c) => m.workKey.get(c.work) ?? c.work))) out.push('works');
  if (distinct((i) => m.occ[i].cultureIds)) out.push('cultures');
  if (distinct((i) => [eraOf(m.occ[i].year)])) out.push('era');
  if (distinct((i) => [m.occ[i].locusType])) out.push('kinds');
  if (distinct((i) => m.tags[i].archetypes)) out.push('archetypes');
  if (distinct((i) => m.tags[i].theoretics)) out.push('theoretics');
  // the two facets: a value of `none` (no one's experience, no sky place) counts, so a lens holding some of each can slice
  if (distinct((i) => [m.occ[i].subject])) out.push('subjects');
  if (distinct((i) => { const r = (m.occ[i].sky ?? []).map((l) => l.ring); return r.length ? r : ['none']; })) out.push('rings');
  return out;
}

/** The values of the two facets that occur inside a set, in the order the filter names them. */
export function facetsOf(m: Model, set: readonly number[]): LensContract['facets'] {
  const subjects = new Set<string>();
  const rings = new Set<string>();
  for (const i of set) {
    subjects.add(m.occ[i].subject);
    for (const l of m.occ[i].sky ?? []) rings.add(l.ring);
  }
  return { subjects: PERSON_SUBJECTS.filter((x) => subjects.has(x)), rings: SKY_RINGS.filter((x) => rings.has(x)) };
}

/** The occurrences the filter and the strip count over for a lens (see `LensContract.slice`). */
export function sliceOf(id: LensId, m: Model, set: number[]): number[] {
  if (set.length) return set;
  if (id === 'astrology') return m.occ.flatMap((o, i) => ((o.sky?.length ?? 0) > 0 ? [i] : []));
  if (id === 'dreams' || id === 'coincidences') return m.occ.map((_, i) => i);
  return set;
}

function marksOf(id: LensId, m: Model, d: LensData): TimeMark[] {
  if (id === 'aion') {
    const out: TimeMark[] = [];
    for (const r of d.history?.readings ?? []) {
      for (const e of r.epochs) out.push({ kind: 'band', id: `${r.id}/${e.id}`, label: e.name, from: e.from, to: e.to });
      for (const e of r.events) out.push({ kind: 'tick', id: `${r.id}/${e.id}`, label: e.name, from: e.year, to: e.year });
    }
    return out;
  }
  if (id === 'redbook') {
    const out: TimeMark[] = [];
    for (const s of d.redbook?.stops ?? []) {
      const i = m.occIndex.get(s.id);
      if (i !== undefined) out.push({ kind: 'tick', id: s.id, label: m.occ[i].label, from: m.occ[i].year, to: m.occ[i].year, occ: i });
    }
    return out;
  }
  return [];
}

const WALK_KIND: Partial<Record<LensId, WalkKind[]>> = {
  aion: ['aion-chapters', 'aion-thread'],
  redbook: ['redbook'],
  theory: ['theory-route'],
  alchemy: ['alchemy-stages'],
};

function platesOf(id: LensId, d: LensData): PlateSubject[] {
  switch (id) {
    case 'field': return [];
    case 'theory': return (d.dynamics?.concepts ?? []).flatMap((c) => c.familyIds.slice(0, 1)).map((f) => ({ type: 'family', id: f }));
    case 'aion': return (d.history?.readings ?? []).flatMap((r) => r.events.map((e) => ({ type: 'event' as const, id: e.id, reading: r.id })));
    case 'redbook': return (d.redbook?.stops ?? []).map((s) => ({ type: 'stop', id: s.id }));
    case 'alchemy': return (d.alchemy?.opus.stages ?? []).map((s) => ({ type: 'stage', id: s.id }));
    case 'symbols': return (d.symbols?.entries ?? []).map((e) => ({ type: 'family', id: e.familyId }));
    default: return [];
  }
}

function groupsOf(id: LensId, m: Model, d: LensData): ContentsGroup[] {
  switch (id) {
    case 'theory':
      return [{ id: 'concepts', title: 'Concepts', items: (d.dynamics?.concepts ?? []).map((c) => ({ id: c.id, title: c.name })) }];
    case 'aion':
      return (d.history?.readings ?? []).map((r) => ({ id: r.id, title: r.title, items: r.epochs.map((e) => ({ id: e.id, title: e.name })) }));
    case 'redbook':
      return (d.redbook?.sections ?? []).map((s) => ({
        id: s.id,
        title: s.name,
        items: (d.redbook?.stops ?? []).filter((x) => x.sectionId === s.id).map((x) => ({ id: x.id, title: m.occIndex.has(x.id) ? m.occ[m.occIndex.get(x.id)!].label : x.id })),
      }));
    case 'alchemy':
      return d.alchemy
        ? [
          { id: 'opus', title: 'Opus', items: d.alchemy.opus.stages.map((s) => ({ id: s.id, title: s.name })) },
          { id: 'operations', title: 'Operations', items: d.alchemy.operations.map((s) => ({ id: s.id, title: s.name })) },
          { id: 'matter', title: 'Matter', items: d.alchemy.matter.map((s) => ({ id: s.id, title: s.name })) },
        ]
        : [];
    case 'symbols':
      return [{ id: 'entries', title: 'Symbols', items: (d.symbols?.entries ?? []).map((e) => ({ id: e.familyId, title: e.title })) }];
    default:
      return [];
  }
}

const ENGAGES: Partial<Record<LensId, EngagementKind>> = { dreams: 'dream', symbols: 'symbol', coincidences: 'coincidence', astrology: 'chart' };

/** The contract of one of the nine lenses. */
export function lensContract(id: LensId, m: Model, d: LensData = {}): LensContract {
  const set = setOf(id, m, d);
  const slice = sliceOf(id, m, set);
  const walks = (WALK_KIND[id] ?? []).flatMap((k) => walksOf(m, k));
  return {
    id,
    set,
    placed: set.filter((i) => m.located[i]).length,
    slice,
    slicePlaced: slice.filter((i) => m.located[i]).length,
    dimensions: dimensionsOf(m, slice),
    facets: facetsOf(m, slice),
    marks: marksOf(id, m, d),
    stops: stopsOf(walks),
    plates: platesOf(id, d),
    groups: groupsOf(id, m, d),
    engages: ENGAGES[id] ?? 'open',
  };
}

/** A lens engages with a subject: one record of the kind its contract names, or none when the visitor has turned recording off. */
export function engageWith(contract: Pick<LensContract, 'engages'>, store: Pick<PracticeStore, 'engage'>, subject: { type: string; id: string }) {
  return store.engage(contract.engages, subject);
}

/**
 * The Texts lens's contract: a Work is its subject. The set is the occurrences that cite it, the stops are its page walk in
 * page order, the Contents is its chapters, and its plates are the works' own occurrence plates (asked of `plates()`).
 * Undefined for a key no Work holds.
 */
export function textsContract(m: Model, workKey: string): LensContract | undefined {
  const wl = workLens(m, workKey);
  if (!wl) return undefined;
  const set = [...wl.scope].sort((a, b) => a - b);
  return {
    id: 'texts',
    set,
    placed: set.filter((i) => m.located[i]).length,
    slice: set,
    slicePlaced: set.filter((i) => m.located[i]).length,
    dimensions: dimensionsOf(m, set),
    facets: facetsOf(m, set),
    marks: [],
    stops: (wl.walk?.stops ?? []).map((_, i) => ({ walk: wl.walk!.id, i, kind: 'text' as const })),
    plates: (wl.walk?.stops ?? []).flatMap((s) => (s.subject?.type === 'occurrence' ? [{ type: 'occurrence' as const, id: s.subject.id }] : [])),
    groups: [{ id: 'chapters', title: 'Contents', items: wl.contents.map((c, i) => ({ id: String(i), title: c.title })) }],
    engages: 'open',
  };
}
