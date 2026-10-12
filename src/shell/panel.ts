// The shell's one reading surface for panel lenses: a card on the right on a desktop, a bottom sheet with a grab
// handle on a phone (two heights: half and full). The lens owns the body; the shell owns the frame.
//
// Visibility (rules table in panel-state.ts): a lens builds its content with open/replace as it always did, and that
// never shows or hides the sheet. The sheet is shown only once the person has asked for it (reveal(), from the Options'
// standard first action). Dismissing it (X, Escape, the drag-down) calls onClose, which hides it and keeps the content:
// the controller decides what dismiss means for a lens (it never leaves the mode, except Astrology's own sky step).
// A click inside a visible sheet that changes its content keeps it visible; navigation while it is hidden keeps it hidden.
// close() is the lens leaving: nothing loaded, hidden, so the next entry starts hidden again.
import { el, clear, isNarrow } from '../ui/dom';
import { icon } from '../ui/icons';
import { isVisible, onContent, onLensEnter, onLensLeave, onReveal, onUserClose, PANEL_CLOSED, type PanelState } from './panel-state';

export type SheetHeight = 'half' | 'full';

export class Panel {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  /** Walk rail / sticky chrome under the scroll body (Theory next/prev, etc.). */
  readonly foot: HTMLElement;
  private handle: HTMLButtonElement;
  private height: SheetHeight = 'half';
  private dragY: number | null = null;
  private state: PanelState = PANEL_CLOSED;
  private listeners = new Set<() => void>();

  constructor(parent: HTMLElement, private onClose: () => void) {
    this.handle = el('button', { type: 'button', class: 'lp-handle', 'aria-label': 'Expand the panel', onclick: () => this.setHeight(this.height === 'half' ? 'full' : 'half') }, [el('span', { class: 'lp-grip', 'aria-hidden': 'true' })]);
    const close = el('button', { type: 'button', class: 'lp-close icon-btn', 'aria-label': 'Close', onclick: () => this.onClose() }, [icon('close')]);
    this.body = el('div', { class: 'lp-body' });
    this.foot = el('div', { class: 'lp-foot', hidden: true });
    this.root = el('section', { class: 'lens-panel', hidden: true, 'aria-live': 'polite' }, [this.handle, close, this.body, this.foot]);
    parent.append(this.root);
    // a drag on the handle moves the sheet between its two heights (a tap toggles it); a drag down dismisses it
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
    this.paint();
  }

  /** Has a lens loaded content into the sheet (shown or not). */
  get isOpen(): boolean {
    return this.state.loaded;
  }

  /** Is the sheet on screen now. */
  get isVisible(): boolean {
    return isVisible(this.state);
  }

  /** Has the person asked for the sheet (it may still be empty). The Options' action reads this. */
  get isRevealed(): boolean {
    return this.state.revealed;
  }

  /** Called after every change of the sheet's state, so the Options' action and the globe's shift can follow it. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** A lens was entered: its sheet starts hidden, whatever the lens before it left. */
  enterLens() {
    this.apply(onLensEnter(this.state));
  }

  /** The person asked for the sheet (the Options' Open action). Shown as soon as there is content. */
  reveal() {
    this.apply(onReveal(this.state));
  }

  /** The person dismissed the sheet. Hidden; the content is kept for the next reveal. */
  hide() {
    this.apply(onUserClose(this.state));
  }

  /** Load fresh content into the sheet; `label` names the region for assistive tech. Does not show the sheet. */
  open(label: string, content: Node[], opts: { height?: SheetHeight; wide?: boolean; foot?: Node[] | null } = {}) {
    clear(this.body);
    this.body.append(...content);
    this.setFoot(opts.foot ?? null);
    this.root.setAttribute('aria-label', label);
    this.root.classList.toggle('wide', !!opts.wide);
    this.height = opts.height ?? 'half';
    this.body.scrollTop = 0;
    this.apply(onContent(this.state));
  }

  /** Replace the body, keeping the frame (and its height) as it stands. */
  replace(content: Node[], opts: { keepScroll?: boolean; foot?: Node[] | null } = {}) {
    clear(this.body);
    this.body.append(...content);
    if (opts.foot !== undefined) this.setFoot(opts.foot);
    if (!opts.keepScroll) this.body.scrollTop = 0;
  }

  /** Pin chrome under the scroll body (walk rail). Null clears it. */
  setFoot(nodes: Node[] | null) {
    clear(this.foot);
    if (!nodes?.length) { this.foot.hidden = true; return; }
    this.foot.append(...nodes);
    this.foot.hidden = false;
  }

  /** The lens left: content and foot cleared, the sheet hidden. The next open starts hidden. */
  close() {
    if (!this.state.loaded && !this.state.revealed) return;
    clear(this.body);
    this.setFoot(null);
    this.apply(onLensLeave(this.state));
  }

  setHeight(h: SheetHeight) {
    this.height = h;
    this.paint();
  }

  private apply(next: PanelState) {
    this.state = next;
    this.paint();
    for (const fn of [...this.listeners]) fn();
  }

  /** The frame follows the state: hidden root, the body classes the rest of the page keys off. */
  private paint() {
    const on = isVisible(this.state);
    this.root.hidden = !on;
    this.root.dataset.height = this.height;
    document.body.classList.toggle('panel-open', on);
    document.body.classList.toggle('panel-full', on && this.height === 'full' && isNarrow());
    this.handle.setAttribute('aria-label', this.height === 'half' ? 'Expand the panel' : 'Shrink the panel');
  }
}
