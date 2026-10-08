import { el } from './dom';

/** One quiet line near the cursor: name + era. */
export class HoverLabel {
  readonly root: HTMLElement;
  private name = el('span', { class: 'hl-name' });
  private era = el('span', { class: 'hl-era' });
  private w = 0;
  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'hover-label', 'aria-hidden': 'true' }, [this.name, this.era]);
    parent.append(this.root);
  }

  show(key: string, name: string, era: string, x: number, y: number) {
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.name.textContent = name;
      this.era.textContent = era;
      this.w = 0;
    }
    if (!this.w) this.w = this.root.offsetWidth || 160;
    const px = Math.min(Math.max(12, x + 16), window.innerWidth - this.w - 12);
    const py = Math.max(12, y - 34);
    this.root.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    this.root.classList.add('on');
  }

  hide() {
    this.lastKey = '';
    this.root.classList.remove('on');
  }
}
