// THE RED BOOK: Liber Novus as a folio-sequence walk over the same field.
// A mode alongside Aion: the globe stays the anchor (the standing stop tunes
// the world to its family), the folio rail stands over it, and a folio or the genesis table is read in the reading pane
// (H5): the book's Contents are its folios by section, its walk is the Walk runner over the `redbook` walk.
// Everything here is subject: Jung — the book is the one corpus-document
// where analyst, patient and commentator are the same body.
import { scopeOf } from '../data/scope';
import type { Model } from '../data/model';
import { occurrenceImage } from '../data/model';
import { toRgbPalette } from '../data/palette';
import type { GlobeEngine } from '../globe/engine';
import type { AppState } from '../state/store';
import type { Occurrence } from '../types/field';
import type { RedBook, RedBookStop, GenesisRow } from '../types/redbook';
import { el, plate } from '../ui/dom';
import { paneStepper } from '../ui/pane';
import { eraShort } from '../ui/format';
import type { ContentsGroup } from '../ui/deep';
import { lensContract } from '../lenses/contract';
import { WalkRunner, type WalkEffects } from '../walk/runner';
import { redbookWalk } from './walk';
import { WalkStrip, type WalkItem } from '../ui/walk-strip';
import { genesisCite, keyPassage, readerBody, readerCite, READING_TITLES, RED_BOOK_WORKS, type KeyPassage } from './text';
import { quote, type CitedQuote } from '../ui/quote';
import type { PassageBridge } from '../ui/passage';
import type { LensChrome } from '../shell/lens';
import { providerLabels } from '../data/labels';

/** The mode's own atmosphere: the book's red, deep and bounded. */
const REDBOOK_PALETTE = { core: '#c0554a', glow: '#8a342e', fog: '#2a1110', deep: '#120606' };

export class RedBookView {
  readonly root: HTMLElement;
  private rail: HTMLElement;
  private strip: WalkStrip;
  private runner: WalkRunner;
  private mode: RedBook;
  private state: AppState['redbook'];
  private navigate: (state: AppState) => void;
  private stops: RedBookStop[] = [];
  private current: RedBookStop | undefined;
  private sectionName = new Map<string, string>();
  /** does the field filter leave this occurrence in? Set by the controller; every folio is in until it is told otherwise */
  private passing: (occIndex: number) => boolean = () => true;

  /**
   * `onStop`: a folio stands; the controller glides the clock to the year the walk's stop names (null: leave the clock).
   * `onRead`: the standing folio's core reading, opened by a double-click on its reading (the controller keeps this mode to return to).
   */
  constructor(parent: HTMLElement, private model: Model, private engine: GlobeEngine, redbook: RedBook, navigate: (state: AppState) => void,
    private onStop: (clockU: number | null) => void = () => {}, private onRead: (occId: string) => void = () => {}, private chrome?: LensChrome, private passages?: PassageBridge) {
    this.mode = redbook;
    this.navigate = navigate;
    for (const s of redbook.sections) this.sectionName.set(s.id, s.name);
    this.stops = redbook.stops;
    // the book is walked by the one runner; past the last folio comes the first, as the rail has always done
    this.runner = new WalkRunner({ scale: model.scale, wrap: true });
    this.rail = el('nav', { class: 'rb-rail', 'aria-label': 'Folio walk' });
    this.strip = new WalkStrip(this.rail, { prev: 'Previous folio', next: 'Next folio', list: 'Folio walk' },
      (i) => this.select({ stop: this.stops[i].id }), (delta) => this.walk(delta));
    this.root = el('section', { class: 'redbook', hidden: true, 'aria-label': 'The Red Book' }, [this.rail]);
    parent.append(this.root);
  }

  private get pane() {
    return this.chrome?.pane;
  }

  /** The Contents of the book: its folios by section, and the genesis table; the folio that stands is marked. */
  private contentsGroups(): ContentsGroup[] {
    const m = this.model;
    const groups = lensContract('redbook', m, { redbook: this.mode }).groups;
    const at = new Map(this.stops.map((s, i) => [s.id, i]));
    const standing = this.state?.stop && !this.state.genesis ? this.state.stop : undefined;
    return [
      ...groups.map((g) => ({
        title: g.title,
        items: g.items.map((it) => ({ label: it.title, note: String((at.get(it.id) ?? 0) + 1), current: it.id === standing, onPick: () => this.select({ stop: it.id }) })),
      })),
      { title: 'Where the roots became', items: [{ label: 'Genesis', current: !!this.state?.genesis, onPick: () => this.select({ genesis: true }) }] },
    ];
  }

