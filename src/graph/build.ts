// The graph as data: nodes, edges, neighbourhoods and time-liveness. Pure — no DOM, no d3.
// Derived from the Model, so the graph is a second view of exactly the field the globe shows.
import { subjectPalette, type Model } from '../data/model';
import type { RGB } from '../data/palette';
import type { TieBasis } from '../types/field';
import { timeVisibility, type TimeWindow } from '../data/time';
import { averagePalettes, hexToRgb } from '../data/palette';
import { BODY_KEYS, type BodyKey } from '../types/sky';
import { matchImages, type Vocabulary } from '../practice/amplify';

/**
 * 'work' and 'person' come from the Works and People the Model was built with (public/data/works.json, people.json); absent,
 * the graph has neither. 'you' is the visitor, added by withYou from the practice store and nothing else.
 */
export type NodeKind = 'archetype' | 'theoretic' | 'family' | 'occurrence' | 'body' | 'work' | 'person' | 'you';
/**
 * 'sky' joins a body to the family or archetype it is tied to; it carries the basis of that tie.
 * 'cite' joins a Work to what its cites stand on, and carries the number of cites as `weight` (drawn as width): to an
 * archetype, theoretic or family aggregated over the whole Work, to an occurrence for that occurrence alone.
 * 'wrote' joins a Person to a Work he wrote, or to an occurrence that is his own (Jung's dreams and visions).
 * 'you' joins the visitor to what their own record names; its `weight` is how many times.
 */
export type EdgeKind = 'instance' | 'co' | 'tie' | 'parallel' | 'sky' | 'cite' | 'wrote' | 'you';

export interface GNode {
  /** index in Graph.nodes */
  id: number;
  kind: NodeKind;
  /** 'a:self' | 'f:serpent' | 'o:<occurrence id>' */
  key: string;
  /** the entity's own id (archetype / family / occurrence slug) */
  ref: string;
  label: string;
  /** model occurrence index (occurrences only, else -1) */
  occIdx: number;
  /** model occurrence indices a family / archetype stands for */
  members: number[];
  /** how many occurrences it stands for (1 for an occurrence) */
  count: number;
  /** 0..1 importance among its kind: drives size and label priority */
  rank: number;
  colour: RGB;
  glow: RGB;
  spectrum: number;
  /** slider position of the occurrence's year (NaN for archetypes / families) */
  u: number;
  yearDisplay: string;
  prime: boolean;
  hasImage: boolean;
  /** the field's ground: the two keystone theoretics (the psychoid, the archetype as such). Drawn as the base the others stand on. */
  ground: boolean;
  /** has a place on the globe (an archetype or family: at least one placed member); unplaced nodes are drawn hollow */
  placed: boolean;
}

export interface GEdge {
  s: number;
  t: number;
  kind: EdgeKind;
  /** only on 'tie' and 'sky' edges: whose word the tie is */
  basis?: TieBasis;
  /** only on 'cite' and 'you' edges: how many cites / how many times; drawn as width */
  weight?: number;
}

export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
  /** undirected neighbour lists, by node id */
  adj: number[][];
  /** edge indices touching each node */
  incident: number[][];
  byKey: Map<string, number>;
  archetypeIds: number[];
  theoreticIds: number[];
  familyIds: number[];
  occurrenceIds: number[];
  /** the sky's bodies (empty unless the graph was extended with withSkyAnchors) */
  bodyIds: number[];
  /** the Works and the People (empty unless the Model was built with them) */
  workIds: number[];
  personIds: number[];
  /** the visitor: one node, or none (empty unless the graph was extended with withYou) */
  youIds: number[];
}

const aKey = (id: string) => `a:${id}`;
const tKey = (id: string) => `t:${id}`;
const fKey = (id: string) => `f:${id}`;
const oKey = (id: string) => `o:${id}`;
const wKey = (id: string) => `w:${id}`;
const pKey = (id: string) => `p:${id}`;
/** The visitor's one node: a fixed key, never anything of theirs. */
export const YOU_KEY = 'you';
export const graphKey = { archetype: aKey, theoretic: tKey, family: fKey, occurrence: oKey, work: wKey, person: pKey };

