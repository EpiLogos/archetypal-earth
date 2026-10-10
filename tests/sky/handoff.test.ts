// The handoff's composition (audit S3 (a)) and the arrival settle (S3 (b)), as pure maths.
//
// The geometry is the canonical system view the S key composes (stages.ts systemViewLongitude and SYSTEM_VIEW_ELEVATION; frames.ts
// systemViewLatLon), read at real moments, and the Sun's true direction from the Earth. The camera sits over the Sun's longitude,
// so the Earth–Sun line stands vertical on the screen and the pair's extent is the same on every date and on every viewport from a
// phone to an ultrawide. The invariant is stated for the reference moment below, then asserted across the whole year and across
// the viewports; the limit the geometry still imposes (no look-at can frame the pair before ~810 R⊕) is pinned, not hidden.
import { describe, expect, it } from 'vitest';
import { dirFromLatLon, type Vec3 } from '../../src/data/geo';
import { eclipticVector, gmstDeg, obliquityDeg, sceneFromEcliptic, systemViewLatLon } from '../../src/sky/frames';
import {
  bothInFrame, FRAME_CENTRAL, handoffFocusWeight, FOCUS_HANDOFF, ndcOf, pairExtent, SETTLE, settleStep, STAGE_EDGES, SUN_DIAGRAM_DIST,
  SYSTEM_VIEW_ELEVATION, systemViewLongitude,
} from '../../src/sky/stages';

const FOV = 38;
/** The reference moment: the sandbox's date (2026-10-09). The invariant is measured here; the year is asserted separately. */
const REF = Date.parse('2026-10-09T12:00:00Z');
/** The viewports: a tall phone (0.46), a small phone / tablet portrait (0.75), square, a desktop (1.6), a wide one (2.2), an ultrawide (2.8). */
const ASPECTS = [0.46, 0.75, 1.0, 1.6, 2.2, 2.8];
/** From where the pair is held inside the central 70% on the reference date (the curve first frames it at ~1 015), R⊕. */
const HELD_FROM = 1020;
/** … and on every date of the year, on every viewport: the roll of the equatorial pole over the seasons costs ~50 R⊕. */
const YEAR_HELD_FROM = 1070;

