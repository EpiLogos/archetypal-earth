// One Options control under the lens title: an icon that opens a popover anchored under it (a bottom sheet on a phone),
// in the shell menu's family: labelled groups of rows with a title and an optional one-line description.
// Every reading lens hands the shell this instead of loose links.
import { el } from './dom';
import { icon } from './icons';

/** A labelled field inside the Options sheet. */
export function optionField(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'mode-opt-field' }, [el('span', { text: label }), control]);
}

/** One row of the Options popover: a serif title, an optional one-line description, a dot in the accent when it is the current choice. */
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

/** A primary choice in the Options popover (a route or action). `description` is the row's one line under the title. */
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

/** A labelled scrollable list of choices — the Options sheet's own menu, never a native <select>. */
export function optionChoices(
  label: string,
  items: { id: string; text: string; onclick: () => void; pressed?: boolean }[],
): HTMLElement {
  return el('div', { class: 'mode-opt-field' }, [
    el('span', { text: label }),
    el('div', { class: 'mode-opt-choices', role: 'listbox', 'aria-label': label }, items.map((it) =>
      el('button', {
        type: 'button', class: 'mode-opt-action mode-opt-row', role: 'option', text: it.text,
        'data-choice': it.id,
        'aria-selected': String(!!it.pressed),
        'aria-pressed': it.pressed === undefined ? undefined : String(it.pressed),
        onclick: (e) => {
          (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
          it.onclick();
        },
      }),
    )),
  ]);
}

/**
 * While the popover is open, a pointer down outside it or Escape closes it (Escape is taken here, so it never also
 * leaves the mode). The listeners are gated on `open` rather than attached by the async toggle event, so no pointer
 * down can slip past a popover that has just opened; they come off once the popover has left the page.
 */
function dismissOnOutside(details: HTMLDetailsElement) {
  const onDown = (e: Event) => {
    if (!details.isConnected) return forget();
    if (details.open && !details.contains(e.target as Node)) details.removeAttribute('open');
  };
  const onKey = (e: KeyboardEvent) => {
    if (!details.isConnected) return forget();
    if (!details.open || e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    details.removeAttribute('open');
    details.querySelector('summary')?.focus();
  };
  const forget = () => {
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
}

/** The one Options disclosure the shell places under the title — icon only; the icon rotates when open. */
export function modeOptions(children: (HTMLElement | null | false | undefined)[], _label = 'Options', opts: { open?: boolean } = {}): HTMLElement {
  const ico = icon('menu', 17);
  ico.classList.add('mode-opt-ico');
  const details = el('details', { class: 'mode-options', ...(opts.open ? { open: '' } : {}) }, [
    el('summary', { class: 'mode-opt-btn icon-btn', 'aria-label': 'Options', title: 'Options' }, [ico]),
    el('div', { class: 'mode-options-body', role: 'group', 'aria-label': 'Options' }, [
      el('div', { class: 'mode-opt-grab', 'aria-hidden': 'true' }),
      ...children.filter((c): c is HTMLElement => !!c),
    ]),
  ]);
  dismissOnOutside(details);
  return details;
}
