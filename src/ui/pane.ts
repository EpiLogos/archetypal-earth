// THE PANE FRAME: the one frame every reading layer stands in (Contents, Reading, wide, the phone's bottom sheet).
// A frame is a head (✕ first, the expand tool at the right) over a scrolling article; what goes in the article is the
// caller's. DeepSheet, the passage sheet and the You sheet each build theirs here, so a ✕ and an Esc land alike.
import { clear, el } from './dom';
import { icon } from './icons';
import { closeGlyph } from './reveal';
import type { PaneMode } from '../shell/layout';

export interface PaneFrameOptions {
  /** extra classes after `deep pane` (`passage`, `you-sheet`) */
  className?: string;
  label: string;
  closeLabel: string;
  onClose(): void;
  /** present when the pane can widen: the tool toggles it */
  onToggleWide?(): void;
  articleClass?: string;
  hidden?: boolean;
}

export interface PaneFrame {
  root: HTMLElement;
  scroller: HTMLElement;
  article: HTMLElement;
  /** the Contents list, shown in place of the article when the pane is in its Contents state */
  contents: HTMLElement;
  /** pinned under the scrolling article: a walk's stepper; hidden while empty */
  foot: HTMLElement;
  close: HTMLButtonElement;
  tool: HTMLButtonElement | null;
  /** the Contents button in the head: a lens that lists Contents gives a phone (whose Path makes way for the sheet) its way to them */
  contentsTool: HTMLButtonElement;
  /** the phone sheet's handle: a drag sets the height, a tap steps to the next one (see `nextDetent`) */
  grab: HTMLButtonElement;
  /** the phone sheet's height now: `peek`, `half` or `full` (`data-detent`) */
  detent(): Detent;
  /** set the pane's state: `data-pane` (closed / contents / reading) and `data-wide`, and the tool's name and glyph */
  setMode(mode: PaneMode): void;
}

/** The heights a phone's sheet rests at: a peek (the subject's name and its first lines, the globe in view), half, and full. */
export type Detent = 'peek' | 'half' | 'full';
export const DETENTS: readonly Detent[] = ['peek', 'half', 'full'];
/** The share of the screen's height each detent takes (the stylesheet's numbers). */
export const DETENT_SHARE: Record<Detent, number> = { peek: 0.26, half: 0.52, full: 0.86 };

/** The detent a Contents list opens at, and a reading. */
export function openDetent(mode: PaneMode): Detent {
  return mode === 'contents' ? 'half' : 'full';
}

/** A tap on the handle: up one height, and from the top back to half. */
export function nextDetent(d: Detent): Detent {
  return d === 'peek' ? 'half' : d === 'half' ? 'full' : 'half';
}

/**
 * Where a drag of the handle lands: the height it was let go at (a share of the screen), carried on by the way it was moving
 * (`velocity` in shares per second, positive upward), taken to the nearest detent.
 */
export function settleDetent(share: number, velocity = 0): Detent {
  const aim = share + Math.max(-0.3, Math.min(0.3, velocity * 0.18));
  let best: Detent = 'half';
  let gap = Infinity;
  for (const d of DETENTS) {
    const g = Math.abs(DETENT_SHARE[d] - aim);
    if (g < gap) { gap = g; best = d; }
  }
  return best;
}

