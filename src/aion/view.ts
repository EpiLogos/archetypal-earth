import { scopeOf } from '../data/scope';
import type { Model } from '../data/model';
import { dirFromLatLon } from '../data/geo';
import { toRgbPalette } from '../data/palette';
import type { GlobeEngine } from '../globe/engine';
import type { TimeModel } from '../state/timeModel';
import type { AppState } from '../state/store';
import type { History, HistoryReading, AeonEvent, Epoch, Passage, BookChapter } from '../types/history';
import { clear, el, onReadGesture, plate } from '../ui/dom';
import { modeOptions, optionAction, optionGroup } from '../ui/mode-options';
import { closeGlyph } from '../ui/reveal';
import { passageLine } from '../ui/format';
import type { PassageBridge } from '../ui/passage';
import { epochAt, epochHeroImage, eventHeroImage, eventOccurrences } from './model';
import { findWalk, wholeReadingWalk } from './walk';
import { yearText } from './skyclock';
import { EquinoxRing, skyClockDisclosure } from './skyclock-view';
import type { LensChrome } from '../shell/lens';

type Selection = NonNullable<NonNullable<AppState['history']>['selection']>;
const yearLabel = (year: number) => year < 0 ? `${Math.abs(Math.round(year)).toLocaleString()} BCE` : `${Math.round(year).toLocaleString()} CE`;

