// THE DYNAMICAL LENS: the field read as a dynamical system (docs/DYNAMICAL.md). A third mode beside Aion and the
// Red Book, built to the same pattern: show(state) / hide() / update(dt), a root section, a reveal card.
// The globe is not touched here: the engine is exposed read-only, and the controller owns every globe effect
// (the chronology is offered by chronology() for it to light).
import { averagePalettes, rgbToHex } from '../data/palette';
import { subjectExists, subjectName, subjectPalette, type Model, type Subject } from '../data/model';
import type { GlobeEngine } from '../globe/engine';
import type { TimeModel } from '../state/timeModel';
import { inLens, type AppState } from '../state/store';
import type { Palette } from '../types/field';
import type { DynamicsConcept, DynamicsData, DynamicsQuote, DynamicsRender } from '../types/dynamics';
import { clear, el } from '../ui/dom';
import type { PassageBridge } from '../ui/passage';
import { closeGlyph } from '../ui/reveal';
import { jMark, vMark } from './marks';
import { paintJulia, paintLorenz, paintMandelbrot } from './paint';
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
    this.chrome?.setContext(`${subjectName(this.model, requested)} as a dynamical system`);
    this.chrome?.setControls([this.heading]);
    this.renderCard();
    this.update(0);
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

  /** Moves the strip's window and cursor from the shared clock. Cheap when nothing moved. */
  update(_dt: number) {
    if (this.root.hidden || !this.traj) return;
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
    if (!this.root.hidden) this.renderCard();
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
    this.buildHeading(subject, basins);
  }

  /** The concepts whose families this subject visits, in the data's order. */
  private relate() {
    this.related = this.concepts.filter((c) => c.familyIds.some((f) => this.families.has(f)));
    this.conceptAt = 0;
  }

  private buildHeading(subject: Subject, basins: Basin[]) {
    clear(this.heading);
    const m = this.model;
    // the most-visited families the subject passes through, as bare names, in the order they were first visited
    const top = new Set(
      [...basins]
        .filter((b) => !(subject.type === 'family' && b.familyId === subject.id))
        .sort((a, b) => b.count - a.count || (a.familyId < b.familyId ? -1 : 1))
        .slice(0, BASIN_LINKS)
        .map((b) => b.familyId),
    );
    const links = basins.filter((b) => top.has(b.familyId)).map((b) => el('button', { type: 'button', class: 'link-quiet', text: m.famById.get(b.familyId)?.name ?? b.familyId,
      onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'family', id: b.familyId } }, deep: false }) }));
    this.heading.append(
      el('nav', { class: 'dy-basins', 'aria-label': 'Families visited' }, links),
      el('button', { type: 'button', class: 'link-quiet dy-theory', text: 'Read the theory', onclick: () => this.navigate(inLens('theory', ['transcendent-function'])) }),
    );
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
    return el('blockquote', { class: 'dp-def dy-quote' }, [el('p', { text: q.text }), el('footer', {}, [cited, ' ', voice ? vMark() : jMark()])]);
  }

  private step(delta: number) {
    const n = this.related.length;
    if (!n) return;
    this.conceptAt = (this.conceptAt + delta + n) % n;
    this.renderCard();
  }

  /** The native hero, painted at the box's device size. Deterministic: the same subject paints the same pixels. */
  private paintHero() {
    const canvas = this.heroCanvas;
    if (!canvas || this.root.hidden) return;
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