/**
 * Whether the occurrence-level cites (Work to occurrence) are drawn in the whole-field view when the occurrences are on.
 * They are the fine strands (about 3,100 of them); the aggregated Work ties are always drawn. The local graph follows them
 * whenever occurrences are on. If the global view reads badly at defaults this is the one switch: false.
 */
export const CITE_OCCURRENCES_IN_GLOBAL = true;

const FALLBACK = { core: [0.76, 0.82, 0.95] as RGB, glow: [0.3, 0.47, 0.8] as RGB };

/** Build the whole graph of a field. Occurrences the globe cannot place are still nodes: the graph is not geographic. */
export function buildGraph(m: Model): Graph {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const byKey = new Map<string, number>();
  const push = (n: Omit<GNode, 'id'>) => {
    const id = nodes.length;
    nodes.push({ ...n, id });
    byKey.set(n.key, id);
    return id;
  };

  const maxArch = Math.max(1, ...m.field.archetypes.map((a) => m.archMem.get(a.id)?.length ?? 0));
  const maxFam = Math.max(1, ...m.field.families.map((f) => m.famMem.get(f.id)?.length ?? 0));

  for (const a of m.field.archetypes) {
    const pal = m.archPalette.get(a.id);
    const members = m.archMem.get(a.id) ?? [];
    push({
      kind: 'archetype', key: aKey(a.id), ref: a.id, label: a.name, occIdx: -1, members, count: members.length, placed: members.some((i) => !!m.located[i]),
      rank: a.prime ? 1 : 0.55 + 0.4 * (members.length / maxArch),
      colour: pal?.core ?? [0.76, 0.82, 0.95], glow: pal?.glow ?? [0.3, 0.47, 0.8], spectrum: a.spectrum?.position ?? 0.5,
      u: NaN, yearDisplay: '', prime: a.prime, hasImage: !!a.image, ground: false,
    });
  }
  for (const f of m.field.families) {
    const pal = m.famPalette.get(f.id);
    const members = m.famMem.get(f.id) ?? [];
    push({
      kind: 'family', key: fKey(f.id), ref: f.id, label: f.name, occIdx: -1, members, count: members.length, placed: members.some((i) => !!m.located[i]),
      rank: Math.sqrt(members.length / maxFam),
      colour: pal?.core ?? [0.76, 0.82, 0.95], glow: pal?.glow ?? [0.3, 0.47, 0.8], spectrum: f.spectrum?.position ?? 0.5,
      u: NaN, yearDisplay: '', prime: false, hasImage: !!f.image, ground: false,
    });
  }
  for (let i = 0; i < m.occ.length; i++) {
    const o = m.occ[i];
    const pal = m.famPalette.get(o.familyId);
    push({
      kind: 'occurrence', key: oKey(o.id), ref: o.id, label: o.label, occIdx: i, members: [i], count: 1, placed: !!m.located[i], rank: o.image ? 0.6 : 0.3,
      colour: pal?.core ?? [0.76, 0.82, 0.95], glow: pal?.glow ?? [0.3, 0.47, 0.8], spectrum: pal?.spectrum ?? 0.5,
      u: m.u[i], yearDisplay: o.yearDisplay, prime: false, hasImage: !!o.image, ground: false,
    });
  }

  // Theoretics are pushed after occurrences so every node the graph already had keeps its id.
  // They carry no place of their own — they stand for the traffic of what they are tied to.
  const maxTheo = Math.max(1, ...(m.field.theoretics ?? []).map((t) => m.theoMem.get(t.id)?.length ?? 0));
  for (const t of m.field.theoretics ?? []) {
    const pal = m.theoPalette.get(t.id);
    const members = m.theoMem.get(t.id) ?? [];
    push({
      kind: 'theoretic', key: tKey(t.id), ref: t.id, label: t.name, occIdx: -1, members, count: members.length,
      placed: members.some((i) => !!m.located[i]),
      rank: t.ground ? 1 : 0.5 + 0.45 * (members.length / maxTheo),
      colour: pal?.core ?? [0.76, 0.82, 0.95], glow: pal?.glow ?? [0.3, 0.47, 0.8], spectrum: t.spectrum?.position ?? 0.5,
      u: NaN, yearDisplay: '', prime: false, hasImage: !!t.image, ground: !!t.ground,
    });
  }

  // Works and People after everything else the field has, so every node it already had keeps its id. A Work takes the
  // cite-weighted mean of the colours of what it touches, a Person that of his Works: no hue of their own.
  const maxCites = Math.max(1, ...[...m.workById.values()].map((w) => w.cites));
  for (const w of m.workById.values()) {
    const pal = subjectPalette(m, { type: 'work', id: w.id }, averagePalettes);
    const members = m.workMem.get(w.id) ?? [];
    push({
      kind: 'work', key: wKey(w.id), ref: w.id, label: shortTitle(w.title), occIdx: -1, members, count: members.length, placed: members.some((i) => !!m.located[i]),
      rank: Math.sqrt(w.cites / maxCites),
      colour: pal?.core ?? FALLBACK.core, glow: pal?.glow ?? FALLBACK.glow, spectrum: pal?.spectrum ?? 0.5,
      u: NaN, yearDisplay: w.display ?? '', prime: false, hasImage: false, ground: false,
    });
  }
  const citesOf = new Map<string, number>();
  for (const w of m.workById.values()) citesOf.set(w.id, w.cites);
  const maxWrote = Math.max(1, ...[...m.personById.values()].map((p) => p.works.reduce((n, id) => n + (citesOf.get(id) ?? 0), 0)));
  for (const p of m.personById.values()) {
    const pal = subjectPalette(m, { type: 'person', id: p.id }, averagePalettes);
    const members = m.personMem.get(p.id) ?? [];
    const wrote = p.works.reduce((n, id) => n + (citesOf.get(id) ?? 0), 0);
    push({
      kind: 'person', key: pKey(p.id), ref: p.id, label: p.name, occIdx: -1, members, count: members.length, placed: members.some((i) => !!m.located[i]),
      rank: Math.sqrt(wrote / maxWrote),
      colour: pal?.core ?? FALLBACK.core, glow: pal?.glow ?? FALLBACK.glow, spectrum: pal?.spectrum ?? 0.5,
      u: NaN, yearDisplay: '', prime: false, hasImage: !!p.portrait, ground: false,
    });
  }

  // family → archetype ties, styled later by basis
  for (const f of m.field.families) {
    const fi = byKey.get(fKey(f.id));
    if (fi === undefined) continue;
    for (const t of f.archetypes) {
      const ai = byKey.get(aKey(t.id));
      if (ai !== undefined) edges.push({ s: fi, t: ai, kind: 'tie', basis: t.basis });
    }
  }
  // archetype → archetype ties (the number archetypes' ties to the Self and to the dyad's figures, from curation)
  for (const a of m.field.archetypes) {
    const ai = byKey.get(aKey(a.id));
    if (ai === undefined) continue;
    for (const tie of a.archetypes ?? []) {
      const ti = byKey.get(aKey(tie.id));
      if (ti === undefined || ti === ai) continue;
      edges.push({ s: ai, t: ti, kind: 'tie', basis: tie.basis });
    }
  }
  // occurrence → family (instance_of), occurrence → co-families, occurrence ↔ occurrence parallels
  const seenPar = new Set<string>();
  for (let i = 0; i < m.occ.length; i++) {
    const o = m.occ[i];
    const oi = byKey.get(oKey(o.id))!;
    const fi = byKey.get(fKey(o.familyId));
    if (fi !== undefined) edges.push({ s: oi, t: fi, kind: 'instance' });
    for (const c of o.coFamilyIds) {
      const ci = byKey.get(fKey(c));
      if (ci !== undefined && ci !== fi) edges.push({ s: oi, t: ci, kind: 'co' });
    }
    for (const p of o.parallelIds) {
      const pi = byKey.get(oKey(p));
      if (pi === undefined || pi === oi) continue;
      const k = oi < pi ? `${oi}|${pi}` : `${pi}|${oi}`;
      if (seenPar.has(k)) continue;
      seenPar.add(k);
      edges.push({ s: oi, t: pi, kind: 'parallel' });
    }
  }

  // theoretic → archetype / family / theoretic ties: the theory as a piece of the same graph
  for (const t of m.field.theoretics ?? []) {
    const ti = byKey.get(tKey(t.id));
    if (ti === undefined) continue;
    for (const tie of t.archetypes) {
      const ai = byKey.get(aKey(tie.id));
      if (ai !== undefined) edges.push({ s: ti, t: ai, kind: 'tie', basis: tie.basis });
    }
    for (const tie of t.families) {
      const fi = byKey.get(fKey(tie.id));
      if (fi !== undefined) edges.push({ s: ti, t: fi, kind: 'tie', basis: tie.basis });
    }
    for (const tie of t.theoretics) {
      const ni = byKey.get(tKey(tie.id));
      if (ni === undefined || ni === ti) continue;
      edges.push({ s: ti, t: ni, kind: 'tie', basis: tie.basis });
    }
  }

  // joins: curation's relations between any two nodes (an element and its suit, a sephira and its number). They are
  // drawn as ties and answer to the same Relations filter by basis, so no new kind of edge enters the graph.
  const joinKey = (end: { type: 'archetype' | 'theoretic' | 'family'; id: string }) => (end.type === 'archetype' ? aKey(end.id) : end.type === 'theoretic' ? tKey(end.id) : fKey(end.id));
  for (const j of m.joins) {
    const ai = byKey.get(joinKey(j.a));
    const bi = byKey.get(joinKey(j.b));
    if (ai !== undefined && bi !== undefined && ai !== bi) edges.push({ s: ai, t: bi, kind: 'tie', basis: j.basis });
  }

  // The cites, from the Works' published ties (derived from the cites, never typed): a Work to the archetypes, theoretics and
  // families its cites stand on, one tie per pair, its weight the number of cites; and to each occurrence that cites it,
  // its weight the number of cites on that occurrence.
  for (const w of m.workById.values()) {
    const wi = byKey.get(wKey(w.id));
    if (wi === undefined) continue;
    for (const [list, key] of [[w.ties.archetypes, aKey], [w.ties.theoretics, tKey], [w.ties.families, fKey]] as const) {
      for (const t of list) {
        const ti = byKey.get(key(t.id));
        if (ti !== undefined) edges.push({ s: wi, t: ti, kind: 'cite', weight: t.weight });
      }
    }
  }
  for (let i = 0; i < m.occ.length; i++) {
    const o = m.occ[i];
    const per = new Map<string, number>();
    for (const c of o.jung ?? []) {
      const wid = m.workKey.get(c.work);
      if (wid) per.set(wid, (per.get(wid) ?? 0) + 1);
    }
    for (const [wid, n] of per) {
      const wi = byKey.get(wKey(wid));
      const oi = byKey.get(oKey(o.id));
      if (wi !== undefined && oi !== undefined) edges.push({ s: wi, t: oi, kind: 'cite', weight: n });
    }
  }
  // authorship: a Person to the Works he wrote; and to the occurrences that are his own (a subject of his own: Jung's 82)
  for (const p of m.personById.values()) {
    const pi = byKey.get(pKey(p.id));
    if (pi === undefined) continue;
    for (const wid of p.works) {
      const wi = byKey.get(wKey(wid));
      if (wi !== undefined) edges.push({ s: pi, t: wi, kind: 'wrote' });
    }
    if (p.subjectKey) {
      for (const i of m.personMem.get(p.id) ?? []) {
        const oi = byKey.get(oKey(m.occ[i].id));
        if (oi !== undefined) edges.push({ s: pi, t: oi, kind: 'wrote' });
      }
    }
  }

  const adj: number[][] = nodes.map(() => []);
  const incident: number[][] = nodes.map(() => []);
  edges.forEach((e, k) => {
    adj[e.s].push(e.t);
    adj[e.t].push(e.s);
    incident[e.s].push(k);
    incident[e.t].push(k);
  });

  return {
    nodes, edges, adj, incident, byKey,
    archetypeIds: nodes.filter((n) => n.kind === 'archetype').map((n) => n.id),
    theoreticIds: nodes.filter((n) => n.kind === 'theoretic').map((n) => n.id),
    familyIds: nodes.filter((n) => n.kind === 'family').map((n) => n.id),
    occurrenceIds: nodes.filter((n) => n.kind === 'occurrence').map((n) => n.id),
    bodyIds: [],
    workIds: nodes.filter((n) => n.kind === 'work').map((n) => n.id),
    personIds: nodes.filter((n) => n.kind === 'person').map((n) => n.id),
    youIds: [],
  };
}