  show(state: AppState['redbook']) {
    this.state = state;
    this.root.hidden = false;
    document.body.classList.add('redbook-mode');
    this.engine.setPalette(toRgbPalette(REDBOOK_PALETTE, 0.24), 1.6);
    this.pane?.contents('Liber Novus', () => this.contentsGroups());
    if (state?.genesis) {
      this.chrome?.setContext('Genesis');
      this.runner.interrupt();
      this.showGenesis();
    } else if (state?.stop) {
      const stop = this.stops.find((s) => s.id === state.stop) ?? this.stops[0];
      // the folio is read in the pane under its own name; the tab and history carry it too
      this.chrome?.setContext(this.model.occ[this.model.occIndex.get(stop.id) ?? -1]?.title ?? '', true);
      this.showStop(stop);
    } else {
      // landing: no folio read, the Contents waiting
      this.current = undefined;
      this.runner.interrupt();
      this.pane?.hide();
      this.rail.hidden = true;
      this.chrome?.setContext(this.mode.mode.subtitle.split(' · ')[0]);
      this.engine.setEmphasis(null, null);
    }
  }

  hide() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('redbook-mode');
    this.pane?.release();
    this.runner.interrupt();
    this.current = undefined;
    this.state = undefined;
  }

  /** The field filter changed: a folio it leaves out is drawn as filtered on the rail (it keeps its place, and can still be walked to). */
  setFilter(passing: (occIndex: number) => boolean) {
    this.passing = passing;
    if (!this.root.hidden) this.buildRail();
  }

  private select(next: AppState['redbook']) {
    this.navigate({ view: { kind: 'world' }, deep: false, ...(next && (next.stop || next.genesis) ? { redbook: next } : { redbook: {} }) });
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
        filtered: i !== undefined && !this.passing(i),
      };
    });
  }

  /**
   * The dev-only facsimile: an extra beside the hero, present only on the dev server and gone the moment
   * it cannot load. Its alt text is the vault's plate note; nothing about it is shown to the reader.
   */
  private facsimile(stop: RedBookStop): HTMLElement | null {
    if (!import.meta.env.DEV || !stop.plate) return null;
    // the folio already stands as the instance's own picture (useFolios): it is not shown twice
    const o = this.model.occ[this.model.occIndex.get(stop.id) ?? -1];
    if (o?.image?.src.endsWith(`/${stop.plate}`) || o?.image?.src.endsWith(stop.plate)) return null;
    const img = el('img', { class: 'rb-plate', alt: stop.plateCaption ?? 'Facsimile plate — Liber Novus', loading: 'lazy', src: `${this.mode.plates.urlPrefix}${stop.plate}` });
    img.addEventListener('error', () => img.remove());
    return img;
  }

  /** A genesis row's words with their cite as the curation holds it ("redbook pdf p232"): the Work by registry key, the locator as written. */
  private genesisQuote(row: { words: string; cite: string }): CitedQuote {
    const parts = /^(\S+)\s+(.+)$/.exec(row.cite.trim());
    const title = parts ? RED_BOOK_WORKS[parts[1]] : undefined;
    return { text: row.words, cite: parts && title ? { work: this.model.workKey.get(parts[1]) ?? parts[1], workTitle: title, locator: parts[2] } : genesisCite(row.cite) };
  }

  /** The key words, open: the one Quote component, with the cite of whichever source the words were drawn from. */
  private keyQuote(o: Occurrence, key: KeyPassage, genesis: GenesisRow | undefined): HTMLElement {
    if (genesis && key.words === genesis.words) return quote(this.genesisQuote(genesis), { passages: this.passages });
    const c = o.jung[0];
    if (!c) return quote({ text: key.words, cite: key.footer });
    const r = readerCite(c);
    return quote({ text: key.words, cite: { work: this.model.workKey.get(r.work) ?? r.work, workTitle: r.workTitle, locator: r.locator }, ...(c.voice ? { voice: c.voice } : {}) }, { passages: this.passages });
  }

  /** The walk's stepper under a folio: the neighbours, and where in the book the visitor stands. */
  private stepper(i: number, n: number): Node[] {
    const name = (k: number) => {
      const id = this.stops[(k + n) % n]?.id;
      const at = id === undefined ? undefined : this.model.occIndex.get(id);
      return at === undefined ? null : this.model.occ[at].title;
    };
    return paneStepper({ prev: 'Previous folio', next: 'Next folio' }, `${i + 1} / ${n}`, () => this.walk(-1), () => this.walk(1), {}, { prev: name(i - 1), next: name(i + 1) });
  }

  private showStop(stop: RedBookStop) {
    this.current = stop;
    this.buildRail();
    const m = this.model;
    const i = m.occIndex.get(stop.id);
    if (i === undefined) return;
    const o = m.occ[i];
    const fam = m.famById.get(o.familyId);
    // the walk: the runner stands on this folio (it begins here when the book is entered at a folio)
    const at = Math.max(0, this.stops.findIndex((s) => s.id === stop.id));
    const walk = redbookWalk(m, this.mode);
    const step = this.runner.active && this.runner.position?.walkId === walk.id
      ? this.runner.goto(at)
      : this.runner.start(walk, { u: 0, focus: null, reading: null, centre: null, walk: null }, at);
    const body = el('div', { class: 'rv-body' });
    const text = el('div', { class: 'rv-text' });
    body.append(plate(occurrenceImage(m, o), { className: 'rv-hero dp-figure', credit: true, palette: fam?.palette, alt: o.title, eager: true }));
    const facsimile = this.facsimile(stop);
    if (facsimile) body.append(facsimile);
    text.append(
      el('p', { class: 'dp-by rv-line', text: [this.sectionName.get(stop.sectionId) ?? '', eraShort(o.yearDisplay, 40)].filter(Boolean).join(' · ') }),
      el('h2', { class: 'dp-title rv-name', text: o.title }),
    );
    const key = keyPassage(o, this.genesisFor(stop.id));
    if (key) text.append(this.keyQuote(o, key, this.genesisFor(stop.id)));
    for (const para of readerBody(o.body)) text.append(el('p', { class: 'dp-para rv-para', text: para }));
    const links = el('div', { class: 'dp-flow aion-links' });
    for (const t of fam?.archetypes ?? []) {
      const archetype = m.archById.get(t.id);
      if (archetype) links.append(el('button', { type: 'button', class: 'link-quiet', text: archetype.name, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'archetype', id: archetype.id } }, deep: false }) }));
    }
    if (fam) links.append(el('button', { type: 'button', class: 'link-quiet', text: fam.name, onclick: () => this.navigate({ view: { kind: 'focus', subject: { type: 'family', id: fam.id } }, deep: false }) }));
    links.append(el('button', { type: 'button', class: 'link-quiet', text: 'On the globe', onclick: () => this.navigate({ view: { kind: 'manifest', occId: o.id, context: { type: 'family', id: o.familyId } }, deep: false }) }));
    text.append(links);
    body.append(text);
    this.pane?.read({ key: `folio:${stop.id}`, eyebrow: 'Folio', nodes: [body], foot: this.stepper(at, this.stops.length), onRead: () => this.onRead(stop.id), engages: { type: 'occurrence', id: stop.id } });
    this.emphasise(o.familyId, i);
    this.arrive(step?.effects ?? null, i);
  }

  /** The walk's stop carried out through the entries the controller and the rig give: the clock glides to its year, the globe flies to its place. */
  private arrive(fx: WalkEffects | null, i: number) {
    this.onStop(fx ? fx.setClock : null);
    // the standing stop is where the world looks: all stops are the book's one place
    if (fx?.flyTo && this.model.located[i]) this.engine.rig.flyTo(fx.flyTo.lat, fx.flyTo.lon, 2.55, { duration: 1.7 });
  }

  private genesisFor(stopId: string): GenesisRow | undefined {
    return this.mode.genesis.find((g) => g.stopId === stopId);
  }

  private showGenesis() {
    this.current = undefined;
    this.buildRail();
    const m = this.model;
    const body = el('div', { class: 'rv-body' });
    const text = el('div', { class: 'rv-text' });
    text.append(
      el('h2', { class: 'dp-title rv-name', text: 'Genesis' }),
      el('p', { class: 'dp-lede rv-para aion-lede', text: providerLabels().redbookLede }),
    );
    for (const row of this.mode.genesis) text.append(this.genesisRow(row, m));
    body.append(text);
    this.pane?.read({ key: 'genesis', eyebrow: 'Liber Novus', nodes: [body] });
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
      quote(this.genesisQuote(row), { passages: this.passages }),
      el('p', { class: 'dp-para rv-para rb-doctrine', text: row.doctrine }),
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

  /** Arrow-key walking, the rail's steps and the pane's stepper: the runner names the neighbour, past either end comes the other. */
  walk(delta: number) {
    if (this.state?.genesis || !this.current) return;
    const step = delta > 0 ? this.runner.next() : this.runner.prev();
    const id = step?.stop.subject?.id;
    if (id) this.select({ stop: id });
  }
}
