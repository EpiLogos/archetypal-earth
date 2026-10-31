// THE DYNAMICAL LENS: the field read as a dynamical system (ProjectCentral/docs/DYNAMICAL.md). A third mode beside Aion and the
// Red Book, built to the same pattern: show(state) / hide() / update(dt), a root section, a reveal card.
// The globe is not touched here: the engine is exposed read-only, and the controller owns every globe effect
// (the chronology is offered by chronology() for it to light).
import { citeOfString, loadLensData } from '../lenses/ui';
import { entered, quote, type QuoteCite } from '../ui/quote';
import { averagePalettes, rgbToHex } from '../data/palette';
import { selfSubject, subjectExists, subjectName, subjectPalette, type Model, type Subject } from '../data/model';
import type { GlobeEngine } from '../globe/engine';
import type { TimeModel } from '../state/timeModel';
import { inLens, type AppState } from '../state/store';
import type { Palette } from '../types/field';
import type { DynamicsConcept, DynamicsData, DynamicsQuote, DynamicsRender, DynamicsRoute, RouteMovement, RouteQuote, RouteStop } from '../types/dynamics';
import { el } from '../ui/dom';
import type { PassageBridge } from '../ui/passage';
import { paneStepper } from '../ui/pane';
import { WalkRunner } from '../walk/runner';
import { routeWalk } from './walk';
import { providerLabels } from '../data/labels';
import { theoryContentsGroups } from '../lenses/theory-contents';
import type { ContentsGroup } from '../ui/deep';
import { construction, figureOf, FIGURES, paintFractal, paletteOf as figurePalette, type Figure } from './figures';
import { onPixelRatio, PhaseStrip } from './strip';
import { basinsOf, companions, trajectoryOf, type Basin, type Trajectory } from './trajectory';
import type { LensChrome } from '../shell/lens';

type FractalKind = 'julia' | 'mandelbrot';
interface FractalView {
  kind: FractalKind;
  cx: number;
  cy: number;
  span: number;
  pointers: Map<number, { x: number; y: number }>;
  drag: { x: number; y: number; cx: number; cy: number } | null;
  pinch: number | null;
  coarse: boolean;
}
const FRACTAL_HOME: Record<FractalKind, { cx: number; cy: number; span: number }> = {
  julia: { cx: 0, cy: 0, span: 3.1 },
  mandelbrot: { cx: -0.7453, cy: 0.1127, span: 0.02 },
};

/** Used when neither the subject nor its occupants carry a palette. The world's own resting tone. */
const FALLBACK: Palette = { core: '#c3d2f2', glow: '#4f78cf', fog: '#10193a', deep: '#02030a' };
/** The most-visited basins offered as bare-name links; the rest are on the strip, not in the heading. */
const BASIN_LINKS = 8;
const COMPANIONS = 3;

export interface DynamicsState {
  subject?: Subject;
  stop?: string;
  /** open the walk overview (Theory → Dynamics); not written to the hash */
  route?: true;
}

const keyOf = (s: Subject) => `${s.type}:${s.id}`;

