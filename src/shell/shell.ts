// The shell: the one frame that owns all chrome (docs/MODES-RFC.md §2). One title, one menu, one slot for a lens's
// own controls, the filter, the corners. Lenses render content; they never draw a heading or a switch of their own.
import { el, clear, isNarrow } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { BUILT, LENSES, lensDef, type LensDef, type LensId } from './lens';
import { chips, ERAS, isEmpty, KIND_LABELS, type FieldFilter } from './filter';
import type { LocusType } from '../types/field';

export const REPO_URL = 'https://github.com/EpiLogos/archetypal-earth';
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
const SITE = 'An Archetypal Earth';

export interface ShellHooks {
  onLens(id: LensId): void;
  onSearch(anchor?: HTMLElement): void;
  onFilter(next: FieldFilter): void;
  /** how many occurrences a filter leaves, for the menu's count */
  countFor(f: FieldFilter): number;
  works: { id: string; name: string }[];
  cultures: { id: string; name: string }[];
}

const FILTER_KINDS: LocusType[] = ['dream', 'vision', 'artifact', 'myth-episode', 'ritual', 'text-passage'];

export class Shell {
  readonly root: HTMLElement;
  private lensBtn: HTMLButtonElement;
  private lensIcon: HTMLElement;
  private lensName: HTMLElement;
  private aside: HTMLElement;
  private title: HTMLElement;
  private controls: HTMLElement;
  private menu: HTMLElement;
  private menuScrim: HTMLElement;
  private filterHost: HTMLElement;
  private chipRow: HTMLElement;
  private lens: LensId = 'field';
  private filter: FieldFilter = {};
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
    this.root = el('header', { class: 'shell' }, [el('div', { class: 'sh-head' }, [this.lensBtn, this.aside]), this.title, this.controls]);

    const github = el('a', { class: 'sh-corner-btn icon-btn', href: REPO_URL, target: '_blank', rel: 'noopener', 'aria-label': 'The project on GitHub', title: 'GitHub' }, [icon('github', 17)]);
    const search = document.getElementById('search-btn');
    const corner = el('div', { class: 'sh-corner' });
    if (search) {
      search.classList.add('sh-corner-btn', 'icon-btn');
      search.addEventListener('click', (e) => this.hooks.onSearch(e.currentTarget as HTMLElement));
      corner.append(search);
    }
    corner.append(github);

    this.filterHost = el('div', { class: 'sm-filter' });
    this.menuScrim = el('div', { class: 'sm-scrim', hidden: true, onclick: () => this.closeMenu() });
    this.menu = el('div', { class: 'shell-menu', id: 'shell-menu', role: 'dialog', 'aria-label': 'Lenses and filters', hidden: true });
    this.chipRow = el('div', { class: 'sh-chips', 'aria-label': 'Active filters' });

    parent.append(this.root, corner, this.chipRow, this.menuScrim, this.menu);
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
  setContext(text: string) {
    this.context = text;
    this.title.textContent = text;
    this.title.hidden = !text;
    this.syncDocTitle();
  }

  /** The lens's own few controls; the shell places them. Null clears. */
  setControls(nodes: Node[] | null) {
    clear(this.controls);
    if (nodes?.length) this.controls.append(...nodes);
    this.controls.hidden = !nodes?.length;
  }

  /** Something that sits beside the lens button (the Field's Earth ⇄ Graph pill). */
  setAside(node: Node | null) {
    clear(this.aside);
    if (node) this.aside.append(node);
  }

  setFilter(f: FieldFilter) {
    this.filter = f;
    this.renderFilter();
    this.renderChips();
  }

