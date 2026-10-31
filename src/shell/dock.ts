// THE SLICE DOCK (H6): what narrows the field, in one place at the foot of the screen. A chips row that is always reserved (so the strip
// never jumps when a chip comes or goes) holds the lens's scope as a removable chip, one chip for each filter in force, and the button
// that opens the filter; the filter is a popover over that button (a bottom sheet on a phone); the time strip stands below the row.
// The popover is one layer of the dismissal stack: Escape and a press outside take it down before anything under it.
import { el, clear, isNarrow } from '../ui/dom';
import { icon } from '../ui/icons';
import { chips, ERAS, isEmpty, KIND_LABELS, RING_LABELS, subjectLabel, type FieldFilter, type PersonSubject, type SkyRing } from './filter';
import { scopeChip, type ScopeState } from './scope-chip';
import type { LocusType } from '../types/field';

/** What the filter offers for the lens that stands: the dimensions that vary inside its slice, and the values of the two facets. */
export interface FilterScope {
  /** the lens's name, for the count line */
  label: string;
  /** true while the whole field is the slice (the Field): the count line then says so */
  whole: boolean;
  dimensions: readonly string[];
  facets: { subjects: readonly PersonSubject[]; rings: readonly SkyRing[] };
}

export interface DockHooks {
  onFilter(next: FieldFilter): void;
  /** how many occurrences a filter leaves in the lens's slice and on the Earth, for the popover's count */
  countFor(f: FieldFilter): number;
  /** the Sources a filter can slice by: a Work's id and name, and the other cite keys that fold to it */
  works: { id: string; name: string; aliases?: string[] }[];
  cultures: { id: string; name: string }[];
  /** the field's archetypes and theoretics, for the filter's own dimensions */
  archetypes: { id: string; name: string }[];
  theoretics: { id: string; name: string }[];
}

const ALL_DIMENSIONS = ['works', 'cultures', 'era', 'kinds', 'archetypes', 'theoretics', 'subjects', 'rings'];
const FILTER_KINDS: LocusType[] = ['dream', 'vision', 'artifact', 'myth-episode', 'ritual', 'text-passage'];

export class SliceDock {
  /** the dock itself: the chips row over the time strip */
  readonly root: HTMLElement;
  /** where the time strip stands */
  readonly timeHost: HTMLElement;
  private chipRow: HTMLElement;
  private addBtn: HTMLButtonElement;
  private pop: HTMLElement;
  private filterHost: HTMLElement;
  private filter: FieldFilter = {};
  private scope: FilterScope = { label: 'the field', whole: true, dimensions: ALL_DIMENSIONS, facets: { subjects: ['jung', 'patient-anon'], rings: ['body', 'zodiac', 'rank', 'wheel', 'pole'] } };
  private lensScope: { scope: ScopeState | null; whole: boolean; onWhole: (on: boolean) => void } = { scope: null, whole: false, onWhole: () => {} };

