// THE VIEW'S SETTINGS (H3, H7): the popover the ⚙ opens for what is on screen when that is not the graph (the graph keeps its own
// panel). A lens states what it lets the visitor set (the names a sky is read in; where the sky stands now) and the shell draws it
// here, in the shell menu's family: labelled groups of rows, anchored under the View control (a bottom sheet on a phone). It is a
// popover of the dismissal stack: Escape and a press outside take it down before anything under it.
import { el, clear } from '../ui/dom';

export class SettingsPopover {
  readonly root: HTMLElement;
  private build: (() => Node[]) | null = null;
  private onChange: () => void;

  constructor(parent: HTMLElement, onChange: () => void = () => {}) {
    this.onChange = onChange;
    this.root = el('div', { class: 'settings-pop', role: 'dialog', 'aria-label': 'View settings', hidden: true });
    parent.append(this.root);
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !this.root.contains(e.target as Node) && !(e.target as Element).closest?.('.vc-gear')) this.close();
    }, true);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Whether anything answers the ⚙ now. */
  get available(): boolean {
    return !!this.build;
  }

  /** What the standing lens lets the visitor set; null takes it away (and closes the popover). */
  set(build: (() => Node[]) | null) {
    this.build = build;
    if (!build) this.close();
    else if (this.isOpen) this.paint();
    this.onChange();
  }

  /** Draw the rows again (the lens's choices changed under an open popover). */
  refresh() {
    if (this.isOpen) this.paint();
  }

  open() {
    if (!this.build) return;
    this.paint();
    this.root.hidden = false;
    document.body.classList.add('settings-open');
    this.root.querySelector<HTMLElement>('button, select, input')?.focus({ preventScroll: true });
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('settings-open');
    clear(this.root);
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }

  private paint() {
    clear(this.root);
    this.root.append(el('div', { class: 'mode-opt-grab', 'aria-hidden': 'true' }), ...(this.build?.() ?? []));
  }
}
