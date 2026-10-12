// The five-state machine of the experience, as pure transitions.
// World · Focus · Manifestation · Thread · (Deep is a reading layer over any).
import type { Subject } from '../data/model';
import type { BodyKey } from '../types/sky';
import { NUMBER_ARCHETYPES } from '../lenses/deep-fields';

export interface ThreadTarget {
  type: 'family' | 'archetype' | 'parallels';
  id: string;
}

/** The sky layer's state: which body is open, and which natal sky is standing. Orthogonal to the field's views. */
export interface SkyState {
  body?: BodyKey;
  /**
   * a natal sky, named by its chart's id ('you', 'jung', …): the birth data behind it never enters the state or the
   * hash (it lives in this browser's storage, or in the curation for Jung), so no link ever carries a birth moment
   */
  natal?: string;
  /** the field culture the bodies' names and characters are read through (cultures.json); absent: the Greco-Roman default */
  culture?: string;
}

export type View =
  | { kind: 'world' }
  | { kind: 'focus'; subject: Subject; /** the subjects drilled through to arrive here, outermost first (a link route, never in the hash) */ crumbs?: Subject[] }
  | { kind: 'manifest'; occId: string; context: Subject }
  | { kind: 'thread'; target: ThreadTarget; from: View };

/** The lenses that mount into the shell's panel (ProjectCentral/docs/MODES-RFC.md §3). */
export type PanelLensId = 'theory' | 'alchemy' | 'astrology' | 'dreams' | 'symbols' | 'coincidences';
export const PANEL_LENSES: readonly PanelLensId[] = ['theory', 'alchemy', 'astrology', 'dreams', 'symbols', 'coincidences'];

export interface AppState {
  view: View;
  /** a panel lens standing over the world view, at a sub-route (never personal data: see MODES-RFC §5) */
  lens?: { id: PanelLensId; path: string[] };
  deep: boolean;
  /** the graph mode: a second view of the same field (absent = the globe) */
  graph?: true;
  /** the sky: the same scene pulled back past the Moon to the whole system (a flag, as `graph` is, but it needs the world view) */
  sky?: SkyState;
  history?: { reading: string; selection?: { kind: 'epoch' | 'event' | 'thread' | 'chapter'; id: string } };
  /** the Red Book: Liber Novus as a folio walk (or the genesis table) over the world view */
  redbook?: { stop?: string; genesis?: true };
  /** The dynamical lens: the field read as a dynamical system over the world view. Absent subject = the Self. */
  /** the dynamical lens: its subject (the Self when none), a stop, or `route` to open the walk overview (session-only; not in the hash) */
  dynamics?: { subject?: Subject; stop?: string; route?: true };
  /** The live path remains standing while one of its presences is inspected. */
  trail?: Extract<View, { kind: 'thread' }>;
  /**
   * The mode a core reading was opened from (a double-click on an Aion event, a Red Book stop or a sky body). Escape
   * and close return to it once; it is session-local (never in the hash) and any other navigation drops it.
   */
  from?: AppState;
  /**
   * The reading was opened by the arrival of a descent from the sky (`skyArrival`), not asked for. Closing it leaves the
   * reading and stays on the node the camera landed on (its label, its "See in sky"); Escape then returns to the sky. A
   * reading asked for from a sky card returns to the sky at once, as it always did. Session-local, never in the hash.
   */
  arrived?: true;
}

export const WORLD: AppState = { view: { kind: 'world' }, deep: false };

/** `next`, a reading a mode opened, remembering the mode state it was opened from so `back` can return there. */
export function openedFrom(from: AppState, next: AppState): AppState {
  const mode: AppState = { ...from };
  delete mode.from;
  return { ...next, from: mode };
}

/**
 * A descent from the sky is a reading: when the standing state is in the sky and `next` leaves it for a field node (a
 * focus or a manifestation) that the sky stays behind as `from`, the node's reading opens with the arrival, whether the
 * node has places on the globe or none (a card, a sign, a sephira with no located instance). The reading itself waits for
 * the camera to land (the controller's landing step); this only says that the arrival carries it. Any other transition,
 * and a state that already says what its reading is doing, comes back as it was.
 */
