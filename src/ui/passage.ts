// PASSAGE: the corpus reading sheet — a cited passage opened at its source in
// the vault's corpus. Quiet, textual, deeper layer only: it exists because a
// cite was followed, never as a browsing surface. An unresolvable cite is no
// link at all; the sheet never invents a passage.
import type { CorpusIndex } from '../types/corpus';
import { neighbourPara, resolvePassage, type PassageRef } from '../data/corpus';
import { clear, el } from './dom';
import { closeGlyph } from './reveal';

/** What the cite-rendering surfaces use to offer (only) real deep links. */
export interface PassageBridge {
  known(work: string): boolean;
  open(work: string, locator: string): void;
}

export class PassageSheet {
  readonly root: HTMLElement;
  private article: HTMLElement;
  private openState = false;
  private ref: PassageRef | null = null;
  private hideTimer = 0;

  constructor(parent: HTMLElement, private index: CorpusIndex | null) {
    this.article = el('article', { class: 'dp-article ps-article' });
    const scroller = el('div', { class: 'dp-scroll', tabindex: 0 }, [this.article]);
    this.root = el('section', { class: 'deep passage', role: 'dialog', 'aria-label': 'Source passage', 'aria-modal': 'false', hidden: true }, [
      el('button', { class: 'dp-close', type: 'button', 'aria-label': 'Close passage', onclick: () => this.hide() }, [closeGlyph()]),
      scroller,
    ]);
    parent.append(this.root);
  }

  get isOpen() {
    return this.openState;
  }

  /** The quiet bridge handed to cite renderers: a cite is a link only when its work is in the corpus. */
  bridge(): PassageBridge {
    const knownWorks = new Set(this.index?.works.map((w) => w.work) ?? []);
    return {
      known: (work) => knownWorks.has(work),
      open: (work, locator) => void this.show(work, locator),
    };
  }

  async show(work: string, locator: string) {
    const ref = await resolvePassage(this.index, work, locator);
    if (!ref) return;
    this.ref = ref;
    this.render();
    window.clearTimeout(this.hideTimer);
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('on'));
    this.openState = true;
  }

  hide() {
    if (!this.openState) return;
    this.openState = false;
    this.ref = null;
    this.root.classList.remove('on');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => { if (!this.openState) this.root.hidden = true; }, 420);
  }

  private render() {
    const ref = this.ref!;
    clear(this.article);
    const where = [ref.title, ref.chapter?.title, `pdf p${ref.page}${ref.print ? ` · print p${ref.print}` : ''}`].filter(Boolean).join(' · ');
    this.article.append(el('p', { class: 'ps-where', text: where }));
    if (ref.para !== undefined) {
      this.article.append(el('p', { class: 'ps-mark', text: `¶${ref.para}` }));
      this.article.append(el('p', { class: 'ps-text', text: ref.text.replace(/^\*\*¶\d+\*\*\s*/, '') }));
    } else {
      this.article.append(el('p', { class: 'ps-text', text: ref.text }));
    }
    if (ref.para !== undefined && ref.text !== ref.pageText) {
      this.article.append(el('details', { class: 'ps-page' }, [
        el('summary', { text: `The whole page — pdf p${ref.page}` }),
        el('p', { class: 'ps-text ps-page-text', text: ref.pageText }),
      ]));
    }
    if (ref.para !== undefined) {
      const nav = el('div', { class: 'ps-nav' },
        [el('button', { type: 'button', class: 'link-quiet', text: '← previous ¶', onclick: () => void this.step(-1) }),
         el('button', { type: 'button', class: 'link-quiet', text: 'next ¶ →', onclick: () => void this.step(1) })]);
      this.article.append(nav);
    }
    this.article.append(el('p', { class: 'dp-foot', text: 'Read from the vault corpus · machine-anchored, page-true' }));
    (this.root.querySelector('.dp-scroll') as HTMLElement).scrollTop = 0;
  }

  private async step(delta: number) {
    if (!this.ref || this.ref.para === undefined) return;
    const next = await neighbourPara(this.ref.work, this.ref.index, delta);
    if (!next) return;
    this.ref = next;
    this.render();
  }
}
