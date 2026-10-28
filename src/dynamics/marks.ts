// The voice marks: a V for Van Eenwyk's reading, a J for Jung's own text. Same visual family as the Aion basis chips.
import { el } from '../ui/dom';
import { providerLabels } from '../data/labels';

/** The V chip's title: whose reading it is, and that it is not the author's (the provider's words). */
export function vTitle(): string {
  return providerLabels().dynamicsOtherText;
}
/** The J chip's title: asserted in the author's own text (the provider's words). */
export function jTitle(): string {
  return providerLabels().dynamicsOwnText;
}

export function vMark(extraClass = ''): HTMLElement {
  return el('span', { class: `dy-chip dy-v ${extraClass}`.trim(), title: vTitle(), text: 'V' });
}

export function jMark(): HTMLElement {
  return el('span', { class: 'dy-chip dy-j', title: jTitle(), text: 'J' });
}

export const N_TITLE = "Neumann's own text";

export function nMark(): HTMLElement {
  return el('span', { class: 'dy-chip dy-n', title: N_TITLE, text: 'N' });
}