export function skyArrival(prev: AppState, next: AppState): AppState {
  if (!prev.sky || next.sky || !next.from?.sky) return next;
  if (next.deep || next.graph || next.lens || next.trail) return next;
  if (next.view.kind !== 'focus' && next.view.kind !== 'manifest') return next;
  return { ...next, deep: true, arrived: true };
}

/** Carry the mode of `from` onto a fresh state. */
function inMode(from: AppState, next: AppState): AppState {
  return from.graph ? { ...next, graph: true } : next;
}

export function focusOn(s: AppState, subject: Subject): AppState {
  // a node whose page is its substance is focused with that page open (the deep layer is where a page renders): the
  // theoretics and the six number archetypes. A node without its page was the defect this answers.
  const opens = subject.type === 'theoretic' || (subject.type === 'archetype' && NUMBER_ARCHETYPES.has(subject.id));
  return inMode(s, { view: { kind: 'focus', subject, crumbs: focusCrumbs(s) }, deep: opens });
}

/** The route drilled through to reach a focus: what stood focused one level up. A manifestation leaves its context; the world leaves no crumb. */
function focusCrumbs(s: AppState): Subject[] | undefined {
  const v = s.view;
  if (v.kind === 'focus') {
    const crumbs = [...(v.crumbs ?? []), v.subject];
    return crumbs.slice(Math.max(0, crumbs.length - 3));
  }
  if (v.kind === 'manifest') return [v.context];
  return undefined;
}

/** Switch between the globe and the graph, keeping what is in view (a thread has no graph: it returns to where it began). */
export function withMode(s: AppState, graph: boolean): AppState {
  const view = s.view.kind === 'thread' ? s.view.from : s.view;
  // the sky is a scale of the globe: the graph has none, so switching modes leaves it
  return graph ? { view, deep: s.deep, graph: true } : { view, deep: s.deep };
}

/** Select an occurrence. `fallbackContext` is its family, used when no focus is standing. */
export function manifest(s: AppState, occId: string, fallbackContext: Subject): AppState {
  const v = s.view;
  let context = fallbackContext;
  if (v.kind === 'focus') context = v.subject;
  else if (v.kind === 'manifest') context = v.context;
  else if (v.kind === 'thread') context = threadSubject(v.target, fallbackContext);
  const trail = v.kind === 'thread' ? v : s.trail;
  return trail ? { view: { kind: 'manifest', occId, context }, deep: false, trail } : inMode(s, { view: { kind: 'manifest', occId, context }, deep: false });
}

export function threadSubject(t: ThreadTarget, fallback: Subject): Subject {
  if (t.type === 'family') return { type: 'family', id: t.id };
  if (t.type === 'archetype') return { type: 'archetype', id: t.id };
  return fallback;
}

export function startThread(s: AppState, target: ThreadTarget): AppState {
  const v = s.view;
  const from: View = v.kind === 'thread' ? v.from : v;
  // a thread travels the globe: it leaves the graph
  return { view: { kind: 'thread', target, from }, deep: false };
}

/** A panel lens at a sub-route, over the world view. Astrology stands in the sky: its route names the chart and the body. */
export function inLens(id: PanelLensId, path: string[] = []): AppState {
  if (id === 'astrology') return astrologyAt(path);
  return { view: { kind: 'world' }, deep: false, lens: { id, path } };
}

/**
 * Path segment for Astrology over the live (clock) sky — not a natal chart id.
 * Zoom-out / S enter here; Charts and Jung’s sky are chosen from Options, never forced.
 */
export const ASTROLOGY_LIVE = 'sky';

