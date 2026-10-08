// ⌘K / "/" : a centred minimal field over a dimmed globe. Choosing a result
// closes the field and moves the globe — it never opens a page.
import { search, type SearchIndex, type SearchResult } from '../data/search';
import { clear, el, plate } from './dom';

export class SearchUI {
  readonly root: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private results: SearchResult[] = [];
  private active = 0;
  private opener: HTMLElement | null = null;
  isOpen = false;

  constructor(parent: HTMLElement, private index: SearchIndex, private onChoose: (r: SearchResult) => void, private onToggle: (open: boolean) => void) {
    this.input = el('input', {
      class: 's-input', type: 'text', placeholder: 'Search the field', autocomplete: 'off', spellcheck: 'false',
      role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 's-list', 'aria-autocomplete': 'list', 'aria-label': 'Search archetypes, forms, places, cultures, periods',
    }) as HTMLInputElement;
    this.list = el('ul', { class: 's-list', id: 's-list', role: 'listbox' });
    const box = el('div', { class: 's-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' }, [
      this.input,
      this.list,
      el('div', { class: 's-hint', 'aria-hidden': 'true', text: 'enter to go · esc to close' }),
      el('p', { class: 's-credit' }, [
        'Imagery: ',
        el('a', { href: 'https://visibleearth.nasa.gov/images/73751', target: '_blank', rel: 'noopener', text: 'NASA Blue Marble' }),
        ' · ',
        el('a', { href: 'https://earthdata.nasa.gov/gibs', target: '_blank', rel: 'noopener', text: 'NASA GIBS' }),
        ' — public domain',
      ]),
    ]);
    this.root = el('div', { class: 'search', hidden: true }, [box]);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    parent.append(this.root);
  }

  open(opener?: HTMLElement | null) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.opener = opener ?? (document.activeElement as HTMLElement | null);
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('open'));
    this.input.value = '';
    this.refresh();
    this.input.focus();
    this.onToggle(true);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    window.setTimeout(() => { if (!this.isOpen) this.root.hidden = true; }, 260);
    this.onToggle(false);
    this.opener?.focus?.();
  }

  private refresh() {
    this.results = search(this.index, this.input.value, 7);
    this.active = 0;
    this.renderList();
  }

  private renderList() {
    clear(this.list);
    if (!this.results.length) {
      if (this.input.value.trim()) this.list.append(el('li', { class: 's-empty', text: 'Nothing resonates yet' }));
      return;
    }
    this.results.forEach((r, i) => {
      const chip = plate(r.image, { thumb: true, className: 's-chip', palette: r.tone ? { core: r.tone, glow: r.tone, fog: '#0d1330', deep: '#02030a' } : undefined });
      if (!r.image) {
        chip.classList.add(`kind-${r.kind}`);
      }
      const li = el('li', { class: 's-row' + (i === this.active ? ' active' : ''), role: 'option', id: `s-opt-${i}`, 'aria-selected': i === this.active ? 'true' : 'false' }, [
        chip,
        el('span', { class: 's-label', text: r.label }),
        el('span', { class: 's-sub', text: r.sub }),
      ]);
      li.addEventListener('pointerenter', () => this.setActive(i, false));
      li.addEventListener('click', () => this.choose(i));
      this.list.append(li);
    });
    this.input.setAttribute('aria-activedescendant', `s-opt-${this.active}`);
  }

  private setActive(i: number, scroll = true) {
    if (i === this.active) return;
    this.active = i;
    [...this.list.children].forEach((c, k) => {
      c.classList.toggle('active', k === i);
      c.setAttribute('aria-selected', k === i ? 'true' : 'false');
    });
    this.input.setAttribute('aria-activedescendant', `s-opt-${i}`);
    if (scroll) (this.list.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }

  private choose(i: number) {
    const r = this.results[i];
    if (!r) return;
    this.close();
    this.onChoose(r);
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { this.setActive((this.active + 1) % Math.max(1, this.results.length)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { this.setActive((this.active - 1 + this.results.length) % Math.max(1, this.results.length)); e.preventDefault(); }
    else if (e.key === 'Enter') { this.choose(this.active); e.preventDefault(); }
    else if (e.key === 'Escape') { this.close(); e.preventDefault(); e.stopPropagation(); }
  }
}