/** "Psychology and Alchemy (CW12)" -> "Psychology and Alchemy"; "Aion: Researches into the Phenomenology of the Self (CW9ii)" -> "Aion". */
export function shortTitle(title: string): string {
  const bare = title.replace(/\s*\([^)]*\)\s*$/, '');
  const head = bare.split(':')[0].trim();
  return head.length >= 3 ? head : bare;
}

/** What the sky contributes to the graph: the bodies, their ties to the field, and where each stands. */
export interface SkyAnchorSource {
  bodies: { key: BodyKey; name: string; order: number; palette: { core: string; glow: string }; spectrum: number }[];
  ties: { body: BodyKey; type: 'family' | 'archetype'; id: string; basis: TieBasis }[];
  /** geocentric ecliptic longitude (degrees) of each body at the standing moment. The Earth has none: it is where we stand. */
  lon: Partial<Record<BodyKey, number>>;
  /**
   * The occurrences that hang at a body (their extraterrestrial places): a body is a place, so what hangs at it is linked
   * to it. Optional: a source without it is the sky as it was, ties only.
   */
  hangs?: { body: BodyKey; occ: string }[];
}

export const bodyKey = (key: string) => `b:${key}`;
/** The outer ring's radius, in graph units: a little beyond the outermost families. */
export const SKY_RING_RADIUS = 560;