export function paneFrame(o: PaneFrameOptions): PaneFrame {
  const article = el('article', { class: `dp-article${o.articleClass ? ` ${o.articleClass}` : ''}` });
  const contents = el('div', { class: 'dp-contents-pane', hidden: true });
  const scroller = el('div', { class: 'dp-scroll', tabindex: 0 }, [article, contents]);
  const foot = el('footer', { class: 'pane-foot', hidden: true });
  const close = el('button', { class: 'dp-close', type: 'button', 'aria-label': o.closeLabel, onclick: () => o.onClose() }, [closeGlyph()]) as HTMLButtonElement;
  const tool = o.onToggleWide
    ? (el('button', { class: 'pane-tool', type: 'button', 'aria-label': 'Widen the reading', 'aria-pressed': 'false', onclick: () => o.onToggleWide?.() }, [icon('expand', 15)]) as HTMLButtonElement)
    : null;
  const contentsTool = el('button', { class: 'pane-contents-tool', type: 'button', 'aria-label': 'Contents', hidden: true }, [icon('list', 15), el('span', { text: 'Contents' })]) as HTMLButtonElement;
  const grab = el('button', { class: 'pane-grab', type: 'button', 'aria-label': 'Sheet height' }, [el('span', { class: 'pane-grab-bar', 'aria-hidden': 'true' })]) as HTMLButtonElement;
  const head = el('header', { class: 'pane-head' }, [close, el('span', { class: 'pane-spacer' }), contentsTool, tool, grab]);
  const root = el('section', {
    class: `deep pane${o.className ? ` ${o.className}` : ''}`,
    role: 'dialog',
    'aria-label': o.label,
    'aria-modal': 'false',
    'data-pane': 'closed',
    'data-wide': 'false',
  }, [head, scroller, foot]);
  if (o.hidden !== false) root.hidden = true;
  // the phone sheet's height: three detents, set by a tap or a drag of the handle (arrow keys too); each state starts at its own
  root.dataset.detent = 'full';
  const setDetent = (d: Detent) => {
    root.dataset.detent = d;
    root.style.removeProperty('height');
    grab.setAttribute('aria-valuetext', d);
    grab.setAttribute('aria-label', `Sheet height: ${d}. Tap for ${nextDetent(d)}`);
  };
  const detent = () => (root.dataset.detent as Detent) ?? 'full';
  let drag: { y0: number; h0: number; moved: boolean; last: { y: number; t: number }; v: number } | null = null;
  grab.addEventListener('pointerdown', (e) => {
    drag = { y0: e.clientY, h0: root.getBoundingClientRect().height, moved: false, last: { y: e.clientY, t: e.timeStamp }, v: 0 };
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 6) return;
    if (!drag.moved) { drag.moved = true; root.classList.add('dragging'); }
    const dt = Math.max(1, e.timeStamp - drag.last.t);
    drag.v = (-(e.clientY - drag.last.y) / window.innerHeight) / (dt / 1000);
    drag.last = { y: e.clientY, t: e.timeStamp };
    const h = Math.max(window.innerHeight * 0.18, Math.min(window.innerHeight * 0.92, drag.h0 - dy));
    root.style.height = `${h}px`;
  });
  const release = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    root.classList.remove('dragging');
    try { grab.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!d.moved) return;
    setDetent(settleDetent(root.getBoundingClientRect().height / window.innerHeight, d.v));
    suppressTap = true;
  };
  let suppressTap = false;
  grab.addEventListener('pointerup', release);
  grab.addEventListener('pointercancel', release);
  grab.addEventListener('click', () => {
    if (suppressTap) { suppressTap = false; return; }
    setDetent(nextDetent(detent()));
  });
  grab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const i = DETENTS.indexOf(detent());
    setDetent(DETENTS[Math.max(0, Math.min(DETENTS.length - 1, i + (e.key === 'ArrowUp' ? 1 : -1)))]);
  });
  setDetent('full');
  let lastMode: string = 'closed';
  const setMode = (mode: PaneMode) => {
    const key = mode === 'wide' ? 'reading' : mode;
    if (key !== lastMode && key !== 'closed') setDetent(openDetent(mode));
    lastMode = key;
    root.dataset.pane = key;
    root.dataset.wide = String(mode === 'wide');
    contentsTool.dataset.pane = mode;
    if (!tool) return;
    const wide = mode === 'wide';
    tool.setAttribute('aria-pressed', String(wide));
    tool.setAttribute('aria-label', wide ? 'Narrow the reading' : 'Widen the reading');
    tool.hidden = mode === 'contents' || mode === 'closed';
    clear(tool);
    tool.append(icon(wide ? 'shrink' : 'expand', 15));
  };
  return { root, scroller, article, contents, foot, close, tool, contentsTool, grab, detent, setMode };
}

/**
 * The walk's stepper under a reading in the pane: "‹ previous name · n / N · next name ›". The names are the neighbouring stops'
 * own (a name the walk has not got to is left out, and the arrow stands alone); each is shortened to fit, further on a phone.
 * Either arrow steps, whether it is the arrow or the name that is pressed.
 */
export function paneStepper(
  label: { prev: string; next: string }, at: string, onPrev: () => void, onNext: () => void,
  off: { prev?: boolean; next?: boolean } = {}, names: { prev?: string | null; next?: string | null } = {},
): Node[] {
  const name = (n: string | null | undefined, side: 'prev' | 'next') => (n ? el('span', { class: `pane-step-name ${side}`, text: n, title: n }) : null);
  const prev = el('button', { type: 'button', 'aria-label': label.prev, disabled: off.prev, onclick: onPrev }, [icon('back', 14), name(names.prev, 'prev')]);
  const next = el('button', { type: 'button', 'aria-label': label.next, disabled: off.next, onclick: onNext }, [name(names.next, 'next'), icon('next', 14)]);
  const named = !!(names.prev || names.next);
  return [el('div', { class: `th-step pane-step${named ? ' named' : ''}` }, [prev, el('span', { class: 'th-count pane-count', text: at }), next])];
}
