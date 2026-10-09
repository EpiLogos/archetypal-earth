import type { Model } from '../data/model';
import { dirFromLatLon } from '../data/geo';
import { toRgbPalette } from '../data/palette';
import type { GlobeEngine } from '../globe/engine';
import type { TimeModel } from '../state/timeModel';
import type { AppState } from '../state/store';
import type { History, HistoryReading, AeonEvent, Epoch, Passage } from '../types/history';
import { clear, el, plate } from '../ui/dom';
import { closeGlyph } from '../ui/reveal';
import { passageLine } from '../ui/format';
import type { PassageBridge } from '../ui/passage';
import { epochAt, epochHeroImage, eventHeroImage, eventOccurrences } from './model';
import { yearText } from './skyclock';
import { EquinoxRing, skyClockDisclosure } from './skyclock-view';

type Selection = NonNullable<NonNullable<AppState['history']>['selection']>;
const yearLabel = (year: number) => year < 0 ? `${Math.abs(Math.round(year)).toLocaleString()} BCE` : `${Math.round(year).toLocaleString()} CE`;

/** One authored reading over the same Earth and the same live clock. */
export class AionView {
  readonly root: HTMLElement;
  private heading: HTMLElement;
  private epochs: HTMLElement;
  private card: HTMLElement;
  private markers: HTMLElement;
  private reading: HistoryReading | null = null;
  private state: AppState['history'];
  private dots: { element: HTMLElement; event: AeonEvent; dir: ReturnType<typeof dirFromLatLon> }[] = [];
  private epochId = '';
  private currentEvent: AeonEvent | undefined;
  private threadIndex = 0;
  private threadPlaying = false;
  private threadTimer = 0;
  private threadEvents: AeonEvent[] = [];
  private threadToggle: HTMLButtonElement | null = null;
  private ring: EquinoxRing;
  /** The field as the cursor has reached it: what has entered the world by now stands; what came later recedes. */
  private fieldRel: Float32Array | null = null;
  private revealYearKey = Number.NaN;
  private revealEventId = '';