/** Where a body stands on the outer ring: its ecliptic longitude, counter-clockwise from the right as a chart is drawn (y grows downward). */
export function skyRingPosition(lonDeg: number, radius = SKY_RING_RADIUS): { x: number; y: number } {
  const a = (lonDeg * Math.PI) / 180;
  // rounded so that equal inputs stay byte-equal across platforms
  return { x: Math.round(Math.cos(a) * radius * 1e6) / 1e6 + 0, y: Math.round(-Math.sin(a) * radius * 1e6) / 1e6 + 0 };
}

/**
 * The graph with the sky hung from it: one 'body' node per body that has a geocentric longitude, and a 'sky'
 * edge for each recorded tie to a family or archetype. Pure: the input graph is not touched, and every
 * existing node keeps its id, so a view holding the old graph can swap to this one in place.
 */
export function withSkyAnchors(base: Graph, src: SkyAnchorSource): Graph {
  const nodes = base.nodes.slice();
  const edges = base.edges.slice();
  const byKey = new Map(base.byKey);
  const bodies = src.bodies.filter((b) => src.lon[b.key] !== undefined).sort((a, b) => a.order - b.order);
  const maxOrder = Math.max(1, ...bodies.map((b) => b.order));
  const bodyIds: number[] = [];
  for (const b of bodies) {
    const id = nodes.length;
    const pal = { core: hexToRgb(b.palette.core), glow: hexToRgb(b.palette.glow) };
    nodes.push({
      id, kind: 'body', key: bodyKey(b.key), ref: b.key, label: b.name, occIdx: -1, members: [], count: 0, placed: true,
      rank: 0.55 + 0.35 * (1 - b.order / maxOrder), colour: pal.core, glow: pal.glow, spectrum: b.spectrum,
      u: NaN, yearDisplay: '', prime: false, hasImage: false, ground: false,
    });
    byKey.set(bodyKey(b.key), id);
    bodyIds.push(id);
  }
  for (const t of src.ties) {
    const s = byKey.get(bodyKey(t.body));
    const to = byKey.get(t.type === 'family' ? fKey(t.id) : aKey(t.id));
    if (s === undefined || to === undefined) continue;
    edges.push({ s, t: to, kind: 'sky', basis: t.basis });
  }
  // what hangs at a body: the occurrence is linked to the place it is attested at (once per body, whatever its rings)
  const hung = new Set<string>();
  for (const h of src.hangs ?? []) {
    const k = `${h.body}|${h.occ}`;
    if (hung.has(k)) continue;
    hung.add(k);
    const s = byKey.get(bodyKey(h.body));
    const to = byKey.get(oKey(h.occ));
    if (s === undefined || to === undefined) continue;
    edges.push({ s, t: to, kind: 'sky', basis: 'site' });
  }
  const adj: number[][] = nodes.map((_, i) => (base.adj[i] ? base.adj[i].slice() : []));
  const incident: number[][] = nodes.map((_, i) => (base.incident[i] ? base.incident[i].slice() : []));
  for (let k = base.edges.length; k < edges.length; k++) {
    const e = edges[k];
    adj[e.s].push(e.t); adj[e.t].push(e.s);
    incident[e.s].push(k); incident[e.t].push(k);
  }
  return { ...base, nodes, edges, adj, incident, byKey, bodyIds };
}

