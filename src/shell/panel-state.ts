// The visibility of a panel lens's sheet, as pure transitions (no DOM), so the rules are unit-tested in the node env.
//
// Two facts are kept apart. `loaded`: a lens has put content in the sheet (what Panel.isOpen reports, and what lenses
// test with `if (ctx.panel.isOpen) replace(...) else open(...)`). `revealed`: the person has asked to see it, through the
// Options' standard first action. The sheet is shown only when both hold.
//
// state × event → visible?
//   lens entered            → hidden (revealed cleared; a lens's own content never reveals it)
//   content open / replace  → unchanged (loaded; visibility stays as it was)
//   reveal (Open action)    → shown, once there is content
//   option choice (a content row in the Options: Opus, Operations, Jung's theory…) → reveals, as an invitation to read
//   option choice marked data-no-reveal (Astrology's names) → unchanged (the shell decides which rows are choices)
//   user close (X, Escape, drag-down, Close action) → hidden, content kept
//   lens left / sheet closed → hidden, nothing loaded; the next entry starts hidden
export interface PanelState {
  loaded: boolean;
  revealed: boolean;
}

export const PANEL_CLOSED: PanelState = { loaded: false, revealed: false };

export const isVisible = (s: PanelState): boolean => s.loaded && s.revealed;

export const onLensEnter = (s: PanelState): PanelState => (s.revealed ? { ...s, revealed: false } : s);

export const onContent = (s: PanelState): PanelState => (s.loaded ? s : { ...s, loaded: true });

export const onReveal = (s: PanelState): PanelState => (s.revealed ? s : { ...s, revealed: true });

/** A content choice in the Options is an invitation to read: the same transition as the Open action. */
export const onOptionChoice = onReveal;

export const onUserClose = (s: PanelState): PanelState => (s.revealed ? { ...s, revealed: false } : s);

export const onLensLeave = (_s: PanelState): PanelState => PANEL_CLOSED;
