// The dismissal stack (H1): the one answer to "what does Escape take down next". Escape, a panel's ✕ and a crumb all ask
// this pure function and the controller carries out what it names, so the three can never disagree.
//
// The order is the owner's: search → menu / popover → reading → Contents → focus up a rung → lens → Field.
// Closing a reading is a rung of its own and never also leaves the mode: a visible sheet or a deep reading is always
// answered before the step out of the lens is.

/** The rungs, outermost (nearest the visitor's hand) first. A gaze at a planet sits between Contents and the focus rungs. */
export const RUNGS = ['search', 'menu', 'popover', 'reading', 'contents', 'gaze', 'focus', 'lens', 'field'] as const;
export type Rung = (typeof RUNGS)[number];

/** What the controller does for the rung. `up` and `out` both navigate to the state's `back`; they differ in what they leave. */
export type DismissEffect = 'search' | 'menu' | 'popover' | 'you' | 'passage' | 'sheet' | 'deep' | 'contents' | 'gaze' | 'up' | 'out' | 'none';

export interface DismissFacts {
  searchOpen: boolean;
  menuOpen: boolean;
  /** the Options / Contents popover under the title */
  popoverOpen: boolean;
  /** the visitor's own page over the state */
  youOpen: boolean;
  /** a passage sheet over a reading */
  passageOpen: boolean;
  /** a panel lens's sheet on screen (a reading the lens holds) */
  sheetVisible: boolean;
  /** the deep reading of a subject or an occurrence */
  deepOpen: boolean;
  /** the reading pane's Contents list, when it stands open on its own */
  contentsOpen: boolean;
  /** the camera is gazing at a planet from its orbit */
  gaze: boolean;
  /**
   * Where the state's own step back goes: `up` stays inside the same lens (a focus to its parent, a lens route to its
   * parent route), `out` leaves the lens for the Field, `none` is the Field's whole-field view with nothing above it.
   */
  back: 'up' | 'out' | 'none';
}

export interface Dismissal {
  rung: Rung;
  effect: DismissEffect;
}

/** The next thing to take down. `effect: 'none'` means the visitor already stands at the top: nothing is dismissed. */
export function dismissal(f: DismissFacts): Dismissal {
  if (f.searchOpen) return { rung: 'search', effect: 'search' };
  if (f.menuOpen) return { rung: 'menu', effect: 'menu' };
  if (f.popoverOpen) return { rung: 'popover', effect: 'popover' };
  if (f.youOpen) return { rung: 'reading', effect: 'you' };
  if (f.passageOpen) return { rung: 'reading', effect: 'passage' };
  if (f.sheetVisible) return { rung: 'reading', effect: 'sheet' };
  if (f.deepOpen) return { rung: 'reading', effect: 'deep' };
  if (f.contentsOpen) return { rung: 'contents', effect: 'contents' };
  if (f.gaze) return { rung: 'gaze', effect: 'gaze' };
  if (f.back === 'up') return { rung: 'focus', effect: 'up' };
  if (f.back === 'out') return { rung: 'lens', effect: 'out' };
  return { rung: 'field', effect: 'none' };
}
