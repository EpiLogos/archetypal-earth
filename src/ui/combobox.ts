// A suggestion list under a text field: the place picker of the Astrology form (and any field like it). The native
// <datalist> opens unreliably (not at all on some phones, only on a second keystroke on others), so this draws its own
// list: ARIA combobox + listbox, arrow keys and Enter, Escape to close, and options large enough for a thumb.
import { el } from './dom';

export interface ComboOption<T> {
  value: T;
  /** what the field shows once chosen */
  label: string;
  /** a quieter second line (a country, a region) */
  detail?: string;
}

export interface Combobox {
  input: HTMLInputElement;
  root: HTMLElement;
  close(): void;
}

let seq = 0;

/**
 * Wrap `input` in a suggestion list. `suggest` is asked on every keystroke; `onPick` is called with the chosen option
 * (by Enter, a click or a tap). `empty` is shown when the field has text and nothing matches.
 */
export function combobox<T>(input: HTMLInputElement, opts: {
  suggest: (query: string) => ComboOption<T>[];
  onPick: (o: ComboOption<T>) => void;
  empty?: string;
}): Combobox {
  const id = `cbx-${++seq}`;
  const list = el('ul', { class: 'cbx-list', role: 'listbox', id: `${id}-list`, hidden: true });
  const root = el('div', { class: 'cbx' }, [input, list]);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.autocomplete = 'off';
  input.removeAttribute('list');

  let options: ComboOption<T>[] = [];
  let active = -1;

  const setActive = (i: number) => {
    active = i;
    [...list.children].forEach((c, j) => c.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) {
      const node = list.children[i] as HTMLElement;
      input.setAttribute('aria-activedescendant', node.id);
      node.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o) return;
    input.value = o.label;
    close();
    opts.onPick(o);
  };
  const render = () => {
    const q = input.value.trim();
    options = q ? opts.suggest(q) : [];
    list.replaceChildren(...options.map((o, i) => el('li', {
      class: 'cbx-opt', role: 'option', id: `${id}-o${i}`, 'aria-selected': 'false',
      // pointerdown, not click: the field's blur would close the list before a click lands on it
      onpointerdown: (e: Event) => { e.preventDefault(); pick(i); },
    }, [el('span', { class: 'cbx-label', text: o.label }), o.detail ? el('span', { class: 'cbx-detail', text: o.detail }) : null])));
    if (!options.length && q && opts.empty) list.append(el('li', { class: 'cbx-empty', role: 'presentation', text: opts.empty }));
    const open = list.children.length > 0 && document.activeElement === input;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open && options.length > 0));
    setActive(-1);
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => close());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) render();
      if (options.length) setActive((active + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length) setActive(active <= 0 ? options.length - 1 : active - 1);
    } else if (e.key === 'Enter') {
      if (!list.hidden && options.length) {
        // Enter in an open list chooses (the highlighted option, or the first): it never submits the form half-filled
        e.preventDefault();
        pick(active >= 0 ? active : 0);
      }
    } else if (e.key === 'Escape') {
      if (!list.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
    }
  });
  return { input, root, close };
}
