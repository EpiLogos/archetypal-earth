// THE DYNAMICAL LENS: the field read as a dynamical system (ProjectCentral/docs/DYNAMICAL.md). A third mode beside Aion and the
// Red Book, built to the same pattern: show(state) / hide() / update(dt), a root section, a reveal card.
// The globe is not touched here: the engine is exposed read-only, and the controller owns every globe effect
// (the chronology is offered by chronology() for it to light).
import { entered } from '../lenses/ui';
import { averagePalettes, rgbToHex } from '../data/palette';
import { subjectExists, subjectName, subjectPalette, type Model, type Subject } from '../data/model';
import type { GlobeEngine } from '../globe/engine';
import type { TimeModel } from '../state/timeModel';
import { inLens, type AppState } from '../state/store';
import type { Palette } from '../types/field';
import type { DynamicsConcept, DynamicsData, DynamicsQuote, DynamicsRender, DynamicsRoute, RouteMovement, RouteQuote, RouteStop } from '../types/dynamics';
import { clear, el } from '../ui/dom';
import type { PassageBridge } from '../ui/passage';
import { closeGlyph } from '../ui/reveal';
import { jMark, nMark, vMark } from './marks';
import { paintJulia, paintLorenz, paintMandelbrot } from './paint';
import { figureOf, paletteOf as figurePalette, type Figure } from './figures';
import { onPixelRatio, PhaseStrip } from './strip';
import { basinsOf, companions, trajectoryOf, type Basin, type Trajectory } from './trajectory';
import type { LensChrome } from '../shell/lens';

/** The caption under the hero names the native system drawn, never the subject. */
const HERO_CAPTION: Record<DynamicsRender, string> = {
  lorenz: 'Lorenz attractor · drawn here',
  mandelbrot: 'Mandelbrot set · drawn here',
  julia: 'Julia set · drawn here',
};

/** Used when neither the subject nor its occupants carry a palette. The world's own resting tone. */
const FALLBACK: Palette = { core: '#c3d2f2', glow: '#4f78cf', fog: '#10193a', deep: '#02030a' };
/** The most-visited basins offered as bare-name links; the rest are on the strip, not in the heading. */
const BASIN_LINKS = 8;
const COMPANIONS = 3;

export interface DynamicsState {
  subject?: Subject;
  stop?: string;
}

const keyOf = (s: Subject) => `${s.type}:${s.id}`;

export { selfSubject } from '../data/model';
import { selfSubject } from '../data/model';

function paletteOf(m: Model, s: Subject): Palette {
  const own = s.type === 'archetype' ? m.archById.get(s.id)?.palette : s.type === 'family' ? m.famById.get(s.id)?.palette : undefined;
  if (own) return own;
  const rgb = subjectPalette(m, s, averagePalettes);
  if (!rgb) return FALLBACK;
  return { core: rgbToHex(rgb.core), glow: rgbToHex(rgb.glow), fog: rgbToHex(rgb.fog), deep: rgbToHex(rgb.deep) };
}

export class DynamicsView {
  readonly root: HTMLElement;
  /** The phase strip, exposed for the harness and tests. */
  readonly strip: PhaseStrip;
  private heading: HTMLElement;
  private card: HTMLElement;
  private heroCanvas: HTMLCanvasElement | null = null;
  private heroKind: DynamicsRender = 'lorenz';
  /** repaints the hero when its box changes size */
  private heroRo: ResizeObserver | null = null;
  private subject: Subject | null = null;
  private traj: Trajectory | null = null;
  private palette: Palette = FALLBACK;
  private families = new Set<string>();
  private concepts: DynamicsConcept[] = [];
  private related: DynamicsConcept[] = [];
  private conceptAt = 0;
  /** the cursor last sent to the strip (undefined: none yet; null: no cursor) */
  private cursorSent: number | null | undefined = undefined;
  /** the route (public/data/dynamics-route.json): when present the lens walks it; absent, the concept cards stand alone */
  private route: DynamicsRoute | null = null;
  private stops: { stop: RouteStop; movement: RouteMovement }[] = [];
  /** the standing stop (null: the route's overview) */
  private stop: { stop: RouteStop; movement: RouteMovement } | null = null;
  private stateStop: string | undefined;
  /** the standing figure and its clock (seconds since it was drawn first) */
  private figure: Figure | null = null;
  private figT = 0;
  private figPainted = -1;
  /** told whenever the families the standing stop speaks of change: the controller tunes the globe to the lens's set */
  onScope: () => void = () => {};