  constructor(parent: HTMLElement, private hooks: DockHooks) {
    this.chipRow = el('div', { class: 'dock-chips', role: 'group', 'aria-label': 'Scope and filters' });
    this.timeHost = el('div', { class: 'dock-time' });
    this.root = el('div', { class: 'dock', id: 'hud-dock', 'data-region': 'slice' }, [this.chipRow, this.timeHost]);
    this.addBtn = el('button', {
      type: 'button', class: 'dock-add', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'filter-pop',
      onclick: () => this.toggleFilter(),
    }) as HTMLButtonElement;
    this.filterHost = el('div', { class: 'sm-filter' });
    this.pop = el('div', { class: 'filter-pop', id: 'filter-pop', role: 'dialog', 'aria-label': 'Filter the field', hidden: true }, [
      el('div', { class: 'mode-opt-grab', 'aria-hidden': 'true' }),
      el('h2', { class: 'fp-head', text: 'Filter the field' }),
      this.filterHost,
    ]);
    parent.append(this.root, this.pop);
    // a press outside takes the popover down (the button that opened it handles its own press)
    document.addEventListener('pointerdown', (e) => {
      if (!this.filterOpen) return;
      const t = e.target as Element | null;
      if (this.pop.contains(t) || this.addBtn.contains(t)) return;
      this.closeFilter();
    }, true);
    // the strip's height under the row is what the lenses' own strips stand above
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.reportHeight()).observe(this.root);
    this.renderChips();
  }

  private reportHeight() {
    const h = this.root.offsetHeight;
    if (h) document.documentElement.style.setProperty('--dock-h', `${Math.round(h + (isNarrow() ? 10 : 18))}px`);
  }

  get filterOpen(): boolean {
    return !this.pop.hidden;
  }

  setFilter(f: FieldFilter) {
    this.filter = f;
    this.renderChips();
    if (this.filterOpen) this.renderFilter();
  }

  /** The filter follows the lens: only the dimensions that vary inside its slice are offered (one a filter already holds stays, so it can be taken off). */
  setFilterScope(scope: FilterScope) {
    this.scope = scope;
    if (this.filterOpen) this.renderFilter();
  }

  /**
   * What the globe shows in this mode: its own presences, the rest of the field set back. The chip names the set and, removed,
   * brings the rest of the field back; it stays as the way back to the set. Null takes it away.
   */
  setScope(scope: ScopeState | null, wholeField: boolean, onWhole: (on: boolean) => void) {
    this.lensScope = { scope, whole: wholeField, onWhole };
    this.renderChips();
  }

  openFilter() {
    if (this.filterOpen) return;
    this.renderFilter();
    this.pop.hidden = false;
    this.pop.classList.toggle('sheet', isNarrow());
    this.addBtn.setAttribute('aria-expanded', 'true');
    this.addBtn.setAttribute('aria-pressed', 'true');
    document.body.classList.add('filter-open');
    this.place();
    this.pop.querySelector<HTMLElement>('button, select')?.focus({ preventScroll: true });
  }

  closeFilter() {
    if (!this.filterOpen) return;
    this.pop.hidden = true;
    this.addBtn.setAttribute('aria-expanded', 'false');
    this.addBtn.setAttribute('aria-pressed', 'false');
    document.body.classList.remove('filter-open');
    this.addBtn.focus({ preventScroll: true });
  }

  toggleFilter() {
    if (this.filterOpen) this.closeFilter(); else this.openFilter();
  }

  /** The popover stands over the button that opened it, as far as the screen allows; a phone's is a sheet the CSS places. */
  private place() {
    const p = this.pop;
    p.style.left = p.style.bottom = '';
    if (isNarrow()) return;
    const r = this.addBtn.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 24);
    p.style.bottom = `${Math.round(window.innerHeight - r.top + 10)}px`;
    p.style.left = `${Math.round(Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2)))}px`;
  }

  private renderFilter() {
    const f = this.filter;
    const set = (next: FieldFilter) => this.hooks.onFilter(next);
    const select = (label: string, options: { id: string; name: string; aliases?: string[] }[], current: string[] | undefined, apply: (ids: string[]) => FieldFilter) =>
      el('label', { class: 'sf-field' }, [
        el('span', { class: 'sf-label', text: label }),
        (() => {
          const s = el('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; set(apply(v ? [v] : [])); } }, [el('option', { value: '', text: 'Any' })]);
          for (const o of options) s.append(el('option', { value: o.id, text: o.name, selected: !!current?.length && (current[0] === o.id || !!o.aliases?.includes(current[0])) }));
          return s;
        })(),
      ]);
    const pill = (text: string, on: boolean, onclick: () => void) => el('button', { type: 'button', class: 'sf-pill', 'aria-pressed': String(on), text, onclick });
    clear(this.filterHost);
    const shown = (dim: keyof FieldFilter, active: boolean) => this.scope.dimensions.includes(dim) || active;
    const rows: (HTMLElement | null)[] = [
      shown('works', !!f.works?.length) ? select('Source', this.hooks.works, f.works, (ids) => ({ ...f, works: ids })) : null,
      shown('cultures', !!f.cultures?.length) ? select('Culture', this.hooks.cultures, f.cultures, (ids) => ({ ...f, cultures: ids })) : null,
      shown('era', !!f.era) ? el('div', { class: 'sf-field', 'data-dim': 'era' }, [el('span', { class: 'sf-label', text: 'Era' }), el('div', { class: 'sf-pills' }, ERAS.map((e) => {
        const on = !!f.era && f.era[0] === e.range[0] && f.era[1] === e.range[1];
        return pill(e.label, on, () => { const { era: _e, ...rest } = f; set(on ? rest : { ...f, era: e.range }); });
      }))]) : null,
      shown('kinds', !!f.kinds?.length) ? el('div', { class: 'sf-field', 'data-dim': 'kinds' }, [el('span', { class: 'sf-label', text: 'Kind' }), el('div', { class: 'sf-pills' }, FILTER_KINDS.map((k) => {
        const on = !!f.kinds?.includes(k);
        return pill(KIND_LABELS[k], on, () => set({ ...f, kinds: on ? f.kinds!.filter((x) => x !== k) : [...(f.kinds ?? []), k] }));
      }))]) : null,
      shown('archetypes', !!f.archetypes?.length) ? el('div', { class: 'sf-field', 'data-dim': 'archetypes' }, [el('span', { class: 'sf-label', text: 'Archetype' }), el('div', { class: 'sf-pills' }, this.hooks.archetypes.map((a) => {
        const on = !!f.archetypes?.includes(a.id);
        return pill(a.name, on, () => set({ ...f, archetypes: on ? f.archetypes!.filter((x) => x !== a.id) : [...(f.archetypes ?? []), a.id] }));
      }))]) : null,
      shown('theoretics', !!f.theoretics?.length) ? el('div', { class: 'sf-field', 'data-dim': 'theoretics' }, [el('span', { class: 'sf-label', text: 'Theory' }), el('div', { class: 'sf-pills' }, this.hooks.theoretics.map((t) => {
        const on = !!f.theoretics?.includes(t.id);
        return pill(t.name, on, () => set({ ...f, theoretics: on ? f.theoretics!.filter((x) => x !== t.id) : [...(f.theoretics ?? []), t.id] }));
      }))]) : null,
      shown('subjects', !!f.subjects?.length) ? el('div', { class: 'sf-field', 'data-dim': 'subjects' }, [el('span', { class: 'sf-label', text: 'Whose' }), el('div', { class: 'sf-pills' }, this.scope.facets.subjects.map((x) => {
        const on = !!f.subjects?.includes(x);
        return pill(subjectLabel(x), on, () => set({ ...f, subjects: on ? f.subjects!.filter((y) => y !== x) : [...(f.subjects ?? []), x] }));
      }))]) : null,
      shown('rings', !!f.rings?.length) ? el('div', { class: 'sf-field', 'data-dim': 'rings' }, [el('span', { class: 'sf-label', text: 'Sky ring' }), el('div', { class: 'sf-pills' }, this.scope.facets.rings.map((x) => {
        const on = !!f.rings?.includes(x);
        return pill(RING_LABELS[x], on, () => set({ ...f, rings: on ? f.rings!.filter((y) => y !== x) : [...(f.rings ?? []), x] }));
      }))]) : null,
    ];
    const n = this.hooks.countFor(f).toLocaleString();
    this.filterHost.append(
      ...rows.filter((r): r is HTMLElement => !!r),
      el('p', { class: 'sf-count', role: 'status', text: isEmpty(f) && this.scope.whole ? 'Showing the whole field.' : isEmpty(f) ? `${n} placed in ${this.scope.label}.` : `${n} placed instances pass the filter.` }),
    );
    if (!isEmpty(f)) this.filterHost.append(el('button', { type: 'button', class: 'link-quiet sf-clear', text: 'Clear the filter', onclick: () => set({}) }));
  }

  /** The row: the lens's scope, a chip for each filter in force, and the button that opens the filter. */
  private renderChips() {
    clear(this.chipRow);
    const name = (list: { id: string; name: string; aliases?: string[] }[]) => (id: string) => (list.find((x) => x.id === id) ?? list.find((x) => x.aliases?.includes(id)))?.name ?? id;
    const sc = scopeChip(this.lensScope.scope, this.lensScope.whole);
    if (sc) {
      this.chipRow.append(el('button', {
        type: 'button', class: `sh-chip scope${sc.off ? ' off' : ''}`, 'aria-label': sc.aria, 'aria-pressed': String(!sc.off), onclick: () => this.lensScope.onWhole(!this.lensScope.whole),
      }, [el('span', { text: sc.label }), icon(sc.off ? 'back' : 'close', 12)]));
    }
    const cs = chips(this.filter, { work: name(this.hooks.works), culture: name(this.hooks.cultures), archetype: name(this.hooks.archetypes), theoretic: name(this.hooks.theoretics) });
    for (const c of cs) {
      this.chipRow.append(el('button', { type: 'button', class: 'sh-chip', 'aria-label': `Remove the filter: ${c.label}`, onclick: () => this.hooks.onFilter(c.without) }, [el('small', { text: c.kind }), el('span', { text: c.label }), icon('close', 12)]));
    }
    clear(this.addBtn);
    this.addBtn.append(icon('filter', 14), el('span', { text: cs.length ? 'Filter' : 'Filter the field' }));
    this.chipRow.append(this.addBtn);
  }
}
