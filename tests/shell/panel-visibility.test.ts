import { describe, expect, it } from 'vitest';
import { isVisible, onContent, onLensEnter, onLensLeave, onOptionChoice, onReveal, onUserClose, PANEL_CLOSED, type PanelState } from '../../src/shell/panel-state';

// The panel's visibility rules, as the transitions the Panel and the controller drive. state × event → visible?
describe('panel visibility', () => {
  it('starts closed: no content, nothing shown', () => {
    expect(PANEL_CLOSED).toEqual({ loaded: false, revealed: false });
    expect(isVisible(PANEL_CLOSED)).toBe(false);
  });

  it('a lens that builds its content does not show the sheet', () => {
    const s = onContent(onLensEnter(PANEL_CLOSED));
    expect(s.loaded).toBe(true);
    expect(isVisible(s)).toBe(false);
  });

  it('the Open action reveals the sheet once there is content', () => {
    const s = onReveal(onContent(PANEL_CLOSED));
    expect(isVisible(s)).toBe(true);
  });

  it('a reveal with no content yet shows nothing, and shows once content arrives', () => {
    const early = onReveal(PANEL_CLOSED);
    expect(isVisible(early)).toBe(false);
    expect(isVisible(onContent(early))).toBe(true);
  });

  it('a user close hides the sheet and keeps the content', () => {
    const s = onUserClose(onReveal(onContent(PANEL_CLOSED)));
    expect(isVisible(s)).toBe(false);
    expect(s.loaded).toBe(true);
  });

  it('content changes after a user close do not reopen the sheet', () => {
    let s: PanelState = onUserClose(onReveal(onContent(PANEL_CLOSED)));
    s = onContent(s); // a tab, a walk step, a link: replace() keeps loaded, visibility untouched
    expect(isVisible(s)).toBe(false);
    expect(s.loaded).toBe(true);
  });

  it('content changes while visible keep the sheet visible', () => {
    const s = onContent(onReveal(onContent(PANEL_CLOSED)));
    expect(isVisible(s)).toBe(true);
  });

  it('a content choice in the Options reveals the sheet, as the Open action does', () => {
    expect(isVisible(onOptionChoice(onContent(PANEL_CLOSED)))).toBe(true);
    expect(isVisible(onOptionChoice(onContent(onUserClose(onReveal(onContent(PANEL_CLOSED))))))).toBe(true);
  });

  it('a choice with no content yet reveals nothing until content arrives', () => {
    expect(isVisible(onOptionChoice(PANEL_CLOSED))).toBe(false);
    expect(isVisible(onContent(onOptionChoice(PANEL_CLOSED)))).toBe(true);
  });

  it('a user close is idempotent and a second one changes nothing', () => {
    const once = onUserClose(onReveal(onContent(PANEL_CLOSED)));
    expect(onUserClose(once)).toEqual(once);
  });

  it('reveal after a close shows the kept content again', () => {
    const s = onReveal(onUserClose(onReveal(onContent(PANEL_CLOSED))));
    expect(isVisible(s)).toBe(true);
    expect(s.loaded).toBe(true);
  });

  it('entering a lens clears a reveal left from before', () => {
    const left: PanelState = { loaded: true, revealed: true };
    const entered = onLensEnter(left);
    expect(entered.revealed).toBe(false);
    expect(isVisible(entered)).toBe(false);
    expect(entered.loaded).toBe(true);
  });

  it('entering a lens with nothing revealed returns the same state', () => {
    const s: PanelState = { loaded: true, revealed: false };
    expect(onLensEnter(s)).toBe(s);
  });

  it('leaving a lens resets everything: the next entry starts hidden with nothing loaded', () => {
    const s = onLensLeave(onReveal(onContent(PANEL_CLOSED)));
    expect(s).toEqual(PANEL_CLOSED);
    const next = onContent(onLensEnter(s));
    expect(isVisible(next)).toBe(false);
  });

  it('a sky-only state (the sheet closed by the lens) hides and empties, and a reveal then shows nothing', () => {
    const closed = onLensLeave(onReveal(onContent(PANEL_CLOSED)));
    expect(isVisible(onReveal(closed))).toBe(false);
  });

  it('the rule table: every state against every event', () => {
    const states: PanelState[] = [
      { loaded: false, revealed: false },
      { loaded: true, revealed: false },
      { loaded: false, revealed: true },
      { loaded: true, revealed: true },
    ];
    const table = states.map((s) => ({
      from: `${s.loaded ? 'loaded' : 'empty'}/${s.revealed ? 'revealed' : 'hidden'}`,
      enter: isVisible(onLensEnter(s)),
      content: isVisible(onContent(s)),
      reveal: isVisible(onReveal(s)),
      userClose: isVisible(onUserClose(s)),
      choice: isVisible(onOptionChoice(s)),
      leave: isVisible(onLensLeave(s)),
    }));
    expect(table).toEqual([
      { from: 'empty/hidden', enter: false, content: false, reveal: false, userClose: false, choice: false, leave: false },
      { from: 'loaded/hidden', enter: false, content: false, reveal: true, userClose: false, choice: true, leave: false },
      { from: 'empty/revealed', enter: false, content: true, reveal: false, userClose: false, choice: false, leave: false },
      { from: 'loaded/revealed', enter: false, content: true, reveal: true, userClose: false, choice: true, leave: false },
    ]);
  });
});
