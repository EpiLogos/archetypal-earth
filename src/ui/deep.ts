// DEEP: the optional reading layer — longer body text, the definition, all cites,
// related forms. A wide translucent sheet; the globe stays visible behind it.
import type { Model, Subject } from '../data/model';
import { archetypesOfFamily, occurrenceImage, subjectName, subjectOccurrences, subjectSky } from '../data/model';
import { bodyOfLocus, locusPhrase } from '../data/skyplace';
import type { BodyKey } from '../types/sky';
import type { Cite, Occurrence } from '../types/field';
import { clear, el, plate } from './dom';
import { sanitiseTitle } from './credit';
import { closeGlyph } from './reveal';
import { symbolReading } from './symbol-reading';
import type { PassageBridge } from './passage';
import { citeLine, eraShort, placeLine, shortWork } from './format';
import { loadLensData, qlBlock, qlSource, quoteBlock, stillFigure, type LensQuote, type QL } from '../lenses/ui';
import { NUMBER_ARCHETYPES } from '../lenses/deep-fields';
import { relatedPlates, relatedRows, SYSTEM_LABEL } from './related';
import { providerLabels } from '../data/labels';

/** The part of a page the renderer reads: its reading line, its sections with their quotations, the subjects it reaches. */
interface PageBody {
  line: string;
  sections: { title: string; line: string; quotes: LensQuote[] }[];
  subjects: { type: Subject['type']; id: string }[];
}
/** One theory node's page (public/data/theory-pages.json, built by scripts/theory-pages.mjs). */
interface TheoryPage {
  concept: string;
  line: string;
  sections: { id: string; title: string; line: string; quotes: LensQuote[] }[];
  subjects: { type: Subject['type']; id: string }[];
}
/** A family's or archetype's page, and the cites of each join by join id (public/data/field-pages.json, scripts/field-pages.mjs). */
interface FieldPagesData {
  version: 1;
  pages: Record<string, PageBody>;
  joins: Record<string, LensQuote[]>;
}
/** The number archetypes' pages and the egg block (public/data/numbers.json, built by scripts/numbers.mjs). */
interface NumberPage {
  n: number;
  position: string;
  ql: QL;
  gloss: QL;
  line: string;
  vonFranz: LensQuote[];
  jung: LensQuote[];
  sections: TheoryPage['sections'];
  subjects: TheoryPage['subjects'];
}
interface NumbersData {
  version: 1;
  line: string;
  egg: { stages: { labels: string[]; source: string }; dream: LensQuote; footnote: LensQuote[]; mandala: LensQuote[] };
  pages: Record<string, NumberPage>;
}
/** The number archetypes one to ten: NUMBER_ARCHETYPES (src/lenses/deep-fields) — the ids their pages answer to. */
const WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };

export interface DeepHandlers {
  onClose(): void;
  onSubject(s: Subject): void;
  onOccurrence(id: string): void;
  /** open a body of the sky (the places a subject hangs at are doors to it) */
  onBody?(key: BodyKey): void;
  /** present when the corpus index is available: cites become deep links */
  onCite?(work: string, locator: string): void;
  passage?: PassageBridge;
}

export type DeepTarget = { kind: 'subject'; subject: Subject } | { kind: 'occurrence'; occId: string };

export class DeepSheet {
  readonly root: HTMLElement;
  private scroller: HTMLElement;
  private article: HTMLElement;
  private open = false;
  private key = '';

  constructor(parent: HTMLElement, private model: Model, private h: DeepHandlers) {
    this.article = el('article', { class: 'dp-article' });
    this.scroller = el('div', { class: 'dp-scroll', tabindex: 0 }, [this.article]);
    this.root = el('section', { class: 'deep', role: 'dialog', 'aria-label': 'Reading', 'aria-modal': 'false' }, [
      el('button', { class: 'dp-close', type: 'button', 'aria-label': 'Close reading', onclick: () => h.onClose() }, [closeGlyph()]),
      this.scroller,
    ]);
    this.root.hidden = true;
    parent.append(this.root);
  }

  get isOpen() {
    return this.open;
  }

