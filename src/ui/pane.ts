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
  /** set the pane's state: `data-pane` (closed / contents / reading) and `data-wide`, and the tool's name and glyph */
  setMode(mode: PaneMode): void;
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
  const head = el('header', { class: 'pane-head' }, [close, el('span', { class: 'pane-spacer' }), contentsTool, tool]);
  const root = el('section', {
    class: `deep pane${o.className ? ` ${o.className}` : ''}`,
    role: 'dialog',
    'aria-label': o.label,
    'aria-modal': 'false',
    'data-pane': 'closed',
    'data-wide': 'false',
  }, [head, scroller, foot]);
  if (o.hidden !== false) root.hidden = true;
  const setMode = (mode: PaneMode) => {
    root.dataset.pane = mode === 'wide' ? 'reading' : mode;
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
  return { root, scroller, article, contents, foot, close, tool, contentsTool, setMode };
}

/** The walk's stepper under a reading in the pane: the neighbours either side, and where in the walk the visitor stands. */
export function paneStepper(label: { prev: string; next: string }, at: string, onPrev: () => void, onNext: () => void): Node[] {
  const prev = el('button', { type: 'button', 'aria-label': label.prev, onclick: onPrev }, [icon('back', 14)]);
  const next = el('button', { type: 'button', 'aria-label': label.next, onclick: onNext }, [icon('next', 14)]);
  return [el('div', { class: 'th-step pane-step' }, [prev, el('span', { class: 'th-count pane-count', text: at }), next])];
}
