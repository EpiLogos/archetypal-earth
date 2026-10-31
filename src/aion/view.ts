import { scopeOf } from '../data/scope';
import type { Model } from '../data/model';
import { dirFromLatLon } from '../data/geo';
import { toRgbPalette } from '../data/palette';
import type { GlobeEngine } from '../globe/engine';
import type { TimeModel } from '../state/timeModel';
import type { AppState } from '../state/store';
import type { History, HistoryReading, AeonEvent, Epoch, Passage, BookChapter } from '../types/history';
import { clear, el, plate } from '../ui/dom';
import { paneStepper } from '../ui/pane';
import type { ContentsGroup } from '../ui/deep';
import type { Walk } from '../types/walks';
import { eraShort, passageCite } from '../ui/format';
import { quote } from '../ui/quote';
import type { PassageBridge } from '../ui/passage';
import { WalkStrip, type WalkItem } from '../ui/walk-strip';
import { epochAt, epochHeroImage, eventHeroImage, eventOccurrences } from './model';
import { WalkRunner, type WalkStep } from '../walk/runner';
import { chaptersWalk, findWalk, threadWalk, wholeReadingWalk } from './walk';
import { yearText } from './skyclock';
import { EquinoxRing, skyClockDisclosure } from './skyclock-view';
import type { LensChrome } from '../shell/lens';
import { providerLabels } from '../data/labels';

type Selection = NonNullable<NonNullable<AppState['history']>['selection']>;
const yearLabel = (year: number) => year < 0 ? `${Math.abs(Math.round(year)).toLocaleString()} BCE` : `${Math.round(year).toLocaleString()} CE`;

const NO_SNAPSHOT = { u: 0, focus: null, reading: null, centre: null, walk: null };

/**
 * One authored reading over the same Earth and the same live clock. What is read of it (an epoch, an event, a chapter of the
 * book) stands in the reading pane (H5), and the pane's Contents are the reading's threads, the book's chapters and its epochs.
 * A thread and the book are walked by the Walk runner (S9); the plate rail over the timeline shows the walk that is open.
 */
export class AionView {
  readonly root: HTMLElement;
  private epochs: HTMLElement;
  /** Shared next/prev rail over the timeline (same look as the Red Book's): the walk strip of the open walk. */
  private rail: HTMLElement;
  private strip: WalkStrip | null = null;
  private stripKind: 'chapter' | 'thread' | null = null;
  private markers: HTMLElement;
  /** the one runner: a thread or the book's chapters, wrapping past either end as the old index did */
  private runner: WalkRunner;
  private walkKind: 'chapter' | 'thread' | null = null;
  private reading: HistoryReading | null = null;
  private state: AppState['history'];
  private dots: { element: HTMLElement; event: AeonEvent; dir: ReturnType<typeof dirFromLatLon> }[] = [];
  private epochId = '';
  private currentEvent: AeonEvent | undefined;
  /** the standing chapter of the book, when the book is open */
  private chapter: BookChapter | undefined;
  private threadTimer = 0;
  /** the events of the open thread, in the walk's order (the rail's frames) */
  private threadEvents: AeonEvent[] = [];
  private ring: EquinoxRing;
  /** The field as the cursor has reached it: what has entered the world by now stands; what came later recedes. */
  private fieldRel: Float32Array | null = null;
  private revealYearKey = Number.NaN;
  private revealEventId = '';

  /**
   * `onRead`: the core reading of an occurrence, opened from this mode (a double-click on an event card). The
   * controller carries the mode state with it, so Escape returns here.
   */
  constructor(parent: HTMLElement, private model: Model, private engine: GlobeEngine, private time: TimeModel,
    readonly history: History, private navigate: (state: AppState) => void, private passages?: PassageBridge,
    private onRead: (occId: string) => void = () => {}, private chrome?: LensChrome) {
    this.epochs = el('nav', { class: 'aion-epochs', 'aria-label': 'Historical epochs' });
    this.rail = el('nav', { class: 'rb-rail', hidden: true, 'aria-label': 'Walk' });
    this.markers = el('div', { class: 'aion-markers' });
    this.root = el('section', { class: 'aion', hidden: true, 'aria-label': 'Archetypal history' }, [this.markers, this.epochs, this.rail]);
    parent.append(this.root);
    this.ring = new EquinoxRing(this.root);
    this.runner = new WalkRunner({ scale: model.scale, wrap: true });
  }