/** One authored reading over the same Earth and the same live clock. */
export class AionView {
  readonly root: HTMLElement;
  private heading: HTMLElement;
  private epochs: HTMLElement;
  /** Shared next/prev rail over the timeline (same look as the Red Book's). */
  private rail: HTMLElement;
  private card: HTMLElement;
  private markers: HTMLElement;
  private reading: HistoryReading | null = null;
  private state: AppState['history'];
  private dots: { element: HTMLElement; event: AeonEvent; dir: ReturnType<typeof dirFromLatLon> }[] = [];
  private epochId = '';
  private currentEvent: AeonEvent | undefined;
  /** the standing chapter of the book, when the book is open */
  private chapter: BookChapter | undefined;
  private bookToggle: HTMLButtonElement | null = null;
  private threadIndex = 0;
  private threadTimer = 0;
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
    // the lens's own controls: the shell places them under its title (MODES-RFC §2); this view draws no heading
    this.heading = el('div', { class: 'aion-controls' });
    this.epochs = el('nav', { class: 'aion-epochs', 'aria-label': 'Historical epochs' });
    this.rail = el('nav', { class: 'rb-rail', hidden: true, 'aria-label': 'Walk' });
    this.card = el('aside', { class: 'aion-card reveal on', 'aria-label': 'Aion reading' });
    this.markers = el('div', { class: 'aion-markers' });
    this.root = el('section', { class: 'aion', hidden: true, 'aria-label': 'Archetypal history' }, [this.markers, this.epochs, this.rail, this.card]);
    parent.append(this.root);
    this.ring = new EquinoxRing(this.root);
    // a double-click on an event card opens the reading of its first resolvable occurrence; an epoch's card has none
    onReadGesture(this.card, () => this.readEvent());
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
    this.bookToggle?.setAttribute('aria-pressed', String(state.selection?.kind === 'chapter'));
    this.engine.arcs.clear();
    this.engine.markers.sel.hide();
    const selection = state.selection;
    if (selection?.kind === 'epoch') {
      const epoch = reading.epochs.find(e => e.id === selection.id);
      if (epoch) {
        if (changed || previous?.id !== epoch.id || previous.kind !== 'epoch') this.time.scrub(this.model.scale.toU((epoch.from + epoch.to) / 2));
        this.showEpoch(epoch);
      }
    } else if (selection?.kind === 'event') {
      const event = reading.events.find(e => e.id === selection.id);
      if (event) this.showEvent(event, true);
    } else if (selection?.kind === 'thread') {
      // a walk: the derived whole-reading walk, or a curated thread (the walks Options offers)
      const thread = findWalk(reading, selection.id);
      if (thread) {
        this.threadEvents = thread.eventIds.map(id => reading.events.find(e => e.id === id)).filter((e): e is AeonEvent => !!e);
        this.threadIndex = 0;
        const located = this.threadEvents.filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon));
        this.engine.arcs.build(located.map(e => dirFromLatLon(e.lat!, e.lon!)), located.map((_, i) => i > 0));
        this.engine.arcs.uniforms.uDraw.value = located.length + 1;
        this.engine.arcs.uniforms.uTour.value = 0;
        this.showThreadEvent();
      }
    } else if (selection?.kind === 'chapter') {
      const chapter = this.history.book?.chapters.find((c) => c.id === selection.id);
      if (chapter) this.showChapter(chapter);
    } else {
      this.card.hidden = true;
      this.engine.setEmphasis(null, null);
    }
    this.update(0);
    const walking = selection?.kind === 'chapter' || selection?.kind === 'thread';
    this.epochs.hidden = walking;
    this.rail.hidden = !walking;
    document.body.classList.toggle('aion-card-open', !!selection);
    // a card owns the left: no title, no reading tabs under the close
    this.chrome?.setContext(selection ? '' : `${reading.title} · ${reading.author}`);
    if (selection) this.chrome?.setControls(null);
    else {
      this.buildHeading(reading);
      this.chrome?.setControls([this.heading]);
    }
  }

  hide() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('aion-mode', 'aion-card-open');
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

  private buildHeading(reading: HistoryReading) {
    clear(this.heading);
    const book = this.history.book;
    const sel = this.state?.selection;
    this.bookToggle = book ? optionAction('Read the book', () => this.select(sel?.kind === 'chapter' ? undefined : { kind: 'chapter', id: book.chapters[0].id }),
      { pressed: sel?.kind === 'chapter', description: `${book.title}, chapter by chapter` }) : null;
    const readings = [...this.history.readings].sort((a, b) => a.from - b.from).map((r) =>
      optionAction(r.title, () => this.navigate({ view: { kind: 'world' }, deep: false, history: { reading: r.id } }), { pressed: r.id === reading.id }));
    // the walks: the whole reading in time order (derived), the curated threads, then the book's chapter walk when it is published
    const whole = wholeReadingWalk(reading);
    const walks = [
      optionAction(whole.name, () => this.select({ kind: 'thread', id: whole.id }), {
        pressed: sel?.kind === 'thread' && sel.id === whole.id, description: `${whole.eventIds.length} events, earliest to latest`,
      }),
      ...reading.threads.map((thread) => optionAction(thread.name, () => this.select({ kind: 'thread', id: thread.id }), {
        pressed: sel?.kind === 'thread' && sel.id === thread.id, description: thread.oneLine,
      })),
      this.bookToggle,
    ];
    // the events are not listed: each one is a dot on the globe, and the walks above carry them in order
    this.heading.append(modeOptions([
      el('p', { class: 'mode-opt-blurb', text: 'Jung’s history of the aeons — the precession of the equinoxes through Pisces into Aquarius, read on the Earth.' }),
      optionGroup('Reading', readings),
      optionGroup('Walk', walks),
    ]));
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

  /** One passage as an open quotation, its cite in the same voice as every other cite in the field. */
  private quote(p: Passage): HTMLElement {
    const line = passageLine(this.model, p.work, p.locator);
    const cite = this.passages?.known(p.work)
      ? el('button', { class: 'link-quiet', type: 'button', text: line, title: 'Open the passage in the corpus', onclick: () => this.passages!.open(p.work, p.locator) })
      : line;
    const mark = p.basis === 'S'
      ? el('span', { class: 'aion-basis', title: 'Standard scholarship, quoted for orientation', text: 'S' })
      : el('span', { class: 'aion-basis', title: 'Asserted in Jung\u2019s own text', text: 'J' });
    return el('blockquote', { class: 'dp-def' }, [el('p', { text: this.shown(p.text) }), el('footer', {}, [cite, ' ', mark])]);
  }

  /** The key passage, open, before the body. */
  private keyQuote(passages: Passage[]): HTMLElement[] {
    const key = this.keyPassage(passages);
    return key ? [this.quote(key)] : [];
  }

  /** Every other passage, quietly, after the links. */
  private moreSources(passages: Passage[]): HTMLElement[] {
    const key = this.keyPassage(passages);
    const rest = passages.filter(p => p !== key);
    return rest.length ? [el('details', { class: 'aion-sources' }, [el('summary', { text: 'More from the text' }), ...rest.map(p => this.quote(p))])] : [];
  }

  private closeButton() {
    return el('button', { type: 'button', class: 'rv-close', 'aria-label': 'Close history detail', onclick: () => this.select() }, [closeGlyph()]);
  }

  private openCard() {
    clear(this.card);
    this.card.hidden = false;
    const body = el('div', { class: 'rv-body' });
    const text = el('div', { class: 'rv-text' });
    body.append(text);
    this.card.append(this.closeButton(), body);
    return text;
  }

  private showEpoch(epoch: Epoch) {
    const text = this.openCard();
    const children = this.reading!.epochs.filter(e => e.parentId === epoch.id);
    const links = el('div', { class: 'aion-links' });
    for (const id of epoch.archetypeIds ?? []) {
      const archetype = this.model.archById.get(id);
      if (archetype) links.append(el('button', { type: 'button', class: 'link-quiet', text: archetype.name, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'archetype', id } }, deep: false }) }));
    }
    for (const e of children) links.append(el('button', { type: 'button', class: 'link-quiet', text: e.name, onclick: () => this.select({ kind: 'epoch', id: e.id }) }));
    text.before(plate(epochHeroImage(this.model, this.reading!, epoch), { className: 'rv-hero', credit: true, palette: epoch.palette, alt: epoch.name }));
    text.append(el('p', { class: 'aion-date rv-line', text: `${yearText(epoch.from, true)} – ${yearText(epoch.to, true)}` }),
      el('h2', { class: 'rv-name', text: epoch.name }), el('p', { class: 'rv-para aion-lede', text: this.shown(epoch.oneLine) }),
      ...this.keyQuote(epoch.passages), ...epoch.body.map(para => el('p', { class: 'rv-para', text: this.shown(para) })),
      links, ...this.moreSources(epoch.passages), skyClockDisclosure(this.reading!, epoch));
  }

  private showEvent(event: AeonEvent, move: boolean) {
    this.currentEvent = event;
    if (move) {
      this.time.pause();
      this.time.scrub(this.model.scale.toU(event.year));
      if (Number.isFinite(event.lat) && Number.isFinite(event.lon)) this.engine.rig.flyTo(event.lat!, event.lon!, 2.8, { duration: 1.8 });
    }
    const text = this.openCard();
    const epoch = this.reading!.epochs.find(e => e.id === event.epochId);
    text.before(plate(eventHeroImage(this.model, event), { className: 'rv-hero', credit: true, palette: epoch?.palette, alt: event.name }));
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
    text.append(el('p', { class: 'aion-date rv-line', text: [event.yearDisplay, event.place].filter(Boolean).join(' · ') }), el('h2', { class: 'rv-name', text: event.name }),
      el('p', { class: 'rv-para aion-lede', text: this.shown(event.oneLine) }), ...this.keyQuote(event.passages), ...event.body.map(para => el('p', { class: 'rv-para', text: this.shown(para) })),
      links, ...this.moreSources(event.passages), skyClockDisclosure(this.reading!, event));
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
   * events of the readings whose passages stand in its pages. Walk controls sit on the timeline rail, not in the card.
   */
  private showChapter(chapter: BookChapter) {
    const book = this.history.book!;
    this.chapter = chapter;
    const all = book.chapters;
    const i = all.indexOf(chapter);
    const step = (delta: number) => this.select({ kind: 'chapter', id: all[(i + delta + all.length) % all.length].id });
    clear(this.rail);
    this.rail.append(
      el('button', { type: 'button', text: '←', 'aria-label': 'Previous chapter', onclick: () => step(-1) }),
      el('span', { class: 'rb-progress', text: `${i + 1} / ${all.length}` }),
      el('button', { type: 'button', text: '→', 'aria-label': 'Next chapter', onclick: () => step(1) }),
    );
    const text = this.openCard();
    const image = this.chapterImage(chapter);
    if (image) text.before(plate(image, { className: 'rv-hero', credit: true, alt: chapter.title }));
    text.append(
      el('h2', { class: 'rv-name', text: chapter.title }),
      el('p', { class: 'rv-para aion-lede', text: this.shown(chapter.line) }),
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
  }

  /** Arrow-key walking through the book's chapters; wired by the controller. */
  walkBook(delta: number): boolean {
    const book = this.history.book;
    if (!book || !this.chapter) return false;
    const i = book.chapters.indexOf(this.chapter);
    this.select({ kind: 'chapter', id: book.chapters[(i + delta + book.chapters.length) % book.chapters.length].id });
    return true;
  }

  private showThreadEvent() {
    const event = this.threadEvents[this.threadIndex];
    if (!event) return;
    this.showEvent(event, true);
    const step = (delta: number) => { this.threadIndex = (this.threadIndex + delta + this.threadEvents.length) % this.threadEvents.length; this.threadTimer = 0; this.showThreadEvent(); };
    clear(this.rail);
    this.rail.append(
      el('button', { type: 'button', text: '←', 'aria-label': 'Previous historical event', onclick: () => step(-1) }),
      el('span', { class: 'rb-progress', text: `${this.threadIndex + 1} / ${this.threadEvents.length}` }),
      el('button', { type: 'button', text: '→', 'aria-label': 'Next historical event', onclick: () => step(1) }),
    );
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
    if (this.threadEvents.length && this.time.playing) {
      this.threadTimer += dt;
      if (this.threadTimer > 5) {
        this.threadTimer = 0;
        if (this.threadIndex + 1 < this.threadEvents.length) { this.threadIndex++; this.showThreadEvent(); }
        else this.time.pause();
      }
    } else this.threadTimer = 0;
  }
}
