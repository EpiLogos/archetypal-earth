// MANIFESTATION: the quiet contextual reveal for one occurrence.
import type { Model } from '../data/model';
import { occurrenceImage } from '../data/model';
import { symbolReading } from './symbol-reading';
import { clear, el, plate } from './dom';
import { clipText, jungLine, placeLine } from './format';
import { glyphOf, type SkyTies } from '../sky/ties';
import type { BodyKey } from '../types/sky';

export interface RevealHandlers {
  onParallel(occId: string): void;
  onThread(): void;
  onParallelThread(): void;
  onDeep(): void;
  onClose(): void;
  onFamily(id: string): void;
  /** open a body of the sky (the family has a standing tie to it) */
  onBody?(key: BodyKey): void;
}

export class Reveal {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private foot: HTMLElement;
  private shown = false;
  private currentId = '';
  private gen = 0;

  constructor(parent: HTMLElement, private model: Model, private h: RevealHandlers, private skyTies?: SkyTies) {
    this.body = el('div', { class: 'rv-body' });
    this.foot = el('nav', { class: 'rv-links', 'aria-label': 'Go further' });
    this.root = el('aside', { class: 'reveal', 'aria-label': 'Selected presence', 'aria-hidden': 'true' }, [
      el('button', { class: 'rv-close', type: 'button', 'aria-label': 'Close', onclick: () => h.onClose() }, [closeGlyph()]),
      this.body,
      this.foot,
    ]);
    this.root.inert = true;
    parent.append(this.root);
  }

  show(occIdx: number) {
    const m = this.model;
    const o = m.occ[occIdx];
    if (o.id === this.currentId && this.shown) return;
    const gen = ++this.gen;
    const render = () => {
      this.currentId = o.id;
      clear(this.body);
      this.body.scrollTop = 0;
      const fam = m.famById.get(o.familyId);
      const img = occurrenceImage(m, o);
      this.body.append(plate(img, { credit: true, className: 'rv-hero', palette: fam?.palette, eager: true, alt: o.title }));
      const text = el('div', { class: 'rv-text' });
      text.append(el('h2', { class: 'rv-name', text: o.label }));
      text.append(el('p', { class: 'rv-line', text: placeLine(m, o) }));
      if (o.quote) text.append(el('blockquote', { class: 'rv-quote', text: o.quote }));
      // a quote takes the place of a second paragraph: the reveal stays short
      const paras = o.body.filter(Boolean).slice(0, o.quote ? 1 : 2);
      paras.forEach((p) => text.append(el('p', { class: 'rv-para', text: clipText(p, o.quote ? 260 : 220) })));
      if (o.jung.length) {
        const j = o.jung[0];
        text.append(el('p', { class: 'rv-jung' }, [el('span', { class: 'rv-jung-mark', 'aria-hidden': 'true', text: '◦' }), jungLine(j)]));
      }
      const symbolic = symbolReading(m, o.familyId, id => this.h.onFamily(id), true);
      if (symbolic) text.append(symbolic);
      const tie = this.skyRow(o.familyId, gen);
      if (tie) text.append(tie);
      const par = o.parallelIds.map((id) => m.occIndex.get(id)).filter((i): i is number => i !== undefined && !!m.located[i]).slice(0, 4);
      if (par.length) {
        const row = el('div', { class: 'rv-parallels', role: 'list', 'aria-label': 'Parallels' });
        for (const i of par) {
          const po = m.occ[i];
          const pf = m.famById.get(po.familyId);
          const btn = el('button', { class: 'rv-par', type: 'button', role: 'listitem', title: `${po.label} · ${po.yearDisplay}`, onclick: () => this.h.onParallel(po.id) }, [
            plate(occurrenceImage(m, po), { thumb: true, className: 'rv-par-plate', palette: pf?.palette, alt: '' }),
            el('span', { class: 'rv-par-label', text: po.label }),
          ]);
          row.append(btn);
        }
        text.append(row);
      }
      clear(this.foot);
      this.foot.append(el('button', { class: 'link-quiet', type: 'button', text: 'Follow the thread', onclick: () => this.h.onThread() }));
      if (par.length) this.foot.append(el('button', { class: 'link-quiet', type: 'button', text: 'Trace the parallels', onclick: () => this.h.onParallelThread() }));
      this.foot.append(el('button', { class: 'link-quiet', type: 'button', text: 'Reading', onclick: () => this.h.onDeep() }));
      this.body.append(text);
    };
    if (this.shown && this.currentId !== o.id) {
      // swap content with a quiet cross-fade rather than re-mounting the panel
      this.root.classList.add('swap');
      window.setTimeout(() => {
        if (gen !== this.gen) return;
        render();
        this.root.classList.remove('swap');
      }, 220);
    } else {
      render();
    }
    this.shown = true;
    this.root.inert = false;
    this.root.setAttribute('aria-hidden', 'false');
    this.root.classList.add('on');
  }

  /** A quiet line when the family stands in a tie with a body of the sky. The index loads once, after the card is up. */
  private skyRow(familyId: string, gen: number): HTMLElement | null {
    const src = this.skyTies;
    if (!src || !this.h.onBody) return null;
    const fill = (row: HTMLElement) => {
      const ties = src.forFamily(familyId);
      clear(row);
      row.hidden = ties.length === 0;
      if (!ties.length) return;
      row.append(el('span', { class: 'rv-sky-mark', 'aria-hidden': 'true', text: '◦' }), 'In the sky: ');
      ties.forEach((t, i) => {
        if (i) row.append(' · ');
        row.append(el('button', { class: 'link-quiet rv-sky-body', type: 'button', title: `${t.name} — tie basis: ${t.basis}`, onclick: () => this.h.onBody?.(t.body) }, [el('span', { class: 'rv-sky-glyph', 'aria-hidden': 'true', text: glyphOf(t.body) }), ` ${t.name}`]));
      });
    };
    const row = el('p', { class: 'rv-sky' });
    row.hidden = true;
    if (src.loaded) fill(row);
    else void src.ensure().then(() => { if (gen === this.gen) fill(row); });
    return row;
  }

  hide() {
    ++this.gen;
    this.shown = false;
    this.currentId = '';
    this.root.classList.remove('on', 'swap');
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
  }
}

function closeGlyph(): SVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 12 12');
  s.setAttribute('width', '10');
  s.setAttribute('height', '10');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M2 2l8 8M10 2l-8 8');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.2');
  p.setAttribute('fill', 'none');
  s.append(p);
  return s;
}

export { closeGlyph };
