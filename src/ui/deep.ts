// DEEP: the optional reading layer — longer body text, the definition, all cites,
// related forms. A wide translucent sheet; the globe stays visible behind it.
import type { Model, Subject } from '../data/model';
import { archetypesOfFamily, occurrenceImage, subjectOccurrences } from '../data/model';
import type { Cite, Occurrence } from '../types/field';
import { clear, el, plate } from './dom';
import { closeGlyph } from './reveal';
import { symbolReading } from './symbol-reading';
import { eraShort, jungLine, placeLine, shortWork } from './format';

export interface DeepHandlers {
  onClose(): void;
  onSubject(s: Subject): void;
  onOccurrence(id: string): void;
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
    if (!(this.open && key === this.key)) {
      this.key = key;
      clear(this.article);
      if (t.kind === 'subject') this.renderSubject(t.subject);
      else this.renderOccurrence(t.occId);
      this.scroller.scrollTop = 0;
    }
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('on'));
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
      if (arch.image) a.append(plate(arch.image, { credit: true, className: 'dp-figure', palette: arch.palette, eager: true }));
      if (arch.definition) {
        a.append(el('blockquote', { class: 'dp-def' }, [el('p', { text: arch.definition.text }), el('footer', { text: arch.definition.cite })]));
      }
      arch.body.filter(Boolean).forEach((p) => a.append(el('p', { class: 'dp-para', text: p })));
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
      this.appendCites(subjectOccurrences(m, s).map((i) => m.occ[i]));
    } else if (s.type === 'family') {
      const fam = m.famById.get(s.id);
      if (!fam) return;
      a.append(el('h2', { class: 'dp-title', text: fam.name }));
      if (fam.oneLine) a.append(el('p', { class: 'dp-lede', text: fam.oneLine }));
      if (fam.image) a.append(plate(fam.image, { credit: true, className: 'dp-figure', palette: fam.palette, eager: true }));
      fam.body.filter(Boolean).forEach((p) => a.append(el('p', { class: 'dp-para', text: p })));
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
          row.append(el('span', { class: 'dp-basis', text: t.basis === 'jung' ? ' (Jung’s tie)' : ' (read here)' }));
        });
        a.append(row);
      }
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
    this.article.append(el('h3', { class: 'dp-sub', text: 'Jung’s texts' }));
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
      if (img.sourceUrl) a.append(el('p', { class: 'dp-source' }, [img.title ? `${img.title} — ` : '', el('a', { href: img.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: 'source' })]));
    }
    if (o.quote) a.append(el('blockquote', { class: 'dp-def' }, [el('p', { text: o.quote })]));
    o.body.filter(Boolean).forEach((p) => a.append(el('p', { class: 'dp-para', text: p })));
    if (o.jung.length) {
      a.append(el('h3', { class: 'dp-sub', text: 'Where Jung meets it' }));
      const ul = el('ul', { class: 'dp-cites' });
      o.jung.forEach((c) => ul.append(el('li', { text: jungLine(c) })));
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

  private appendFooter() {
    const meta = this.model.field.meta;
    const line = meta.vaultLedgerLine ? `Drawn from the Jung archetypal-field vault · ${meta.vaultLedgerLine}` : 'Drawn from the Jung archetypal-field vault';
    this.article.append(el('p', { class: 'dp-foot', text: line }));
  }
}
