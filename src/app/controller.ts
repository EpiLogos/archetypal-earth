// The conductor: owns the state machine, the hash, and the choreography between
// the globe (camera, atmosphere, emphasis, arcs) and the quiet DOM layers.
import type { Model, Subject } from '../data/model';
import { archetypesOfFamily, subjectExists, subjectLine, subjectName, subjectOccurrences, subjectPalette } from '../data/model';
import { angleBetween, dirFromLatLon, fitDistance, spreadOf, worldDistance, type Vec3 } from '../data/geo';
import { averagePalettes, rgbToHex, WORLD_PALETTE, type RGBPalette } from '../data/palette';
import { buildSearchIndex, type SearchResult } from '../data/search';
import { planThread, type ThreadStep } from '../data/thread';
import { FOV, type GlobeEngine } from '../globe/engine';
import { hashToState, stateToHash } from '../state/router';
import { back, focusOn, startThread, stateEq, threadSubject, viewEq, WORLD, type AppState, type ThreadTarget, type View } from '../state/store';
import type { TimeModel, TimeSnapshot } from '../state/timeModel';
import { DEFAULT_RAMP } from '../data/time';
import { FocusLabel, type LabelContent } from '../ui/focus-label';
import { DeepSheet, type DeepTarget } from '../ui/deep';
import { Floats, type FloatItem, type FloatTarget } from '../ui/floats';
import { HoverLabel } from '../ui/hover-label';
import { Reveal } from '../ui/reveal';
import { SearchUI } from '../ui/search';
import { Strip } from '../ui/strip';
import { TimeControl } from '../ui/time-control';
import { isNarrow } from '../ui/dom';
import { eraShort } from '../data/text';