  /**
   * `engine` is read only: this view never moves the globe. `passages` (optional) makes a Jung cite a passage link
   * when its work is in the corpus. `concepts` is the optional public/data/dynamics.json; null (absent) shows none.
   */
  constructor(parent: HTMLElement, private model: Model, readonly engine: GlobeEngine, private time: TimeModel,
    private navigate: (state: AppState) => void, private passages?: PassageBridge, concepts: DynamicsData | null = null, private chrome?: LensChrome) {
    this.concepts = concepts?.concepts ?? [];
    this.strip = new PhaseStrip();
    // the hero is painted at the device's pixel ratio, so a zoom or a move between screens repaints it too
    onPixelRatio(() => this.paintHero()); // the lens lives as long as the page: its disposer is not needed
    // the subject is the shell's context line; the visited families are this lens's controls (MODES-RFC §2)
    this.heading = el('div', { class: 'dy-controls' });
    this.card = el('aside', { class: 'dy-card reveal on', 'aria-label': 'Dynamical reading' });
    this.root = el('section', { class: 'dynamics', 'aria-label': 'The dynamical lens' }, [this.strip.root, this.card]);
    this.setActive(false);
    parent.append(this.root);
  }

  /** Show the lens on a subject (the Self when none is given). Idempotent. */
  show(state: DynamicsState = {}) {
    const requested = state.subject && subjectExists(this.model, state.subject) ? state.subject : selfSubject(this.model);
    this.setActive(true);
    document.body.classList.add('dynamics-mode');
    if (!this.subject || keyOf(this.subject) !== keyOf(requested)) this.setSubject(requested);
    this.stateStop = state.stop;
    this.chosen = !!state.subject;
    this.resolveStop();
    this.refreshChrome();
    this.renderCard();
    this.update(0);
  }

  /** whether the subject was chosen (a deep link or a pick), not the Self the lens lands on */
  private chosen = false;
  private basins: Basin[] = [];

