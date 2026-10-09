// The voice marks: a V for Van Eenwyk's reading, a J for Jung's own text. Same visual family as the Aion basis chips.
import { el } from '../ui/dom';

export const V_TITLE = "Van Eenwyk's reading — not Jung's";
export const J_TITLE = "Asserted in Jung's own text";

export function vMark(extraClass = ''): HTMLElement {
  return el('span', { class: `dy-chip dy-v ${extraClass}`.trim(), title: V_TITLE, text: 'V' });
}

export function jMark(): HTMLElement {
  return el('span', { class: 'dy-chip dy-j', title: J_TITLE, text: 'J' });
}