/**
 * What the visitor has made and done, passed in from the practice store. The graph never reads storage itself. Only the
 * fields named here are read, and none of their text reaches the graph: a dream is matched against the field's names and
 * what is kept is a count on an edge.
 */
export interface PersonalData {
  dreams?: readonly { text?: string }[];
  coincidences?: readonly { familyId?: string | null; symbol?: string }[];
  /** any chart at all: its bodies are tied when the sky is hung from the graph */
  charts?: readonly unknown[];
  engagements?: readonly { kind: string; subject: { type: string; id: string } }[];
}

export interface YouContext {
  /** the field's names for its images (practice/amplify `vocabulary(model)`) */
  vocab: Vocabulary;
  /** the subjects a walk visits, by walk id: a finished walk is tied to where it went (optional; absent, a walk adds nothing) */
  walks?: ReadonlyMap<string, readonly { type: string; id: string }[]>;
}

const SUBJECT_KEY: Record<string, (id: string) => string> = { archetype: aKey, theoretic: tKey, family: fKey, occurrence: oKey, work: wKey, person: pKey };

/**
 * The graph with the visitor in it: one 'you' node, tied to what their own record names, and nothing else. A tie's weight is
 * how many times: the families and archetypes a dream names (`matchImages`), the family a coincidence was tied to, each
 * thing opened or looked up or walked (the engagements), and each body of a chart when the sky is hung from the graph. No
 * tie, no node: with no data the graph is returned as it was. Pure, and every existing node keeps its id. Apply it to a
 * graph that does not have the node yet (the field's, or the field's with the sky).
 */