/** Astrology over the live sky (no natal). Optional approached body + name culture. */
export function astrologyLive(opts: { body?: BodyKey; culture?: string } = {}): AppState {
  const sky: SkyState = {};
  if (opts.body) sky.body = opts.body;
  if (opts.culture) sky.culture = opts.culture;
  return {
    view: { kind: 'world' },
    deep: false,
    lens: { id: 'astrology', path: opts.body ? [ASTROLOGY_LIVE, opts.body] : [ASTROLOGY_LIVE] },
    sky,
  };
}

/** The Astrology lens at [chart, body]: the panel, and the sky held at that chart's moment with that body approached. */
export function astrologyAt(path: string[]): AppState {
  const [a, b] = path;
  if (a === ASTROLOGY_LIVE) return astrologyLive({ body: b as BodyKey | undefined });
  const sky: SkyState = {};
  if (a) sky.natal = a;
  if (a && b) sky.body = b as BodyKey;
  return { view: { kind: 'world' }, deep: false, lens: { id: 'astrology', path: path.slice(0, a ? (b ? 2 : 1) : 0) }, sky };
}

/**
 * Enter (or change) the sky. The sky is never bare: it is always the Astrology lens standing over the world view, on the
 * live sky (no chart) or on a natal chart, so its Options, its orbits and its body are the lens's own. Any focus is left
 * behind; the field stays as it was.
 */
export function inSky(sky: SkyState = {}): AppState {
  const body = sky.body ? [sky.body] : [];
  const s = astrologyAt(sky.natal ? [sky.natal, ...body] : [ASTROLOGY_LIVE, ...body]);
  return sky.culture ? { ...s, sky: { ...s.sky, culture: sky.culture } } : s;
}

/**
 * What a zoom gesture asks of the sky at the sky's two distances, or null when the state stands. Zooming out past `edges.enter`
 * from the Field's own views (the globe, a focus, a manifestation, a walk) enters Astrology on the live sky; zooming in past
 * `edges.exit` by the wheel or pinch leaves it for the Field. The graph, Aion, the Red Book, the dynamical lens and any
 * other panel lens keep their own camera and never take the sky by zoom.
 */
export function skyGestureState(s: AppState, d: number, edges: { enter: number; exit: number }, wheel: boolean): AppState | null {
  if (s.graph || s.history || s.redbook || s.dynamics) return null;
  if (s.lens && s.lens.id !== 'astrology') return null;
  if (!s.sky && d > edges.enter) return astrologyLive();
  if (s.sky && d < edges.exit && wheel) return WORLD;
  return null;
}

export function skyEq(a: SkyState | undefined, b: SkyState | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.body === b.body && a.culture === b.culture && a.natal === b.natal;
}

export function setDeep(s: AppState, deep: boolean): AppState {
  if (s.view.kind === 'world') return s;
  return { ...s, deep };
}

