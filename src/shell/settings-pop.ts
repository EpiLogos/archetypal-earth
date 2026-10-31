// THE VIEW'S SETTINGS (H3, H7): the popover the ⚙ opens for what is on screen when that is not the graph (the graph keeps its own
// panel). A lens states what it lets the visitor set (the names a sky is read in; where the sky stands now) and the shell draws it
// here, in the family of the filter panel and the lens menu (one surface, one head with a title and a ✕, labelled groups of rows),
// hung from the ⚙ that opens it (a bottom sheet on a phone). It is a layer of the dismissal stack: Escape and a press outside take it
// down before anything under it.
import { el, clear, isNarrow } from '../ui/dom';
import { panelGrab, panelHead, swipeDownToClose } from './dock';

export class SettingsPopover {
  readonly root: HTMLElement;
  private build: (() => Node[]) | null = null;
  private onChange: () => void;
  private body: HTMLElement;

  constructor(parent: HTMLElement, onChange: () => void = () => {}) {
    this.onChange = onChange;
    this.body = el('div', { class: 'pn-body' });
    const grab = panelGrab();
    const head = panelHead('View settings', () => this.close(true));
    this.root = el('div', { class: 'pn settings-pop', role: 'dialog', 'aria-label': 'View settings', hidden: true }, [grab, head, this.body]);
    swipeDownToClose(this.root, [grab, head], () => this.close(true));
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
    this.place();
    this.root.hidden = false;
    document.body.classList.add('settings-open');
    this.body.querySelector<HTMLElement>('button, select, input')?.focus({ preventScroll: true });
  }

  /** Close it; `focusGear` hands the focus back to the ⚙ (the controller does so itself when Escape closes it). */
  close(focusGear = false) {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('settings-open');
    clear(this.body);
    if (focusGear) document.querySelector<HTMLElement>('.vc-gear')?.focus({ preventScroll: true });
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }

  /** On a desk it hangs from the ⚙, right edges together; a phone's is a sheet the CSS places. */
  private place() {
    const r = this.root;
    r.style.top = r.style.right = '';
    const gear = document.querySelector<HTMLElement>('.vc-gear');
    if (isNarrow() || !gear) return;
    const b = gear.getBoundingClientRect();
    if (!b.width) return;
    r.style.top = `${Math.round(b.bottom + 10)}px`;
    r.style.right = `${Math.max(12, Math.round(window.innerWidth - b.right - 4))}px`;
  }

  private paint() {
    clear(this.body);
    this.body.append(...(this.build?.() ?? []));
  }
}