export function withYou(base: Graph, personal: PersonalData, ctx: YouContext): Graph {
  if (base.byKey.has(YOU_KEY)) throw new Error('withYou: the graph already has the visitor');
  const ties = new Map<number, number>();
  const add = (key: string | undefined, n = 1) => {
    const i = key === undefined ? undefined : base.byKey.get(key);
    if (i !== undefined) ties.set(i, (ties.get(i) ?? 0) + n);
  };
  const named = (text: string | undefined) => {
    if (!text) return;
    for (const hit of matchImages(ctx.vocab, text)) add((hit.target.type === 'family' ? fKey : aKey)(hit.target.id));
  };
  for (const d of personal.dreams ?? []) named(d.text);
  for (const c of personal.coincidences ?? []) {
    if (c.familyId) add(fKey(c.familyId));
    else named(c.symbol);
  }
  if (personal.charts?.length) for (const k of BODY_KEYS) if (k !== 'terra') add(bodyKey(k));
  const subject = (s: { type: string; id: string }) => add(SUBJECT_KEY[s.type]?.(s.id));
  for (const e of personal.engagements ?? []) {
    if (e.subject.type === 'walk') for (const s of ctx.walks?.get(e.subject.id) ?? []) subject(s);
    else subject(e.subject);
  }
  if (!ties.size) return base;

  const id = base.nodes.length;
  const targets = [...ties].sort((a, b) => a[0] - b[0]);
  let total = 0;
  const colour: RGB = [0, 0, 0];
  const glow: RGB = [0, 0, 0];
  let spectrum = 0;
  for (const [i, w] of targets) {
    total += w;
    const n = base.nodes[i];
    for (let c = 0; c < 3; c++) { colour[c] += n.colour[c] * w; glow[c] += n.glow[c] * w; }
    spectrum += n.spectrum * w;
  }
  for (let c = 0; c < 3; c++) { colour[c] /= total; glow[c] /= total; }
  const nodes = base.nodes.slice();
  nodes.push({
    id, kind: 'you', key: YOU_KEY, ref: YOU_KEY, label: 'You', occIdx: -1, members: [], count: 0, placed: true, rank: 0.95,
    colour, glow, spectrum: spectrum / total, u: NaN, yearDisplay: '', prime: false, hasImage: false, ground: false,
  });
  const edges = base.edges.slice();
  for (const [i, w] of targets) edges.push({ s: id, t: i, kind: 'you', weight: w });
  const byKey = new Map(base.byKey);
  byKey.set(YOU_KEY, id);
  const adj: number[][] = nodes.map((_, i) => (base.adj[i] ? base.adj[i].slice() : []));
  const incident: number[][] = nodes.map((_, i) => (base.incident[i] ? base.incident[i].slice() : []));
  for (let k = base.edges.length; k < edges.length; k++) {
    const e = edges[k];
    adj[e.s].push(e.t); adj[e.t].push(e.s);
    incident[e.s].push(k); incident[e.t].push(k);
  }
  return { ...base, nodes, edges, adj, incident, byKey, youIds: [id] };
}