/** One step back: deep → manifestation → focus (up the drilled route) → world (thread → where it began). */
export function back(s: AppState): AppState {
  // the reading a descent from the sky carried closes onto the node it landed on; the sky is one step further (`from` stays)
  if (s.arrived && s.deep && s.from?.sky) {
    const { arrived: _arrived, ...rest } = s;
    return { ...rest, deep: false };
  }
  // a reading a mode opened returns to that mode, once (the memory is the mode state itself, so it is cleared with it)
  if (s.from) return s.from;
  // a reading opened on a walk's step returns to the walk where it began, not to the step's card
  if (s.deep && s.trail && s.view.kind === 'manifest') return { view: s.trail, deep: false };
  if (s.deep) return { ...s, deep: false };
  // a panel lens steps up its own route; Theory closes onto Theory landing (Options waiting), others onto the Earth
  if (s.lens) {
    if (s.lens.id === 'astrology') {
      const p = s.lens.path;
      // live sky: release an approached body, then leave the mode
      if (p[0] === ASTROLOGY_LIVE) {
        if (p.length >= 2 || s.sky?.body) return astrologyLive({ culture: s.sky?.culture });
        return WORLD;
      }
      // walk → birth sky; birth sky / Charts → Field (Escape leaves; the sheet’s X stays on the sky)
      if (p.length >= 2) return astrologyAt([p[0]]);
      return WORLD;
    }
    if (s.lens.path.length) return { ...s, lens: { id: s.lens.id, path: s.lens.path.slice(0, -1) } };
    if (s.lens.id === 'theory') return { view: { kind: 'world' }, deep: false, dynamics: {} };
    return WORLD;
  }
  if (s.history) return s.history.selection ? { ...s, history: { reading: s.history.reading } } : WORLD;
  if (s.redbook) return s.redbook.stop || s.redbook.genesis ? { ...s, redbook: {} } : WORLD;
  // the lens: a subject climbs to the lens itself (the Self), and the lens closes onto the Earth
  if (s.dynamics) return s.dynamics.stop ? { ...s, dynamics: s.dynamics.subject ? { subject: s.dynamics.subject } : {} } : s.dynamics.subject ? { ...s, dynamics: {} } : WORLD;
  const v = s.view;
  switch (v.kind) {
    case 'world':
      return s;
    case 'focus': {
      const crumbs = v.crumbs ?? [];
      if (crumbs.length) {
        const up = crumbs[crumbs.length - 1];
        return inMode(s, { view: { kind: 'focus', subject: up, crumbs: crumbs.slice(0, -1) }, deep: false });
      }
      return inMode(s, WORLD);
    }
    case 'manifest':
      if (s.trail) return { view: s.trail, deep: false };
      return inMode(s, { view: { kind: 'focus', subject: v.context }, deep: false });
    case 'thread':
      return inMode(s, { view: v.from, deep: false });
  }
}

export function subjectEq(a: Subject, b: Subject): boolean {
  return a.type === b.type && a.id === b.id;
}

export function viewEq(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'world':
      return true;
    case 'focus':
      return subjectEq(a.subject, (b as typeof a).subject);
    case 'manifest':
      return a.occId === (b as typeof a).occId;
    case 'thread': {
      const t = b as typeof a;
      return a.target.type === t.target.type && a.target.id === t.target.id;
    }
  }
}

export function stateEq(a: AppState, b: AppState): boolean {
  return a.deep === b.deep && !!a.graph === !!b.graph && viewEq(a.view, b.view) && skyEq(a.sky, b.sky)
    && a.history?.reading === b.history?.reading
    && a.history?.selection?.kind === b.history?.selection?.kind
    && a.history?.selection?.id === b.history?.selection?.id
    && !!a.redbook === !!b.redbook
    && a.redbook?.stop === b.redbook?.stop
    && !!a.redbook?.genesis === !!b.redbook?.genesis
    && !!a.dynamics === !!b.dynamics
    && (!a.dynamics?.subject) === (!b.dynamics?.subject)
    && (!a.dynamics?.subject || !b.dynamics?.subject || subjectEq(a.dynamics.subject, b.dynamics.subject))
    && a.dynamics?.stop === b.dynamics?.stop
    && !!a.dynamics?.route === !!b.dynamics?.route
    && ((!a.trail && !b.trail) || (!!a.trail && !!b.trail && viewEq(a.trail, b.trail)))
    && !!a.from === !!b.from
    && a.lens?.id === b.lens?.id
    && (a.lens?.path ?? []).join('/') === (b.lens?.path ?? []).join('/');
}

/** Depth used to decide whether a move is an ascent (zoom out) or descent. */
export function depthOf(s: AppState): number {
  const base = { world: 0, focus: 1, thread: 2, manifest: 2 }[s.view.kind];
  return base + (s.sky ? 1 + (s.sky.body ? 1 : 0) : 0) + (s.deep ? 1 : 0) + (s.redbook ? 1 + (s.redbook.stop || s.redbook.genesis ? 1 : 0) : 0)
    + (s.dynamics ? 1 + (s.dynamics.subject ? 1 : 0) + (s.dynamics.stop || s.dynamics.route ? 1 : 0) : 0) + (s.lens ? 1 + s.lens.path.length : 0);
}