  /**
   * The title and the controls name what the globe shows: the standing stop and its families on the route; the subject
   * and the families it passes through when one was chosen (or there is no route); the route itself on its overview.
   */
  private refreshChrome() {
    if (!this.subject || this.root.hidden) return;
    const m = this.model;
    const standing = this.standing();
    const subject = subjectName(m, this.subject);
    const context = standing ? (this.chosen ? `${standing.name} · ${subject}` : standing.name)
      : this.route && !this.chosen ? this.route.title : `${subject} as a dynamical system`;
    this.chrome?.setContext(context);
    clear(this.heading);
    const link = (familyId: string) => el('button', { type: 'button', class: 'link-quiet', text: m.famById.get(familyId)?.name ?? familyId,
      onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'family', id: familyId } }, deep: false }) });
    const fams = standing ? standing.familyIds.filter((f) => m.famById.has(f))
      : this.chosen || !this.route ? this.topBasins() : [];
    if (fams.length) this.heading.append(el('nav', { class: 'dy-basins', 'aria-label': standing ? 'The families this stop speaks of' : 'Families visited' }, fams.map(link)));
    this.heading.append(el('button', { type: 'button', class: 'link-quiet dy-theory', text: 'Read the theory', onclick: () => this.navigate(inLens('theory', ['transcendent-function'])) }));
    this.chrome?.setControls([this.heading]);
  }

  /** The most-visited families the subject passes through, in the order they were first visited. */
  private topBasins(): string[] {
    const subject = this.subject!;
    const top = new Set(
      [...this.basins]
        .filter((b) => !(subject.type === 'family' && b.familyId === subject.id))
        .sort((a, b) => b.count - a.count || (a.familyId < b.familyId ? -1 : 1))
        .slice(0, BASIN_LINKS)
        .map((b) => b.familyId),
    );
    return this.basins.filter((b) => top.has(b.familyId)).map((b) => b.familyId);
  }

  /** Offer the route after construction (it loads beside the concepts). */
  setRoute(route: DynamicsRoute | null) {
    this.route = route;
    this.stops = route ? route.movements.flatMap((movement) => movement.stops.map((stop) => ({ stop, movement }))) : [];
    this.resolveStop();
    if (!this.root.hidden) { this.renderCard(); this.refreshChrome(); }
    this.onScope();
  }

  private resolveStop() {
    const before = this.stop?.stop.id;
    this.stop = this.stops.find((x) => x.stop.id === this.stateStop) ?? null;
    if (this.stop?.stop.id !== before) this.onScope();
  }

  /** What the standing stop speaks of on the globe (its families) and its name; nothing on the overview. */
  standing(): { familyIds: string[]; name: string } | null {
    const s = this.stop?.stop;
    if (!s) return null;
    const concept = s.concept ? this.concepts.find((c) => c.id === s.concept) : undefined;
    return { familyIds: concept?.familyIds ?? s.familyIds ?? [], name: this.stopName(s) };
  }

  /** Every family the route binds (its concepts' and its own stops'): the lens's set on its overview. Empty without a route. */
  routeFamilies(): string[] {
    const out = new Set<string>();
    for (const { stop } of this.stops) {
      const concept = stop.concept ? this.concepts.find((c) => c.id === stop.concept) : undefined;
      for (const f of concept?.familyIds ?? stop.familyIds ?? []) out.add(f);
    }
    return [...out];
  }

  private stopName(s: RouteStop): string {
    return (s.concept ? this.concepts.find((c) => c.id === s.concept)?.name : s.name) ?? s.id;
  }

  hide() {
    if (this.root.hidden) return;
    this.setActive(false);
    document.body.classList.remove('dynamics-mode');
    clear(this.card);
    this.heroRo?.disconnect();
    this.heroRo = null;
    this.heroCanvas = null;
    this.cursorSent = undefined;
  }

  /** Moves the strip's window and cursor from the shared clock, and the standing figure (about 30 frames a second). */
  update(dt: number) {
    if (this.root.hidden || !this.traj) return;
    if (this.figure?.animated && !this.engine.reduced && this.heroCanvas) {
      this.figT += dt;
      if (this.figT - this.figPainted >= 1 / 30) this.paintHero();
    }
    this.strip.setDomain(this.time.fromU, this.time.toU);
    const u = this.time.mode === 'cursor' ? this.time.cursorU : null;
    if (u === this.cursorSent) return;
    this.cursorSent = u;
    this.strip.setCursor(u);
  }

  /** The occurrence indices of the standing subject, in order of date: for the controller's globe effects. */
  chronology(): number[] {
    return this.traj ? this.traj.points.map((p) => p.i) : [];
  }

  /** The standing subject's trajectory, or null before the first show. */
  get trajectory(): Trajectory | null {
    return this.traj;
  }

  /** Offer (or withdraw) the optional concept data after construction. */
  setConcepts(data: DynamicsData | null) {
    this.concepts = data?.concepts ?? [];
    if (this.subject) this.relate();
    if (!this.root.hidden) { this.renderCard(); this.refreshChrome(); }
    this.onScope();
  }

  /** The inactive panel is out of the keyboard path and the accessibility tree. */
  private setActive(active: boolean) {
    for (const node of [this.root, this.strip.root]) {
      node.hidden = !active;
      node.inert = !active;
      if (active) node.removeAttribute('aria-hidden');
      else node.setAttribute('aria-hidden', 'true');
    }
  }

  private setSubject(subject: Subject) {
    const m = this.model;
    this.subject = subject;
    this.traj = trajectoryOf(m, subject);
    this.palette = paletteOf(m, subject);
    const basins = basinsOf(this.traj);
    this.families = new Set(basins.map((b) => b.familyId));
    const colourOf = (familyId: string) => m.famById.get(familyId)?.palette.core;
    this.strip.setTrajectory(this.traj, this.palette, companions(m, this.traj, COMPANIONS), colourOf);
    this.strip.setLabel(subjectName(m, subject));
    this.cursorSent = undefined;
    this.relate();
    this.basins = basins;
  }

  /** The concepts whose families this subject visits, in the data's order. */
  private relate() {
    this.related = this.concepts.filter((c) => c.familyIds.some((f) => this.families.has(f)));
    this.conceptAt = 0;
  }

  private closeButton() {
    return el('button', { type: 'button', class: 'rv-close', 'aria-label': 'Close the dynamical lens', onclick: () => this.navigate({ view: { kind: 'world' }, deep: false }) }, [closeGlyph()]);
  }

  /**
   * The reveal card: the hero, captioned with the native system it draws (an illustration of the lens, not of the
   * subject), then one concept only when the data offers one. The subject's name is the heading; no line of Jung's is
   * set under the hero.
   */
  private renderCard() {
    if (!this.subject) return;
    if (this.route) { this.renderRoute(); return; }
    this.figure = null;
    clear(this.card);
    const concept = this.related[this.conceptAt];
    this.heroKind = concept?.render ?? 'lorenz';
    const hero = el('figure', { class: 'dy-hero' }, [el('canvas', { class: 'dy-hero-canvas', 'aria-hidden': 'true' }), el('figcaption', { class: 'dy-caption', text: HERO_CAPTION[this.heroKind] })]);
    this.heroCanvas = hero.querySelector('canvas');
    this.heroRo?.disconnect();
    this.heroRo = null;
    if (this.heroCanvas && typeof ResizeObserver !== 'undefined') {
      this.heroRo = new ResizeObserver(() => this.paintHero());
      this.heroRo.observe(this.heroCanvas);
    }
    const text = el('div', { class: 'rv-text' }, [hero]);
    if (concept) text.append(...this.conceptBlock(concept));
    this.card.append(this.closeButton(), el('div', { class: 'rv-body' }, [text]));
    this.paintHero();
  }

  private conceptBlock(c: DynamicsConcept): (HTMLElement | string)[] {
    const out: (HTMLElement | string)[] = [el('h2', { class: 'rv-name dy-name' }, [c.name, ' ', vMark()]), this.quote(c.quote, true)];
    if (c.jung) out.push(this.quote(c.jung, false));
    if (this.related.length > 1) {
      out.push(el('button', { type: 'button', class: 'link-quiet dy-next', text: 'Next', onclick: () => this.step(1) }));
    }
    return out;
  }

  /** One quotation, open, with its page cite and voice mark. A cite is a link only when its work is in the corpus. */
  private quote(q: DynamicsQuote, voice: boolean): HTMLElement {
    const c = q.cite;
    const label = `${c.workTitle}${c.year ? ` (${c.year})` : ''}, ${c.locator}`;
    const cited = c.work && this.passages?.known(c.work)
      ? el('button', { type: 'button', class: 'link-quiet', text: label, title: 'Open the passage in the corpus', onclick: () => this.passages!.open(c.work!, c.locator) })
      : label;
    return el('blockquote', { class: 'dp-def dy-quote' }, [el('p', { text: entered(q.text) }), el('footer', {}, [cited, ' ', voice ? vMark() : jMark()])]);
  }

  private step(delta: number) {
    const n = this.related.length;
    if (!n) return;
    this.conceptAt = (this.conceptAt + delta + n) % n;
    this.renderCard();
  }

  /** A figure canvas with its caption (the system drawn, never the subject), repainted when its box changes. */
  private heroFigure(figure: Figure): HTMLElement {
    this.figure = figure;
    this.figPainted = -1;
    const hero = el('figure', { class: 'dy-hero' }, [el('canvas', { class: 'dy-hero-canvas', 'aria-hidden': 'true' }), el('figcaption', { class: 'dy-caption', text: figure.caption })]);
    this.heroCanvas = hero.querySelector('canvas');
    this.heroRo?.disconnect();
    this.heroRo = null;
    if (this.heroCanvas && typeof ResizeObserver !== 'undefined') {
      this.heroRo = new ResizeObserver(() => this.paintHero());
      this.heroRo.observe(this.heroCanvas);
    }
    return hero;
  }

  private paintFigure(canvas: HTMLCanvasElement, figure: Figure) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const t = this.engine.reduced || !figure.animated ? figure.still : figure.still + this.figT;
    ctx.save();
    figure.draw(ctx, W, H, t, figurePalette(this.palette), dpr);
    ctx.restore();
    this.figPainted = this.figT;
  }

  private go(stop?: string) {
    this.navigate({ view: { kind: 'world' }, deep: false, dynamics: { ...(this.subject && keyOf(this.subject) !== keyOf(selfSubject(this.model)) ? { subject: this.subject } : {}), ...(stop ? { stop } : {}) } });
  }

  /** The route's map: four movements, a dot for each stop, the standing one lit; every dot opens its stop. */
  private routeMap(): HTMLElement {
    const nav = el('nav', { class: 'dy-route', 'aria-label': 'The route through Van Eenwyk' });
    for (const mv of this.route!.movements) {
      const group = el('div', { class: `dy-route-mv${this.stop?.movement === mv ? ' on' : ''}` }, [el('span', { class: 'dy-route-n', text: mv.n, title: mv.title })]);
      for (const s of mv.stops) {
        const name = this.stopName(s);
        group.append(el('button', { type: 'button', class: 'dy-route-dot', 'aria-label': name, title: name, 'aria-current': this.stop?.stop === s ? 'step' : undefined, onclick: () => this.go(s.id) }));
      }
      nav.append(group);
    }
    return nav;
  }

  /** The route: its overview when no stop stands, else the standing stop drawn, quoted and walked on from. */
  private renderRoute() {
    clear(this.card);
    const route = this.route!;
    const text = el('div', { class: 'rv-text' });
    const cur = this.stop;
    if (!cur) {
      text.append(
        this.routeMap(),
        this.heroFigure(figureOf('lorenz')),
        el('h2', { class: 'rv-name dy-name' }, [route.title, ' ', vMark()]),
        el('p', { class: 'rv-para aion-lede', text: route.line }),
      );
      for (const mv of route.movements) {
        text.append(el('section', { class: 'dy-mv' }, [
          el('h3', { class: 'as-h3', text: `${mv.n} · ${mv.title}` }),
          el('p', { class: 'dy-mv-line', text: mv.line }),
          el('div', { class: 'dy-mv-stops' }, mv.stops.map((s) => el('button', { type: 'button', class: 'link-quiet', text: this.stopName(s), onclick: () => this.go(s.id) }))),
        ]));
      }
      text.append(el('button', { type: 'button', class: 'th-walk', onclick: () => this.go(this.stops[0]?.stop.id) }, [el('span', { text: `Begin: ${route.movements[0]?.title ?? ''}` })]));
    } else {
      const s = cur.stop;
      const i = this.stops.indexOf(cur);
      const n = this.stops.length;
      const concept = s.concept ? this.concepts.find((c) => c.id === s.concept) : undefined;
      text.append(
        this.routeMap(),
        el('p', { class: 'aion-date rv-line dy-mv-head' }, [
          el('button', { type: 'button', class: 'link-quiet', text: 'The route', onclick: () => this.go() }),
          ` · ${cur.movement.n} ${cur.movement.title}`,
        ]),
        this.heroFigure(figureOf(s.figure)),
        el('h2', { class: 'rv-name dy-name' }, [this.stopName(s), ' ', concept ? vMark() : '']),
        el('p', { class: 'rv-para aion-lede', text: s.line }),
      );
      if (concept) text.append(this.quote(concept.quote, true));
      if (concept?.jung) text.append(this.quote(concept.jung, false));
      for (const q of s.quotes ?? []) text.append(this.routeQuote(q));
      for (const q of s.ql ?? []) text.append(el('blockquote', { class: 'lq lq-ql' }, [
        el('p', { text: entered(q.text) }),
        el('footer', {}, [el('span', { class: 'lq-voice ql', text: 'QL' }), el('span', { class: 'lq-cite', text: `epi-logos.org, ${q.source.replace(/^W /, '')}` })]),
      ]));
      text.append(el('div', { class: 'th-step dy-step' }, [
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous stop', onclick: () => this.go(this.stops[(i - 1 + n) % n].stop.id) }, ['←']),
        el('span', { class: 'th-count', text: `${i + 1} of ${n}` }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next stop', onclick: () => this.go(this.stops[(i + 1) % n].stop.id) }, ['→']),
      ]));
    }
    this.card.append(this.closeButton(), el('div', { class: 'rv-body' }, [text]));
    this.paintHero();
  }

  /** A further quotation on the route (Neumann, or Van Eenwyk reading Neumann), its voice marked. */
  private routeQuote(q: RouteQuote): HTMLElement {
    const c = q.cite;
    const label = `${c.workTitle}, ${c.locator}${c.print ? ` · p. ${c.print}` : ''}`;
    const cited = this.passages?.known(c.work)
      ? el('button', { type: 'button', class: 'link-quiet', text: label, title: 'Open the passage in the corpus', onclick: () => this.passages!.open(c.work, c.locator) })
      : label;
    const mark = q.voice === 'neumann' ? nMark() : vMark();
    return el('blockquote', { class: 'dp-def dy-quote' }, [el('p', { text: entered(q.text) }), el('footer', {}, [cited, ' ', mark])]);
  }

  /** Arrow-key walking through the route; wired by the controller. False when there is no route to walk. */
  walk(delta: number): boolean {
    if (!this.route || !this.stops.length) return false;
    const i = this.stop ? this.stops.indexOf(this.stop) : -1;
    const n = this.stops.length;
    this.go(this.stops[(i + delta + n) % n].stop.id);
    return true;
  }

  /** The native hero, painted at the box's device size. Deterministic: the same subject paints the same pixels. */
  private paintHero() {
    const canvas = this.heroCanvas;
    if (!canvas || this.root.hidden) return;
    if (this.figure) { this.paintFigure(canvas, this.figure); return; }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = this.palette;
    const kind = this.heroKind;
    if (kind === 'mandelbrot') paintMandelbrot(ctx, canvas.width, canvas.height, p);
    else if (kind === 'julia') paintJulia(ctx, canvas.width, canvas.height, p);
    else paintLorenz(ctx, canvas.width, canvas.height, p);
  }
}
