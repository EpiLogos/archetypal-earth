// The shell's one reading surface for panel lenses: a card on the right on a desktop, a bottom sheet with a grab
// handle on a phone (two heights: half and full). The lens owns the body; the shell owns the frame.
import { el, clear, isNarrow } from '../ui/dom';
import { icon } from '../ui/icons';

export type SheetHeight = 'half' | 'full';

export class Panel {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private handle: HTMLButtonElement;
  private height: SheetHeight = 'half';
  private dragY: number | null = null;

  constructor(parent: HTMLElement, private onClose: () => void) {
    this.handle = el('button', { type: 'button', class: 'lp-handle', 'aria-label': 'Expand the panel', onclick: () => this.setHeight(this.height === 'half' ? 'full' : 'half') }, [el('span', { class: 'lp-grip', 'aria-hidden': 'true' })]);
    const close = el('button', { type: 'button', class: 'lp-close icon-btn', 'aria-label': 'Close', onclick: () => this.onClose() }, [icon('close')]);
    this.body = el('div', { class: 'lp-body' });
    this.root = el('section', { class: 'lens-panel', hidden: true, 'aria-live': 'polite' }, [this.handle, close, this.body]);
    parent.append(this.root);
    // a drag on the handle moves the sheet between its two heights (a tap toggles it)
    this.handle.addEventListener('pointerdown', (e) => { this.dragY = e.clientY; });
    window.addEventListener('pointerup', (e) => {
      if (this.dragY === null) return;
      const dy = e.clientY - this.dragY;
      this.dragY = null;
      if (Math.abs(dy) < 24) return;
      if (dy < 0) this.setHeight('full');
      else if (this.height === 'full') this.setHeight('half');
      else this.onClose();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Open with fresh content; `label` names the region for assistive tech. */
  open(label: string, content: Node[], opts: { height?: SheetHeight; wide?: boolean } = {}) {
    clear(this.body);
    this.body.append(...content);
    this.root.setAttribute('aria-label', label);
    this.root.classList.toggle('wide', !!opts.wide);
    this.root.hidden = false;
    this.setHeight(opts.height ?? 'half');
    this.body.scrollTop = 0;
    document.body.classList.add('panel-open');
  }

  /** Replace the body, keeping the frame (and its height) as it stands. */
  replace(content: Node[]) {
    clear(this.body);
    this.body.append(...content);
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    clear(this.body);
    document.body.classList.remove('panel-open', 'panel-full');
  }

  setHeight(h: SheetHeight) {
    this.height = h;
    this.root.dataset.height = h;
    document.body.classList.toggle('panel-full', h === 'full' && isNarrow());
    this.handle.setAttribute('aria-label', h === 'half' ? 'Expand the panel' : 'Shrink the panel');
  }
}
