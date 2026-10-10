// The conductor: owns the state machine, the hash, and the choreography between
// the globe (camera, atmosphere, emphasis, arcs) and the quiet DOM layers.
import type { Model, Subject } from '../data/model';
import { archetypesOfFamily, selfSubject, subjectExists, subjectLine, subjectName, subjectOccurrences, subjectPalette } from '../data/model';
import { angleBetween, dirFromLatLon, fitDistance, spreadOf, worldDistance, type Vec3 } from '../data/geo';
import { averagePalettes, rgbToHex, WORLD_PALETTE, type RGBPalette } from '../data/palette';
import { buildSearchIndex, type SearchResult } from '../data/search';
import { planThread, type ThreadStep } from '../data/thread';
import { FOV, type GlobeEngine } from '../globe/engine';
import { chronologyPath } from '../globe/chronology';
import { defaultReadingId, hashToState, hashWithFilter } from '../state/router';
import { back, focusOn, inLens, inSky, openedFrom, startThread, stateEq, threadSubject, viewEq, withMode, WORLD, type AppState, type PanelLensId, type ThreadTarget, type View } from '../state/store';
import { Shell } from '../shell/shell';
import { Panel } from '../shell/panel';
import { Landing } from '../shell/landing';
import { lensOf, PANEL_LOADERS, type LensChrome, type LensContext, type LensId, type LensInstance } from '../shell/lens';
import { filterEq, isEmpty, maskOf, passes, type FieldFilter } from '../shell/filter';
import { subjectSpan, uSpan, type TimeModel, type TimeSnapshot, type TimeSpan } from '../state/timeModel';
import { DEFAULT_RAMP } from '../data/time';
import { FocusLabel, type LabelContent } from '../ui/focus-label';
import { DeepSheet, type DeepTarget } from '../ui/deep';
import { Floats, type FloatItem, type FloatTarget } from '../ui/floats';
import { HoverLabel } from '../ui/hover-label';
import { Reveal } from '../ui/reveal';
import { SearchUI } from '../ui/search';
import { Strip } from '../ui/strip';
import { TimeControl } from '../ui/time-control';
import { el, isNarrow, onReadGesture } from '../ui/dom';
import { eraShort } from '../data/text';
import type { GraphView, Insets } from '../graph/view';
import { ModeSwitch } from '../graph/switch';
import type { AionView } from '../aion/view';
import type { History } from '../types/history';
import type { CorpusIndex } from '../types/corpus';
import type { RedBook } from '../types/redbook';
import type { RedBookView } from '../redbook/view';
import type { DynamicsView } from '../dynamics/view';
import { PassageSheet } from '../ui/passage';
import { loadSky } from '../sky/load';
import { SkyEphemeris } from '../sky/ephemeris';
import { SkyLive } from '../sky/live';
import type { SkyAnchorSource } from '../graph/build';
import type { SidecarChart, SkyData } from '../types/sky';
import { SkyLayer } from '../sky/layer';
import { SkyView } from '../sky/view';
import { SkyCard, canOpenCard, formatMoment, resolveTies } from '../sky/card';
import { BirthPanel } from '../sky/birth';
import { chartMoment } from '../sky/chart';
import { dataWithWindow, SidecarClient, SidecarError, type BirthInput } from '../sky/sidecar';
import { SkyTies } from '../sky/ties';
import { systemViewLatLon } from '../sky/frames';
import { approachDist, isApproachBody, skyMaxDist, SETTLE, STAGE_EDGES, SKY_ENTER, SKY_EXIT, SYSTEM_VIEW_ELEVATION, systemHomeDist, systemViewAzimuth } from '../sky/stages';
import type { BodyKey } from '../types/sky';

// outside a focus the field recedes to a presence, never to a wall: everything stays pickable
const REL_RECEDED = 0.07;
const REL_RELATED = 1.5;

interface Tour {
  steps: ThreadStep[];
  i: number;
  playing: boolean;
  phase: 'intro' | 'fly' | 'dwell' | 'done';
  timer: number;
  tok: number;
  draw: number; // 0..1 intro draw progress
  head: number;
  subject: Subject;
  target: ThreadTarget;
}

/** The local ephemeris sidecar's address; a site build can point it elsewhere with VITE_EPHEMERIS_URL. */
const SIDECAR_BASE = (import.meta.env.VITE_EPHEMERIS_URL as string | undefined) ?? 'http://127.0.0.1:5187';
/** A deployed copy of the site never talks to a sidecar: only a page served from this machine does. */
const isLocalHost = (): boolean => {
  const host = typeof location === 'undefined' ? '' : location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
};

export class Controller {
  state: AppState = WORLD;
  private started = false;
  private pendingHash: string | null = null;
  private rel: Float32Array;
  private searchIndex;
  private floats: Floats;
  private label: FocusLabel;
  private reveal: Reveal;
  private deep: DeepSheet;
  private strip: Strip;
  private hover: HoverLabel;
  private timeControl: TimeControl;
  private search: SearchUI;
  private tour: Tour | null = null;
  private timeSnap: TimeSnapshot | null = null;
  private setCache: { key: string; set: Set<number> } = { key: '', set: new Set() };
  private tokCounter = 0;
  private labelRect = { x: 0, y: 0, w: 380, h: 170 };
  /** the views a lens or the graph needs are fetched when first used (MODES-RFC §7); null until then */
  private graph: GraphView | null = null;
  private loading = new Map<string, Promise<void>>();
  private navTok = 0;
  private root: HTMLElement;
  private passages: ReturnType<PassageSheet['bridge']>;
  private modeSwitch: ModeSwitch;
  /** true while the graph mode (not the globe) is the main view */
  private graphMode = false;
  private pauseTimer = 0;
  private aion: AionView | null = null;
  /** the one frame of chrome (MODES-RFC §2) and its panel for the panel lenses */
  readonly shell: Shell;
  private panel: Panel;
  private chrome: LensChrome;
  /** the field filter (MODES-RFC §4): one for every lens; the engine composes it with any emphasis */
  private filter: FieldFilter = {};
  private filterMask: Float32Array | null = null;
  private lensInst = new Map<PanelLensId, LensInstance>();
  private activeLens: PanelLensId | null = null;
  private lensTok = 0;
  private landing = new Landing();
  private aionTime: TimeSnapshot | null = null;
  private redbook: RedBookView | null = null;
  private rbTime: TimeSnapshot | null = null;
  /** the range the control held before the Red Book (restored with rbTime), and the Book's own span on the scale */
  private rbRange: TimeSpan | null = null;
  private rbSpan: TimeSpan | null = null;
  /** the dynamical lens: a third mode over the world view; its clock and range are restored on leaving (as the Red Book's are) */
  private lens: DynamicsView | null = null;
  private lensTime: TimeSnapshot | null = null;
  private lensRange: TimeSpan | null = null;
  /** the focused subject whose chronology stands on the globe (empty: none) */
  private chronoKey = '';
  private redbookStops = new Set<string>();
  /** the corpus reading sheet: a cite opened at its source */
  private passage: PassageSheet;
  // the sky: a scale of the same globe, reached by the zoom gesture, by S, or by link
  private skyView: SkyView;
  private skyCard: SkyCard;
  private skyTies = new SkyTies();
  private skyLayer: SkyLayer | null = null;
  private birthPanel: BirthPanel;
  private sidecar: SidecarClient;
  /** the chart standing in the sky, once the sidecar has answered; null in the present sky */
  private birthChart: SidecarChart | null = null;
  private birthGen = 0;
  private layerWaiters: ((l: SkyLayer | null) => void)[] = [];
  private skyRequested = false;
  private skyFailed = false;
  /** the next sky transition came from the user's own zoom: the camera is theirs, do not fly it */
  private skyByGesture = false;
  private pendingSkyEntry: 'instant' | 'fly' | null = null;
  /** the planet or Sun the camera is approaching for its open card, as the layer was last told (null: none) */
  private approachOn: BodyKey | null = null;
  /** bumped by each change of approach: a flight's follow-on from an earlier change does nothing */
  private approachTok = 0;

