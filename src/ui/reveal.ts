// MANIFESTATION: the quiet contextual reveal for one occurrence.
import type { Model } from '../data/model';
import { occurrenceImage } from '../data/model';
import { clear, el, plate } from './dom';
import { clipText, jungLine, placeLine } from './format';

export interface RevealHandlers {
  onParallel(occId: string): void;
  onThread(): void;
  onParallelThread(): void;
  onDeep(): void;
  onClose(): void;
}

export class Reveal {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private foot: HTMLElement;
  private shown = false;
  private currentId = '';

  constructor(parent: HTMLElement, private model: Model, private h: RevealHandlers) {
    this.body = el('div', { class: 'rv-body' });
    this.foot = el('nav', { class: 'rv-links', 'aria-label': 'Go further' });
    this.root = el('aside', { class: 'reveal', 'aria-label': 'Selected presence' }, [
      el('button', { class: 'rv-close', type: 'button', 'aria-label': 'Close', onclick: () => h.onClose() }, [closeGlyph()]),
      this.body,
      this.foot,
    ]);
    parent.append(this.root);
  }

  show(occIdx: number) {
    const m = this.model;
    const o = m.occ[occIdx];
    if (o.id === this.currentId && this.shown) return;
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
        render();
        this.root.classList.remove('swap');
      }, 220);
    } else {
      render();
    }
    this.shown = true;
    this.root.classList.add('on');
  }

  hide() {
    this.shown = false;
    this.currentId = '';
    this.root.classList.remove('on', 'swap');
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
