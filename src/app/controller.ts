// The conductor: owns the state machine, the hash, and the choreography between
// the globe (camera, atmosphere, emphasis, arcs) and the quiet DOM layers.
import { CHART_RADIUS } from '../sky/chart-overlay';
import type { Model, Subject } from '../data/model';
import { scopeOf } from '../data/scope';
import { archetypesOfFamily, selfSubject, subjectExists, subjectLine, subjectName, subjectOccurrences, subjectPalette } from '../data/model';
import { angleBetween, dirFromLatLon, fitDistance, latLonFromDir, spreadOf, worldDistance, type Vec3 } from '../data/geo';
import { averagePalettes, rgbToHex, WORLD_PALETTE, type RGBPalette } from '../data/palette';
import { buildSearchIndex, type SearchResult } from '../data/search';
import { planThread, type ThreadStep } from '../data/thread';
import { FOV, type GlobeEngine } from '../globe/engine';
import { chronologyPath } from '../globe/chronology';
import { defaultReadingId, hashToState, hashWithFilter, type BirthPrefill } from '../state/router';
import { ASTROLOGY_LIVE, astrologyAt, astrologyLive, back, focusOn, inLens, inSky, openedFrom, skyArrival, skyGestureState, startThread, stateEq, threadSubject, viewEq, withMode, WORLD, type AppState, type PanelLensId, type ThreadTarget, type View } from '../state/store';
import { Shell } from '../shell/shell';
import { Panel } from '../shell/panel';
import { Landing } from '../shell/landing';
import { DEEP_FIELDS } from '../lenses/deep-fields';
import { lensDef, lensOf, PANEL_LOADERS, type LensChrome, type LensContext, type LensId, type LensInstance } from '../shell/lens';
import { modeOptions, optionAction } from '../ui/mode-options';
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
import { walksOf } from '../aion/walk';
import type { History } from '../types/history';
import type { CorpusIndex } from '../types/corpus';
import type { RedBook } from '../types/redbook';
import type { RedBookView } from '../redbook/view';
import type { DynamicsView } from '../dynamics/view';
import { PassageSheet } from '../ui/passage';
import { loadSky } from '../sky/load';
import { SkyEphemeris } from '../sky/ephemeris';
import { SkyLive, formatMoment } from '../sky/live';
import type { SkyAnchorSource } from '../graph/build';
import type { SidecarChart, SkyData } from '../types/sky';
import { SkyLayer } from '../sky/layer';
import { SkyCamera } from '../sky/camera';
import { SkyView } from '../sky/view';
import { dataWithWindow } from '../sky/sidecar';
import type { CuratedPerson } from '../astro/charts';
import { loadLensData } from '../lenses/ui';
import { SkyTies } from '../sky/ties';
import { systemViewLatLon } from '../sky/frames';
import { approachDist, EARTH_FIELD_EXIT, isSkyApproachBody, skyMaxDist, SETTLE, STAGE_EDGES, SKY_ENTER, SKY_EXIT, SYSTEM_VIEW_ELEVATION, systemHomeDist, systemViewLongitude } from '../sky/stages';
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
  /** a birth from an old link, in memory until the Astrology form takes it */
  private birthPrefill: BirthPrefill | null = null;
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
  /** the standard first Options action of the active panel lens (Open / Close its sheet), and whether the lens set its Options this entry */
  private sheetAction: HTMLButtonElement | null = null;
  private lensOptionsSet = false;
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
  private skyTies = new SkyTies();
  private skyLayer: SkyLayer | null = null;
  /** the chart standing in the sky, once the sidecar has answered; null in the present sky */
  private natalChart: SidecarChart | null = null;
  private natalGen = 0;
  private layerWaiters: ((l: SkyLayer | null) => void)[] = [];
  private skyRequested = false;
  private skyFailed = false;
  /** the next sky transition came from the user's own zoom: the camera is theirs, do not fly it */
  private skyByGesture = false;
  private pendingSkyEntry: 'instant' | 'fly' | null = null;
  /**
   * The sky camera: the one owner of every scripted move between the Earth and the sky (src/sky/camera.ts). The controller
   * asks it for a transition and reads its `phase`, `key` and `busy`; the approach and the gaze live there, not here.
   */
  readonly skyCam: SkyCamera;
  /** a planet has been held since the sky was entered: the arrival settle stands down (cleared when the sky is left) */
  private heldInSky = false;
  /** Field chrome (reveal / label / deep) deferred until descendFromSky finishes landing. */
  private pendingLanding: (() => void) | null = null;
  /** The reading a descent from the sky carries is open in the state but waits for the landing: the scene is not shifted for it yet. */
  private readingAwaitsLanding = false;

  constructor(private m: Model, private engine: GlobeEngine, private time: TimeModel, root: HTMLElement, private history?: History, corpus?: CorpusIndex | null, private redbookData?: RedBook) {
    this.root = root;
    this.rel = new Float32Array(m.occ.length);
    this.searchIndex = buildSearchIndex(m);

    this.passage = new PassageSheet(root, corpus ?? null);
    const passages = this.passage.bridge();
    this.passages = passages;
    const openCite = (work: string, locator: string) => void this.passage.show(work, locator);

    this.floats = new Floats(root, (t) => this.onFloatSelect(t));
    // measured as the plates lay out, not once: the label's links and wrapped lines settle after it is first drawn
    this.floats.obstacles = () => { if (this.label?.root.isConnected) this.measureLabel(); return [this.labelRect]; };
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
      // the sheet's close is the same step back as Escape: a walk's reading returns to the walk (store.back)
      onClose: () => this.closeReading(),
      onSubject: (s) => this.navigate(focusOn(this.state, s)),
      onOccurrence: (id) => this.openOccurrenceId(id),
      onCite: openCite,
      passage: passages,
    });
    this.strip = new Strip(root, m, {
      onSelect: (i) => this.tourJump(i),
      onOpen: (i) => this.tour && this.openOccurrence(this.tour.steps[i].occ),
      onRead: (i) => this.tourRead(i),
      onOpenOcc: (oi) => this.openOccurrence(oi),
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
      countFor: (f) => m.occ.reduce((n, o, i) => n + (passes(o, f, m.tags[i]) ? 1 : 0), 0),
      works: [...workNames].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      cultures: m.field.cultures.filter((c) => c.occurrenceCount > 0).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
      archetypes: m.field.archetypes.map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name)),
      theoretics: m.field.theoretics.map((t) => ({ id: t.id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name)),
    });
    this.chrome = { setContext: (t) => this.shell.setContext(t), setControls: (n) => this.shell.setControls(n) };
    // a mode's own set on the globe is named under its title, with the whole field one click away (src/data/scope.ts)
    this.engine.onScope = (scope, whole) => this.shell.setScope(scope, whole, (on) => this.engine.setWholeField(on));
    this.panel = new Panel(root, () => this.closeSheet());
    // the sheet's visibility is the Options' first action and the globe's shift: both follow it (panel.ts)
    this.panel.onChange(() => this.syncSheet());

    // the graph: a second view of the same field, between the globe and the quiet overlay
    this.modeSwitch = new ModeSwitch(document.body, () => this.toggleMode());

    const redbook = redbookData;
    if (redbook) for (const stop of redbook.stops) this.redbookStops.add(stop.id);
    if (redbook) this.rbSpan = uSpan(redbook.stops.map((s) => m.occIndex.get(s.id)).filter((i): i is number => i !== undefined).map((i) => m.u[i]), this.fullSpan());

    // the concept data is optional (absent is the normal state, shown as none); a malformed file is reported, never hidden

    this.skyView = new SkyView(root, {
      onBody: (key) => this.onSkyPick(key),
      nameOf: (key) => this.skyName(key),
      onSign: (id) => this.openFromSky({ type: 'family', id }),
      hasFamily: (id) => this.m.famById.has(id),
    });
    // the sky camera: the one owner of the scripted sky moves. The layer is read when a move needs it (it loads at idle).
    const aspect = () => this.engine.width / Math.max(1, this.engine.height);
    this.skyCam = new SkyCamera({
      rig: this.engine.rig,
      layer: () => this.skyLayer,
      frame: () => ({ fovDeg: FOV, aspect: aspect(), shiftX: this.engine.rig.tShiftX, shiftY: this.engine.rig.tShiftY, margin: 0.6 }),
      reduced: this.engine.reduced,
      approachDist: (k) => this.approachDistOf(k, aspect()),
      homeDist: () => (this.state.sky?.natal ? Math.min(this.engine.rig.maxDist, this.chartFrameDist(aspect())) : systemHomeDist(aspect(), FOV)),
      viewLatLon: (k) => this.skyViewLatLon(k),
      setPhase: (p) => {
        document.body.dataset.skyPhase = p;
        document.body.classList.toggle('sky-gazing', p === 'gaze');
      },
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
    // taking the camera ends an orbit-gaze; the planet approach stays so you’re still on it
    if (this.skyCam.phase === 'gaze') this.endGaze();
    else this.skyCam.onUserGrab();
  }

  /**
   * End an orbit-gaze without leaving the sky: the plates and the subject's emphasis go, and the camera eases its look back
   * onto the held planet. It never releases the planet, never goes to the whole sky, never leaves Astrology.
   */
  private endGaze() {
    if (this.skyCam.phase !== 'gaze') return;
    this.floats.clear();
    this.engine.setEmphasis(null, null);
    this.skyCam.cancelGaze();
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
    // a click outside an open reading (or a passage over it) closes it to where it began; it never picks through it
    if (!this.search.isOpen && (this.state.deep || this.passage.isOpen)) { this.closeReading(); return; }
    if (idx < 0 || this.search.isOpen) return;
    // the node itself: its instance card (the parent symbol is already linked from there)
    this.openOccurrence(idx);
  }

  // ── navigation ────────────────────────────────────────────────────────
  boot() {
    this.syncRig();
    const rig = this.engine.rig;
    rig.dist = rig.targetDist = this.worldDist();
    const parsed = hashToState(location.hash, this.resolver());
    if (parsed.birthPrefill) this.birthPrefill = parsed.birthPrefill;
    if (parsed.year !== undefined) {
      this.time.scrub(this.m.scale.toU(parsed.year));
      this.time.pause();
    }
    this.applyFilter(parsed.filter);
    const go = () => {
      // the Field's default seat is the Self — blank world only under the first-visit landing
      const plain = stateEq(parsed.state, WORLD) && isEmpty(parsed.filter);
      const self = focusOn(WORLD, selfSubject(this.m));
      if (plain && this.landing.maybeShow(document.body, () => this.navigate(self))) {
        this.apply(parsed.state);
        this.started = true;
        this.syncHash(parsed.state, true);
        return;
      }
      const start = plain ? self : parsed.state;
      this.apply(start);
      this.started = true;
      this.syncHash(start, true);
    };
    if (!this.whenReady(parsed.state, go)) go();
  }

  private resolver() {
    const m = this.m;
    return {
      hasArchetype: (id: string) => m.archById.has(id),
      hasTheoretic: (id: string) => m.theoById.has(id),
      hasFamily: (id: string) => m.famById.has(id),
      hasCulture: (id: string) => m.cultureById.has(id),
      hasPlace: (id: string) => m.places.has(id),
      familyOf: (id: string) => {
        const i = m.occIndex.get(id);
        return i === undefined ? undefined : m.occ[i].familyId;
      },
      hasBody: (id: string) => !!this.skyLayer?.data.bodies.some((b) => b.key === id) || ['sun', 'moon', 'terra', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'].includes(id),
      hasReading: (id: string) => !!this.history?.readings.some(r => r.id === id),
      hasHistorySelection: (id: string, kind: string, selection: string) => {
        const reading = this.history?.readings.find(r => r.id === id);
        if (reading && kind === 'chapter') return !!this.history?.book?.chapters.some((c) => c.id === selection);
        return !!reading && (kind === 'epoch' ? reading.epochs : kind === 'event' ? reading.events : walksOf(reading)).some(x => x.id === selection);
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
    if (parsed.birthPrefill) {
      // the birth leaves the address bar and history at once; the form holds it until it is saved or left
      this.birthPrefill = parsed.birthPrefill;
      history.replaceState(history.state, '', hashWithFilter(parsed.state, this.filter));
    }
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
    if (next.dynamics && !this.lens) jobs.push(this.ensure('dynamics', () => Promise.all([import('../dynamics/view'), import('../dynamics/load')]).then(([{ DynamicsView }, { loadDynamics, loadRoute }]) => {
      const lens = new DynamicsView(this.root, this.m, this.engine, this.time, (state) => this.navigate(state), this.passages, null, this.chrome);
      this.lens = lens;
      // the standing stop's families join the subject on the globe whenever they change
      lens.onScope = () => { if (this.state.dynamics) this.scopeLens(); };
      // the concept data and the route are optional (absent is the normal state); a malformed file is reported, never hidden
      void loadDynamics().then((data) => lens.setConcepts(data)).catch((err) => console.error(err));
      void loadRoute().then((route) => lens.setRoute(route)).catch((err) => console.error(err));
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
    // a navigation asked for while a state is being applied (a lens redirecting to its first step) runs right after it,
    // so the hash is written in the order the states are applied
    if (this.applying) { queueMicrotask(() => this.navigate(next, opts)); return; }
    this.landing.dismiss();
    next = skyArrival(this.state, this.lensRoute(next));
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

  /**
   * Picks on the globe leave the dynamical reading for the subject's field card. (Rewriting every focus into
   * "X as a dynamical system" made Theory links and node clicks unusable.)
   */
  private lensRoute(next: AppState): AppState {
    return next;
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
    // in an orbit-gaze, Escape is "look back at the planet", not "let the planet go" (the spec's cancel-gaze)
    if (this.skyCam.phase === 'gaze') {
      this.endGaze();
      return;
    }
    this.navigate(back(this.state));
  }

  /** Leave the open reading (and any passage over it) for where it began. */
  private closeReading() {
    if (this.passage.isOpen) this.passage.hide();
    if (this.state.deep) this.navigate(back(this.state));
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
    // on the walk: a step, or one of a step's period-mates (every occurrence of the subject is reached from its walk)
    const inTrail = trail && this.plan(trail.target.type, trail.target.id).some(step => step.occ === i || step.also.includes(i));
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
    // from the sky a pick is a descent like any other: the sky stays behind (See in sky), the reading opens on the landing
    if (a.type === 'subject') {
      if (this.state.sky) this.openFromSky(a.subject);
      else this.navigate(focusOn(this.state, a.subject));
    } else if (a.type === 'occurrence') {
      const i = this.m.occIndex.get(a.occId);
      const manifest: AppState | null = i === undefined ? null : { view: { kind: 'manifest', occId: a.occId, context: { type: 'family', id: this.m.occ[i].familyId } }, deep: false };
      if (manifest && this.state.sky) this.navigate(openedFrom(this.state, manifest));
      else if (i !== undefined) this.navigate({ view: { kind: 'manifest', occId: a.occId, context: { type: 'family', id: this.m.occ[i].familyId } }, deep: false, ...(this.state.graph ? { graph: true as const } : {}) });
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
      this.openLens('theory'); e.preventDefault(); return;
    }
    if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.openLens('alchemy'); e.preventDefault(); return;
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
    if (this.state.history?.selection?.kind === 'chapter' && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      && this.aion?.walkBook(e.key === 'ArrowRight' ? 1 : -1)) {
      e.preventDefault();
      return;
    }
    if (this.state.dynamics && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      && this.lens?.walk(e.key === 'ArrowRight' ? 1 : -1)) {
      e.preventDefault();
      return;
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
      // an open Options disclosure closes first (a <details> does not close on Escape by itself)
      const options = document.querySelector<HTMLDetailsElement>('details.mode-options[open]');
      if (options) { options.open = false; e.preventDefault(); return; }
      // a panel lens with its sheet on screen: Escape dismisses the sheet as X does (Astrology's X steps onto its sky).
      // With the sheet hidden it falls through to stepBack, as it always did (one level out, then the Field)
      if (this.activeLens && this.panel.isVisible && !this.passage.isOpen && !this.search.isOpen && this.skyCam.phase !== 'gaze') {
        this.closeSheet();
        e.preventDefault();
        return;
      }
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
    this.timeControl.setSubject(idx, rgbToHex(pal.core));
    this.lens?.show(next.dynamics);
    this.scopeLens();
  }

  /**
   * The lens's own set on the globe: what the route speaks of — the standing stop's families, or on the overview every
   * family the route binds — with a subject's occurrences when one was chosen. Their nearby presences dim and the rest
   * of the field is set aside (src/data/scope.ts), named under the title. Without a route, the subject's own set.
   */
  private scopeLens() {
    const m = this.m;
    // Theory landing (Options waiting): no spare scope line above the clock
    if (!this.lens?.isRouteOpen && !this.state.dynamics?.stop && !this.state.dynamics?.subject && !this.state.dynamics?.route) {
      this.engine.setEmphasis(null, null);
      this.shell.setScope(null, false, () => {});
      return;
    }
    const chosen = this.state.dynamics?.subject;
    const subject = this.lensSubject(this.state);
    const standing = this.lens?.standing();
    const families = standing?.familyIds ?? this.lens?.routeFamilies() ?? [];
    const own = new Set(chosen || !families.length ? subjectOccurrences(m, subject) : []);
    for (const f of families) for (const i of m.famOcc.get(f) ?? []) own.add(i);
    const set = standing ? `“${standing.name}”` : families.length ? 'the route’s families' : '';
    const label = chosen || !set ? [subjectName(m, subject), set].filter(Boolean).join(' and ') : set;
    const sc = scopeOf(m, own, label);
    this.engine.setEmphasis(sc.rel, this.subjectPal(subject).core, sc.info);
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
      case 'field': return this.navigate(this.state.graph
        ? { view: { kind: 'world' }, deep: false, graph: true }
        : focusOn(WORLD, selfSubject(this.m)));
      case 'aion': {
        const reading = this.history ? defaultReadingId(this.history.readings) : undefined;
        if (reading) this.navigate({ view: { kind: 'world' }, deep: false, history: { reading } });
        return;
      }
      case 'redbook': if (this.redbookData) this.navigate({ view: { kind: 'world' }, deep: false, redbook: {} }); return;
      case 'theory': {
        // Theory landing: Options waiting (Jung's theory + Dynamics). Toggle off if already there with no card open.
        if (this.state.dynamics && !this.state.dynamics.stop && !this.state.dynamics.subject && !this.state.lens) {
          return this.navigate(WORLD);
        }
        if (this.state.lens?.id === 'theory') return this.navigate({ view: { kind: 'world' }, deep: false, dynamics: {} });
        return this.navigate({ view: { kind: 'world' }, deep: false, dynamics: {} });
      }
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
    this.filterMask = maskOf(this.m.occ, f, this.m.tags);
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
      setControls: (n) => { if (this.activeLens === id) this.setLensOptions(n); },
      navigate: (st) => this.navigate(st),
      filter: () => this.filter,
      passages: this.passage.bridge(),
      focus: (subject) => this.focusFromLens(subject),
      descend: (subject) => this.descendFromReading(subject),
      openBody: (key) => this.openBody(key),
      openOccurrence: (occId) => this.openReading(occId),
      setPath: (path, opts) => {
        if (this.activeLens !== id) return;
        const next = inLens(id, path);
        // Astrology walk steps keep the standing culture's names
        if (id === 'astrology' && this.state.sky?.culture && next.sky) next.sky = { ...next.sky, culture: this.state.sky.culture };
        this.navigate(next, opts);
      },
      refreshNatal: () => this.refreshNatal(),
      takeBirthPrefill: () => { const b = this.birthPrefill; this.birthPrefill = null; return b; },
      skyStatus: () => this.skyView.statusLine(),
      skyBody: () => this.state.sky?.body ?? null,
      localSheet: (on) => { if (this.activeLens === id) this.localSheetOpen = on; },
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
    // R1 (C7): the Field's time range and selection marker do not carry into Astrology
    this.syncTimeScope(next);
    this.engine.markers.sel.hide();
    if (this.graphMode) this.syncMode(false, first, true);
    if (!prev.lens || prev.lens.id !== id) {
      this.engine.setEmphasis(null, null);
      this.engine.setPalette(WORLD_PALETTE, first ? 0.01 : 1.6);
      this.timeControl.setSubject(null, '#ffffff');
    }
    this.activeLens = id;
    const path = next.lens!.path;
    // a lens entered from elsewhere starts with its sheet hidden; its content is built below, its Options are set by enterLensInstance
    if (!prev.lens || prev.lens.id !== id) this.panel.enterLens();
    this.lensShift(next);
    const have = this.lensInst.get(id);
    if (have) { this.enterLensInstance(have, path); return; }
    const tok = ++this.lensTok;
    document.body.classList.add('lens-loading');
    PANEL_LOADERS[id]().then((mod) => {
      document.body.classList.remove('lens-loading');
      if (!this.lensInst.has(id)) this.lensInst.set(id, mod.mount(this.lensContext(id)));
      if (tok !== this.lensTok || this.state.lens?.id !== id) return;
      this.enterLensInstance(this.lensInst.get(id)!, this.state.lens.path);
    }).catch((err) => {
      document.body.classList.remove('lens-loading');
      console.error(err);
      this.panel.open('Lens unavailable', [el('p', { class: 'lp-error', text: 'This lens could not be loaded. Check the connection and try again.' })]);
      this.panel.reveal();
    });
  }

  /** Hand a lens its route. A lens that sets no Options of its own still gets the standard one, so the mode is never empty. */
  private enterLensInstance(inst: LensInstance, path: string[]) {
    this.lensOptionsSet = false;
    inst.enter(path);
    if (!this.lensOptionsSet) this.setLensOptions([]);
  }

  /** The globe makes room for the sheet only while the sheet is on screen. Astrology's sky-only states never do. */
  private lensShift(next: AppState) {
    const id = next.lens!.id;
    const path = next.lens!.path;
    // Astrology live sky / [chart] alone: sky-only (no sheet). Walk / Charts home still give the sheet room.
    const asSkyOnly = id === 'astrology' && (path[0] === ASTROLOGY_LIVE || path.length === 1);
    if (asSkyOnly || !this.panel.isVisible) this.engine.rig.setShift(0, 0);
    else this.engine.rig.setShift(isNarrow() ? 0 : -0.22, isNarrow() ? (this.approachFor(next.sky) ? 0.56 : next.sky?.natal ? 0.36 : 0.26) : 0);
  }

  /**
   * A panel lens's Options. The lens's own disclosure gets the standard first action (Open, or Close, its sheet), placed
   * by the shell here and nowhere in the lenses. Null (the lens leaving) clears the shell's controls.
   */
  private setLensOptions(nodes: Node[] | null) {
    if (!nodes) { this.sheetAction = null; this.shell.setControls(null); return; }
    this.lensOptionsSet = true;
    const act = optionAction('', () => this.toggleSheet(), { pressed: false });
    this.sheetAction = act;
    const disclosure = nodes.find((n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains('mode-options')) ?? modeOptions([]);
    const body = disclosure.querySelector<HTMLElement>('.mode-options-body');
    body?.prepend(act);
    // a content choice in the Options is a request to read: it reveals the sheet. Capture phase, so the sheet is revealed
    // before the choice navigates. The standard toggle and any row marked data-no-reveal (Astrology's names) do not.
    body?.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('button');
      if (!row || row === act || !body.contains(row) || row.hasAttribute('data-no-reveal') || row.disabled) return;
      this.panel.reveal();
    }, true);
    this.shell.setControls([disclosure, ...nodes.filter((n) => n !== disclosure)]);
    this.syncSheetAction();
  }

  /** The standard action names what it does: Open the sheet, or Close it while it is revealed. No content yet: disabled. */
  private syncSheetAction() {
    const act = this.sheetAction;
    if (!act || !this.activeLens) return;
    const shown = this.panel.isRevealed;
    // the row's title sits in its own span (optionRow); the label goes there, never over the row's structure
    const title = `${shown ? 'Close' : 'Open'} ${lensDef(this.activeLens).label}`;
    const span = act.querySelector<HTMLElement>('.mode-opt-title');
    if (span) span.textContent = title; else act.textContent = title;
    act.setAttribute('aria-pressed', String(shown));
    act.disabled = !this.panel.isOpen;
  }

  /** The sheet changed: its Options action follows, and the globe follows the sheet's visibility. */
  private syncSheet() {
    this.syncSheetAction();
    if (this.activeLens && this.state.lens?.id === this.activeLens) this.lensShift(this.state);
  }

  /** The standard action: reveal the sheet, or hide it (the person's dismiss: the content stays, the mode stays). */
  private toggleSheet() {
    if (this.panel.isRevealed) this.panel.hide();
    else this.panel.reveal();
  }

  /**
   * X, Escape and the drag-down on the sheet. Astrology's X steps onto its sky, as it always has. Every other lens only
   * hides its sheet: the Options stay and the lens never leaves the mode (the Theory and Alchemy X used to leave it).
   */
  /** A local reading stands in the sheet (a card at its planet): its dismissal hides the sheet and holds the planet. */
  private localSheetOpen = false;

  private closeSheet() {
    const s = this.state;
    if (this.localSheetOpen && s.lens?.id === 'astrology' && s.sky?.body) {
      this.localSheetOpen = false;
      this.panel.hide();
      return;
    }
    // Astrology X: dismiss the sheet onto the sky still in Astrology — never Field, never bare inSky().
    // A natal chart stays on that birth sky; Charts / live sky close onto the live Astrology sky (not Jung).
    if (s.lens?.id === 'astrology') {
      const chart = s.lens.path[0] || s.sky?.natal;
      const next = chart && chart !== ASTROLOGY_LIVE
        ? (() => {
          const n = astrologyAt([chart]);
          if (s.sky?.culture) n.sky = { ...n.sky, culture: s.sky.culture };
          return n;
        })()
        : astrologyLive({ culture: s.sky?.culture });
      if (stateEq(next, s)) this.panel.close();
      else this.navigate(next);
      return;
    }
    this.panel.hide();
  }

  private leavePanelLens() {
    const id = this.activeLens;
    // the lens cleans up while it is still the active one, so its own chrome clear (Options) is not dropped (R1 F4)
    if (id) this.lensInst.get(id)?.leave();
    this.activeLens = null;
    this.localSheetOpen = false;
    this.sheetAction = null;
    this.lensTok++;
    this.panel.close();
    this.engine.rig.setShift(0, 0);
  }

  // ── applying a state ──────────────────────────────────────────────────
  private applying = false;

  private apply(next: AppState) {
    this.applying = true;
    try { this.applyState(next); } finally { this.applying = false; }
  }

  private applyState(next: AppState) {
    const prev = this.state;
    const first = !this.started;
    // a new state replaces any deferred landing chrome unless enter* re-queues it for a sky descent
    this.pendingLanding = null;
    this.readingAwaitsLanding = false;
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

    const fromSky = !!prev.sky && !next.sky;
    if (!sameView) {
      if (v.kind !== 'world') this.engine.rig.interacted = true;
      switch (v.kind) {
        case 'world': this.enterWorld(first, fromSky); break;
        case 'focus': this.enterFocus(v.subject, first, fromSky); break;
        case 'manifest': this.enterManifest(v.occId, v.context, first, fromSky); break;
        case 'thread':
          if (keepsTrail && this.tour) {
            this.reveal.hide(); this.deep.hide(); this.engine.markers.sel.hide(); this.strip.show();
            const subject = this.tour.subject;
            this.engine.setPalette(this.subjectPal(subject), 1.2);
            this.engine.setEmphasis(this.emphasise(this.tour.steps.map(s => s.occ), { relatedLevel: 1.8 }), this.subjectPal(subject).core);
            this.label.set({ name: subjectName(this.m, subject), line: 'Following the thread', up: [{ text: 'the whole field', onClick: () => this.wholeField() }], links: [{ text: 'Reading', onClick: () => this.setDeep(true) }] }, `t:${v.target.type}:${v.target.id}`);
            this.tourJump(Math.max(0, this.tour.i));
          } else this.enterThread(v.target, v.from, first);
          break;
      }
    }
    // from the sky: keep the reading closed until descendFromSky lands (pendingLanding opens it)
    this.syncDeep(next, fromSky);
    this.syncShift();
    this.measureLabel();
    this.syncGraph();
    // leaving the sky always owns the camera (reorient → drop → rotate); a thread walk keeps its own flight
    this.syncSky(prev, next, first, (!fromSky && !sameView && !this.graphMode) || !!next.trail);
  }

  // ── the sky ───────────────────────────────────────────────────────────
  toggleSky() {
    if (this.graphMode || this.state.history || this.state.redbook || this.state.dynamics) return;
    // S / sky toggle: enter Astrology on the live sky (Charts / a birth sky are chosen, never forced)
    if (this.state.lens?.id === 'astrology' || this.state.sky) this.navigate(WORLD);
    else this.navigate(astrologyLive());
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
        if (b.key === 'terra') continue; // the observer has no geocentric longitude: it is where we stand
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
  /** The natal chart standing in the sky (diagnostics, tests): null in the present sky. */
  get skyNatalChart() { return this.natalChart; }

  /** The sky's clock: follows the wall clock only while the sidecar vouches for the grids; otherwise a labelled snapshot. */
  private startSkyLive(layer: SkyLayer) {
    const live = new SkyLive(layer.baseEph, {
      base: SIDECAR_BASE,
      local: isLocalHost(),
      onChange: (s) => {
        this.skyView.setLive(s);
        // a natal sky holds its own moment; the clock resumes when it is left
        if (!this.state.sky?.natal) layer.setMoment(live.moment());
      },
    });
    this.skyLive = live;
    layer.setMoment(live.moment());
    this.skyView.setLive(live.state);
    this.engine.onFrame(() => { if (live.following && !this.state.sky?.natal) layer.setMoment(live.moment()); });
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
      for (const w of this.layerWaiters.splice(0)) w(layer);
      this.syncRig();
      document.body.classList.add('sky-ready');
      if (this.pendingSkyEntry && this.state.sky) this.enterSkyView(this.pendingSkyEntry === 'instant');
      this.pendingSkyEntry = null;
      this.syncApproach();
    }).catch((err) => {
      this.skyFailed = true;
      this.syncRig(); // no sky is coming: the pull-back's resistance beyond the atlas's limit ends
      for (const w of this.layerWaiters.splice(0)) w(null);
      console.warn(err);
      this.pendingSkyEntry = null;
    });
  }

  /**
   * Carry the camera out to the sky: the sky camera's entry, a return to the held body (ascent from the Earth) or, for the
   * whole system, a lift and one travel home.
   */
  private enterSkyView(instant: boolean) {
    if (!this.skyLayer) return;
    // the layer's poses (the Sun, the sidereal angle) must stand before a move reads them: the first entry comes before any frame
    this.skyLayer.prepare(this.engine.rig.dist);
    this.engine.rig.interacted = true;
    document.body.classList.add('interacted');
    const key = this.approachFor(this.state.sky);
    if (key) this.heldInSky = true;
    this.skyCam.enter(key, { instant });
  }

  /** Camera lat/lon that faces a body (or the default system / birth-chart view). */
  private skyViewLatLon(key: BodyKey | null): { lat: number; lon: number } {
    const layer = this.skyLayer!;
    // the Earth has no longitude of its own in the diagram (it is the origin): it is seen from a little east of the Sun's
    // side, so its day side faces the camera and the terminator shows
    if (key === 'terra') {
      return systemViewLatLon(layer.sunLongitude() + 35, SYSTEM_VIEW_ELEVATION, layer.gmst, layer.eps);
    }
    if (key) {
      return systemViewLatLon(systemViewLongitude(layer.bodyLongitude(key)), SYSTEM_VIEW_ELEVATION, layer.gmst, layer.eps);
    }
    if (this.state.sky?.natal) {
      return systemViewLatLon(layer.sunLongitude() + 90, 58, layer.gmst, layer.eps);
    }
    return systemViewLatLon(systemViewLongitude(layer.sunLongitude()), SYSTEM_VIEW_ELEVATION, layer.gmst, layer.eps);
  }

  /**
   * The body the camera approaches for its open card: a planet or the Sun. In a birth sky the Astrology walk approaches
   * each step, the Moon included (its walk begins there): the Moon's drawn place is far enough out that holding it is
   * not a zoom to the Earth.
   */
  private approachFor(sky: AppState['sky']): BodyKey | null {
    if (!sky?.body) return null;
    return isSkyApproachBody(sky.body) ? sky.body : null;
  }

  /** How far the camera stands from `key` for its disc to fill the view (Earth radii). */
  private approachDistOf(key: BodyKey, aspect: number): number {
    const body = this.skyLayer?.data.bodies.find((b) => b.key === key);
    // every held body carries its satellites, whose outer orbit is 1.86 discs wide: the disc is kept to 42% of the width so
    // the orbit and its names fit a phone, live sky and birth sky alike (a desktop's 30% of the height is the tighter bound)
    return approachDist(body?.radiusKm ?? 6371.0084, FOV, aspect, 0.42);
  }

  /**
   * The sky's approach follows the held body. Already out in the sky: turn and move in — no forced zoom-out.
   * Planet-to-planet at close range: rise just enough for a clean turn, then in. A birth sky with no body frames the ring.
   */
  private syncApproach() {
    if (!this.skyLayer) return;
    const key = this.approachFor(this.state.sky);
    if (key === this.skyCam.key || this.skyCam.busy) return;
    // a gaze lets go with its body: the plates go, and the gaze is released so the travel runs as an approach (not a gaze)
    if (this.skyCam.phase === 'gaze') {
      this.floats.clear();
      this.skyCam.release();
    }
    if (key) this.heldInSky = true;
    this.skyCam.approach(key);
  }

  /** The distance at which a birth chart's ring fills about two thirds of the view's narrower side. */
  private chartFrameDist(aspect: number): number {
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    // a phone gives the ring the band between the title and the half sheet: about a quarter of the height
    const fill = isNarrow() ? 0.5 * aspect : 0.66 * Math.min(1, aspect * 0.72);
    return (CHART_RADIUS * 1.15) / (fill * tanHalf);
  }

  /** The sky is left without a descent (a gesture out, or a re-frame): the sky camera lets go of its body. */
  private releaseApproach() {
    this.skyCam.release();
  }

  /** Where a field view wants the camera once the sky has been left (focus / manifestation). */
  private earthTargetFor(s: AppState): { lat: number; lon: number; dist: number } | null {
    const m = this.m;
    const v = s.view;
    if (v.kind === 'focus') {
      const idx = subjectOccurrences(m, v.subject).filter((i) => this.passing(i) && m.located[i]);
      if (!idx.length) return null;
      const sp = spreadOf(idx.map((i) => m.dir[i]));
      if (!sp) return null;
      // a wide archetype (Self, Anima, …): land on one real place near the centre, not a world-scale framing
      // that only looked right for tight symbols like Sol niger
      if (sp.radius > 0.55) {
        const centre = dirFromLatLon(sp.lat, sp.lon);
        let best = idx[0], bestAng = Infinity;
        for (const i of idx) {
          const a = angleBetween(centre, m.dir[i]);
          if (a < bestAng) { bestAng = a; best = i; }
        }
        const o = m.occ[best];
        const dist = o.geoPrecision === 'culture' ? 3.0 : o.geoPrecision === 'region' ? 2.6 : 2.25;
        return { lat: o.lat, lon: o.lon, dist };
      }
      return { lat: sp.lat, lon: sp.lon, dist: Math.max(this.frameDistance(sp.radius * 1.18 + 0.07), 1.9) };
    }
    if (v.kind === 'manifest') {
      const oi = m.occIndex.get(v.occId);
      if (oi === undefined || !m.located[oi]) return null;
      const o = m.occ[oi];
      const dist = o.geoPrecision === 'culture' ? 3.0 : o.geoPrecision === 'region' ? 2.6 : 2.25;
      return { lat: o.lat, lon: o.lon, dist };
    }
    return null;
  }

  /**
   * Leave the sky for the field: the chrome goes at once, then the sky camera drops onto the landing and settles. The field's
   * own chrome (label, reveal, reading) waits for the landing (`pendingLanding`). Escape / See in sky return through
   * `openedFrom` to the sky the link left.
   */
  private descendFromSky(next: AppState, instant: boolean) {
    this.floats.clear();
    this.label.set(null);
    this.reveal.hide();
    this.hover.hide();
    this.deep.hide();
    const target = this.earthTargetFor(next);
    // a subject with no placed instance has no node to land on: drop straight down onto the face of the Earth that the
    // camera is looking at (the rig's lat/lon are about the planet in the sky, not about the Earth, so read the pose)
    const [px, py, pz] = this.engine.rig.snapshot().pos;
    const pl = Math.hypot(px, py, pz) || 1;
    const facing = latLonFromDir([px / pl, py / pl, pz / pl]);
    const land = target ?? { lat: facing.lat, lon: facing.lon, dist: this.worldDist() };
    // high enough to read the globe, still aimed at the node so the drop does not park on empty ocean
    const high = target
      ? Math.max(land.dist * 1.85, Math.min(this.worldDist(), land.dist + 1.35))
      : this.worldDist();
    const landUi = () => {
      const ui = this.pendingLanding;
      this.pendingLanding = null;
      if (!ui) return;
      // the field chrome waits for a still moment on the landing (the settle's last ease must have stopped), and never shows
      // for a state that has since been replaced
      const landed = this.state;
      const show = () => { if (this.state === landed) ui(); };
      if (instant || this.engine.reduced) show();
      else window.setTimeout(show, 300);
    };
    this.skyCam.descend({ lat: land.lat, lon: land.lon, dist: land.dist, high }, { instant }, landUi);
  }

  /**
   * From an approached planet: stay exactly there — only turn the camera to look at Earth, then float images.
   * No translation, no leaving Astrology, no releasing the planet. Float click descends.
   */
  private gazeEarthFromPlanet(subject: Subject) {
    const held = this.skyCam.key ?? this.skyLayer?.approached ?? this.approachFor(this.state.sky);
    if (!this.state.sky || !held) {
      this.navigate(openedFrom(this.state, focusOn(WORLD, subject)));
      return;
    }
    // a turn is under way: the click waits for it (the satellites stand down while the camera turns)
    if (this.skyCam.busy) return;
    const e = this.engine;
    const m = this.m;
    let idx = subjectOccurrences(m, subject).filter((i) => this.passing(i));
    if (!idx.length) idx = subjectOccurrences(m, subject);
    const target = this.earthTargetFor({ view: { kind: 'focus', subject }, deep: false });
    e.rig.interacted = true;

    const sp = spreadOf(idx.filter((i) => m.located[i]).map((i) => m.dir[i]));
    const centre = sp ?? (target ? { lat: target.lat, lon: target.lon } : e.rig.centre());
    // the plates stand once the turn has arrived: the Earth's point is then where the camera is looking
    const showPlates = () => this.floats.set(this.gazePlates(subject, idx, centre), isNarrow(), { anchor: 'earth-point' });
    const gazing = (): boolean => this.skyCam.phase === 'gaze';
    this.floats.clear();
    // the Earth held is already looked at: its plates stand on it where the camera is, with no turn to make
    if (held === 'terra' || gazing()) showPlates();
    else {
      this.skyCam.gaze(showPlates);
      // a gaze that did not start (no placed planet, not stationed) still offers its plates, rather than none
      if (!gazing()) showPlates();
    }
    const pal = this.subjectPal(subject);
    this.engine.setEmphasis(idx.length ? this.emphasise(idx) : null, pal.core);
  }

  /**
   * The plates of a gaze from a planet. The first is always the subject itself (its own image, or a tonal plate under its
   * name), which descends to the subject. The rest are instances of the subject: those with images first, then the located
   * ones without, each spread by distance from the rest. No family plate is offered here: a family plate would descend into
   * another family's focus. Anchoring is the floats' job (every plate hangs from the Earth's projected point); `dir` names
   * where the instance is.
   */
  private gazePlates(subject: Subject, idx: number[], centre: { lat: number; lon: number }): FloatItem[] {
    const m = this.m;
    const max = isNarrow() ? 3 : 5;
    const c = dirFromLatLon(centre.lat, centre.lon);
    const own = subject.type === 'family' ? m.famById.get(subject.id)?.image
      : subject.type === 'archetype' ? m.archById.get(subject.id)?.image
      : subject.type === 'theoretic' ? m.theoById.get(subject.id)?.image
      : undefined;
    const ownPal = subject.type === 'family' ? m.famById.get(subject.id)?.palette
      : subject.type === 'archetype' ? m.archById.get(subject.id)?.palette
      : subject.type === 'theoretic' ? m.theoById.get(subject.id)?.palette
      : undefined;
    const placed = idx.filter((i) => m.located[i]);
    const nearest = (list: number[]) => list.reduce((a, b) => (angleBetween(c, m.dir[a]) <= angleBetween(c, m.dir[b]) ? a : b));
    const items: FloatItem[] = [{
      dir: placed.length ? m.dir[nearest(placed)] : c,
      img: own,
      label: subjectName(m, subject),
      era: '',
      palette: ownPal,
      target: { type: 'subject', subject },
    }];
    // one image per source: an occurrence whose picture the subject already shows adds nothing
    const seen = new Set<string>();
    if (own?.src) seen.add(own.src);
    const unique = (list: number[]) => list.filter((i) => {
      const src = m.occ[i].image?.src;
      if (!src) return true;
      if (seen.has(src)) return false;
      seen.add(src);
      return true;
    });
    // farthest-point spread: the first pick is nearest the centre, each next is furthest from those already chosen
    const spread = (list: number[], k: number): number[] => {
      const left = list.slice();
      const out: number[] = [];
      while (out.length < k && left.length) {
        let bj = 0, bs = -Infinity;
        left.forEach((i, j) => {
          const s = out.length ? Math.min(...out.map((o) => angleBetween(m.dir[i], m.dir[o]))) : -angleBetween(c, m.dir[i]);
          if (s > bs) { bs = s; bj = j; }
        });
        out.push(left.splice(bj, 1)[0]);
      }
      return out;
    };
    const k = max - 1;
    const chosen = spread(unique(placed.filter((i) => !!m.occ[i].image)), k);
    if (chosen.length < k) chosen.push(...spread(placed.filter((i) => !m.occ[i].image), k - chosen.length));
    for (const i of chosen) {
      const o = m.occ[i];
      items.push({ dir: m.dir[i], img: o.image, label: o.label, era: eraShort(o.yearDisplay, 22), palette: m.famById.get(o.familyId)?.palette, target: { type: 'occurrence', occIdx: i } });
    }
    return items;
  }

  /** A single placard on Earth when the orbit target has no located field instances. */
  private gazeFallbackFloats(subject: Subject, centre: { lat: number; lon: number }): FloatItem[] {
    const m = this.m;
    const own = subject.type === 'family' ? m.famById.get(subject.id)?.image
      : subject.type === 'archetype' ? m.archById.get(subject.id)?.image : undefined;
    const pal = subject.type === 'family' ? m.famById.get(subject.id)?.palette
      : subject.type === 'archetype' ? m.archById.get(subject.id)?.palette : undefined;
    const dir = dirFromLatLon(centre.lat, centre.lon);
    return [{
      dir,
      img: own,
      label: subjectName(m, subject),
      era: '',
      palette: pal,
      target: subject.type === 'family'
        ? { type: 'family', id: subject.id }
        : { type: 'reading' },
    }];
  }

  /** A field subject opened from the sky (a sky card's tie, a sign's glyph): the sky stands behind the reading as `from`. */
  private openFromSky(t: Subject) {
    this.navigate(openedFrom(this.state, focusOn(WORLD, t)));
  }

  /** Lens / orbit tie: gaze from the planet when held; otherwise leave into the field. */
  private focusFromLens(subject: Subject) {
    const held = this.skyCam.key ?? this.skyLayer?.approached ?? this.approachFor(this.state.sky);
    if (this.state.sky && held) {
      this.gazeEarthFromPlanet(subject);
      return;
    }
    this.navigate(openedFrom(this.state, focusOn(WORLD, subject)));
  }

  /**
   * An action inside an open reading in the sky (a tie, "Read it in the field"): the reading closes with the click and the
   * camera descends to the node at once — no gaze, no second click. The same descent as a plate's click, from where the
   * camera stands: it looks at the Earth, drops, settles, and the node's reading opens on the landing.
   */
  private descendFromReading(subject: Subject) {
    this.openFromSky(subject);
  }

  /** The label for a body under the standing culture: its table name where there is one, else the default. */
  private skyName(key: BodyKey): string {
    const data = this.skyLayer?.data;
    const culture = this.state.sky?.culture;
    return (culture && data?.cultures[culture]?.[key]?.name) || data?.bodies.find((b) => b.key === key)?.name || key;
  }

  private syncSky(prev: AppState, next: AppState, first: boolean, reframed: boolean) {
    const on = !!next.sky;
    this.skyView.setActive(on, next.sky?.body ?? null);
    this.skyView.relabel();
    this.syncNatal(prev.sky?.natal, next.sky?.natal, !!next.sky);
    if (on && !prev.sky) {
      this.requestSky();
      this.heldInSky = false;
      if (this.skyByGesture) this.skyByGesture = false;
      else if (this.skyLayer) this.enterSkyView(first);
      else if (!this.skyFailed) this.pendingSkyEntry = first ? 'instant' : 'fly';
    } else if (!on && prev.sky) {
      this.pendingSkyEntry = null;
      this.heldInSky = false;
      if (this.skyByGesture) {
        this.skyByGesture = false;
        this.releaseApproach();
      } else if (!reframed) {
        // reorient onto the Earth, drop, then rotate to the field node (focus / manifestation)
        this.descendFromSky(next, first);
      } else {
        this.releaseApproach();
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

  /**
   * The natal sky changed (Astrology opened a chart, changed it, or left): bring the sky to that chart's moment, or back
   * to the clock. The chart is computed in this page (src/astro/natal.ts, loaded only now); its birth data is read from
   * this browser's storage or from the curation (Jung), never from the URL, and nothing is sent anywhere.
   */
  private syncNatal(prev: string | undefined, next: string | undefined, inSkyNow: boolean) {
    // a phone gives a birth sky its whole upper band: the sky's names control and caption step aside (Astrology's panel
    // carries the chart's reading)
    document.body.classList.toggle('natal-sky', !!next && inSkyNow);
    if (prev === next) return;
    void this.applyNatal(next, inSkyNow);
  }

  /** Re-read the standing natal chart (the visitor saved or changed theirs). */
  refreshNatal() {
    const id = this.state.sky?.natal;
    if (id) void this.applyNatal(id, true);
  }

  private async applyNatal(id: string | undefined, visible: boolean) {
    const gen = ++this.natalGen;
    const layer = await this.whenLayer();
    if (!layer || gen !== this.natalGen) return;
    const duration = this.engine.reduced || !visible ? 0 : 2600;
    if (!id) {
      // back to the present: the chart is taken away and the bodies travel home to the clock
      this.natalChart = null;
      layer.chart.set(null);
      this.skyView.setHeld(null);
      layer.travel(layer.baseEph, this.skyLive?.moment() ?? Date.now(), duration);
      return;
    }
    try {
      const [{ natalChart, natalWindow, birthInstant }, { chartSources }, data] = await Promise.all([
        import('../astro/natal'), import('../astro/charts'), loadLensData<{ people: CuratedPerson[] }>('astrology'),
      ]);
      if (gen !== this.natalGen) return;
      const rec = chartSources(data.people).find((c) => c.id === id);
      if (!rec) {
        // a chart this browser does not hold (a link from someone else's 'you'): the lens opens on its own landing
        this.natalChart = null;
        layer.chart.set(null);
        if (this.state.sky?.natal === id) this.navigate(astrologyAt([]), { replace: true });
        return;
      }
      const chart = natalChart(rec.birth);
      const ms = birthInstant(rec.birth);
      const eph = new SkyEphemeris(dataWithWindow(layer.data, natalWindow(ms)));
      this.natalChart = chart;
      layer.chart.set(chart);
      layer.chart.setOptions({ aspects: true, houses: false });
      layer.travel(eph, ms, duration, true);
      this.skyView.setHeld(`The sky is held at ${rec.label === 'You' ? 'your birth' : `${rec.label}’s birth`}, ${formatMoment(ms)}${chart.timeKnown ? '' : ' (local noon: no time was given)'}.`);
      // the ring stands around the Earth at the scale of the system: bring the camera out to see it
      if (visible && this.engine.rig.dist < STAGE_EDGES.handoff && !this.approachFor(this.state.sky)) this.enterSkyView(this.engine.reduced);
    } catch (e) {
      if (gen !== this.natalGen) return;
      console.error(e);
      this.natalChart = null;
      layer.chart.set(null);
      this.skyView.setHeld(null);
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
    // a scripted sky move, or a body held since the sky was entered, never gets the arrival's rotation (the whole-sky rotation)
    const eligible = !!layer && !!sky && !sky.natal && !this.approachFor(sky) && !layer.approach && !this.engine.reduced
      && !this.skyCam.busy && !this.heldInSky && rig.wheelDriven && !rig.flying && !rig.dragging && rig.dist >= STAGE_EDGES.system
      && now - rig.lastWheelAt >= SETTLE.idleMs && now - rig.lastDragAt >= SETTLE.quietDragMs;
    if (!eligible || !layer) { rig.settleTo = null; return; }
    rig.settleTo = systemViewLatLon(systemViewLongitude(layer.sunLongitude()), SYSTEM_VIEW_ELEVATION, layer.gmst, layer.eps);
  }

  /**
   * The zoom gesture crossing the sky's edges: zooming out from the Field (the globe, a focus, a walk) enters Astrology on the
   * live sky, and zooming back in by the wheel or pinch returns to the Field. The transition is store.skyGestureState.
   */
  private watchSkyGesture() {
    // the sky camera owns the camera while a move runs: no scripted move is read as the user's zoom (C10)
    if (this.skyCam.busy) return;
    this.settleArrival();
    const rig = this.engine.rig;
    if (!this.skyRequested && rig.dist > 4.4) this.requestSky();
    // other modes own the camera; a scripted flight is never read as a zoom
    if (!this.skyLayer || rig.flying) return;
    // orbit-gaze: stationed at a planet looking at Earth — never treat the look-at release as a zoom-out of the sky
    if (this.skyCam.phase === 'gaze') return;
    // a held Earth pins the stage to the system (the whole sky stands about it), so the sky's own exit, measured on the stage,
    // never fires there; the Field is taken from the Earth by zooming in past its own edge, on the camera's distance
    const earthHeld = this.skyCam.key === 'terra' && this.skyCam.phase === 'approach' && this.state.sky?.body === 'terra';
    const next = earthHeld
      ? skyGestureState(this.state, rig.dist, { enter: SKY_ENTER, exit: EARTH_FIELD_EXIT }, rig.wheelDriven)
      : skyGestureState(this.state, this.engine.stageDist, { enter: SKY_ENTER, exit: SKY_EXIT }, rig.wheelDriven);
    if (!next) return;
    // leaving a held Earth is a descent (the camera drops onto the globe under the pin, the approach easing off about the
    // Earth's own centre); releasing its approach at once would hand the sky's far stage back to the Field's camera and the
    // gesture would read it as a pull-back, entering the sky again
    this.skyByGesture = !(earthHeld && !next.sky);
    this.navigate(next, { replace: !next.sky });
  }

  /** Open a body from outside the sky (See in sky, a family's reveal): enter Astrology on that body. */
  openBody(key: BodyKey) {
    if (this.graphMode || this.state.history) return;
    if (this.state.lens?.id === 'astrology' && this.state.sky?.natal) {
      const chart = this.state.lens.path[0] || this.state.sky.natal;
      const next = astrologyAt([chart]);
      next.sky = { natal: this.state.sky.natal, body: key };
      if (this.state.sky.culture) next.sky.culture = this.state.sky.culture;
      this.navigate(next);
      return;
    }
    this.navigate(astrologyLive({ body: key, culture: this.state.sky?.culture }));
  }

  /** A body clicked on the canvas: as onSkyPick, except that a click outside an open reading only closes it. */
  onCanvasSkyPick(key: BodyKey) {
    if (!this.search.isOpen && (this.state.deep || this.passage.isOpen)) { this.closeReading(); return; }
    this.onSkyPick(key);
  }

  onSkyPick(key: BodyKey) {
    if (this.graphMode || this.state.history) return;
    // Astrology: approach the planet — stay in Astrology (Options + orbits), no walk sheet
    if (this.state.lens?.id === 'astrology') {
      const chart = this.state.lens.path[0] || this.state.sky?.natal;
      if (chart && chart !== ASTROLOGY_LIVE && this.state.sky?.natal) {
        const next = astrologyAt([this.state.sky.natal]);
        next.sky = { natal: this.state.sky.natal, body: key };
        if (this.state.sky.culture) next.sky.culture = this.state.sky.culture;
        this.navigate(next);
        return;
      }
      this.navigate(astrologyLive({ body: key, culture: this.state.sky?.culture }));
      return;
    }
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
    else if (t === 't') this.navigate(focusOn(this.state, { type: 'theoretic', id }));
    else if (t === 'f') this.navigate(focusOn(this.state, { type: 'family', id }));
    else this.openOccurrenceId(id);
  }

  /** A body in the graph opens Astrology on that body, as the S key's flight would enter the sky. */
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

  private syncDeep(s: AppState, defer = false) {
    const open = s.deep && s.view.kind !== 'world';
    if (defer && open) {
      // descend still in flight — pendingLanding will syncDeep when the camera settles
      this.readingAwaitsLanding = true;
      this.deep.hide();
      document.body.classList.remove('deep-open');
      return;
    }
    if (this.readingAwaitsLanding) {
      // the landing: the scene gives the reading its room only now, not for the whole drop
      this.readingAwaitsLanding = false;
      this.syncShift();
    }
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
    if (s.deep && s.view.kind !== 'world' && !this.readingAwaitsLanding) {
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
  private enterWorld(first: boolean, fromSky = false) {
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
    // leaving the sky owns the camera (descendFromSky); do not start a second flight here
    if (!first && !this.graphMode && !fromSky) {
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

  private enterFocus(subject: Subject, first: boolean, fromSky = false) {
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
    // from the sky: descendFromSky drops, then rotates to the node — do not overwrite that with a single hop
    const sp = fromSky ? spreadOf(idx.filter((i) => m.located[i]).map((i) => m.dir[i]))
      : (idx.length ? this.frameSet(idx, { duration: first ? 0.01 : undefined }) : null);
    if (first && sp && !fromSky) e.rig.flyTo(sp.lat, sp.lon, this.frameDistance(sp.radius * 1.18 + 0.07), { instant: true });
    this.floats.clear();
    this.timeControl.setSubject(idx, rgbToHex(pal.core));
    this.setBody(subject.type);
    this.shell.setContext(subjectName(m, subject));
    const showChrome = () => {
      if (!fromSky) this.floats.set(this.pickShowcase(subject, idx, sp ? { lat: sp.lat, lon: sp.lon } : null), isNarrow());
      this.setLabelFor(subject);
      this.syncDeep(this.state);
    };
    if (fromSky) this.pendingLanding = showChrome;
    else showChrome();
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
    if (subject.type === 'family' || subject.type === 'archetype') {
      // a thread walks placed occurrences: a subject with none has no thread, and the label says why (no dead link)
      const all = subjectOccurrences(this.m, subject);
      if (all.some((i) => this.m.located[i])) content.links!.push({ text: 'Follow the thread', onClick: () => this.followThread() });
      else content.line = [content.line, all.length ? `No thread: its ${all.length === 1 ? 'one instance has' : `${all.length} instances have`} no recorded place.` : 'No thread: the field records no instance of it yet.'].filter(Boolean).join(' ');
    }
    // persistent sky door: return to the sky we left, or open the body's sky when the subject has a tie
    this.addSeeInSky(content, subject);
    // an archetype with a deep field (the Great Mother is the first) opens it from its focus
    if (subject.type === 'archetype' && DEEP_FIELDS.has(subject.id)) content.links!.push({ text: 'The deep field', onClick: () => this.navigate(inLens('symbols', ['archetype', subject.id])) });
    content.links!.push({ text: 'Reading', onClick: () => this.setDeep(true) });
    this.label.set(content, `f:${subject.type}:${subject.id}`);
  }

  /** Back to the sky a reading was opened from, in one step (the reading the descent carried closes with it). */
  private returnToSkyFrom() {
    if (this.passage.isOpen) this.passage.hide();
    const from = this.state.from;
    if (from?.sky) this.navigate(from);
    else this.stepBack();
  }

  /** "See in sky" whenever there is a way back (opened from the sky) or a standing body↔field tie. */
  private addSeeInSky(content: LabelContent, subject: Subject) {
    const fromSky = this.state.from?.sky;
    if (fromSky) {
      const body = fromSky.body;
      const label = body ? `See in sky (${this.skyName(body)})` : 'See in sky';
      // the door back is one click whatever is open over the node: the arrival's reading does not stand in its way
      content.links!.unshift({ text: label, onClick: () => this.returnToSkyFrom() });
      return;
    }
    if (subject.type !== 'family' && subject.type !== 'archetype') return;
    const kind = subject.type;
    const id = subject.id;
    const apply = (ties: { body: BodyKey; name: string }[]) => {
      if (!ties.length || this.state.view.kind !== 'focus') return;
      const t = ties[0];
      // refresh only if this focus is still the one we labelled
      const v = this.state.view;
      if (v.kind !== 'focus' || v.subject.type !== kind || v.subject.id !== id) return;
      const links = content.links ?? [];
      if (links.some((l) => l.text.startsWith('See in sky'))) return;
      links.unshift({ text: `See in sky (${t.name})`, onClick: () => this.openBody(t.body) });
      content.links = links;
      this.label.set(content, `f:${kind}:${id}`);
    };
    const ready = this.skyTies.forSubject(kind, id);
    if (ready.length) apply(ready);
    else void this.skyTies.ensure().then(() => apply(this.skyTies.forSubject(kind, id)));
  }

  private setBody(_k: string | null) {
    // reserved: per-kind styling hooks
  }

  /** Out of every focus at once: the whole field, as the globe or as the graph — the breadcrumb's last door. */
  private wholeField() {
    this.navigate(this.state.graph ? { view: { kind: 'world' }, deep: false, graph: true } : WORLD);
  }

  private onFloatSelect(t: FloatTarget) {
    // from a planet gaze: the float is the descend — leave the sky for that target (the subject, or an instance of it)
    if (this.state.sky && this.skyCam.phase === 'gaze') {
      const from = this.state;
      if (t.type === 'occurrence') {
        const next = this.occurrenceState(WORLD, this.m.occ[t.occIdx].id);
        if (next) this.navigate(openedFrom(from, next));
        return;
      }
      if (t.type === 'subject') this.navigate(openedFrom(from, focusOn(WORLD, t.subject)));
      return;
    }
    if (t.type === 'occurrence') this.openOccurrence(t.occIdx);
    else if (t.type === 'family') this.navigate(focusOn(this.state, { type: 'family', id: t.id }));
    else if (t.type === 'subject') this.navigate(focusOn(this.state, t.subject));
    else this.setDeep(true);
  }

  /**
   * A few large images surfaced in the field: the subject's own, then those of
   * the forms and occurrences within it, spread across its distribution.
   */
  private pickShowcase(subject: Subject, idx: number[], centre: { lat: number; lon: number } | null): FloatItem[] {
    if (!idx.length) return centre ? this.gazeFallbackFloats(subject, centre) : [];
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
    const own = subject.type === 'family' ? m.famById.get(subject.id)?.image
      : subject.type === 'archetype' ? m.archById.get(subject.id)?.image
      : subject.type === 'theoretic' ? m.theoById.get(subject.id)?.image
      : undefined;
    const ownPal = subject.type === 'family' ? m.famById.get(subject.id)?.palette
      : subject.type === 'archetype' ? m.archById.get(subject.id)?.palette
      : subject.type === 'theoretic' ? m.theoById.get(subject.id)?.palette
      : undefined;
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
  private enterManifest(occId: string, context: Subject, first: boolean, fromSky = false) {
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
      // from the sky the staged descent rotates here after the drop; otherwise fly straight to the place
      if (m.located[oi] && !fromSky) e.rig.flyTo(o.lat, o.lon, dist, { instant: first });
      if (m.located[oi]) e.markers.sel.show(m.dir[oi], famPal.core);
      else e.markers.sel.hide();
    }
    this.timeControl.setSubject(m.famOcc.get(o.familyId) ?? null, rgbToHex(famPal.core));
    this.shell.setContext(o.label);
    const showChrome = () => {
      this.reveal.show(oi);
      this.label.set({ name: subjectName(m, context), back: () => this.stepBack(), up: [{ text: 'the whole field', onClick: () => this.wholeField() }] }, `m:${context.type}:${context.id}`);
      this.syncDeep(this.state);
    };
    if (fromSky) {
      this.reveal.hide();
      this.label.set(null);
      this.pendingLanding = showChrome;
    } else {
      showChrome();
    }
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
    this.strip.setIndex(0, members[0], steps[0]?.also);
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
      up: [{ text: 'the whole field', onClick: () => this.wholeField() }],
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
    this.strip.setIndex(i, step.occ, step.also);
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
    this.skyCam.update(dt);
    // a held body the sky camera has not been sent to (it came while a return or a descent ran) is applied once it is idle
    if (!this.skyCam.busy && this.skyLayer && this.state.sky && this.approachFor(this.state.sky) !== this.skyCam.key) this.syncApproach();
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