export interface Neighbourhood {
  /** node id → distance from the nearest seed */
  dist: Map<number, number>;
  /** induced edge indices (both ends inside) */
  edges: number[];
}

const PRIORITY: Record<NodeKind, number> = { you: 5, theoretic: 4, archetype: 3, work: 2.5, person: 2.2, family: 2, body: 2, occurrence: 1 };

export interface NeighbourhoodOptions {
  /** breadth-first depth (Obsidian's local-graph depth) */
  depth: number;
  /** hard ceiling on nodes; deeper levels are trimmed by priority (archetypes, families, then occurrences) */
  cap?: number;
  /** leave occurrences out (except the seeds) */
  occurrences?: boolean;
  /** Which authored kinds of tie (family → archetype, body → field) to follow. Other relations remain available. */
  tieBases?: readonly TieBasis[];
  /** The tiers drawn at all: a kind left out is absent with its ties, never left stranded. Absent = every kind. */
  kinds?: ReadonlySet<NodeKind>;
}

/** Is this node's kind drawn? A sky body answers to its own toggle, never to the tiers' filters. */
export function kindShown(n: GNode, kinds?: ReadonlySet<NodeKind>): boolean {
  return kinds === undefined || n.kind === 'body' || kinds.has(n.kind);
}

export function edgeAllowed(e: GEdge, tieBases?: readonly TieBasis[]): boolean {
  return (e.kind !== 'tie' && e.kind !== 'sky') || tieBases === undefined || tieBases.includes(e.basis ?? 'site');
}

