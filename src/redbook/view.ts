// THE RED BOOK: Liber Novus as a folio-sequence walk over the same field.
// A mode alongside Aion: the globe stays the anchor (the standing stop tunes
// the world to its family), the walk and the genesis table stand over it.
// Everything here is subject: Jung — the book is the one corpus-document
// where analyst, patient and commentator are the same body.
import { scopeOf } from '../data/scope';
import type { Model } from '../data/model';
import { occurrenceImage } from '../data/model';
import { toRgbPalette } from '../data/palette';
import type { GlobeEngine } from '../globe/engine';
import type { AppState } from '../state/store';
import type { RedBook, RedBookStop, GenesisRow } from '../types/redbook';
import { clear, el, onReadGesture, plate } from '../ui/dom';
import { modeOptions, optionAction, optionGroup } from '../ui/mode-options';
import { closeGlyph } from '../ui/reveal';
import { eraShort } from '../ui/format';
import { WalkStrip, type WalkItem } from '../ui/walk-strip';
import { genesisCite, keyPassage, readerBody, READING_TITLES } from './text';
import type { LensChrome } from '../shell/lens';
import { providerLabels } from '../data/labels';

/** The mode's own atmosphere: the book's red, deep and bounded. */
const REDBOOK_PALETTE = { core: '#c0554a', glow: '#8a342e', fog: '#2a1110', deep: '#120606' };

export class RedBookView {
  readonly root: HTMLElement;
  private heading: HTMLElement;
  private rail: HTMLElement;
  private strip: WalkStrip;
  private card: HTMLElement;
  private mode: RedBook;
  private state: AppState['redbook'];
  private navigate: (state: AppState) => void;
  private stops: RedBookStop[] = [];
  private current: RedBookStop | undefined;
  private sectionName = new Map<string, string>();

  /**
   * `onStop`: a folio stands (by its stop id); the controller tunes the clock to its year.
   * `onRead`: the standing folio's core reading, opened by a double-click on its card (the controller keeps this mode to return to).
   */
  constructor(parent: HTMLElement, private model: Model, private engine: GlobeEngine, redbook: RedBook, navigate: (state: AppState) => void,
    private onStop: (stopId: string) => void = () => {}, private onRead: (occId: string) => void = () => {}, private chrome?: LensChrome) {
    this.mode = redbook;
    this.navigate = navigate;
    for (const s of redbook.sections) this.sectionName.set(s.id, s.name);
    this.stops = redbook.stops;
    // the walk/genesis toggle is this lens's one control; the shell places it (MODES-RFC §2)
    this.heading = el('div', { class: 'rb-controls' });
    this.rail = el('nav', { class: 'rb-rail', 'aria-label': 'Folio walk' });
    this.strip = new WalkStrip(this.rail, { prev: 'Previous folio', next: 'Next folio', list: 'Folio walk' },
      (i) => this.select({ stop: this.stops[i].id }), (delta) => this.walk(delta));
    this.card = el('aside', { class: 'rb-card reveal on', 'aria-label': 'Red Book reading', hidden: true });
    this.root = el('section', { class: 'redbook', hidden: true, 'aria-label': 'The Red Book' }, [this.rail, this.card]);
    this.setCardActive(false);
    parent.append(this.root);
    // a double-click on a folio's card opens its occurrence's core reading; the genesis table has no folio to open
    onReadGesture(this.card, () => { if (this.current) this.onRead(this.current.id); });
  }

  show(state: AppState['redbook']) {
    this.state = state;
    this.root.hidden = false;
    document.body.classList.add('redbook-mode');
    this.buildHeading();
    this.engine.setPalette(toRgbPalette(REDBOOK_PALETTE, 0.24), 1.6);
    if (state?.genesis) {
      this.chrome?.setContext('Genesis');
      this.chrome?.setControls(null);
      this.setCardActive(true);
      this.showGenesis();
    } else if (state?.stop) {
      const stop = this.stops.find((s) => s.id === state.stop) ?? this.stops[0];
      this.chrome?.setContext('');
      this.chrome?.setControls(null);
      this.setCardActive(true);
      this.showStop(stop);
    } else {
      // landing: Options waiting, no folio card
      this.current = undefined;
      this.setCardActive(false);
      this.rail.hidden = true;
      this.chrome?.setContext(this.mode.mode.subtitle.split(' · ')[0]);
      this.chrome?.setControls([this.heading]);
      this.engine.setEmphasis(null, null);
    }
  }