  constructor(private m: Model, private engine: GlobeEngine, private time: TimeModel, root: HTMLElement, private history?: History, corpus?: CorpusIndex | null, private redbookData?: RedBook) {
    this.root = root;
    this.rel = new Float32Array(m.occ.length);
    this.searchIndex = buildSearchIndex(m);

    this.passage = new PassageSheet(root, corpus ?? null);
    const passages = this.passage.bridge();
    this.passages = passages;
    const openCite = (work: string, locator: string) => void this.passage.show(work, locator);

    this.floats = new Floats(root, (t) => this.onFloatSelect(t));
    this.floats.obstacles = () => [this.labelRect];
    this.label = new FocusLabel(root);
    // the focus card: a double-click opens the subject's reading, as its 'Reading' link does
    onReadGesture(this.label.root, () => { if (this.state.view.kind === 'focus') this.setDeep(true); });
    this.reveal = new Reveal(root, m, {
      onParallel: (id) => this.openOccurrenceId(id),
      onThread: () => this.followThread(),
      onParallelThread: () => this.followParallels(),
      onDeep: () => this.setDeep(true),
      onClose: () => this.stepBack(),
      onFamily: id => this.navigate(focusOn(this.state, { type: 'family', id })),
      onBody: (key) => this.openBody(key),
    }, this.skyTies);
    this.deep = new DeepSheet(root, m, {
      onClose: () => this.setDeep(false),
      onSubject: (s) => this.navigate(focusOn(this.state, s)),
      onOccurrence: (id) => this.openOccurrenceId(id),
      onCite: openCite,
      passage: passages,
    });
    this.strip = new Strip(root, m, {
      onSelect: (i) => this.tourJump(i),
      onOpen: (i) => this.tour && this.openOccurrence(this.tour.steps[i].occ),
      onRead: (i) => this.tourRead(i),
    });
    this.hover = new HoverLabel(root);
    this.timeControl = new TimeControl(root, m, time, () => this.onUserTime());
    this.timeControl.setTour(null, () => this.tourToggle());
    this.search = new SearchUI(root, this.searchIndex, (r) => this.chooseResult(r), (open) => {
      document.body.classList.toggle('search-open', open);
      if (open) this.hover.hide();
    });

    // the shell: one title, one menu, the filter, the corners. Every lens fills its chrome through it.
    const workNames = new Map<string, string>();
    for (const o of m.occ) for (const c of o.jung) if (!workNames.has(c.work)) workNames.set(c.work, c.workTitle);
    this.shell = new Shell(document.body, {
      onLens: (id) => this.openLens(id),
      onSearch: (anchor) => this.search.open(anchor),
      onFilter: (f) => this.setFilter(f),
      countFor: (f) => m.occ.reduce((n, o) => n + (passes(o, f) ? 1 : 0), 0),
      works: [...workNames].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      cultures: m.field.cultures.filter((c) => c.occurrenceCount > 0).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    });
    this.chrome = { setContext: (t) => this.shell.setContext(t), setControls: (n) => this.shell.setControls(n) };
    this.panel = new Panel(root, () => this.stepBack());

    // the graph: a second view of the same field, between the globe and the quiet overlay
    this.modeSwitch = new ModeSwitch(document.body, () => this.toggleMode());

    const redbook = redbookData;
    if (redbook) for (const stop of redbook.stops) this.redbookStops.add(stop.id);
    if (redbook) this.rbSpan = uSpan(redbook.stops.map((s) => m.occIndex.get(s.id)).filter((i): i is number => i !== undefined).map((i) => m.u[i]), this.fullSpan());

    // the concept data is optional (absent is the normal state, shown as none); a malformed file is reported, never hidden

    this.skyView = new SkyView(root, {
      onBody: (key) => this.onSkyPick(key),
      nameOf: (key) => this.skyName(key),
    });
    this.skyCard = new SkyCard(root, {
      onField: (t) => this.navigate(focusOn(WORLD, t)),
      onOccurrence: (id) => this.openOccurrenceId(id),
      onReading: (target) => this.openSubjectReading(target),
      onClose: () => this.stepBack(),
      passage: this.passage.bridge(),
    });
    this.sidecar = new SidecarClient({ base: SIDECAR_BASE, local: isLocalHost() });
    this.birthPanel = new BirthPanel(this.skyView.birthHost, {
      onCast: (b) => this.castBirth(b),
      onLeave: () => this.leaveBirth(),
      onBody: (key) => this.navigate(inSky({ ...(this.state.sky ?? {}), body: key })),
      onField: (t) => this.navigate(focusOn(WORLD, t)),
      onDraw: (o) => this.skyLayer?.chart.setOptions(o),
      lookup: (q) => this.sidecar.geocode(q),
      descent: (key) => this.birthDescent(key),
      nameOf: (key) => this.skyName(key),
      onOpen: () => void this.probeSidecar(),
    });
    // the Earth ⇄ Graph pill is the Field's own control: it stands beside the lens button while the Field is the lens
    this.shell.setAside(this.modeSwitch.root);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('hashchange', this.onHash);
    window.addEventListener('resize', () => { this.syncRig(); this.syncShift(); this.strip.recenter(); this.measureLabel(); this.syncGraphInsets(); });
    engine.onFrame((dt) => this.tick(dt));
    // the sky's data is fetched at idle, so the first pull-back never waits on it (audit S3 (d)); never on the boot path
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => this.requestSky(), { timeout: 4000 });
    else window.setTimeout(() => this.requestSky(), 1500);
  }

  /** The distance at which the whole earth sits in view for this viewport. */
  private worldDist(): number {
    return worldDistance(this.engine.width / Math.max(1, this.engine.height), FOV);
  }

  private syncRig() {
    // once the sky has loaded the pull-back is one continuous gesture, out to past Neptune; until then it resists beyond the
    // atlas's own limit, toward the sky's, so the first pull-back never stalls and then jumps (audit S3 (d))
    const aspect = this.engine.width / Math.max(1, this.engine.height);
    const rig = this.engine.rig;
    if (this.skyLayer) {
      rig.maxDist = skyMaxDist(aspect, FOV);
      rig.softMaxDist = 0;
    } else {
      rig.maxDist = Math.max(5.4, this.worldDist() + 0.9);
      rig.softMaxDist = this.skyFailed ? 0 : skyMaxDist(aspect, FOV);
    }
  }

  // ── engine callbacks ──────────────────────────────────────────────────
  onInteract() {
    document.body.classList.add('interacted');
    this.landing.dismiss();
  }

  onGrab() {
    this.aion?.pauseThread();
    if (this.tour && this.tour.playing && this.tour.phase !== 'intro') this.tourPause();
  }

  onUserTime() {
    this.aion?.pauseThread();
    // scrubbing the time control takes the cursor from a running tour
    if (this.tour && this.tour.playing) this.tourPause();
    this.engine.rig.interacted = true;
  }

  onHover(idx: number, x: number, y: number) {
    document.body.classList.toggle('hovering', idx >= 0);
    if (idx < 0 || this.search.isOpen) {
      this.hover.hide();
      this.engine.markers.hover.hide();
      return;
    }
    const o = this.m.occ[idx];
    this.hover.show(o.id, o.label, eraShort(o.yearDisplay, 26), x, y);
    const sel = this.state.view.kind === 'manifest' ? this.m.occIndex.get(this.state.view.occId) : -1;
    if (idx !== sel) this.engine.markers.hover.show(this.m.dir[idx], this.m.colour[idx]);
    else this.engine.markers.hover.hide();
  }

  onPick(idx: number) {
    if (idx < 0 || this.search.isOpen) return;
    const o = this.m.occ[idx];
    const v = this.state.view;
    if (v.kind === 'world') {
      this.navigate(focusOn(this.state, { type: 'family', id: o.familyId }));
    } else if (v.kind === 'focus') {
      if (this.inSubject(v.subject, idx)) this.openOccurrence(idx);
      else this.navigate(focusOn(this.state, { type: 'family', id: o.familyId }));
    } else {
      this.openOccurrence(idx);
    }
  }

  // ── navigation ────────────────────────────────────────────────────────
  boot() {
    this.syncRig();
    const rig = this.engine.rig;
    rig.dist = rig.targetDist = this.worldDist();
    const parsed = hashToState(location.hash, this.resolver());
    if (parsed.year !== undefined) {
      this.time.scrub(this.m.scale.toU(parsed.year));
      this.time.pause();
    }
    this.applyFilter(parsed.filter);
    const go = () => {
      this.apply(parsed.state);
      this.started = true;
      this.syncHash(parsed.state, true);
      // the globe is the landing: on a first visit to the plain world, one line and one action that flies to the Self
      if (stateEq(parsed.state, WORLD) && isEmpty(parsed.filter)) this.landing.maybeShow(document.body, () => this.navigate(focusOn(WORLD, selfSubject(this.m))));
    };
    if (!this.whenReady(parsed.state, go)) go();
  }

  private resolver() {
    const m = this.m;
    return {
      hasArchetype: (id: string) => m.archById.has(id),
      hasFamily: (id: string) => m.famById.has(id),
      hasCulture: (id: string) => m.cultureById.has(id),
      hasPlace: (id: string) => m.places.has(id),
      familyOf: (id: string) => {
        const i = m.occIndex.get(id);
        return i === undefined ? undefined : m.occ[i].familyId;
      },
      hasBody: (id: string) => !!this.skyLayer?.data.bodies.some((b) => b.key === id) || ['sun', 'moon', 'earth', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'].includes(id),
      hasReading: (id: string) => !!this.history?.readings.some(r => r.id === id),
      hasHistorySelection: (id: string, kind: string, selection: string) => {
        const reading = this.history?.readings.find(r => r.id === id);
        return !!reading && (kind === 'epoch' ? reading.epochs : kind === 'event' ? reading.events : reading.threads).some(x => x.id === selection);
      },
      hasRedBookStop: (id: string) => this.redbookStops.has(id),
      defaultReading: () => defaultReadingId(this.history?.readings ?? []),
    };
  }

  private onHash = () => {
    const h = location.hash;
    if (this.pendingHash !== null && h === this.pendingHash) {
      this.pendingHash = null;
      return;
    }
    this.pendingHash = null;
    const parsed = hashToState(h, this.resolver());
    if (parsed.year !== undefined) {
      this.time.scrub(this.m.scale.toU(parsed.year));
    }
    if (!filterEq(parsed.filter, this.filter)) this.applyFilter(parsed.filter);
    if (!this.whenReady(parsed.state, () => this.apply(parsed.state))) this.apply(parsed.state);
  };

  private syncHash(s: AppState, replace = false) {
    const h = hashWithFilter(s, this.filter);
    if (location.hash === h || (h === '#/' && (location.hash === '' || location.hash === '#'))) return;
    if (replace) {
      history.replaceState(null, '', h);
      return;
    }
    this.pendingHash = h;
    location.hash = h;
  }

  // ── views fetched on first use (MODES-RFC §7) ──────────────────────────
  /** The view modules a state needs that are not loaded yet; null when everything it needs is here. */
  private needs(next: AppState): Promise<void> | null {
    const jobs: Promise<void>[] = [];
    if (next.graph && !this.graph) jobs.push(this.ensure('graph', () => import('../graph/view').then(({ GraphView }) => {
      this.graph = new GraphView(document.body, this.m, this.time, {
        onSelect: (key) => this.onGraphSelect(key),
        onEarth: (key) => this.onGraphEarth(key),
        loadSky: () => this.skyAnchors(),
      }, this.engine.reduced);
      this.root.before(this.graph.root);
    })));
    if (next.history && !this.aion && this.history) jobs.push(this.ensure('aion', () => import('../aion/view').then(({ AionView }) => {
      this.aion = new AionView(this.root, this.m, this.engine, this.time, this.history!, (state) => this.navigate(state), this.passages, (occId) => this.openReading(occId), this.chrome);
    })));
    if (next.redbook && !this.redbook && this.redbookData) jobs.push(this.ensure('redbook', () => import('../redbook/view').then(({ RedBookView }) => {
      this.redbook = new RedBookView(this.root, this.m, this.engine, this.redbookData!, (state) => this.navigate(state), (id) => this.tuneToFolio(id), (occId) => this.openReading(occId), this.chrome);
    })));
    if (next.dynamics && !this.lens) jobs.push(this.ensure('dynamics', () => Promise.all([import('../dynamics/view'), import('../dynamics/load')]).then(([{ DynamicsView }, { loadDynamics }]) => {
      const lens = new DynamicsView(this.root, this.m, this.engine, this.time, (state) => this.navigate(state), this.passages, null, this.chrome);
      this.lens = lens;
      // the concept data is optional (absent is the normal state, shown as none); a malformed file is reported, never hidden
      void loadDynamics().then((data) => lens.setConcepts(data)).catch((err) => console.error(err));
    })));
    return jobs.length ? Promise.all(jobs).then(() => undefined) : null;
  }

  private ensure(key: string, load: () => Promise<void>): Promise<void> {
    let p = this.loading.get(key);
    if (!p) {
      p = load().catch((err) => { this.loading.delete(key); throw err; });
      this.loading.set(key, p);
    }
    return p;
  }

  /**
   * Run `go` once what `next` needs is loaded. Only the latest request runs: a navigation made while a view is still
   * loading replaces the one that was waiting. A view that fails to load leaves the world as it is, said in the console.
   */
  private whenReady(next: AppState, go: () => void): boolean {
    const tok = ++this.navTok;
    const wait = this.needs(next);
    if (!wait) return false;
    document.body.classList.add('lens-loading');
    wait.then(() => { document.body.classList.remove('lens-loading'); if (tok === this.navTok) go(); })
      .catch((err) => { document.body.classList.remove('lens-loading'); console.error(err); });
    return true;
  }

  navigate(next: AppState, opts: { replace?: boolean } = {}) {
    this.landing.dismiss();
    next = this.lensRoute(next);
    if (this.whenReady(next, () => this.navigate(next, opts))) return;
    if (stateEq(next, this.state)) return;
    if (next.view.kind === 'thread') {
      const t = next.view.target;
      if (this.plan(t.type, t.id).length < 2) next = { view: next.view.from, deep: false };
      if (stateEq(next, this.state)) return;
    }
    this.apply(next);
    this.syncHash(next, opts.replace);
  }

  /** Inside the lens a subject is picked, not left: a focus becomes the lens on that subject, over the same world view. */
  private lensRoute(next: AppState): AppState {
    if (!this.state.dynamics || next.dynamics || next.view.kind !== 'focus') return next;
    return { view: { kind: 'world' }, deep: false, dynamics: { subject: next.view.subject } };
  }

  stepBack() {
    if (this.passage.isOpen) {
      this.passage.hide();
      return;
    }
    if (this.search.isOpen) {
      this.search.close();
      return;
    }
    this.navigate(back(this.state));
  }

  private setDeep(deep: boolean) {
    if (this.state.view.kind === 'world') return;
    this.navigate({ ...this.state, deep });
  }

  private openOccurrence(idx: number) {
    this.openOccurrenceId(this.m.occ[idx].id);
  }

  private openOccurrenceId(id: string) {
    const next = this.occurrenceState(this.state, id);
    if (next) this.navigate(next);
  }

  /** A thumbnail's double-click: the step (if it is not already the current one), then its reading, in the thread. */
  private tourRead(i: number) {
    const t = this.tour;
    if (!t || !t.steps[i]) return;
    if (t.i !== i) this.tourJump(i);
    const next = this.occurrenceState(this.state, this.m.occ[t.steps[i].occ].id);
    if (next) this.navigate({ ...next, deep: true });
  }

  /** The manifestation state for an occurrence, keeping the context it was reached from when it still holds. */
  private occurrenceState(s: AppState, id: string): AppState | null {
    const i = this.m.occIndex.get(id);
    if (i === undefined) return null;
    const o = this.m.occ[i];
    const famSubject: Subject = { type: 'family', id: o.familyId };
    const v = s.view;
    let ctx: Subject = famSubject;
    if (v.kind === 'focus' && this.inSubject(v.subject, i)) ctx = v.subject;
    else if (v.kind === 'manifest' && this.inSubject(v.context, i)) ctx = v.context;
    else if (v.kind === 'thread') {
      const ts = threadSubject(v.target, famSubject);
      if (v.target.type !== 'parallels' && this.inSubject(ts, i)) ctx = ts;
    }
    const trail = v.kind === 'thread' ? v : s.trail;
    const inTrail = trail && this.plan(trail.target.type, trail.target.id).some(step => step.occ === i);
    return { view: { kind: 'manifest', occId: id, context: ctx }, deep: false, ...(inTrail ? { trail } : {}), ...(s.graph && !inTrail ? { graph: true as const } : {}) };
  }

  private followThread() {
    const v = this.state.view;
    if (v.kind === 'focus') {
      if (v.subject.type === 'family' || v.subject.type === 'archetype') this.navigate(startThread(this.state, { type: v.subject.type, id: v.subject.id }));
    } else if (v.kind === 'manifest') {
      const o = this.m.occ[this.m.occIndex.get(v.occId)!];
      const ctx = v.context;
      const target: ThreadTarget = ctx.type === 'archetype' ? { type: 'archetype', id: ctx.id } : { type: 'family', id: o.familyId };
      this.navigate(startThread(this.state, target));
    }
  }

  private followParallels() {
    const v = this.state.view;
    if (v.kind === 'manifest') this.navigate(startThread(this.state, { type: 'parallels', id: v.occId }));
  }

  private chooseResult(r: SearchResult) {
    const a = r.action;
    if (a.type === 'subject') this.navigate(focusOn(this.state, a.subject));
    else if (a.type === 'occurrence') {
      const i = this.m.occIndex.get(a.occId);
      if (i !== undefined) this.navigate({ view: { kind: 'manifest', occId: a.occId, context: { type: 'family', id: this.m.occ[i].familyId } }, deep: false, ...(this.state.graph ? { graph: true as const } : {}) });
    } else {
      // a period: set the time window; leave the current state where it is
      const sc = this.m.scale;
      const uTo = sc.toU(a.to);
      const span = Math.max(0.05, sc.toU(a.to) - sc.toU(a.from));
      this.onUserTime();
      // the period is searched on the whole field's track, not the focus's span (a mode's own range stays as it is)
      if (!this.state.history && !this.state.redbook && !this.state.dynamics) this.timeControl.setRange();
      this.time.setCumulative(false);
      this.time.glideTo(a.from === a.to ? uTo + DEFAULT_RAMP : uTo + DEFAULT_RAMP * 0.5, Math.min(0.5, Math.max(0.1, span * 1.15)));
      this.engine.rig.interacted = true;
    }
  }

  // ── keyboard ──────────────────────────────────────────────────────────
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (this.search.isOpen) this.search.close(); else this.search.open();
      return;
    }
    if (typing) return;
    if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      this.search.open();
      return;
    }
    if (this.search.isOpen) return;
    if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.shell.toggleMenu(); e.preventDefault(); return;
    }
    if (this.shell.menuOpen) return;
    if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.openLens('field'); e.preventDefault(); return;
    }
    if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.openLens(this.state.lens?.id === 'theory' ? 'field' : 'theory'); e.preventDefault(); return;
    }
    if (e.key.toLowerCase() === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.toggleAion(); e.preventDefault(); return;
    }
    if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.toggleRedbook(); e.preventDefault(); return;
    }
    if (e.key.toLowerCase() === 'd' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.toggleLens(); e.preventDefault(); return;
    }
    if (this.state.redbook && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      this.redbook?.walk(e.key === 'ArrowRight' ? 1 : -1);
      e.preventDefault();
      return;
    }
    if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey && !this.graphMode && !this.state.history && !this.state.redbook && !this.state.dynamics) {
      this.toggleSky(); e.preventDefault(); return;
    }
    if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.toggleMode();
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      this.stepBack();
      e.preventDefault();
      return;
    }
    const onBody = !t || t === document.body || t.classList?.contains('globe-canvas') || t.classList?.contains('gv-canvas');
    if (!onBody || e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.graphMode) {
      // in the graph the same keys move the graph, not the hidden globe
      const step = 60;
      switch (e.key) {
        case 'ArrowLeft': this.graph?.panBy(step, 0); break;
        case 'ArrowRight': this.graph?.panBy(-step, 0); break;
        case 'ArrowUp': this.graph?.panBy(0, step); break;
        case 'ArrowDown': this.graph?.panBy(0, -step); break;
        case '+': case '=': this.graph?.zoomBy(1.3); break;
        case '-': case '_': this.graph?.zoomBy(1 / 1.3); break;
        default: return;
      }
      e.preventDefault();
      return;
    }
    const rig = this.engine.rig;
    const k = Math.max(0.25, (rig.dist - 1) / 2.2) * 34;
    switch (e.key) {
      case 'ArrowLeft': rig.nudge(0, -k); break;
      case 'ArrowRight': rig.nudge(0, k); break;
      case 'ArrowUp': rig.nudge(k * 0.7, 0); break;
      case 'ArrowDown': rig.nudge(-k * 0.7, 0); break;
      case '+': case '=': rig.zoomBy(0.8); break;
      case '-': case '_': rig.zoomBy(1.25); break;
      default: return;
    }
    e.preventDefault();
  };

  /** The whole scale, as the time control rests on it. */
  private fullSpan(): TimeSpan {
    return { fromU: this.m.scale.toU(this.m.field.meta.yearMin), toU: this.m.scale.toU(this.m.field.meta.yearMax) };
  }

  /** A focus (and a manifestation within one) scopes the time control to its subject's own span; any other view keeps the whole scale. */
  private syncTimeScope(s: AppState) {
    const v = s.view;
    const subject = s.graph || s.trail ? null : v.kind === 'focus' ? v.subject : v.kind === 'manifest' ? v.context : null;
    const full = this.fullSpan();
    const span = subject ? subjectSpan(this.m, subjectOccurrences(this.m, subject), full) : null;
    const to = span ?? full;
    if (to.fromU !== this.time.fromU || to.toU !== this.time.toU) this.rescope(to.fromU, to.toU);
  }

  /**
   * Move the time control to a new range. A clock in cursor mode keeps its place, and a cursor the new range excludes
   * glides to the nearest edge: a focus never snaps the clock (SPEC §9). In all-time mode the range simply moves.
   */
  private rescope(fromU: number, toU: number) {
    const t = this.time;
    const before = t.cursorU;
    const inCursor = t.mode === 'cursor';
    this.timeControl.setRange(fromU, toU);
    if (!inCursor || t.cursorU === before) return;
    const edge = t.cursorU;
    t.cursorU = before;
    t.glideTo(edge);
  }

  /** The focused subject's chronology, built when it stands on the globe with no walk and no Aion or Red Book. */
  private syncChronology(s: AppState) {
    const v = s.view;
    // the lens's subject travels the same arcs a focus does: its chronology runs along the cursor
    const subject = s.dynamics && !s.graph ? this.lensSubject(s)
      : v.kind === 'focus' && !s.graph && !s.trail && !s.history && !s.redbook && !s.sky ? v.subject : null;
    const key = subject ? `${subject.type}:${subject.id}` : '';
    if (key === this.chronoKey) return;
    this.chronoKey = key;
    if (!subject) { this.engine.arcs.clearChronology(); return; }
    const m = this.m;
    const idx = subjectOccurrences(m, subject);
    const path = chronologyPath(idx.map((i) => ({ u: m.u[i], dir: m.dir[i] })));
    const steps = path.map((k) => idx[k]);
    this.engine.arcs.buildChronology(steps.map((i) => m.dir[i]), steps.map((i) => m.u[i]), this.subjectPal(subject).core);
  }

  /** The Red Book's standing folio: the clock glides to its year (never a scrub, never a play); the control's readout shows the year. */
  private tuneToFolio(stopId: string) {
    const i = this.m.occIndex.get(stopId);
    if (i === undefined) return;
    this.time.pause();
    this.time.setCumulative(false);
    this.time.glideTo(this.m.u[i]);
  }

  /** Leave Aion's mode: its view, the time range it set, and the clock it held. */
  private leaveAion() {
    this.aion?.hide();
    this.timeControl.setRange();
    if (this.aionTime) this.time.restore(this.aionTime);
    this.aionTime = null;
  }

  /** A mode's core reading of an occurrence (a double-click on its card): Escape returns to the mode it was opened from. */
  private openReading(occId: string) {
    const i = this.m.occIndex.get(occId);
    if (i === undefined) return;
    this.navigate(openedFrom(this.state, { view: { kind: 'manifest', occId, context: { type: 'family', id: this.m.occ[i].familyId } }, deep: true }));
  }

  /** A sky body's core reading (a double-click on its card): the field target it descends to, read at depth; Escape returns to the sky. */
  private openSubjectReading(subject: Subject) {
    this.navigate(openedFrom(this.state, { view: { kind: 'focus', subject }, deep: true }));
  }

  /** Leave the Red Book: its folio view, and the range and clock it held. */
  private leaveRedbook(next: AppState) {
    const v = next.view;
    const graph = !!next.graph;
    this.redbook?.hide();
    if (this.rbTime) {
      // the range first: a cursor snapshot taken in cursor mode is clamped into the range it was taken in
      if (this.rbRange) this.timeControl.setRange(this.rbRange.fromU, this.rbRange.toU);
      this.time.restore(this.rbTime);
    }
    this.rbTime = null;
    this.rbRange = null;
    // leaving to the plain world: the Red Book's red must give way (not when a link is carrying us straight
    // into Aion, a focus or the lens, which set palettes)
    if (v.kind === 'world' && !next.sky && !graph && !next.history && !next.dynamics) this.enterWorld(false);
  }

  /** The lens's subject: the one it was given, else The Self (the same landing the lens itself makes). */
  private lensSubject(s: AppState): Subject {
    return s.dynamics?.subject ?? selfSubject(this.m);
  }

  /** The lens: the world view with the field read as a dynamical system. Whatever it hands over is torn down first. */
  private enterLens(prev: AppState, next: AppState, first: boolean) {
    const m = this.m;
    if (this.tour) this.endThread();
    if (prev.history) this.leaveAion();
    if (prev.redbook) this.leaveRedbook(next);
    // a change of subject inside the lens keeps the clock the lens was entered with
    if (!prev.dynamics) {
      this.lensTime = this.time.snapshot();
      this.lensRange = { fromU: this.time.fromU, toU: this.time.toU };
    }
    this.deep.hide(); this.hover.hide(); this.reveal.hide(); this.floats.clear(); this.label.set(null);
    document.body.classList.remove('deep-open', 'thread-inspecting');
    this.syncShift();
    // a mode that returns early must still let the sky go (the sky's own flight, if any, then wins)
    this.syncSky(prev, next, first, false);
    const subject = this.lensSubject(next);
    const idx = subjectOccurrences(m, subject);
    // the clock is scoped to the subject's own span, as a focus scopes it; the strip reads the same range
    const span = subjectSpan(m, idx, this.fullSpan()) ?? this.fullSpan();
    // a subject picked inside the lens glides the clock to the new span, as a focus does (SPEC §9); entering it snaps the range
    if (prev.dynamics) this.rescope(span.fromU, span.toU);
    else this.timeControl.setRange(span.fromU, span.toU);
    const pal = this.subjectPal(subject);
    this.engine.setPalette(pal, first ? 0.01 : 1.6);
    this.engine.setEmphasis(this.emphasise(idx), pal.core);
    this.timeControl.setSubject(idx, rgbToHex(pal.core));
    this.lens?.show(next.dynamics);
  }

  /** Leave the lens: its panel and strip go, the globe's emphasis goes, and the clock and range it held are given back. */
  private leaveLens(next: AppState) {
    this.lens?.hide();
    this.engine.setEmphasis(null, null);
    this.timeControl.setSubject(null, '#ffffff');
    // the range first, as the Red Book does: a snapshot in cursor mode is clamped into the range it was taken in
    if (this.lensRange) this.timeControl.setRange(this.lensRange.fromU, this.lensRange.toU);
    if (this.lensTime) this.time.restore(this.lensTime);
    this.lensTime = null;
    this.lensRange = null;
    // the world's palette returns unless the next state sets its own (a focus, Aion or the Red Book do; the sky holds its own)
    if (next.view.kind === 'world' && !next.history && !next.redbook) {
      if (next.sky) this.engine.setPalette(WORLD_PALETTE, 1.6);
      else this.enterWorld(false);
    }
  }

  private toggleLens() {
    this.navigate(this.state.dynamics ? WORLD : { view: { kind: 'world' }, deep: false, dynamics: {} });
  }

  // ── the shell: lenses and the filter (MODES-RFC) ─────────────────────
  /** Open a lens from the menu or a key: each lens's own landing state, always through navigate(). */
  openLens(id: LensId) {
    switch (id) {
      case 'field': return this.navigate(this.state.graph ? { view: { kind: 'world' }, deep: false, graph: true } : WORLD);
      case 'aion': {
        const reading = this.history ? defaultReadingId(this.history.readings) : undefined;
        if (reading) this.navigate({ view: { kind: 'world' }, deep: false, history: { reading } });
        return;
      }
      case 'redbook': if (this.redbookData) this.navigate({ view: { kind: 'world' }, deep: false, redbook: {} }); return;
      default: this.navigate(inLens(id));
    }
  }

  /** The shell follows the state: the active lens, and the context line reset for the lens that is about to fill it. */
  private syncShell(next: AppState) {
    const lens = lensOf(next);
    this.shell.setLens(lens);
    const fieldLens = lens === 'field';
    this.shell.setAside(fieldLens ? this.modeSwitch.root : null);
    // every lens fills its own context and controls as it shows; the field's context is its focus (set below)
    this.shell.setControls(null);
    if (fieldLens && next.view.kind === 'world') this.shell.setContext(next.sky ? 'The sky' : '');
  }

  /** A filter chosen in the menu, a chip removed, or a link's filter: the globe's mask, the walks, the hash. */
  private setFilter(f: FieldFilter) {
    if (filterEq(f, this.filter)) return;
    this.applyFilter(f);
    // the engine re-masks by itself; what reads the field's membership (a focus's framing and images, a walk) is re-entered
    const s = this.state;
    const v = s.view;
    if (!s.history && !s.redbook && !s.dynamics && !s.lens && !s.graph) {
      if (v.kind === 'focus') this.enterFocus(v.subject, false);
      else if (v.kind === 'thread') {
        // a walk the filter leaves too short to walk returns to where it began
        if (this.plan(v.target.type, v.target.id).length < 2) { this.navigate({ view: v.from, deep: false }, { replace: true }); return; }
        this.endThread(); this.enterThread(v.target, v.from, false);
      }
    }
    if (s.graph) this.syncGraph();
    this.syncHash(s, true);
  }

  private applyFilter(f: FieldFilter) {
    this.filter = f;
    this.filterMask = maskOf(this.m.occ, f);
    this.engine.setFilterMask(this.filterMask);
    this.shell.setFilter(f);
    this.setCache.key = '';
    document.body.classList.toggle('filtered', !isEmpty(f));
  }

  /** Does occurrence `i` pass the field filter? */
  private passing(i: number): boolean {
    return !this.filterMask || this.filterMask[i] > 0;
  }

  /** A thread's walk over the filtered field. */
  private plan(type: ThreadTarget['type'], id: string): ThreadStep[] {
    const steps = planThread(this.m, type, id);
    return this.filterMask ? steps.filter((st) => this.passing(st.occ)) : steps;
  }

  /** The context a panel lens is given: the shell's frame and a narrow door back into the field. */
  private lensContext(id: PanelLensId): LensContext {
    return {
      model: this.m,
      engine: this.engine,
      time: this.time,
      panel: this.panel,
      setContext: (t) => { if (this.activeLens === id) this.shell.setContext(t); },
      setControls: (n) => { if (this.activeLens === id) this.shell.setControls(n); },
      navigate: (st) => this.navigate(st),
      filter: () => this.filter,
      passages: this.passage.bridge(),
      focus: (subject) => this.navigate(focusOn(WORLD, subject)),
      openOccurrence: (occId) => this.openReading(occId),
      setPath: (path, opts) => { if (this.activeLens === id) this.navigate(inLens(id, path), opts); },
    };
  }

  /** Enter a panel lens: every other mode hands over, the code loads on first use, then the lens shows its route. */
  private enterPanelLens(prev: AppState, next: AppState, first: boolean) {
    const id = next.lens!.id;
    if (this.tour) this.endThread();
    if (prev.history) this.leaveAion();
    if (prev.redbook) this.leaveRedbook(next);
    this.deep.hide(); this.hover.hide(); this.reveal.hide(); this.floats.clear(); this.label.set(null);
    document.body.classList.remove('deep-open', 'thread-inspecting');
    this.syncSky(prev, next, first, false);
    if (this.graphMode) this.syncMode(false, first, true);
    if (!prev.lens || prev.lens.id !== id) {
      this.engine.setEmphasis(null, null);
      this.engine.setPalette(WORLD_PALETTE, first ? 0.01 : 1.6);
      this.timeControl.setSubject(null, '#ffffff');
    }
    this.activeLens = id;
    // the globe gives the panel room, as it does a card
    this.engine.rig.setShift(isNarrow() ? 0 : -0.22, isNarrow() ? 0.26 : 0);
    const path = next.lens!.path;
    const have = this.lensInst.get(id);
    if (have) { have.enter(path); return; }
    const tok = ++this.lensTok;
    document.body.classList.add('lens-loading');
    PANEL_LOADERS[id]().then((mod) => {
      document.body.classList.remove('lens-loading');
      if (!this.lensInst.has(id)) this.lensInst.set(id, mod.mount(this.lensContext(id)));
      if (tok !== this.lensTok || this.state.lens?.id !== id) return;
      this.lensInst.get(id)!.enter(this.state.lens.path);
    }).catch((err) => {
      document.body.classList.remove('lens-loading');
      console.error(err);
      this.panel.open('Lens unavailable', [el('p', { class: 'lp-error', text: 'This lens could not be loaded. Check the connection and try again.' })]);
    });
  }

  private leavePanelLens() {
    const id = this.activeLens;
    this.activeLens = null;
    this.lensTok++;
    if (id) this.lensInst.get(id)?.leave();
    this.panel.close();
    this.engine.rig.setShift(0, 0);
  }

  // ── applying a state ──────────────────────────────────────────────────
  private apply(next: AppState) {
    const prev = this.state;
    const first = !this.started;
    this.state = next;
    this.syncChronology(next);
    const v = next.view;
    const pv = prev.view;
    document.body.dataset.state = v.kind;
    const graph = !!next.graph;
    const modeChanged = first ? graph : !!prev.graph !== graph;
    this.syncMode(graph, first, modeChanged);
    this.syncShell(next);
    // a panel lens hands over before anything else takes the scene; a panel lens state is handled whole here
    if (prev.lens && prev.lens.id !== next.lens?.id) this.leavePanelLens();
    if (next.lens) {
      if (prev.dynamics && !next.dynamics) this.leaveLens(next);
      this.enterPanelLens(prev, next, first);
      return;
    }
    // the lens hands its clock back before anything else takes the clock (a Red Book or Aion entry snapshots the restored one)
    if (prev.dynamics && !next.dynamics) this.leaveLens(next);
    if (next.dynamics) { this.enterLens(prev, next, first); return; }
    if (next.redbook && this.redbook) {
      if (this.tour) this.endThread();
      if (prev.history) this.leaveAion();
      if (!prev.redbook) {
        this.rbTime = this.time.snapshot();
        this.rbRange = { fromU: this.time.fromU, toU: this.time.toU };
        // the Book's own span: the control reads as its chronology (the walk then glides the clock folio by folio)
        const span = this.rbSpan ?? this.fullSpan();
        this.timeControl.setRange(span.fromU, span.toU);
      }
      this.deep.hide(); this.hover.hide(); this.reveal.hide(); this.floats.clear(); this.label.set(null);
      document.body.classList.remove('deep-open', 'thread-inspecting');
      // the Red Book holds no shift of its own: Aion's card offset does not carry over
      this.syncShift();
      // a mode that returns early must still let the sky go (before its own flight, which then wins)
      this.syncSky(prev, next, first, false);
      this.redbook.show(next.redbook);
      // the genesis table stands over the whole field's time
      if (next.redbook.genesis) this.time.setAll();
      return;
    }
    if (prev.redbook) this.leaveRedbook(next);
    if (next.history && this.aion) {
      if (this.tour) this.endThread();
      if (!prev.history) this.aionTime = this.time.snapshot();
      const reading = this.aion.history.readings.find(r => r.id === next.history!.reading)!;
      if (prev.history?.reading !== reading.id) this.timeControl.setRange(this.m.scale.toU(reading.from), this.m.scale.toU(reading.to));
      if (!prev.history) {
        this.time.pause();
        this.time.setCumulative(false);
        this.time.scrub(this.m.scale.toU(0));
        this.enterWorld(first);
      }
      this.deep.hide(); this.hover.hide(); this.reveal.hide(); this.floats.clear(); this.label.set(null);
      document.body.classList.remove('deep-open', 'thread-inspecting');
      this.engine.rig.setShift(next.history.selection ? -0.18 : 0, 0);
      this.syncSky(prev, next, first, false);
      this.aion.show(next.history);
      return;
    }
    if (prev.history) this.leaveAion();
    this.syncTimeScope(next);
    // a change of mode re-enters the view: the globe flies to what the graph was showing, and back
    const sameView = !first && !modeChanged && !prev.history && viewEq(pv, v);
    const previousTrail = pv.kind === 'thread' ? pv : prev.trail;
    const nextTrail = v.kind === 'thread' ? v : next.trail;
    const keepsTrail = previousTrail && nextTrail && viewEq(previousTrail, nextTrail);
    if (previousTrail && !keepsTrail) this.endThread();
    if (next.trail && !this.tour) this.enterThread(next.trail.target, next.trail.from, first);
    if (next.trail) this.tourPause();
    document.body.classList.toggle('thread-inspecting', !!next.trail);

    if (!sameView) {
      if (v.kind !== 'world') this.engine.rig.interacted = true;
      switch (v.kind) {
        case 'world': this.enterWorld(first); break;
        case 'focus': this.enterFocus(v.subject, first); break;
        case 'manifest': this.enterManifest(v.occId, v.context, first); break;
        case 'thread':
          if (keepsTrail && this.tour) {
            this.reveal.hide(); this.deep.hide(); this.engine.markers.sel.hide(); this.strip.show();
            const subject = this.tour.subject;
            this.engine.setPalette(this.subjectPal(subject), 1.2);
            this.engine.setEmphasis(this.emphasise(this.tour.steps.map(s => s.occ), { relatedLevel: 1.8 }), this.subjectPal(subject).core);
            this.label.set({ name: subjectName(this.m, subject), line: 'Following the thread', links: [{ text: 'Reading', onClick: () => this.setDeep(true) }] }, `t:${v.target.type}:${v.target.id}`);
            this.tourJump(Math.max(0, this.tour.i));
          } else this.enterThread(v.target, v.from, first);
          break;
      }
    }
    this.syncDeep(next);
    this.syncShift();
    this.measureLabel();
    this.syncGraph();
    // a view that framed itself (or a thread's walk) keeps its flight: the sky's descent must not overwrite it
    // the graph starts no framing flight, so a graph arrival still needs the plain descent
    this.syncSky(prev, next, first, (!sameView && !this.graphMode) || !!next.trail);
  }

  // ── the sky ───────────────────────────────────────────────────────────
  toggleSky() {
    if (this.graphMode || this.state.history || this.state.redbook || this.state.dynamics) return;
    this.navigate(this.state.sky ? WORLD : inSky());
  }

  /** Fetch and build the sky layer once; the Earth stage never waits for it. */
  private skyDataP: Promise<SkyData> | null = null;
  private skyData(): Promise<SkyData> {
    this.skyDataP ??= loadSky();
    return this.skyDataP;
  }

  /**
   * What the graph's Sky anchors need: the bodies, their ties, and each body's geocentric ecliptic longitude at
   * the standing moment (now). Null — never a guess — when the data is missing or the moment lies outside the
   * generated span.
   */
  private async skyAnchors(): Promise<{ source: SkyAnchorSource; asOf: string } | null> {
    try {
      const [data, ties] = await Promise.all([this.skyData(), this.skyTies.ensure()]);
      if (!ties) return null;
      const ms = Date.now();
      const eph = new SkyEphemeris(data);
      if (!eph.covers(ms)) return null;
      const lon: SkyAnchorSource['lon'] = {};
      for (const b of ties.bodies) {
        if (b.key === 'earth') continue; // the observer has no geocentric longitude: it is where we stand
        const p = eph.geo(b.key, ms);
        if (p) lon[b.key] = p.lon;
      }
      return { source: { bodies: ties.bodies, ties: ties.ties, lon }, asOf: `as of ${formatMoment(ms)}` };
    } catch (err) {
      console.warn(err);
      return null;
    }
  }

  private skyLive: SkyLive | null = null;
  /** The sky's live state (diagnostics, tests): null until the sky has loaded. */
  get skyLiveState() { return this.skyLive?.state ?? null; }
  /** The birth chart standing in the sky (diagnostics, tests): null in the present sky. */
  get skyBirthChart() { return this.birthChart; }

  /** The sky's clock: follows the wall clock only while the sidecar vouches for the grids; otherwise a labelled snapshot. */
  private startSkyLive(layer: SkyLayer) {
    const live = new SkyLive(layer.baseEph, {
      base: SIDECAR_BASE,
      local: isLocalHost(),
      onChange: (s) => {
        this.skyView.setLive(s);
        // a birth sky holds its own moment; the clock resumes when it is left
        if (!this.state.sky?.birth) layer.setMoment(live.moment());
        if (this.state.sky) this.syncSkyCard();
      },
    });
    this.skyLive = live;
    layer.setMoment(live.moment());
    this.skyView.setLive(live.state);
    this.engine.onFrame(() => { if (live.following && !this.state.sky?.birth) layer.setMoment(live.moment()); });
    live.start();
  }

  private requestSky() {
    if (this.skyRequested) return;
    this.skyRequested = true;
    this.skyData().then((data) => {
      const layer = new SkyLayer(data);
      this.skyLayer = layer;
      this.startSkyLive(layer);
      this.engine.attachSky(layer);
      this.skyView.setLayer(layer);
      this.birthPanel.setBodies(data.bodies);
      this.birthPanel.setGazetteer(data.gazetteer);
      void this.probeSidecar();
      for (const w of this.layerWaiters.splice(0)) w(layer);
      this.syncRig();
      const cultures = Object.keys(data.cultures).filter((id) => this.m.cultureById.has(id)).map((id) => ({ id, name: this.m.cultureById.get(id)!.name }));
      this.skyView.setCultures(cultures, (id) => this.setSkyCulture(id));
      document.body.classList.add('sky-ready');
      if (this.pendingSkyEntry && this.state.sky) this.enterSkyView(this.pendingSkyEntry === 'instant');
      this.pendingSkyEntry = null;
      this.syncApproach();
      if (this.state.sky) this.syncSkyCard();
    }).catch((err) => {
      this.skyFailed = true;
      this.syncRig(); // no sky is coming: the pull-back's resistance beyond the atlas's limit ends
      for (const w of this.layerWaiters.splice(0)) w(null);
      console.warn(err);
      this.pendingSkyEntry = null;
    });
  }

  /** Carry the camera out to the whole system, in the default orientation for the moment (a planet's card lands on it). */
  private enterSkyView(instant: boolean) {
    const layer = this.skyLayer;
    if (!layer) return;
    const e = this.engine;
    const aspect = e.width / Math.max(1, e.height);
    layer.prepare(e.rig.dist);
    const ll = systemViewLatLon(systemViewAzimuth(layer.sunLonDeg), SYSTEM_VIEW_ELEVATION, layer.gmst, layer.eps);
    e.rig.interacted = true;
    document.body.classList.add('interacted');
    const key = this.approachFor(this.state.sky);
    this.approachOn = key;
    layer.setApproach(key, instant);
    if (key) e.rig.flyTo(ll.lat, ll.lon, this.approachDistOf(key, aspect), { instant, duration: 3.2 });
    else e.rig.flyTo(ll.lat, ll.lon, systemHomeDist(aspect, FOV), { instant, duration: 4.2 });
  }

  /** The body the camera approaches for its open card: a planet or the Sun, with no birth sky standing. */
  private approachFor(sky: AppState['sky']): BodyKey | null {
    return sky?.body && !sky.birth && isApproachBody(sky.body) ? sky.body : null;
  }

  /** How far the camera stands from `key` for its disc to fill the view (Earth radii). */
  private approachDistOf(key: BodyKey, aspect: number): number {
    const body = this.skyLayer?.data.bodies.find((b) => b.key === key);
    return approachDist(body?.radiusKm ?? 6371.0084, FOV, aspect);
  }

  /**
   * The sky's approach follows the open card: a planet's card eases the look-at onto the planet and flies the camera to
   * its disc, keeping the current orientation; any other state (no card, the Moon, Earth, a birth sky) flies the camera
   * back to the system home. Idempotent: it acts only when the approached body changes.
   */
  private syncApproach() {
    const layer = this.skyLayer;
    if (!layer) return;
    const key = this.approachFor(this.state.sky);
    if (key === this.approachOn) return;
    const from = this.approachOn;
    this.approachOn = key;
    const tok = ++this.approachTok;
    layer.setApproach(key);
    const e = this.engine;
    const aspect = e.width / Math.max(1, e.height);
    const c = e.rig.centre();
    if (key && from) {
      // planet for planet: pull back until both stand in the view, then approach the new one (no sweep through empty space)
      const a = layer.positionOf(from);
      const b = layer.positionOf(key);
      const span = a && b ? a.distanceTo(b) : 0;
      e.rig.flyTo(c.lat, c.lon, Math.min(e.rig.maxDist, Math.max(this.approachDistOf(key, aspect), span)), { duration: 1.6 });
      e.rig.onFlyEnd(() => {
        if (tok !== this.approachTok || this.approachOn !== key) return;
        const now = e.rig.centre();
        e.rig.flyTo(now.lat, now.lon, this.approachDistOf(key, aspect), { duration: 1.6 });
      });
      return;
    }
    e.rig.flyTo(c.lat, c.lon, key ? this.approachDistOf(key, aspect) : systemHomeDist(aspect, FOV), { duration: 3.2 });
  }

  /** The sky is left: the approach lets go (the look-at eases back to the Sun; the caller's flight brings the camera). */
  private releaseApproach() {
    this.approachOn = null;
    this.approachTok++;
    this.skyLayer?.setApproach(null);
  }

  /** The label for a body under the standing culture: its table name where there is one, else the default. */
  private skyName(key: BodyKey): string {
    const data = this.skyLayer?.data;
    const culture = this.state.sky?.culture;
    return (culture && data?.cultures[culture]?.[key]?.name) || data?.bodies.find((b) => b.key === key)?.name || key;
  }

  private setSkyCulture(id: string | null) {
    const { culture: _drop, ...rest } = this.state.sky ?? {};
    this.navigate(inSky(id ? { ...rest, culture: id } : rest), { replace: true });
  }

  /** The body card follows the state; a body without a resolved field link opens no card. */
  private syncSkyCard() {
    const layer = this.skyLayer;
    const sky = this.state.sky;
    if (!layer || !sky?.body) { this.skyCard.hide(); return; }
    const body = layer.data.bodies.find((b) => b.key === sky.body);
    if (!body || !canOpenCard(body, this.m)) {
      this.skyCard.hide();
      const { body: _b, ...rest } = sky;
      this.navigate(inSky(rest), { replace: true });
      return;
    }
    const birth = !!sky.birth;
    this.skyCard.show(sky.body, { data: layer.data, eph: layer.eph, model: this.m, ms: layer.moment, asOf: birth ? `at the birth moment, ${formatMoment(layer.moment)}` : `as of ${formatMoment(layer.moment)}`, culture: sky.culture, birth });
  }

  private syncSky(prev: AppState, next: AppState, first: boolean, reframed: boolean) {
    const on = !!next.sky;
    this.skyView.setActive(on, next.sky?.body ?? null);
    this.skyView.relabel();
    this.skyView.setCulture(next.sky?.culture ?? null, next.sky?.culture ? this.m.cultureById.get(next.sky.culture)?.name : undefined);
    if (on) this.syncSkyCard(); else this.skyCard.hide();
    this.syncBirth(prev.sky?.birth, next.sky?.birth, !!next.sky);
    if (on && !prev.sky) {
      this.requestSky();
      if (this.skyByGesture) this.skyByGesture = false;
      else if (this.skyLayer) this.enterSkyView(first);
      else if (!this.skyFailed) this.pendingSkyEntry = first ? 'instant' : 'fly';
    } else if (!on && prev.sky) {
      this.pendingSkyEntry = null;
      this.releaseApproach();
      if (this.skyByGesture) this.skyByGesture = false;
      else if (!reframed) {
        // leave the way we came: the same orientation, down to the Earth
        const rig = this.engine.rig;
        const c = rig.centre();
        rig.flyTo(c.lat, c.lon, this.worldDist(), { duration: 3.4 });
      }
    }
    // the open card's body is what the camera approaches (a no-op where the entry above has already framed it)
    if (on) this.syncApproach();
  }

  // ── the birth sky ─────────────────────────────────────────────────────

  /** The sky layer, once built (null if the sky data cannot be had). */
  private whenLayer(): Promise<SkyLayer | null> {
    if (this.skyLayer) return Promise.resolve(this.skyLayer);
    if (this.skyFailed) return Promise.resolve(null);
    this.requestSky();
    return new Promise((res) => this.layerWaiters.push(res));
  }

  /** Is the sidecar there? Asked once the sky is built, and again whenever the disclosure is opened while it was not. */
  private async probeSidecar() {
    if (!isLocalHost()) { this.birthPanel.setAvailability({ kind: 'off', why: 'not-local' }); return; }
    if (this.birthPanel.availability.kind === 'ready') return;
    const ok = await this.sidecar.available();
    this.birthPanel.setAvailability(ok ? { kind: 'ready' } : { kind: 'off', why: 'absent' });
  }

  /** The first mythic node a body descends through: Jung's own link before the atlas's, and only ones that resolve. */
  private birthDescent(key: BodyKey): { label: string; target: { type: 'family' | 'archetype'; id: string } } | null {
    const body = this.skyLayer?.data.bodies.find((b) => b.key === key);
    if (!body) return null;
    const { resolved } = resolveTies(body, this.m);
    const first = resolved.find((t) => t.basis !== 'site') ?? resolved[0];
    return first ? { label: subjectName(this.m, first.target), target: first.target } : null;
  }

  private castBirth(b: BirthInput) {
    this.navigate(inSky({ ...(this.state.sky ?? {}), birth: b }));
  }

  private leaveBirth() {
    const { birth: _b, ...rest } = this.state.sky ?? {};
    this.navigate(inSky(rest));
  }

  /** The state's birth changed (a cast, a link, a leaving): bring the sky to that moment, or back to the clock. */
  private syncBirth(prev: BirthInput | undefined, next: BirthInput | undefined, inSkyNow: boolean) {
    const same = prev && next ? prev.local === next.local && prev.lat === next.lat && prev.lon === next.lon : !prev && !next;
    if (same) return;
    void this.applyBirth(next, inSkyNow);
  }

  private async applyBirth(birth: BirthInput | undefined, visible: boolean) {
    const gen = ++this.birthGen;
    const layer = await this.whenLayer();
    if (!layer || gen !== this.birthGen) return;
    const duration = this.engine.reduced || !visible ? 0 : 2600;
    if (!birth) {
      // back to the present: the chart is taken away and the bodies travel home to the clock
      this.birthChart = null;
      layer.chart.set(null);
      this.birthPanel.clearChart();
      this.skyView.setHeld(null);
      layer.travel(layer.baseEph, this.skyLive?.moment() ?? Date.now(), duration);
      if (this.state.sky) this.syncSkyCard();
      return;
    }
    this.birthPanel.setInput(birth);
    this.birthPanel.setStatus('working', 'Computing the sky at that moment…');
    try {
      const chart = await this.sidecar.chart(birth);
      if (gen !== this.birthGen) return;
      const win = await this.sidecar.window(chartMoment(chart));
      if (gen !== this.birthGen) return;
      const eph = new SkyEphemeris(dataWithWindow(layer.data, win));
      this.birthChart = chart;
      layer.chart.set(chart);
      layer.chart.setOptions(this.birthPanel.drawn);
      layer.travel(eph, chartMoment(chart), duration, true);
      this.birthPanel.showChart(chart);
      this.skyView.setHeld(`The sky is held at ${formatMoment(chartMoment(chart))}, the moment you gave; it does not follow the clock.`);
      this.birthPanel.setAvailability({ kind: 'ready' });
      // the ring stands around the Earth at the scale of the system: bring the camera out to see it
      if (visible && this.engine.rig.dist < STAGE_EDGES.handoff) this.enterSkyView(this.engine.reduced);
      this.syncSkyCard();
    } catch (e) {
      if (gen !== this.birthGen) return;
      const message = e instanceof SidecarError ? e.message : 'The birth sky could not be computed.';
      if (!(e instanceof SidecarError)) console.warn(e);
      if (e instanceof SidecarError && (e.kind === 'absent' || e.kind === 'not-local')) this.birthPanel.setAvailability({ kind: 'off', why: e.kind === 'absent' ? 'absent' : 'not-local' });
      // the link must not claim a sky that is not shown: step the state back to the present sky, and keep the reason on screen
      this.birthChart = null;
      layer.chart.set(null);
      this.birthPanel.clearChart();
      this.skyView.setHeld(null);
      const { birth: _b, ...rest } = this.state.sky ?? {};
      if (this.state.sky?.birth) this.navigate(inSky(rest), { replace: true });
      this.birthPanel.setStatus('error', message);
    }
  }

  /**
   * The arrival settle (audit S3 (b)): a wheel or pinch that has carried the camera into the system, once it rests, eases the
   * orientation to the canonical system view, the room the S key composes, at the same distance. It acts only after a wheel
   * or pinch with no drag since; never in an approach, a birth sky, or under reduced motion. Any input cancels it (controls.ts).
   */
  private settleArrival() {
    const rig = this.engine.rig;
    const layer = this.skyLayer;
    const sky = this.state.sky;
    const now = performance.now();
    const eligible = !!layer && !!sky && !sky.birth && !this.approachFor(sky) && !layer.approach && !this.engine.reduced
      && rig.wheelDriven && !rig.flying && !rig.dragging && rig.dist >= STAGE_EDGES.system
      && now - rig.lastWheelAt >= SETTLE.idleMs && now - rig.lastDragAt >= SETTLE.quietDragMs;
    if (!eligible || !layer) { rig.settleTo = null; return; }
    rig.settleTo = systemViewLatLon(systemViewAzimuth(layer.sunLonDeg), SYSTEM_VIEW_ELEVATION, layer.gmst, layer.eps);
  }

  /** The zoom gesture crossing the Moon's edge sets and clears the sky flag; the camera stays the user's. */
  private watchSkyGesture() {
    this.settleArrival();
    const rig = this.engine.rig;
    if (!this.skyRequested && rig.dist > 4.4) this.requestSky();
    if (!this.skyLayer || this.graphMode || this.state.history || this.state.redbook || this.state.dynamics || rig.flying) return;
    // the stage's distance, not the rig's: an approach to a planet holds the camera close to it, and is not a zoom to the Earth
    const d = this.engine.stageDist;
    if (!this.state.sky && d > SKY_ENTER) {
      this.skyByGesture = true;
      this.navigate(inSky());
    } else if (this.state.sky && d < SKY_EXIT) {
      this.skyByGesture = true;
      this.navigate(WORLD, { replace: true });
    }
  }

  /** Open a body from outside the sky (a family's reveal, a link): the camera flies out to meet it. */
  openBody(key: BodyKey) {
    if (this.graphMode || this.state.history) return;
    this.navigate(inSky({ ...(this.state.sky ?? {}), body: key }));
  }

  onSkyPick(key: BodyKey) {
    if (this.graphMode || this.state.history) return;
    if (!this.state.sky) this.skyByGesture = true;
    this.navigate(inSky({ ...(this.state.sky ?? {}), body: key }));
  }

  // ── graph mode ────────────────────────────────────────────────────────
  toggleMode() {
    this.navigate(withMode(this.state, !this.state.graph));
  }
  private toggleAion() {
    if (!this.history) return;
    const reading = defaultReadingId(this.history.readings);
    this.navigate(this.state.history || !reading ? WORLD : { view: { kind: 'world' }, deep: false, history: { reading } });
  }

  private toggleRedbook() {
    if (!this.redbookData) return;
    this.navigate(this.state.redbook ? WORLD : { view: { kind: 'world' }, deep: false, redbook: {} });
  }

  private syncMode(graph: boolean, first: boolean, changed: boolean) {
    this.graphMode = graph;
    this.modeSwitch.set(graph);
    if (!changed) return;
    window.clearTimeout(this.pauseTimer);
    if (graph) {
      this.graph?.show(first);
      this.hover.hide();
      // the globe is not seen: once the cross-fade has covered it, stop drawing it
      if (first) this.engine.setPaused(true);
      else this.pauseTimer = window.setTimeout(() => { if (this.graphMode) this.engine.setPaused(true); }, 1100);
    } else {
      this.engine.setPaused(false);
      this.graph?.hide();
    }
  }

  /** The shared view, as the graph sees it: a local subject, a selected occurrence, or lit occurrences. */
  private syncGraph() {
    const s = this.state;
    if (!s.graph) return;
    const m = this.m;
    const v = s.view;
    let subject: string | null = null;
    let selected: string | null = null;
    let emphasis: number[] | null = null;
    const keyOf = (sub: Subject): string | null => (sub.type === 'archetype' ? `a:${sub.id}` : sub.type === 'family' ? `f:${sub.id}` : null);
    if (v.kind === 'focus') {
      subject = keyOf(v.subject);
      if (!subject) emphasis = subjectOccurrences(m, v.subject);
    } else if (v.kind === 'manifest') {
      selected = `o:${v.occId}`;
      subject = keyOf(v.context);
      if (!subject) {
        const i = m.occIndex.get(v.occId);
        if (i !== undefined) subject = `f:${m.occ[i].familyId}`;
      }
    }
    this.graph?.setInsets(this.graphInsets());
    this.graph?.setTarget({ subject, selected, emphasis });
  }

  private graphInsets(): Insets {
    const s = this.state;
    const narrow = isNarrow();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const ins: Insets = { l: 0, t: narrow ? 84 : 64, r: 0, b: narrow ? 136 : 92 };
    if (s.deep && s.view.kind !== 'world') {
      if (!narrow) ins.r = Math.min(W * 0.58, 780) + 10;
    } else if (s.view.kind === 'manifest') {
      if (narrow) ins.b = H * 0.54 + 18;
      else ins.r = Math.min(410, W * 0.4) + 34 + 28;
    }
    return ins;
  }

  private syncGraphInsets() {
    if (this.state.graph) this.graph?.setInsets(this.graphInsets());
  }

  private splitKey(key: string): { t: string; id: string } {
    const i = key.indexOf(':');
    return { t: key.slice(0, i), id: key.slice(i + 1) };
  }

  private onGraphSelect(key: string) {
    const { t, id } = this.splitKey(key);
    if (t === 'b') return this.onGraphBody(id as BodyKey);
    if (t === 'a') this.navigate(focusOn(this.state, { type: 'archetype', id }));
    else if (t === 'f') this.navigate(focusOn(this.state, { type: 'family', id }));
    else this.openOccurrenceId(id);
  }

  /** A body in the graph opens in the sky, on its card, as the S key's flight would. */
  private onGraphBody(key: BodyKey) {
    this.navigate(inSky({ body: key }));
  }

  /** Back to the globe, flying to a node (or to whatever is in view when none is given). */
  private onGraphEarth(key: string | null) {
    const earth = withMode(this.state, false);
    if (key) {
      const { t, id } = this.splitKey(key);
      if (t === 'b') return this.onGraphBody(id as BodyKey);
      if (t === 'a') return this.navigate(focusOn(earth, { type: 'archetype', id }));
      if (t === 'f') return this.navigate(focusOn(earth, { type: 'family', id }));
      const occ = this.occurrenceState(earth, id);
      if (occ) return this.navigate(occ);
    } else if (this.state.view.kind === 'focus') {
      return this.navigate(earth);
    } else if (this.state.view.kind === 'world') {
      return this.navigate(earth);
    }
    this.navigate(earth);
  }

  private measureLabel() {
    const r = this.label.root.getBoundingClientRect();
    this.labelRect = { x: 0, y: 0, w: Math.max(300, r.right + 24), h: Math.max(150, r.bottom + 24) };
  }

  private syncDeep(s: AppState) {
    const open = s.deep && s.view.kind !== 'world';
    document.body.classList.toggle('deep-open', open);
    if (open) this.deep.show(this.deepTarget(s.view));
    else this.deep.hide();
  }

  private deepTarget(v: View): DeepTarget {
    switch (v.kind) {
      case 'focus': return { kind: 'subject', subject: v.subject };
      case 'manifest': return { kind: 'occurrence', occId: v.occId };
      case 'thread':
        if (v.target.type === 'parallels') return { kind: 'occurrence', occId: v.target.id };
        return { kind: 'subject', subject: { type: v.target.type, id: v.target.id } };
      default: return { kind: 'subject', subject: { type: 'archetype', id: 'self' } };
    }
  }

  private syncShift() {
    const narrow = isNarrow();
    const s = this.state;
    let x = 0, y = 0;
    if (s.deep && s.view.kind !== 'world') {
      if (!narrow) x = -0.46;
    } else if (s.view.kind === 'manifest' || s.sky?.body) {
      // a card stands on the right (or the bottom, on a phone): the scene gives it room. An approached planet's disc
      // is centred in the space the sheet leaves above it, so the disc is not drawn under the sheet.
      if (narrow) y = this.approachFor(s.sky) ? 0.56 : 0.34; else x = -0.27;
    } else if (s.view.kind === 'thread') {
      y = narrow ? 0.1 : 0.1;
    } else if (s.view.kind === 'focus' && narrow) {
      y = 0.02;
    }
    this.engine.rig.setShift(x, y);
  }

  // ── world ─────────────────────────────────────────────────────────────
  private enterWorld(first: boolean) {
    const e = this.engine;
    e.setPalette(WORLD_PALETTE, first ? 0.01 : 1.6);
    e.setEmphasis(null, null);
    this.floats.clear();
    this.reveal.hide();
    this.label.set(null);
    e.markers.sel.hide();
    this.timeControl.setSubject(null, '#ffffff');
    this.setBody(null);
    this.shell.setContext('');
    if (!first && !this.graphMode) {
      const c = e.rig.centre();
      e.rig.flyTo(c.lat, c.lon, Math.max(e.rig.dist, this.worldDist()), { duration: 2.0 });
    }
  }

  // ── focus ─────────────────────────────────────────────────────────────
  private subjectPal(s: Subject): RGBPalette {
    return subjectPalette(this.m, s, averagePalettes) ?? WORLD_PALETTE;
  }

  private emphasise(related: number[], opts: { selected?: number; relatedLevel?: number; extra?: { idx: number[]; level: number } } = {}) {
    const rel = this.rel;
    rel.fill(REL_RECEDED);
    const lvl = opts.relatedLevel ?? REL_RELATED;
    for (const i of related) rel[i] = lvl;
    if (opts.extra) for (const i of opts.extra.idx) rel[i] = Math.max(rel[i], opts.extra.level);
    if (opts.selected !== undefined && opts.selected >= 0) rel[opts.selected] = 2.4;
    for (let i = 0; i < rel.length; i++) if (!this.m.located[i]) rel[i] = 1;
    return rel;
  }

  private frameDistance(radius: number): number {
    const aspect = this.engine.width / Math.max(1, this.engine.height);
    const fovEff = aspect >= 1 ? FOV : (Math.atan(Math.tan((FOV * Math.PI) / 360) * aspect) * 360) / Math.PI;
    const shiftFill = 0.66;
    return fitDistance(radius, fovEff, shiftFill, 1.22, this.worldDist());
  }

  private frameSet(idx: number[], opts: { duration?: number; min?: number } = {}) {
    const e = this.engine;
    const dirs = idx.map((i) => this.m.dir[i]);
    const sp = spreadOf(dirs);
    if (!sp) return;
    let dist: number;
    if (sp.radius > 1.2) dist = this.worldDist() * 0.94;
    else dist = this.frameDistance(sp.radius * 1.18 + 0.07);
    dist = Math.max(dist, opts.min ?? 1.9);
    e.rig.flyTo(sp.lat, sp.lon, dist, { duration: opts.duration });
    return sp;
  }

  private enterFocus(subject: Subject, first: boolean) {
    const m = this.m;
    const e = this.engine;
    const idx = subjectOccurrences(m, subject).filter((i) => this.passing(i));
    const pal = this.subjectPal(subject);
    e.setPalette(pal, first ? 0.01 : 1.5);
    this.reveal.hide();
    e.markers.sel.hide();
    if (this.graphMode) {
      // the graph is the main view: the shared layers follow, the globe is left as it was
      this.floats.clear();
      this.timeControl.setSubject(idx, rgbToHex(pal.core));
      this.setLabelFor(subject);
      this.setBody(subject.type);
      this.shell.setContext(subjectName(m, subject));
      return;
    }
    e.setEmphasis(this.emphasise(idx), pal.core);
    const sp = idx.length ? this.frameSet(idx, { duration: first ? 0.01 : undefined }) : null;
    if (first && sp) e.rig.flyTo(sp.lat, sp.lon, this.frameDistance(sp.radius * 1.18 + 0.07), { instant: true });
    this.floats.set(this.pickShowcase(subject, idx, sp ? { lat: sp.lat, lon: sp.lon } : null), isNarrow());
    this.timeControl.setSubject(idx, rgbToHex(pal.core));
    this.setLabelFor(subject);
    this.setBody(subject.type);
    this.shell.setContext(subjectName(m, subject));
  }

  private setLabelFor(subject: Subject) {
    const m = this.m;
    const v = this.state.view;
    const up = v.kind === 'focus' && v.crumbs?.length
      ? [...v.crumbs.slice().reverse().map((c) => ({ text: subjectName(m, c), onClick: () => this.stepBack() })), { text: 'the whole field', onClick: () => this.wholeField() }]
      : [{ text: 'the whole field', onClick: () => this.wholeField() }];
    const content: LabelContent = { name: subjectName(m, subject), line: subjectLine(m, subject) || undefined, up, links: [] };
    if (subject.type === 'family') {
      const fam = m.famById.get(subject.id)!;
      const ties = archetypesOfFamily(m, fam);
      if (ties.length) {
        content.tiesPrefix = 'of';
        content.ties = ties.slice(0, 3).map((a) => ({ text: a.name, onClick: () => this.navigate(focusOn(this.state, { type: 'archetype', id: a.id })) }));
      }
    } else if (subject.type === 'archetype') {
      const arch = m.archById.get(subject.id)!;
      const fams = arch.familyIds.map((id) => m.famById.get(id)).filter((f) => !!f).slice(0, 3);
      if (fams.length) {
        content.tiesPrefix = 'in';
        content.ties = fams.map((f) => ({ text: f!.name, onClick: () => this.navigate(focusOn(this.state, { type: 'family', id: f!.id })) }));
      }
    }
    if (subject.type === 'family' || subject.type === 'archetype') content.links!.push({ text: 'Follow the thread', onClick: () => this.followThread() });
    content.links!.push({ text: 'Reading', onClick: () => this.setDeep(true) });
    this.label.set(content, `f:${subject.type}:${subject.id}`);
  }

  private setBody(_k: string | null) {
    // reserved: per-kind styling hooks
  }

  /** Out of every focus at once: the whole field, as the globe or as the graph — the breadcrumb's last door. */
  private wholeField() {
    this.navigate(this.state.graph ? { view: { kind: 'world' }, deep: false, graph: true } : WORLD);
  }

  private onFloatSelect(t: FloatTarget) {
    if (t.type === 'occurrence') this.openOccurrence(t.occIdx);
    else if (t.type === 'family') this.navigate(focusOn(this.state, { type: 'family', id: t.id }));
    else this.setDeep(true);
  }

  /**
   * A few large images surfaced in the field: the subject's own, then those of
   * the forms and occurrences within it, spread across its distribution.
   */
  private pickShowcase(subject: Subject, idx: number[], centre: { lat: number; lon: number } | null): FloatItem[] {
    if (!idx.length) return [];
    const m = this.m;
    const max = isNarrow() ? 3 : 5;
    const c: Vec3 | null = centre ? dirFromLatLon(centre.lat, centre.lon) : null;
    const nearestToCentre = (list: number[]) => (c ? list.reduce((a, b) => (angleBetween(c, m.dir[a]) <= angleBetween(c, m.dir[b]) ? a : b)) : list[0]);
    const visible = (i: number) => !c || angleBetween(c, m.dir[i]) < 1.25;

    interface Cand { anchor: number; item: FloatItem; priority: number }
    const cands: Cand[] = [];
    const seenSrc = new Set<string>();
    const add = (cand: Cand) => {
      const src = cand.item.img?.src;
      if (src) {
        if (seenSrc.has(src)) return;
        seenSrc.add(src);
      }
      cands.push(cand);
    };

    // the subject's own image — the hero of the field
    const own = subject.type === 'family' ? m.famById.get(subject.id)?.image : subject.type === 'archetype' ? m.archById.get(subject.id)?.image : undefined;
    const ownPal = subject.type === 'family' ? m.famById.get(subject.id)?.palette : subject.type === 'archetype' ? m.archById.get(subject.id)?.palette : undefined;
    if (own) {
      const a = nearestToCentre(idx);
      add({ anchor: a, priority: 3, item: { dir: m.dir[a], img: own, label: subjectName(m, subject), era: '', palette: ownPal, target: { type: 'reading' } } });
    }
    // occurrences with their own images
    for (const i of idx) {
      const o = m.occ[i];
      if (o.image && visible(i)) add({ anchor: i, priority: 2, item: { dir: m.dir[i], img: o.image, label: o.label, era: eraShort(o.yearDisplay, 22), palette: m.famById.get(o.familyId)?.palette, target: { type: 'occurrence', occIdx: i } } });
    }
    // forms within the subject that carry an image (archetype/culture/place focus)
    if (subject.type !== 'family') {
      const byFam = new Map<string, number[]>();
      for (const i of idx) {
        const f = m.occ[i].familyId;
        if (!m.famById.get(f)?.image) continue;
        const l = byFam.get(f);
        if (l) l.push(i); else byFam.set(f, [i]);
      }
      for (const [fid, list] of byFam) {
        const vis = list.filter(visible);
        if (!vis.length) continue;
        const a = nearestToCentre(vis);
        const fam = m.famById.get(fid)!;
        add({ anchor: a, priority: 1, item: { dir: m.dir[a], img: fam.image, label: fam.name, era: '', palette: fam.palette, target: { type: 'family', id: fid } } });
      }
    }

    let chosen: Cand[] = [];
    if (cands.length) {
      const pool = cands.slice().sort((x, y) => y.priority - x.priority);
      chosen.push(pool[0]);
      while (chosen.length < Math.min(max, pool.length)) {
        let best: Cand | null = null, bestScore = -1;
        for (const cd of pool) {
          if (chosen.includes(cd)) continue;
          const d = Math.min(...chosen.map((x) => angleBetween(m.dir[cd.anchor], m.dir[x.anchor])));
          const score = d + cd.priority * 0.04;
          if (score > bestScore) { bestScore = score; best = cd; }
        }
        if (!best || bestScore < 0.04) break;
        chosen.push(best);
      }
    } else {
      // no images yet: a few compact tonal plates, spread out
      const pool = idx.filter(visible);
      const list = pool.length ? pool : idx;
      const picks: number[] = [nearestToCentre(list)];
      while (picks.length < Math.min(3, list.length)) {
        let best = -1, bd = -1;
        for (const i of list) {
          if (picks.includes(i)) continue;
          const d = Math.min(...picks.map((j) => angleBetween(m.dir[i], m.dir[j])));
          if (d > bd) { bd = d; best = i; }
        }
        if (best < 0 || bd < 0.08) break;
        picks.push(best);
      }
      chosen = picks.map((i) => ({ anchor: i, priority: 0, item: { dir: m.dir[i], img: undefined, label: m.occ[i].label, era: eraShort(m.occ[i].yearDisplay, 22), palette: m.famById.get(m.occ[i].familyId)?.palette, target: { type: 'occurrence', occIdx: i } } }));
    }
    return chosen.map((x) => x.item);
  }

  // ── manifestation ─────────────────────────────────────────────────────
  private enterManifest(occId: string, context: Subject, first: boolean) {
    const m = this.m;
    const e = this.engine;
    const oi = m.occIndex.get(occId);
    if (oi === undefined) return;
    const o = m.occ[oi];
    const famPal = m.famPalette.get(o.familyId) ?? WORLD_PALETTE;
    const ctxIdx = subjectOccurrences(m, context);
    const par = o.parallelIds.map((id) => m.occIndex.get(id)).filter((i): i is number => i !== undefined);
    e.setPalette(famPal, first ? 0.01 : 1.4);
    this.floats.clear();
    if (!this.graphMode) {
      e.setEmphasis(this.emphasise(ctxIdx, { selected: oi, relatedLevel: 1.15, extra: { idx: par, level: 1.6 } }), famPal.core);
      const dist = o.geoPrecision === 'culture' ? 3.0 : o.geoPrecision === 'region' ? 2.6 : 2.25;
      e.rig.flyTo(o.lat, o.lon, dist, { instant: first });
      if (m.located[oi]) e.markers.sel.show(m.dir[oi], famPal.core);
      else e.markers.sel.hide();
    }
    this.reveal.show(oi);
    this.timeControl.setSubject(m.famOcc.get(o.familyId) ?? null, rgbToHex(famPal.core));
    this.label.set({ name: subjectName(m, context), back: () => this.stepBack() }, `m:${context.type}:${context.id}`);
    this.shell.setContext(o.label);
  }

  // ── thread ────────────────────────────────────────────────────────────
  private enterThread(target: ThreadTarget, _from: View, first: boolean) {
    const m = this.m;
    const e = this.engine;
    const steps = this.plan(target.type, target.id);
    const subject: Subject = target.type === 'parallels'
      ? { type: 'family', id: m.occ[m.occIndex.get(target.id)!].familyId }
      : { type: target.type, id: target.id };
    const pal = this.subjectPal(subject);
    e.setPalette(pal, first ? 0.01 : 1.5);
    const members = steps.map((s) => s.occ);
    const setIdx = target.type === 'parallels' ? members : subjectOccurrences(m, subject);
    e.setEmphasis(this.emphasise(target.type === 'parallels' ? [] : setIdx, { relatedLevel: 1.1, extra: { idx: members, level: 1.8 } }), pal.core);
    this.floats.clear();
    this.reveal.hide();
    e.markers.sel.hide();

    // arcs
    e.arcs.build(steps.map((s) => m.dir[s.occ]), steps.map((s) => s.arcFromPrev));
    e.arcs.uniforms.uColor.value.set(pal.core[0], pal.core[1], pal.core[2]);
    e.arcs.uniforms.uDraw.value = first || e.reduced ? steps.length + 1 : 0;
    e.arcs.uniforms.uHead.value = 0;
    e.arcs.uniforms.uTour.value = 0;

    // time: remember where it was, restore on leaving
    if (!this.timeSnap) this.timeSnap = this.time.snapshot();
    this.timeControl.setSubject(members, rgbToHex(pal.core));

    // strip
    this.strip.set(members);
    this.strip.setPlaying(true);
    this.strip.show();
    this.strip.setIndex(0, members[0]);
    this.frameSet(members, { duration: first ? 0.01 : undefined, min: 2.2 });
    if (first) {
      const sp = spreadOf(members.map((i) => m.dir[i]));
      if (sp) e.rig.flyTo(sp.lat, sp.lon, Math.max(2.2, sp.radius > 1.2 ? this.worldDist() * 0.94 : this.frameDistance(sp.radius * 1.18 + 0.07)), { instant: true });
    }

    const first0 = m.occ[members[0]];
    const last = m.occ[members[members.length - 1]];
    const name = subjectName(m, subject);
    this.label.set({
      name,
      line: target.type === 'parallels' ? `${m.occ[m.occIndex.get(target.id)!].label} and its parallels` : `${eraShort(first0.yearDisplay, 22)} → ${eraShort(last.yearDisplay, 22)}`,
      up: [{ text: 'the whole field', onClick: () => this.stepBack() }],
      links: [{ text: 'Reading', onClick: () => this.setDeep(true) }],
    }, `t:${target.type}:${target.id}`);
    this.shell.setContext(`${name}, the thread`);

    this.tour = { steps, i: -1, playing: true, phase: 'intro', timer: first || e.reduced ? 0.4 : 3.1, tok: ++this.tokCounter, draw: first ? 1 : 0, head: 0, subject, target };
    this.timeControl.setTour(true, () => this.tourToggle());
  }

  private endThread() {
    const e = this.engine;
    this.tour = null;
    this.tokCounter++;
    this.timeControl.setTour(null);
    e.arcs.clear();
    e.arcs.uniforms.uTour.value = 0;
    e.markers.head.hide();
    this.strip.hide();
    if (this.timeSnap) {
      this.time.restore(this.timeSnap);
      this.timeSnap = null;
    }
  }

  private tourToggle() {
    const t = this.tour;
    if (!t) return;
    if (t.playing) this.tourPause(); else this.tourResume();
  }

  private tourPause() {
    const t = this.tour;
    if (!t) return;
    t.playing = false;
    this.strip.setPlaying(false);
    this.timeControl.setTour(false);
  }

  private tourResume() {
    const t = this.tour;
    if (!t) return;
    t.playing = true;
    this.strip.setPlaying(true);
    this.timeControl.setTour(true);
    if (t.phase === 'done') this.startStep(0);
    else if (t.phase === 'fly') this.startStep(Math.max(0, t.i));
    else if (t.phase === 'intro') t.timer = Math.min(t.timer, 0.4);
  }

  private tourJump(i: number) {
    const t = this.tour;
    if (!t) return;
    t.draw = 1;
    this.engine.arcs.uniforms.uDraw.value = t.steps.length + 1;
    this.startStep(i);
  }

  private startStep(i: number) {
    const t = this.tour;
    if (!t) return;
    const e = this.engine;
    const m = this.m;
    const step = t.steps[i];
    const o = m.occ[step.occ];
    const prevStep = i > 0 ? t.steps[i - 1] : null;
    const ang = prevStep ? angleBetween(m.dir[prevStep.occ], m.dir[step.occ]) : 0.8;
    t.i = i;
    t.phase = 'fly';
    t.tok = ++this.tokCounter;
    const tok = t.tok;
    this.strip.setIndex(i, step.occ);
    this.strip.setPlaying(t.playing);
    const dist = (o.geoPrecision === 'culture' ? 2.9 : o.geoPrecision === 'region' ? 2.5 : 2.2) + Math.min(ang, 1.4) * 0.3;
    e.rig.flyTo(o.lat, o.lon, dist, { duration: i === 0 ? 2.2 : undefined });
    e.rig.onFlyEnd(() => {
      if (!this.tour || this.tour.tok !== tok) return;
      this.tour.phase = 'dwell';
      this.tour.timer = 2.7;
    });
    this.time.setCumulative(true);
    this.time.glideTo(m.u[step.occ] + DEFAULT_RAMP * 1.6);
    e.arcs.uniforms.uTour.value = 1;
    e.markers.head.show(m.dir[step.occ], this.engine.palette.core);
    // an unmoving flight (same spot) never fires onFlyEnd
    if (!e.rig.flying) {
      t.phase = 'dwell';
      t.timer = 2.7;
    }
  }

  private finishTour() {
    const t = this.tour;
    if (!t) return;
    t.phase = 'done';
    t.playing = false;
    this.strip.setPlaying(false);
    this.timeControl.setTour(false);
    this.engine.markers.head.hide();
    this.engine.arcs.uniforms.uTour.value = 0;
    if (this.timeSnap) this.time.restore(this.timeSnap);
    this.frameSet(t.steps.map((s) => s.occ), { min: 2.2, duration: 2.6 });
  }

  // ── per-frame ─────────────────────────────────────────────────────────
  private tick(dt: number) {
    this.watchSkyGesture();
    this.skyView.tick();
    this.aion?.update(dt);
    this.lens?.update(dt);
    if (this.activeLens) this.lensInst.get(this.activeLens)?.update?.(dt);
    this.floats.update(this.engine, dt);
    // the chronology travels with the cursor; a walk's arcs own the field while one stands
    if (this.chronoKey) {
      const tm = this.time;
      this.engine.arcs.updateChronology(tm.cursorU, tm.trail, DEFAULT_RAMP, this.tour ? 0 : tm.on, this.engine.reduced);
    }
    const t = this.tour;
    if (!t) return;
    const u = this.engine.arcs.uniforms;
    if (t.draw < 1) {
      t.draw = Math.min(1, t.draw + dt / 2.6);
      const e = t.draw * t.draw * (3 - 2 * t.draw);
      u.uDraw.value = e * (t.steps.length + 0.3);
    }
    // arc head follows the tour index smoothly
    const tgt = Math.max(0, t.i);
    u.uHead.value += (tgt - u.uHead.value) * (1 - Math.exp(-dt * 1.6));
    if (!t.playing) return;
    if (t.phase === 'intro') {
      t.timer -= dt;
      if (t.timer <= 0) this.startStep(0);
    } else if (t.phase === 'dwell') {
      t.timer -= dt;
      if (t.timer <= 0) {
        if (t.i + 1 < t.steps.length) this.startStep(t.i + 1);
        else this.finishTour();
      }
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────
  private inSubject(s: Subject, idx: number): boolean {
    const key = `${s.type}:${s.id}`;
    if (this.setCache.key !== key) {
      this.setCache = { key, set: new Set(subjectOccurrences(this.m, s).filter((i) => this.passing(i))) };
    }
    return this.setCache.set.has(idx);
  }

  /** For tests/diagnostics. */
  describe() {
    return { state: this.state, exists: (s: Subject) => subjectExists(this.m, s) };
  }
}