export { selfSubject };

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
  /** the route's stops are walked by the one runner (S9); past the last comes the first */
  private runner: WalkRunner;
  /** Jung's theory, named for the Contents (the Theory lens's own sections) */
  private sections: { id: string; name: string }[] = [];
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
  /** the standing figures and their canvases (the torus stop draws the construction and then the winding) */
  private shots: { canvas: HTMLCanvasElement; figure: Figure; fractal: FractalView | null }[] = [];
  /** seconds since the standing figures were first drawn */
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
    this.runner = new WalkRunner({ scale: model.scale, wrap: true });
    this.root = el('section', { class: 'dynamics', 'aria-label': 'The dynamical lens' }, [this.strip.root]);
    void loadLensData<{ sections: { id: string; name: string }[]; number?: unknown }>('theory')
      .then((d) => { this.sections = [...d.sections.map((x) => ({ id: x.id, name: x.name })), ...(d.number ? [{ id: 'number', name: 'Number' }] : [])]; })
      .catch(() => { /* Jung's theory is then absent from the Contents, as it is where its data is absent */ });
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
    // a stop, a chosen subject or the overview is a reading in the pane; the plain landing leaves the Contents waiting
    this.routeOpen = !!state.stop || !!state.subject || !!state.route;
    this.root.classList.toggle('dy-route-open', this.routeOpen);
    this.refreshChrome();
    this.pane?.contents('Theory', () => this.contentsGroups());
    this.shows++;
    if (this.routeOpen) this.renderCard();
    else { this.runner.interrupt(); this.pane?.hide(); }
    this.onScope();
    this.update(0);
  }

  /** Whether the walk card is open (overview or a stop). Theory landing is false. */
  get isRouteOpen(): boolean {
    return this.routeOpen;
  }

  /** whether the subject was chosen (a deep link or a pick), not the Self the lens lands on */
  private chosen = false;
  private basins: Basin[] = [];
  /** a reading of the route stands in the pane (the overview or a stop); the landing keeps only the Contents */
  private routeOpen = false;
  /** how many times the lens has been shown: an entry that changed nothing is told from one that did */
  private shows = 0;

  private get pane() {
    return this.chrome?.pane;
  }

  /** The Contents of Theory (Jung's theory, the fourteen, the route), the standing stop marked. */
  private contentsGroups(): ContentsGroup[] {
    const sub = this.subject && keyOf(this.subject) !== keyOf(selfSubject(this.model)) ? { subject: this.subject } : {};
    // an entry that is already where the visitor stands changes no state: the pane then reads it again, with the list taken down
    const to = (state: AppState) => { const before = this.shows; this.navigate(state); if (this.shows === before && this.routeOpen) this.renderCard(); };
    return theoryContentsGroups({
      model: this.model,
      theoryTitle: providerLabels().theoryRoute,
      sections: this.sections,
      route: this.route,
      stopName: (st) => this.stopName(st as RouteStop),
      families: this.familiesHere().map((id) => ({ id, name: this.model.famById.get(id)?.name ?? id })),
      at: this.stop ? { kind: 'stop', id: this.stop.stop.id } : this.routeOpen && this.route ? { kind: 'overview' } : { kind: 'none' },
      go: {
        family: (id) => this.navigate({ view: { kind: 'focus', subject: { type: 'family', id } }, deep: false }),
        section: (id) => this.navigate(inLens('theory', id === this.sections[0]?.id ? [] : [id])),
        theoretic: (id) => this.navigate(inLens('theory', ['theoretics', id])),
        overview: () => to({ view: { kind: 'world' }, deep: false, dynamics: { ...sub, route: true } }),
        stop: (id) => to({ view: { kind: 'world' }, deep: false, dynamics: { ...sub, stop: id } }),
      },
    });
  }

  /**
   * The title names what the globe shows. The families the standing subject passes through, and the two readings of Theory,
   * are in the pane's Contents.
   */
  private refreshChrome() {
    if (!this.subject || this.root.hidden) return;
    const m = this.model;
    const standing = this.standing();
    const subject = subjectName(m, this.subject);
    // landing: no context (lens already says Theory); a stop or chosen subject names itself
    const context = !this.routeOpen && !standing ? ''
      : standing ? (this.chosen ? `${standing.name} · ${subject}` : standing.name)
      : this.route && !this.chosen ? this.route.title : subject;
    this.chrome?.setContext(this.routeOpen ? '' : context);
    // the families the standing subject passes through are the Contents' first group (a list that may have changed is read when it opens)
  }

  /** The families the standing stop or subject passes through, for the Contents' first group. */
  private familiesHere(): string[] {
    const standing = this.standing();
    if (this.routeOpen) return [];
    const fams = standing ? standing.familyIds.filter((f) => this.model.famById.has(f)) : this.chosen || !this.route ? this.topBasins() : [];
    return fams;
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
    if (!this.root.hidden) {
      if (this.routeOpen) this.renderCard();
      this.refreshChrome();
    }
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
    this.root.classList.remove('dy-route-open');
    this.routeOpen = false;
    this.pane?.release();
    this.runner.interrupt();
    this.heroRo?.disconnect();
    this.heroRo = null;
    this.shots = [];
    this.cursorSent = undefined;
  }

  /** Moves the strip's window and cursor from the shared clock, and the standing figure (about 30 frames a second). */
  update(dt: number) {
    if (this.root.hidden || !this.traj) return;
    if (this.shots.some((s) => s.figure.animated || s.fractal) && !this.engine.reduced) {
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
    if (!this.root.hidden) {
      if (this.routeOpen) this.renderCard();
      this.refreshChrome();
    }
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

  /**
   * The reveal card: the hero, captioned with the native system it draws (an illustration of the lens, not of the
   * subject), then one concept only when the data offers one. The subject's name is the heading; no line of Jung's is
   * set under the hero.
   */
  private renderCard() {
    if (!this.subject) return;
    if (this.route) { this.renderRoute(); return; }
    this.shots = [];
    this.runner.interrupt();
    const concept = this.related[this.conceptAt];
    this.heroKind = concept?.render ?? 'lorenz';
    const text = el('div', { class: 'rv-text' }, [this.heroFigure(figureOf(this.heroKind))]);
    if (concept) text.append(...this.conceptBlock(concept));
    this.pane?.read({ key: `concept:${concept?.id ?? 'lens'}`, eyebrow: 'Dynamics', nodes: [el('div', { class: 'rv-body dy-reading' }, [text])] });
    this.paintHero();
  }

  private conceptBlock(c: DynamicsConcept): (HTMLElement | string)[] {
    const out: (HTMLElement | string)[] = [el('h2', { class: 'rv-name dy-name' }, [c.name]), this.quote(c.quote, true)];
    if (c.jung) out.push(this.quote(c.jung, false));
    if (this.related.length > 1) {
      out.push(el('button', { type: 'button', class: 'link-quiet dy-next', text: 'Next', onclick: () => this.step(1) }));
    }
    return out;
  }

  /** A cite as the Quote component takes it: the Work by registry key; where the data holds only a title, by its title. */
  private citeOf(c: { work?: string; workTitle: string; locator: string; print?: string }): QuoteCite | string {
    if (c.work) return { work: this.model.workKey.get(c.work) ?? c.work, workTitle: c.workTitle, locator: c.locator, ...(c.print ? { print: c.print } : {}) };
    return citeOfString(this.model, `${c.workTitle} ${c.locator}`);
  }

  /** One quotation, open: the one Quote component. `other` is Van Eenwyk's reading; the Jung text wears no voice. */
  private quote(q: DynamicsQuote, other: boolean): HTMLElement {
    return quote({ text: q.text, cite: this.citeOf(q.cite), ...(other ? { voice: 'vaneenwyk' } : {}) }, { passages: this.passages ?? undefined });
  }

  private step(delta: number) {
    const n = this.related.length;
    if (!n) return;
    this.conceptAt = (this.conceptAt + delta + n) % n;
    this.renderCard();
  }

  /** A figure canvas, with no subheading. A fractal can be dragged and zoomed. Repainted when its box changes. */
  private heroFigure(figure: Figure): HTMLElement {
    this.figPainted = -1;
    const fractal = figure === FIGURES.julia ? this.freshFractal('julia') : figure === FIGURES.mandelbrot ? this.freshFractal('mandelbrot') : null;
    const canvas = el('canvas', { class: fractal ? 'dy-hero-canvas dy-fractal' : 'dy-hero-canvas', 'aria-hidden': 'true' }) as HTMLCanvasElement;
    const hero = el('figure', { class: 'dy-hero' }, [canvas]);
    const shot = { canvas, figure, fractal };
    this.shots.push(shot);
    if (fractal) this.wireFractal(shot);
    if (!this.heroRo && typeof ResizeObserver !== 'undefined') {
      this.heroRo = new ResizeObserver(() => this.paintHero());
    }
    this.heroRo?.observe(canvas);
    return hero;
  }

  private freshFractal(kind: FractalKind): FractalView {
    const home = FRACTAL_HOME[kind];
    return { kind, cx: home.cx, cy: home.cy, span: home.span, pointers: new Map(), drag: null, pinch: null, coarse: false };
  }

  /** Drag to move through the set; wheel or pinch to go closer. A drag paints a coarser tile and finishes sharp. */
  private wireFractal(shot: { canvas: HTMLCanvasElement; fractal: FractalView | null }) {
    const canvas = shot.canvas;
    const view = shot.fractal!;
    const scale = () => view.span / Math.max(canvas.clientWidth, canvas.clientHeight);
    const paint = (coarse: boolean) => { view.coarse = coarse; this.paintHero(); };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      view.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (view.pointers.size === 1) view.drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
      else view.drag = null;
      view.pinch = view.pointers.size === 2 ? this.pinchDistance(view) : null;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!view.pointers.has(e.pointerId)) return;
      view.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (view.pointers.size === 2 && view.pinch) {
        const d = this.pinchDistance(view);
        if (d > 0) view.span = this.clampSpan(view.kind, view.span * (view.pinch / d));
        view.pinch = d;
        paint(true);
        return;
      }
      if (!view.drag) return;
      const s = scale();
      view.cx = view.drag.cx - (e.clientX - view.drag.x) * s;
      view.cy = view.drag.cy + (e.clientY - view.drag.y) * s;
      paint(true);
    });
    const end = (e: PointerEvent) => {
      view.pointers.delete(e.pointerId);
      if (view.pointers.size < 2) view.pinch = null;
      if (!view.pointers.size) { view.drag = null; paint(false); }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0014);
      const next = this.clampSpan(view.kind, view.span * factor);
      const s = scale();
      const rect = canvas.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      view.cx += dx * (s - next / Math.max(canvas.clientWidth, canvas.clientHeight));
      view.cy -= dy * (s - next / Math.max(canvas.clientWidth, canvas.clientHeight));
      view.span = next;
      paint(false);
    }, { passive: false });
  }

  private pinchDistance(view: FractalView): number {
    const pts = [...view.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private clampSpan(kind: FractalKind, span: number): number {
    const [lo, hi] = kind === 'mandelbrot' ? [1e-5, 3.2] : [0.02, 6];
    return Math.min(hi, Math.max(lo, span));
  }

  private paintFigure(canvas: HTMLCanvasElement, figure: Figure, fractal: FractalView | null) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    if (fractal) paintFractal(ctx, W, H, fractal.kind, [fractal.cx, fractal.cy], fractal.span, figurePalette(this.palette), fractal.coarse);
    else {
      const t = this.engine.reduced || !figure.animated ? figure.still : figure.still + this.figT;
      figure.draw(ctx, W, H, t, figurePalette(this.palette), dpr);
    }
    ctx.restore();
    this.figPainted = this.figT;
  }

  private go(stop?: string) {
    this.navigate({ view: { kind: 'world' }, deep: false, dynamics: { ...(this.subject && keyOf(this.subject) !== keyOf(selfSubject(this.model)) ? { subject: this.subject } : {}), ...(stop ? { stop } : { route: true as const }) } });
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
    this.shots = [];
    this.figT = 0;
    this.heroRo?.disconnect();
    this.heroRo = null;
    const route = this.route!;
    const text = el('div', { class: 'rv-text' });
    const cur = this.stop;
    let foot: Node[] | null = null;
    if (!cur) {
      this.runner.interrupt();
      text.append(
        this.routeMap(),
        this.heroFigure(figureOf('lorenz')),
        el('h2', { class: 'rv-name dy-name' }, [route.title]),
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
      // the walk: the runner stands on this stop (it begins here when the route is entered at a stop)
      if (this.runner.active) this.runner.goto(i); else this.runner.start(routeWalk(this.model.walkById, route), { u: 0, focus: null, reading: null, centre: null, walk: null }, i);
      foot = paneStepper({ prev: 'Previous stop', next: 'Next stop' }, `${i + 1} / ${n}`, () => this.walk(-1), () => this.walk(1), {}, { prev: this.stopName(this.stops[(i - 1 + n) % n].stop), next: this.stopName(this.stops[(i + 1) % n].stop) });
      text.append(
        this.routeMap(),
        el('p', { class: 'aion-date rv-line dy-mv-head' }, [
          el('button', { type: 'button', class: 'link-quiet', text: 'The route', onclick: () => this.go() }),
          ` · ${cur.movement.n} ${cur.movement.title}`,
        ]),
        ...(s.figure === 'torus' ? [this.heroFigure(construction)] : []),
        this.heroFigure(figureOf(s.figure)),
        el('h2', { class: 'rv-name dy-name' }, [this.stopName(s)]),
        el('p', { class: 'rv-para aion-lede', text: s.line }),
      );
      if (concept) text.append(this.quote(concept.quote, true));
      if (concept?.jung) text.append(this.quote(concept.jung, false));
      for (const q of s.quotes ?? []) text.append(this.routeQuote(q));
      for (const q of s.ql ?? []) text.append(quote({ kind: 'ql', text: entered(q.text), source: q.source }));
    }
    this.pane?.read({ key: cur ? `stop:${cur.stop.id}` : 'route', eyebrow: 'Dynamics', nodes: [el('div', { class: 'rv-body dy-reading' }, [text])], foot });
    // where the map scrolls sideways (a phone), the standing stop is brought into its view
    const map = text.querySelector<HTMLElement>('.dy-route');
    const on = map?.querySelector<HTMLElement>('[aria-current=step]');
    if (map && on && map.scrollWidth > map.clientWidth) map.scrollLeft = on.offsetLeft - map.offsetLeft - map.clientWidth / 2 + on.offsetWidth / 2;
    this.paintHero();
  }

  /** A further quotation on the route (Neumann, or Van Eenwyk reading Neumann), its voice named by the component. */
  private routeQuote(q: RouteQuote): HTMLElement {
    return quote({ text: q.text, cite: this.citeOf(q.cite), ...(q.voice ? { voice: q.voice } : {}) }, { passages: this.passages ?? undefined });
  }

  /** Arrow-key walking and the pane's stepper: the runner names the neighbour, past either end comes the other. False when there is no route to walk. */
  walk(delta: number): boolean {
    if (!this.route || !this.stops.length) return false;
    let step;
    if (this.runner.active) step = delta > 0 ? this.runner.next() : this.runner.prev();
    else step = this.runner.start(routeWalk(this.model.walkById, this.route), { u: 0, focus: null, reading: null, centre: null, walk: null }, delta > 0 ? 0 : this.stops.length - 1);
    const id = step?.stop.subject?.id;
    if (!id) return false;
    this.go(id);
    return true;
  }

  /** Every standing figure, at the box's device size. A fractal uses the view the pointer has reached. */
  private paintHero() {
    if (this.root.hidden) return;
    for (const shot of this.shots) this.paintFigure(shot.canvas, shot.figure, shot.fractal);
  }
}