  hide() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('redbook-mode');
    this.setCardActive(false);
    this.current = undefined;
    this.state = undefined;
  }

  /** The aside is out of the keyboard path and the accessibility tree whenever the mode is not showing. */
  private setCardActive(active: boolean) {
    this.card.hidden = !active;
    this.card.inert = !active;
    if (active) this.card.removeAttribute('aria-hidden');
    else this.card.setAttribute('aria-hidden', 'true');
  }

  private select(next: AppState['redbook']) {
    this.navigate({ view: { kind: 'world' }, deep: false, ...(next && (next.stop || next.genesis) ? { redbook: next } : { redbook: {} }) });
  }

  private buildHeading() {
    clear(this.heading);
    const genesis = !!this.state?.genesis;
    const walking = !!this.state?.stop && !genesis;
    // the walk opens on folio 1
    const firstId = this.stops[0]?.id;
    // two rows: the folio walk (the rail moves folio by folio) and the genesis table; the folios are not listed
    this.heading.append(modeOptions([
      optionGroup('Walk', [
        optionAction('The walk', () => this.select(firstId ? { stop: firstId } : {}), {
          pressed: walking, description: 'Each folio of the book, in sequence, one at a time',
        }),
        optionAction('Genesis', () => this.select({ genesis: true }), {
          pressed: genesis, description: 'Where each root became: an archetype, a family or an Aion reading',
        }),
      ]),
    ]));
  }

  private buildRail() {
    const current = this.current;
    if (this.state?.genesis || !current) { this.rail.hidden = true; return; }
    this.rail.hidden = false;
    const i = Math.max(0, this.stops.findIndex((s) => s.id === current.id));
    this.strip.update(this.walkItems(), i, this.sectionName.get(current.sectionId) ?? '');
  }

  /** The folios as the walk strip shows them: one per stop, in order; a stop with no occurrence keeps its place, unlabelled. */
  private walkItems(): WalkItem[] {
    const m = this.model;
    return this.stops.map((stop) => {
      const i = m.occIndex.get(stop.id);
      const o = i !== undefined ? m.occ[i] : undefined;
      return {
        id: stop.id,
        image: o ? occurrenceImage(m, o) : undefined,
        label: o?.title ?? stop.id,
        palette: o ? m.famById.get(o.familyId)?.palette : undefined,
      };
    });
  }

  private closeButton() {
    // close the folio/genesis card; stay in the Red Book with Options waiting
    return el('button', { type: 'button', class: 'rv-close', 'aria-label': 'Close reading', onclick: () => this.select({}) }, [closeGlyph()]);
  }

  /**
   * The dev-only facsimile: an extra beside the hero, present only on the dev server and gone the moment
   * it cannot load. Its alt text is the vault's plate note; nothing about it is shown to the reader.
   */
  private facsimile(stop: RedBookStop): HTMLElement | null {
    if (!import.meta.env.DEV || !stop.plate) return null;
    const img = el('img', { class: 'rb-plate', alt: stop.plateCaption ?? 'Facsimile plate — Liber Novus', loading: 'lazy', src: `${this.mode.plates.urlPrefix}${stop.plate}` });
    img.addEventListener('error', () => img.remove());
    return img;
  }

  /** The key words, open: a blockquote that is never collapsed, its footer the cite. */
  private quote(words: string, footer: string): HTMLElement {
    return el('blockquote', { class: 'dp-def rb-quote' }, [el('p', { text: `“${words}”` }), footer ? el('footer', { text: footer }) : null]);
  }

  private showStop(stop: RedBookStop) {
    this.current = stop;
    this.buildRail();
    const m = this.model;
    const i = m.occIndex.get(stop.id);
    if (i === undefined) return;
    const o = m.occ[i];
    const fam = m.famById.get(o.familyId);
    clear(this.card);
    this.card.append(this.closeButton());
    const body = el('div', { class: 'rv-body' });
    const text = el('div', { class: 'rv-text' });
    body.append(plate(occurrenceImage(m, o), { className: 'rv-hero', credit: true, palette: fam?.palette, alt: o.title, eager: true }));
    const facsimile = this.facsimile(stop);
    if (facsimile) body.append(facsimile);
    text.append(
      el('p', { class: 'aion-date rv-line', text: [this.sectionName.get(stop.sectionId) ?? '', eraShort(o.yearDisplay, 40)].filter(Boolean).join(' · ') }),
      el('h2', { class: 'rv-name', text: o.title }),
    );
    const key = keyPassage(o, this.genesisFor(stop.id));
    if (key) text.append(this.quote(key.words, key.footer));
    for (const para of readerBody(o.body)) text.append(el('p', { class: 'rv-para', text: para }));
    const links = el('div', { class: 'aion-links' });
    for (const t of fam?.archetypes ?? []) {
      const archetype = m.archById.get(t.id);
      if (archetype) links.append(el('button', { type: 'button', class: 'link-quiet', text: archetype.name, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'archetype', id: archetype.id } }, deep: false }) }));
    }
    if (fam) links.append(el('button', { type: 'button', class: 'link-quiet', text: fam.name, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'family', id: fam.id } }, deep: false }) }));
    links.append(el('button', { type: 'button', class: 'link-quiet', text: 'On the globe', onclick: () => this.navigate({ view: { kind: 'manifest', occId: o.id, context: { type: 'family', id: o.familyId } }, deep: false }) }));
    text.append(links);
    body.append(text);
    this.card.append(body);
    this.emphasise(o.familyId, i);
    this.onStop(stop.id);
    // the standing stop is where the world looks: all stops are the book's one place
    if (m.located[i]) this.engine.rig.flyTo(o.lat, o.lon, 2.55, { duration: 1.7 });
  }

  private genesisFor(stopId: string): GenesisRow | undefined {
    return this.mode.genesis.find((g) => g.stopId === stopId);
  }

  private showGenesis() {
    this.current = undefined;
    this.buildRail();
    const m = this.model;
    clear(this.card);
    this.card.append(this.closeButton());
    const body = el('div', { class: 'rv-body' });
    const text = el('div', { class: 'rv-text' });
    text.append(
      el('h2', { class: 'rv-name', text: 'Genesis' }),
      el('p', { class: 'rv-para aion-lede', text: providerLabels().redbookLede }),
    );
    for (const row of this.mode.genesis) text.append(this.genesisRow(row, m));
    body.append(text);
    this.card.append(body);
    this.engine.setEmphasis(null, null);
  }

  private genesisRow(row: GenesisRow, m: Model): HTMLElement {
    const row2 = el('article', { class: 'rb-genesis' });
    const head = el('p', { class: 'rb-genesis-name' });
    const link = (target: Exclude<GenesisRow['target'], null>) => {
      if (target.kind === 'reading') {
        const title = READING_TITLES[target.id];
        if (!title) return;
        head.append(el('button', { type: 'button', class: 'link-quiet', text: title, onclick: () => this.navigate({ view: { kind: 'world' }, deep: false, history: { reading: target.id } }) }));
        return;
      }
      const name = target.kind === 'archetype' ? m.archById.get(target.id)?.name : m.famById.get(target.id)?.name;
      if (!name) return;
      head.append(el('button', { type: 'button', class: 'link-quiet', text: name, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: target.kind, id: target.id } }, deep: false }) }));
    };
    head.append(el('strong', { text: row.name }), ' → ');
    let linked = 0;
    const sep = () => { if (linked++) head.append(el('span', { class: 'rb-sep', text: ' · ' })); };
    if (row.target) { sep(); link(row.target); }
    if (row.also) { sep(); link(row.also); }
    row2.append(
      head,
      el('blockquote', { class: 'dp-def rb-quote' }, [el('p', { text: `“${row.words}”` }), el('footer', { text: genesisCite(row.cite) })]),
      el('p', { class: 'rv-para rb-doctrine', text: row.doctrine }),
    );
    const stop = this.stops.find((s) => s.id === row.stopId);
    const o = stop && m.occIndex.has(stop.id) ? m.occ[m.occIndex.get(stop.id)!] : undefined;
    if (stop && o) row2.append(el('button', { type: 'button', class: 'link-quiet rb-genesis-stop', text: o.label, onclick: () => this.select({ stop: stop.id }) }));
    return row2;
  }

  /**
   * The world tuned to the walk: the book's own stops and the standing stop's family are the mode's set; their nearby
   * presences dim; the rest of the field is set aside (src/data/scope.ts), and the shell says so.
   */
  private emphasise(familyId: string, selected: number) {
    const m = this.model;
    const own: number[] = [];
    for (const s of this.stops) { const i = m.occIndex.get(s.id); if (i !== undefined) own.push(i); }
    for (const i of m.famOcc.get(familyId) ?? []) own.push(i);
    const sc = scopeOf(m, own, 'the Red Book’s walk', { selected: m.located[selected] ? selected : undefined });
    this.engine.setEmphasis(sc.rel, null, sc.info);
  }

  /** Arrow-key walking; wired by the controller. */
  walk(delta: number) {
    if (this.state?.genesis || !this.current) return;
    const i = this.stops.findIndex((s) => s.id === this.current!.id);
    const next = this.stops[(i + delta + this.stops.length) % this.stops.length];
    this.select({ stop: next.id });
  }
}