  show(t: DeepTarget) {
    const key = t.kind === 'subject' ? `s:${t.subject.type}:${t.subject.id}` : `o:${t.occId}`;
    const fresh = !(this.open && key === this.key);
    // unhidden first: a display:none scroller ignores scrollTop, and the browser gives back the offset it had when it
    // was hidden, so a reading that opened after a scrolled one opened part-way down
    this.root.hidden = false;
    if (fresh) {
      this.key = key;
      clear(this.article);
      if (t.kind === 'subject') this.renderSubject(t.subject);
      else this.renderOccurrence(t.occId);
      this.scroller.scrollTop = 0;
    }
    requestAnimationFrame(() => {
      this.root.classList.add('on');
      if (fresh) this.scroller.scrollTop = 0;
    });
    this.open = true;
    this.scroller.focus({ preventScroll: true });
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.key = '';
    this.root.classList.remove('on');
    window.setTimeout(() => { if (!this.open) this.root.hidden = true; }, 420);
  }

  // ── subjects ──────────────────────────────────────────────────────────
  private renderSubject(s: Subject) {
    const m = this.model;
    const a = this.article;
    if (s.type === 'archetype') {
      const arch = m.archById.get(s.id);
      if (!arch) return;
      a.append(el('h2', { class: 'dp-title', text: arch.name }));
      if (arch.oneLine) a.append(el('p', { class: 'dp-lede', text: arch.oneLine }));
      this.appendPlateStrip(s);
      if (arch.image) a.append(plate(arch.image, { credit: true, className: 'dp-figure', palette: arch.palette, eager: true }));
      if (arch.definition) {
        a.append(el('blockquote', { class: 'dp-def' }, [el('p', { text: arch.definition.text }), el('footer', { text: arch.definition.cite })]));
      }
      arch.body.filter(Boolean).forEach((p) => a.append(el('p', { class: 'dp-para', text: p })));
      this.appendFieldPage(s);
      const fams = arch.familyIds.map((id) => m.famById.get(id)).filter((f) => !!f);
      if (fams.length) {
        a.append(el('h3', { class: 'dp-sub', text: 'Forms it takes' }));
        const row = el('p', { class: 'dp-flow' });
        fams.forEach((f, i) => {
          if (i) row.append(' · ');
          row.append(el('button', { class: 'link-quiet', type: 'button', text: f!.name, onclick: () => this.h.onSubject({ type: 'family', id: f!.id }) }));
        });
        a.append(row);
      }
      // an archetype's ties to other archetypes (the numbers' tie to the Self): named, with whose word the tie is
      const tied = (arch.archetypes ?? []).map((t) => ({ t, arch: m.archById.get(t.id) })).filter((x) => !!x.arch);
      if (tied.length) {
        a.append(el('h3', { class: 'dp-sub', text: 'Tied to' }));
        const row = el('p', { class: 'dp-flow' });
        tied.forEach(({ t, arch: other }, i) => {
          if (i) row.append(' · ');
          row.append(el('button', { class: 'link-quiet', type: 'button', text: other!.name, onclick: () => this.h.onSubject({ type: 'archetype', id: other!.id }) }));
          row.append(el('span', { class: 'dp-basis', text: t.basis === 'jung' ? providerLabels().tieOwnNote : ' (read here)' }));
        });
        a.append(row);
      }
      if (NUMBER_ARCHETYPES.has(s.id)) this.appendNumberPage(s.id);
      this.appendSkyHangs(s);
      this.appendRelated(s);
      this.appendCites(subjectOccurrences(m, s).map((i) => m.occ[i]));
    } else if (s.type === 'family') {
      const fam = m.famById.get(s.id);
      if (!fam) return;
      a.append(el('h2', { class: 'dp-title', text: fam.name }));
      if (fam.oneLine) a.append(el('p', { class: 'dp-lede', text: fam.oneLine }));
      this.appendPlateStrip(s);
      if (fam.image) a.append(plate(fam.image, { credit: true, className: 'dp-figure', palette: fam.palette, eager: true }));
      if (fam.definition) {
        a.append(el('blockquote', { class: 'dp-def' }, [el('p', { text: fam.definition.text }), el('footer', { text: fam.definition.cite })]));
      }
      fam.body.filter(Boolean).forEach((p) => a.append(el('p', { class: 'dp-para', text: p })));
      this.appendSkyHangs(s);
      this.appendFieldPage(s);
      const symbolic = symbolReading(m, fam.id, id => this.h.onSubject({ type: 'family', id }));
      if (symbolic) a.append(symbolic);
      const ties = archetypesOfFamily(m, fam);
      if (ties.length) {
        a.append(el('h3', { class: 'dp-sub', text: 'Archetypal ground' }));
        const row = el('p', { class: 'dp-flow' });
        fam.archetypes.forEach((t, i) => {
          const arch = m.archById.get(t.id);
          if (!arch) return;
          if (i) row.append(' · ');
          row.append(el('button', { class: 'link-quiet', type: 'button', text: arch.name, onclick: () => this.h.onSubject({ type: 'archetype', id: arch.id }) }));
          // Jung's own tie vs. one this site reads in — never present the latter as his word
          row.append(el('span', { class: 'dp-basis', text: t.basis === 'jung' ? providerLabels().tieOwnNote : ' (read here)' }));
        });
        a.append(row);
      }
      this.appendRelated(s);
      this.appendOccurrenceList(subjectOccurrences(m, s));
      this.appendCites(subjectOccurrences(m, s).map((i) => m.occ[i]));
    } else if (s.type === 'theoretic') {
      // a theory node's page: the node's own account, then its full page (quotations placed by the corpus),
      // then the field's evidence for it
      const t = m.theoById.get(s.id);
      if (!t) return;
      a.append(el('h2', { class: 'dp-title', text: t.name }));
      if (t.oneLine) a.append(el('p', { class: 'dp-lede', text: t.oneLine }));
      this.appendPlateStrip(s);
      if (t.image) a.append(plate(t.image, { credit: true, className: 'dp-figure', palette: t.palette, eager: true }));
      if (t.definition) a.append(el('blockquote', { class: 'dp-def' }, [el('p', { text: t.definition.text }), el('footer', { text: t.definition.cite })]));
      t.body.filter(Boolean).forEach((p) => a.append(el('p', { class: 'dp-para', text: p })));
      const host = el('div', { class: 'dp-page' });
      a.append(host);
      loadLensData<{ version: 1; pages: Record<string, TheoryPage> }>('theory-pages').then((d) => {
        const page = d.pages[s.id];
        if (!page) { host.replaceChildren(el('p', { class: 'lp-note', text: 'The field has no page for this concept yet.' })); return; }
        host.replaceChildren(...this.pageNodes(page));
      }).catch(() => host.replaceChildren(el('p', { class: 'lp-note', text: 'The pages are not available in this build.' })));
      this.appendRelated(s);
      this.appendOccurrenceList(subjectOccurrences(m, s));
      this.appendCites(subjectOccurrences(m, s).map((i) => m.occ[i]));
    } else {
      const idx = subjectOccurrences(m, s);
      const name = s.type === 'culture' ? m.cultureById.get(s.id)?.name : m.places.get(s.id)?.name;
      a.append(el('h2', { class: 'dp-title', text: name ?? s.id }));
      this.appendOccurrenceList(idx);
      this.appendCites(idx.map((i) => m.occ[i]));
    }
    this.appendFooter();
  }

