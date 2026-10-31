// The shell: the one frame that owns all chrome (ProjectCentral/docs/MODES-RFC.md §2). One title, one menu, one slot for a lens's
// own controls, the filter, the corners. Lenses render content; they never draw a heading or a switch of their own.
import { el, clear, isNarrow } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { BUILT, LENSES, lensDef, type LensDef, type LensId } from './lens';
import type { FieldFilter } from './filter';
import { SliceDock, panelGrab, panelHead, swipeDownToClose, type DockHooks, type FilterScope } from './dock';
import type { ScopeState } from './scope-chip';

export type { FilterScope } from './dock';

export const REPO_URL = 'https://github.com/EpiLogos/archetypal-earth';
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
const SITE = 'An Archetypal Earth';

export interface ShellHooks extends DockHooks {
  onLens(id: LensId): void;
  onSearch(anchor?: HTMLElement): void;
}

export class Shell {
  readonly root: HTMLElement;
  private lensBtn: HTMLButtonElement;
  private lensIcon: HTMLElement;
  private lensName: HTMLElement;
  private aside: HTMLElement;
  private corner: HTMLElement;
  private title: HTMLElement;
  private controls: HTMLElement;
  private contentsBtn: HTMLButtonElement;
  private contentsAct: (() => void) | null = null;
  private menu: HTMLElement;
  private menuBody: HTMLElement;
  private head: HTMLElement;
  private menuScrim: HTMLElement;
  private lens: LensId = 'field';
  /** the slice dock: the scope and filter chips over the time strip (src/shell/dock.ts) */
  readonly dock: SliceDock;
  private context = '';