const REL_RECEDED = 0.2;
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

  constructor(private m: Model, private engine: GlobeEngine, private time: TimeModel, root: HTMLElement) {
    this.rel = new Float32Array(m.occ.length);
    this.searchIndex = buildSearchIndex(m);

    this.floats = new Floats(root, (t) => this.onFloatSelect(t));
    this.floats.obstacles = () => [this.labelRect];
    this.label = new FocusLabel(root);
    this.reveal = new Reveal(root, m, {
      onParallel: (id) => this.openOccurrenceId(id),
      onThread: () => this.followThread(),
      onParallelThread: () => this.followParallels(),
      onDeep: () => this.setDeep(true),
      onClose: () => this.stepBack(),
    });
    this.deep = new DeepSheet(root, m, {
      onClose: () => this.setDeep(false),
      onSubject: (s) => this.navigate(focusOn(this.state, s)),
      onOccurrence: (id) => this.openOccurrenceId(id),
    });
    this.strip = new Strip(root, m, {
      onSelect: (i) => this.tourJump(i),
      onOpen: (i) => this.tour && this.openOccurrence(this.tour.steps[i].occ),
      onToggle: () => this.tourToggle(),
    });
    this.hover = new HoverLabel(root);
    this.timeControl = new TimeControl(root, m, time, () => this.onUserTime());
    this.search = new SearchUI(root, this.searchIndex, (r) => this.chooseResult(r), (open) => {
      document.body.classList.toggle('search-open', open);
      if (open) this.hover.hide();
    });

    document.getElementById('search-btn')?.addEventListener('click', (e) => this.search.open(e.currentTarget as HTMLElement));
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('hashchange', this.onHash);
    window.addEventListener('resize', () => { this.syncRig(); this.syncShift(); this.strip.recenter(); this.measureLabel(); });
    engine.onFrame((dt) => this.tick(dt));
  }

  /** The distance at which the whole earth sits in view for this viewport. */
  private worldDist(): number {
    return worldDistance(this.engine.width / Math.max(1, this.engine.height), FOV);
  }

  private syncRig() {
    this.engine.rig.maxDist = Math.max(5.4, this.worldDist() + 0.9);
  }

  // ── engine callbacks ──────────────────────────────────────────────────
  onInteract() {
    document.body.classList.add('interacted');
  }

  onGrab() {
    if (this.tour && this.tour.playing && this.tour.phase !== 'intro') this.tourPause();
  }

  onUserTime() {
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
    this.apply(parsed.state);
    this.started = true;
    this.syncHash(parsed.state, true);
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
    this.apply(parsed.state);
  };

  private syncHash(s: AppState, replace = false) {
    const h = stateToHash(s);
    if (location.hash === h || (h === '#/' && (location.hash === '' || location.hash === '#'))) return;
    if (replace) {
      history.replaceState(null, '', h);
      return;
    }
    this.pendingHash = h;
    location.hash = h;
  }

  navigate(next: AppState) {
    if (stateEq(next, this.state)) return;
    if (next.view.kind === 'thread') {
      const t = next.view.target;
      if (planThread(this.m, t.type, t.id).length < 2) next = { view: next.view.from, deep: false };
      if (stateEq(next, this.state)) return;
    }
    this.apply(next);
    this.syncHash(next);
  }

  stepBack() {
    if (this.search.isOpen) {
      this.search.close();
      return;
    }
    this.navigate(back(this.state));
  }

  private setDeep(deep: boolean) {
    if (this.state.view.kind === 'world') return;
    this.navigate({ view: this.state.view, deep });
  }

  private openOccurrence(idx: number) {
    this.openOccurrenceId(this.m.occ[idx].id);
  }

  private openOccurrenceId(id: string) {
    const i = this.m.occIndex.get(id);
    if (i === undefined) return;
    const o = this.m.occ[i];
    const famSubject: Subject = { type: 'family', id: o.familyId };
    const v = this.state.view;
    let ctx: Subject = famSubject;
    if (v.kind === 'focus' && this.inSubject(v.subject, i)) ctx = v.subject;
    else if (v.kind === 'manifest' && this.inSubject(v.context, i)) ctx = v.context;
    else if (v.kind === 'thread') {
      const ts = threadSubject(v.target, famSubject);
      if (v.target.type !== 'parallels' && this.inSubject(ts, i)) ctx = ts;
    }
    this.navigate({ view: { kind: 'manifest', occId: id, context: ctx }, deep: false });
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
      if (i !== undefined) this.navigate({ view: { kind: 'manifest', occId: a.occId, context: { type: 'family', id: this.m.occ[i].familyId } }, deep: false });
    } else {
      // a period: set the time window; leave the current state where it is
      const sc = this.m.scale;
      const uTo = sc.toU(a.to);
      const span = Math.max(0.05, sc.toU(a.to) - sc.toU(a.from));
      this.onUserTime();
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
    if (e.key === 'Escape') {
      this.stepBack();
      e.preventDefault();
      return;
    }
    const onBody = !t || t === document.body || t.classList?.contains('globe-canvas');
    if (!onBody || e.metaKey || e.ctrlKey || e.altKey) return;
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

  // ── applying a state ──────────────────────────────────────────────────
  private apply(next: AppState) {
    const prev = this.state;
    const first = !this.started;
    this.state = next;
    const v = next.view;
    const pv = prev.view;
    document.body.dataset.state = v.kind;
    const sameView = !first && viewEq(pv, v);

    if (!sameView) {
      if (pv.kind === 'thread') this.endThread();
      if (v.kind !== 'world') this.engine.rig.interacted = true;
      switch (v.kind) {
        case 'world': this.enterWorld(first); break;
        case 'focus': this.enterFocus(v.subject, first); break;
        case 'manifest': this.enterManifest(v.occId, v.context, first); break;
        case 'thread': this.enterThread(v.target, v.from, first); break;
      }
    }
    this.syncDeep(next);
    this.syncShift();
    this.measureLabel();
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
    } else if (s.view.kind === 'manifest') {
      if (narrow) y = 0.34; else x = -0.27;
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
    document.title = 'An Archetypal Earth';
    if (!first) {
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
    const idx = subjectOccurrences(m, subject);
    const pal = this.subjectPal(subject);
    e.setPalette(pal, first ? 0.01 : 1.5);
    e.setEmphasis(this.emphasise(idx), pal.core);
    this.reveal.hide();
    e.markers.sel.hide();
    const sp = idx.length ? this.frameSet(idx, { duration: first ? 0.01 : undefined }) : null;
    if (first && sp) e.rig.flyTo(sp.lat, sp.lon, this.frameDistance(sp.radius * 1.18 + 0.07), { instant: true });
    this.floats.set(this.pickShowcase(subject, idx, sp ? { lat: sp.lat, lon: sp.lon } : null), isNarrow());
    this.timeControl.setSubject(idx, rgbToHex(pal.core));
    this.setLabelFor(subject);
    this.setBody(subject.type);
    document.title = `${subjectName(m, subject)} — An Archetypal Earth`;
  }

  private setLabelFor(subject: Subject) {
    const m = this.m;
    const content: LabelContent = { name: subjectName(m, subject), line: subjectLine(m, subject) || undefined, links: [] };
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
    e.setEmphasis(this.emphasise(ctxIdx, { selected: oi, relatedLevel: 1.15, extra: { idx: par, level: 1.6 } }), famPal.core);
    this.floats.clear();
    const dist = o.geoPrecision === 'culture' ? 3.0 : o.geoPrecision === 'region' ? 2.6 : 2.25;
    e.rig.flyTo(o.lat, o.lon, dist, { instant: first });
    if (m.located[oi]) e.markers.sel.show(m.dir[oi], famPal.core);
    else e.markers.sel.hide();
    this.reveal.show(oi);
    this.timeControl.setSubject(m.famOcc.get(o.familyId) ?? null, rgbToHex(famPal.core));
    this.label.set({ name: subjectName(m, context), back: () => this.stepBack() }, `m:${context.type}:${context.id}`);
    document.title = `${o.label} — An Archetypal Earth`;
  }

  // ── thread ────────────────────────────────────────────────────────────
  private enterThread(target: ThreadTarget, _from: View, first: boolean) {
    const m = this.m;
    const e = this.engine;
    const steps = planThread(m, target.type, target.id);
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
      links: [{ text: 'Reading', onClick: () => this.setDeep(true) }],
    }, `t:${target.type}:${target.id}`);
    document.title = `${name}, the thread — An Archetypal Earth`;

    this.tour = { steps, i: -1, playing: true, phase: 'intro', timer: first || e.reduced ? 0.4 : 3.1, tok: ++this.tokCounter, draw: first ? 1 : 0, head: 0, subject, target };
  }

  private endThread() {
    const e = this.engine;
    this.tour = null;
    this.tokCounter++;
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
  }

  private tourResume() {
    const t = this.tour;
    if (!t) return;
    t.playing = true;
    this.strip.setPlaying(true);
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
    this.engine.markers.head.hide();
    this.engine.arcs.uniforms.uTour.value = 0;
    if (this.timeSnap) this.time.restore(this.timeSnap);
    this.frameSet(t.steps.map((s) => s.occ), { min: 2.2, duration: 2.6 });
  }

  // ── per-frame ─────────────────────────────────────────────────────────
  private tick(dt: number) {
    this.floats.update(this.engine, dt);
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
      this.setCache = { key, set: new Set(subjectOccurrences(this.m, s)) };
    }
    return this.setCache.set.has(idx);
  }

  /** For tests/diagnostics. */
  describe() {
    return { state: this.state, exists: (s: Subject) => subjectExists(this.m, s) };
  }
}