  private get pane() {
    return this.chrome?.pane;
  }

  /**
   * The Contents of the reading: its threads (the whole reading in order, then the curated ones), the book's chapters when it is
   * published, and the reading's epochs. The one that stands is marked. The events are not listed: each is a dot on the globe.
   */
  private contentsGroups(): ContentsGroup[] {
    const reading = this.reading;
    if (!reading) return [];
    const at = this.state?.selection;
    const here = (kind: string, id: string) => at?.kind === kind && at.id === id;
    const groups: ContentsGroup[] = [{
      title: 'Reading',
      lede: providerLabels().readingTagline,
      items: [...this.history.readings].sort((a, b) => a.from - b.from).map((r) => ({
        label: r.title, sub: `${yearLabel(r.from)} – ${yearLabel(r.to)}`, current: r.id === reading.id,
        onPick: () => this.navigate({ view: { kind: 'world' }, deep: false, history: { reading: r.id } }),
      })),
    }, {
      title: 'Threads',
      items: [wholeReadingWalk(reading), ...reading.threads].map((t) => ({ label: t.name, note: String(t.eventIds.length), current: here('thread', t.id), onPick: () => this.select({ kind: 'thread', id: t.id }) })),
    }];
    const book = this.history.book;
    if (book) {
      groups.push({
        title: book.title,
        items: book.chapters.map((c) => ({ label: c.title, ...(c.n !== c.title ? { note: c.n } : {}), current: here('chapter', c.id), onPick: () => this.select({ kind: 'chapter', id: c.id }) })),
      });
    }
    groups.push({
      title: 'Epochs',
      items: reading.epochs.filter((e) => !e.parentId).map((e) => ({ label: e.name, sub: `${yearLabel(e.from)} – ${yearLabel(e.to)}`, current: here('epoch', e.id), onPick: () => this.select({ kind: 'epoch', id: e.id }) })),
    });
    return groups;
  }

  /** A reading put in the pane: the plate (if any) and the text, framed by the pane; `foot` is the walk's stepper. */
  private read(key: string, eyebrow: string, hero: HTMLElement | null, text: HTMLElement, extra: { foot?: Node[]; onRead?(): void; engages?: { type: string; id: string } } = {}) {
    const body = el('div', { class: 'rv-body' }, hero ? [hero, text] : [text]);
    this.pane?.read({ key, eyebrow, nodes: [body], ...(extra.foot ? { foot: extra.foot } : {}), ...(extra.onRead ? { onRead: extra.onRead } : {}), ...(extra.engages ? { engages: extra.engages } : {}) });
  }

  /** The walk's stepper under a reading: the neighbours, and where in the walk the visitor stands. */
  private stepper(kind: 'chapter' | 'thread', step: WalkStep): Node[] {
    const label = kind === 'chapter' ? { prev: 'Previous chapter', next: 'Next chapter' } : { prev: 'Previous historical event', next: 'Next historical event' };
    const n = step.count;
    const name = (k: number) => (kind === 'chapter' ? this.history.book?.chapters[(k + n) % n]?.title : this.threadEvents[(k + n) % n]?.name) ?? null;
    return paneStepper(label, `${step.i + 1} / ${n}`, () => this.walkStep(kind, -1), () => this.walkStep(kind, 1), {}, { prev: name(step.i - 1), next: name(step.i + 1) });
  }

