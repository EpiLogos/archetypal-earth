// THE RED BOOK: Liber Novus as a folio-sequence walk over the same field.
// A mode alongside Aion: the globe stays the anchor (the standing stop tunes
// the world to its family), the walk and the genesis table stand over it.
// Everything here is subject: Jung — the book is the one corpus-document
// where analyst, patient and commentator are the same body.
import type { Model } from '../data/model';
import { toRgbPalette } from '../data/palette';
import type { GlobeEngine } from '../globe/engine';
import type { AppState } from '../state/store';
import type { RedBook, RedBookStop, GenesisRow } from '../types/redbook';
import { clear, el } from '../ui/dom';
import { closeGlyph } from '../ui/reveal';
import { eraShort, jungLine } from '../ui/format';

/** The mode's own atmosphere: the book's red, deep and bounded. */
const REDBOOK_PALETTE = { core: '#c0554a', glow: '#8a342e', fog: '#2a1110', deep: '#120606' };

export class RedBookView {
  readonly root: HTMLElement;
  private heading: HTMLElement;
  private rail: HTMLElement;
  private card: HTMLElement;
  private mode: RedBook;
  private state: AppState['redbook'];
  private navigate: (state: AppState) => void;
  private stops: RedBookStop[] = [];
  private current: RedBookStop | undefined;
  private sectionName = new Map<string, string>();

  constructor(parent: HTMLElement, private model: Model, private engine: GlobeEngine, redbook: RedBook, navigate: (state: AppState) => void) {
    this.mode = redbook;
    this.navigate = navigate;
    for (const s of redbook.sections) this.sectionName.set(s.id, s.name);
    this.stops = redbook.stops;
    this.heading = el('header', { class: 'rb-heading' });
    this.rail = el('nav', { class: 'rb-rail', 'aria-label': 'Folio walk' });
    this.card = el('aside', { class: 'aion-card reveal on', 'aria-label': 'Red Book reading' });
    this.root = el('section', { class: 'redbook', hidden: true, 'aria-label': 'The Red Book' }, [this.heading, this.rail, this.card]);
    parent.append(this.root);
  }

  show(state: AppState['redbook']) {
    this.state = state;
    this.root.hidden = false;
    document.body.classList.add('redbook-mode');
    this.buildHeading();
    this.buildRail();
    this.engine.setPalette(toRgbPalette(REDBOOK_PALETTE, 0.24), 1.6);
    this.card.hidden = false;
    if (state?.genesis) this.showGenesis();
    else {
      const stop = (state?.stop && this.stops.find((s) => s.id === state.stop)) || this.stops[0];
      this.showStop(stop);
    }
  }