  /**
   * Where the subject hangs in the sky: the places its occurrences hold (a card on its ruler's decan wheel, a sign on the
   * zodiac), each a door to that body. Nothing when it hangs nowhere — and nothing said of that.
   */
  private appendSkyHangs(s: Subject): void {
    if (!this.h.onBody) return;
    const seen = new Set<string>();
    const doors: { text: string; body: BodyKey }[] = [];
    for (const h of subjectSky(this.model, s)) {
      for (const { locus } of h.loci) {
        const text = locusPhrase(locus);
        if (seen.has(text)) continue;
        seen.add(text);
        doors.push({ text, body: bodyOfLocus(locus) });
      }
    }
    // an archetype that spans many forms hangs everywhere: a handful of arbitrary places would mislead, so it names none
    if (!doors.length || (s.type === 'archetype' ? doors.length > 6 : false)) return;
    doors.length = Math.min(doors.length, 8);
    const p = el('p', { class: 'dp-sky' }, [el('span', { class: 'dp-sky-lead', text: 'In the sky: ' })]);
    doors.forEach((d, i) => {
      if (i) p.append(' · ');
      p.append(el('button', { class: 'link-quiet', type: 'button', text: d.text, onclick: () => this.h.onBody?.(d.body) }));
    });
    this.article.append(p);
  }

  /** The field-pages data: absent in a build without it, and the rejection is caught here, never shown. */
  private fieldPages(): Promise<FieldPagesData | null> {
    return loadLensData<FieldPagesData>('field-pages').catch(() => null);
  }

