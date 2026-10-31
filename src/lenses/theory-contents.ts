// THEORY: the one Contents of the Theory mode (H5), and the walks it stands on (S9, N14).
// Theory is one mode with two readings: the theory route (its sections and the Number walk) and the dynamical route through
// Van Eenwyk. Both stand in the reading pane and both carry the same Contents, so a visitor moves between them from the
// list, not from a menu. Between them stand the fourteen theoretics, each its own walk (public/data/walks.json, `theoretic/<id>`):
// the quotations of its page, one stop each, played by the one Walk runner. Moving from one theoretic to another is the Contents'.
import type { Model, Subject } from '../data/model';
import type { DynamicsRoute } from '../types/dynamics';
import type { Walk } from '../types/walks';
import type { ContentsGroup } from '../ui/deep';
import { el, plate } from '../ui/dom';
import { definitionQuote, loadLensData } from './ui';
import { quote } from '../ui/quote';
import type { PassageBridge } from '../ui/passage';

/** The route Theory walks (the dynamical lens's own data, public/data/dynamics-route.json). */
export const THEORY_ROUTE = 'theory-route';
/** The sections a theoretic's walk passes through, each with the first stop it holds and how many stops it has (the walk's own order). */
export function walkSections(walk: Pick<Walk, 'stops'>): { id: string; title: string; first: number; count: number }[] {
  const out: { id: string; title: string; first: number; count: number }[] = [];
  walk.stops.forEach((st, i) => {
    const sec = st.section;
    if (!sec) return;
    const last = out[out.length - 1];
    if (last && last.id === sec.id) last.count++;
    else out.push({ id: sec.id, title: sec.title, first: i, count: 1 });
  });
  return out;
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
  /** the theoretic whose walk is playing: its sections, each opening the walk at its first stop (the first group when there is one) */
  walk?: { title: string; sections: { title: string; current: boolean; onPick(): void }[] };
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
  if (a.walk?.sections.length) groups.unshift({ title: a.walk.title, items: a.walk.sections.map((x) => ({ label: x.title, current: x.current, onPick: x.onPick })) });
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

/** The part of a theory node's page the pane reads on the walk's opening (public/data/theory-pages.json): the line that orients it. */
interface TheoryPage { line: string }

/**
 * One theoretic's opening, read at the first stop of its walk: its name, the line that orients it, its plate, Jung's definition
 * of it, the field's account, and the line of its page. The sections and their quotations are the walk's own stops.
 */
export function theoreticOpening(m: Model, id: string, h: { passages?: PassageBridge }): HTMLElement[] {
  const t = m.theoById.get(id);
  if (!t) return [];
  const out: HTMLElement[] = [];
  if (t.oneLine) out.push(el('p', { class: 'dp-lede', text: t.oneLine }));
  if (t.image) out.push(plate(t.image, { credit: true, className: 'dp-figure', palette: t.palette, eager: true }));
  if (t.definition) out.push(quote(definitionQuote(m, t.definition), { passages: h.passages }));
  for (const p of t.body.filter(Boolean)) out.push(el('p', { class: 'dp-para', text: p }));
  const host = el('div', { class: 'dp-page' });
  out.push(host);
  loadLensData<{ version: 1; pages: Record<string, TheoryPage> }>('theory-pages').then((d) => {
    const line = d.pages[id]?.line;
    if (line) host.replaceChildren(el('p', { class: 'th-line', text: line })); else host.remove();
  }).catch(() => host.remove());
  return out;
}

/** The way from a theoretic's reading to its node in the field. */
export function theoreticActs(m: Model, id: string, open: (subject: Subject) => void): HTMLElement | null {
  const t = m.theoById.get(id);
  if (!t) return null;
  return el('p', { class: 'dp-acts' }, [el('button', { type: 'button', class: 'lp-btn dp-read', text: `${t.name} in the field`, onclick: () => open({ type: 'theoretic', id }) })]);
}
