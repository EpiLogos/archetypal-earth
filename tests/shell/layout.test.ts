import { describe, expect, it } from 'vitest';
import { overlapping, paneMode, paneWidth, shiftX, type Box } from '../../src/shell/layout';

const box = (id: string, x: number, y: number, w: number, h: number): Box => ({ id, x, y, w, h });

describe('the layout contract: no two regions overlap', () => {
  it('names the pairs whose boxes share area, and only those', () => {
    const rs = [box('path', 0, 0, 300, 60), box('view', 600, 0, 200, 40), box('pane', 900, 0, 540, 900)];
    expect(overlapping(rs)).toEqual([]);
    expect(overlapping([...rs, box('slice', 850, 800, 200, 60)])).toEqual([['pane', 'slice']]);
  });
  it('lets boxes touch along an edge and ignores empty ones', () => {
    expect(overlapping([box('a', 0, 0, 100, 100), box('b', 100, 0, 100, 100)])).toEqual([]);
    expect(overlapping([box('a', 0, 0, 100, 100), box('gone', 10, 10, 0, 0)])).toEqual([]);
  });
});

describe('the pane frame: one width per state', () => {
  it('reads closed, contents, reading, wide from the two facts the frame holds', () => {
    expect(paneMode({ open: false, contents: false, wide: false })).toBe('closed');
    expect(paneMode({ open: true, contents: false, wide: false })).toBe('reading');
    expect(paneMode({ open: true, contents: false, wide: true })).toBe('wide');
    expect(paneMode({ open: true, contents: true, wide: true })).toBe('contents');
    expect(paneMode({ open: false, contents: true, wide: false })).toBe('contents');
  });
  it('takes the mockup widths on a desk and the whole width on a phone', () => {
    expect(paneWidth('closed', 1440)).toBe(0);
    expect(paneWidth('contents', 1440)).toBe(380);
    expect(paneWidth('reading', 1440)).toBe(780);
    expect(paneWidth('wide', 1440)).toBe(1000);
    expect(paneWidth('reading', 1000)).toBeCloseTo(580);
    expect(paneWidth('wide', 1000)).toBeCloseTo(760);
    expect(paneWidth('reading', 390)).toBe(390);
  });
  it('keeps the scene shift of a plain reading and widens it with the pane', () => {
    expect(shiftX('closed', 1440)).toBe(0);
    expect(shiftX('reading', 1440)).toBeCloseTo(-0.46);
    expect(shiftX('wide', 1440)).toBeCloseTo(-0.46 * (1000 / 780));
    expect(shiftX('reading', 390)).toBe(0);
  });
});