  /** A family's or archetype's own page, after its body. A node with no page renders nothing: its host is taken out again. */
  private appendFieldPage(s: Subject): void {
    const host = el('div', { class: 'dp-page' });
    this.article.append(host);
    void this.fieldPages().then((d) => {
      const page = d?.pages[`${s.type}:${s.id}`];
      if (page) host.replaceChildren(...this.pageNodes(page));
      else host.remove();
    });
  }

  /**
   * A node with no image of its own is shown by the plates of the nodes it joins: a strip under its title block, each
   * plate opening that node. Nothing when the node has an image, or fewer than two of its joins have one.
   */
  private appendPlateStrip(s: Subject): void {
    const plates = relatedPlates(this.model, s, 8);
    if (!plates.length) return;
    const strip = el('ul', { class: 'dp-strip', role: 'list' });
    for (const p of plates) {
      strip.append(el('li', {}, [
        el('button', { class: 'dp-strip-item', type: 'button', title: p.name, 'aria-label': p.name, onclick: () => this.h.onSubject(p.other) }, [
          plate(p.image, { thumb: true, className: 'dp-strip-plate', palette: p.palette, alt: p.name }),
          el('span', { class: 'dp-strip-name', text: p.name, 'aria-hidden': 'true' }),
        ]),
      ]));
    }
    this.article.append(strip);
  }

  /**
   * The node's joins, grouped by system (from the model, so at once). Each join's cites fill in under its row when the
   * field-pages data arrives; a join with no cites has no passage to show and gets none.
   */
  private appendRelated(s: Subject): void {
    const groups = relatedRows(this.model, s);
    if (!groups.length) return;
    const pending: { joinId: string; row: HTMLElement }[] = [];
    const box = el('div', { class: 'dp-rel' });
    box.append(el('h3', { class: 'dp-sub', text: 'Related' }));
    for (const g of groups) {
      box.append(el('p', { class: 'dp-rel-sys', text: SYSTEM_LABEL[g.system] ?? g.system }));
      const ul = el('ul', {});
      for (const r of g.rows) {
        // Jung's own tie vs. one this site reads in — the same wording as the archetypal ground above
        const text: (Node | null)[] = [
          el('button', { class: 'link-quiet', type: 'button', text: r.name, onclick: () => this.h.onSubject(r.other) }),
          el('span', { class: 'dp-basis', text: r.basis === 'jung' ? providerLabels().tieOwnNote : ' (read here)' }),
          r.voice ? el('span', { class: 'dp-basis', text: ` · ${r.voice}` }) : null,
          el('p', { class: 'lp-note', text: r.note }),
        ];
        // a far node with a plate of its own shows it, small, to the left of the name; one without keeps the plain row.
        // The name beside it is the keyboard control, so the plate is not a second tab stop and is hidden from readers.
        let row: HTMLElement;
        if (r.image) {
          row = el('div', { class: 'dp-rel-body' }, text);
          ul.append(el('li', { class: 'dp-rel-has-plate' }, [
            el('button', { class: 'dp-rel-plate', type: 'button', tabindex: -1, 'aria-hidden': 'true', onclick: () => this.h.onSubject(r.other) }, [
              plate(r.image, { thumb: true, className: 'dp-rel-img', palette: r.palette, alt: r.name }),
            ]),
            row,
          ]));
        } else {
          row = el('li', {}, text);
          ul.append(row);
        }
        pending.push({ joinId: r.joinId, row });
      }
      box.append(ul);
    }
    this.article.append(box);
    void this.fieldPages().then((d) => {
      for (const { joinId, row } of pending) {
        const cites = d?.joins[joinId];
        if (!cites?.length) continue;
        row.append(el('details', { class: 'as-more' }, [
          el('summary', { text: 'The passage' }),
          ...cites.map((q) => quoteBlock(q, this.h.passage, { compact: true })),
        ]));
      }
    });
  }