/** The subject's neighbourhood to the given depth. */
export function neighbourhood(g: Graph, seeds: number[], opts: NeighbourhoodOptions): Neighbourhood {
  const depth = Math.max(0, Math.floor(opts.depth));
  const cap = opts.cap ?? 360;
  const withOcc = opts.occurrences !== false;
  const kinds = opts.kinds;
  // the seeds are the person's own choice and always stand; a kind the filter removed is simply no neighbour
  const seedSet = new Set(seeds);
  const dist = new Map<number, number>();
  for (const s of seeds) dist.set(s, 0);
  let frontier = seeds.slice();
  for (let d = 1; d <= depth && frontier.length; d++) {
    const found = new Set<number>();
    for (const n of frontier) {
      for (const k of g.incident[n]) {
        const e = g.edges[k];
        if (!edgeAllowed(e, opts.tieBases)) continue;
        const nb = e.s === n ? e.t : e.s;
        if (dist.has(nb) || found.has(nb)) continue;
        if (!kindShown(g.nodes[nb], kinds)) continue;
        if (!withOcc && g.nodes[nb].kind === 'occurrence' && !seedSet.has(nb)) continue;
        found.add(nb);
      }
    }
    let level = [...found];
    // priority first, then more significant first, then stable by id
    level.sort((a, b) => PRIORITY[g.nodes[b].kind] - PRIORITY[g.nodes[a].kind] || g.nodes[b].rank - g.nodes[a].rank || a - b);
    const room = cap - dist.size;
    if (level.length > room) level = level.slice(0, Math.max(0, room));
    for (const n of level) dist.set(n, d);
    frontier = level;
    if (dist.size >= cap) break;
  }
  const edges: number[] = [];
  g.edges.forEach((e, k) => {
    if (dist.has(e.s) && dist.has(e.t) && edgeAllowed(e, opts.tieBases)) edges.push(k);
  });
  return { dist, edges };
}

/** What the global view shows: archetypes, theoretics and families, and occurrences as dust when asked. */
export function globalSet(g: Graph, occurrences: boolean, tieBases?: readonly TieBasis[], kinds?: ReadonlySet<NodeKind>): Neighbourhood {
  const dist = new Map<number, number>();
  for (const n of g.nodes) {
    if ((n.kind !== 'occurrence' || occurrences) && kindShown(n, kinds)) {
      dist.set(n.id, n.kind === 'archetype' || n.kind === 'theoretic' || n.kind === 'body' || n.kind === 'you' ? 0 : n.kind === 'family' || n.kind === 'work' || n.kind === 'person' ? 1 : 2);
    }
  }
  const edges: number[] = [];
  g.edges.forEach((e, k) => {
    if (!dist.has(e.s) || !dist.has(e.t) || !edgeAllowed(e, tieBases)) return;
    // the occurrence-level cites are the fine strands; one switch holds them back from the whole field (never from a local graph)
    if (!CITE_OCCURRENCES_IN_GLOBAL && e.kind === 'cite' && g.nodes[e.t].kind === 'occurrence') return;
    edges.push(k);
  });
  return { dist, edges };
}

const LIVE_FLOOR_OCC = 0.05;
const LIVE_FLOOR_GROUP = 0.26;

/**
 * How present each node is under the time window, 0..1. Occurrences follow the same visibility curve as
 * the globe's presences; a family or archetype dims by how much of it is live, never quite to nothing.
 */
export function nodeLiveness(g: Graph, m: Model, w: TimeWindow, out?: Float32Array): Float32Array {
  const live = out && out.length === g.nodes.length ? out : new Float32Array(g.nodes.length);
  const occLive = new Float32Array(m.occ.length);
  for (let i = 0; i < m.occ.length; i++) occLive[i] = timeVisibility(m.u[i], w);
  for (const n of g.nodes) {
    if (n.kind === 'occurrence') {
      live[n.id] = LIVE_FLOOR_OCC + (1 - LIVE_FLOOR_OCC) * occLive[n.occIdx];
      continue;
    }
    if (!n.members.length) { live[n.id] = 1; continue; }
    let s = 0;
    for (const i of n.members) s += occLive[i];
    const frac = s / n.members.length;
    live[n.id] = LIVE_FLOOR_GROUP + (1 - LIVE_FLOOR_GROUP) * Math.sqrt(frac);
  }
  return live;
}

/** Deterministic 0..1 hash of a string (stable spawn jitter, so layouts are reproducible). */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
