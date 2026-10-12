import { describe, expect, it } from 'vitest';
import {
  anchorVis,
  fanTargets,
  leaderOpacity,
  plateOpacity,
  type FanBounds,
  type FloatTarget,
  type Obstacle,
  type PlateBox,
} from '../../src/ui/floats';
import type { Subject } from '../../src/data/model';

// Layout constants mirror Floats.set / Floats.update: the plate box is the image width (or the tonal width) and its
// height includes the 36px caption strip for images. Desktop sizes are at 1440x900 (k = 1); phone sizes are narrow.
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

function boundsFor(v: { width: number; height: number }): FanBounds {
  const narrow = v.width < 760;
  return {
    width: v.width,
    height: v.height,
    marginX: narrow ? 8 : 26,
    top: narrow ? 64 : 88,
    bottom: narrow ? 128 : 124,
  };
}

const PLATES = {
  desktopImage: { w: 214, h: 214 / 1.5 + 36 },
  desktopTonal: { w: 156, h: 156 / 1.5 },
  phoneImage: { w: 112, h: 112 / 1.5 + 36 },
  phoneTonal: { w: 118, h: 118 / 1.5 },
} satisfies Record<string, PlateBox>;

function sets(v: { width: number; height: number }): [string, PlateBox][] {
  return v.width > 760
    ? [['image', PLATES.desktopImage], ['tonal', PLATES.desktopTonal]]
    : [['image', PLATES.phoneImage], ['tonal', PLATES.phoneTonal]];
}

function overlaps(a: PlateBox & { cx: number; cy: number }, b: PlateBox & { cx: number; cy: number }) {
  // same gaps the relaxation in Floats.update keeps between plates
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + 22 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + 14;
}

describe('earth-point anchoring', () => {
  it('keeps plates whose surface points face away from the camera visible once they have appeared', () => {
    // five plates on the far hemisphere: facing <= 0, which hid them under the surface anchor
    const facings = [-0.9, -0.4, 0, -0.05, -1.2];
    const vis = facings.map((f) => anchorVis('earth-point', f, true));
    expect(vis).toEqual([1, 1, 1, 1, 1]);

    // born = now + 500 + idx * 190; after the stagger and the 1100ms appear ease every plate is fully on
    facings.forEach((_, idx) => {
      const state = plateOpacity(vis[idx], 500 + idx * 190 + 1100 + 1);
      expect(state.op).toBe(1);
      expect(state.pointerEvents).toBe('auto');
    });
    // before its stagger point a plate is still hidden and not clickable
    expect(plateOpacity(vis[0], 0).pointerEvents).toBe('none');
  });

  it('hides the earth-point anchor when the Earth centre is behind the camera', () => {
    expect(anchorVis('earth-point', 1, false)).toBe(0);
    expect(plateOpacity(anchorVis('earth-point', 1, false), 5000).pointerEvents).toBe('none');
  });

  it('fans plates away from an open side panel', () => {
    const ax = 720, ay = 450;
    const panel: Obstacle[] = [{ x: 1440 - 360, y: 0, w: 360, h: 900 }];
    const t = fanTargets(ax, ay, [PLATES.desktopTonal, PLATES.desktopTonal, PLATES.desktopTonal], panel, boundsFor(DESKTOP));
    const meanX = t.reduce((s, c) => s + c.cx, 0) / t.length;
    expect(meanX).toBeLessThan(ax);
  });
});

describe('leader lines follow their plate', () => {
  it('scales the hairline and dot with the plate opacity, and both are zero when the plate is', () => {
    expect(leaderOpacity(0)).toEqual({ line: 0, dot: 0 });
    expect(leaderOpacity(1)).toEqual({ line: 0.5, dot: 0.9 });
    const half = leaderOpacity(0.4);
    expect(half.line).toBeCloseTo(0.2);
    expect(half.dot).toBeCloseTo(0.36);
  });

  it('is zero for every plate state the plate itself hides (a yielded or not-yet-born plate)', () => {
    // the plate's op is 0 before its stagger point and while it yields: its leader must be 0 too
    expect(leaderOpacity(plateOpacity(1, 0).op)).toEqual({ line: 0, dot: 0 });
    expect(leaderOpacity(plateOpacity(1, 5000, true).op)).toEqual({ line: 0, dot: 0 });
  });
});

describe('surface anchoring (regression guard)', () => {
  it('still hides a plate whose surface point has zero facing', () => {
    expect(anchorVis('surface', 0, true)).toBe(0);
    const state = plateOpacity(anchorVis('surface', 0, true), 5000);
    expect(state.op).toBe(0);
    expect(state.pointerEvents).toBe('none');
  });

  it('fades a surface plate in with facing and ignores the camera-centre flag', () => {
    expect(anchorVis('surface', 0.05, false)).toBeCloseTo(0.5);
    expect(anchorVis('surface', 0.5, false)).toBe(1);
    expect(anchorVis('surface', -0.3, true)).toBe(0);
  });
});

describe('fanTargets', () => {
  for (const [name, view] of [['1440x900', DESKTOP], ['390x844', PHONE]] as const) {
    const bounds = boundsFor(view);
    const ax = view.width / 2;
    const ay = view.height / 2;

    for (const [kind, plate] of sets(view)) {
      for (let n = 1; n <= 5; n++) {
        it(`places ${n} ${kind} plate(s) inside bounds without overlap at ${name}`, () => {
          const plates = Array.from({ length: n }, () => plate);
          const t = fanTargets(ax, ay, plates, [], bounds);
          expect(t).toHaveLength(n);
          t.forEach((c, i) => {
            const p = plates[i];
            expect(c.cx - p.w / 2).toBeGreaterThanOrEqual(bounds.marginX - 1e-6);
            expect(c.cx + p.w / 2).toBeLessThanOrEqual(bounds.width - bounds.marginX + 1e-6);
            expect(c.cy - p.h / 2).toBeGreaterThanOrEqual(bounds.top - 1e-6);
            expect(c.cy + p.h / 2).toBeLessThanOrEqual(bounds.height - bounds.bottom + 1e-6);
          });
          for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
              expect(overlaps({ ...plates[i], ...t[i] }, { ...plates[j], ...t[j] })).toBe(false);
            }
          }
        });
      }
    }
  }

  it('is symmetric about the fan direction for two plates', () => {
    const t = fanTargets(720, 450, [PLATES.desktopTonal, PLATES.desktopTonal], [], boundsFor(DESKTOP));
    expect(t[0].cx + t[1].cx).toBeCloseTo(1440, 0);
    expect(t[0].cy).toBeCloseTo(t[1].cy, 6);
  });
});

describe('FloatTarget', () => {
  it('accepts a subject target', () => {
    const subject: Subject = { type: 'archetype', id: 'anima' };
    const t: FloatTarget = { type: 'subject', subject };
    expect(t.type).toBe('subject');
    if (t.type === 'subject') expect(t.subject.id).toBe('anima');
  });
});