  openMenu() {
    if (!this.menu.hidden) return;
    this.renderFilter();
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
      return lenses.length ? el('section', { class: 'sm-group', 'aria-label': name }, [el('h2', { class: 'sm-head', text: name }), ...lenses.map(row)]) : null;
    };
    const foot = (href: string, ico: IconName, text: string) => el('a', { class: 'sm-foot-link', href, target: '_blank', rel: 'noopener' }, [icon(ico, 15), el('span', { text })]);
    const groups = [group('Read the field', 'read'), group('Bring your own material', 'practice')].filter((g): g is HTMLElement => !!g);
    this.menu.append(
      el('div', { class: 'sm-grab', 'aria-hidden': 'true' }),
      ...groups,
      el('section', { class: 'sm-group', 'aria-label': 'Filter the field' }, [el('h2', { class: 'sm-head', text: 'Filter the field' }), this.filterHost]),
      el('footer', { class: 'sm-foot' }, [
        el('div', { class: 'sm-foot-links' }, [foot(RELEASES_URL, 'download', 'Downloads'), foot(ISSUES_URL, 'issue', 'Report a problem'), foot(REPO_URL, 'github', 'Source')]),
        el('p', { class: 'sm-fine' }, [icon('lock', 13), el('span', { text: 'Anything you write in Astrology, Dreams or Coincidences stays in this browser. Nothing is sent anywhere.' })]),
        el('p', { class: 'sm-fine sm-credits', text: 'Globe imagery: NASA Blue Marble and NASA GIBS. Plates: Wikimedia Commons, credited on each.' }),
      ]),
    );
  }

  private renderFilter() {
    const f = this.filter;
    const set = (next: FieldFilter) => this.hooks.onFilter(next);
    const select = (label: string, options: { id: string; name: string }[], current: string[] | undefined, apply: (ids: string[]) => FieldFilter) =>
      el('label', { class: 'sf-field' }, [
        el('span', { class: 'sf-label', text: label }),
        (() => {
          const s = el('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; set(apply(v ? [v] : [])); } }, [el('option', { value: '', text: 'Any' })]);
          for (const o of options) s.append(el('option', { value: o.id, text: o.name, selected: current?.[0] === o.id }));
          return s;
        })(),
      ]);
    const pill = (text: string, on: boolean, onclick: () => void) => el('button', { type: 'button', class: 'sf-pill', 'aria-pressed': String(on), text, onclick });
    clear(this.filterHost);
    this.filterHost.append(
      select('Source', this.hooks.works, f.works, (ids) => ({ ...f, works: ids })),
      select('Culture', this.hooks.cultures, f.cultures, (ids) => ({ ...f, cultures: ids })),
      el('div', { class: 'sf-field' }, [el('span', { class: 'sf-label', text: 'Era' }), el('div', { class: 'sf-pills' }, ERAS.map((e) => {
        const on = !!f.era && f.era[0] === e.range[0] && f.era[1] === e.range[1];
        return pill(e.label, on, () => { const { era: _e, ...rest } = f; set(on ? rest : { ...f, era: e.range }); });
      }))]),
      el('div', { class: 'sf-field' }, [el('span', { class: 'sf-label', text: 'Kind' }), el('div', { class: 'sf-pills' }, FILTER_KINDS.map((k) => {
        const on = !!f.kinds?.includes(k);
        return pill(KIND_LABELS[k], on, () => set({ ...f, kinds: on ? f.kinds!.filter((x) => x !== k) : [...(f.kinds ?? []), k] }));
      }))]),
      el('p', { class: 'sf-count', role: 'status', text: isEmpty(f) ? 'Showing the whole field.' : `${this.hooks.countFor(f).toLocaleString()} instances pass the filter.` }),
    );
    if (!isEmpty(f)) this.filterHost.append(el('button', { type: 'button', class: 'link-quiet sf-clear', text: 'Clear the filter', onclick: () => set({}) }));
  }

  private renderChips() {
    clear(this.chipRow);
    const name = (list: { id: string; name: string }[]) => (id: string) => list.find((x) => x.id === id)?.name ?? id;
    const cs = chips(this.filter, { work: name(this.hooks.works), culture: name(this.hooks.cultures) });
    this.chipRow.hidden = !cs.length;
    for (const c of cs) {
      this.chipRow.append(el('button', { type: 'button', class: 'sh-chip', 'aria-label': `Remove the filter: ${c.label}`, onclick: () => this.hooks.onFilter(c.without) }, [el('span', { text: c.label }), icon('close', 12)]));
    }
  }
}