  constructor(parent: HTMLElement, private hooks: ShellHooks) {
    this.lensIcon = el('span', { class: 'sh-lens-ico' });
    this.lensName = el('span', { class: 'sh-lens-name' });
    this.lensBtn = el('button', {
      type: 'button', class: 'sh-lens', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'shell-menu',
      onclick: () => this.toggleMenu(),
    }, [this.lensIcon, this.lensName, el('span', { class: 'sh-chev' }, [icon('chevron', 14)])]);
    this.aside = el('div', { class: 'sh-aside' });
    this.title = el('h1', { class: 'sh-title' });
    this.controls = el('div', { class: 'sh-controls' });
    // the lens's Contents trigger: one button in the lens's own place, first in its controls; the lens states what it lists
    this.contentsBtn = el('button', { type: 'button', class: 'sh-contents', 'aria-label': 'Contents', 'aria-pressed': 'false', hidden: true, onclick: () => this.contentsAct?.() }, [icon('list', 15), el('span', { text: 'Contents' })]) as HTMLButtonElement;
    this.controls.append(this.contentsBtn);
    this.controls.hidden = true;
    // lens → title → Options (icon); Options must not sit above the title
    this.head = el('div', { class: 'sh-head' }, [this.lensBtn, this.aside]);
    this.root = el('header', { class: 'shell' }, [this.head, this.title, this.controls]);

    const github = el('a', { class: 'sh-corner-btn icon-btn', href: REPO_URL, target: '_blank', rel: 'noopener', 'aria-label': 'The project on GitHub', title: 'GitHub' }, [icon('github', 17)]);
    const search = document.getElementById('search-btn');
    const corner = el('div', { class: 'sh-corner' });
    this.corner = corner;
    if (search) {
      search.classList.add('sh-corner-btn', 'icon-btn');
      search.addEventListener('click', (e) => this.hooks.onSearch(e.currentTarget as HTMLElement));
      corner.append(search);
    }
    corner.append(github);

    this.menuScrim = el('div', { class: 'sm-scrim', hidden: true, onclick: () => this.closeMenu() });
    this.menuBody = el('div', { class: 'pn-body' });
    const menuGrab = panelGrab();
    const menuHead = panelHead('Lenses', () => this.closeMenu());
    this.menu = el('div', { class: 'pn shell-menu', id: 'shell-menu', role: 'dialog', 'aria-label': 'Lenses', hidden: true }, [menuGrab, menuHead, this.menuBody]);
    swipeDownToClose(this.menu, [menuGrab, menuHead], () => this.closeMenu());
    this.dock = new SliceDock(parent, hooks);
    // the filter's button stands in the cluster with the lens and the view controls, in the same row, never over the globe
    this.head.append(this.dock.button);

    parent.append(this.root, corner, this.menuScrim, this.menu);
    this.buildMenu();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.menu.hidden) { e.stopImmediatePropagation(); e.preventDefault(); this.closeMenu(); }
    }, true);
    this.setLens('field');
  }

  get menuOpen(): boolean {
    return !this.menu.hidden;
  }

  /** The active lens: the title button's icon and name, the menu's current row. */
  setLens(id: LensId) {
    this.lens = id;
    const def = lensDef(id);
    clear(this.lensIcon);
    this.lensIcon.append(icon(def.icon, 17));
    this.lensName.textContent = def.label;
    this.lensBtn.setAttribute('aria-label', `${def.label} — choose a lens`);
    document.body.dataset.lens = id;
    for (const row of this.menu.querySelectorAll<HTMLElement>('[data-lens]')) {
      const on = row.dataset.lens === id;
      row.classList.toggle('on', on);
      if (on) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
    }
    this.syncDocTitle();
  }

  /** The one line under the lens: the reading, the folio, the subject. Empty hides it. */
  setContext(text: string, quiet = false) {
    this.context = text;
    // a quiet context names the page's tab and history entry only: what is read in the pane already carries its own name
    this.title.textContent = quiet ? '' : text;
    this.title.hidden = !text || quiet;
    this.syncDocTitle();
  }

  /** What the globe shows in this mode: its own set, the rest of the field set back. The slice dock carries it as a chip. */
  setScope(scope: ScopeState | null, wholeField: boolean, onWhole: (on: boolean) => void) {
    this.dock.setScope(scope, wholeField, onWhole);
  }

  /** The Contents trigger of the lens that stands: shown while the lens lists something, pressed while its list is open. Null takes it away. */
  setContents(onToggle: (() => void) | null) {
    this.contentsAct = onToggle;
    this.contentsBtn.hidden = !onToggle;
    if (!onToggle) this.contentsBtn.setAttribute('aria-pressed', 'false');
    this.controls.hidden = this.contentsBtn.hidden;
  }

  /** The pane's Contents list opened or closed: the trigger follows. */
  syncContents(open: boolean) {
    this.contentsBtn.setAttribute('aria-pressed', String(open));
  }

  /** Something that sits beside the lens button (the Field's Earth ⇄ Graph pill). */
  /** A tool at the corner's near end (before the search): the View control's ⚙ stands here. */
  setCornerTool(node: Node) {
    this.corner.prepend(node);
  }

  setAside(node: Node | null) {
    clear(this.aside);
    if (node) this.aside.append(node);
  }

  setFilter(f: FieldFilter) {
    this.dock.setFilter(f);
  }

  /** The filter follows the lens: only the dimensions that vary inside its slice are offered. */
  setFilterScope(scope: FilterScope) {
    this.dock.setFilterScope(scope);
  }

  /** Whether the filter popover stands open (a layer of the dismissal stack). */
  get filterOpen(): boolean {
    return this.dock.filterOpen;
  }

  closeFilter() {
    this.dock.closeFilter();
  }

  openMenu() {
    if (!this.menu.hidden) return;
    this.dock.closeFilter();
    this.menu.hidden = false;
    this.menuScrim.hidden = false;
    this.menu.classList.toggle('sheet', isNarrow());
    this.lensBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-open');
    (this.menu.querySelector<HTMLElement>('.sm-row.on') ?? this.menu.querySelector<HTMLElement>('.sm-row'))?.focus();
  }

  closeMenu() {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.menuScrim.hidden = true;
    this.lensBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
    this.lensBtn.focus({ preventScroll: true });
  }

  toggleMenu() {
    if (this.menu.hidden) this.openMenu(); else this.closeMenu();
  }

  private syncDocTitle() {
    const lens = lensDef(this.lens).label;
    document.title = this.context ? `${this.context} — ${lens} — ${SITE}` : this.lens === 'field' ? SITE : `${lens} — ${SITE}`;
  }

  private buildMenu() {
    const row = (d: LensDef) => el('button', {
      type: 'button', class: 'sm-row', 'data-lens': d.id,
      onclick: () => { this.closeMenu(); this.hooks.onLens(d.id); },
    }, [
      el('span', { class: 'sm-ico' }, [icon(d.icon, 18)]),
      el('span', { class: 'sm-text' }, [el('span', { class: 'sm-label', text: d.label }), el('span', { class: 'sm-blurb', text: d.blurb })]),
      d.key ? el('kbd', { class: 'sm-key', text: d.key }) : null,
    ]);
    const group = (name: string, g: LensDef['group']) => {
      const lenses = LENSES.filter((l) => l.group === g && BUILT.has(l.id));
      return lenses.length ? el('section', { class: 'sm-group', 'aria-label': name }, [el('h3', { class: 'sm-head', text: name }), ...lenses.map(row)]) : null;
    };
    const foot = (href: string, ico: IconName, text: string) => el('a', { class: 'sm-foot-link', href, target: '_blank', rel: 'noopener' }, [icon(ico, 15), el('span', { text })]);
    const groups = [group('Read the field', 'read'), group('Bring your own material', 'practice')].filter((g): g is HTMLElement => !!g);
    this.menuBody.append(
      ...groups,
      el('footer', { class: 'sm-foot' }, [
        el('div', { class: 'sm-foot-links' }, [foot(RELEASES_URL, 'download', 'Downloads'), foot(ISSUES_URL, 'issue', 'Report a problem'), foot(REPO_URL, 'github', 'Source')]),
        el('p', { class: 'sm-fine' }, [icon('lock', 13), el('span', { text: 'Anything you write in Astrology, Dreams or Coincidences stays in this browser. Nothing is sent anywhere.' })]),
        el('p', { class: 'sm-fine sm-credits', text: 'Globe imagery: NASA Blue Marble and NASA GIBS. Plates: Wikimedia Commons, credited on each.' }),
      ]),
    );
  }
}
