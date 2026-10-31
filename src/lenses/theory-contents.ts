// THEORY: the one Contents of the Theory mode (H5), and the two walks it stands on (S9, N14).
// Theory is one mode with two readings: the theory route (its sections and the Number walk) and the dynamical route through
// Van Eenwyk. Both stand in the reading pane and both carry the same Contents, so a visitor moves between them from the
// list, not from a menu. Between them stand the fourteen theoretics, walked as one walk.
import type { Model, Subject } from '../data/model';
import type { DynamicsRoute } from '../types/dynamics';
import type { Walk } from '../types/walks';
import type { ContentsGroup } from '../ui/deep';
import { el, plate } from '../ui/dom';
import { definitionQuote, loadLensData, quoteBlock, type LensQuote } from './ui';
import { quote } from '../ui/quote';
import type { PassageBridge } from '../ui/passage';

/** The route Theory walks (the dynamical lens's own data, public/data/dynamics-route.json). */
export const THEORY_ROUTE = 'theory-route';
/** The id of the fourteen-theoretics walk: the field's concepts, in the field's own order. */
export const THEORETICS_WALK = 'theoretics';

/**
 * The fourteen theoretics as one walk (N14): a stop for each concept the field carries, in the order the field names them.
 * No stop has a year or a place (a concept is not an event), so walking it leaves the clock and the camera where they are.
 */
export function theoreticsWalk(m: Pick<Model, 'field'>): Walk {
  return {
    id: THEORETICS_WALK,
    kind: 'theoretic',
    title: 'The fourteen theoretics',
    source: 'field.json#theoretics',
    ordered: 'curated',
    stops: (m.field.theoretics ?? []).map((t) => ({ subject: { type: 'concept', id: t.id } })),
  };
}

/** The route's stops, flat and in the route's own order (movement by movement). */
export function routeStops(route: DynamicsRoute | null) {
  return route ? route.movements.flatMap((movement) => movement.stops.map((stop) => ({ stop, movement }))) : [];
}

/** Where the visitor stands in the Theory mode, for the Contents to mark. */
export type TheoryAt =
  | { kind: 'section'; id: string }
  | { kind: 'theoretic'; id: string }
  | { kind: 'overview' }
  | { kind: 'stop'; id: string }
  | { kind: 'none' };

export interface TheoryContentsInput {
  model: Pick<Model, 'field'>;
  /** the name of the theory route (the provider's own label); its sections follow, then Number */
  theoryTitle: string;
  sections: { id: string; name: string }[];
  /** the dynamical route, once it has loaded */
  route: DynamicsRoute | null;
  /** the names of the route's concept stops (a stop with a concept is named by it) */
  stopName(stop: { id: string; concept?: string; name?: string }): string;
  at: TheoryAt;
  /** the families the standing stop or subject passes through (the first group when there are any) */
  families?: { id: string; name: string }[];
  go: {
    family?(id: string): void;
    section(id: string): void;
    theoretic(id: string): void;
    overview(): void;
    stop(id: string): void;
  };
}

/**
 * The Theory mode's Contents: the theory route (the sections, Number), the fourteen theoretics, and the route (its overview, then
 * the stops of each movement). The one the visitor stands on is marked.
 */
export function theoryContentsGroups(a: TheoryContentsInput): ContentsGroup[] {
  const at = a.at;
  const groups: ContentsGroup[] = [
    {
      title: a.theoryTitle,
      items: a.sections.map((s) => ({ label: s.name, current: at.kind === 'section' && at.id === s.id, onPick: () => a.go.section(s.id) })),
    },
    {
      title: 'The fourteen theoretics',
      items: (a.model.field.theoretics ?? []).map((t, i) => ({ label: t.name, note: String(i + 1), current: at.kind === 'theoretic' && at.id === t.id, onPick: () => a.go.theoretic(t.id) })),
    },
  ];
  if (a.families?.length) groups.unshift({ title: 'Families it passes through', items: a.families.map((f) => ({ label: f.name, onPick: () => a.go.family?.(f.id) })) });
  if (a.route) {
    groups.push({ title: 'Dynamics', items: [{ label: a.route.title, current: at.kind === 'overview', onPick: () => a.go.overview() }] });
    for (const mv of a.route.movements) {
      groups.push({
        title: `${mv.n} · ${mv.title}`,
        items: mv.stops.map((s) => ({ label: a.stopName(s), current: at.kind === 'stop' && at.id === s.id, onPick: () => a.go.stop(s.id) })),
      });
    }
  }
  return groups;
}

/** The part of a theory node's page the pane reads (public/data/theory-pages.json). */
interface TheoryPage {
  line: string;
  sections: { title: string; line: string; quotes: LensQuote[] }[];
  subjects: { type: Subject['type']; id: string }[];
}

/**
 * One theoretic read in the pane: its name, the line that orients it, its plate, Jung's definition of it, the field's account,
 * and the page the corpus places for it. The field's own page of the concept (its ties, its evidence) is one link away.
 */
export function theoreticReading(m: Model, id: string, h: { passages?: PassageBridge; open(subject: Subject): void }): HTMLElement[] | null {
  const t = m.theoById.get(id);
  if (!t) return null;
  const out: HTMLElement[] = [el('h2', { class: 'dp-title', text: t.name })];
  if (t.oneLine) out.push(el('p', { class: 'dp-lede', text: t.oneLine }));
  if (t.image) out.push(plate(t.image, { credit: true, className: 'dp-figure', palette: t.palette, eager: true }));
  if (t.definition) out.push(quote(definitionQuote(m, t.definition), { passages: h.passages }));
  for (const p of t.body.filter(Boolean)) out.push(el('p', { class: 'dp-para', text: p }));
  const host = el('div', { class: 'dp-page' });
  out.push(host);
  loadLensData<{ version: 1; pages: Record<string, TheoryPage> }>('theory-pages').then((d) => {
    const page = d.pages[id];
    if (!page) { host.remove(); return; }
    const nodes: HTMLElement[] = [];
    if (page.line) nodes.push(el('p', { class: 'th-line', text: page.line }));
    for (const s of page.sections) {
      nodes.push(el('h3', { class: 'as-h3', text: s.title }));
      if (s.line) nodes.push(el('p', { class: 'th-line', text: s.line }));
      for (const q of s.quotes) nodes.push(quoteBlock(q, h.passages));
    }
    host.replaceChildren(...nodes);
  }).catch(() => host.remove());
  out.push(el('p', { class: 'dp-acts' }, [
    el('button', { type: 'button', class: 'lp-btn dp-read', text: `${t.name} in the field`, onclick: () => h.open({ type: 'theoretic', id }) }),
  ]));
  return out;
}
