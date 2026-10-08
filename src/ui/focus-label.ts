// The minimal focus label: a name, one line, and (only in focus) two quiet links.
import { clear, el } from './dom';

export interface LabelContent {
  name: string;
  line?: string;
  /** the way out, one level at a time (the drilled route, then the whole field); rendered above the name */
  up?: { text: string; onClick: () => void }[];
  /** small serif-italic row of related names that can be followed (e.g. a form's archetypes) */
  ties?: { text: string; onClick: () => void }[];
  tiesPrefix?: string;
  links?: { text: string; onClick: () => void }[];
  /** when set the label is a breadcrumb: click returns up one level */
  back?: () => void;
}

export class FocusLabel {
  readonly root: HTMLElement;
  private shown = false;
  private key = '';
  private gen = 0;

  constructor(parent: HTMLElement) {
    this.root = el('header', { class: 'focus-label', 'aria-live': 'polite', 'aria-hidden': 'true' });
    this.root.inert = true;
    parent.append(this.root);
  }

  set(content: LabelContent | null, key = '') {
    const gen = ++this.gen;
    if (!content) {
      this.root.classList.remove('on');
      this.root.inert = true;
      this.root.setAttribute('aria-hidden', 'true');
      this.shown = false;
      this.key = '';
      return;
    }
    const swap = () => {
      clear(this.root);
      this.root.inert = false;
      this.root.setAttribute('aria-hidden', 'false');
      this.root.classList.toggle('is-back', !!content.back);
      const name = content.back
        ? el('button', { class: 'fl-name fl-backlink', type: 'button', 'aria-label': `Back to ${content.name}`, onclick: content.back }, [el('span', { class: 'fl-chev', 'aria-hidden': 'true', text: '‹' }), content.name])
        : el('h1', { class: 'fl-name', text: content.name });
      this.root.append(name);
      if (content.up?.length) {
        const up = el('nav', { class: 'fl-up', 'aria-label': 'Where you came from' });
        content.up.forEach((c, i) => {
          if (i) up.append(' · ');
          up.append(el('button', { class: 'link-quiet', type: 'button', text: `‹ ${c.text}`, onclick: c.onClick }));
        });
        this.root.prepend(up);
      }
      if (content.line) this.root.append(el('p', { class: 'fl-line', text: content.line }));
      if (content.ties?.length) {
        const row = el('p', { class: 'fl-ties' });
        if (content.tiesPrefix) row.append(el('span', { text: content.tiesPrefix + ' ' }));
        content.ties.forEach((t, i) => {
          if (i) row.append(' · ');
          row.append(el('button', { class: 'link-quiet', type: 'button', text: t.text, onclick: t.onClick }));
        });
        this.root.append(row);
      }
      if (content.links?.length) {
        const nav = el('nav', { class: 'fl-links', 'aria-label': 'Go further' });
        content.links.forEach((l) => nav.append(el('button', { class: 'link-quiet', type: 'button', text: l.text, onclick: l.onClick })));
        this.root.append(nav);
      }
    };
    if (this.shown && key !== this.key) {
      this.root.classList.remove('on');
      this.root.inert = true;
      this.root.setAttribute('aria-hidden', 'true');
      window.setTimeout(() => {
        if (gen !== this.gen) return;
        swap();
        this.root.classList.add('on');
      }, 240);
    } else {
      swap();
      requestAnimationFrame(() => {
        if (gen === this.gen) this.root.classList.add('on');
      });
    }
    this.shown = true;
    this.key = key;
  }
}