  hide() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('redbook-mode');
    this.current = undefined;
    this.state = undefined;
  }

  private select(next: AppState['redbook']) {
    this.navigate({ view: { kind: 'world' }, deep: false, ...(next && (next.stop || next.genesis) ? { redbook: next } : { redbook: {} }) });
  }

  private buildHeading() {
    clear(this.heading);
    const genesis = !!this.state?.genesis;
    this.heading.append(
      el('h1', { class: 'fl-name', text: this.mode.mode.title }),
      el('p', { class: 'aion-context', text: this.mode.mode.subtitle }),
      el('p', { class: 'aion-context rb-subject', text: this.mode.mode.oneLine }),
      el('nav', { class: 'rb-modes', 'aria-label': 'Red Book views' }, [
        el('button', { type: 'button', class: 'link-quiet', text: 'The walk', 'aria-pressed': String(!genesis), onclick: () => this.select({}) }),
        el('button', { type: 'button', class: 'link-quiet', text: 'Genesis', 'aria-pressed': String(genesis), onclick: () => this.select({ genesis: true }) }),
      ]),
    );
  }

  private buildRail() {
    clear(this.rail);
    if (this.state?.genesis) { this.rail.hidden = true; return; }
    this.rail.hidden = false;
    const i = Math.max(0, this.stops.findIndex((s) => s.id === this.current?.id));
    const prev = () => this.select({ stop: this.stops[(i - 1 + this.stops.length) % this.stops.length].id });
    const next = () => this.select({ stop: this.stops[(i + 1) % this.stops.length].id });
    this.rail.append(
      el('button', { type: 'button', text: '←', 'aria-label': 'Previous folio', onclick: prev }),
      el('span', { class: 'rb-progress', text: `${i + 1} / ${this.stops.length}` }),
      el('button', { type: 'button', text: '→', 'aria-label': 'Next folio', onclick: next }),
      el('span', { class: 'rb-section', text: this.sectionName.get(this.current?.sectionId ?? '') ?? '' }),
    );
  }

  private closeButton() {
    return el('button', { type: 'button', class: 'rv-close', 'aria-label': 'Close Red Book', onclick: () => this.navigate({ view: { kind: 'world' }, deep: false }) }, [closeGlyph()]);
  }

  /** The plate: a local-only runtime asset — absent outside the dev server, and the note says so. */
  private plate(stop: RedBookStop): HTMLElement | null {
    if (!stop.plate) return null;
    const img = el('img', { class: 'rv-hero rb-plate', alt: `Facsimile plate ${stop.plate} (${this.model.occIndex.get(stop.id) !== undefined ? 'Liber Novus' : ''})`, src: `${this.mode.plates.urlPrefix}${stop.plate}` }) as HTMLImageElement;
    const note = el('p', { class: 'rb-plate-note', hidden: true,
      text: `The facsimile plate (${stop.plate}) is not served — it stays out of every build by licence law and loads only from the vault on this machine (${this.mode.plates.vaultRelativeDir}/${stop.plate}).` });
    img.addEventListener('error', () => { img.hidden = true; note.hidden = false; });
    const host = el('div', {}, [img, note]);
    return host;
  }

  private showStop(stop: RedBookStop) {
    this.current = stop;
    this.buildRail();
    const m = this.model;
    const i = m.occIndex.get(stop.id);
    if (i === undefined) return;
    const o = m.occ[i];
    clear(this.card);
    this.card.append(this.closeButton());
    const body = el('div', { class: 'rv-body' });
    const text = el('div', { class: 'rv-text' });
    const plate = this.plate(stop);
    if (plate) body.append(plate);
    const fam = m.famById.get(o.familyId);
    const folio = o.jung[0] ? jungLine(o.jung[0]).replace(/^Jung · /, '') : '';
    text.append(
      el('p', { class: 'aion-date rv-line', text: [this.sectionName.get(stop.sectionId) ?? '', eraShort(o.yearDisplay, 40)].filter(Boolean).join(' · ') }),
      el('h2', { class: 'rv-name', text: o.title }),
      el('p', { class: 'rv-para rb-folio', text: `${folio}${folio ? ' · ' : ''}subject: Jung` }),
    );
    if (stop.plateCaption) text.append(el('p', { class: 'rv-para rb-caption', text: stop.plateCaption }));
    if (o.quote) text.append(el('blockquote', { class: 'dp-def rb-quote' }, [el('p', { text: o.quote })]));
    for (const para of o.body.filter((p) => !p.startsWith('PLATE ('))) text.append(el('p', { class: 'rv-para', text: para }));
    const links = el('div', { class: 'aion-links' });
    for (const t of fam?.archetypes ?? []) {
      const archetype = m.archById.get(t.id);
      if (archetype) links.append(el('button', { type: 'button', class: 'link-quiet', text: `became ${archetype.name}`, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'archetype', id: archetype.id } }, deep: false }) }));
    }
    if (fam) links.append(el('button', { type: 'button', class: 'link-quiet', text: `the ${fam.name} family in the field`, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'family', id: fam.id } }, deep: false }) }));
    links.append(el('button', { type: 'button', class: 'link-quiet', text: 'this manifestation on the globe', onclick: () => this.navigate({ view: { kind: 'manifest', occId: o.id, context: { type: 'family', id: o.familyId } }, deep: false }) }));
    text.append(links);
    body.append(text);
    this.card.append(body);
    this.emphasise(o.familyId, i);
    // the standing stop is where the world looks: all stops are the book's one place
    if (m.located[i]) this.engine.rig.flyTo(o.lat, o.lon, 2.55, { duration: 1.7 });
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
      el('p', { class: 'rv-para aion-lede', text: 'Every symbol-episode of the book, linked forward to what it became — the archetypal-field vault’s genesis table.' }),
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
        head.append(el('button', { type: 'button', class: 'link-quiet', text: 'the Aion reading it became', onclick: () => this.navigate({ view: { kind: 'world' }, deep: false, history: { reading: target.id } }) }));
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
      el('blockquote', { class: 'dp-def rb-quote' }, [el('p', { text: `“${row.words}”` }), el('footer', { text: row.cite })]),
      el('p', { class: 'rv-para rb-doctrine', text: row.doctrine }),
    );
    const stop = this.stops.find((s) => s.id === row.stopId);
    if (stop) row2.append(el('button', { type: 'button', class: 'link-quiet rb-genesis-stop', text: `the root locus: ${this.sectionName.get(stop.sectionId) ?? ''}`, onclick: () => this.select({ stop: stop.id }) }));
    return row2;
  }

  /** The world tuned to the standing stop: its family stands, the rest recedes. */
  private emphasise(familyId: string, selected: number) {
    const m = this.model;
    const rel = new Float32Array(m.occ.length);
    for (let i = 0; i < rel.length; i++) rel[i] = m.located[i] ? 0.07 : 1;
    for (const i of m.famOcc.get(familyId) ?? []) rel[i] = 1.5;
    if (m.located[selected]) rel[selected] = 2.4;
    this.engine.setEmphasis(rel, null);
  }

  /** Arrow-key walking; wired by the controller. */
  walk(delta: number) {
    if (this.state?.genesis || !this.current) return;
    const i = this.stops.findIndex((s) => s.id === this.current!.id);
    const next = this.stops[(i + delta + this.stops.length) % this.stops.length];
    this.select({ stop: next.id });
  }
}
