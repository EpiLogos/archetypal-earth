// THE SLICE DOCK (H6): what narrows the field, in one place at the foot of the screen. A chips row that is always reserved (so the strip
// never jumps when a chip comes or goes, and so empty it shows nothing) holds the lens's scope as a removable chip and one chip for
// each filter in force; the time strip stands below the row. The button that opens the filter is not in the row: it stands in the
// shell's top-left cluster beside the lens and view controls (`dock.button`, placed by shell.ts). The filter opens as a panel of the
// same family as the reading pane: a left panel on a desk, a bottom sheet on a phone. The panel is one layer of the dismissal stack:
// Escape and a press outside take it down before anything under it.
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

/** The head every panel of the shell family wears: a title and a ✕ (the reading pane's own pair). */
export function panelHead(title: string, onClose: () => void): HTMLElement {
  return el('div', { class: 'pn-head' }, [
    el('h2', { class: 'pn-title', text: title }),
    el('button', { type: 'button', class: 'pn-close', 'aria-label': `Close ${title.toLowerCase()}`, title: 'Close', onclick: onClose }, [icon('close', 14)]),
  ]);
}

/** A phone sheet's grab handle: the bar a finger takes hold of. */
export function panelGrab(): HTMLElement {
  return el('div', { class: 'pn-grab', 'aria-hidden': 'true' }, [el('span', { class: 'pn-grab-bar' })]);
}

/** A sheet on a phone lets down with a finger: drag the handle or the head down and it closes (a short drag springs back). */
export function swipeDownToClose(panel: HTMLElement, handles: HTMLElement[], onClose: () => void): void {
  for (const h of handles) {
    h.addEventListener('pointerdown', (e) => {
      if (!isNarrow() || (e.target as Element).closest('button')) return;
      const y0 = e.clientY;
      let dy = 0;
      try { h.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer: the move still arrives */ }
      panel.style.transition = 'none';
      const move = (m: PointerEvent) => { dy = Math.max(0, m.clientY - y0); panel.style.transform = `translateY(${dy}px)`; };
      const end = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', end);
        h.removeEventListener('pointercancel', end);
        panel.style.transition = '';
        panel.style.transform = '';
        if (dy > 70) onClose();
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', end);
      h.addEventListener('pointercancel', end);
    });
  }
}

const ALL_DIMENSIONS = ['works', 'cultures', 'era', 'kinds', 'archetypes', 'theoretics', 'subjects', 'rings'];
const FILTER_KINDS: LocusType[] = ['dream', 'vision', 'artifact', 'myth-episode', 'ritual', 'text-passage'];

/** A group of pills longer than this folds to its first few (and any that are on), with a "Show all" under it. */
const FOLD_AFTER = 10;
const FOLD_SHOWN = 8;

export class SliceDock {
  /** the dock itself: the chips row over the time strip */
  readonly root: HTMLElement;
  /** where the time strip stands */
  readonly timeHost: HTMLElement;
  /** the filter's button: shell.ts stands it in the top-left cluster, beside the lens and view controls */
  readonly button: HTMLButtonElement;
  private chipRow: HTMLElement;
  private panel: HTMLElement;
  private body: HTMLElement;
  private filterHost: HTMLElement;
  private foot: HTMLElement;
  private filter: FieldFilter = {};
  /** the long groups the visitor has opened out */
  private unfolded = new Set<string>();
  private scope: FilterScope = { label: 'the field', whole: true, dimensions: ALL_DIMENSIONS, facets: { subjects: ['jung', 'patient-anon'], rings: ['body', 'zodiac', 'rank', 'wheel', 'pole'] } };
  private lensScope: { scope: ScopeState | null; whole: boolean; onWhole: (on: boolean) => void } = { scope: null, whole: false, onWhole: () => {} };

