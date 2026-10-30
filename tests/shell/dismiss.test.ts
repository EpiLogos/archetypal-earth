import { describe, expect, it } from 'vitest';
import { RUNGS, dismissal, type DismissFacts } from '../../src/shell/dismiss';

// H1: the dismissal stack, one pure function. Escape, a panel's ✕ and a crumb all ask it what to take down next, and
// the order is search → menu/popover → reading → Contents → focus up a rung → lens → Field.

const calm: DismissFacts = {
  searchOpen: false, menuOpen: false, popoverOpen: false,
  youOpen: false, passageOpen: false, sheetVisible: false, deepOpen: false,
  contentsOpen: false, gaze: false, back: 'none',
};
const at = (over: Partial<DismissFacts>): DismissFacts => ({ ...calm, ...over });

describe('the dismissal stack', () => {
  it('names the rungs in the owner order', () => {
    expect(RUNGS).toEqual(['search', 'menu', 'popover', 'reading', 'contents', 'gaze', 'focus', 'lens', 'field']);
  });

  it('with nothing open and nowhere to go, there is nothing to dismiss', () => {
    expect(dismissal(calm)).toEqual({ rung: 'field', effect: 'none' });
  });

  it('takes search first, whatever else stands', () => {
    const everything = at({ searchOpen: true, menuOpen: true, popoverOpen: true, youOpen: true, passageOpen: true, sheetVisible: true, deepOpen: true, contentsOpen: true, gaze: true, back: 'out' });
    expect(dismissal(everything)).toEqual({ rung: 'search', effect: 'search' });
  });

  it('then the menu, then the popover', () => {
    expect(dismissal(at({ menuOpen: true, popoverOpen: true, deepOpen: true })).effect).toBe('menu');
    expect(dismissal(at({ popoverOpen: true, deepOpen: true, sheetVisible: true })).effect).toBe('popover');
  });

  it('then a reading, innermost first: your page, a passage, a panel lens sheet, the deep reading', () => {
    const open = { youOpen: true, passageOpen: true, sheetVisible: true, deepOpen: true, contentsOpen: true, back: 'up' as const };
    const seen: string[] = [];
    let facts = at(open);
    for (const [key, effect] of [['youOpen', 'you'], ['passageOpen', 'passage'], ['sheetVisible', 'sheet'], ['deepOpen', 'deep']] as const) {
      const d = dismissal(facts);
      expect(d.rung).toBe('reading');
      seen.push(d.effect);
      expect(d.effect).toBe(effect);
      facts = { ...facts, [key]: false };
    }
    expect(seen).toEqual(['you', 'passage', 'sheet', 'deep']);
    // with every reading down, the Contents is next
    expect(dismissal(facts)).toEqual({ rung: 'contents', effect: 'contents' });
  });

  it('then a gaze at a planet, which looks back at the planet and does not let it go', () => {
    expect(dismissal(at({ gaze: true, back: 'up' }))).toEqual({ rung: 'gaze', effect: 'gaze' });
  });

  it('then one rung up inside the mode, then out of the mode to the Field', () => {
    expect(dismissal(at({ back: 'up' }))).toEqual({ rung: 'focus', effect: 'up' });
    expect(dismissal(at({ back: 'out' }))).toEqual({ rung: 'lens', effect: 'out' });
  });

  it('closing a reading never leaves the mode: with a reading up, the effect is the reading, not the exit', () => {
    for (const back of ['up', 'out'] as const) {
      expect(dismissal(at({ sheetVisible: true, back })).effect).toBe('sheet');
      expect(dismissal(at({ deepOpen: true, back })).effect).toBe('deep');
    }
  });

  it('is pure: the same facts give the same answer and the input is untouched', () => {
    const f = at({ deepOpen: true, back: 'up' });
    const snapshot = JSON.stringify(f);
    expect(dismissal(f)).toEqual(dismissal(f));
    expect(JSON.stringify(f)).toBe(snapshot);
  });

  it('walking Escape down a full stack takes the rungs in order and ends at the Field', () => {
    let f = at({ searchOpen: true, popoverOpen: true, youOpen: true, deepOpen: true, contentsOpen: true, gaze: true, back: 'up' });
    const order: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = dismissal(f);
      if (d.effect === 'none') break;
      order.push(d.effect);
      f = {
        ...f,
        searchOpen: d.effect === 'search' ? false : f.searchOpen,
        popoverOpen: d.effect === 'popover' ? false : f.popoverOpen,
        youOpen: d.effect === 'you' ? false : f.youOpen,
        deepOpen: d.effect === 'deep' ? false : f.deepOpen,
        contentsOpen: d.effect === 'contents' ? false : f.contentsOpen,
        gaze: d.effect === 'gaze' ? false : f.gaze,
        back: d.effect === 'up' ? 'out' : d.effect === 'out' ? 'none' : f.back,
      };
    }
    expect(order).toEqual(['search', 'popover', 'you', 'deep', 'contents', 'gaze', 'up', 'out']);
  });
});
