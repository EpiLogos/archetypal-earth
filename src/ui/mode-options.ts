// One Options control under the lens title: an icon that opens the shared sheet (timeline-width, above the clock).
// Every reading lens hands the shell this instead of loose links.
import { el } from './dom';
import { icon } from './icons';

/** A labelled field inside the Options sheet. */
export function optionField(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'mode-opt-field' }, [el('span', { text: label }), control]);
}

/** A primary choice in the Options sheet (a route or action). */
export function optionAction(text: string, onclick: () => void, opts: { pressed?: boolean; title?: string } = {}): HTMLButtonElement {
  return el('button', {
    type: 'button', class: 'link-quiet mode-opt-action', text, 'aria-pressed': opts.pressed === undefined ? undefined : String(opts.pressed),
    title: opts.title, onclick: (e) => {
      (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
      onclick();
    },
  });
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
        type: 'button', class: 'link-quiet mode-opt-action', role: 'option', text: it.text,
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

/** The one Options disclosure the shell places under the title — icon only; the icon rotates when open. */
export function modeOptions(children: (HTMLElement | null | false | undefined)[], _label = 'Options', opts: { open?: boolean } = {}): HTMLElement {
  const ico = icon('menu', 17);
  ico.classList.add('mode-opt-ico');
  return el('details', { class: 'mode-options', ...(opts.open ? { open: '' } : {}) }, [
    el('summary', { class: 'mode-opt-btn icon-btn', 'aria-label': 'Options', title: 'Options' }, [ico]),
    el('div', { class: 'mode-options-body' }, children.filter((c): c is HTMLElement => !!c)),
  ]);
}
