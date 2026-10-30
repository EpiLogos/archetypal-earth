// The layout contract (H1's second half): the regions of the screen are boxes, and no two of them share area.
// Pure: the reading pane's widths (the same numbers the stylesheet's --pane-w holds), the scene shift each width asks of
// the rig, and the overlap check the layout test runs over the regions it measures.

export interface Box { id: string; x: number; y: number; w: number; h: number }

/** The pairs of regions whose boxes share area (edges that merely touch do not count; an empty box shares nothing). */
export function overlapping(boxes: Box[]): [string, string][] {
  const out: [string, string][] = [];
  const live = boxes.filter((b) => b.w > 0.5 && b.h > 0.5);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w > 0.5 && h > 0.5) out.push([a.id, b.id]);
    }
  }
  return out;
}

export type PaneMode = 'closed' | 'contents' | 'reading' | 'wide';

/** The mode the pane is in, from what its frame holds: whether Contents shows (it stands on its own, with no reading), whether a reading is open, whether it is widened. */
export function paneMode(f: { open: boolean; contents: boolean; wide: boolean }): PaneMode {
  if (f.contents) return 'contents';
  if (!f.open) return 'closed';
  return f.wide ? 'wide' : 'reading';
}

/** A phone's pane is a bottom sheet, the screen's whole width. */
export const PHONE_MAX = 760;

/** The pane's width in px at a viewport `vw` wide: Contents 380, a reading min(58vw, 780), the wide reading min(76vw, 1000). */
export function paneWidth(mode: PaneMode, vw: number): number {
  if (mode === 'closed') return 0;
  if (vw <= PHONE_MAX) return vw;
  if (mode === 'contents') return Math.min(380, vw);
  return mode === 'wide' ? Math.min(0.76 * vw, 1000) : Math.min(0.58 * vw, 780);
}

/** The rig's horizontal shift for the pane: -0.46 for a plain reading (as ever), scaled by the pane's width against it; none on a phone. */
export function shiftX(mode: PaneMode, vw: number): number {
  if (mode === 'closed' || vw <= PHONE_MAX) return 0;
  return -0.46 * (paneWidth(mode, vw) / paneWidth('reading', vw));
}

/**
 * The regions the contract names, each by the selectors that draw it: the walk measures them as the visitor sees them
 * (shown, not faded out) and asks `overlapping`. Scene content (the floating cards, markers on the globe) is not a region.
 */
export const REGIONS: Record<string, string[]> = {
  path: ['.shell'],
  corner: ['.sh-corner'],
  context: ['.focus-label'],
  slice: ['.time'],
  walk: ['.aion-epochs', '.aion-ring', '.strip', '.ws-host'],
  card: ['.reveal'],
  pane: ['section.deep'],
};