  /** The walk begins (or carries on, when the runner already stands in it) at stop `at`. */
  private walking(kind: 'chapter' | 'thread', walk: Walk, at: number): WalkStep | null {
    this.walkKind = kind;
    return this.runner.active && this.runner.position?.walkId === walk.id ? this.runner.goto(at) : this.runner.start(walk, NO_SNAPSHOT, at);
  }

  private endWalk() {
    this.runner.interrupt();
    this.walkKind = null;
    this.threadEvents = [];
  }

  /** The event's first occurrence that exists in the field, opened as its core reading. Nothing when it has none. */
  private readEvent() {
    const event = this.currentEvent;
    if (!this.reading || !event || this.state?.selection?.kind === 'epoch') return;
    const occId = event.occurrenceIds.find((id) => this.model.occIndex.has(id));
    if (occId !== undefined) this.onRead(occId);
  }

  show(state: NonNullable<AppState['history']>) {
    const reading = this.history.readings.find(r => r.id === state.reading);
    if (!reading) return;
    const changed = this.reading?.id !== reading.id;
    const previous = this.state?.selection;
    this.state = state;
    this.root.hidden = false;
    document.body.classList.add('aion-mode');
    if (changed) {
      this.reading = reading;
      this.epochId = '';
      this.buildMarkers(reading);
      clear(this.epochs);
      for (const epoch of reading.epochs.filter(e => !e.parentId)) {
        this.epochs.append(el('button', { type: 'button', text: epoch.name.split(' · ')[0], 'aria-label': epoch.name, title: `${epoch.name} · ${yearLabel(epoch.from)} – ${yearLabel(epoch.to)}`, 'data-epoch': epoch.id,
          onclick: () => this.select({ kind: 'epoch', id: epoch.id }) }));
      }
    }
    this.threadEvents = [];
    this.currentEvent = undefined;
    this.chapter = undefined;
    this.engine.arcs.clear();
    this.engine.markers.sel.hide();
    const selection = state.selection;
    // the reading's Contents stand in the pane whatever is read; a pick is a request to read
    this.pane?.contents('Aion', () => this.contentsGroups());
    if (selection?.kind === 'epoch') {
      this.endWalk();
      const epoch = reading.epochs.find(e => e.id === selection.id);
      if (epoch) {
        if (changed || previous?.id !== epoch.id || previous.kind !== 'epoch') this.time.scrub(this.model.scale.toU((epoch.from + epoch.to) / 2));
        this.showEpoch(epoch);
      }
    } else if (selection?.kind === 'event') {
      this.endWalk();
      const event = reading.events.find(e => e.id === selection.id);
      if (event) this.showEvent(event, true);
    } else if (selection?.kind === 'thread') {
      // a walk: the derived whole-reading walk, or a curated thread; the runner begins it at its first event
      const thread = findWalk(reading, selection.id);
      if (thread) {
        const walk = threadWalk(this.model.walkById, reading, thread);
        this.threadEvents = walk.stops.map(s => reading.events.find(e => e.id === s.subject?.id)).filter((e): e is AeonEvent => !!e);
        const located = this.threadEvents.filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon));
        this.engine.arcs.build(located.map(e => dirFromLatLon(e.lat!, e.lon!)), located.map((_, i) => i > 0));
        this.engine.arcs.uniforms.uDraw.value = located.length + 1;
        this.engine.arcs.uniforms.uTour.value = 0;
        this.runner.interrupt();
        const step = this.walking('thread', walk, 0);
        if (step) this.showThreadStop(step);
      }
    } else if (selection?.kind === 'chapter') {
      const book = this.history.book;
      const chapter = book?.chapters.find((c) => c.id === selection.id);
      if (book && chapter) {
        const step = this.walking('chapter', chaptersWalk(this.model.walkById, book), book.chapters.indexOf(chapter));
        if (step) this.showChapter(chapter, step);
      }
    } else {
      // landing: nothing read, the Contents waiting
      this.endWalk();
      this.pane?.hide();
      this.engine.setEmphasis(null, null);
    }
    this.update(0);
    const walking = this.walkKind !== null;
    this.epochs.hidden = walking;
    this.rail.hidden = !walking;
    // the strip was built while the rail was hidden: centre it now that it shows
    this.strip?.recenter();
    // the title and the reading's own controls stay at the left: the reading stands in the pane, on the right
    this.chrome?.setContext(`${reading.title} · ${reading.author}`);
  }

  hide() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('aion-mode');
    this.pane?.release();
    this.endWalk();
    this.engine.arcs.clear();
    this.reading = null;
    this.state = undefined;
    // the field reveal recomputes from scratch on the next entry
    this.fieldRel = null;
    this.revealYearKey = Number.NaN;
    this.revealEventId = '';
  }

  private select(selection?: Selection) {
    if (!this.reading) return;
    this.navigate({ view: { kind: 'world' }, deep: false, history: { reading: this.reading.id, ...(selection ? { selection } : {}) } });
  }

  private buildMarkers(reading: HistoryReading) {
    clear(this.markers);
    this.dots = [];
    for (const event of reading.events) {
      if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) continue;
      const dot = el('button', { type: 'button', class: 'aion-dot', 'aria-label': `${event.name}, ${event.yearDisplay}`, title: `${event.name} · ${event.yearDisplay}`,
        onclick: () => this.select({ kind: 'event', id: event.id }) }, [el('span', { text: event.name })]);
      this.markers.append(dot);
      this.dots.push({ element: dot, event, dir: dirFromLatLon(event.lat!, event.lon!) });
    }
  }

  /** The passage a card leads with: the first Jung's own text grounds (basis J, the default), else the first. */
  private keyPassage(passages: Passage[]): Passage | undefined {
    return passages.find(p => (p.basis ?? 'J') === 'J') ?? passages[0];
  }

  /** Displayed prose: the scan's glued footnote digits and paragraph marks are not part of the sentence. */
  private shown(text: string): string {
    return text
      .replace(/\s*¶\s*\d+[a-z]?(?:\s*,?\s*n\.\s*\d+)?/g, '')
      .replace(/([.!?])\d{1,3}(?!\d)/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  /** One passage as an open quotation: the one Quote component, the cite by the registry's work and its title. */
  private quote(p: Passage, lead = false): HTMLElement {
    const m = this.model;
    const work = m.workKey.get(p.work) ?? p.work;
    const workTitle = m.workById.get(work)?.title ?? passageCite(m, p.work, p.locator).workTitle;
    return quote({ text: this.shown(p.text), cite: { work, workTitle, locator: p.locator }, ...(lead ? { emphasis: 'lead' as const } : {}) }, { passages: this.passages });
  }

  /** The key passage, open, before the body. */
  private keyQuote(passages: Passage[]): HTMLElement[] {
    const key = this.keyPassage(passages);
    return key ? [this.quote(key, true)] : [];
  }

  /** Every other passage, quietly, after the links. */
  private moreSources(passages: Passage[]): HTMLElement[] {
    const key = this.keyPassage(passages);
    const rest = passages.filter(p => p !== key);
    return rest.length ? [el('details', { class: 'aion-sources' }, [el('summary', { text: 'More from the text' }), ...rest.map(p => this.quote(p))])] : [];
  }

  private showEpoch(epoch: Epoch) {
    const text = el('div', { class: 'rv-text' });
    const children = this.reading!.epochs.filter(e => e.parentId === epoch.id);
    const links = el('div', { class: 'aion-links' });
    for (const id of epoch.archetypeIds ?? []) {
      const archetype = this.model.archById.get(id);
      if (archetype) links.append(el('button', { type: 'button', class: 'link-quiet', text: archetype.name, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'archetype', id } }, deep: false }) }));
    }
    for (const e of children) links.append(el('button', { type: 'button', class: 'link-quiet', text: e.name, onclick: () => this.select({ kind: 'epoch', id: e.id }) }));
    const hero = plate(epochHeroImage(this.model, this.reading!, epoch), { className: 'rv-hero dp-figure', credit: true, palette: epoch.palette, alt: epoch.name, eager: true });
    text.append(el('p', { class: 'dp-by aion-date rv-line', text: `${yearText(epoch.from, true)} – ${yearText(epoch.to, true)}` }),
      el('h2', { class: 'dp-title rv-name', text: epoch.name }), el('p', { class: 'dp-lede rv-para aion-lede', text: this.shown(epoch.oneLine) }),
      ...this.keyQuote(epoch.passages), ...epoch.body.map(para => el('p', { class: 'dp-para rv-para', text: this.shown(para) })),
      links, ...this.moreSources(epoch.passages), skyClockDisclosure(this.reading!, epoch));
    this.read(`epoch:${epoch.id}`, 'Epoch', hero, text);
  }

  /**
   * An event read in the pane. A walk's step carries the effects the runner planned for it (the clock to the event's year, the
   * globe to its place); an event opened by itself, from its dot, plans the same two from the event.
   */
  private showEvent(event: AeonEvent, move: boolean, step?: WalkStep) {
    this.currentEvent = event;
    if (move) {
      this.time.pause();
      const fx = step?.effects;
      this.time.scrub(fx?.setClock ?? this.model.scale.toU(event.year));
      const at = fx ? fx.flyTo : Number.isFinite(event.lat) && Number.isFinite(event.lon) ? { lat: event.lat!, lon: event.lon! } : null;
      if (at) this.engine.rig.flyTo(at.lat, at.lon, 2.8, { duration: 1.8 });
    }
    const text = el('div', { class: 'rv-text' });
    const epoch = this.reading!.epochs.find(e => e.id === event.epochId);
    const hero = plate(eventHeroImage(this.model, event), { className: 'rv-hero dp-figure', credit: true, palette: epoch?.palette, alt: event.name, eager: true });
    const links = el('div', { class: 'aion-links' });
    for (const id of event.archetypeIds ?? []) {
      const archetype = this.model.archById.get(id);
      if (archetype) links.append(el('button', { type: 'button', class: 'link-quiet', text: archetype.name, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'archetype', id } }, deep: false }) }));
    }
    for (const id of event.familyIds) {
      const family = this.model.famById.get(id);
      if (family) links.append(el('button', { type: 'button', class: 'link-quiet', text: family.name, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'family', id } }, deep: false }) }));
    }
    for (const id of event.occurrenceIds) {
      const i = this.model.occIndex.get(id);
      if (i !== undefined) links.append(el('button', { type: 'button', class: 'link-quiet', text: this.model.occ[i].label, onclick: () => this.navigate({ view: { kind: 'manifest', occId: id, context: { type: 'family', id: this.model.occ[i].familyId } }, deep: false }) }));
    }
    text.append(el('p', { class: 'dp-by aion-date rv-line', text: [event.yearDisplay, event.place].filter(Boolean).join(' · ') }), el('h2', { class: 'dp-title rv-name', text: event.name }),
      el('p', { class: 'dp-lede rv-para aion-lede', text: this.shown(event.oneLine) }), ...this.keyQuote(event.passages), ...event.body.map(para => el('p', { class: 'dp-para rv-para', text: this.shown(para) })),
      links, ...this.moreSources(event.passages), skyClockDisclosure(this.reading!, event));
    // opening an event is noted for the visitor's node as the occurrence it stands on, where the field holds one
    const occId = event.occurrenceIds.find((id) => this.model.occIndex.has(id));
    this.read(`event:${event.id}`, 'Event', hero, text, {
      ...(step && this.walkKind === 'thread' ? { foot: this.stepper('thread', step) } : {}),
      onRead: () => this.readEvent(),
      ...(occId ? { engages: { type: 'occurrence', id: occId } } : {}),
    });
  }

  /** A chapter takes the same plate as every other card: a family it names, else an event it grounds. */
  private chapterImage(chapter: BookChapter) {
    for (const s of chapter.subjects) {
      if (s.type !== 'family') continue;
      const image = this.model.famById.get(s.id)?.image;
      if (image) return image;
    }
    for (const e of chapter.events) {
      const event = this.history.readings.find((r) => r.id === e.reading)?.events.find((x) => x.id === e.id);
      if (event) { const image = eventHeroImage(this.model, event); if (image) return image; }
    }
    return undefined;
  }

  /**
   * One chapter of the book: Jung's own words from inside it; the field it speaks of, tuned on the globe; and the
   * events of the readings whose passages stand in its pages. The walk is stepped from the pane's stepper and the timeline rail.
   */
  private showChapter(chapter: BookChapter, step: WalkStep) {
    const book = this.history.book!;
    this.chapter = chapter;
    const all = book.chapters;
    this.walkStrip('chapter').update(all.map((c) => ({ id: c.id, image: this.chapterImage(c), label: c.title })), step.i);
    const text = el('div', { class: 'rv-text' });
    const image = this.chapterImage(chapter);
    const hero = image ? plate(image, { className: 'rv-hero dp-figure', credit: true, alt: chapter.title, eager: true }) : null;
    text.append(
      el('h2', { class: 'dp-title rv-name', text: chapter.title }),
      el('p', { class: 'dp-lede rv-para aion-lede', text: this.shown(chapter.line) }),
      ...chapter.quotes.map((q) => this.quote({ text: q.text, work: q.cite.work, locator: q.cite.locator })),
    );
    const links = el('div', { class: 'aion-links' });
    for (const s of chapter.subjects) {
      const name = s.type === 'archetype' ? this.model.archById.get(s.id)?.name : this.model.famById.get(s.id)?.name;
      if (name) links.append(el('button', { type: 'button', class: 'link-quiet', text: name, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: s.type, id: s.id } }, deep: false }) }));
    }
    text.append(links);
    if (chapter.events.length) {
      const list = el('ul', { class: 'aion-book-events' });
      for (const e of chapter.events) list.append(el('li', {}, [el('button', { type: 'button', class: 'link-quiet', text: `${e.yearDisplay} · ${e.name}`,
        title: e.readingTitle, onclick: () => this.navigate({ view: { kind: 'world' }, deep: false, history: { reading: e.reading, selection: { kind: 'event', id: e.id } } }) })]));
      text.append(el('details', { class: 'aion-sources', open: chapter.events.length <= 4 }, [el('summary', { text: `In the readings · ${chapter.events.length} ${chapter.events.length === 1 ? 'event' : 'events'} cite this chapter` }), list]));
    }
    if (this.passages?.known(book.work)) text.append(el('p', { class: 'aion-book-deep' }, [el('button', { type: 'button', class: 'link-quiet', text: 'Read in the corpus',
      onclick: () => this.passages!.open(book.work, `pdf p${chapter.pages[0]}`) })]));
    const located = chapter.events.map((e) => this.history.readings.find((r) => r.id === e.reading)?.events.find((x) => x.id === e.id))
      .find((e) => e && Number.isFinite(e.lat) && Number.isFinite(e.lon));
    if (located) this.engine.rig.flyTo(located.lat!, located.lon!, 2.8, { duration: 1.8 });
    this.read(`chapter:${chapter.id}`, 'Chapter', hero, text, { foot: this.stepper('chapter', step), engages: { type: 'work', id: this.model.workKey.get(book.work) ?? book.work } });
  }

  /** Arrow-key walking through the book's chapters (wired by the controller), the rail's steps and the pane's stepper: the runner names the neighbour. */
  walkBook(delta: number): boolean {
    if (!this.history.book || this.walkKind !== 'chapter') return false;
    const step = delta > 0 ? this.runner.next() : this.runner.prev();
    const id = step?.stop.subject?.id;
    if (!id) return false;
    this.select({ kind: 'chapter', id });
    return true;
  }

  /** The thread's step the runner stands on, read in the pane with the rail's frames set to it. */
  private showThreadStop(step: WalkStep) {
    const event = this.threadEvents.find((e) => e.id === step.stop.subject?.id);
    if (!event) return;
    this.showEvent(event, true, step);
    const items: WalkItem[] = this.threadEvents.map((e) => ({
      id: e.id,
      image: eventHeroImage(this.model, e),
      label: e.name,
      sub: eraShort(e.yearDisplay, 13),
      palette: this.reading?.epochs.find((x) => x.id === e.epochId)?.palette,
    }));
    this.walkStrip('thread').update(items, step.i);
  }

  /** The walk strip on the rail: one per walk kind, with that walk's labels; its frames rebuild when the walk changes. */
  private walkStrip(kind: 'chapter' | 'thread'): WalkStrip {
    if (!this.strip || this.stripKind !== kind) {
      clear(this.rail);
      this.stripKind = kind;
      const labels = kind === 'chapter'
        ? { prev: 'Previous chapter', next: 'Next chapter', list: 'Chapter walk' }
        : { prev: 'Previous historical event', next: 'Next historical event', list: 'Thread walk' };
      this.strip = new WalkStrip(this.rail, labels, (i) => this.walkTo(kind, i), (delta) => this.walkStep(kind, delta));
    }
    return this.strip;
  }

  /** Jump the open walk to step `i` (a chapter's or an event's index). */
  private walkTo(kind: 'chapter' | 'thread', i: number) {
    if (kind === 'chapter') {
      const all = this.history.book?.chapters ?? [];
      if (i >= 0 && i < all.length) this.select({ kind: 'chapter', id: all[i].id });
      return;
    }
    const n = this.threadEvents.length;
    if (!n) return;
    this.threadTimer = 0;
    const step = this.runner.goto((i + n) % n);
    if (step) this.showThreadStop(step);
  }

  /** One step along the open walk, wrapping at either end. */
  private walkStep(kind: 'chapter' | 'thread', delta: number) {
    if (kind === 'chapter') { this.walkBook(delta); return; }
    this.threadTimer = 0;
    const step = delta > 0 ? this.runner.next() : this.runner.prev();
    if (step) this.showThreadStop(step);
  }

  /** The timeline's Play walks the thread; there is no second Play on the rail. */
  pauseThread() {
    this.time.pause();
  }

  /**
   * The field as of the cursor's year: what has entered the world stands (the standing epoch brightest, earlier
   * epochs receded), what came later recedes to a presence — never invisible, never unclickable. The standing
   * event's own occurrences stay brightest of all.
   */
  private updateFieldReveal(year: number, epoch: ReturnType<typeof epochAt>) {
    const m = this.model;
    if (this.chapter) {
      // a chapter's own set: the archetypes and families it names and the occurrences of the events it grounds; a
      // chapter is not a moment, so the clock does not recede it
      if (this.scopeFor !== this.chapter) {
        this.scopeFor = this.chapter;
        const own: number[] = [];
        for (const s of this.chapter.subjects) own.push(...((s.type === 'archetype' ? m.archOcc.get(s.id) : m.famOcc.get(s.id)) ?? []));
        for (const e of this.chapter.events) {
          const ev = this.history.readings.find((r) => r.id === e.reading)?.events.find((x) => x.id === e.id);
          if (ev) own.push(...eventOccurrences(m, ev));
        }
        this.readingScope = scopeOf(m, own, `Aion ${this.chapter.n === 'Foreword' ? 'Foreword' : this.chapter.n}`);
      }
      this.engine.setEmphasis(this.readingScope!.rel, null, this.readingScope!.info);
      return;
    }
    // the reading's own set: every event's occurrences (its nearby presences dim; the rest of the field is set aside)
    if (this.scopeFor !== this.reading) {
      this.scopeFor = this.reading;
      const own: number[] = [];
      for (const ev of this.reading?.events ?? []) own.push(...eventOccurrences(m, ev));
      this.readingScope = scopeOf(m, own, `“${this.reading?.title ?? 'this reading'}”`, { level: 1 });
    }
    const sc = this.readingScope!;
    const rel = (this.fieldRel ??= new Float32Array(m.occ.length));
    for (let i = 0; i < m.occ.length; i++) {
      if (!m.located[i]) { rel[i] = 1; continue; }
      const base = sc.rel[i];
      if (base <= 0) { rel[i] = 0; continue; }
      // within the set, the field as of the cursor's year: what has entered stands, what came later recedes
      const y = m.occ[i].year;
      const t = y > year ? 0.18 : y >= (epoch?.from ?? y) ? 1 : 0.45;
      rel[i] = base >= 1 ? t : Math.min(base, t);
    }
    if (this.currentEvent) for (const i of eventOccurrences(m, this.currentEvent)) if (m.located[i]) rel[i] = 1.6;
    this.engine.setEmphasis(rel, null, sc.info);
  }

  private scopeFor: unknown = undefined;
  private readingScope: ReturnType<typeof scopeOf> | null = null;

  update(dt: number) {
    if (this.root.hidden || !this.reading) return;
    const year = this.model.scale.fromU(this.time.cursorU);
    const epoch = epochAt(this.reading, year);
    if (epoch && epoch.id !== this.epochId) {
      this.epochId = epoch.id;
      const palette = toRgbPalette(epoch.palette, epoch.spectrum);
      this.engine.setPalette(palette, 1.8);
      this.engine.arcs.uniforms.uColor.value.set(...palette.core);
      for (const button of this.epochs.querySelectorAll('button')) {
        const id = button.dataset.epoch;
        const parent = this.reading.epochs.find(e => e.id === epoch.parentId);
        button.setAttribute('aria-pressed', String(id === epoch.id || id === epoch.parentId || id === parent?.parentId));
      }
    }
    this.ring.update(year);
    // the field follows the cursor: recomputed only when the year or the standing event changes
    const yearKey = Math.floor(year);
    const eventId = this.currentEvent?.id ?? this.chapter?.id ?? '';
    if (yearKey !== this.revealYearKey || eventId !== this.revealEventId) {
      this.revealYearKey = yearKey;
      this.revealEventId = eventId;
      this.updateFieldReveal(year, epoch);
    }
    const projected = { x: 0, y: 0, facing: 0 };
    for (const dot of this.dots) {
      this.engine.project(dot.dir, projected, 1.008);
      const distance = Math.abs(this.model.scale.toU(dot.event.year) - this.time.cursorU);
      const selected = dot.event.id === this.currentEvent?.id;
      const alpha = selected || this.time.mode === 'all' ? 1 : Math.max(0.08, 1 - distance / 0.065);
      dot.element.hidden = projected.facing <= 0;
      dot.element.style.transform = `translate(${projected.x}px,${projected.y}px)`;
      dot.element.style.opacity = String(alpha);
      dot.element.classList.toggle('selected', selected);
      dot.element.style.pointerEvents = alpha > 0.2 ? 'auto' : 'none';
      dot.element.tabIndex = alpha > 0.2 && projected.facing > 0 ? 0 : -1;
    }
    // the clock's Play advances the thread; Pause on the clock stops it
    if (this.walkKind === 'thread' && this.time.playing) {
      this.threadTimer += dt;
      if (this.threadTimer > 5) {
        this.threadTimer = 0;
        const at = this.runner.current();
        const step = at && !at.last ? this.runner.next() : null;
        if (step) this.showThreadStop(step);
        else this.time.pause();
      }
    } else this.threadTimer = 0;
  }
}