/** The Sun's ecliptic longitude, degrees (Meeus, ch. 25, low precision: well within a tenth of a degree for this purpose). */
function sunLongitudeDeg(ms: number): number {
  const d = ms / 86_400_000 + 2440587.5 - 2451545.0;
  const L = 280.46 + 0.9856474 * d;
  const g = ((357.528 + 0.9856003 * d) * Math.PI) / 180;
  return ((((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360) + 360) % 360);
}

/** The canonical system view at `ms` (or the view from `longitude`): the camera's direction from the focus, and the Sun's direction from the Earth (scene axes). */
function canonical(ms: number, longitude = systemViewLongitude(sunLongitudeDeg(ms))): { camDir: Vec3; sunDir: Vec3 } {
  const gmst = gmstDeg(ms);
  const eps = obliquityDeg(ms);
  const ll = systemViewLatLon(longitude, SYSTEM_VIEW_ELEVATION, gmst, eps);
  return { camDir: dirFromLatLon(ll.lat, ll.lon), sunDir: sceneFromEcliptic(eclipticVector(sunLongitudeDeg(ms), 0, 1), gmst, eps) };
}

const ref = canonical(REF);
const within = (d: number, aspect: number) => pairExtent(d, aspect, FOV, ref.camDir, ref.sunDir);

/** The smallest |NDC| extent any look-at weight in [0,1] achieves for the pair at this distance and aspect. */
function bestPossibleExtent(d: number, aspect: number): number {
  let best = Infinity;
  for (let w = 0; w <= 1 + 1e-9; w += 0.005) best = Math.min(best, pairExtent(d, aspect, FOV, ref.camDir, ref.sunDir, Math.min(1, w)));
  return best;
}

describe('the look-at weight across the handoff', () => {
  it('is 0 in the Earth\'s own stage and the handoff\'s start, so the atlas\'s framing is unchanged there', () => {
    for (const d of [1.05, 5.4, 12, 40, STAGE_EDGES.handoff]) expect(handoffFocusWeight(d)).toBe(0);
  });

  it('reaches 1 at the system\'s edge, and is monotone in the distance', () => {
    expect(handoffFocusWeight(STAGE_EDGES.system)).toBe(1);
    expect(handoffFocusWeight(STAGE_EDGES.system * 3)).toBe(1);
    let prev = 0;
    for (let d = 100; d < 6000; d *= 1.02) {
      const w = handoffFocusWeight(d);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      prev = w;
    }
  });

  it('moves in two steps: most of the way early, then a plateau at the first step\'s share while the pair is held, then the rest', () => {
    const { first, rest } = FOCUS_HANDOFF;
    expect(handoffFocusWeight(first.to)).toBeCloseTo(first.share, 12);
    expect(handoffFocusWeight(rest.from)).toBeCloseTo(first.share, 12);
    for (let d = first.to; d <= rest.from; d += 30) expect(handoffFocusWeight(d)).toBeCloseTo(first.share, 12);
    expect(handoffFocusWeight(2000)).toBeGreaterThan(first.share);
    expect(handoffFocusWeight(2000)).toBeLessThan(1);
  });

  it('is one half at ~925 R⊕, where the look-at is the midpoint of the Earth and the Sun', () => {
    let half = 0;
    for (let d = STAGE_EDGES.handoff; d < STAGE_EDGES.system && !half; d += 1) if (handoffFocusWeight(d) >= 0.5) half = d;
    expect(half).toBeGreaterThanOrEqual(900);
    expect(half).toBeLessThanOrEqual(950);
  });

  it('never lurches: its slope stays under 1.7 per e-fold of distance (the zoom moves the look-at steadily)', () => {
    let steepest = 0;
    for (let d = STAGE_EDGES.handoff; d < STAGE_EDGES.system; d *= 1.005) steepest = Math.max(steepest, (handoffFocusWeight(d * 1.005) - handoffFocusWeight(d)) / Math.log(1.005));
    expect(steepest).toBeLessThan(1.7);
    expect(steepest).toBeGreaterThan(1);
  });

  it('depends on the distance alone: the same distance is the same weight, so the zoom is reversible', () => {
    for (const d of [700, 1000, 1400, 2500]) expect(handoffFocusWeight(d)).toBe(handoffFocusWeight(d));
  });
});

describe('the framing of the Earth and the Sun, the reference view', () => {
  it('keeps both the Earth and the Sun inside the central 70% of every viewport, from a tall phone to an ultrawide, from ~1 020 R⊕ on', () => {
    for (const aspect of ASPECTS) {
      for (let d = HELD_FROM; d <= 3000; d += 20) {
        expect(within(d, aspect), `aspect ${aspect} at ${d} R⊕`).toBeLessThanOrEqual(FRAME_CENTRAL + 1e-9);
      }
    }
  });

  it('first frames both inside that central 70% at 1 000–1 030 R⊕ on every viewport (the boundary is pinned, not hoped for)', () => {
    for (const aspect of ASPECTS) {
      let first: number | null = null;
      for (let d = 600; d <= 3000 && first === null; d += 5) if (bothInFrame(d, aspect, FOV, ref.camDir, ref.sunDir)) first = d;
      expect(first, `aspect ${aspect}`).not.toBeNull();
      expect(first!, `aspect ${aspect}`).toBeGreaterThanOrEqual(1000);
      expect(first!, `aspect ${aspect}`).toBeLessThanOrEqual(1030);
    }
  });

  it('the geometric limit: the best possible look-at first centres the pair at ~810 R⊕ on every viewport; the curve gets there at ~1 015', () => {
    // the Sun is ~900 R⊕ from the Earth; in this view the Earth–Sun line is foreshortened and vertical, so the best look-at holds both
    // inside 70% from ~810 R⊕ whatever the width (the curve's cost is the difference, ~200 R⊕ of its first step)
    for (const aspect of ASPECTS) {
      let limit: number | null = null;
      for (let d = 600; d <= 1100 && limit === null; d += 5) if (bestPossibleExtent(d, aspect) <= FRAME_CENTRAL) limit = d;
      expect(limit, `aspect ${aspect}`).not.toBeNull();
      expect(limit!, `aspect ${aspect}`).toBeGreaterThanOrEqual(780);
      expect(limit!, `aspect ${aspect}`).toBeLessThanOrEqual(840);
      expect(limit!, `aspect ${aspect}`).toBeLessThan(FOCUS_HANDOFF.first.to - 300);
    }
  });

  it('keeps the pair inside the frame (|NDC| ≤ 1, not merely the central 70%) from 1 000 R⊕ on every viewport', () => {
    for (const aspect of ASPECTS) {
      for (let d = 1000; d <= 3000; d += 25) expect(within(d, aspect), `${aspect} at ${d} R⊕`).toBeLessThanOrEqual(0.8);
    }
  });

  it('is the same view on every viewport: the extent does not depend on the width, because the pair stands vertical', () => {
    for (const d of [1100, 1500, 2200, 3000]) {
      const tall = within(d, 0.46);
      for (const aspect of ASPECTS) expect(Math.abs(within(d, aspect) - tall), `${aspect} at ${d} R⊕`).toBeLessThan(0.02);
    }
  });

  it('the Earth itself stays well on screen across the handoff on every viewport (its own |NDC| is at most ~0.6)', () => {
    for (const aspect of ASPECTS) {
      for (let d = 1000; d <= 3000; d += 50) {
        const focus: Vec3 = ref.sunDir.map((x) => x * SUN_DIAGRAM_DIST * handoffFocusWeight(d)) as Vec3;
        const p = ndcOf([0, 0, 0], focus, ref.camDir, d, aspect, FOV);
        expect(Math.max(Math.abs(p.x), Math.abs(p.y)), `aspect ${aspect} at ${d} R⊕`).toBeLessThanOrEqual(0.6);
      }
    }
  });
});

describe('the framing of the Earth and the Sun, across the year', () => {
  /** The worst |NDC| extent of the pair from `YEAR_HELD_FROM` to the system's edge, over `aspects`, on each day of a year. */
  function yearWorst(longitudeOf: (ms: number) => number | undefined, aspects = ASPECTS): number[] {
    const out: number[] = [];
    for (let k = 0; k < 366; k++) {
      const ms = REF + k * 86_400_000;
      const c = canonical(ms, longitudeOf(ms));
      let w = 0;
      for (const aspect of aspects) for (let d = YEAR_HELD_FROM; d <= 3000; d += 10) w = Math.max(w, pairExtent(d, aspect, FOV, c.camDir, c.sunDir));
      out.push(w);
    }
    return out;
  }

  const year = yearWorst(() => undefined);

  it('keeps the Earth and the Sun inside the central 70% on every day of the year, on every viewport', () => {
    expect(Math.max(...year)).toBeLessThanOrEqual(FRAME_CENTRAL);
    expect(Math.max(...year)).toBeLessThanOrEqual(0.66);
  });

  it('hardly depends on the date: the best and the worst day differ by under 0.1 (the camera follows the Sun; only the roll of the equatorial pole remains)', () => {
    expect(Math.max(...year) - Math.min(...year)).toBeLessThan(0.1);
  });

  it('holds on a very narrow phone (0.5) as well, on every day', () => {
    expect(Math.max(...yearWorst(() => undefined, [0.5]))).toBeLessThanOrEqual(FRAME_CENTRAL);
  });

  it('the azimuth is the Sun\'s own longitude: smooth in the date, so the settled view never jumps as the date scrubs', () => {
    for (let l = 0; l < 360; l += 15) expect(systemViewLongitude(l)).toBe(l);
  });

  it('measures what the change bought: the fixed azimuth (250°) it replaced left the pair far outside the frame on some dates', () => {
    const fixed = yearWorst(() => 250);
    expect(Math.max(...fixed)).toBeGreaterThan(1.5);
    expect(Math.max(...fixed)).toBeGreaterThan(Math.max(...year) * 2);
  });
});

describe('the arrival settle', () => {
  it('moves no further than the remaining angle and no faster than the cap', () => {
    for (const remaining of [0.05, 1, 10, 60, 180]) {
      for (const dt of [1 / 60, 1 / 30, 0.1]) {
        const step = settleStep(remaining, dt);
        expect(step).toBeGreaterThanOrEqual(0);
        expect(step).toBeLessThanOrEqual(remaining + 1e-12);
        expect(step).toBeLessThanOrEqual(SETTLE.maxDegPerS * dt + 1e-12);
      }
    }
    expect(settleStep(0, 0.1)).toBe(0);
    expect(settleStep(10, 0)).toBe(0);
  });

  it('settles to the canonical view within a bounded time from a long way off, never overshooting', () => {
    let remaining = 150;
    const dt = 1 / 30;
    let t = 0;
    while (remaining > SETTLE.doneDeg && t < 60) {
      const step = settleStep(remaining, dt);
      expect(step).toBeLessThanOrEqual(SETTLE.maxDegPerS * dt + 1e-12);
      remaining -= step;
      expect(remaining).toBeGreaterThanOrEqual(-1e-12);
      t += dt;
    }
    expect(remaining).toBeLessThanOrEqual(SETTLE.doneDeg);
    expect(t).toBeLessThan(20);
  });

  it('is slow and eased: a small offset is 90% gone at the 2.4 s the spec names', () => {
    let remaining = 5;
    const dt = 1 / 60;
    for (let t = 0; t < SETTLE.durationMs / 1000; t += dt) remaining -= settleStep(remaining, dt);
    expect(remaining).toBeLessThanOrEqual(0.5 + 0.02);
    expect(remaining).toBeGreaterThan(0.4);
  });
});