  /** A node's page body: the reading line, each section with its quotations, and the subjects it reaches. */
  private pageNodes(page: PageBody): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (page.line) out.push(el('p', { class: 'th-line', text: page.line }));
    for (const s of page.sections) {
      out.push(el('h3', { class: 'as-h3', text: s.title }));
      if (s.line) out.push(el('p', { class: 'th-line', text: s.line }));
      for (const q of s.quotes) out.push(quoteBlock(q, this.h.passage));
    }
    if (page.subjects?.length) {
      const row = el('div', { class: 'th-links' });
      for (const l of page.subjects) {
        const name = subjectName(this.model, l);
        if (name === l.id) continue;
        row.append(el('button', { type: 'button', class: 'th-link', onclick: () => this.h.onSubject(l) }, [el('span', { text: name })]));
      }
      if (row.childElementCount) out.push(row);
    }
    return out;
  }

  /** A number archetype's page (public/data/numbers.json): its position on the wheel, von Franz on it, Jung's own
   * number material in sections, and the egg block — three witnesses to one image, each in its own voice. */
  private appendNumberPage(id: string): void {
    const host = el('div', { class: 'dp-page' });
    this.article.append(host);
    loadLensData<NumbersData>('numbers').then((d) => {
      const p = d.pages[id];
      // seven to ten have no numbers.json page (no QL position): nothing renders, and the field page and Related still do
      if (!p) { host.remove(); return; }
      const out: HTMLElement[] = [
        el('h3', { class: 'as-h3', text: `${p.n} ↔ ${p.position} · ${p.ql.name ?? ''}`.trim() }),
        qlBlock(p.ql),
        qlBlock(p.gloss),
        el('p', { class: 'th-line', text: p.line }),
      ];
      if (p.jung.length) {
        out.push(el('h3', { class: 'as-h3', text: providerLabels().voiceHeading }));
        for (const q of p.jung) out.push(quoteBlock(q, this.h.passage));
      }
      if (p.vonFranz.length) {
        out.push(el('h3', { class: 'as-h3', text: `Von Franz on ${WORD[p.n] ?? String(p.n)}` }));
        for (const q of p.vonFranz) out.push(quoteBlock(q, this.h.passage));
      }
      out.push(...this.pageNodes({ line: '', sections: p.sections, subjects: p.subjects }));
      host.replaceChildren(...out, this.eggBlock(d));
      void this.appendEggFigure(host, d);
    }).catch(() => host.replaceChildren(el('p', { class: 'lp-note', text: 'The pages are not available in this build.' })));
  }

  /**
   * The egg: one image, three witnesses, nothing asserted between them — Pauli's dream with the site's count for it
   * (six stages, the 0/1 frame's start forgone so the shape is visible and never named), Jung's CW9ii ¶345 footnote
   * (the four things in the egg, the punctum solis apart, the square rotated into a circle), and the pentadic mandala
   * of CW9i ¶615, the egg encircled by the snake at the centre.
   */
  private eggBlock(d: NumbersData): HTMLElement {
    const box = el('div', { class: 'dp-egg' });
    box.append(el('h3', { class: 'as-h3', text: 'The egg' }));
    if (d.egg.stages?.labels?.length) {
      const row = el('div', { class: 'ql-stages', role: 'img', 'aria-label': `The count as six stages: ${d.egg.stages.labels.join('; ')}` },
        d.egg.stages.labels.map((s) => el('span', { class: 'ql-stage', text: s })));
      box.append(row, el('blockquote', { class: 'lq lq-ql lq-compact' }, [
        el('footer', {}, [el('span', { class: 'lq-voice ql', text: 'QL' }), el('span', { class: 'lq-cite', text: qlSource(d.egg.stages.source) })]),
      ]));
    }
    box.append(quoteBlock(d.egg.dream, this.h.passage));
    for (const q of d.egg.footnote) box.append(quoteBlock(q, this.h.passage));
    // the drawing stands beside the sentence that describes the motion (§4.1): the square's angular form rotated
    // into a circle. Its host stands here; the figure is painted once the drawing module has loaded.
    box.append(el('div', { class: 'dp-egg-figure' }));
    for (const q of d.egg.mandala) box.append(quoteBlock(q, this.h.passage));
    return box;
  }

  private async appendEggFigure(host: HTMLElement, _d: NumbersData): Promise<void> {
    const figHost = host.querySelector('.dp-egg-figure');
    if (!figHost) return;
    const five = this.model.archById.get('five') ?? this.model.archById.get('four');
    if (!five) return;
    try {
      figHost.append(await stillFigure('construction', five.palette));
    } catch { /* the drawing is optional; the words stand without it */ }
  }

  private appendOccurrenceList(idx: number[]) {
    if (!idx.length) return;
    const m = this.model;
    this.article.append(el('h3', { class: 'dp-sub', text: 'Where and when' }));
    const ul = el('ul', { class: 'dp-occ' });
    for (const i of idx) {
      const o = m.occ[i];
      ul.append(el('li', {}, [
        el('span', { class: 'dp-occ-year', text: eraShort(o.yearDisplay, 26) }),
        el('button', { class: 'link-quiet', type: 'button', text: o.label, onclick: () => this.h.onOccurrence(o.id) }),
      ]));
    }
    this.article.append(ul);
  }

  private appendCites(occs: Occurrence[]) {
    const seen = new Map<string, { c: Cite; n: number }>();
    for (const o of occs) for (const c of o.jung) {
      const k = `${c.work}|${c.year}`;
      const e = seen.get(k);
      if (e) e.n++; else seen.set(k, { c, n: 1 });
    }
    if (!seen.size) return;
    this.article.append(el('h3', { class: 'dp-sub', text: providerLabels().citesHeading }));
    const ul = el('ul', { class: 'dp-cites' });
    [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 14).forEach(({ c }) => {
      ul.append(el('li', {}, [shortWork(c.workTitle), el('span', { class: 'dp-cite-year', text: ` ${c.year}` })]));
    });
    this.article.append(ul);
  }

  // ── an occurrence ─────────────────────────────────────────────────────
  private renderOccurrence(id: string) {
    const m = this.model;
    const i = m.occIndex.get(id);
    if (i === undefined) return;
    const o = m.occ[i];
    const fam = m.famById.get(o.familyId);
    const a = this.article;
    a.append(el('h2', { class: 'dp-title', text: o.title }), el('p', { class: 'dp-lede', text: placeLine(m, o) }));
    const img = occurrenceImage(m, o);
    if (img) {
      a.append(plate(img, { credit: true, className: 'dp-figure', palette: fam?.palette, eager: true, alt: o.title }));
      if (img.sourceUrl) a.append(el('p', { class: 'dp-source' }, [sanitiseTitle(img.title) ? `${sanitiseTitle(img.title)} — ` : '', el('a', { href: img.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: 'source' })]));
    }
    if (o.quote) a.append(o.caption ? el('p', { class: 'dp-caption', text: o.quote }) : el('blockquote', { class: 'dp-def' }, [el('p', { text: o.quote })]));
    o.body.filter(Boolean).forEach((p) => a.append(el('p', { class: 'dp-para', text: p })));
    if (o.jung.length) {
      a.append(el('h3', { class: 'dp-sub', text: providerLabels().citesMeet }));
      const ul = el('ul', { class: 'dp-cites' });
      o.jung.forEach((c) => ul.append(el('li', {}, [this.citeLink(c)])));
      a.append(ul);
    }
    if (fam) {
      a.append(el('h3', { class: 'dp-sub', text: 'Of the form' }));
      a.append(el('p', { class: 'dp-flow' }, [el('button', { class: 'link-quiet', type: 'button', text: fam.name, onclick: () => this.h.onSubject({ type: 'family', id: fam.id }) })]));
    }
    const symbolic = symbolReading(m, o.familyId, id => this.h.onSubject({ type: 'family', id }));
    if (symbolic) a.append(symbolic);
    const par = o.parallelIds.map((p) => m.occIndex.get(p)).filter((x): x is number => x !== undefined);
    if (par.length) {
      a.append(el('h3', { class: 'dp-sub', text: 'Parallels' }));
      const ul = el('ul', { class: 'dp-occ' });
      for (const p of par) {
        const po = m.occ[p];
        ul.append(el('li', {}, [el('span', { class: 'dp-occ-year', text: eraShort(po.yearDisplay, 26) }), el('button', { class: 'link-quiet', type: 'button', text: po.label, onclick: () => this.h.onOccurrence(po.id) })]));
      }
      a.append(ul);
    }
    this.appendFooter();
  }

  /** A cite line; when the corpus holds the work it opens the actual passage. */
  private citeLink(c: Cite): HTMLElement {
    const text = citeLine(c);
    if (!this.h.onCite || !this.h.passage?.known(c.work)) return el('span', { text });
    return el('button', { class: 'link-quiet dp-cite-link', type: 'button', text, title: 'Open the passage in the corpus', 'aria-label': `${text} — open the passage`, onclick: () => this.h.onCite!(c.work, c.locator) });
  }

  private appendFooter() {
    // the corpus is named here by its provider, from the field's data (C2-b8)
    this.article.append(el('p', { class: 'dp-foot', text: `Drawn from ${this.model.field.meta.provider?.name ?? 'the corpus'}` }));
  }
}