  constructor(parent: HTMLElement, private hooks: DockHooks) {
    this.chipRow = el('div', { class: 'dock-chips', role: 'group', 'aria-label': 'Scope and filters' });
    this.timeHost = el('div', { class: 'dock-time' });
    this.root = el('div', { class: 'dock', id: 'hud-dock', 'data-region': 'slice' }, [this.chipRow, this.timeHost]);
    this.button = el('button', {
      type: 'button', class: 'sh-filter', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-pressed': 'false', 'aria-controls': 'filter-panel',
      onclick: () => this.toggleFilter(),
    }) as HTMLButtonElement;
    this.filterHost = el('div', { class: 'sm-filter' });
    this.body = el('div', { class: 'pn-body' }, [this.filterHost]);
    this.foot = el('div', { class: 'pn-foot' });
    const head = panelHead('Filter', () => this.closeFilter());
    const grab = panelGrab();
    this.panel = el('div', { class: 'pn filter-panel', id: 'filter-panel', role: 'dialog', 'aria-label': 'Filter the field', hidden: true }, [grab, head, this.body, this.foot]);
    swipeDownToClose(this.panel, [grab, head], () => this.closeFilter());
    parent.append(this.root, this.panel);
    // a press outside takes the panel down (the button that opened it handles its own press)
    document.addEventListener('pointerdown', (e) => {
      if (!this.filterOpen) return;
      const t = e.target as Element | null;
      if (this.panel.contains(t) || this.button.contains(t)) return;
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
    return !this.panel.hidden;
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
    this.panel.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.button.setAttribute('aria-pressed', 'true');
    document.body.classList.add('filter-open');
    this.panel.querySelector<HTMLElement>('.pn-body select, .pn-body button')?.focus({ preventScroll: true });
  }

  closeFilter() {
    if (!this.filterOpen) return;
    this.panel.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-pressed', 'false');
    document.body.classList.remove('filter-open');
    this.button.focus({ preventScroll: true });
  }

  toggleFilter() {
    if (this.filterOpen) this.closeFilter(); else this.openFilter();
  }

  private renderFilter() {
    const f = this.filter;
    const set = (next: FieldFilter) => this.hooks.onFilter(next);
    // the panel is drawn again on every choice: it keeps its place in the list and the focus on the control that was used
    const scrollTop = this.body.scrollTop;
    const was = (document.activeElement as HTMLElement | null)?.dataset?.k;
    const select = (key: string, label: string, options: { id: string; name: string; aliases?: string[] }[], current: string[] | undefined, apply: (ids: string[]) => FieldFilter) =>
      el('label', { class: 'sf-field' }, [
        el('span', { class: 'sf-head' }, [el('span', { class: 'sf-label', text: label })]),
        (() => {
          const s = el('select', { 'data-k': key, onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; set(apply(v ? [v] : [])); } }, [el('option', { value: '', text: 'Any' })]);
          for (const o of options) s.append(el('option', { value: o.id, text: o.name, selected: !!current?.length && (current[0] === o.id || !!o.aliases?.includes(current[0])) }));
          return s;
        })(),
      ]);
    /** A group of pills: its name, how many are on, and, when it is long, its first few (and any that are on) with a "Show all" under them. */
    type Item = { key: string; text: string; on: boolean; click: () => void };
    const group = (dim: string, label: string, items: Item[]) => {
      const fold = items.length > FOLD_AFTER;
      const open = this.unfolded.has(dim);
      const on = items.filter((i) => i.on).length;
      const shown = fold && !open ? items.filter((i, k) => k < FOLD_SHOWN || i.on) : items;
      const pills = shown.map((i) => el('button', { type: 'button', class: 'sf-pill', 'data-k': i.key, 'aria-pressed': String(i.on), text: i.text, onclick: i.click }));
      return el('div', { class: 'sf-field', 'data-dim': dim }, [
        el('span', { class: 'sf-head' }, on ? [el('span', { class: 'sf-label', text: label }), el('span', { class: 'sf-n', text: String(on) })] : [el('span', { class: 'sf-label', text: label })]),
        el('div', { class: 'sf-pills', id: `sf-${dim}` }, pills),
        fold ? el('button', {
          type: 'button', class: 'sf-more', 'data-k': `more-${dim}`, 'aria-expanded': String(open), 'aria-controls': `sf-${dim}`, text: open ? 'Show fewer' : `Show all ${items.length}`,
          onclick: () => { if (open) this.unfolded.delete(dim); else this.unfolded.add(dim); this.renderFilter(); },
        }) : null,
      ]);
    };
    clear(this.filterHost);
    const shown = (dim: keyof FieldFilter, active: boolean) => this.scope.dimensions.includes(dim) || active;
    const rows: (HTMLElement | null)[] = [
      shown('works', !!f.works?.length) ? select('works', 'Source', this.hooks.works, f.works, (ids) => ({ ...f, works: ids })) : null,
      shown('cultures', !!f.cultures?.length) ? select('cultures', 'Culture', this.hooks.cultures, f.cultures, (ids) => ({ ...f, cultures: ids })) : null,
      shown('era', !!f.era) ? group('era', 'Era', ERAS.map((e) => {
        const on = !!f.era && f.era[0] === e.range[0] && f.era[1] === e.range[1];
        return { key: `era-${e.label}`, text: e.label, on, click: () => { const { era: _e, ...rest } = f; set(on ? rest : { ...f, era: e.range }); } };
      })) : null,
      shown('kinds', !!f.kinds?.length) ? group('kinds', 'Kind', FILTER_KINDS.map((k) => {
        const on = !!f.kinds?.includes(k);
        return { key: `kind-${k}`, text: KIND_LABELS[k], on, click: () => set({ ...f, kinds: on ? f.kinds!.filter((x) => x !== k) : [...(f.kinds ?? []), k] }) };
      })) : null,
      shown('archetypes', !!f.archetypes?.length) ? group('archetypes', 'Archetype', this.hooks.archetypes.map((a) => {
        const on = !!f.archetypes?.includes(a.id);
        return { key: `arch-${a.id}`, text: a.name, on, click: () => set({ ...f, archetypes: on ? f.archetypes!.filter((x) => x !== a.id) : [...(f.archetypes ?? []), a.id] }) };
      })) : null,
      shown('theoretics', !!f.theoretics?.length) ? group('theoretics', 'Theory', this.hooks.theoretics.map((t) => {
        const on = !!f.theoretics?.includes(t.id);
        return { key: `theo-${t.id}`, text: t.name, on, click: () => set({ ...f, theoretics: on ? f.theoretics!.filter((x) => x !== t.id) : [...(f.theoretics ?? []), t.id] }) };
      })) : null,
      shown('subjects', !!f.subjects?.length) ? group('subjects', 'Whose', this.scope.facets.subjects.map((x) => {
        const on = !!f.subjects?.includes(x);
        return { key: `who-${x}`, text: subjectLabel(x), on, click: () => set({ ...f, subjects: on ? f.subjects!.filter((y) => y !== x) : [...(f.subjects ?? []), x] }) };
      })) : null,
      shown('rings', !!f.rings?.length) ? group('rings', 'Sky ring', this.scope.facets.rings.map((x) => {
        const on = !!f.rings?.includes(x);
        return { key: `ring-${x}`, text: RING_LABELS[x], on, click: () => set({ ...f, rings: on ? f.rings!.filter((y) => y !== x) : [...(f.rings ?? []), x] }) };
      })) : null,
    ];
    this.filterHost.append(...rows.filter((r): r is HTMLElement => !!r));
    // the footer: the filter's own feedback, and the way to take it all off
    const total = this.hooks.countFor(f);
    const n = total.toLocaleString();
    const noun = total === 1 ? 'instance' : 'instances';
    clear(this.foot);
    this.foot.append(
      el('p', { class: 'sf-count', role: 'status', text: isEmpty(f) && !this.scope.whole ? `${n} ${noun} in ${this.scope.label}` : `${n} ${noun}` }),
      el('button', { type: 'button', class: 'sf-clear', text: 'Clear', hidden: isEmpty(f), onclick: () => set({}) }),
    );
    this.body.scrollTop = scrollTop;
    if (was && this.panel.contains(document.activeElement) === false) this.panel.querySelector<HTMLElement>(`[data-k="${was}"]`)?.focus({ preventScroll: true });
  }

  /** The button: the filter's icon and name, and how many filters are in force. */
  private renderButton(n: number) {
    clear(this.button);
    this.button.append(icon('filter', 15), el('span', { class: 'sh-filter-t', text: 'Filter' }));
    if (n) this.button.append(el('span', { class: 'sh-filter-n', text: String(n) }));
    this.button.setAttribute('aria-label', n ? `Filter, ${n} in force` : 'Filter');
    this.button.classList.toggle('on', n > 0);
  }

  /** The row: the lens's scope and a chip for each filter in force (an empty row shows nothing, and still holds its height). */
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
    this.chipRow.classList.toggle('has-chips', cs.length > 0 || !!sc);
    document.body.classList.toggle('dock-chips-on', cs.length > 0 || !!sc);
    this.renderButton(cs.length);
  }
}
