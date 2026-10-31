// Rows of choices for a lens's settings (the ⚙ popover of the View control): a serif title, an optional one-line description,
// a dot in the accent when it is the current choice, in labelled groups in the shell menu's family.
import { el } from './dom';

/** One row of the settings popover: a serif title, an optional one-line description, a dot in the accent when it is the current choice. */
export function optionRow(row: { title: string; description?: string; pressed?: boolean; tip?: string; onclick: () => void }): HTMLButtonElement {
  return el('button', {
    type: 'button', class: 'mode-opt-action mode-opt-row', title: row.tip,
    'aria-pressed': row.pressed === undefined ? undefined : String(row.pressed),
    onclick: (e) => {
      (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
      row.onclick();
    },
  }, [el('span', { class: 'mode-opt-text' }, [
    el('span', { class: 'mode-opt-title', text: row.title }),
    row.description ? el('span', { class: 'mode-opt-desc', text: row.description }) : null,
  ])]);
}

/** A choice in the settings popover (a route or action). `description` is the row's one line under the title. */
export function optionAction(text: string, onclick: () => void, opts: { pressed?: boolean; title?: string; description?: string } = {}): HTMLButtonElement {
  return optionRow({ title: text, description: opts.description, pressed: opts.pressed, tip: opts.title, onclick });
}

/** A labelled group of rows, labelled in the shell menu's own small caps. Empty children are dropped. */
export function optionGroup(label: string, children: (HTMLElement | null | false | undefined)[]): HTMLElement {
  return el('div', { class: 'mode-opt-group', role: 'group', 'aria-label': label }, [
    el('span', { class: 'mode-opt-label', text: label, 'aria-hidden': 'true' }),
    ...children.filter((c): c is HTMLElement => !!c),
  ]);
}