  constructor(parent: HTMLElement, private model: Model, private engine: GlobeEngine, private time: TimeModel,
    readonly history: History, private navigate: (state: AppState) => void, private passages?: PassageBridge) {
    this.heading = el('header', { class: 'aion-heading' });
    this.epochs = el('nav', { class: 'aion-epochs', 'aria-label': 'Historical epochs' });
    this.card = el('aside', { class: 'aion-card reveal on', 'aria-label': 'Aion reading' });
    this.markers = el('div', { class: 'aion-markers' });
    this.root = el('section', { class: 'aion', hidden: true, 'aria-label': 'Archetypal history' }, [this.heading, this.markers, this.epochs, this.card]);
    parent.append(this.root);
    this.ring = new EquinoxRing(this.root);
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
      this.buildHeading(reading);
      this.buildMarkers(reading);
      clear(this.epochs);
      for (const epoch of reading.epochs.filter(e => !e.parentId)) {
        this.epochs.append(el('button', { type: 'button', text: epoch.name.split(' · ')[0], 'aria-label': epoch.name, title: `${epoch.name} · ${yearLabel(epoch.from)} – ${yearLabel(epoch.to)}`, 'data-epoch': epoch.id,
          onclick: () => this.select({ kind: 'epoch', id: epoch.id }) }));
      }
    }
    this.threadPlaying = false;
    this.threadEvents = [];
    this.currentEvent = undefined;
    this.engine.arcs.clear();
    this.engine.markers.sel.hide();
    const selection = state.selection;
    (this.heading.querySelector('[aria-label="Historical event"]') as HTMLSelectElement).value = selection?.kind === 'event' ? selection.id : '';
    (this.heading.querySelector('[aria-label="Historical thread"]') as HTMLSelectElement).value = selection?.kind === 'thread' ? selection.id : '';
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
      const thread = reading.threads.find(t => t.id === selection.id);
      if (thread) {
        this.threadEvents = thread.eventIds.map(id => reading.events.find(e => e.id === id)).filter((e): e is AeonEvent => !!e);
        this.threadIndex = 0;
        const located = this.threadEvents.filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon));
        this.engine.arcs.build(located.map(e => dirFromLatLon(e.lat!, e.lon!)), located.map((_, i) => i > 0));
        this.engine.arcs.uniforms.uDraw.value = located.length + 1;
        this.engine.arcs.uniforms.uTour.value = 0;
        this.showThreadEvent();
      }
    } else {
      this.card.hidden = true;
      this.engine.setEmphasis(null, null);
    }
    this.update(0);
    document.title = `${reading.title} · ${reading.author} — An Archetypal Earth`;
  }

  hide() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('aion-mode');
    this.threadPlaying = false;
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
    const readingSelect = el('select', { 'aria-label': 'Historical reading', onchange: e => {
      this.navigate({ view: { kind: 'world' }, deep: false, history: { reading: (e.target as HTMLSelectElement).value } });
    } });
    for (const r of this.history.readings) readingSelect.append(el('option', { value: r.id, text: `${r.title} · ${r.author}`, selected: r.id === reading.id }));
    const eventSelect = el('select', { 'aria-label': 'Historical event', onchange: e => {
      const id = (e.target as HTMLSelectElement).value;
      (e.target as HTMLSelectElement).closest('details')?.removeAttribute('open');
      this.select(id ? { kind: 'event', id } : undefined);
    } }, [el('option', { value: '', text: 'Events' })]);
    for (const event of [...reading.events].sort((a, b) => a.year - b.year)) eventSelect.append(el('option', { value: event.id, text: `${event.yearDisplay} · ${event.name}` }));
    const threadSelect = el('select', { 'aria-label': 'Historical thread', onchange: e => {
      const id = (e.target as HTMLSelectElement).value;
      (e.target as HTMLSelectElement).closest('details')?.removeAttribute('open');
      this.select(id ? { kind: 'thread', id } : undefined);
    } }, [el('option', { value: '', text: 'Follow a thread' })]);
    for (const thread of reading.threads) threadSelect.append(el('option', { value: thread.id, text: thread.name }));
    // Extend the existing focus-label vocabulary; the current reading is a
    // heading, and the quieter browsing controls open only when requested.
    this.heading.append(this.history.readings.length > 1 ? readingSelect : el('h1', { class: 'fl-name', text: reading.title }),
      el('p', { class: 'aion-context', text: reading.author }),
      el('details', { class: 'aion-browse' }, [el('summary', { class: 'link-quiet', text: 'Browse' }),
        el('div', { class: 'aion-choices' }, [el('label', {}, [el('span', { text: 'Events' }), eventSelect]), el('label', {}, [el('span', { text: 'Threads' }), threadSelect])])]));
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

  /** One passage as an open quotation, its cite in the same voice as every other cite in the field. */
  private quote(p: Passage): HTMLElement {
    const line = passageLine(this.model, p.work, p.locator);
    const cite = this.passages?.known(p.work)
      ? el('button', { class: 'link-quiet', type: 'button', text: line, title: 'Open the passage in the corpus', onclick: () => this.passages!.open(p.work, p.locator) })
      : line;
    const mark = p.basis === 'S'
      ? el('span', { class: 'aion-basis', title: 'Standard scholarship, quoted for orientation', text: 'S' })
      : el('span', { class: 'aion-basis', title: 'Asserted in Jung\u2019s own text', text: 'J' });
    return el('blockquote', { class: 'dp-def' }, [el('p', { text: p.text }), el('footer', {}, [cite, ' ', mark])]);
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
      el('h2', { class: 'rv-name', text: epoch.name }), el('p', { class: 'rv-para aion-lede', text: epoch.oneLine }),
      ...this.keyQuote(epoch.passages), ...epoch.body.map(text => el('p', { class: 'rv-para', text })),
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
      el('p', { class: 'rv-para aion-lede', text: event.oneLine }), ...this.keyQuote(event.passages), ...event.body.map(text => el('p', { class: 'rv-para', text })),
      links, ...this.moreSources(event.passages), skyClockDisclosure(this.reading!, event));
  }

  private showThreadEvent() {
    const event = this.threadEvents[this.threadIndex];
    if (!event) return;
    this.showEvent(event, true);
    const thread = this.reading!.threads.find(t => t.id === this.state?.selection?.id)!;
    const step = (delta: number) => { this.threadIndex = (this.threadIndex + delta + this.threadEvents.length) % this.threadEvents.length; this.threadTimer = 0; this.showThreadEvent(); };
    this.threadToggle = el('button', { type: 'button', text: this.threadPlaying ? 'Pause thread' : 'Play thread', onclick: () => {
      this.threadPlaying = !this.threadPlaying;
      this.threadTimer = 0;
      this.threadToggle!.textContent = this.threadPlaying ? 'Pause thread' : 'Play thread';
    } });
    this.card.querySelector('.rv-text')!.prepend(el('div', { class: 'aion-thread' }, [el('span', { text: `${thread.name} · ${this.threadIndex + 1}/${this.threadEvents.length}` }),
      el('p', { class: 'aion-thread-line', text: thread.oneLine }),
      el('div', {}, [el('button', { type: 'button', text: '←', 'aria-label': 'Previous historical event', onclick: () => step(-1) }), this.threadToggle,
        el('button', { type: 'button', text: '→', 'aria-label': 'Next historical event', onclick: () => step(1) })])]));
  }

  pauseThread() {
    this.threadPlaying = false;
    if (this.threadToggle) this.threadToggle.textContent = 'Play thread';
  }

  /**
   * The field as of the cursor's year: what has entered the world stands (the standing epoch brightest, earlier
   * epochs receded), what came later recedes to a presence — never invisible, never unclickable. The standing
   * event's own occurrences stay brightest of all.
   */
  private updateFieldReveal(year: number, epoch: ReturnType<typeof epochAt>) {
    const m = this.model;
    const rel = (this.fieldRel ??= new Float32Array(m.occ.length));
    for (let i = 0; i < m.occ.length; i++) {
      if (!m.located[i]) { rel[i] = 1; continue; }
      const y = m.occ[i].year;
      rel[i] = y > year ? 0.05 : y >= (epoch?.from ?? y) ? 1 : 0.3;
    }
    if (this.currentEvent) for (const i of eventOccurrences(m, this.currentEvent)) if (m.located[i]) rel[i] = 1.6;
    this.engine.setEmphasis(rel, null);
  }

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
    const eventId = this.currentEvent?.id ?? '';
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
    if (this.threadPlaying && !this.time.playing) {
      this.threadTimer += dt;
      if (this.threadTimer > 5) {
        this.threadTimer = 0;
        if (this.threadIndex + 1 < this.threadEvents.length) { this.threadIndex++; this.showThreadEvent(); }
        else { this.threadPlaying = false; if (this.threadToggle) this.threadToggle.textContent = 'Play thread'; }
      }
    }
  }
}
